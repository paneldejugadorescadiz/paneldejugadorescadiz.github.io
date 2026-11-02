// Panel de administrador: activar o quitar permisos a las cuentas.
// Las cuentas no se crean aquí: se crean en Supabase y llegan sin ningún permiso.
import { supabase, getAccess, onSession, signIn, signOut, setStatus } from './auth.js';

const $ = (id) => document.getElementById(id);

const views = {
  loading: $('view-loading'),
  login: $('view-login'),
  denied: $('view-denied'),
  panel: $('view-panel'),
};

const PERMISSIONS = [
  { field: 'can_view', label: 'Ver los datos' },
  { field: 'is_admin', label: 'Administrador' },
];

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== '') node.textContent = text;
  return node;
}

/* ---------- Cuentas ---------- */

function accountRow(account, myId) {
  const isMe = account.user_id === myId;
  const li = el('li', 'account');

  const who = el('div', 'account-email', account.email ?? '(sin correo)');
  if (isMe) who.append(el('small', '', 'Esta es tu cuenta'));
  else if (!account.can_view && !account.is_admin) who.append(el('small', '', 'Sin permisos todavía'));
  li.append(who);

  const switches = el('div', 'switches');
  for (const { field, label } of PERMISSIONS) {
    const wrapper = el('label', 'check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(account[field]);
    input.dataset.userId = account.user_id;
    input.dataset.field = field;
    input.dataset.email = account.email ?? '';
    input.dataset.label = label;

    // Evita que te quites a ti mismo el permiso de administrador y te quedes fuera.
    if (isMe && field === 'is_admin') {
      input.disabled = true;
      input.title = 'No puedes quitarte el permiso de administrador a ti mismo';
    }
    wrapper.append(input, label);
    switches.append(wrapper);
  }
  li.append(switches);
  return li;
}

async function loadAccounts(myId) {
  const status = $('panel-status');
  const list = $('accounts');
  setStatus(status, '');

  const { data, error } = await supabase
    .from('access')
    .select('user_id,email,can_view,is_admin,created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    list.replaceChildren();
    setStatus(status, 'No se pudieron cargar las cuentas. Recarga la página.', 'error');
    return;
  }

  list.replaceChildren(...data.map((account) => accountRow(account, myId)));
  $('accounts-empty').hidden = data.length !== 0;
}

async function onToggle(event) {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input || !input.dataset.userId) return;

  const { userId, field, email, label } = input.dataset;
  const wanted = input.checked;
  const status = $('panel-status');
  input.disabled = true;
  setStatus(status, 'Guardando…');

  // Si la política de seguridad no deja cambiarlo, Supabase no da error: devuelve 0 filas.
  const { data, error } = await supabase
    .from('access')
    .update({ [field]: wanted })
    .eq('user_id', userId)
    .select('user_id');

  input.disabled = false;

  if (error || !data || data.length !== 1) {
    console.error(error);
    input.checked = !wanted;
    setStatus(status, `No se pudo cambiar «${label}» de ${email}.`, 'error');
    return;
  }

  setStatus(status, `${wanted ? 'Activado' : 'Quitado'}: «${label}» de ${email}.`, 'ok');
  // Refresca la nota "Sin permisos todavía" de esa cuenta.
  const row = input.closest('.account');
  const checks = [...row.querySelectorAll('input[type="checkbox"]')];
  const small = row.querySelector('.account-email small');
  if (small && small.textContent === 'Sin permisos todavía' && checks.some((c) => c.checked)) {
    small.remove();
  }
}

/* ---------- Sesión ---------- */

let routeSeq = 0;

async function route(session) {
  const seq = ++routeSeq;

  if (!session) {
    $('accounts').replaceChildren();
    show('login');
    return;
  }

  const access = await getAccess(session.user.id);
  if (seq !== routeSeq) return;

  if (!access?.is_admin) {
    $('accounts').replaceChildren();
    show('denied');
    return;
  }

  $('who').textContent = session.user.email ?? '';
  show('panel');
  await loadAccounts(session.user.id);
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

$('accounts').addEventListener('change', onToggle);
$('logout').addEventListener('click', () => signOut());
$('logout-denied').addEventListener('click', () => signOut());

onSession((_event, session) => route(session));
