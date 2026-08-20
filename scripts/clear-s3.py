#!/usr/bin/env python3
"""Delete all objects from the dev Contracts S3 bucket."""

import json
import subprocess
import sys
import os
from pathlib import Path

def resolve_bucket():
    outputs_path = Path(__file__).parent.parent / ".sst" / "outputs.json"
    if outputs_path.exists():
        outputs = json.loads(outputs_path.read_text())
        for stack in outputs.values():
            if "ContractsBucketName" in stack:
                return stack["ContractsBucketName"]
    raise SystemExit(f"Could not resolve bucket from {outputs_path} — run `sst deploy` first.")

BUCKET = resolve_bucket()
env = {**os.environ, "AWS_CA_BUNDLE": "", "AWS_DEFAULT_REGION": "us-east-1"}

print(f"Listing objects in s3://{BUCKET}...")
result = subprocess.run(
    ["aws", "s3api", "list-objects-v2",
     "--bucket", BUCKET,
     "--query", "Contents[].Key",
     "--output", "json"],
    env=env, capture_output=True, text=True
)
if result.returncode != 0:
    print(result.stderr)
    sys.exit(1)

keys = json.loads(result.stdout or "[]") or []
if not keys:
    print("Bucket is already empty.")
    sys.exit(0)

print(f"Found {len(keys)} object(s) — deleting...")

deleted = 0
for i in range(0, len(keys), 1000):
    chunk = keys[i:i+1000]
    payload = {"Objects": [{"Key": k} for k in chunk], "Quiet": True}
    r = subprocess.run(
        ["aws", "s3api", "delete-objects",
         "--bucket", BUCKET,
         "--delete", json.dumps(payload)],
        env=env, capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"Error: {r.stderr}")
        sys.exit(1)
    deleted += len(chunk)
    print(f"  deleted {deleted}/{len(keys)}")

print("Done.")
