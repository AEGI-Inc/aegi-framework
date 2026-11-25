# -*- coding: utf-8 -*-
"""출처 등록부 registry.json 을 만든다 (IR 설계.md 3.1, 9절).

    python build_registry.py

합치는 것:
- catalog.yaml 의 출처 정의 (id, provider, kind, rank, naming, 파일 또는 폴더)
- 받은 목록: finding-nemo/*_api_list/*/manifest.jsonl (예전 fetch.py, curl), ir2/collect/snapshots/*/manifest.jsonl (새 사다리),
  ir2/collect/inbox/manifest.jsonl (사람이 넣은 파일)
- 규칙 출처 (Google Reports 활동 부록 쪽마다 하나), Discovery 11종 (lexicons/gws.yaml)
- catalog 에 없는 받은 파일도 used=false 로 남긴다 (등록부는 받은 것 전부다)

해시는 파일 내용으로 다시 계산한다. 폴더 출처는 (파일 이름, 내용)을 이름 순으로 이어 해시한다.
"""
import glob
import hashlib
import io
import json
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
CE = os.path.normpath(os.path.join(HERE, "..", ".."))


def rel(p):
    return os.path.relpath(p, NEMO).replace("\\", "/")


def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def dir_files(d, prefix=None):
    out = []
    for fn in sorted(os.listdir(d)):
        if fn == "desktop.ini" or (prefix and not fn.startswith(prefix)):
            continue
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            out.append(p)
    return out


def sha_dir(files):
    h = hashlib.sha256()
    for p in files:
        h.update(os.path.basename(p).encode("utf-8") + b"\0")
        with open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()


def snapshot_of(path):
    m = re.search(r"snapshot_(\d{4}-\d{2}-\d{2})", path)
    return m.group(1) if m else None


