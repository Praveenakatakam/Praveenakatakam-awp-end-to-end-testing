#!/usr/bin/env python3
"""Delete all items from the dev Registry DynamoDB table."""

import json
import subprocess
import sys

TABLE = "dev-awp-end-to-end-testing-Registry"
ENV_OVERRIDES = {"AWS_CA_BUNDLE": "", "AWS_DEFAULT_REGION": "us-east-1"}

import os
env = {**os.environ, **ENV_OVERRIDES}

print(f"Scanning {TABLE}...")
result = subprocess.run(
    ["aws", "dynamodb", "scan",
     "--table-name", TABLE,
     "--attributes-to-get", "PK", "SK",
     "--query", "Items[*]",
     "--output", "json"],
    env=env, capture_output=True, text=True
)
if result.returncode != 0:
    print(result.stderr)
    sys.exit(1)

items = json.loads(result.stdout)
print(f"Found {len(items)} items — deleting...")

deleted = 0
for i in range(0, len(items), 25):
    chunk = items[i:i+25]
    batch = {
        TABLE: [
            {"DeleteRequest": {"Key": {"PK": {"S": x["PK"]["S"]}, "SK": {"S": x["SK"]["S"]}}}}
            for x in chunk
        ]
    }
    r = subprocess.run(
        ["aws", "dynamodb", "batch-write-item", "--request-items", json.dumps(batch)],
        env=env, capture_output=True, text=True
    )
    if r.returncode != 0:
        print(f"Error on chunk {i}: {r.stderr}")
        sys.exit(1)
    deleted += len(chunk)
    print(f"  deleted {deleted}/{len(items)}")

print("Done.")
