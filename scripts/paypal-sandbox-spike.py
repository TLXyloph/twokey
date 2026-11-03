#!/usr/bin/env python3
"""TwoKey day-1 PayPal sandbox spike.

Reads PAYPAL_* values from the project-root .env and never prints secrets.
Sandbox only: refuses to run against anything but api-m.sandbox.paypal.com.

Commands:
  check                     token scopes, balances freshness, recent transactions
  payout                    $1.00 payout to PayPal's simulator receiver + idempotency checks
  venmo                     Venmo-wallet payout (expected to fail in sandbox) + POSPYO003 simulation
  poll --minutes N --log F  poll balances + transaction search every 2 min, log when new debits appear
"""
import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
SANDBOX_BASE = "https://api-m.sandbox.paypal.com"
SIM_RECEIVER = "payouts-simulator-receiver@paypal.com"


def load_env() -> dict:
    env = {}
    for line in ENV_PATH.read_text().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    for key in ("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"):
        if not env.get(key):
            sys.exit(f"{key} is empty in .env")
    base = env.get("PAYPAL_API_BASE", SANDBOX_BASE).rstrip("/")
    if base != SANDBOX_BASE:
        sys.exit("Refusing to run: PAYPAL_API_BASE is not the sandbox endpoint.")
    env["PAYPAL_API_BASE"] = base
    return env


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def request(method, url, headers=None, body=None, form=None):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    elif form is not None:
        data = form.encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode() or "{}"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw[:500]}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if method != "GET":
            raise  # a POST that failed in transit has an unknown outcome; fail loudly
        # Read-only call: report status 0 so the poll loop logs it and retries next cycle.
        return 0, {"error": f"network: {getattr(e, 'reason', e)}"[:200]}


def get_token(env) -> tuple[str, dict]:
    basic = base64.b64encode(f"{env['PAYPAL_CLIENT_ID']}:{env['PAYPAL_CLIENT_SECRET']}".encode()).decode()
    status, data = request("POST", f"{env['PAYPAL_API_BASE']}/v1/oauth2/token",
                           headers={"Authorization": f"Basic {basic}"},
                           form="grant_type=client_credentials")
    if status != 200:
        sys.exit(f"Token request failed: HTTP {status} {data.get('error')} {data.get('error_description')}")
    token = data.pop("access_token")
    return token, data


def auth(token, extra=None):
    h = {"Authorization": f"Bearer {token}"}
    h.update(extra or {})
    return h


def err_summary(data) -> str:
    keys = ("name", "message", "debug_id", "error", "error_description")
    out = {k: data[k] for k in keys if k in data}
    if "details" in data:
        out["details"] = [{k: d.get(k) for k in ("issue", "description", "field") if d.get(k)}
                          for d in data["details"]][:3]
    return json.dumps(out)


def balances(env, token):
    return request("GET", f"{env['PAYPAL_API_BASE']}/v1/reporting/balances?currency_code=USD",
                   headers=auth(token))


def transactions(env, token, start: datetime, end: datetime):
    url = (f"{env['PAYPAL_API_BASE']}/v1/reporting/transactions"
           f"?start_date={iso(start)}&end_date={iso(end)}&fields=all&page_size=500")
    return request("GET", url, headers=auth(token))


def cmd_check(env):
    token, meta = get_token(env)
    scopes = meta.get("scope", "").split()
    print("TOKEN ok; expires_in:", meta.get("expires_in"), "s; scopes:", len(scopes))
    for needle, label in (("payments/payouts", "payouts"),
                          ("reporting/search/read", "transaction search"),
                          ("balances", "balances")):
        print(f"  scope {label:20s}:", any(needle in s for s in scopes))

    st, bal = balances(env, token)
    if st == 200:
        print("BALANCES ok; as_of_time:", bal.get("as_of_time"), "| last_refresh_time:",
              bal.get("last_refresh_time"), "| now:", iso(now_utc()))
        for b in bal.get("balances", []):
            print("  ", b.get("currency"), "available:", b.get("available_balance", {}).get("value"),
                  "total:", b.get("total_balance", {}).get("value"))
    else:
        print("BALANCES failed: HTTP", st, err_summary(bal))

    end = now_utc()
    st, tx = transactions(env, token, end - timedelta(days=30), end)
    if st == 200:
        details = tx.get("transaction_details", [])
        codes = {}
        for d in details:
            code = d.get("transaction_info", {}).get("transaction_event_code")
            codes[code] = codes.get(code, 0) + 1
        print("TRANSACTIONS ok; last 30 days:", len(details), "| codes:", codes,
              "| last_refreshed_datetime:", tx.get("last_refreshed_datetime"))
    else:
        print("TRANSACTIONS failed: HTTP", st, err_summary(tx))


