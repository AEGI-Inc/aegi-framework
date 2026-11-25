# -*- coding: utf-8 -*-
"""② Slack 자료 -> 공통 형식 (operation, field, id_def, event, grant_vocab).

형식 변환만 한다. 후보 판단은 하지 않는다. 출처마다 extraction 을 남긴다.

    python normalize_slack.py            # out/slack/ir/ 에 jsonl 을 쓴다
"""
import hashlib
import io
import json
import os
import re
import sys

import openpyxl

import slack_docs

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", ".."))           # finding-nemo
SLACK = os.path.join(NEMO, "slack_api_list")
RAW = os.path.join(NEMO, "aegi-knowledge", "schema", "data", "slack_raw")
OUT = os.path.join(HERE, "out", "slack", "ir")

SOURCES = {
    "inventory": ("slack_api_list/Slack_API_Methods_v1_final.xlsx", "parser"),
    "openapi": ("slack_api_list/slack_openapi.json", "machine"),
    "method_docs": ("slack_api_list/web-api", "llm_normalized"),
    "docs_cache": ("slack_api_list/web_api_docs_cache.json", "parser"),
    "scim_docs": ("slack_api_list/scim-v2", "llm_normalized"),
    "audit_schemas": ("aegi-schema/data/slack_raw/20260917_213100_schemas_audit.json", "machine"),
    "audit_actions": ("aegi-schema/data/slack_raw/20260917_213102_actions_audit.json", "machine"),
    "docs_snapshot": ("slack_api_list/docs_snapshot_2026-10-12", slack_docs.PARSER),
}
META_SKIP = {"token"}


def sha(path):
    h = hashlib.sha256()
    if os.path.isdir(path) and os.path.exists(os.path.join(path, "manifest.jsonl")):
        with open(os.path.join(path, "manifest.jsonl"), "rb") as f:     # 페이지마다 해시가 적혀 있다
            h.update(f.read())
    elif os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            if name.endswith(".md"):
                with open(os.path.join(path, name), "rb") as f:
                    h.update(name.encode() + f.read())
    else:
        with open(path, "rb") as f:
            h.update(f.read())
    return h.hexdigest()


def write(name, rows):
    os.makedirs(OUT, exist_ok=True)
    rows = sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
    with io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    return len(rows)


# ---------------------------------------------------------------- OpenAPI
def openapi_tree(spec, schema, base, side, op_id, src, out, depth=0, seen=()):
    """스키마를 펼쳐 field 행을 만든다. defs_* 참조는 펼치지 않고 ref_def 로 남긴다."""
    if not isinstance(schema, dict) or depth > 8:
        return
    if "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        if name.startswith("defs_"):
            out.append(dict(op_id=op_id, side=side, path=base, type="string", ref_def=name, src=src))
            return
        if name in seen:
            return
        return openapi_tree(spec, spec["definitions"].get(name, {}), base, side, op_id, src, out, depth + 1, seen + (name,))
    alts = schema.get("items") if isinstance(schema.get("items"), list) else None
    if alts:                                   # objs_user, objs_conversation 은 items 에 대안 목록을 둔다
        for a in alts:
            openapi_tree(spec, a, base, side, op_id, src, out, depth + 1, seen)
        return
    for key in ("anyOf", "oneOf", "allOf"):
        for a in schema.get(key, []):
            openapi_tree(spec, a, base, side, op_id, src, out, depth + 1, seen)
    t = schema.get("type")
    if t == "array":
        out.append(dict(op_id=op_id, side=side, path=base, type="array", src=src))
        openapi_tree(spec, schema.get("items", {}), base + "[*]", side, op_id, src, out, depth + 1, seen)
        return
    props = schema.get("properties")
    if t == "object" or props:
        hole = None
        if not props and not any(schema.get(k) for k in ("anyOf", "oneOf", "allOf")):
            hole = "object_no_props"
        out.append(dict(op_id=op_id, side=side, path=base, type="object", hole=hole, src=src))
        for k, v in (props or {}).items():
            openapi_tree(spec, v, base + "." + k, side, op_id, src, out, depth + 1, seen)
        return
    out.append(dict(op_id=op_id, side=side, path=base, type=t or "unknown", src=src))


