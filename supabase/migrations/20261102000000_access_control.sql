-- Modelo de accesos: dos permisos independientes por cuenta (ver datos / administrador).
-- Las cuentas las crea el propietario en Supabase; nacen sin ningún permiso.

create schema if not exists private;

alter table public.players
  add column position text,
  add column photo_url text;

create table public.access (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  can_view boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.access enable row level security;

-- Las funciones leen la tabla, así que revocar un permiso surte efecto al instante.
create function private.can_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.can_view from public.access a where a.user_id = (select auth.uid())),
    false
  );
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.is_admin from public.access a where a.user_id = (select auth.uid())),
    false
  );
$$;

revoke all on function private.can_view() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_view() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Cada cuenta nueva aparece en "access" sin permisos.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.access (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Cuentas existentes: sin permisos, salvo el administrador inicial.
insert into public.access (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

update public.access
set can_view = true, is_admin = true
where user_id = '9105e16d-6a50-4ad5-99c8-738b8016d35c';

-- Tabla de accesos: cada cuenta ve su fila; un administrador ve y edita todas,
-- pero solo las dos columnas de permisos.
revoke all on public.access from anon, authenticated;
grant select on public.access to authenticated;
grant update (can_view, is_admin) on public.access to authenticated;

create policy access_read_own on public.access
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy access_admin_read on public.access
  for select to authenticated
  using ((select private.is_admin()));

create policy access_admin_update on public.access
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Jugadores: sin acceso anónimo; lee quien tenga permiso; escribe solo un administrador.
drop policy if exists players_public_read on public.players;
drop policy if exists players_admin_insert on public.players;
drop policy if exists players_admin_update on public.players;
drop policy if exists players_admin_delete on public.players;

revoke all on public.players from anon;

create policy players_viewer_read on public.players
  for select to authenticated
  using ((select private.can_view()));

create policy players_admin_insert on public.players
  for insert to authenticated
  with check ((select private.is_admin()));

create policy players_admin_update on public.players
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy players_admin_delete on public.players
  for delete to authenticated
  using ((select private.is_admin()));

-- Cola de fichas del bot: solo la ve un administrador; el bot escribe con la clave de servicio.
create table public.scrape_queue (
  id bigint generated always as identity primary key,
  url text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'skipped', 'failed')),
  attempts smallint not null default 0,
  note text,
  snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scrape_queue_status_idx on public.scrape_queue (status, id);

alter table public.scrape_queue enable row level security;
revoke all on public.scrape_queue from anon, authenticated;
grant select on public.scrape_queue to authenticated;

create policy scrape_queue_admin_read on public.scrape_queue
  for select to authenticated
  using ((select private.is_admin()));

-- Consulta inocua para mantener el proyecto activo sin exponer datos.
create function public.ping()
returns integer
language sql
stable
as $$ select 1 $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
