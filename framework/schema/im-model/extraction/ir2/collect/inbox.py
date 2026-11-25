# -*- coding: utf-8 -*-
"""수집 사다리 4단: 사람이 받은 파일을 등록한다.

사람이 inbox/pending.jsonl 의 주소를 브라우저로 열어 저장한 파일을 inbox/<provider>/ 에 넣는다.
파일 이름 앞에 대상 id 를 붙인다 (예: sf_setup_audit_trail_help__page.html).

    python inbox.py

inbox/manifest.jsonl 에 (id, provider, file, sha256, registered_at, fetch_method=human) 을 남긴다.
같은 해시는 다시 적지 않는다. build_registry.py 가 이 목록을 출처 등록부에 합친다.
"""
import hashlib
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
INBOX = os.path.join(HERE, "inbox")


def main():
    os.makedirs(INBOX, exist_ok=True)
    mpath = os.path.join(INBOX, "manifest.jsonl")
    seen = set()
    if os.path.exists(mpath):
        seen = {json.loads(l)["sha256"] for l in io.open(mpath, encoding="utf-8")}
    pending = {}
    pp = os.path.join(INBOX, "pending.jsonl")
    if os.path.exists(pp):
        for l in io.open(pp, encoding="utf-8"):
            d = json.loads(l)
            pending[d["id"]] = d
    new = []
    for prov in sorted(os.listdir(INBOX)):
        d = os.path.join(INBOX, prov)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn == "desktop.ini":
                continue
            p = os.path.join(d, fn)
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            if h in seen:
                continue
            tid = fn.split("__", 1)[0]
            t = pending.get(tid, {})
            new.append({"id": tid, "provider": prov, "url": t.get("url"), "sha256": h, "fetch_method": "human",
                        "file": os.path.relpath(p, NEMO).replace("\\", "/"),
                        "registered_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            seen.add(h)
    with io.open(mpath, "a", encoding="utf-8", newline="\n") as f:
        for r in new:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    print("등록", len(new))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
