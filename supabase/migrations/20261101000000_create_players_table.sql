-- Tabla de jugadores con lectura pública y escritura solo para administradores.
-- El rol de administrador se guarda en app_metadata (solo editable desde el servidor).

create table public.players (
  id bigint generated always as identity primary key,
  source_id text unique,
  full_name text not null,
  birth_year smallint,
  club text,
  category text,
  season text,
  source_url text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index players_birth_year_idx on public.players (birth_year);
create index players_club_idx on public.players (club);

alter table public.players enable row level security;

create policy players_public_read on public.players
  for select
  to anon, authenticated
  using (true);

create policy players_admin_insert on public.players
  for insert
  to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy players_admin_update on public.players
  for update
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create policy players_admin_delete on public.players
  for delete
  to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
