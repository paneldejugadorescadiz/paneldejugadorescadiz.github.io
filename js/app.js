// Página principal. Los datos solo se piden a Supabase con una sesión iniciada,
// y la base de datos solo los entrega a cuentas con permiso para verlos.
import { supabase, getAccess, onSession, signIn, signOut, setStatus } from './auth.js';

const PAGE_SIZE = 50;
const FETCH_SIZE = 1000;
const COLUMNS = 'id,full_name,birth_year,club,category,position,position_detail,season,source_url,updated_at';

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
  views: $('view-switch'),
  favCount: $('fav-count'),
};

const views = {
  loading: $('view-loading'),
  login: $('view-login'),
  noaccess: $('view-noaccess'),
  app: $('view-app'),
};

const state = { all: [], filtered: [], shown: 0, year: '', userId: null, favs: new Set(), view: 'all' };

const POSITION_ORDER = ['portero', 'defensa', 'lateral', 'central', 'centrocamp', 'medio', 'pivote', 'mediapunta', 'extremo', 'delantero'];
const positionRank = (name) => {
  const n = normalize(name);
  const i = POSITION_ORDER.findIndex((key) => n.includes(key));
  return i < 0 ? POSITION_ORDER.length : i;
};

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

async function fetchFavorites() {
  const { data, error } = await supabase.from('favorites').select('player_id');
  if (error) throw error;
  return new Set(data.map((row) => row.player_id));
}

async function toggleFavorite(player, button) {
  const wanted = !state.favs.has(player.id);
  button.disabled = true;
  const query = wanted
    ? supabase.from('favorites').insert({ player_id: player.id })
    : supabase.from('favorites').delete().eq('player_id', player.id).eq('user_id', state.userId);
  const { error } = await query;
  button.disabled = false;
  if (error) {
    console.error(error);
    els.count.textContent = 'No se pudo guardar el favorito. Inténtalo de nuevo.';
    return;
  }
  if (wanted) state.favs.add(player.id);
  else state.favs.delete(player.id);
  els.favCount.textContent = state.favs.size;
  if (state.view === 'favs') applyFilters();
  else setStar(button, player, wanted);
}

function setStar(button, player, on) {
  button.textContent = on ? '★' : '☆';
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', `${on ? 'Quitar de' : 'Añadir a'} favoritos a ${player.full_name}`);
}

/* ---------- Pintado ---------- */

function playerCard(p) {
  const li = el('li', 'player');
  li.append(el('div', 'player-year', p.birth_year ?? '—'));

  const main = el('div', 'player-main');
  main.append(el('h2', 'player-name', p.full_name));
  if (p.club) main.append(el('p', 'player-club', p.club));

  const tags = [p.category, p.position, p.position_detail, p.season].filter(Boolean);
  if (tags.length) {
    const list = el('div', 'tags');
    for (const tag of tags) list.append(el('span', 'tag', tag));
    main.append(list);
  }
  li.append(main);

  const star = el('button', 'star');
  star.type = 'button';
  setStar(star, p, state.favs.has(p.id));
  star.addEventListener('click', () => toggleFavorite(p, star));
  li.append(star);

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
      : state.view === 'favs' && state.favs.size === 0
        ? 'Aún no tienes favoritos. Pulsa la estrella ☆ de un jugador para añadirlo.'
        : 'Ningún jugador coincide con esa búsqueda.';
    els.reset.hidden = noData || !hasActiveFilters();
  }

  els.more.hidden = state.shown >= total;
}

function renderFavorites() {
  els.rows.replaceChildren();
  const groups = new Map();
  for (const p of state.filtered) {
    const key = p.position || 'Sin posición';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const names = [...groups.keys()].sort(
    (a, b) => positionRank(a) - positionRank(b) || a.localeCompare(b, 'es'),
  );
  for (const name of names) {
    const heading = el('li', 'group-title', `${name} · ${groups.get(name).length}`);
    els.rows.append(heading);
    appendCards(groups.get(name));
  }
  state.shown = state.filtered.length;
  updateStatus();
}

function render() {
  if (state.view === 'favs') return renderFavorites();
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
      (!club || p.club === club) &&
      (state.view === 'all' || state.favs.has(p.id)),
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

function setViewButtons() {
  for (const btn of els.views.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
  }
}

function setView(view) {
  state.view = view;
  setViewButtons();
  applyFilters();
}

function resetFilters() {
  els.q.value = '';
  els.club.value = '';
  setYear('');
  els.q.focus();
}

async function loadPlayers() {
  const [players, favs] = await Promise.all([fetchAllPlayers(), fetchFavorites()]);
  state.favs = favs;
  state.view = 'all';
  setViewButtons();
  els.favCount.textContent = favs.size;
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
  state.favs = new Set();
  state.view = 'all';
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
els.views.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-view]');
  if (btn) setView(btn.dataset.view);
});
els.more.addEventListener('click', showMore);
els.reset.addEventListener('click', resetFilters);
els.logout.addEventListener('click', () => signOut());
$('logout-noaccess').addEventListener('click', () => signOut());

onSession((_event, session) => route(session));
