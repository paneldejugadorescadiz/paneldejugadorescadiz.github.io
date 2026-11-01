// Edge Function: lanza el workflow de GitHub que regenera las listas JSON.
// Solo la puede ejecutar un usuario con app_metadata.role = 'admin'.
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   GITHUB_TOKEN  token de GitHub con permiso "Actions: write" sobre el repositorio
// Opcionales:
//   GITHUB_REPO      por defecto paneldejugadorescadiz/paneldejugadorescadiz.github.io
//   ALLOWED_ORIGIN   por defecto https://paneldejugadorescadiz.github.io
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGIN =
  Deno.env.get('ALLOWED_ORIGIN') ?? 'https://paneldejugadorescadiz.github.io';
const GITHUB_REPO =
  Deno.env.get('GITHUB_REPO') ?? 'paneldejugadorescadiz/paneldejugadorescadiz.github.io';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'No has iniciado sesión' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json({ error: 'Sesión no válida' }, 401);
  if (data.user.app_metadata?.role !== 'admin') {
    return json({ error: 'Solo los administradores pueden hacer esto' }, 403);
  }

  const githubToken = Deno.env.get('GITHUB_TOKEN');
  if (!githubToken) {
    return json({ error: 'Falta el secreto GITHUB_TOKEN en Supabase' }, 500);
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/regenerate-lists.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'paneldejugadorescadiz-admin',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  if (response.status !== 204) {
    console.error('GitHub respondió', response.status, await response.text());
    return json({ error: `GitHub rechazó la solicitud (${response.status})` }, 502);
  }

  return json({ ok: true });
});
