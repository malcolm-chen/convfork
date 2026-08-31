"""Export one study session's data (design doc §7 "research export") as a zip.

A "session ID" here is the study/team code from `teams.session_id` (assigned
in /admin, shared by every participant on that team — see
supabase/migrations/0011_study_session_credentials.sql). This is distinct
from the per-browser-tab `session_id` used inside individual log rows
(composables/useActionLogger.ts's `cf_sid`), which is just a sub-partition
under the team in S3 and not something you address directly.

For the given session ID this script:
  1. Resolves it to a team via Supabase (`teams.session_id`).
  2. Lists that team's participants (`users` where `team_id = ...`).
  3. Pulls every behavior-log NDJSON object from S3 under `logs/{team_id}/`
     (server/utils/s3.ts / server/api/logs.post.ts write logs there — each
     row already has ts / action_type / action_content / conversation_id /
     node_id, see composables/useActionLogger.ts), grouping rows by the
     participant they belong to.
  4. Pulls the full conversation trees (`conversations` + `nodes`) for the
     team from Supabase — this is where actual message content lives,
     including AI responses (server/api/chat.post.ts persists assistant
     nodes with role='assistant' here; the S3 action log only records a
     token count for `receive_response`, never the response text). Assistant
     nodes are authored under the human who triggered generation
     (author_id = the initiating user, see chat.post.ts), so grouping by
     author_id attributes both a participant's own turns and the AI replies
     they triggered to that participant.
  5. Pulls merged-context nodes ("Merge Conversations" feature,
     merged_context_nodes/merged_context_sources — see
     supabase/migrations/0020_fix_merge_context_unit.sql) created within
     those conversations, each with its source segments nested under it.
     The S3 action log only records merge_fork/merge_delete events, never
     the merge's own creation (title/summary/sources) — so each merge is
     backfilled as a synthetic `merge_create` row (session_id
     "backfill:merged_context_nodes") into its creator's action log,
     alongside their real logged actions. Merges later hard-deleted
     (server/api/merge/delete.post.ts) no longer exist in Postgres and
     cannot be recovered.
  6. Writes one action-log JSON array per participant (their real S3 rows
     plus backfilled merge_create rows, sorted by ts), one messages JSON
     array (their nodes, full conversation content incl. AI responses), plus
     a metadata.json, and zips the result.

    uv run python scripts/export_session.py <SESSION_ID> [--out DIR]

Requires SUPABASE_URL + SUPABASE_SECRET_KEY, and AWS_REGION / AWS_ACCESS_KEY_ID
/ AWS_SECRET_ACCESS_KEY / S3_BUCKET, all in .env (same vars server/ uses).
Read-only: never writes to Supabase or S3.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import boto3
from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SESSION_ID_RE = re.compile(r"^[a-zA-Z0-9._-]{6,64}$")


def supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.")
    return create_client(url, key)


def s3_client():
    region = os.environ.get("AWS_REGION")
    key_id = os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if not key_id or not secret:
        sys.exit("Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env first.")
    return boto3.client("s3", region_name=region, aws_access_key_id=key_id, aws_secret_access_key=secret)


def bucket_name() -> str:
    bucket = os.environ.get("S3_BUCKET")
    if not bucket:
        sys.exit("Set S3_BUCKET in .env first.")
    return bucket


def slugify(value: str) -> str:
    v = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return v.strip("_") or "participant"


def fetch_team(sb: Client, session_id: str) -> dict:
    res = (
        sb.table("teams")
        .select("id, name, session_id, sharing_condition, created_at")
        .eq("session_id", session_id)
        .execute()
    )
    if not res.data:
        sys.exit(f"No team found with session_id {session_id!r}.")
    return res.data[0]


def fetch_participants(sb: Client, team_id: str) -> list[dict]:
    res = (
        sb.table("users")
        .select("id, study_user_id, display_name, role, created_at")
        .eq("team_id", team_id)
        .execute()
    )
    return res.data or []


def fetch_conversations(sb: Client, team_id: str) -> list[dict]:
    res = (
        sb.table("conversations")
        .select("id, title, created_by, created_at")
        .eq("team_id", team_id)
        .execute()
    )
    return res.data or []


def fetch_nodes(sb: Client, conversation_ids: list[str]) -> list[dict]:
    """Full message tree (user + assistant turns) for the given conversations,
    paginated since the Supabase client caps a single response at 1000 rows."""
    if not conversation_ids:
        return []
    nodes: list[dict] = []
    page_size = 1000
    start = 0
    while True:
        res = (
            sb.table("nodes")
            .select(
                "id, conversation_id, parent_id, author_id, role, content, "
                "reasoning, model, visibility, created_at"
            )
            .in_("conversation_id", conversation_ids)
            .order("created_at")
            .range(start, start + page_size - 1)
            .execute()
        )
        page = res.data or []
        nodes.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return nodes


def fetch_merges(sb: Client, conversation_ids: list[str]) -> list[dict]:
    """Merged-context nodes (design doc's "Merge Conversations" feature,
    supabase/migrations/0020_fix_merge_context_unit.sql) created within the
    given conversations, each with its source segments nested under it.
    Hard-deleted merges (server/api/merge/delete.post.ts does a real DELETE,
    cascading to merged_context_sources) are gone from Postgres entirely and
    can't be recovered here — only merges that still exist can be exported."""
    if not conversation_ids:
        return []
    merges_res = (
        sb.table("merged_context_nodes")
        .select("id, conversation_id, title, summary, created_by, created_at")
        .in_("conversation_id", conversation_ids)
        .order("created_at")
        .execute()
    )
    merges = merges_res.data or []
    if not merges:
        return merges

    merge_ids = [m["id"] for m in merges]
    sources_by_merge: dict[str, list[dict]] = {}
    page_size = 1000
    start = 0
    while True:
        res = (
            sb.table("merged_context_sources")
            .select("merged_node_id, segment_head_node_id, author_id, included_through_turn_id, created_at")
            .in_("merged_node_id", merge_ids)
            .range(start, start + page_size - 1)
            .execute()
        )
        page = res.data or []
        for row in page:
            sources_by_merge.setdefault(row["merged_node_id"], []).append(row)
        if len(page) < page_size:
            break
        start += page_size

    for m in merges:
        m["sources"] = sources_by_merge.get(m["id"], [])
    return merges


