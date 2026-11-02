// Página principal. Los datos solo se piden a Supabase con una sesión iniciada,
// y la base de datos solo los entrega a cuentas con permiso para verlos.
import { supabase, getAccess, onSession, signIn, signOut, setStatus } from './auth.js';

const PAGE_SIZE = 50;
const FETCH_SIZE = 1000;
const COLUMNS = 'id,full_name,birth_year,club,category,position,season,source_url,updated_at';

const $ = (id) => document.getElementById(id);

const els = {
  form: $('search-form'),
  q: $('q'),
  controls: $('controls'),
  years: $('years'),
  club: $('club'),
  count: $('count'),
  rows: $('rows'),
  empty: $('empty'),
  emptyText: $('empty-text'),
  reset: $('reset'),
  more: $('more'),
  updated: $('updated'),
  logout: $('logout'),
};

const views = {
  loading: $('view-loading'),
  login: $('view-login'),
  noaccess: $('view-noaccess'),
  app: $('view-app'),
};

const state = { all: [], filtered: [], shown: 0, year: '', userId: null };

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  els.form.hidden = name !== 'app';
  els.logout.hidden = name === 'login' || name === 'loading';
}

const normalize = (value) =>
  (value ?? '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== '') node.textContent = text;
  return node;
}

/* ---------- Datos ---------- */

async function fetchAllPlayers() {
  const players = [];
  for (let from = 0; ; from += FETCH_SIZE) {
    const { data, error } = await supabase
      .from('players')
      .select(COLUMNS)
      .order('id', { ascending: true })
      .range(from, from + FETCH_SIZE - 1);
    if (error) throw error;
    players.push(...data);
    if (data.length < FETCH_SIZE) break;
  }
  return players;
}

/* ---------- Pintado ---------- */

function playerCard(p) {
  const li = el('li', 'player');
  li.append(el('div', 'player-year', p.birth_year ?? '—'));

  const main = el('div', 'player-main');
  main.append(el('h2', 'player-name', p.full_name));
  if (p.club) main.append(el('p', 'player-club', p.club));

  const tags = [p.category, p.position, p.season].filter(Boolean);
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
      ? 'Aún no hay jugadores cargados.'
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
  const options = [
    ['', 'Todos', state.all.length],
    ...years.map((y) => [String(y), String(y), counts.get(y)]),
  ];

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
  els.club.replaceChildren(new Option('Todos los clubes', ''));
  for (const club of clubs) els.club.append(new Option(club, club));
}

function showUpdated(players) {
  els.updated.textContent = '';
  const latest = players.reduce((max, p) => (p.updated_at > max ? p.updated_at : max), '');
  const date = new Date(latest);
  if (!latest || Number.isNaN(date.getTime())) return;
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

async function loadPlayers() {
  const players = await fetchAllPlayers();
  state.all = players.sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es'));

  const counts = new Map();
  for (const p of state.all) {
    if (p.birth_year != null) counts.set(p.birth_year, (counts.get(p.birth_year) ?? 0) + 1);
  }
  const years = [...counts.keys()].sort((a, b) => a - b);
  const clubs = [...new Set(state.all.map((p) => p.club).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );

  state.year = '';
  buildYearChips(years, counts);
  fillClubs(clubs);
  showUpdated(state.all);

  // Sin datos no tiene sentido enseñar filtros.
  els.controls.hidden = state.all.length === 0;
  applyFilters();
}

// Al cerrar sesión o perder el permiso no se deja ningún dato en pantalla ni en memoria.
function clearData() {
  state.all = [];
  state.filtered = [];
  state.shown = 0;
  state.year = '';
  state.userId = null;
  els.rows.replaceChildren();
  els.years.replaceChildren();
  els.club.replaceChildren(new Option('Todos los clubes', ''));
  els.q.value = '';
  els.updated.textContent = '';
}

/* ---------- Sesión ---------- */

let routeSeq = 0;

async function route(session) {
  const seq = ++routeSeq;

  if (!session) {
    clearData();
    show('login');
    return;
  }

  const access = await getAccess(session.user.id);
  if (seq !== routeSeq) return;

  if (!access?.can_view) {
    clearData();
    show('noaccess');
    return;
  }

  if (state.userId !== session.user.id) {
    show('loading');
    try {
      await loadPlayers();
    } catch (error) {
      console.error(error);
      if (seq !== routeSeq) return;
      els.controls.hidden = true;
      els.rows.replaceChildren();
      els.empty.hidden = true;
      els.more.hidden = true;
      els.count.hidden = false;
      els.count.textContent = 'No se pudieron cargar los datos. Recarga la página en unos minutos.';
      show('app');
      return;
    }
    if (seq !== routeSeq) return;
    state.userId = session.user.id;
  }
  show('app');
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('login-status');
  setStatus(status, 'Entrando…');
  const { error } = await signIn($('email').value.trim(), $('password').value);
  if (error) {
    setStatus(status, 'Correo o contraseña incorrectos.', 'error');
  } else {
    setStatus(status, '');
    $('password').value = '';
  }
});

els.form.addEventListener('submit', (event) => event.preventDefault());
els.q.addEventListener('input', applyFilters);
els.club.addEventListener('change', applyFilters);
els.years.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (chip) setYear(chip.dataset.year);
});
els.more.addEventListener('click', showMore);
els.reset.addEventListener('click', resetFilters);
els.logout.addEventListener('click', () => signOut());
$('logout-noaccess').addEventListener('click', () => signOut());

onSession((_event, session) => route(session));
