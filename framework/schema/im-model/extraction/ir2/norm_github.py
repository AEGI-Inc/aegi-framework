# -*- coding: utf-8 -*-
"""GitHub (GHEC) -> IR2. 범위: GHEC REST, GHEC GraphQL, 웹훅, 감사 로그 (IR 설계.md 1절). GHES 전용은 없다(GHEC 명세만 읽는다).

    python norm_github.py

1. REST: 최신 GHEC 명세(descriptions-next/ghec.2026-03-10.json, OpenAPI 3.1, 2026-10-15 받음)의 경로.
   x-github.removalDate 가 받은 날짜보다 앞이면 뺀다
2. 웹훅: 같은 명세의 webhooks 절. 2026-09-03 판(드라이브)과의 어긋남은 문제로 남긴다
3. 웹훅 body 문서(webhook-payload-samples/fpt): 같은 이벤트와 action 의 카탈로그에 웹훅 종류(availability)를 붙인다
4. 감사: 2026-09-03 기계 목록과 2026-10-13 문서 3쪽을 출처마다 따로 카탈로그로 (4.3절, 덮어쓰지 않는다)
5. 권한: GitHub App 권한, 세분화 PAT 권한 문서 표 -> 권한 어휘와 동작, OAuth scope 문서 -> 권한 어휘
6. GraphQL SDL -> 모양, 동작(query, mutation), 키 선언(Node + id: ID!), 참조 선언(필드 타입), 바인딩(node, nodes)
7. 사전 판단은 쓰지 않는다 (IR 설계.md 11절, 2026-10-15). 키는 원문 근거(GraphQL ID! + Node)만
"""
import io
import json
import os
import re
import sys

import core
import openapi2
import tenant_log
import sdl2

P = "github"
SNAP_LATEST = "gh_rest_ghec_next_2026_03_10_latest"
SNAP_DRIVE = "gh_rest_ghec_2026_03_10_drive"
SDL = "gh_graphql_ghec_2026_10_13"
SCALARS = {"String": "string", "Int": "integer", "Float": "number", "Boolean": "boolean", "ID": "string"}


def gh_lifecycle(snapshot):
    def f(o, state):
        xg = o.get("x-github") or {}
        rem = xg.get("removalDate")
        if rem and rem <= snapshot:
            return "removed", rem
        if xg.get("deprecationDate") or rem or o.get("deprecated"):
            return "deprecated", rem
        return state, None
    return f


def rest(ir):
    """REST 경로와 웹훅 모두 최신 3.1 판(descriptions-next, 2026-10-15)에서 읽는다. 2026-09-03 판과의 어긋남은 문제로 남긴다"""
    snap = core.registry()[SNAP_LATEST]["snapshot"]
    conv = openapi2.OpenAPIConv(ir, SNAP_LATEST, lifecycle=gh_lifecycle(snap))
    conv.run()
    old = core.load_spec(core.nemo(core.registry()[SNAP_DRIVE]["file"]))
    ops = lambda s: {(m.upper(), p) for p, it in s["paths"].items() for m in it if m in openapi2.METHODS}
    a, b = ops(old), ops(conv.s)
    wa, wb = set(old.get("webhooks") or {}), set(conv.s.get("webhooks") or {})
    if a != b or wa != wb:
        ir.issue("source_version_skew", {"sources": [SNAP_DRIVE, SNAP_LATEST]}, "collect", "source",
                 "같은 API 판(2026-03-10)의 두 받은 날짜(2026-09-03, 2026-10-15) 사이에 동작과 웹훅이 다르다. 최신을 쓴다",
                 {"ops_only_old": len(a - b), "ops_only_new": len(b - a), "webhooks_only_old": sorted(wa - wb),
                  "webhooks_only_new": sorted(wb - wa), "sample_ops_only_new": ["%s %s" % x for x in sorted(b - a)[:10]]})
    return conv