def fetch_logs(s3, bucket: str, team_id: str) -> dict[str, list[dict]]:
    """Returns {user_id: [action_row, ...]} pulled from every NDJSON object
    under logs/{team_id}/ (all participants, all browser sub-sessions)."""
    rows_by_user: dict[str, list[dict]] = {}
    prefix = f"logs/{team_id}/"
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            parts = key[len(prefix) :].split("/")
            if len(parts) < 2:
                continue  # not a per-user log object, skip
            user_id = parts[0]
            body = s3.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")
            for line in body.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    print(f"  ! skipping malformed line in {key}", file=sys.stderr)
                    continue
                rows_by_user.setdefault(user_id, []).append(row)
    return rows_by_user


def build_export(session_id: str, out_dir: Path) -> Path:
    sb = supabase_client()
    s3 = s3_client()
    bucket = bucket_name()

    print(f"Resolving session {session_id!r}...")
    team = fetch_team(sb, session_id)
    team_id = team["id"]

    print(f"Team: {team['name']} ({team_id})")
    participants = fetch_participants(sb, team_id)
    print(f"Participants: {len(participants)}")

    print(f"Listing logs under s3://{bucket}/logs/{team_id}/ ...")
    rows_by_user = fetch_logs(s3, bucket, team_id)

    print("Fetching conversation trees (nodes, incl. assistant responses)...")
    conversations = fetch_conversations(sb, team_id)
    nodes = fetch_nodes(sb, [c["id"] for c in conversations])
    print(f"Conversations: {len(conversations)}, message nodes: {len(nodes)}")

    print("Fetching merged-context nodes (merge creations)...")
    merges = fetch_merges(sb, [c["id"] for c in conversations])
    print(f"Merges: {len(merges)}")

    nodes_by_user: dict[str, list[dict]] = {}
    for node in nodes:
        nodes_by_user.setdefault(node["author_id"], []).append(node)

    # The S3 action log never captured merge *creation* (only merge_fork /
    # merge_delete, logged client-side after the fact) — backfill it here as
    # a synthetic row in the same shape useActionLogger.ts rows use, so it
    # lands in the regular per-participant action log rather than a bolt-on
    # file.
    for merge in merges:
        rows_by_user.setdefault(merge["created_by"], []).append(
            {
                "id": merge["id"],
                "ts": merge["created_at"],
                "session_id": "backfill:merged_context_nodes",
                "action_type": "merge_create",
                "action_content": {
                    "title": merge["title"],
                    "summary": merge["summary"],
                    "sources": merge["sources"],
                },
                "conversation_id": merge["conversation_id"],
                "node_id": merge["id"],
            }
        )

    known_ids = {p["id"] for p in participants}
    unknown_ids = sorted((set(rows_by_user) | set(nodes_by_user)) - known_ids)
    if unknown_ids:
        print(f"  ! {len(unknown_ids)} user_id(s) have no matching users row: {unknown_ids}", file=sys.stderr)

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        used_names: set[str] = set()
        file_index = []

        def write_participant(user_id: str, label: str) -> None:
            base = slugify(label)
            name = base
            n = 2
            while name in used_names:
                name = f"{base}_{n}"
                n += 1
            used_names.add(name)
            actions = sorted(rows_by_user.get(user_id, []), key=lambda r: r.get("ts", ""))
            (tmp_path / f"{name}.json").write_text(json.dumps(actions, indent=2, ensure_ascii=False))

            messages = sorted(nodes_by_user.get(user_id, []), key=lambda r: r.get("created_at", ""))
            (tmp_path / f"{name}_messages.json").write_text(json.dumps(messages, indent=2, ensure_ascii=False))

            file_index.append(
                {
                    "user_id": user_id,
                    "file": f"{name}.json",
                    "action_count": len(actions),
                    "messages_file": f"{name}_messages.json",
                    "message_count": len(messages),
                }
            )

        for p in participants:
            write_participant(p["id"], p.get("study_user_id") or p.get("display_name") or p["id"])
        for uid in unknown_ids:
            write_participant(uid, f"unknown_{uid}")

        metadata = {
            "session_id": session_id,
            "team": {
                "id": team_id,
                "name": team["name"],
                "sharing_condition": team.get("sharing_condition"),
                "created_at": team.get("created_at"),
            },
            "participants": [
                {
                    "id": p["id"],
                    "study_user_id": p.get("study_user_id"),
                    "display_name": p.get("display_name"),
                    "role": p.get("role"),
                }
                for p in participants
            ],
            "conversations": [
                {"id": c["id"], "title": c.get("title"), "created_by": c.get("created_by")}
                for c in conversations
            ],
            "files": file_index,
            "total_actions": sum(f["action_count"] for f in file_index),
            "total_messages": sum(f["message_count"] for f in file_index),
            "total_merges": len(merges),
            "source": {
                "s3_bucket": bucket,
                "s3_prefix": f"logs/{team_id}/",
                "supabase_tables": ["conversations", "nodes", "merged_context_nodes", "merged_context_sources"],
                "note": (
                    "merge_create rows are backfilled from merged_context_nodes/"
                    "merged_context_sources (session_id='backfill:merged_context_nodes'), "
                    "since the S3 action log never captured merge creation. Merges "
                    "later hard-deleted (server/api/merge/delete.post.ts) are gone "
                    "from Postgres and cannot be recovered."
                ),
            },
            "exported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        (tmp_path / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False))

        out_dir.mkdir(parents=True, exist_ok=True)
        zip_path = out_dir / f"session-{slugify(session_id)}-{stamp}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(tmp_path.iterdir()):
                zf.write(f, arcname=f.name)

    return zip_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a study session's behavior logs as a zip.")
    parser.add_argument("session_id", help="Study session code (teams.session_id)")
    parser.add_argument("--out", default=str(ROOT / "exports"), help="Output directory (default: ./exports)")
    args = parser.parse_args()

    if not SESSION_ID_RE.match(args.session_id):
        sys.exit("sessionID must be 6-64 chars (letters, digits, . _ -)")

    zip_path = build_export(args.session_id, Path(args.out))
    size_kb = zip_path.stat().st_size / 1024
    print(f"\nDone -> {zip_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
