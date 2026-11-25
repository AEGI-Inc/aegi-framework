# -*- coding: utf-8 -*-
"""테넌트 실측 응답 (4순위, grade observed) -> instance. 요청 경로가 적힌 _log.tsv 가 있는 폴더용 (2026-10-15).

_log.tsv 한 줄: <파일 이름> \t <요청 경로와 질의> \t <상태> ... . 응답은 <파일 이름>.json.
요청 경로를 동작 경로 틀에 맞춰(글자 조각은 같고, {} 조각은 값) 동작을 찾고, 경로 값(파라미터 이름 -> 값)을 instance.ext.request 에 남긴다.
이 값과 응답 필드 값이 같은지가 실측 왕복 근거다 (Information Map 설계.md 5절). 판정은 여기서 하지 않는다.
"""
import io
import json
import os
import urllib.parse

import core


def _segs(path):
    return [s for s in path.strip("/").split("/") if s != ""]


def match(ir, path, strip_prefix=""):
    """요청 경로 -> (동작 id, {파라미터: 값}). 글자 조각이 가장 많이 맞는 GET 동작. 둘 이상이면 None 과 후보"""
    if strip_prefix and path.startswith(strip_prefix):
        path = path[len(strip_prefix):]
    segs = [urllib.parse.unquote(s) for s in _segs(path)]
    best, cands = None, []
    for o in ir.rows["operation"].values():
        if o.get("method") != "GET" or not o.get("path"):
            continue
        t = _segs(o["path"]["template"])
        if len(t) != len(segs):
            continue
        vals, lit = {}, 0
        for a, b in zip(t, segs):
            if a.startswith("{") and a.endswith("}"):
                vals[a[1:-1]] = b
            elif a == b:
                lit += 1
            else:
                break
        else:
            cands.append((lit, o["id"], vals))
    if not cands:
        return None, None, []
    top = max(c[0] for c in cands)
    tops = sorted((c for c in cands if c[0] == top), key=lambda c: c[1])
    if len(tops) > 1:
        return None, None, [c[1] for c in tops]
    return tops[0][1], tops[0][2], []


def ingest(ir, sid, strip_prefix=""):
    d = core.nemo(core.registry()[sid]["dir"])
    log = os.path.join(d, "_log.tsv")
    n = 0
    for line in io.open(log, encoding="utf-8-sig"):
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 3:
            continue
        name, req, status = cols[0], cols[1], cols[2]
        if "200" not in status and status != "OK":
            continue
        fn = name + ".json"
        p = os.path.join(d, fn)
        if not os.path.exists(p):
            ir.issue("tenant_file_missing", {"source": sid, "file": fn}, "collect", "tenant", "로그에 있는 응답 파일이 없다")
            continue
        try:
            body = json.load(io.open(p, encoding="utf-8-sig"))
        except ValueError:
            ir.issue("tenant_file_unreadable", {"source": sid, "file": fn}, "collect", "tenant", "실측 파일을 JSON 으로 읽지 못했다")
            continue
        u = urllib.parse.urlsplit(req if "://" in req else "/" + req.lstrip("/"))
        oid, vals, amb = match(ir, u.path, strip_prefix)
        if not oid:
            ir.issue("tenant_response_without_operation" if not amb else "tenant_response_ambiguous_operation",
                     {"source": sid, "file": fn}, "normalize", "operation",
                     "실측 요청 경로에 맞는 GET 동작이 하나로 정해지지 않는다", {"path": u.path, "candidates": amb[:5]})
            continue
        row = dict(id="in:operation=%s|status=200#%s:%s" % (oid, sid, name), of={"operation": oid, "status": "200"}, value=body,
                   src=ir.src(sid, fn), grade="observed", life=ir.life())
        row["ext"] = {"request": {"path": u.path, "query": dict(urllib.parse.parse_qsl(u.query)), "params": vals}}
        ir.add("instance", row)
        n += 1
    return n
