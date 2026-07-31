-- File attachments (images/PDFs) on nodes. Metadata only; bytes live in S3
-- under uploads/{conversation_id}/{uuid}-{filename} (server/utils/s3.ts).
-- Insert-only from the server (service_role), same as team_interaction_logs —
-- no client insert policy.

create table attachments (
  id           uuid primary key default gen_random_uuid(),
  node_id      uuid not null references nodes(id),
  filename     text not null,
  content_type text not null,
  size_bytes   bigint not null,
  s3_key       text not null,
  kind         text not null check (kind in ('image', 'pdf')),
  created_at   timestamptz not null default now()
);
create index idx_attachments_node on attachments(node_id);

alter table attachments enable row level security;

-- visible iff the underlying node is visible (RLS on nodes cascades here).
create policy attachments_select on attachments for select
  using (node_id in (select id from nodes));
