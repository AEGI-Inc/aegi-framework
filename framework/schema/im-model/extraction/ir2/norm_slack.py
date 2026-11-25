# -*- coding: utf-8 -*-
"""Slack -> IR2. 범위: Web API, Enterprise Grid 관리 API, SCIM, 감사 API 전부 (IR 설계.md 1절).

    python norm_slack.py

출처마다 사실을 따로 둔다 (4.3절). 같은 메서드를 여러 출처가 말하면 동작 행이 출처마다 하나씩 있다.
1. 구판 OpenAPI (Swagger 2.0, 순위 1, 판이 오래됨): 동작, 요청과 응답 모양(stated), defs_* ID 정의 -> id_format,
   id 속성이 defs_* 를 가리키는 객체 -> key_decl(stated), 그 밖 defs_* 참조 속성 -> ref_decl(stated)
2. 공식 문서 스냅샷 (docs.slack.dev 2026-10-12, 순위 2): 메서드 쪽의 인자(요청 모양), scope, 응답 예시(instance, 예시 모양)
   Legal Hold 쪽, Events API 쪽(이벤트 카탈로그, payload 예시), scope 쪽(권한 어휘), App manifest 쪽(설정 모양)
3. 메서드 문서 캐시: 문서 쪽이 없는 메서드만 동작으로 둔다
4. 메서드 목록(xlsx): 위 셋에 없는 메서드(SCIM, 감사 API 등)만 동작으로 둔다. notes 의 deprecated 는 모든 행에 수명으로 붙인다
5. md 정리본(LLM 정리)은 원문이 아니라 쓰지 않는다 (Information Map 설계.md 7절 M2). md_examples 는 남겨 두되 부르지 않는다
6. 테넌트 실측 (aegi-schema/data/slack_raw, 순위 4): 성공 응답을 observed instance 로, 감사 action 목록, 감사 entity 스키마,
   감사 로그 항목을 observed 로
7. 감사 action 문서판 (2026-10-13, 순위 3): action 코드와 범주
8. 사전 판단(추가 접두사, 이름 규약 키, 동사 표)은 쓰지 않는다 (IR 설계.md 11절). RPC 동작 종류는 unknown
description 은 읽지 않는다.
"""
import glob
import io
import json
import os
import re
import sys

import openpyxl

import core
import example_shape
import openapi2

sys.path.insert(0, core.CE)
import normalize_slack as ns      # noqa: E402  (재사용: md_blocks, prefixes)
import slack_docs                 # noqa: E402

P = "slack"
LEG = "slack_openapi_legacy"
PRIORITY = ("slack_docs_methods", "slack_docs_legal_hold", "slack_docs_cache", "slack_inventory", LEG)


KIND_RULE = "RPC 메서드의 동작 종류는 원문이 말하지 않는다 (사전 동사 표를 쓰지 않는다)"