def main():
    cat = yaml.safe_load(io.open(os.path.join(HERE, "catalog.yaml"), encoding="utf-8"))
    by_file = {}
    for mp in sorted(glob.glob(os.path.join(NEMO, "*_api_list", "*", "manifest.jsonl"))):
        base = os.path.dirname(mp)
        for l in io.open(mp, encoding="utf-8"):
            d = json.loads(l)
            f = rel(os.path.join(base, d["file"]))
            by_file[f] = {"url": d["url"], "fetched_at": d.get("retrieved_at"), "status": d.get("status"),
                          "fetch_method": "http", "manifest": rel(mp)}
    ir2 = {}
    for mp in sorted(glob.glob(os.path.join(HERE, "snapshots", "*", "manifest.jsonl"))):
        for l in io.open(mp, encoding="utf-8"):
            d = json.loads(l)
            ir2[d["id"]] = dict(d, manifest=rel(mp))
            if d.get("file"):
                by_file.setdefault(d["file"], {"url": d["url"], "fetched_at": d["retrieved_at"], "status": d["status"],
                                               "fetch_method": d["fetch_method"], "manifest": rel(mp)})
    inbox = os.path.join(HERE, "inbox", "manifest.jsonl")
    if os.path.exists(inbox):
        for l in io.open(inbox, encoding="utf-8"):
            d = json.loads(l)
            by_file[d["file"]] = {"url": d.get("url"), "fetched_at": d["registered_at"], "status": 200,
                                  "fetch_method": "human", "manifest": rel(inbox)}

    out, used_files = [], set()

    def finish(e):
        if e.get("dir"):
            d = os.path.join(NEMO, e["dir"])
            e["file"] = e["dir"] + ("/" + e["dir_glob"] + "*" if e.get("dir_glob") else "")
            if not os.path.isdir(d):
                e["files"] = 0
                e["sha256"] = ""
                e["missing"] = True
            else:
                files = dir_files(d, e.get("dir_glob"))
                e["files"] = len(files)
                e["sha256"] = sha_dir(files)
                for p in files:
                    used_files.add(rel(p))
        else:
            p = os.path.join(NEMO, e["file"])
            if not os.path.isfile(p):
                e["sha256"] = ""
                e["missing"] = True
            else:
                e["sha256"] = sha_file(p)
                used_files.add(e["file"])
        m = by_file.get(e["file"], {})
        if e.get("dir") and e.get("manifest"):
            e.setdefault("fetched_at", "%s (폴더, 쪽마다 manifest)" % snapshot_of(e["manifest"]))
            e.setdefault("fetch_method", "http")
        e.setdefault("url", m.get("url"))
        e.setdefault("fetched_at", m.get("fetched_at"))
        e.setdefault("fetch_method", m.get("fetch_method") or "prior_snapshot")
        e.setdefault("snapshot", snapshot_of(e["file"]) or (e.get("fetched_at") or "")[:10] or None)
        e.setdefault("version", None)
        e.setdefault("used", True)
        if m.get("status") not in (None, 200):
            e["http_status"] = m["status"]
        out.append(e)

    for s in cat["sources"]:
        e = dict(s)
        if e.pop("from_snapshot", None):
            d = ir2.get(e["id"])
            if not d:
                e.setdefault("file", "")
                e["sha256"] = ""
                e["missing"] = True
                e.setdefault("url", None)
                e.setdefault("fetched_at", None)
                e.setdefault("fetch_method", "prior_snapshot")
                e.setdefault("snapshot", None)
                e.setdefault("version", None)
                e.setdefault("used", True)
                out.append(e)
                continue
            e.update(file=d["file"], url=d["url"], fetched_at=d["retrieved_at"], fetch_method=d["fetch_method"],
                     snapshot=snapshot_of(d["manifest"]))
            if d.get("version") and not e.get("version"):
                e["version"] = d["version"]
            e["ladder"] = d["ladder"]
        finish(e)
    for r in cat.get("rules", []):
        rd = os.path.join(NEMO, r["dir"])
        if not os.path.isdir(rd):
            continue
        for p in dir_files(rd, r["name_prefix"]):
            name = os.path.basename(p)[len(r["name_prefix"]):]
            e = {k: r[k] for k in ("provider", "kind", "rank", "naming")}
            e["id"] = r["id_prefix"] + re.sub(r"[^a-z0-9]+", "_", name.lower())
            e["file"] = rel(p)
            e["app"] = name
            finish(e)
    if cat.get("gws_discovery_from_lexicon"):
        gws_lx = os.path.join(CE, "lexicons", "gws.yaml")
        if os.path.isfile(gws_lx):
            lx = yaml.safe_load(io.open(gws_lx, encoding="utf-8"))
            for d in lx["sources"]["discovery"]:
                if not os.path.isfile(os.path.join(NEMO, d["path"])):
                    continue
                e = {"id": d["id"], "provider": "gws", "kind": "api_schema", "rank": 1, "naming": "discovery",
                     "file": d["path"], "api": d["api"]}
                if d.get("strip"):
                    e["strip"] = d["strip"]
                finish(e)
    # 사전 파일 (curated 사실의 출처). 사람이 쓴 판단이라 순위 2(문서 수준)로 둔다
    for fn in sorted(os.listdir(os.path.join(CE, "lexicons"))):
        if fn.endswith(".yaml"):
            finish({"id": "lex_" + fn[:-5], "provider": fn[:-5], "kind": "lexicon", "rank": 2, "naming": "lexicon",
                    "file": rel(os.path.join(CE, "lexicons", fn)), "fetch_method": "human", "snapshot": "2026-10-15",
                    "note": "사람이 정한 사전. 줄마다 이유가 있다"})
    # 등록되지 않은 받은 파일 (used=false)
    ids = {e["id"] for e in out}
    for f, m in sorted(by_file.items()):
        if f in used_files or not os.path.isfile(os.path.join(NEMO, f)) or f.endswith("desktop.ini"):
            continue
        if f.startswith("slack_api_list/docs_snapshot_2026-10-12/"):
            continue                                          # 폴더 출처 (slack_docs_*) 가 덮는다
        sid = "unused__" + re.sub(r"[^a-z0-9]+", "_", os.path.basename(f).lower())[:90]
        if sid in ids:
            continue
        ids.add(sid)
        e = {"id": sid, "provider": f.split("_api_list")[0] if "_api_list" in f else "ir2", "kind": "api_doc",
             "rank": 2, "naming": "unknown", "file": f, "used": False}
        finish(e)
    out.sort(key=lambda e: e["id"])
    with io.open(os.path.join(HERE, "registry.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"sources": out}, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    print("출처", len(out), "사용", sum(1 for e in out if e["used"]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
