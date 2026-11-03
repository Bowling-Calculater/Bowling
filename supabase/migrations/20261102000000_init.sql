-- Pot of Gold scorer: tables, photo bucket, RLS, realtime.
-- Anyone with the anon/publishable key can READ. Nobody but the Edge Function (service role) can WRITE.

create table if not exists public.nights (
  night_date date primary key,              -- league night (local date, e.g. 2026-11-03)
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id bigint generated always as identity primary key,
  night_date date not null references public.nights(night_date) on delete cascade,
  game_no smallint not null check (game_no between 1 and 3),
  created_at timestamptz not null default now(),
  unique (night_date, game_no)
);

-- One row per photo (one team's lane screen for one game).
create table if not exists public.reads (
  id uuid primary key default gen_random_uuid(),
  game_id bigint not null references public.games(id) on delete cascade,
  night_date date not null references public.nights(night_date) on delete cascade, -- denormalized for realtime filter
  game_no smallint not null check (game_no between 1 and 3),
  photo_path text not null,                 -- object path in storage bucket "screens"
  status text not null default 'reading' check (status in ('reading', 'done', 'error')),
  data jsonb,                               -- current numbers (Gemini read, plus any manual fixes)
  model_data jsonb,                         -- untouched Gemini output, for audit
  model text,
  error text,
  edits jsonb not null default '[]'::jsonb, -- [{at, path, from, to}]
  discarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reads_night_idx on public.reads (night_date, game_no, created_at);

alter table public.nights enable row level security;
alter table public.games  enable row level security;
alter table public.reads  enable row level security;

drop policy if exists "anon read nights" on public.nights;
drop policy if exists "anon read games"  on public.games;
drop policy if exists "anon read reads"  on public.reads;
create policy "anon read nights" on public.nights for select to anon, authenticated using (true);
create policy "anon read games"  on public.games  for select to anon, authenticated using (true);
create policy "anon read reads"  on public.reads  for select to anon, authenticated using (true);
-- No insert/update/delete policies: with RLS on, only the service role (Edge Function) can write.
revoke insert, update, delete, truncate on public.nights, public.games, public.reads from anon, authenticated;

-- Realtime: every phone subscribed to reads for tonight gets row changes pushed.
alter table public.reads replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.reads;
exception when duplicate_object then null; end $$;

-- Photo bucket: public read (so teammates can look at the photo when fixing a number),
-- 10 MB cap, images only. No storage.objects policies for anon => uploads only via the function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screens', 'screens', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
