-- Core domain tables (design doc §5.1). Nodes are append-only & immutable.

create extension if not exists "pgcrypto";

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- public.users mirrors auth.users; id is the same uuid (FK to auth).
create table users (
  id           uuid primary key references auth.users(id) on delete cascade,
  team_id      uuid references teams(id),
  display_name text not null,
  role         text,                       -- study role, e.g. researcher/designer
  created_at   timestamptz not null default now()
);

-- one shared conversation = one reasoning tree
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id),
  title       text,
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

-- message nodes (core of the tree; append-only, immutable)
create table nodes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  parent_id       uuid references nodes(id),          -- null = root node
  author_id       uuid not null references users(id),
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  visibility      text not null default 'private'
                    check (visibility in ('private','shared')),
  is_fork_point   boolean not null default false,     -- set at INSERT (write-once)
  created_at      timestamptz not null default now()
);
create index idx_nodes_conv    on nodes(conversation_id);
create index idx_nodes_parent  on nodes(parent_id);
create index idx_nodes_created on nodes(conversation_id, created_at);

-- reaction buttons
create table reactions (
  id          uuid primary key default gen_random_uuid(),
  node_id     uuid not null references nodes(id),
  user_id     uuid not null references users(id),
  type        text not null check (type in ('pin','discuss','built_on')),
  created_at  timestamptz not null default now(),
  unique (node_id, user_id, type)
);