def prefixes(pattern):
    """'^[UW][A-Z0-9]{2,}$' -> ['U','W'], '^Fc[A-Z0-9]{8,}$' -> ['Fc'], '^(A[A-Z0-9]{1,})?$' -> ['A']"""
    p = pattern.split("|")[0].lstrip("^").lstrip("(")
    if p.startswith("["):
        return sorted(p[1:p.index("]")])
    m = re.match(r"([A-Z][a-z]?)", p)
    return [m.group(1)] if m else []


def add_example(op, exs, src, fields, holes, extra_declared=()):
    """응답 예시(하나 또는 여럿)에서 스키마에 없는 최상위 키를 채우고 example_only 구멍으로 표시한다.
    성공 예시가 여럿이면 모두 합친다."""
    exs = [e for e in (exs if isinstance(exs, list) else [exs]) if isinstance(e, dict)]
    if not exs:
        return
    op_id = op["op_id"]
    declared = {f["path"] for f in fields if f["op_id"] == op_id and f["side"] == "response"}
    declared |= {"$." + k for k in extra_declared}
    if not op["has_response"]:
        fields.append(dict(op_id=op_id, side="response", path="$", type="object", from_example=True, src=src))
    op["has_response"] = True
    keys = []
    for e in exs:
        keys += [k for k in e if k not in keys]
    for k in keys:
        if "$." + k in declared:
            continue
        example_merge([e[k] for e in exs if k in e], "$." + k, "response", op_id, src, fields)
        holes.append(dict(op_id=op_id, path="$." + k, hole="example_only", src=src))


# ---------------------------------------------------------------- 문서 (md)
def md_blocks(text):
    """### 제목 아래 ```json 블록을 모은다."""
    out, cur = {}, None
    for m in re.finditer(r"^(#{2,3}) ([^\n]+)$|^```json\n(.*?)^```", text, re.M | re.S):
        if m.group(2):
            cur = m.group(2).strip()
        elif m.group(3) and cur and cur not in out:
            try:
                out[cur] = json.loads(m.group(3))
            except ValueError:
                pass
    return out


def example_tree(value, base, side, op_id, src, out):
    """예시 값에서 구조를 만든다. 타입 수준 자료로 쓰되 from_example 로 표시한다."""
    example_merge([value], base, side, op_id, src, out)


def example_merge(values, base, side, op_id, src, out):
    """같은 경로에 나온 예시 값 여럿을 합친다. 배열은 모든 원소를, 객체는 모든 원소의 키를 본다.
    (listAssignments 의 entity_id 는 원소마다 T, C, E 로 다르다.) 문자열 예시는 examples 에 처음 나온 순서로 모은다."""
    dicts = [v for v in values if isinstance(v, dict)]
    lists = [v for v in values if isinstance(v, list)]
    if dicts:
        out.append(dict(op_id=op_id, side=side, path=base, type="object", from_example=True, src=src))
        keys = []
        for d in dicts:
            keys += [k for k in d if k not in keys]
        for k in keys:
            example_merge([d[k] for d in dicts if k in d], base + "." + k, side, op_id, src, out)
    elif lists:
        out.append(dict(op_id=op_id, side=side, path=base, type="array", from_example=True, src=src))
        items = [x for l in lists for x in l]
        if items:
            example_merge(items, base + "[*]", side, op_id, src, out)
    else:
        types = {bool: "boolean", int: "integer", float: "number", str: "string"}
        ts = [types.get(type(v), "null") for v in values]
        t = next((x for x in ts if x != "null"), "null")
        row = dict(op_id=op_id, side=side, path=base, type=t, from_example=True, src=src)
        if len({x for x in ts if x != "null"}) > 1:
            row["types_seen"] = sorted({x for x in ts if x != "null"})
        strs = []
        for v in values:
            if isinstance(v, str) and v[:80] not in strs:
                strs.append(v[:80])
        if strs:
            row["example"] = strs[0]
        if len(strs) > 1:
            row["examples"] = strs[:20]
        out.append(row)


