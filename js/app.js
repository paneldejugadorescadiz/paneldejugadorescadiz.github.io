// Página pública: lee los JSON generados (data/players.json y data/meta.json).
// No necesita Supabase: si la base de datos está pausada, la web sigue funcionando.

const PAGE_SIZE = 100;

const els = {
  q: document.getElementById('q'),
  year: document.getElementById('year'),
  club: document.getElementById('club'),
  count: document.getElementById('count'),
  rows: document.getElementById('rows'),
  empty: document.getElementById('empty'),
  more: document.getElementById('more'),
  updated: document.getElementById('updated'),
};

const state = { all: [], filtered: [], shown: 0 };

const normalize = (value) =>
  (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

async function getJSON(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    select.append(option);
  }
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text ?? '';
  return td;
}

function sourceCell(url) {
  const td = document.createElement('td');
  if (typeof url === 'string' && /^https:\/\//i.test(url)) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = 'Ver ficha';
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    td.append(a);
  }
  return td;
}

function appendRows(players) {
  const fragment = document.createDocumentFragment();
  for (const p of players) {
    const tr = document.createElement('tr');
    tr.append(
      cell(p.full_name),
      cell(p.birth_year),
      cell(p.club),
      cell(p.category),
      cell(p.season),
      sourceCell(p.source_url),
    );
    fragment.append(tr);
  }
  els.rows.append(fragment);
}

function render() {
  els.rows.replaceChildren();
  state.shown = Math.min(PAGE_SIZE, state.filtered.length);
  appendRows(state.filtered.slice(0, state.shown));
  updateFooterState();
}

function updateFooterState() {
  const total = state.filtered.length;
  els.count.textContent =
    total === 1 ? '1 jugador' : `${total.toLocaleString('es-ES')} jugadores`;
  els.empty.hidden = total !== 0 || state.all.length === 0;
  els.more.hidden = state.shown >= total;
}

function applyFilters() {
  const q = normalize(els.q.value);
  const year = els.year.value;
  const club = els.club.value;

  state.filtered = state.all.filter(
    (p) =>
      (!q || normalize(p.full_name).includes(q)) &&
      (!year || String(p.birth_year) === year) &&
      (!club || p.club === club),
  );
  render();
}

function showMore() {
  const next = Math.min(state.shown + PAGE_SIZE, state.filtered.length);
  appendRows(state.filtered.slice(state.shown, next));
  state.shown = next;
  updateFooterState();
}

function showUpdated(meta) {
  if (!meta?.generatedAt) return;
  const date = new Date(meta.generatedAt);
  if (Number.isNaN(date.getTime())) return;
  const formatted = new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(date);
  els.updated.textContent = `Última actualización: ${formatted}.`;
}

async function init() {
  try {
    const [players, meta] = await Promise.all([
      getJSON('data/players.json'),
      getJSON('data/meta.json').catch(() => null),
    ]);

    state.all = [...players].sort((a, b) =>
      (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es'),
    );

    const years = [...new Set(state.all.map((p) => p.birth_year).filter(Boolean))].sort();
    const clubs = [...new Set(state.all.map((p) => p.club).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
    fillSelect(els.year, years);
    fillSelect(els.club, clubs);
    showUpdated(meta);

    if (state.all.length === 0) {
      els.count.textContent = 'Todavía no hay datos publicados.';
      els.more.hidden = true;
      return;
    }
    applyFilters();
  } catch (error) {
    console.error(error);
    els.count.textContent = 'No se pudieron cargar los datos. Inténtalo de nuevo más tarde.';
  }
}

els.q.addEventListener('input', applyFilters);
els.year.addEventListener('change', applyFilters);
els.club.addEventListener('change', applyFilters);
els.more.addEventListener('click', showMore);

init();