def webhook_docs(ir):
    """webhook-payload-samples/fpt: 이벤트(category)와 action 마다 body 인자 문서. 같은 이벤트, action 의 웹훅 카탈로그를
    payload 모양의 action enum 값으로 정확히 찾아 웹훅 종류(availability)를 붙인다. 없으면 새 카탈로그로 둔다"""
    sid = "gh_webhook_samples_2026_09_03"
    e = core.registry()[sid]
    d = core.nemo(e["dir"])
    by_cat = {}
    for c in ir.rows["catalog"].values():
        if c["catalog"] == "event" and c.get("payload"):
            by_cat.setdefault(c["category"], []).append(c)

    def action_enum(shape_id):
        sh = ir.get("shape", shape_id) or {}
        for p in sh.get("props") or []:
            if p["name"] == "action":
                return p.get("enum") or []
        return []
    matched = 0
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".json") or ".child-params." in fn:
            continue
        doc = json.load(io.open(os.path.join(d, fn), encoding="utf-8"))
        for act, v in sorted(doc.items()):
            cat, action = v.get("category"), v.get("action")
            hit = [c for c in by_cat.get(cat, []) if action in action_enum(c["payload"])] if action != "default" else \
                  [c for c in by_cat.get(cat, []) if not action_enum(c["payload"])]
            if len(hit) == 1:
                hit[0]["ext"]["availability"] = v.get("availability")
                hit[0]["ext"]["doc_source"] = sid
                matched += 1
                continue
            cid = "cat:event:%s:%s:%s" % (sid, cat, action)
            props = [{"name": p["name"], "scalar": p.get("type"), "required": bool(p.get("isRequired"))}
                     for p in v.get("bodyParameters") or [] if p.get("name")]
            pid = "sh:%s:%s:%s" % (sid, cat, action)
            ir.add("shape", dict(id=pid, name=None, origin="inline", kind="object", props=props,
                                 src=ir.src(sid, "%s#%s.bodyParameters" % (fn, act)), grade="stated", life=ir.life()))
            row = dict(id=cid, catalog="event", key=cat, display=None, category=cat, payload=pid, targets=[],
                       src=ir.src(sid, "%s#%s" % (fn, act)), grade="stated", life=ir.life())
            row["ext"] = {"action": action, "availability": v.get("availability"), "unmatched_in_openapi": True}
            ir.add("catalog", row)
    return matched


def audit(ir):
    # 2026-09-03 기계 목록
    sid = "gh_audit_events_2026_09_03"
    acts = {}
    for l in io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8"):
        a = json.loads(l)
        x = acts.setdefault(a["action"], {"category": a["category"], "fields": [], "scopes": set(), "products": set(),
                                          "availability": set(), "event_ids": []})
        for f in a.get("fields") or []:
            if f not in x["fields"]:
                x["fields"].append(f)
        x["scopes"].add(a.get("scope"))
        x["products"] |= set(a.get("products") or [])
        x["availability"] |= set(a.get("availability") or [])
        x["event_ids"].append(a["event_id"])
    for name, x in sorted(acts.items()):
        audit_row(ir, sid, name, x["category"], x["fields"], "action=%s" % name,
                  {"scopes": sorted(s for s in x["scopes"] if s), "products": sorted(x["products"]),
                   "availability": sorted(x["availability"])})
    # 2026-10-13 문서 (마크다운 원문)
    for sid in ("gh_audit_doc_enterprise_2026_10_13", "gh_audit_doc_org_2026_10_13", "gh_audit_doc_user_2026_10_13"):
        text = io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8").read()
        common = []
        m = re.search(r"included in most audit log events: (.+)", text)
        if m:
            common = re.findall(r"`([^`]+)`", m.group(1))
        cat = None
        for blk in re.split(r"\n(?=#{3,4} )", text):
            h = re.match(r"^### (.+)", blk)
            if h:
                cat = h.group(1).strip().replace("\\_", "_")
                continue
            h = re.match(r"^#### `([^`]+)`", blk)
            if not h:
                continue
            action = h.group(1)
            add = []
            m = re.search(r"\*\*Additional fields:\*\*(.+)", blk)
            if m:
                add = re.findall(r"`([^`]+)`", m.group(1))
            fields = list(common) + [f for f in add if f not in common]
            audit_row(ir, sid, action, cat, fields, "#### %s" % action, {"common_fields": len(common)})


