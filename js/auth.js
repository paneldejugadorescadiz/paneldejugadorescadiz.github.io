// Cliente de Supabase y utilidades de sesión compartidas por la web y el panel de administrador.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Permisos de la cuenta: { can_view, is_admin }. Devuelve null si no se pueden leer.
export async function getAccess(userId) {
  const { data, error } = await supabase
    .from('access')
    .select('can_view,is_admin')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

// supabase-js avisa de INITIAL_SESSION al suscribirse. Dentro del callback no se debe
// llamar a la API de Supabase, así que se sale de él antes de ejecutar nada.
export function onSession(callback) {
  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => callback(event, session), 0);
  });
}

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();

export function setStatus(el, message, kind = '') {
  el.textContent = message;
  el.className = `status ${kind}`.trim();
}
