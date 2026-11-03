// Bot de extracción: procesa las fichas pendientes de la cola (tabla scrape_queue).
//
// Variables de entorno:
//   SUPABASE_URL                 obligatoria
//   SUPABASE_SERVICE_ROLE_KEY    obligatoria (clave de servicio; nunca va en el código)
//   LIMIT                        fichas por ejecución (por defecto 10, máximo 50)
//   DELAY_MS                     pausa entre peticiones (por defecto 5000)
//   MIN_YEAR / MAX_YEAR          años de nacimiento que se guardan (2003 / 2007)
//   CONTACT                      opcional: se añade a la identificación del bot
//   SOURCE_ALLOWED_HOSTS         opcional: por defecto www.lapreferente.com,lapreferente.com
//   ALLOW_HTTP=1                 solo para pruebas locales
//
// Reglas de seguridad: respeta robots.txt, solo visita los hosts permitidos, se identifica
// con claridad, va despacio y se detiene ante un 403/429/503, un desafío de Cloudflare o
// tres fallos seguidos. Los registros solo muestran identificadores, nunca nombres.
import { appendFile } from 'node:fs/promises';
import { decodeBody, isAllowed, parseFicha, parseRobots, sourceIdFromUrl } from './lib/ficha.mjs';

const env = process.env;
const SUPABASE_URL = env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const LIMIT = clamp(parseInt(env.LIMIT, 10) || 10, 1, 50);
const DELAY_MS = Math.max(0, Number.isFinite(Number(env.DELAY_MS)) && env.DELAY_MS !== '' && env.DELAY_MS != null ? Number(env.DELAY_MS) : 5000);
const MIN_YEAR = parseInt(env.MIN_YEAR, 10) || 2003;
const MAX_YEAR = parseInt(env.MAX_YEAR, 10) || 2007;
const ALLOWED_HOSTS = (env.SOURCE_ALLOWED_HOSTS ?? 'www.lapreferente.com,lapreferente.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_HTTP = env.ALLOW_HTTP === '1';
const MAX_ATTEMPTS = 3;
const MAX_FAILS_IN_ROW = 3;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 2_000_000;

const AGENT_TOKEN = 'paneldejugadorescadiz-bot';
const USER_AGENT =
  `${AGENT_TOKEN}/1.0 (+https://paneldejugadorescadiz.github.io)` + (env.CONTACT ? ` ${env.CONTACT}` : '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- Supabase (REST) ---------- */

async function db(path, { method = 'GET', body, headers = {} } = {}) {
  const auth = KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {};
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, ...auth, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------- robots.txt ---------- */

const robotsCache = new Map();

async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const res = await fetch(`${origin}/robots.txt`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let rules;
  if (res.status === 404) rules = [];
  else if (res.ok) rules = parseRobots(await res.text(), AGENT_TOKEN);
  else throw Object.assign(new Error(`robots.txt respondió ${res.status}`), { blocked: true });
  robotsCache.set(origin, rules);
  return rules;
}

/* ---------- Una ficha ---------- */

const CHALLENGE = /just a moment|cf-chl|challenge-platform|attention required|enable javascript and cookies/i;

// Devuelve { status: 'done'|'skipped'|'failed', reason, note?, snippet?, blocked? }
async function processOne(row) {
  let url;
  try {
    url = new URL(row.url);
  } catch {
    return { status: 'skipped', reason: 'url_no_valida' };
  }
  if (url.protocol !== 'https:' && !(ALLOW_HTTP && url.protocol === 'http:')) {
    return { status: 'skipped', reason: 'solo_https' };
  }
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    return { status: 'skipped', reason: 'host_no_permitido' };
  }
  const sourceId = sourceIdFromUrl(row.url);
  if (!sourceId) return { status: 'skipped', reason: 'url_sin_identificador' };

  const rules = await robotsFor(url.origin);
  if (!isAllowed(rules, url.pathname + url.search)) {
    return { status: 'skipped', reason: 'bloqueada_por_robots' };
  }

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

  if (!ALLOWED_HOSTS.includes(new URL(res.url).hostname)) {
    return { status: 'failed', reason: 'redireccion_a_otro_host', note: `redirección a ${new URL(res.url).hostname}` };
  }
  if ([403, 429, 503].includes(res.status)) {
    return { status: 'failed', reason: `bloqueado_${res.status}`, note: `HTTP ${res.status}`, blocked: true, retryable: true };
  }
  if (res.status === 404 || res.status === 410) {
    return { status: 'skipped', reason: 'no_encontrada', note: `HTTP ${res.status}` };
  }
  if (!res.ok) {
    return { status: 'failed', reason: `http_${res.status}`, note: `HTTP ${res.status}`, retryable: true };
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !/html/i.test(contentType)) {
    return { status: 'failed', reason: 'no_es_html', note: contentType.slice(0, 60) };
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return { status: 'failed', reason: 'demasiado_grande' };
  const { text, charset } = decodeBody(buffer, contentType);

  const parsed = parseFicha(text, res.url, { allowHttp: ALLOW_HTTP });

  if (parsed.errors.includes('no_se_encuentran_campos') && CHALLENGE.test(text.slice(0, 8000))) {
    return { status: 'failed', reason: 'desafio_cloudflare', note: 'la web pide verificación', blocked: true, retryable: true };
  }
  if (!parsed.ok) {
    return {
      status: 'failed',
      reason: parsed.errors[0],
      note: `${parsed.errors.join(', ')} (charset ${charset}, ${parsed.diagnostics.lineCount} líneas, campos: ${parsed.diagnostics.labels.join(',') || 'ninguno'})`,
      snippet: parsed.preview,
    };
  }

  // El panel es solo de chicos: se descartan las fichas de equipos o categorías femeninas.
  const { club, category } = parsed.fields;
  if (/femenin|\bfem\b|\(f\)/i.test(`${category ?? ''} ${club ?? ''}`)) {
    return { status: 'skipped', reason: 'femenino', note: 'categoría o club femenino' };
  }

  const { birth_year: year } = parsed.fields;
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { status: 'skipped', reason: 'fuera_de_rango', note: `año ${year}` };
  }

  await db('players?on_conflict=source_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { source_id: sourceId, source_url: row.url, ...parsed.fields, updated_at: new Date().toISOString() },
  });

  const filled = Object.entries(parsed.fields).filter(([, v]) => v != null).map(([k]) => k);
  const warn = parsed.warnings.length ? `; avisos: ${parsed.warnings.join(', ')}` : '';
  return {
    status: 'done',
    reason: 'guardada',
    note: `año ${year}; campos: ${filled.join(',')}; foto: ${parsed.diagnostics.photoStrategy}${warn}`,
    snippet: null,
  };
}

/* ---------- Ejecución ---------- */

const counts = new Map();
const bump = (status, reason) => {
  const key = `${status}: ${reason}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

async function writeSummary(extra) {
  const lines = [...counts.entries()].sort().map(([k, n]) => `${k} → ${n}`);
  const text = [`Resumen: ${lines.join(' | ') || 'sin fichas procesadas'}`, extra].filter(Boolean).join('\n');
  console.log(`\n${text}`);
  if (env.GITHUB_STEP_SUMMARY) {
    const table = ['| Resultado | Fichas |', '| --- | --- |', ...[...counts.entries()].sort().map(([k, n]) => `| ${k} | ${n} |`)];
    await appendFile(env.GITHUB_STEP_SUMMARY, `## Bot de extracción\n\n${table.join('\n')}\n\n${extra ?? ''}\n`);
  }
}

