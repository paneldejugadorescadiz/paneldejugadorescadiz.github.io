// Página pública: lee los JSON generados (data/players.json y data/meta.json).
// No necesita Supabase: si la base de datos está pausada, la web sigue funcionando.

const PAGE_SIZE = 50;

const els = {
  form: document.getElementById('search-form'),
  q: document.getElementById('q'),
  years: document.getElementById('years'),
  club: document.getElementById('club'),
  count: document.getElementById('count'),
  rows: document.getElementById('rows'),
  empty: document.getElementById('empty'),
  emptyText: document.getElementById('empty-text'),
  reset: document.getElementById('reset'),
  more: document.getElementById('more'),
  updated: document.getElementById('updated'),
};

const state = { all: [], filtered: [], shown: 0, year: '' };

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== '') node.textContent = text;
  return node;
}

function playerCard(p) {
  const li = el('li', 'player');
  li.append(el('div', 'player-year', p.birth_year ?? '—'));

  const main = el('div', 'player-main');
  main.append(el('h2', 'player-name', p.full_name));
  if (p.club) main.append(el('p', 'player-club', p.club));

  const tags = [p.category, p.season].filter(Boolean);
  if (tags.length) {
    const list = el('div', 'tags');
    for (const tag of tags) list.append(el('span', 'tag', tag));
    main.append(list);
  }
  li.append(main);

  if (typeof p.source_url === 'string' && /^https:\/\//i.test(p.source_url)) {
    const link = el('a', 'player-link', 'Ver ficha');
    link.href = p.source_url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    link.setAttribute('aria-label', `Ver ficha de ${p.full_name} en La Preferente`);
    li.append(link);
  }
  return li;
}

function appendCards(players) {
  const fragment = document.createDocumentFragment();
  for (const p of players) fragment.append(playerCard(p));
  els.rows.append(fragment);
}

function hasActiveFilters() {
  return Boolean(els.q.value.trim() || state.year || els.club.value);
}

function updateStatus() {
  const total = state.filtered.length;
  const noData = state.all.length === 0;

  els.count.textContent = noData
    ? ''
    : total === 1
      ? '1 jugador'
      : `${total.toLocaleString('es-ES')} jugadores`;
  els.count.hidden = noData;

  els.empty.hidden = total !== 0;
  if (total === 0) {
    els.emptyText.textContent = noData
      ? 'Aún no hay jugadores publicados. Vuelve pronto.'
      : 'Ningún jugador coincide con esa búsqueda.';
    els.reset.hidden = noData || !hasActiveFilters();
  }

  els.more.hidden = state.shown >= total;
}

function render() {
  els.rows.replaceChildren();
  state.shown = Math.min(PAGE_SIZE, state.filtered.length);
  appendCards(state.filtered.slice(0, state.shown));
  updateStatus();
}

function applyFilters() {
  const q = normalize(els.q.value);
  const club = els.club.value;

  state.filtered = state.all.filter(
    (p) =>
      (!q || normalize(p.full_name).includes(q)) &&
      (!state.year || String(p.birth_year) === state.year) &&
      (!club || p.club === club),
  );
  render();
}

function showMore() {
  const next = Math.min(state.shown + PAGE_SIZE, state.filtered.length);
  appendCards(state.filtered.slice(state.shown, next));
  state.shown = next;
  updateStatus();
}

function buildYearChips(years, counts) {
  els.years.replaceChildren();
  const options = [['', 'Todos', state.all.length], ...years.map((y) => [String(y), String(y), counts.get(y)])];

  for (const [value, label, count] of options) {
    const chip = el('button', 'chip');
    chip.type = 'button';
    chip.dataset.year = value;
    chip.setAttribute('aria-pressed', String(value === state.year));
    chip.append(label, ' ', el('small', '', count.toLocaleString('es-ES')));
    els.years.append(chip);
  }
}

function setYear(value) {
  state.year = value;
  for (const chip of els.years.children) {
    chip.setAttribute('aria-pressed', String(chip.dataset.year === value));
  }
  applyFilters();
}

function fillClubs(clubs) {
  for (const club of clubs) {
    const option = document.createElement('option');
    option.value = club;
    option.textContent = club;
    els.club.append(option);
  }
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

function resetFilters() {
  els.q.value = '';
  els.club.value = '';
  setYear('');
  els.q.focus();
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

    const counts = new Map();
    for (const p of state.all) {
      if (p.birth_year != null) counts.set(p.birth_year, (counts.get(p.birth_year) ?? 0) + 1);
    }
    const years = [...counts.keys()].sort((a, b) => a - b);
    const clubs = [...new Set(state.all.map((p) => p.club).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );

    buildYearChips(years, counts);
    fillClubs(clubs);
    showUpdated(meta);

    // Sin datos no tiene sentido enseñar filtros.
    document.getElementById('controls').hidden = state.all.length === 0;
    applyFilters();
  } catch (error) {
    console.error(error);
    els.count.textContent = 'No se pudieron cargar los datos. Recarga la página en unos minutos.';
  }
}

els.form.addEventListener('submit', (event) => event.preventDefault());
els.q.addEventListener('input', applyFilters);
els.club.addEventListener('change', applyFilters);
els.years.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) setYear(chip.dataset.year);
});
els.more.addEventListener('click', showMore);
els.reset.addEventListener('click', resetFilters);

init();
