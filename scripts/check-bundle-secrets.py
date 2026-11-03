#!/usr/bin/env python3
"""Fail if any local secret value appears in a build output directory.

Reads secret values from .env (and config/.env.sandbox-accounts) in-process, never prints them,
and scans every file under the given directories. Exits 1 on any hit, so deploy scripts can stop.

Usage: python3 -I scripts/check-bundle-secrets.py .open-next .next/static
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECRET_SOURCES = [ROOT / ".env", ROOT / "config" / ".env.sandbox-accounts"]
LINE = re.compile(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$")
PATTERNS = [re.compile(rb"sk-ant-[A-Za-z0-9_-]{8}"), re.compile(rb"BEGIN [A-Z ]*PRIVATE KEY")]


def load_secret_values() -> dict[str, bytes]:
    values: dict[str, bytes] = {}
    for source in SECRET_SOURCES:
        if not source.exists():
            continue
        for line in source.read_text().splitlines():
            match = LINE.match(line)
            if not match:
                continue
            value = match.group(2).strip().strip('"').strip("'")
            # Skip non-secret values: URLs and sandbox test-account emails.
            if len(value) < 8 or value.startswith("http") or value.endswith(".example.com"):
                continue
            values[f"{source.name}:{match.group(1)}"] = value.encode()
    return values


def main(dirs: list[str]) -> int:
    if not dirs:
        print(__doc__)
        return 2
    secrets = load_secret_values()
    hits: list[tuple[str, str]] = []
    scanned = 0
    for d in dirs:
        base = (ROOT / d).resolve()
        if not base.is_relative_to(ROOT):
            print(f"refusing to scan outside the project: {d}")
            return 2
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            scanned += 1
            data = path.read_bytes()
            for name, value in secrets.items():
                if value in data:
                    hits.append((str(path.relative_to(ROOT)), name))
            if any(p.search(data) for p in PATTERNS):
                hits.append((str(path.relative_to(ROOT)), "secret-pattern"))
    print(f"scanned {scanned} files for {len(secrets)} secret values")
    if hits:
        for file, name in hits:
            print(f"SECRET FOUND: {name} in {file}")
        return 1
    print("no secrets found")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
