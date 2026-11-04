// Lee la página de un equipo (plantilla) de La Preferente: provincia, jugadores y equipos enlazados.
import { decodeEntities, htmlToLines, norm } from './ficha.mjs';

const textOf = (html) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseTeam(html, pageUrl) {
  // La web usa enlaces relativos a la raíz del sitio, no a la carpeta de la página.
  const base = `${new URL(pageUrl).origin}/`;
  const lines = htmlToLines(html);
  const title = textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');

  // "Sanlúcar De Barrameda (Cádiz) - Fundado en 1962"
  let province = null;
  for (const line of lines) {
    const match = /\(([^)]{2,40})\)\s*-\s*Fundado/i.exec(line);
    if (match) {
      province = match[1].trim();
      break;
    }
  }

  const players = [];
  const seen = new Set();
  const chunks = html.split(/<tr\b[^>]*font-size:\s*11px[^>]*>/i).slice(1);
  for (const chunk of chunks) {
    const row = chunk.split(/<\/tr>/i)[0];
    const href = /href="([^"]*\bJ\d+[^"]*\.html)"/i.exec(row)?.[1];
    if (!href) continue;
    let url;
    try {
      url = new URL(decodeEntities(href), base);
    } catch {
      continue;
    }
    // Se normaliza a la forma canónica /J123/club/jugador.html (sin el código de competición).
    url.pathname = url.pathname.replace(/\/(J\d+)C\d+\//i, '/$1/');
    const key = url.pathname.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]));
    const nameIdx = cells.findIndex((c, i) => i >= 1 && c && row.includes(href) && c.length > 1 && !/^\d+$/.test(c));
    const rest = cells.slice(nameIdx + 2);
    const ageText = rest.find((c) => /^(\d{1,2}|-)$/.test(c));
    players.push({
      url: url.toString(),
      position: cells[nameIdx + 1] || null,
      age: ageText && ageText !== '-' ? Number(ageText) : null,
    });
  }

  const own = /\/(E\d+C\d+)/i.exec(new URL(pageUrl).pathname)?.[1]?.toUpperCase();
  const teams = new Map();
  for (const m of html.matchAll(/href="(E(\d+)C(\d+)(?:-\d+)?\/([^"#?]+))"/gi)) {
    const id = `E${m[2]}C${m[3]}`;
    if (id === own || teams.has(id)) continue;
    try {
      teams.set(id, new URL(decodeEntities(`${id}/${m[4]}`), base).toString());
    } catch {
      /* enlace roto: se ignora */
    }
  }

  return {
    ok: players.length > 0 && Boolean(province),
    title,
    province,
    isFemale: /femenin/i.test(title) || /femenin/i.test(new URL(pageUrl).pathname),
    players,
    teams: [...teams.values()],
  };
}

export const sameProvince = (province, wanted) => norm(province) === norm(wanted);
