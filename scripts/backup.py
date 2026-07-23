"""Back up the Supabase Postgres database (design doc §7 — free tier has no auto
backups). Produces a pg_dump custom-format archive; optionally uploads to S3.

    uv run python scripts/backup.py

Requires SUPABASE_DB_URL in .env and `pg_dump` on PATH. If S3_BUCKET +
AWS_ACCESS_KEY_ID are set, the dump is also uploaded under backups/.
Schedule via cron on the host for the duration of the study.
"""

from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def main() -> None:
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        sys.exit("Set SUPABASE_DB_URL in .env (Supabase → Project Settings → Database).")

    out_dir = ROOT / "backups"
    out_dir.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = out_dir / f"convfork-{stamp}.dump"

    print(f"Dumping → {path}")
    subprocess.run(
        ["pg_dump", "--format=custom", "--no-owner", "--file", str(path), db_url],
        check=True,
    )

    bucket = os.environ.get("S3_BUCKET")
    if bucket and os.environ.get("AWS_ACCESS_KEY_ID"):
        import boto3

        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION"))
        key = f"backups/convfork-{stamp}.dump"
        s3.upload_file(str(path), bucket, key)
        print(f"Uploaded → s3://{bucket}/{key}")

    print("Done.")


if __name__ == "__main__":
    main()
