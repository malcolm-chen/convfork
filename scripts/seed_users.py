"""Pre-provision study accounts (teams + auth users + public.users profiles).

Run with the uv-managed env:
    uv run python scripts/seed_users.py [path/to/participants.json]

Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env (service_role bypasses RLS).
Idempotent: existing teams (by name) and users (by email) are reused, not duplicated.

Why a script and not plain SQL: public.users.id is a FK to auth.users(id), so the
auth user must be created first via the admin API — SQL alone cannot seed users.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    # new-format secret key (replaces service_role); fall back to legacy var name
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.")
    return create_client(url, key)


def load_config() -> dict:
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    path = Path(arg) if arg else ROOT / "scripts" / "participants.json"
    if not path.exists():
        path = ROOT / "scripts" / "participants.example.json"
        print(f"[info] {path.name} not found; using example config.")
    return json.loads(path.read_text())


def existing_user_ids(sb: Client) -> dict[str, str]:
    """email -> auth user id, paging through all users."""
    out: dict[str, str] = {}
    page = 1
    while True:
        users = sb.auth.admin.list_users(page=page, per_page=200)
        if not users:
            break
        for u in users:
            if u.email:
                out[u.email.lower()] = u.id
        if len(users) < 200:
            break
        page += 1
    return out


def get_or_create_team(sb: Client, name: str) -> str:
    found = sb.table("teams").select("id").eq("name", name).execute()
    if found.data:
        return found.data[0]["id"]
    created = sb.table("teams").insert({"name": name}).execute()
    return created.data[0]["id"]


def main() -> None:
    sb = client()
    config = load_config()
    known = existing_user_ids(sb)
    credentials: list[tuple[str, str, str]] = []  # (team, email, password|"<existing>")

    for team in config["teams"]:
        team_id = get_or_create_team(sb, team["name"])
        for m in team["members"]:
            email = m["email"].lower()
            if email in known:
                user_id = known[email]
                password = "<existing>"
            else:
                password = secrets.token_urlsafe(9)
                res = sb.auth.admin.create_user(
                    {"email": email, "password": password, "email_confirm": True}
                )
                user_id = res.user.id

            # Upsert the public profile (id is the PK / FK to auth.users).
            sb.table("users").upsert(
                {
                    "id": user_id,
                    "team_id": team_id,
                    "display_name": m["display_name"],
                    "role": m.get("role"),
                }
            ).execute()
            credentials.append((team["name"], email, password))

    print("\n=== Seeded accounts ===")
    print(f"{'team':<14}{'email':<28}{'password'}")
    for t, e, p in credentials:
        print(f"{t:<14}{e:<28}{p}")
    print("\nStore these securely and distribute to participants.")


if __name__ == "__main__":
    main()
