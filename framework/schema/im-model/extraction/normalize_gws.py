# -*- coding: utf-8 -*-
"""② Google Workspace 자료 -> 공통 형식. 설정은 lexicons/gws.yaml 의 sources (2026-10-14).

    python normalize_gws.py

1. Discovery 문서 (OpenAPI 가 아니라 Google 의 기계용 명세): resources 아래 methods 를 REST 동작으로 옮긴다
   - 경로는 flatPath (없으면 path) 에서 servicePath 를 뗀 것 앞에 API 이름을 붙인다 (/directory/users/{userKey})
   - 파라미터는 location(path, query) 그대로. 요청 본문, 응답은 schemas 의 $ref 를 펼친다 (스키마 이름을 object 자리에 남긴다)
   - 동작의 scopes 는 OAuth scope 다
2. Reports API 활동 부록 쪽마다: 이벤트 이름(section meta name)과 유형(meta path), 파라미터 이름 -> 감사 action
   (catalog=audit, category=애플리케이션 이름(쪽 이름), fields=파라미터) 과 감사 필드 자리
3. OAuth scope 목록 쪽 -> 권한 어휘 (https://www.googleapis.com/auth/...)
4. Workspace Events 안내 쪽의 이벤트 유형(google.workspace.<app>.<object>.v1.<동작>) -> 이벤트

형식 변환만 한다. description 은 읽지 않는다.
"""
import hashlib
import html
import io
import json
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out", "gws", "ir")
TYPES = {"string": "string", "integer": "integer", "number": "number", "boolean": "boolean", "array": "array", "object": "object", "any": "unknown"}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def write(name, rows):
    os.makedirs(OUT, exist_ok=True)
    rows = sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
    with io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    return len(rows)


class Discovery:
    def __init__(self, path, sid):
        self.d = json.load(io.open(path, encoding="utf-8"))
        self.sid = sid
        self.schemas = self.d.get("schemas", {})

    def tree(self, schema, base, side, op_id, out, depth=0, seen=(), sname=None):
        if not isinstance(schema, dict) or depth > 8:
            return
        if "$ref" in schema:
            name = schema["$ref"]
            if name in seen:
                out.append(dict(op_id=op_id, side=side, path=base, type="object", schema=name, recursive=True, src={"source": self.sid}))
                return
            return self.tree(self.schemas.get(name, {}), base, side, op_id, out, depth + 1, seen + (name,), name)
        t = schema.get("type")
        if t == "array":
            out.append(dict(op_id=op_id, side=side, path=base, type="array", src={"source": self.sid}))
            self.tree(schema.get("items", {}), base + "[*]", side, op_id, out, depth + 1, seen)
            return
        props = schema.get("properties")
        if t == "object" or props:
            hole = None
            if not props:
                hole = "open_map" if schema.get("additionalProperties") else "object_no_props"
            row = dict(op_id=op_id, side=side, path=base, type="object", hole=hole, src={"source": self.sid})
            if sname:
                row["schema"] = sname
            out.append(row)
            for k, v in (props or {}).items():
                self.tree(v, base + "." + k, side, op_id, out, depth + 1, seen)
            return
        row = dict(op_id=op_id, side=side, path=base, type=TYPES.get(t, "unknown"), src={"source": self.sid})
        if schema.get("format"):
            row["format"] = schema["format"]
        if schema.get("enum"):
            row["enum"] = [str(x) for x in schema["enum"]][:30]
        out.append(row)

    def methods(self, res=None, prefix=""):
        res = self.d if res is None else res
        for name, m in sorted((res.get("methods") or {}).items()):
            yield m
        for name, r in sorted((res.get("resources") or {}).items()):
            yield from self.methods(r)