class Slack:
    def __init__(self):
        self.ir = core.IR(P)
        self.by_name = {}                       # 메서드 이름 -> {출처: op id}

    def H(self, sid, loc, grade="stated", life=None):
        return {"src": self.ir.src(sid, loc), "grade": grade, "life": life or self.ir.life()}

    def note_op(self, name, sid, oid):
        self.by_name.setdefault(name, {})[sid] = oid

    def best(self, name):
        d = self.by_name.get(name) or {}
        for s in PRIORITY + ("slack_inventory_scim", "slack_inventory_audit"):
            if s in d:
                return d[s]
        return next(iter(d.values()), None)

    def grant(self, name, sid, loc, op=None):
        gid = "gr:oauth_scope:%s" % name
        if not self.ir.has("grant", gid):
            self.ir.add("grant", dict(id=gid, kind="oauth_scope", name=name, operations=[], **self.H(sid, loc)))
        g = self.ir.get("grant", gid)
        if op and op not in g["operations"]:
            g["operations"] = sorted(g["operations"] + [op])
        return gid

    def rpc_op(self, sid, name, http, request_props, scopes, loc, responses=None, life=None, ext=None, surface="rpc", path=None,
               query_params=None):
        oid = "op:%s:%s" % (sid, name)
        req = None
        if request_props is not None:
            req = "sh:%s:op:%s:req" % (sid, name)
            self.ir.add("shape", dict(id=req, name=None, origin="inline", kind="object", props=request_props, **self.H(sid, loc)))
        pparams = [{"name": x["param"], "in": "path", "required": True, "scalar": "string"} for x in core.path_positions(path)] if path else []
        row = dict(id=oid, surface=surface, name=name, method=http, kind="unknown" if surface == "rpc" else
                   core.rest_kind(http or "GET", path or ""), kind_grade="transform",
                   path={"template": path, "positions": core.path_positions(path)} if path else None,
                   params=pparams + list(query_params or []), request=req, responses=responses or [], grants=[],
                   **self.H(sid, loc, "stated", life))
        row["ext"] = dict(ext or {}, kind_rule=KIND_RULE if surface == "rpc" else core.KIND_RULE)
        self.ir.add("operation", row)
        for s in scopes or []:
            row["grants"] = sorted(set(row["grants"]) | {self.grant(s, sid, loc, oid)})
        self.note_op(name, sid, oid)
        return row

    # ------------------------------------------------------------------ 1. 구판 OpenAPI
    def legacy(self):
        def hook(row, o, m, raw):
            row["surface"] = "rpc"
            row["path"] = None
            row["kind"] = "unknown"
            row["ext"]["kind_rule"] = KIND_RULE
            self.note_op(row["name"], LEG, row["id"])
        conv = openapi2.OpenAPIConv(self.ir, LEG, op_hook=hook, op_name=lambda o, m, raw: raw.strip("/"))
        conv.run()
        defs = {}
        for name, d in sorted(conv.schemas.items()):
            if name.startswith("defs_") and d.get("pattern"):
                sid_ = "sh:%s:%s" % (LEG, name)
                defs[sid_] = name
        applies = {n: [] for n in defs.values()}
        for s in sorted(self.ir.rows["shape"].values(), key=lambda r: r["id"]):
            if s["src"]["source"] != LEG:
                continue
            for p in s.get("props") or []:
                if p.get("shape") in defs:
                    applies[defs[p["shape"]]].append({"shape": s["id"], "prop": p["name"]})
                    if p["name"] == "id" and s["kind"] == "object":
                        self.ir.add("key_decl", dict(id="kd:%s" % s["id"], shape=s["id"], props=["id"], form="global",
                                                     evidence="Slack defs_* ID 정의 (id 속성이 %s 를 가리킨다)" % defs[p["shape"]],
                                                     **self.H(LEG, s["src"]["locator"] + ".properties.id")))
                    else:
                        self.ir.add("ref_decl", dict(id="rd:%s.%s" % (s["id"], p["name"]), to={"id_format": "idf:%s" % defs[p["shape"]]},
                                                     poly=False, **self.H(LEG, s["src"]["locator"] + ".properties." + p["name"]),
                                                     **{"from": {"shape": s["id"], "prop": p["name"]}}))
            it = s.get("items") if s["kind"] == "array" else None
            if isinstance(it, dict) and it.get("shape") in defs:
                applies[defs[it["shape"]]].append({"shape": s["id"], "prop": "[*]"})
                self.ir.add("ref_decl", dict(id="rd:%s[*]" % s["id"], to={"id_format": "idf:%s" % defs[it["shape"]]}, poly=False,
                                             **self.H(LEG, s["src"]["locator"] + ".items"), **{"from": {"shape": s["id"], "prop": "[*]"}}))
        for sid_, name in sorted(defs.items(), key=lambda x: x[1]):
            pat = conv.schemas[name]["pattern"]
            row = dict(id="idf:%s" % name, name=name, match={"pattern": pat, "prefixes": ns.prefixes(pat)}, decodes=[],
                       applies=sorted(applies[name], key=core.dumps), **self.H(LEG, "definitions.%s" % name))
            row["ext"] = {"optional": "|^$" in pat or ")?$" in pat, "shape": sid_}
            self.ir.add("id_format", row)
        return conv

    # ------------------------------------------------------------------ 2. 공식 문서 스냅샷
    def docs(self):
        e = core.registry()["slack_docs_methods"]
        snap = os.path.dirname(core.nemo(e["dir"]))
        man = [json.loads(l) for l in io.open(os.path.join(snap, "manifest.jsonl"), encoding="utf-8")]
        pages = {m["url"].replace("https://docs.slack.dev/", "").rstrip("/"): os.path.join(snap, m["file"])
                 for m in man if m["status"] == 200}
        page = lambda rel: io.open(pages[rel], encoding="utf-8").read()
        methods = {}
        for rel in sorted(pages):
            if rel.startswith("reference/methods/"):
                methods[rel.split("/")[-1]] = ("slack_docs_methods", rel, slack_docs.method_page(page(rel)))
        if "reference/legal-holds-api-reference" in pages:
            for k, d in slack_docs.legal_hold_methods(page("reference/legal-holds-api-reference")).items():
                methods[k] = ("slack_docs_legal_hold", "reference/legal-holds-api-reference#" + k, d)
        for name, (sid, rel, d) in sorted(methods.items()):
            props = []
            for p in d["params"]:
                q = {"name": p["name"], "scalar": p.get("type") or "unknown", "required": bool(p.get("required"))}
                props.append(q)
            row = self.rpc_op(sid, name, d["http_method"], props, d["scopes"], rel)
            for p in d["params"]:
                if p.get("example"):
                    self.ir.add("instance", dict(id="in:op=%s|param=%s#0" % (row["id"], p["name"]),
                                                 of={"operation": row["id"], "param": p["name"]}, value=p["example"],
                                                 **self.H(sid, rel + " arguments", "example")))
            if d["examples"]:
                rid = "sh:%s:op:%s:resp:200" % (sid, name)
                example_shape.build(self.ir, d["examples"], rid, self.ir.src(sid, rel + " response"), "example")
                row["responses"] = [{"status": "200", "media": "application/json", "shape": rid}]
                for i, v in enumerate(d["examples"]):
                    self.ir.add("instance", dict(id="in:operation=%s|status=200#%d" % (row["id"], i),
                                                 of={"operation": row["id"], "status": "200"}, value=v,
                                                 **self.H(sid, rel + " response", "example")))
            elif d["unparsed_examples"]:
                self.ir.add("hole", dict(id="hole:example_unparsed:%s" % row["id"], at={"operation": row["id"]},
                                         hole="example_unparsed", reason="응답 예시 코드 블록을 JSON 으로 읽지 못했다",
                                         **self.H(sid, rel)))
        # 이벤트
        for rel in sorted(pages):
            if not rel.startswith("reference/events/"):
                continue
            name = rel.split("/")[-1]
            d = slack_docs.event_page(page(rel))
            sid = "slack_docs_events"
            cid = "cat:event:%s" % rel[len("reference/events/"):]       # message 하위 유형 쪽(events/message/...)과 이름이 겹친다
            payload = None
            if isinstance(d["payload"], dict):
                payload = example_shape.build(self.ir, [d["payload"]], "sh:%s:%s" % (sid, rel[len("reference/events/"):]),
                                              self.ir.src(sid, rel + " payload"))
                self.ir.add("instance", dict(id="in:catalog=%s#0" % cid, of={"catalog": cid}, value=d["payload"],
                                             **self.H(sid, rel + " payload", "example")))
            row = dict(id=cid, catalog="event", key=name, display=None, category=None, payload=payload, targets=[],
                       **self.H(sid, rel))
            row["ext"] = {"scopes": d["scopes"], "doc_path": rel}
            self.ir.add("catalog", row)
            if payload is None:
                self.ir.add("hole", dict(id="hole:example_unparsed:%s" % cid, at={"catalog": cid}, hole="example_unparsed",
                                         reason="payload 예시를 읽지 못했다", **self.H(sid, rel)))
            for s in d["scopes"]:
                g = self.ir.get("grant", self.grant(s, sid, rel))
                g["ext"].setdefault("catalogs", [])
                if cid not in g["ext"]["catalogs"]:
                    g["ext"]["catalogs"] = sorted(g["ext"]["catalogs"] + [cid])
        # scope 쪽
        for rel in sorted(pages):
            if rel.startswith("reference/scopes/"):
                s = slack_docs.scope_page(page(rel))
                if s["name"]:
                    g = self.ir.get("grant", self.grant(s["name"], "slack_docs_scopes", rel))
                    g["ext"]["token_types"] = s["token_types"]
                    g["ext"]["scope_page"] = rel
        # 관리자 역할 목록 (2026-10-18, 1단계 누락): admin.roles.addAssignments 쪽의 표 (Role, Role ID, Scope Type).
        # 역할을 읽는 API 는 없고 이 표가 역할 id 의 원문이다. 역할마다 grant(kind role, 이름 = 역할 id, stated)
        rel = "reference/methods/admin.roles.addAssignments"
        if rel in pages:
            for role, rid, scope in slack_docs.role_table(page(rel)):
                gid = "gr:role:%s" % rid
                if not self.ir.has("grant", gid):
                    self.ir.add("grant", dict(id=gid, kind="role", name=rid, operations=[], **self.H("slack_docs_methods", rel + "#admin-roles")))
                    self.ir.get("grant", gid)["ext"] = {"display": role, "scope_type": scope}
        # App manifest 설정 모양
        if "reference/app-manifest" in pages:
            paths = slack_docs.manifest_paths(page("reference/app-manifest"))
            tree = {}
            for mp in paths:
                cur = tree
                for part in mp.split("."):
                    cur = cur.setdefault(part, {})
            sid = "slack_docs_manifest_ref"

            def mk(node, shid):
                props = []
                for k in sorted(node):
                    nm, arr = (k[:-3], True) if k.endswith("[*]") else (k, False)
                    if node[k]:
                        child = shid + "." + nm
                        mk(node[k], child + ("[*]" if arr else ""))
                        if arr:
                            self.ir.add("shape", dict(id=child, name=None, origin="inline", kind="array",
                                                      items={"shape": child + "[*]"}, **self.H(sid, "reference/app-manifest")))
                        props.append({"name": nm, "shape": child, "required": False})
                    else:
                        props.append({"name": nm, "scalar": "unknown", "required": False})
                self.ir.add("shape", dict(id=shid, name="app_manifest" if shid.endswith(":app_manifest") else None,
                                          origin="inline", kind="object", props=props, **self.H(sid, "reference/app-manifest")))
            mk(tree, "sh:%s:app_manifest" % sid)
            self.ir.get("shape", "sh:%s:app_manifest" % sid)["ext"] = {"used_by": "apps.manifest.export $.manifest, apps.manifest.create manifest"}

    # ------------------------------------------------------------------ 3. 문서 캐시, 4. 메서드 목록
    def cache_and_inventory(self):
        sid = "slack_docs_cache"
        cache = json.load(io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8"))
        for name, c in sorted(cache.items()):
            if name in self.by_name and ("slack_docs_methods" in self.by_name[name] or "slack_docs_legal_hold" in self.by_name[name]):
                continue
            props = [{"name": p["name"], "scalar": p.get("type") or "unknown", "required": bool(p.get("required"))}
                     for p in c.get("parameters", []) if p.get("name")]
            self.rpc_op(sid, name, None, props, sorted(set(c.get("bot_scopes", [])) | set(c.get("user_scopes", []))), name)
        sid = "slack_inventory"
        wb = openpyxl.load_workbook(core.nemo(core.registry()[sid]["file"]), read_only=True)
        deprecated = set()
        for sheet, surface in (("Web API", "rpc"), ("SCIM API v2", "scim"), ("Audit Logs API", "rest")):
            for r in list(wb[sheet].iter_rows(values_only=True))[1:]:
                if not r[0]:
                    continue
                name, verb, path = r[0], r[1], r[2]
                notes = (r[5] or "") if len(r) > 5 else ""
                if "deprecat" in notes.lower():
                    deprecated.add(name)
                scopes = []
                m = re.search(r"scopes=([^;|]+)", notes)
                if m:
                    scopes = sorted({s.split(":", 1)[1] if s.split(":", 1)[0] in ("user", "bot") else s
                                     for s in re.split(r"[,\s]+", m.group(1).strip()) if s})
                if surface == "rpc" and name in self.by_name:
                    continue
                if surface != "rpc":
                    name = {"scim": "scim.", "rest": "audit."}[surface] + name
                    path = re.sub(r"^/(scim/v2|audit/v1)/", "", path)
                self.rpc_op(sid, name, verb, None if surface != "rpc" else [], scopes, "%s:%s" % (sheet, r[0]), surface=surface,
                            path=path if surface != "rpc" else None, ext={"sheet": sheet, "raw_path": r[2]})
        for name in sorted(deprecated):
            for s, oid in (self.by_name.get(name) or {}).items():
                op = self.ir.get("operation", oid)
                op["life"] = {"state": "deprecated"}
                op["ext"]["life_source"] = "slack_inventory notes"

    # ------------------------------------------------------------------ 5. md 정리본 예시
    def md_examples(self):
        for sid, folder in (("slack_method_md", "web-api"), ("slack_scim_md", "scim-v2")):
            base = core.nemo(core.registry()[sid]["dir"])
            for fn in sorted(os.listdir(base)):
                if not fn.endswith(".md"):
                    continue
                text = io.open(os.path.join(base, fn), encoding="utf-8").read().replace("\r\n", "\n")
                if folder == "web-api":
                    oid = self.best(fn[:-3])
                else:
                    m = re.search(r"^- Path: (\S+)", text, re.M)
                    vm = re.search(r"^- HTTP Method: (\S+)", text, re.M)
                    if not m:
                        continue
                    path = re.sub(r"^/scim/v2/", "", m.group(1))
                    inv = next((o for o in sorted(self.ir.rows["operation"].values(), key=lambda r: r["id"]) if o["surface"] == "scim"
                                and o["path"] and o["path"]["template"] == path and o["method"] == (vm.group(1) if vm else "GET")), None)
                    if not inv:
                        continue
                    # SCIM md 를 따로 동작 행으로 둔다 (출처마다 사실). 질의 인자와 본문 인자는 정리본의 Request Schema 에서
                    req = (ns.md_blocks(text).get("Normalized Request Schema") or {})
                    rp = req.get("properties") or {}
                    rq = set(req.get("required") or [])
                    pos = {x["param"] for x in core.path_positions(path)}
                    qs = [{"name": k, "in": "query", "required": k in rq, "scalar": (v or {}).get("type") or "unknown"}
                          for k, v in rp.items() if k not in pos] if inv["method"] == "GET" else []
                    body = None if inv["method"] == "GET" else [{"name": k, "scalar": (v or {}).get("type") or "unknown",
                                                               "required": k in rq} for k, v in rp.items() if k not in pos]
                    row = self.rpc_op(sid, inv["name"], inv["method"], body, [], fn, surface="scim", path=path, query_params=qs,
                                      ext={"extraction": "llm_normalized"})
                    oid = row["id"]
                ex = ns.md_blocks(text).get("Response Example")
                if not isinstance(ex, dict):
                    continue
                op = self.ir.get("operation", oid)
                i = sum(1 for k in self.ir.rows["instance"] if k.startswith("in:operation=%s|status=200#" % oid))
                inst = dict(id="in:operation=%s|status=200#%d" % (oid, i), of={"operation": oid, "status": "200"}, value=ex,
                            **self.H(sid, fn + " Response Example", "example"))
                inst["ext"] = {"extraction": "llm_normalized"}
                self.ir.add("instance", inst)
                if not any(x["shape"] for x in op["responses"]):
                    rid = "sh:%s:op:%s:resp:200" % (sid, op["name"])
                    example_shape.build(self.ir, [ex], rid, self.ir.src(sid, fn + " Response Example"), "example")
                    op["responses"] = [{"status": "200", "media": "application/json", "shape": rid}]

    # ------------------------------------------------------------------ 6. 테넌트 실측, 7. 감사 문서
    def tenant(self):
        sid = "slack_tenant_raw"
        d = core.nemo(core.registry()[sid]["dir"])
        actions_cat = {}
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            if f.endswith(".meta.json") or not os.path.exists(f + ".meta.json"):
                continue
            meta = json.load(io.open(f + ".meta.json", encoding="utf-8-sig"))
            fn = os.path.basename(f)
            try:
                body = json.load(io.open(f, encoding="utf-8-sig"))
            except ValueError:
                self.ir.issue("tenant_file_unreadable", {"file": fn}, "collect", "tenant",
                              "실측 파일을 JSON 으로 읽지 못했다 (빈 파일 또는 잘린 응답)", {"method": meta.get("method")})
                continue
            if meta.get("api") == "web":
                if str(meta.get("ok")) != "True":
                    continue
                oid = self.best(meta["method"])
            elif meta.get("api") == "scim":
                segs = meta["method"].split("/")
                oid = next((o["id"] for o in sorted(self.ir.rows["operation"].values(), key=lambda r: r["id"])
                            if o["surface"] == "scim" and o["method"] == meta.get("http_method") and o["path"]
                            and self._seg_match(o["path"]["template"].split("/"), segs)), None)
            elif meta.get("api") == "audit":
                oid = self.best("audit.%s.get" % meta["method"]) or self.best("audit.%s" % meta["method"])
                if meta["method"] == "actions":
                    actions_cat = body.get("actions") or {}
                if meta["method"] == "schemas":
                    for i, s in enumerate(body.get("schemas") or []):
                        t = s.get("type")
                        props = [{"name": k, "scalar": v if isinstance(v, str) else "unknown", "required": False}
                                 for k, v in (s.get(t) or {}).items()]
                        row = dict(id="sh:%s:audit_entity:%s@%d" % (sid, t, i), name="audit_entity:%s" % t, origin="example_derived",
                                   kind="object", props=props, **self.H(sid, "%s schemas[%d]" % (fn, i), "observed"))
                        self.ir.add("shape", row)
                if meta["method"] == "logs":
                    self._audit_logs = (fn, body.get("entries") or [])
            else:
                continue
            if not oid:
                self.ir.issue("tenant_response_without_operation", {"file": fn}, "normalize", "operation",
                              "실측 응답에 맞는 동작이 없다", {"method": meta.get("method"), "api": meta.get("api")})
                continue
            op = self.ir.get("operation", oid)
            i = sum(1 for k in self.ir.rows["instance"] if k.startswith("in:operation=%s|status=200#" % oid))
            self.ir.add("instance", dict(id="in:operation=%s|status=200#%d" % (oid, i), of={"operation": oid, "status": "200"},
                                         value=body, **self.H(sid, fn, "observed")))
            if not any(x["shape"] for x in op["responses"]):
                rid = "sh:%s:op:%s:resp:200" % (sid, op["name"])
                example_shape.build(self.ir, [body], rid, self.ir.src(sid, fn), "observed")
                op["responses"] = [{"status": "200", "media": "application/json", "shape": rid}]
        # 감사 action (실측)
        for cat, names in sorted(actions_cat.items()):
            for n in names:
                self.ir.add("catalog", dict(id="cat:audit:%s:%s" % (sid, n), catalog="audit", key=n, display=None, category=cat,
                                            payload=None, targets=[], **self.H(sid, "actions_audit.json actions.%s" % cat, "observed")))
        # 감사 로그 항목 (실측): action 별 카탈로그의 instance
        fn, entries = getattr(self, "_audit_logs", (None, []))
        cnt = {}
        for e in entries:
            cid = "cat:audit:%s:%s" % (sid, e.get("action"))
            if not self.ir.has("catalog", cid):
                self.ir.add("catalog", dict(id=cid, catalog="audit", key=e.get("action"), display=None, category=None, payload=None,
                                            targets=[], **self.H(sid, "%s entries" % fn, "observed")))
            i = cnt.get(cid, 0)
            cnt[cid] = i + 1
            self.ir.add("instance", dict(id="in:catalog=%s#%d" % (cid, i), of={"catalog": cid}, value=e,
                                         **self.H(sid, "%s entries" % fn, "observed")))
        # 감사 action 문서판
        sid = "slack_audit_actions_doc"
        t = io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8").read()
        a, b = t.find(">Actions"), t.find(">Errors")
        seg = t[a:b] if a > 0 and b > a else t
        cat = None
        for m in re.finditer(r"<h[23][^>]*>(.*?)</h[23]>|<tr><td[^>]*><code>([a-z0-9_.:]+)</code>", seg, re.S):
            if m.group(1):
                cat = re.sub(r"<[^>]+>", "", m.group(1)).replace("​", "").strip()
            elif m.group(2) and cat:
                self.ir.add("catalog", dict(id="cat:audit:%s:%s:%s" % (sid, cat, m.group(2)), catalog="audit", key=m.group(2), display=None,
                                            category=cat, payload=None, targets=[], **self.H(sid, "Actions / " + cat)))

    @staticmethod
    def _seg_match(tmpl, segs):
        if len(tmpl) != len(segs):
            return False
        return all(t.startswith("{") or t == s for t, s in zip(tmpl, segs))

    def run(self):
        self.legacy()
        self.docs()
        self.cache_and_inventory()
        # self.md_examples()  M2 (2026-10-15): LLM 정리본은 원문이 아니라 쓰지 않는다
        self.tenant()
        only_legacy = sorted(n for n, d in self.by_name.items() if set(d) == {LEG})
        if only_legacy:
            self.ir.issue("source_version_skew", {"source": LEG}, "collect", "source",
                          "구판 OpenAPI 에만 있는 메서드. 현재 문서에 없어 폐지 여부를 원문 표시로 확인해야 한다 (지금은 active 로 둔다)",
                          {"count": len(only_legacy), "sample": only_legacy[:15]})
        return self.ir.write()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(Slack().run(), ensure_ascii=False))