def audit_row(ir, sid, key, category, fields, loc, ext):
    pid = "sh:%s:%s" % (sid, key)
    ir.add("shape", dict(id=pid, name=None, origin="example_derived", kind="object",
                         props=[{"name": f, "scalar": "any", "required": False} for f in fields],
                         src=ir.src(sid, loc), grade="stated", life=ir.life()))
    ir.add("hole", dict(id="hole:untyped_field_list:%s" % pid, at={"shape": pid}, hole="untyped_field_list",
                        reason="필드 이름 목록뿐이고 타입이 없다", src=ir.src(sid, loc), grade="stated", life=ir.life()))
    row = dict(id="cat:audit:%s:%s" % (sid, key), catalog="audit", key=key, display=None, category=category,
               payload=pid, targets=[], src=ir.src(sid, loc), grade="stated", life=ir.life())
    row["ext"] = ext
    ir.add("catalog", row)


def permissions(ir, conv):
    by_key = {}
    for o in ir.rows["operation"].values():
        if o["src"]["source"] == SNAP_LATEST:
            by_key[(o["method"], o["ext"]["raw_path"])] = o["id"]
    unmatched = 0
    for sid, kind in (("gh_app_permissions", "app_permission"), ("gh_pat_permissions", "app_permission")):
        cur = None
        tag = "app" if sid == "gh_app_permissions" else "fine_grained_pat"
        for line in io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8"):
            m = re.match(r'^## (Enterprise|Organization|Repository|Account|User) permissions for "(.+)"', line)
            if m:
                cur = (m.group(1).lower(), m.group(2))
                continue
            m = re.match(r"^\| `(GET|POST|PUT|PATCH|DELETE) ([^`]+)` \| (\w+) \|", line)
            if m and cur:
                name = "%s:%s:%s" % (cur[0], cur[1], m.group(3))
                gid = "gr:app_permission:%s" % name
                if not ir.has("grant", gid):
                    g = dict(id=gid, kind=kind, name=name, operations=[], src=ir.src(sid, "%s permissions for %s" % cur),
                             grade="stated", life=ir.life())
                    g["ext"] = {"token_types": []}
                    ir.add("grant", g)
                g = ir.get("grant", gid)
                if tag not in g["ext"]["token_types"]:
                    g["ext"]["token_types"] = sorted(g["ext"]["token_types"] + [tag])
                oid = by_key.get((m.group(1), m.group(2)))
                if oid:
                    if oid not in g["operations"]:
                        g["operations"] = sorted(g["operations"] + [oid])
                    op = ir.get("operation", oid)
                    if gid not in op["grants"]:
                        op["grants"] = sorted(op["grants"] + [gid])
                else:
                    unmatched += 1
    if unmatched:
        ir.issue("grant_operation_unmatched", {"sources": ["gh_app_permissions", "gh_pat_permissions"]}, "collect", "source",
                 "권한 문서의 엔드포인트가 최신 REST 명세에 없다 (문서와 명세 판 어긋남)", {"rows": unmatched})
    sid = "gh_oauth_scopes"
    for line in io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8"):
        m = re.match(r"^\|\s*\**`([a-z_:]+)`\**\s*\|", line)
        if m:
            ir.add("grant", dict(id="gr:oauth_scope:%s" % m.group(1), kind="oauth_scope", name=m.group(1), operations=[],
                                 src=ir.src(sid, "Available scopes"), grade="stated", life=ir.life()))


