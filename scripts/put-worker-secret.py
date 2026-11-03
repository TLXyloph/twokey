#!/usr/bin/env python3
"""Set one Cloudflare Worker secret from .env without the value touching argv, a log or the screen.

Reads .env in-process, then runs `npx wrangler secret put NAME` with the value on stdin (wrangler
reads stdin when it is not a terminal). Prints only the name and wrangler's own exit status.

Usage: python3 -I scripts/put-worker-secret.py PAYPAL_CLIENT_ID [PAYPAL_CLIENT_SECRET ...]
"""
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
LINE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$")
# Only names the Worker reads. ANTHROPIC_API_KEY is listed, but setting it switches the live AI on:
# do that only after the AI route is locked down and the user has approved the spend.
ALLOWED = {"PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "AG_STUDIO_LICENSE_KEY", "ANTHROPIC_API_KEY"}


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        match = LINE.match(line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return values


def main(names: list[str]) -> int:
    if not names:
        print(__doc__)
        return 2
    unknown = [n for n in names if n not in ALLOWED]
    if unknown:
        print(f"refusing names outside the allowed list: {', '.join(unknown)}")
        return 2
    env = read_env()
    missing = [n for n in names if not env.get(n)]
    if missing:
        print(f"not set in .env: {', '.join(missing)}")
        return 1
    status = 0
    for name in names:
        result = subprocess.run(
            ["npx", "wrangler", "secret", "put", name],
            input=env[name] + "\n",
            text=True,
            cwd=ROOT,
            env={**os.environ, "WRANGLER_SEND_METRICS": "false"},
            capture_output=True,
        )
        # wrangler's output names the secret and the Worker, never the value; print only its last line.
        stream = result.stdout if result.returncode == 0 else result.stderr
        tail = (stream.strip().splitlines() or [""])[-1]
        print(f"{name}: exit {result.returncode} {tail}")
        status = status or result.returncode
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