const rows = await db(
  `scrape_queue?select=id,url,attempts&status=eq.pending&attempts=lt.${MAX_ATTEMPTS}&order=id.asc&limit=${LIMIT}`,
);

if (!rows.length) {
  await writeSummary('No hay fichas pendientes en la cola.');
  process.exit(0);
}

console.log(`Procesando ${rows.length} ficha(s). Pausa entre peticiones: ${DELAY_MS} ms.`);

let failsInRow = 0;
let aborted = null;

for (const [index, row] of rows.entries()) {
  const label = `[${index + 1}/${rows.length}] ${sourceIdFromUrl(row.url) ?? `cola#${row.id}`}`;

  let result;
  try {
    result = await processOne(row);
  } catch (error) {
    result = {
      status: 'failed',
      reason: error.blocked ? 'robots_no_disponible' : 'error_inesperado',
      note: String(error.message).slice(0, 300),
      blocked: Boolean(error.blocked),
      retryable: Boolean(error.blocked),
    };
  }

  bump(result.status, result.reason);
  console.log(`${label} → ${result.status}: ${result.reason}${result.note ? ` (${result.note})` : ''}`);

  // Un bloqueo o un fallo de red no condena la ficha: vuelve a la cola hasta agotar los intentos.
  const attempts = row.attempts + 1;
  const queueStatus = result.retryable && attempts < MAX_ATTEMPTS ? 'pending' : result.status;

  try {
    await db(`scrape_queue?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: {
        status: queueStatus,
        attempts,
        note: result.note ?? result.reason,
        snippet: result.snippet ?? null,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(`No se pudo actualizar la cola: ${error.message}`);
    aborted = 'no se puede escribir en Supabase';
    break;
  }

  if (result.blocked) {
    aborted = `la web ha bloqueado al bot (${result.reason}); se detiene la ejecución`;
    break;
  }
  failsInRow = result.status === 'failed' ? failsInRow + 1 : 0;
  if (failsInRow >= MAX_FAILS_IN_ROW) {
    aborted = `${MAX_FAILS_IN_ROW} fallos seguidos; se detiene la ejecución`;
    break;
  }

  if (index < rows.length - 1 && result.status !== 'skipped') await sleep(DELAY_MS);
}

await writeSummary(aborted ? `⚠️ ${aborted}.` : null);

const failed = [...counts.keys()].some((k) => k.startsWith('failed'));
process.exit(aborted || failed ? 1 : 0);
