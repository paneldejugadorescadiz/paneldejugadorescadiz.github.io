// Genera las listas JSON de la web a partir de la tabla "players" de Supabase.
//
// Uso:  SUPABASE_URL=... SUPABASE_KEY=... node scripts/export-players.mjs
// Solo necesita la clave pública (publishable): la tabla es de lectura pública.
//
// Salida (carpeta data/):
//   players.json      todos los jugadores
//   by-year/AAAA.json un archivo por año de nacimiento
//   meta.json         fecha de generación y totales
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Faltan las variables SUPABASE_URL y SUPABASE_KEY.');
  process.exit(1);
}

const PAGE_SIZE = 1000;
const COLUMNS = [
  'id',
  'source_id',
  'full_name',
  'birth_year',
  'club',
  'category',
  'season',
  'source_url',
  'stats',
].join(',');

const dataDir =
  process.env.DATA_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function fetchAllPlayers() {
  const players = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await fetch(`${url}/rest/v1/players?select=${COLUMNS}&order=id.asc`, {
      headers: {
        apikey: key,
        'Range-Unit': 'items',
        Range: `${from}-${from + PAGE_SIZE - 1}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
    }
    const page = await res.json();
    players.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return players;
}

const write = (file, value) => writeFile(file, `${JSON.stringify(value)}\n`, 'utf8');

const players = await fetchAllPlayers();
players.sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es'));

const byYear = new Map();
for (const player of players) {
  if (player.birth_year == null) continue;
  if (!byYear.has(player.birth_year)) byYear.set(player.birth_year, []);
  byYear.get(player.birth_year).push(player);
}

await mkdir(dataDir, { recursive: true });
await rm(path.join(dataDir, 'by-year'), { recursive: true, force: true });
await mkdir(path.join(dataDir, 'by-year'), { recursive: true });

await write(path.join(dataDir, 'players.json'), players);
for (const [year, list] of byYear) {
  await write(path.join(dataDir, 'by-year', `${year}.json`), list);
}

const meta = {
  generatedAt: new Date().toISOString(),
  total: players.length,
  byYear: Object.fromEntries(
    [...byYear.entries()].sort(([a], [b]) => a - b).map(([year, list]) => [year, list.length]),
  ),
};
await write(path.join(dataDir, 'meta.json'), meta);

console.log(`Listas generadas: ${players.length} jugadores, ${byYear.size} años.`);
