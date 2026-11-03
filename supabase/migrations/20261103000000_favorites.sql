-- Favoritos: cada cuenta ve y modifica solo los suyos, y solo si tiene permiso para ver los datos.
create table public.favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

create index favorites_player_idx on public.favorites (player_id);

alter table public.favorites enable row level security;

revoke all on public.favorites from anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;

create policy favorites_select_own on public.favorites
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.can_view()));

create policy favorites_insert_own on public.favorites
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.can_view()));

create policy favorites_delete_own on public.favorites
  for delete to authenticated
  using (user_id = (select auth.uid()));