def create_payout(env, token, batch_id, request_id, item):
    body = {"sender_batch_header": {"sender_batch_id": batch_id,
                                    "email_subject": "TwoKey sandbox spike",
                                    "email_message": "Sandbox test payout"},
            "items": [item]}
    return request("POST", f"{env['PAYPAL_API_BASE']}/v1/payments/payouts",
                   headers=auth(token, {"PayPal-Request-Id": request_id}), body=body)


def cmd_payout(env, state_path: Path):
    token, _ = get_token(env)
    stamp = now_utc().strftime("%Y%m%d%H%M%S")
    batch_id = f"twokey-spike-{stamp}"
    item = {"recipient_type": "EMAIL", "receiver": SIM_RECEIVER, "sender_item_id": "item-1",
            "amount": {"value": "1.00", "currency": "USD"}, "note": "TwoKey day-1 spike"}
    t0 = time.time()
    st, data = create_payout(env, token, batch_id, batch_id, item)
    if st not in (200, 201):
        print("PAYOUT create failed: HTTP", st, err_summary(data))
        return
    pid = data["batch_header"]["payout_batch_id"]
    print("PAYOUT created: HTTP", st, "| batch_status:", data["batch_header"].get("batch_status"))

    final = None
    for _ in range(36):  # up to ~3 min
        st, got = request("GET", f"{env['PAYPAL_API_BASE']}/v1/payments/payouts/{pid}", headers=auth(token))
        items = got.get("items", [])
        tstat = items[0].get("transaction_status") if items else None
        if tstat and tstat not in ("PENDING", "UNCLAIMED_PENDING", "ONHOLD"):
            final = got
            break
        time.sleep(5)
    elapsed = round(time.time() - t0, 1)
    if final:
        it = final["items"][0]
        print(f"PAYOUT item: {it.get('transaction_status')} after {elapsed}s | transaction_id present:",
              bool(it.get("transaction_id")), "| fee:", it.get("payout_item_fee", {}).get("value"))
    else:
        print(f"PAYOUT item still pending after {elapsed}s")
        it = {}

    st2, again = create_payout(env, token, batch_id, batch_id, item)
    same = again.get("batch_header", {}).get("payout_batch_id") == pid
    print("IDEMPOTENCY same PayPal-Request-Id: HTTP", st2, "| same batch returned:", same)
    st3, dup = create_payout(env, token, batch_id, batch_id + "-new", item)
    print("DUPLICATE sender_batch_id, new Request-Id: HTTP", st3, "|", err_summary(dup) if st3 >= 400 else "accepted")

    state = {"created_at": iso(now_utc()), "payout_batch_id": pid, "sender_batch_id": batch_id,
             "transaction_id": it.get("transaction_id"), "status": it.get("transaction_status")}
    state_path.write_text(json.dumps(state, indent=2))
    print("state saved to", state_path)