# ---------------------------------------------------------------------- GraphQL
def graphql(ir):
    e = core.registry()[SDL]
    snap = e["snapshot"]
    rows = sdl2.parse(io.open(core.nemo(e["file"]), encoding="utf-8").read())
    types = {r["name"]: r for r in rows if r["kind"] != "schema"}
    schema = next((r for r in rows if r["kind"] == "schema"), {"ops": {"query": "Query", "mutation": "Mutation"}})
    sid = lambda n: "sh:%s:%s" % (SDL, n)
    node_impl = {r["name"] for r in rows if "Node" in r.get("implements", [])}
    H = lambda loc, grade="stated", life=None: {"src": ir.src(SDL, loc), "grade": grade, "life": life or ir.life()}

    def life_of(dirs):
        dep, rem = sdl2.removal(dirs)
        if rem and rem <= snap:
            return None
        return ir.life("deprecated", rem) if dep else ir.life()

    def ref(t, inline_id, loc):
        """GraphQL 타입 참조 -> 서술 {'shape'} 또는 {'scalar'}. 목록이면 인라인 배열 모양을 만든다"""
        base = {"scalar": SCALARS[t["name"]]} if t["name"] in SCALARS else {"shape": sid(t["name"])}
        if t["name"] == "ID":
            base["format"] = "ID"
        if not t["list"]:
            return base
        ir.add("shape", dict(id=inline_id, name=None, origin="inline", kind="array", items=dict(base, required=t.get("item_required", False)),
                             **H(loc)))
        return {"shape": inline_id}

    for name, r in sorted(types.items()):
        loc = "%s %s" % ({"object": "type", "input": "input"}.get(r["kind"], r["kind"]), name)
        if r["kind"] == "scalar":
            if name not in SCALARS:
                ir.add("shape", dict(id=sid(name), name=name, origin="named", kind="scalar", scalar={"scalar": name}, **H(loc)))
            continue
        if r["kind"] == "enum":
            vals = [v["name"] for v in r.get("values", []) if life_of(v["directives"]) is not None]
            dep = sorted(v["name"] for v in r.get("values", []) if sdl2.removal(v["directives"])[0] and life_of(v["directives"]))
            row = dict(id=sid(name), name=name, origin="named", kind="scalar", scalar={"scalar": "enum", "enum": vals}, **H(loc))
            row["ext"] = {"graphql_kind": "enum", "deprecated_values": dep} if dep else {"graphql_kind": "enum"}
            ir.add("shape", row)
            continue
        if r["kind"] == "union":
            row = dict(id=sid(name), name=name, origin="named", kind="union", alts=[sid(x) for x in r["possible_types"]],
                       alt_kind="distinct", **H(loc))
            row["ext"] = {"graphql_kind": "union"}
            ir.add("shape", row)
            continue
        props, field_args = [], {}
        for f in r.get("fields", []):
            lf = life_of(f.get("directives"))
            if lf is None:
                ir.dropped.append({"graphql_field": "%s.%s" % (name, f["name"]), "removal": sdl2.removal(f.get("directives"))[1]})
                continue
            p = {"name": f["name"]}
            p.update(ref(f["type"], "%s.%s" % (sid(name), f["name"]), "%s.%s" % (loc, f["name"])))
            p["required"] = f["type"]["required"]
            if lf["state"] == "deprecated":
                p["deprecated"] = True
                if lf.get("sunset"):
                    p["sunset"] = lf["sunset"]
            props.append(p)
            if f.get("args"):
                field_args[f["name"]] = [{"name": a["name"], "type": a["type"]["name"], "list": a["type"]["list"],
                                          "required": a["type"]["required"]} for a in f["args"]]
        row = dict(id=sid(name), name=name, origin="named", kind="union" if r["kind"] == "interface" else "object",
                   props=props, **H(loc))
        if r["kind"] == "interface":
            row["alts"] = [sid(x) for x in r.get("possible_types", [])]
            row["alt_kind"] = "subtype"
        row["ext"] = {"graphql_kind": r["kind"]}
        if r.get("implements"):
            row["ext"]["implements"] = r["implements"]
        if field_args:
            row["ext"]["field_args"] = field_args
        ir.add("shape", row)
        # 키 선언: Node 구현 + id: ID! (stated)
        idf = next((f for f in r.get("fields", []) if f["name"] == "id"), None)
        if idf and idf["type"]["name"] == "ID" and idf["type"]["required"] and (name in node_impl or name == "Node"):
            ir.add("key_decl", dict(id="kd:%s:%s" % (SDL, name), shape=sid(name), props=["id"], form="global",
                                    evidence="GraphQL ID! + Node", **H("%s.id" % loc)))
        # 참조 선언: 필드 타입이 객체, 인터페이스, union (stated). Root 동작 타입은 뺀다(동작으로 옮긴다)
        if name in schema["ops"].values() or r["kind"] == "input":
            continue
        for f in r.get("fields", []):
            t = types.get(f["type"]["name"])
            if not t or t["kind"] not in ("object", "interface", "union") or life_of(f.get("directives")) is None:
                continue
            poly = t["kind"] in ("interface", "union")
            to = [sid(x) for x in t.get("possible_types", [])] if poly else [sid(t["name"])]
            rr = dict(id="rd:%s:%s.%s" % (SDL, name, f["name"]), **{"from": {"shape": sid(name), "prop": f["name"]}},
                      to={"shapes": to}, poly=poly, **H("%s.%s" % (loc, f["name"])))
            rr["ext"] = {"declared_type": t["name"], "list": f["type"]["list"]}
            ir.add("ref_decl", rr)
    # 동작: Query, Mutation 필드
    for root, surface_kind in ((schema["ops"].get("query", "Query"), "query"), (schema["ops"].get("mutation", "Mutation"), "mutation")):
        r = types.get(root)
        if not r:
            continue
        for f in r.get("fields", []):
            lf = life_of(f.get("directives"))
            if lf is None:
                continue
            oid = "op:%s:%s.%s" % (SDL, root, f["name"])
            loc = "type %s.%s" % (root, f["name"])
            rt = types.get(f["type"]["name"], {})
            if surface_kind == "mutation":
                kind, kg = "action", "stated"
            elif f["type"]["list"]:
                kind, kg = "read_many", "stated"
            elif f["type"]["name"].endswith("Connection"):
                kind, kg = "read_many", "transform"
            else:
                kind, kg = "read_one", "stated"
            params, request = [], None
            for a in f.get("args", []):
                if surface_kind == "mutation" and a["name"] == "input":
                    request = sid(a["type"]["name"])
                    continue
                e = {"name": a["name"], "in": "query", "required": a["type"]["required"]}
                e.update(ref(a["type"], "sh:%s:op:%s.%s:arg:%s" % (SDL, root, f["name"], a["name"]), loc + "(" + a["name"] + ")"))
                params.append(e)
            resp = ref(f["type"], "sh:%s:op:%s.%s:resp" % (SDL, root, f["name"]), loc)
            rshape = resp.get("shape") or sid(f["type"]["name"])
            if "scalar" in resp:
                rid = "sh:%s:op:%s.%s:resp" % (SDL, root, f["name"])
                ir.add("shape", dict(id=rid, name=None, origin="inline", kind="scalar", scalar=resp, **H(loc)))
                rshape = rid
            row = dict(id=oid, surface="graphql", name="%s.%s" % (root, f["name"]), method=None, kind=kind, kind_grade=kg,
                       path=None, params=params, request=request,
                       responses=[{"status": None, "media": "application/graphql-response+json", "shape": rshape}],
                       grants=[], **H(loc, "stated", lf))
            row["ext"] = {"graphql_root": root}
            if kg == "transform":
                row["ext"]["kind_rule"] = "Relay Connection 규약: XxxConnection 을 돌려주면 목록"
            ir.add("operation", row)
            # 바인딩: node(id), nodes(ids) 는 Relay 규약으로 Node 키를 받는다 (stated, GitHub 스키마가 Node 를 명시)
            for a in f.get("args", []):
                if a["type"]["name"] != "ID":
                    continue
                if surface_kind == "query" and f["type"]["name"] == "Node":
                    ir.add("binding", dict(id="bd:%s:%s.%s:%s" % (SDL, root, f["name"], a["name"]), operation=oid,
                                           param=a["name"], to={"key_decl": "kd:%s:Node" % SDL}, **H(loc)))
                elif surface_kind == "query" and f["type"]["name"] in node_impl and not f["type"]["list"] and \
                        sum(1 for x in f.get("args", []) if x["type"]["name"] == "ID") == 1:
                    b = dict(id="bd:%s:%s.%s:%s" % (SDL, root, f["name"], a["name"]), operation=oid, param=a["name"],
                             to={"key_decl": "kd:%s:%s" % (SDL, f["type"]["name"])}, **H(loc, "transform"))
                    b["ext"] = {"rule": "ID! 인자 하나 + 반환 타입이 Node 구현 객체 (Relay Global Object Identification)"}
                    ir.add("binding", b)
    return types


def main():
    ir = core.IR(P)
    conv = rest(ir)
    matched = webhook_docs(ir)
    audit(ir)
    permissions(ir, conv)
    graphql(ir)
    tenant = tenant_log.ingest(ir, "gh_tenant_lab_0926")      # 테넌트 실측 (4순위)
    counts = ir.write()
    print(json.dumps(dict(counts, webhook_doc_matched=matched, tenant_instances=tenant), ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
