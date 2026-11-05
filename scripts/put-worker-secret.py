#!/usr/bin/env python3
"""Set one Cloudflare Worker secret from .env without the value touching argv, a log or the screen.

Reads .env (or, for the pay page's sandbox test buyer, config/.env.sandbox-accounts) in-process, then runs `npx wrangler secret put NAME` with the value on stdin (wrangler
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
SANDBOX_FILE = ROOT / "config" / ".env.sandbox-accounts"
LINE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$")
# Only names the Worker reads. ANTHROPIC_API_KEY is listed, but setting it switches the live AI on:
# do that only after the AI route is locked down and the user has approved the spend.
ALLOWED = {"PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "AG_STUDIO_LICENSE_KEY", "ANTHROPIC_API_KEY"}
# The parent's PayPal SANDBOX login, shown on the pay page as the "sandbox test buyer" (user-approved
# 2026-11-05: judges need a buyer login, and the rules ask for sandbox logins in the testing notes).
FROM_SANDBOX_FILE = {"TWOKEY_TEST_BUYER_EMAIL": "SANDBOX_PARENT_EMAIL", "TWOKEY_TEST_BUYER_PASSWORD": "SANDBOX_PARENT_PASSWORD"}


def read_env(path: pathlib.Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        match = LINE.match(line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"').strip("'")
    return values


def main(names: list[str]) -> int:
    if not names:
        print(__doc__)
        return 2
    unknown = [n for n in names if n not in ALLOWED and n not in FROM_SANDBOX_FILE]
    if unknown:
        print(f"refusing names outside the allowed list: {', '.join(unknown)}")
        return 2
    env = read_env() if any(n in ALLOWED for n in names) else {}
    if any(n in FROM_SANDBOX_FILE for n in names):
        sandbox = read_env(SANDBOX_FILE)
        env.update({n: sandbox.get(key, "") for n, key in FROM_SANDBOX_FILE.items()})
    missing = [n for n in names if not env.get(n)]
    if missing:
        print(f"not set: {', '.join(missing)}")
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