def cmd_venmo(env):
    token, _ = get_token(env)
    stamp = now_utc().strftime("%Y%m%d%H%M%S")
    item = {"recipient_type": "PHONE", "receiver": "4085550123", "recipient_wallet": "VENMO",
            "sender_item_id": "venmo-1", "amount": {"value": "1.00", "currency": "USD"},
            "note": "TwoKey venmo spike"}
    st, data = create_payout(env, token, f"twokey-venmo-{stamp}", f"twokey-venmo-{stamp}", item)
    print("VENMO payout: HTTP", st, "|", err_summary(data) if st >= 400 else data.get("batch_header", {}).get("batch_status"))
    item["note"] = "POSPYO003"
    st, data = create_payout(env, token, f"twokey-venmo-sim-{stamp}", f"twokey-venmo-sim-{stamp}", item)
    print("VENMO payout with POSPYO003 note: HTTP", st, "|",
          err_summary(data) if st >= 400 else data.get("batch_header", {}).get("batch_status"))


def cmd_poll(env, minutes: int, log_path: Path, state_path: Path):
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    start_wall = now_utc()
    watch_tx = state.get("transaction_id")
    seen = {}
    deadline = time.time() + minutes * 60
    token, meta = get_token(env)
    token_born = time.time()
    with log_path.open("a") as log:
        def out(msg):
            line = f"{iso(now_utc())} {msg}"
            print(line, flush=True)
            log.write(line + "\n")
            log.flush()
        out(f"POLL start; watching payout txn present={bool(watch_tx)}; window {minutes} min")
        baseline_ids = None
        last_ref = None
        while time.time() < deadline:
            if time.time() - token_born > 6 * 3600:
                try:
                    token, meta = get_token(env)
                    token_born = time.time()
                except (SystemExit, OSError) as e:  # OSError covers URLError from the token POST
                    out(f"token refresh failed, retrying next round: {e}")
            st, bal = balances(env, token)
            if st == 200:
                avail = [b.get("available_balance", {}).get("value") for b in bal.get("balances", [])]
                out(f"balances as_of={bal.get('as_of_time')} last_refresh={bal.get('last_refresh_time')} available={avail}")
            else:
                out(f"balances HTTP {st} {err_summary(bal)}")
            end = now_utc()
            st, tx = transactions(env, token, end - timedelta(days=2), end)
            if st == 200:
                details = tx.get("transaction_details", [])
                ids = {}
                for d in details:
                    info = d.get("transaction_info", {})
                    ids[info.get("transaction_id")] = (info.get("transaction_event_code"),
                                                      info.get("transaction_amount", {}).get("value"),
                                                      info.get("transaction_initiation_date"))
                ref = tx.get("last_refreshed_datetime")
                if last_ref is not None and ref != last_ref:
                    out(f"transactions refreshed: last_refreshed={ref}")
                last_ref = ref
                if baseline_ids is None:
                    baseline_ids = set(ids)
                    out(f"transactions baseline: {len(ids)} in last 2 days; last_refreshed={tx.get('last_refreshed_datetime')}")
                for tid, (code, amt, when) in ids.items():
                    if tid not in seen and (tid == watch_tx or tid not in baseline_ids):
                        seen[tid] = iso(now_utc())
                        tag = "WATCHED PAYOUT" if tid == watch_tx else "NEW"
                        out(f"{tag} txn code={code} amount={amt} initiated={when} first_seen={seen[tid]}")
                if watch_tx and watch_tx in ids and watch_tx not in seen:
                    seen[watch_tx] = iso(now_utc())
                    out(f"WATCHED PAYOUT already present at first poll (initiated {ids[watch_tx][2]})")
            else:
                out(f"transactions HTTP {st} {err_summary(tx)}")
            time.sleep(120)
        out(f"POLL end; new/watched transactions seen: {len(seen)}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["check", "payout", "venmo", "poll"])
    p.add_argument("--minutes", type=int, default=60)
    p.add_argument("--log", type=Path, default=Path("spike-poll.log"))
    p.add_argument("--state", type=Path, default=Path("spike-state.json"))
    a = p.parse_args()
    env = load_env()
    if a.command == "check":
        cmd_check(env)
    elif a.command == "payout":
        cmd_payout(env, a.state)
    elif a.command == "venmo":
        cmd_venmo(env)
    else:
        cmd_poll(env, a.minutes, a.log, a.state)


if __name__ == "__main__":
    main()
