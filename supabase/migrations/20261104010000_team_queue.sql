-- Cola de equipos para el bot que recorre plantillas. Solo la usa el bot (clave de servicio).
create table public.team_queue (
  id bigint generated always as identity primary key,
  url text not null unique,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'failed')),
  attempts smallint not null default 0,
  note text,
  province text,
  players_queued integer,
  snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_queue enable row level security;
revoke all on public.team_queue from anon, authenticated;
