// Bot de equipos: recorre plantillas de la cola team_queue, y para los equipos de la provincia
// elegida añade a scrape_queue los jugadores cuya edad encaja con los años de nacimiento buscados
// y añade a team_queue los equipos enlazados (rivales de su competición).
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (obligatorias), LIMIT (equipos por ejecución,
// 5 por defecto, máx. 30), DELAY_MS (5000), MAX_AGE (23), PROVINCE (Cádiz),
// CONTACT, SOURCE_ALLOWED_HOSTS, ALLOW_HTTP=1 (solo pruebas).
// Reglas: respeta robots.txt, va despacio, se detiene ante 403/429/503 o desafío de Cloudflare.
import { appendFile } from 'node:fs/promises';
import { decodeBody, isAllowed, parseRobots } from './lib/ficha.mjs';
import { parseTeam, sameProvince } from './lib/team.mjs';

const env = process.env;
const SUPABASE_URL = env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const LIMIT = clamp(parseInt(env.LIMIT, 10) || 5, 1, 30);
const DELAY_MS = env.DELAY_MS != null && env.DELAY_MS !== '' && Number.isFinite(Number(env.DELAY_MS)) ? Math.max(0, Number(env.DELAY_MS)) : 5000;
const MAX_AGE = parseInt(env.MAX_AGE, 10) || 23; // sub-23: menores de esta edad
const PROVINCE = env.PROVINCE || 'Cádiz';
const ALLOWED_HOSTS = (env.SOURCE_ALLOWED_HOSTS ?? 'www.lapreferente.com,lapreferente.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_HTTP = env.ALLOW_HTTP === '1';
const MAX_ATTEMPTS = 3;
const MAX_FAILS_IN_ROW = 3;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 3_000_000;
const MAX_NEW_TEAMS = 40;

// Prefiltro por edad: sub-23 (menos de MAX_AGE años); sin dato de edad también pasa y decide la ficha.
const AGE_MIN = 0;
const AGE_MAX = MAX_AGE - 1;

const AGENT_TOKEN = 'paneldejugadorescadiz-bot';
const USER_AGENT = `${AGENT_TOKEN}/1.0 (+https://paneldejugadorescadiz.github.io)` + (env.CONTACT ? ` ${env.CONTACT}` : '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function db(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {};
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, ...auth, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const robotsCache = new Map();
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let rules;
  if (res.status === 404) rules = [];
  else if (res.ok) rules = parseRobots(await res.text(), AGENT_TOKEN);
  else throw Object.assign(new Error(`robots.txt respondió ${res.status}`), { blocked: true });
  robotsCache.set(origin, rules);
  return rules;
}

const CHALLENGE = /just a moment|cf-chl|challenge-platform|attention required|enable javascript and cookies/i;
const teamIdOf = (url) => /\/(E\d+C\d+)/i.exec(new URL(url).pathname)?.[1]?.toUpperCase() ?? null;

async function processTeam(row) {
  let url;
  try { url = new URL(row.url); } catch { return { status: 'skipped', reason: 'url_no_valida' }; }
  if (url.protocol !== 'https:' && !(ALLOW_HTTP && url.protocol === 'http:')) return { status: 'skipped', reason: 'solo_https' };
  if (!ALLOWED_HOSTS.includes(url.hostname)) return { status: 'skipped', reason: 'host_no_permitido' };
  if (!teamIdOf(row.url)) return { status: 'skipped', reason: 'url_sin_identificador' };
  if (/femenin/i.test(url.pathname)) return { status: 'skipped', reason: 'femenino' };

  const rules = await robotsFor(url.origin);
  if (!isAllowed(rules, url.pathname + url.search)) return { status: 'skipped', reason: 'bloqueada_por_robots' };

  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'es-ES,es;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: 'failed', reason: 'red', note: `red: ${error.cause?.code ?? error.name}`, retryable: true };
  }
  if (!ALLOWED_HOSTS.includes(new URL(res.url).hostname)) return { status: 'failed', reason: 'redireccion_a_otro_host' };
  if ([403, 429, 503].includes(res.status)) return { status: 'failed', reason: `bloqueado_${res.status}`, note: `HTTP ${res.status}`, blocked: true, retryable: true };
  if (res.status === 404 || res.status === 410) return { status: 'skipped', reason: 'no_encontrada', note: `HTTP ${res.status}` };
  if (!res.ok) return { status: 'failed', reason: `http_${res.status}`, note: `HTTP ${res.status}`, retryable: true };

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return { status: 'failed', reason: 'demasiado_grande' };
  const { text, charset } = decodeBody(buffer, res.headers.get('content-type') ?? '');
  const team = parseTeam(text, res.url);

  if (!team.province && CHALLENGE.test(text.slice(0, 8000))) {
    return { status: 'failed', reason: 'desafio_cloudflare', note: 'la web pide verificación', blocked: true, retryable: true };
  }
  if (!team.province) {
    return { status: 'failed', reason: 'sin_provincia', note: `charset ${charset}; no se encuentra "(provincia) - Fundado"`, snippet: text.replace(/\s+/g, ' ').slice(0, 600) };
  }
  if (team.isFemale) return { status: 'skipped', reason: 'femenino', province: team.province };
  if (!sameProvince(team.province, PROVINCE)) return { status: 'skipped', reason: 'otra_provincia', note: team.province, province: team.province };
  if (team.players.length === 0) {
    return { status: 'failed', reason: 'sin_jugadores', province: team.province, note: `charset ${charset}`, snippet: text.replace(/\s+/g, ' ').slice(0, 600) };
  }

  // Candidatos: edad dentro del rango, o sin edad (lo decide después la ficha).
  const candidates = team.players.filter((p) => p.age == null || (p.age >= AGE_MIN && p.age <= AGE_MAX));
  if (candidates.length) {
    await db('scrape_queue?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: candidates.map((p) => ({ url: p.url })),
    });
  }
  const newTeams = team.teams.slice(0, MAX_NEW_TEAMS);
  if (newTeams.length) {
    await db('team_queue?on_conflict=url', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: newTeams.map((u) => ({ url: u })),
    });
  }
  return {
    status: 'done',
    reason: 'recorrido',
    province: team.province,
    queued: candidates.length,
    note: `${team.players.length} jugadores, ${candidates.length} con edad ${AGE_MIN}-${AGE_MAX} o sin dato; ${newTeams.length} equipos enlazados`,
  };
}

