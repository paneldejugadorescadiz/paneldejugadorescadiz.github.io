import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const views = {
  login: $('view-login'),
  denied: $('view-denied'),
  panel: $('view-panel'),
};

const POLL_EVERY_MS = 10_000;
const POLL_MAX_TRIES = 18; // unos 3 minutos

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function setStatus(el, message, kind = '') {
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}

// El rol se guarda en app_metadata, que solo se puede modificar desde el servidor.
const isAdmin = (session) => session?.user?.app_metadata?.role === 'admin';

async function getMeta() {
  try {
    const res = await fetch(`data/meta.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'desconocida';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(date);
}

async function refreshMeta() {
  const meta = await getMeta();
  $('meta-info').textContent = meta?.generatedAt
    ? `Últimas listas: ${formatDate(meta.generatedAt)} · ${meta.total ?? 0} jugadores.`
    : 'Todavía no se han generado listas.';
  return meta;
}

function route(session) {
  if (!session) {
    show('login');
  } else if (isAdmin(session)) {
    $('who').textContent = session.user.email ?? '';
    show('panel');
    refreshMeta();
  } else {
    show('denied');
  }
}

async function functionErrorMessage(error) {
  try {
    const body = await error.context.json();
    if (body?.error) return body.error;
  } catch {
    // la respuesta no era JSON
  }
  return error.message;
}

async function regenerate() {
  const button = $('regenerate');
  const status = $('panel-status');
  button.disabled = true;
  setStatus(status, 'Lanzando la regeneración…');

  const before = (await getMeta())?.generatedAt ?? null;
  const { error } = await supabase.functions.invoke('regenerate-lists');

  if (error) {
    setStatus(status, `No se pudo lanzar: ${await functionErrorMessage(error)}`, 'error');
    button.disabled = false;
    return;
  }

  setStatus(status, 'Regeneración lanzada. Esperando a que se publiquen las listas (1–3 min)…');

  for (let i = 0; i < POLL_MAX_TRIES; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
    const meta = await getMeta();
    if (meta?.generatedAt && meta.generatedAt !== before) {
      await refreshMeta();
      setStatus(status, `Listas actualizadas: ${meta.total ?? 0} jugadores.`, 'ok');
      button.disabled = false;
      return;
    }
  }

  setStatus(
    status,
    'Sigue en curso. Revisa la pestaña Actions del repositorio de GitHub.',
  );
  button.disabled = false;
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('login-status');
  setStatus(status, 'Entrando…');
  const { error } = await supabase.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value,
  });
  if (error) {
    setStatus(status, 'Correo o contraseña incorrectos.', 'error');
  } else {
    setStatus(status, '');
    $('password').value = '';
  }
});

$('regenerate').addEventListener('click', regenerate);
$('logout').addEventListener('click', () => supabase.auth.signOut());
$('logout-denied').addEventListener('click', () => supabase.auth.signOut());

supabase.auth.onAuthStateChange((_event, session) => route(session));
supabase.auth.getSession().then(({ data }) => route(data.session));
