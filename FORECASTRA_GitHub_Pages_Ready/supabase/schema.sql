-- Optional saved-place table. Run this in the Supabase SQL editor only if you use Supabase Auth.
create table if not exists public.saved_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  created_at timestamptz not null default now()
);

alter table public.saved_locations enable row level security;
drop policy if exists "Users can manage their own saved locations" on public.saved_locations;
create policy "Users can manage their own saved locations"
on public.saved_locations for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