const counts = new Map();
const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);

async function writeSummary(extra) {
  const lines = [...counts.entries()].sort().map(([k, n]) => `${k} → ${n}`);
  const text = [`Resumen: ${lines.join(' | ') || 'sin equipos procesados'}`, extra].filter(Boolean).join('\n');
  console.log(`\n${text}`);
  if (env.GITHUB_STEP_SUMMARY) {
    const table = ['| Resultado | Equipos |', '| --- | --- |', ...[...counts.entries()].sort().map(([k, n]) => `| ${k} | ${n} |`)];
    await appendFile(env.GITHUB_STEP_SUMMARY, `## Bot de equipos\n\n${table.join('\n')}\n\n${extra ?? ''}\n`);
  }
}

const rows = await db(`team_queue?select=id,url,attempts&status=eq.pending&attempts=lt.${MAX_ATTEMPTS}&order=id.asc&limit=${LIMIT}`);
if (!rows.length) {
  await writeSummary('No hay equipos pendientes en team_queue.');
  process.exit(0);
}
console.log(`Procesando ${rows.length} equipo(s) de ${PROVINCE}. Edad buscada: ${AGE_MIN}-${AGE_MAX}. Pausa: ${DELAY_MS} ms.`);

let failsInRow = 0;
let aborted = null;
let totalQueued = 0;

for (const [index, row] of rows.entries()) {
  const label = `[${index + 1}/${rows.length}] ${teamIdOf(row.url) ?? `cola#${row.id}`}`;
  let result;
  try {
    result = await processTeam(row);
  } catch (error) {
    result = { status: 'failed', reason: error.blocked ? 'robots_no_disponible' : 'error_inesperado', note: String(error.message).slice(0, 300), blocked: Boolean(error.blocked), retryable: Boolean(error.blocked) };
  }
  bump(`${result.status}: ${result.reason}`);
  totalQueued += result.queued ?? 0;
  console.log(`${label} → ${result.status}: ${result.reason}${result.note ? ` (${result.note})` : ''}`);

  const attempts = row.attempts + 1;
  const queueStatus = result.retryable && attempts < MAX_ATTEMPTS ? 'pending' : result.status;
  try {
    await db(`team_queue?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: {
        status: queueStatus,
        attempts,
        note: result.note ?? result.reason,
        province: result.province ?? null,
        players_queued: result.queued ?? null,
        snippet: result.snippet ?? null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`No se pudo actualizar la cola: ${error.message}`);
    aborted = 'no se puede escribir en Supabase';
    break;
  }

  if (result.blocked) { aborted = `la web ha bloqueado al bot (${result.reason}); se detiene la ejecución`; break; }
  failsInRow = result.status === 'failed' ? failsInRow + 1 : 0;
  if (failsInRow >= MAX_FAILS_IN_ROW) { aborted = `${MAX_FAILS_IN_ROW} fallos seguidos; se detiene la ejecución`; break; }
  if (index < rows.length - 1 && result.status !== 'skipped') await sleep(DELAY_MS);
}

await writeSummary([`Jugadores añadidos a la cola de fichas: ${totalQueued}.`, aborted ? `⚠️ ${aborted}.` : null].filter(Boolean).join('\n'));
const failed = [...counts.keys()].some((k) => k.startsWith('failed'));
process.exit(aborted || failed ? 1 : 0);
