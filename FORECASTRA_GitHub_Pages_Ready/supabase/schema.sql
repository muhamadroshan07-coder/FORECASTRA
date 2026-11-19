-- FORECASTRA Supabase schema.
-- Run this migration in Supabase SQL Editor after connecting the project.
-- All user data is protected by Row Level Security and is scoped to auth.uid().

create extension if not exists pgcrypto;

-- Saved map locations
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

-- Research sessions (conversation metadata only)
create table if not exists public.research_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default 'FORECASTRA Research Session',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_conversations_user_updated_idx
on public.research_conversations(user_id, updated_at desc);

alter table public.research_conversations enable row level security;
drop policy if exists "Users manage their own research conversations" on public.research_conversations;
create policy "Users manage their own research conversations"
on public.research_conversations for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- User-owned AI conversation messages
create table if not exists public.research_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.research_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists research_messages_conversation_created_idx
on public.research_messages(conversation_id, created_at asc);
create index if not exists research_messages_user_created_idx
on public.research_messages(user_id, created_at desc);

alter table public.research_messages enable row level security;
drop policy if exists "Users manage their own research messages" on public.research_messages;
create policy "Users manage their own research messages"
on public.research_messages for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.research_conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  )
);

-- Store analysis summaries and dataset metadata, not uploaded file contents.
create table if not exists public.dataset_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  file_name text not null,
  row_count integer not null check (row_count >= 0),
  column_count integer not null check (column_count >= 0),
  numeric_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists dataset_analyses_user_created_idx
on public.dataset_analyses(user_id, created_at desc);

alter table public.dataset_analyses enable row level security;
drop policy if exists "Users manage their own dataset analyses" on public.dataset_analyses;
create policy "Users manage their own dataset analyses"
on public.dataset_analyses for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Only authenticated users receive table-level access; RLS further limits rows to their own data.
grant select, insert, update, delete on public.saved_locations to authenticated;
grant select, insert, update, delete on public.research_conversations to authenticated;
grant select, insert, update, delete on public.research_messages to authenticated;
grant select, insert, update, delete on public.dataset_analyses to authenticated;