def main():
    manifest = {}
    for sid, (rel, how) in SOURCES.items():
        p = os.path.join(NEMO, rel)
        manifest[sid] = {"path": rel, "sha256": sha(p), "extraction": how}

    ops, fields, defs, events, vocab, holes = {}, [], [], [], {}, []

    # 1) 메서드 목록 (inventory)
    wb = openpyxl.load_workbook(os.path.join(NEMO, SOURCES["inventory"][0]), read_only=True)
    for sheet, surface in (("Web API", "rpc"), ("SCIM API v2", "rest"), ("Audit Logs API", "rest")):
        for r in list(wb[sheet].iter_rows(values_only=True))[1:]:
            if not r[0]:
                continue
            name, verb, path = r[0], r[1], r[2]
            prefix = {"Web API": "", "SCIM API v2": "scim.", "Audit Logs API": "audit."}[sheet]
            op_id = "slack." + prefix + name          # REST 는 같은 경로에 메서드가 여럿이라 벤더 메서드 이름으로 구분
            if surface == "rest":
                path = re.sub(r"^/(scim/v2|audit/v1)", "", path)
            scopes = []
            notes = (r[5] or "") if len(r) > 5 else ""
            m = re.search(r"scopes=([^;|]+)", notes)
            if m:
                scopes = sorted({s.split(":", 1)[1] if s.split(":", 1)[0] in ("user", "bot") else s
                                 for s in re.split(r"[,\s]+", m.group(1).strip()) if s})
            ops[op_id] = dict(op_id=op_id, provider="slack", surface=surface, method=name, path=path,
                              http_method=verb, params=[], scopes=scopes,
                              deprecated="deprecat" in notes.lower(),
                              has_response=False, src={"source": "inventory", "at": sheet + ":" + name})

    # 2) OpenAPI: 파라미터, 응답 스키마, ID 정의
    spec = json.load(open(os.path.join(NEMO, SOURCES["openapi"][0]), encoding="utf-8"))
    for name, d in spec["definitions"].items():
        if name.startswith("defs_") and d.get("pattern"):
            defs.append(dict(def_id=name, title=d.get("title"), prefixes=prefixes(d["pattern"]),
                             optional="|^$" in d["pattern"] or ")?$" in d["pattern"],
                             src={"source": "openapi", "at": "definitions." + name}))
    for path, item in spec["paths"].items():
        method = path.strip("/")
        op_id = "slack." + method
        verb = next(iter(k for k in item if k in ("get", "post")))
        body = item[verb]
        if op_id not in ops:
            ops[op_id] = dict(op_id=op_id, provider="slack", surface="rpc", method=method, path=method,
                              http_method=verb.upper(), params=[], scopes=[], deprecated=False,
                              has_response=False, only_in="openapi",
                              src={"source": "openapi", "at": "paths." + path})
        op = ops[op_id]
        for p in body.get("parameters", []):
            if p["name"] in META_SKIP:
                m = re.findall(r"`([a-z.:_]+)`", p.get("description", ""))
                op["scopes"] = sorted(set(op["scopes"]) | {s for s in m if ":" in s})
                continue
            op["params"].append(dict(name=p["name"], type=p.get("type"), required=bool(p.get("required")),
                                     src="openapi"))
        sch = body.get("responses", {}).get("200", {}).get("schema")
        if sch:
            op["has_response"] = True
            openapi_tree(spec, sch, "$", "response", op_id, {"source": "openapi", "at": "paths." + path}, fields)

    # 2b) 공식 문서 스냅샷: 메서드, Legal Hold, 이벤트, scope, manifest (가장 새 자료라 md 보다 먼저)
    snap = os.path.join(NEMO, SOURCES["docs_snapshot"][0])
    man = [json.loads(l) for l in io.open(os.path.join(snap, "manifest.jsonl"), encoding="utf-8")]
    pages = {m["url"].replace("https://docs.slack.dev/", ""): os.path.join(snap, m["file"])
             for m in man if m["status"] == 200}

    def page(rel):
        return io.open(pages[rel], encoding="utf-8").read()

    method_docs = {}
    for rel in sorted(pages):
        if rel.startswith("reference/methods/"):
            method_docs[rel.split("/")[-1]] = slack_docs.method_page(page(rel))
    if "reference/legal-holds-api-reference" in pages:
        method_docs.update(slack_docs.legal_hold_methods(page("reference/legal-holds-api-reference")))
    for method, d in sorted(method_docs.items()):
        op_id = "slack." + method
        src = {"source": "docs_snapshot", "at": method}
        if op_id not in ops:
            ops[op_id] = dict(op_id=op_id, provider="slack", surface="rpc", method=method, path=method,
                              http_method=d["http_method"] or "POST", params=[], scopes=[], deprecated=False,
                              has_response=False, only_in="docs_snapshot", src=src)
        op = ops[op_id]
        op["in_docs"] = True
        op["scopes"] = sorted(set(op["scopes"]) | set(d["scopes"]))
        have = {p["name"]: p for p in op["params"]}
        for p in d["params"]:
            if p["name"] in META_SKIP:
                continue
            if p["name"] in have:
                q = have[p["name"]]
                if p.get("example") and not q.get("example"):
                    q["example"] = p["example"]
                q["required"] = q["required"] or p["required"]
                continue
            op["params"].append(dict(p, src="docs_snapshot"))
        if d["examples"]:
            add_example(op, d["examples"], src, fields, holes)
        if d["unparsed_examples"] and not d["examples"]:
            holes.append(dict(op_id=op_id, path="$", hole="example_unparsed", src=src))
    for rel in sorted(pages):
        if rel.startswith("reference/events/"):
            name = rel.split("/")[-1]
            d = slack_docs.event_page(page(rel))
            src = {"source": "docs_snapshot", "at": rel}
            events.append(dict(event_id="slack.event." + name, catalog="event_api", name=name,
                               scopes=d["scopes"], src=src))
            if isinstance(d["payload"], dict):
                example_tree(d["payload"], "$", "payload", "event:" + name, src, fields)
            else:
                holes.append(dict(op_id="event:" + name, path="$", hole="example_unparsed", src=src))
    scope_names = []
    for rel in sorted(pages):
        if rel.startswith("reference/scopes/"):
            s = slack_docs.scope_page(page(rel))
            if s["name"]:
                scope_names.append((s["name"], s["token_types"], rel))
    manifest_paths = slack_docs.manifest_paths(page("reference/app-manifest")) if "reference/app-manifest" in pages else []
    mop = ops.get("slack.apps.manifest.export")
    if mop and manifest_paths:
        src = {"source": "docs_snapshot", "at": "reference/app-manifest"}
        have = {f["path"] for f in fields if f["op_id"] == mop["op_id"]}
        mset = {"$.manifest." + ".".join(mp.split(".")[:i + 1]) for mp in manifest_paths for i in range(len(mp.split(".")))}
        for f in fields:                                      # 예시로 먼저 들어온 같은 경로도 설정 스키마 필드로 표시
            if f["op_id"] == mop["op_id"] and f["path"] in mset:
                f["from_manifest_schema"] = True
        mop["has_response"] = True
        for mp in manifest_paths:                             # 구멍 $.manifest 를 manifest 스키마로 메운다
            parts = mp.split(".")
            for i in range(1, len(parts) + 1):
                path = "$.manifest." + ".".join(parts[:i])
                if path in have:
                    continue
                have.add(path)
                leaf = i == len(parts)
                fields.append(dict(op_id=mop["op_id"], side="response", path=path,
                                   type="unknown" if leaf else ("array" if parts[i - 1].endswith("[*]") else "object"),
                                   from_manifest_schema=True, src=src))
        if "$.manifest" not in have:
            fields.append(dict(op_id=mop["op_id"], side="response", path="$.manifest", type="object",
                               from_manifest_schema=True, src=src))
        mop["manifest_filled"] = True

    # 3) 메서드 문서 캐시: 파라미터와 scope
    cache = json.load(open(os.path.join(NEMO, SOURCES["docs_cache"][0]), encoding="utf-8"))
    for method, c in cache.items():
        op_id = "slack." + method
        if op_id not in ops:
            continue
        op = ops[op_id]
        op["scopes"] = sorted(set(op["scopes"]) | set(c.get("bot_scopes", [])) | set(c.get("user_scopes", [])))
        have = {p["name"] for p in op["params"]}
        for p in c.get("parameters", []):
            if p["name"] in META_SKIP or p["name"] in have:
                continue
            op["params"].append(dict(name=p["name"], type=p.get("type"), required=bool(p.get("required")),
                                     example=str(p.get("example"))[:80] if p.get("example") is not None else None,
                                     src="docs_cache"))

    # 4) 메서드 문서 (md): 응답 예시. OpenAPI 응답이 없을 때만 구조로 쓴다
    for folder, sid in (("web-api", "method_docs"), ("scim-v2", "scim_docs")):
        base = os.path.join(SLACK, folder)
        for fn in sorted(os.listdir(base)):
            if not fn.endswith(".md"):
                continue
            text = io.open(os.path.join(base, fn), encoding="utf-8").read().replace("\r\n", "\n")
            m = re.search(r"^- Path: (\S+)", text, re.M)
            if folder == "web-api":
                op_id = "slack." + fn[:-3]
            else:
                if not m:
                    continue
                verbm = re.search(r"^- HTTP Method: (\S+)", text, re.M)
                path = re.sub(r"^/scim/v2", "", m.group(1))
                op_id = next((k for k, o in ops.items() if o["surface"] == "rest" and o["path"] == path
                              and o["http_method"] == (verbm.group(1) if verbm else "GET")), None)
            if not op_id or op_id not in ops:
                continue
            op = ops[op_id]
            blocks = md_blocks(text)
            ex = blocks.get("Response Example")
            src = {"source": sid, "at": fn}
            schema = blocks.get("Normalized Response Schema") or {}
            add_example(op, ex, src, fields, holes, extra_declared=(schema.get("properties") or {}).keys())
            req = blocks.get("Normalized Request Schema") or {}
            have = {p["name"] for p in op["params"]}
            for k, v in (req.get("properties") or {}).items():
                if k in META_SKIP or k in have:
                    continue
                op["params"].append(dict(name=k, type=v.get("type"), required=k in req.get("required", []),
                                         src=sid))

    # 5) 감사 로그 카탈로그
    sch = json.load(open(os.path.join(NEMO, SOURCES["audit_schemas"][0]), encoding="utf-8"))["schemas"]
    for i, s in enumerate(sch):
        t = s["type"]
        events.append(dict(event_id="slack.audit.entity.%s.%d" % (t, i), catalog="audit_entity", name=t,
                           fields=sorted((s.get(t) or {}).keys()),
                           src={"source": "audit_schemas", "at": "schemas[%d]" % i}))
    acts = json.load(open(os.path.join(NEMO, SOURCES["audit_actions"][0]), encoding="utf-8"))["actions"]
    for cat, names in acts.items():
        for n in names:
            events.append(dict(event_id="slack.audit.action.%s" % n, catalog="audit", name=n, category=cat,
                               src={"source": "audit_actions", "at": "actions.%s" % cat}))

    # 6) 권한 어휘: 동작에 붙은 scope 를 뒤집는다 (scope 카탈로그 자체는 로컬에 없다)
    for op in ops.values():
        for s in op["scopes"]:
            v = vocab.setdefault(s, dict(grant_id="slack.scope." + s, kind="oauth_scope", name=s, op_ids=[],
                                         src={"source": "inventory+docs_cache+openapi", "at": "per-method scopes"}))
            v["op_ids"].append(op["op_id"])
    for name, types, rel in scope_names:                    # 어떤 메서드도 안 쓰는 scope 도 어휘로 남긴다
        v = vocab.setdefault(name, dict(grant_id="slack.scope." + name, kind="oauth_scope", name=name, op_ids=[],
                                        src={"source": "docs_snapshot", "at": rel}))
        v["token_types"] = types
    for e in events:
        for s in e.get("scopes", []):
            v = vocab.setdefault(s, dict(grant_id="slack.scope." + s, kind="oauth_scope", name=s, op_ids=[],
                                         src={"source": "docs_snapshot", "at": "event scopes"}))
            v.setdefault("event_ids", []).append(e["event_id"])
    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))
        if "event_ids" in v:
            v["event_ids"] = sorted(set(v["event_ids"]))

    for op in ops.values():
        op["params"] = sorted(op["params"], key=lambda p: p["name"])
    counts = dict(operations=write("operations.jsonl", ops.values()), fields=write("fields.jsonl", fields),
                  id_defs=write("id_defs.jsonl", defs), events=write("events.jsonl", events),
                  grant_vocab=write("grant_vocab.jsonl", vocab.values()), holes=write("holes.jsonl", holes))
    with io.open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts, ensure_ascii=False))
    gaps = [o["op_id"] for o in ops.values() if not o["params"] and not o["has_response"]]
    print("파라미터도 응답도 없는 동작", len(gaps))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
