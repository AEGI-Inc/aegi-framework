"""Local-only compliance execution service for dashboard integration.

Uses a fixed objects.json supplied at startup and a separate local SQLite DB.
It never collects SaaS data or publishes to D1. Not a production endpoint.
"""
import argparse
import json
import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from checks import CHECKS


def now():
    return datetime.now(timezone.utc).isoformat()


def connect(path):
    db = sqlite3.connect(path, timeout=5)
    db.execute("CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, policy TEXT NOT NULL, updated_at TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, policy TEXT NOT NULL, snapshot TEXT NOT NULL, result TEXT NOT NULL)")
    columns = {r[1] for r in db.execute("PRAGMA table_info(runs)")}
    if "check_id" not in columns:
        db.execute("ALTER TABLE runs ADD COLUMN check_id TEXT NOT NULL DEFAULT 'admin_auth'")
    db.commit()
    return db


def policy_value(value):
    if not isinstance(value, dict) or set(value) - {"require_mfa"} or ("require_mfa" in value and not isinstance(value["require_mfa"], bool)):
        raise ValueError("invalid_policy")
    return value


def make_handler(objects_file, db_path, allowed_origin):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_json(self, code, value):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def path_parts(self):
            return urlsplit(self.path).path.rstrip("/").split("/")

        def read_json(self):
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError("invalid_body")
            return json.loads(self.rfile.read(length))

        def origin_ok(self):
            origin = self.headers.get("Origin")
            return not origin or origin == allowed_origin

        def do_GET(self):
            if not self.origin_ok():
                return self.send_json(403, {"error": "origin"})
            parts = self.path_parts()
            try:
                with closing(connect(db_path)) as db:
                    if parts[-1] == "policy":
                        row = db.execute("SELECT policy, updated_at FROM policies WHERE id = ?", ("admin_auth",)).fetchone()
                        return self.send_json(200, {"policy": json.loads(row[0]) if row else {}, "updated_at": row[1] if row else None})
                    if parts[-1] == "runs":
                        check_id = parse_qs(urlsplit(self.path).query).get("check", ["admin_auth"])[0]
                        if check_id not in CHECKS:
                            return self.send_json(400, {"error": "invalid_check"})
                        rows = db.execute("SELECT id, created_at, snapshot FROM runs WHERE check_id = ? ORDER BY created_at DESC LIMIT 30", (check_id,)).fetchall()
                        return self.send_json(200, {"runs": [{"id": r[0], "created_at": r[1], "snapshot": r[2]} for r in rows]})
                    if len(parts) >= 2 and parts[-2] == "runs":
                        row = db.execute("SELECT id, created_at, snapshot, policy, result FROM runs WHERE id = ?", (parts[-1],)).fetchone()
                        return self.send_json(200, {"id": row[0], "created_at": row[1], "snapshot": row[2], "policy": json.loads(row[3]), "result": json.loads(row[4])}) if row else self.send_json(404, {"error": "not_found"})
            except (sqlite3.Error, ValueError):
                return self.send_json(500, {"error": "storage_unavailable"})
            return self.send_json(404, {"error": "not_found"})

        def do_POST(self):
            if not self.origin_ok():
                return self.send_json(403, {"error": "origin"})
            parts = self.path_parts()
            try:
                value = self.read_json()
                with closing(connect(db_path)) as db:
                    if parts[-1] == "policy":
                        policy = policy_value(value)
                        stamp = now()
                        db.execute("INSERT INTO policies(id, policy, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET policy=excluded.policy, updated_at=excluded.updated_at", ("admin_auth", json.dumps(policy), stamp))
                        db.commit()
                        return self.send_json(200, {"policy": policy, "updated_at": stamp})
                    if parts[-1] == "runs":
                        if not isinstance(value, dict) or set(value) != {"check"} or not isinstance(value["check"], str) or value["check"] not in CHECKS:
                            raise ValueError("invalid_check")
                        check_id = value["check"]
                        row = db.execute("SELECT policy FROM policies WHERE id = ?", (check_id,)).fetchone()
                        policy = policy_value(json.loads(row[0]) if row else {})
                        with open(objects_file, encoding="utf-8") as source:
                            objects = json.load(source)
                        if not isinstance(objects, list):
                            raise ValueError("invalid_snapshot")
                        result, stamp, run_id = CHECKS[check_id]["evaluate"](objects, policy), now(), str(uuid.uuid4())
                        snapshot = os.path.basename(os.path.dirname(objects_file))
                        db.execute("INSERT INTO runs(id, created_at, policy, snapshot, result, check_id) VALUES (?, ?, ?, ?, ?, ?)", (run_id, stamp, json.dumps(policy), snapshot, json.dumps(result, ensure_ascii=False), check_id))
                        db.commit()
                        return self.send_json(201, {"id": run_id, "created_at": stamp, "snapshot": snapshot, "policy": policy, "result": result})
            except (ValueError, json.JSONDecodeError):
                return self.send_json(400, {"error": "invalid_request"})
            except (OSError, sqlite3.Error):
                return self.send_json(503, {"error": "execution_unavailable"})
            return self.send_json(404, {"error": "not_found"})
    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--objects", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--port", type=int, default=5197)
    parser.add_argument("--dashboard-origin", default="http://127.0.0.1:5194")
    args = parser.parse_args()
    if os.path.abspath(args.objects) == os.path.abspath(args.db):
        raise SystemExit("database must differ from input")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(os.path.abspath(args.objects), os.path.abspath(args.db), args.dashboard_origin))
    print(f"Local compliance service: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()
