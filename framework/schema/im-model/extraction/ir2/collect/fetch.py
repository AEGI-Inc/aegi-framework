# -*- coding: utf-8 -*-
"""수집 사다리 (IR 설계.md 9절). targets.yaml 의 주소를 단계별로 내려가며 받는다.

    python fetch.py                 # 받지 않은 대상만
    python fetch.py --dry-run       # 무엇을 할지 보이기만
    python fetch.py --only jsm_openapi

단:
  0  같은 내용의 기계용 원본 (machine_alt 주소, 또는 이미 받은 파일 machine_alt_existing)
  1  HTTP 받기. 정직한 User-Agent, 재시도와 간격(2, 4, 8초), 조건부 요청(ETag, Last-Modified)
  2  헤드리스 브라우저 (browser.PlaywrightAdapter). 네트워크 JSON 을 먼저, 없으면 DOM 을 저장한다
  3  사람이 쓰는 실제 브라우저 (browser.CdpChromeAdapter, AgentCliAdapter)
  4  사람에게 넘긴다. inbox/pending.jsonl 에 주소를 적고, 사람이 inbox/<provider>/ 에 넣은 파일을 inbox.py 가 등록한다

결과는 snapshots/<snapshot>/raw/ 와 manifest.jsonl (url, file, status, sha256, retrieved_at, fetch_method, ladder).
하지 않는 것: CAPTCHA 풀기, 지문 위장, 프록시 돌리기. allowed_hosts 밖 주소는 받지 않는다.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import time

import requests
import yaml

import browser

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
INBOX = os.path.join(HERE, "inbox")


def fname(url):
    return re.sub(r"[^A-Za-z0-9._-]+", "__", re.sub(r"^https?://", "", url)).strip("_")


def allowed(url, hosts):
    u = re.sub(r"^https?://", "", url)
    for h in hosts:
        if "/" in h:
            if u.startswith(h):
                return True
        else:
            host = u.split("/")[0]
            if host == h or host.endswith("." + h):
                return True
    return False


def looks_ok(body, expect):
    """받은 내용이 기대한 형식인가. JS 로 그리는 빈 쪽, 확인 문제 쪽을 걸러낸다"""
    if not body:
        return False, "빈 본문"
    head = body[:2048].lstrip()
    if expect == "json":
        try:
            json.loads(body)
            return True, "json"
        except ValueError:
            return False, "json 아님"
    if expect == "yaml":
        if head.startswith(b"openapi:") or head.startswith(b"swagger:") or head.startswith(b"{"):
            return True, "yaml"
        return False, "yaml 아님"
    if expect == "pdf":
        return (head.startswith(b"%PDF"), "pdf" if head.startswith(b"%PDF") else "pdf 아님")
    low = body[:200000].lower()
    if b"captcha" in low or b"verify you are human" in low:
        return False, "captcha 문자열이 있다 (확인 문제 쪽이거나 JS 렌더링 쪽)"
    text = re.sub(rb"<script.*?</script>|<style.*?</style>|<[^>]+>", b" ", body[:500000], flags=re.S)
    if len(re.sub(rb"\s+", b"", text)) < 2000:
        return False, "본문 글자가 거의 없다 (JS 렌더링 쪽일 수 있다)"
    return True, "html"


def http_get(url, prev=None, tries=3):
    headers = {"User-Agent": browser.UA, "Accept": "*/*"}
    if prev:
        if prev.get("etag"):
            headers["If-None-Match"] = prev["etag"]
        if prev.get("last_modified"):
            headers["If-Modified-Since"] = prev["last_modified"]
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=headers, timeout=120, allow_redirects=True)
            last = r
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** (i + 1))
                continue
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(2 ** (i + 1))
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only")
    a = ap.parse_args()
    cfg = yaml.safe_load(io.open(os.path.join(HERE, "targets.yaml"), encoding="utf-8"))
    snap = os.path.join(HERE, "snapshots", cfg["snapshot"])
    raw = os.path.join(snap, "raw")
    os.makedirs(raw, exist_ok=True)
    mpath = os.path.join(snap, "manifest.jsonl")
    done = {}
    if os.path.exists(mpath):
        for l in io.open(mpath, encoding="utf-8"):
            d = json.loads(l)
            done[d["id"]] = d
    pending = []
    for t in cfg["targets"]:
        if a.only and t["id"] != a.only:
            continue
        if t["id"] in done and done[t["id"]].get("status") == 200:
            print("이미 받음", t["id"])
            continue
        if not allowed(t["url"], cfg["allowed_hosts"]):
            print("허용 도메인 밖, 받지 않음", t["url"])
            continue
        ladder, result = [], None
        if a.dry_run:
            print("받을 것", t["id"], t["url"])
            continue
        # 0단: 이미 받은 같은 내용 파일
        for rel in t.get("machine_alt_existing", []):
            p = os.path.join(NEMO, rel)
            if os.path.exists(p):
                ladder.append({"step": 0, "method": "machine_alt", "target": rel, "result": "있음 (이미 받은 파일)"})
                result = {"status": 200, "file": rel.replace("\\", "/"), "fetch_method": "machine_alt",
                          "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest(), "final_url": None}
                break
        # 0단: 기계용 원본 주소
        for u in ([] if result else t.get("machine_alt", [])):
            if not allowed(u, cfg["allowed_hosts"]):
                ladder.append({"step": 0, "method": "machine_alt", "target": u, "result": "허용 도메인 밖"})
                continue
            r = http_get(u)
            if isinstance(r, requests.Response) and r.status_code == 200:
                ok, why = looks_ok(r.content, t.get("expect"))
                ladder.append({"step": 0, "method": "machine_alt", "target": u, "result": "%d %s" % (r.status_code, why)})
                if ok:
                    result = save(raw, snap, u, r, "machine_alt")
                    break
            else:
                ladder.append({"step": 0, "method": "machine_alt", "target": u,
                               "result": str(getattr(r, "status_code", r))})
        # 1단: HTTP
        if not result:
            r = http_get(t["url"], done.get(t["id"]))
            code = getattr(r, "status_code", None)
            if isinstance(r, requests.Response) and code == 200:
                ok, why = looks_ok(r.content, t.get("expect"))
                ladder.append({"step": 1, "method": "http", "result": "%d %s" % (code, why)})
                if ok:
                    result = save(raw, snap, t["url"], r, "http")
            else:
                ladder.append({"step": 1, "method": "http", "result": str(code if code is not None else r)})
        # 2, 3단: 브라우저
        for step in (2, 3):
            if result:
                break
            for ad in browser.LADDER_BROWSERS[step]:
                ok, why = ad.available()
                if not ok:
                    ladder.append({"step": step, "method": ad.method, "result": "쓸 수 없음: " + why})
                    continue
                try:
                    o = ad.fetch(t["url"])
                except Exception as e:                      # 어댑터 실패는 다음 단으로
                    ladder.append({"step": step, "method": ad.method, "result": "실패: %s" % e})
                    continue
                result = save_browser(raw, t, o)
                ladder.append({"step": step, "method": ad.method, "result": "%s %s" % (o.get("status"), result["note"])})
                if result["ok"]:
                    break
                result = None
        # 4단: 사람
        if not result:
            ladder.append({"step": 4, "method": "human", "result": "inbox/pending.jsonl 에 적음"})
            pending.append({"id": t["id"], "provider": t["provider"], "url": t["url"],
                            "drop_to": "inbox/%s/" % t["provider"], "expect": t.get("expect")})
            result = {"status": 0, "file": None, "fetch_method": "human", "sha256": None, "final_url": None}
        row = {k: t.get(k) for k in ("id", "provider", "kind", "rank", "naming", "url", "version", "note")}
        row.update({"status": result["status"], "file": result["file"], "sha256": result["sha256"],
                    "final_url": result.get("final_url"), "fetch_method": result["fetch_method"],
                    "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ladder": ladder,
                    "etag": result.get("etag"), "last_modified": result.get("last_modified")})
        done[t["id"]] = row
        print(t["id"], row["fetch_method"], row["status"])
        time.sleep(1)
    if a.dry_run:
        return
    with io.open(mpath, "w", encoding="utf-8", newline="\n") as f:
        for k in sorted(done):
            f.write(json.dumps(done[k], ensure_ascii=False, sort_keys=True) + "\n")
    if pending:
        os.makedirs(INBOX, exist_ok=True)
        with io.open(os.path.join(INBOX, "pending.jsonl"), "a", encoding="utf-8", newline="\n") as f:
            for p in pending:
                f.write(json.dumps(p, ensure_ascii=False, sort_keys=True) + "\n")


def rel_nemo(p):
    return os.path.relpath(p, NEMO).replace("\\", "/")


def save(raw, snap, url, r, method):
    out = os.path.join(raw, fname(url))
    with open(out, "wb") as f:
        f.write(r.content)
    return {"status": r.status_code, "file": rel_nemo(out), "fetch_method": method,
            "sha256": hashlib.sha256(r.content).hexdigest(), "final_url": r.url,
            "etag": r.headers.get("ETag"), "last_modified": r.headers.get("Last-Modified")}


def save_browser(raw, t, o):
    """네트워크 JSON 을 먼저 저장한다. 기대 형식에 맞는 JSON 이 없으면 그려진 DOM 을 저장한다"""
    base = os.path.join(raw, fname(t["url"]))
    for i, n in enumerate(o.get("network_json") or []):
        body = (n.get("body") or "").encode("utf-8")
        ok, _ = looks_ok(body, "json")
        if ok and t.get("expect") == "json":
            p = base + ".net%d.json" % i
            open(p, "wb").write(body)
            return {"ok": True, "note": "네트워크 JSON", "status": 200, "file": rel_nemo(p), "fetch_method": o["method"],
                    "sha256": hashlib.sha256(body).hexdigest(), "final_url": n.get("url")}
    body = (o.get("body") or "").encode("utf-8")
    ok, why = looks_ok(body, t.get("expect") or "html")
    p = base + ".dom.html"
    open(p, "wb").write(body)
    return {"ok": ok, "note": "DOM " + why, "status": o.get("status"), "file": rel_nemo(p), "fetch_method": o["method"],
            "sha256": hashlib.sha256(body).hexdigest(), "final_url": o.get("final_url")}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