def main():
    cfg = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", "gws.yaml"), encoding="utf-8"))["sources"]
    ops, fields, events, vocab, holes, manifest = {}, [], [], {}, [], {}

    # 1. Discovery
    for src in cfg["discovery"]:
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=sha(path), extraction="machine")
        dv = Discovery(path, src["id"])
        api = src.get("api") or dv.d["name"]
        svc = dv.d.get("servicePath", "")
        for m in dv.methods():
            raw = m.get("flatPath") or m.get("path") or ""
            rel = raw[len(svc):] if svc and raw.startswith(svc) else raw
            if src.get("strip") and rel.startswith(src["strip"]):
                rel = rel[len(src["strip"]):]
            rel = re.sub(r"^v\d+(beta\d+)?/", "", rel)
            p = "/%s/%s" % (api, rel.strip("/"))
            p = re.sub(r"\{\+?([^}]+)\}", r"{\1}", p)
            p = re.sub(r"\}:([A-Za-z]+)", r"}/\1", p)      # 사용자 정의 메서드 {alertId}:undelete -> {alertId}/undelete
            op_id = "gws." + m["id"]
            params = []
            for pn, pv in sorted((m.get("parameters") or {}).items()):
                if pv.get("location") not in ("path", "query"):
                    continue
                params.append(dict(name=pn, **{"in": pv["location"]}, required=bool(pv.get("required")),
                                   type=pv.get("type"), enum=bool(pv.get("enum"))))
            if m.get("request"):
                rs = dv.schemas.get(m["request"].get("$ref"), {})
                for k, v in (rs.get("properties") or {}).items():
                    params.append(dict(name=k, **{"in": "body"}, required=False, type=v.get("type")))
                dv.tree(m["request"], "$", "request", op_id, fields)
            has_resp = False
            if m.get("response"):
                dv.tree(m["response"], "$", "response", op_id, fields)
                has_resp = True
            scopes = sorted(m.get("scopes") or [])
            ops[op_id] = dict(op_id=op_id, provider="gws", surface="rest", method=m["id"], path=p,
                              http_method=m.get("httpMethod", "GET"), params=params, scopes=scopes, deprecated=False,
                              has_response=has_resp, src={"source": src["id"], "at": m["id"]})
            for s in scopes:
                vocab.setdefault(s, dict(grant_id="gws.scope." + s, kind="oauth_scope", name=s, op_ids=[],
                                         src={"source": src["id"], "at": "method scopes"}))["op_ids"].append(op_id)
        for s in ((dv.d.get("auth") or {}).get("oauth2") or {}).get("scopes") or {}:
            vocab.setdefault(s, dict(grant_id="gws.scope." + s, kind="oauth_scope", name=s, op_ids=[],
                                     src={"source": src["id"], "at": "auth.oauth2.scopes"}))
    for f in fields:
        if f.get("hole"):
            holes.append(dict(op_id=f["op_id"], path=f["path"], hole=f["hole"], src=f["src"]))

    # 2. Reports 활동 부록
    afields = {}
    for src in cfg.get("reports_activity", []):
        base = os.path.join(NEMO, src["dir"])
        files = sorted(f for f in os.listdir(base) if f.startswith(src["prefix"]))
        for fn in files:
            app = fn[len(src["prefix"]):]
            path = os.path.join(base, fn)
            manifest["%s:%s" % (src["id"], app)] = dict(path=os.path.join(src["dir"], fn).replace("\\", "/"), sha256=sha(path),
                                                       extraction="parser@1")
            t = io.open(path, encoding="utf-8").read()
            for sec in re.findall(r'<section itemscope itemtype="http://developers.google.com/ReferenceObject">(.*?)</section>', t, re.S):
                mt = re.search(r'<meta itemprop="path" content="([^"]*)"', sec)
                mn = re.search(r'<meta itemprop="name" content="([^"]*)"', sec)
                if not mn:
                    continue
                pars = []
                for code in re.findall(r'<code itemprop="property"[^>]*>(.*?)</code>', sec, re.S):
                    pars.append(html.unescape(re.sub(r"<[^>]+>", "", code)).strip().lower())
                name = mn.group(1).lower()
                cat = app.replace("-", "_")
                events.append(dict(event_id="gws.audit.action.%s.%s" % (cat, name), catalog="audit", name=name, category=cat,
                                   type=(mt.group(1) if mt else None), fields=sorted(set(pars)),
                                   src={"source": src["id"], "at": "%s %s" % (app, mn.group(1))}))
                for pn in pars:
                    afields.setdefault(pn, 1)
    for k in sorted(afields):
        fields.append(dict(op_id="audit:" + k, side="audit", path="$." + k, type="string", src={"source": "gws_reports_activity"}))

    # 3. OAuth scope 목록
    for src in cfg.get("scope_docs", []):
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=sha(path), extraction="parser@1")
        t = io.open(path, encoding="utf-8").read()
        for s in sorted(set(re.findall(r"https://www\.googleapis\.com/auth/[a-zA-Z0-9._/-]+", t))):
            s = s.rstrip(".")
            v = vocab.setdefault(s, dict(grant_id="gws.scope." + s, kind="oauth_scope", name=s, op_ids=[],
                                         src={"source": src["id"], "at": "scope list"}))
            v["listed"] = True

    # 4. Workspace Events 이벤트 유형
    for src in cfg.get("event_docs", []):
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=sha(path), extraction="parser@1")
        t = io.open(path, encoding="utf-8").read()
        for n in sorted(set(re.findall(r"google\.workspace\.[a-z]+\.[a-zA-Z]+\.v\d+\.[a-zA-Z]+", t))):
            events.append(dict(event_id="gws.event." + n, catalog="event_api", name=n, scopes=[], src={"source": src["id"]}))

    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))
    counts = dict(operations=write("operations.jsonl", ops.values()), fields=write("fields.jsonl", fields),
                  id_defs=write("id_defs.jsonl", []), events=write("events.jsonl", events),
                  grant_vocab=write("grant_vocab.jsonl", vocab.values()), holes=write("holes.jsonl", holes))
    with io.open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
