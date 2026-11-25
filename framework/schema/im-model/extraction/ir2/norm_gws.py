# -*- coding: utf-8 -*-
"""Google Workspace -> IR2. 범위: 받은 Discovery 11종 전부 (IR 설계.md 1절).

    python norm_gws.py

1. Discovery 문서 (Google 의 기계용 명세): schemas -> 모양, methods -> 동작. 경로 틀은 API 이름 + servicePath + flatPath(없으면 path).
   API 마다 위치가 따로 선다 (2026-10-18). 동작 종류는 경로와 응답 모양 규칙(transform)
2. 경로 인자의 pattern 이 자원 이름 꼴(^groups/[^/]+/memberships/[^/]+$)이면 id_format (자원 이름 템플릿, stated)
3. Reports API 활동 부록: 이벤트마다 감사 카탈로그 (기계 키 = Event name, 표시 이름 = 제목, 범주 = 애플리케이션 이름),
   payload 는 Parameters 표의 이름과 타입 (stated)
4. OAuth scope 목록 쪽, Discovery auth.oauth2.scopes -> 권한 어휘
5. Workspace Events 안내 쪽의 이벤트 유형 -> 이벤트 카탈로그
6. 사전 판단은 쓰지 않는다 (IR 설계.md 11절). Discovery 는 키를 말하지 않아 key_decl 이 없다
"""
import html
import io
import json
import re
import sys

import core
import openapi2

P = "gws"
KIND = {"list": "read_many", "get": "read_one", "insert": "create", "create": "create", "update": "update", "patch": "update",
        "delete": "delete", "remove": "delete", "search": "search"}
KIND_RULE = "Discovery 메서드 이름 규약: 마지막 조각 list, get, insert/create, update/patch, delete/remove, search. 나머지는 action"


def to_openapi_refs(x):
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            if k == "$ref" and isinstance(v, str) and not v.startswith("#"):
                out[k] = "#/components/schemas/" + v
            else:
                out[k] = to_openapi_refs(v)
        return out
    if isinstance(x, list):
        return [to_openapi_refs(v) for v in x]
    return x


def resource_template(pattern):
    """'^customers/[^/]+/chrome/printers/[^/]+$' -> 'customers/{}/chrome/printers/{}'. 자원 이름 꼴이 아니면 None"""
    m = re.match(r"^\^((?:[A-Za-z][A-Za-z0-9]*/\[\^/\]\+/?)+)\$$", pattern)
    if not m:
        return None
    return m.group(1).replace("[^/]+", "{}").rstrip("/")


def discovery(ir, src):
    sid = src["id"]
    d = core.load_spec(core.nemo(core.registry()[sid]["file"]))
    spec = {"components": {"schemas": to_openapi_refs(d.get("schemas") or {})}}
    conv = openapi2.OpenAPIConv(ir, sid, spec=spec)
    conv.schema_loc = "schemas."
    svc = d.get("servicePath", "")
    H = lambda loc, grade="stated", life=None: {"src": ir.src(sid, loc), "grade": grade, "life": life or ir.life()}
    for sc in sorted(((d.get("auth") or {}).get("oauth2") or {}).get("scopes") or {}):
        conv.grant("oauth_scope", sc, None, "auth.oauth2.scopes")
    templates = {}

    def methods(res, loc):
        for name, m in sorted((res.get("methods") or {}).items()):
            yield m, "%s.methods.%s" % (loc, name)
        for name, r in sorted((res.get("resources") or {}).items()):
            yield from methods(r, "%s.resources.%s" % (loc, name) if loc else "resources.%s" % name)
    for m, loc in methods(d, ""):
        loc = loc.lstrip(".")
        raw = m.get("flatPath") or m.get("path") or ""
        # 경로 틀 = API 이름 + 서비스 경로 + flatPath (2026-10-18). 서비스 경로를 떼면 서로 다른 API 의 경로가 같은 위치로
        # 겹친다 (Directory users/{userKey} 와 Gmail users/{userId}, Groups Settings 는 {groupUniqueId} 만 남았다)
        full = raw if svc and raw.startswith(svc) else svc + raw
        tmpl = d.get("name", sid) + "/" + re.sub(r"\{\+([^}]+)\}", r"{\1}", full).strip("/")
        oid = "op:%s:%s" % (sid, m["id"])
        params = []
        for pn, pv in sorted((m.get("parameters") or {}).items()):
            if pv.get("location") not in ("path", "query"):
                continue
            e = {"name": pn, "in": pv["location"], "required": bool(pv.get("required"))}
            e.update(conv.ref_of(to_openapi_refs({k: v for k, v in pv.items() if k in ("type", "format", "enum", "items", "pattern",
                                                                                      "$ref")}),
                                 "sh:%s:op:%s:param:%s" % (sid, m["id"], pn), "%s.parameters.%s" % (loc, pn)))
            if pv.get("deprecated"):
                e["deprecated"] = True
            params.append(e)
            rt = resource_template(pv.get("pattern") or "") if pv["location"] == "path" else None
            if rt:
                templates.setdefault((rt, pv["pattern"]), []).append({"operation": oid, "param": pn})
        request = None
        if m.get("request"):
            rq = conv.ref_of(to_openapi_refs(m["request"]), "sh:%s:op:%s:req" % (sid, m["id"]), loc + ".request")
            request = conv.as_shape(rq, "sh:%s:op:%s:req" % (sid, m["id"]), loc + ".request")
        responses = []
        if m.get("response"):
            rs = conv.ref_of(to_openapi_refs(m["response"]), "sh:%s:op:%s:resp" % (sid, m["id"]), loc + ".response")
            responses.append({"status": "200", "media": "application/json",
                              "shape": conv.as_shape(rs, "sh:%s:op:%s:resp" % (sid, m["id"]), loc + ".response")})
        else:
            responses.append({"status": "200", "media": None, "shape": None})
        last = m["id"].split(".")[-1]
        kind = KIND.get(last, "action")
        grants = [conv.grant("oauth_scope", sc, oid, loc + ".scopes") for sc in m.get("scopes") or []]
        life = ir.life("deprecated") if m.get("deprecated") else ir.life()
        row = dict(id=oid, surface="rest", name=m["id"], method=m.get("httpMethod", "GET"), kind=kind, kind_grade="transform",
                   path={"template": tmpl, "positions": core.path_positions(tmpl)}, params=params, request=request,
                   responses=responses, grants=sorted(set(grants)), **H(loc, "stated", life))
        row["ext"] = {"raw_path": raw, "servicePath": svc, "kind_rule": KIND_RULE,
                      "parameterOrder": m.get("parameterOrder") or []}
        for k in ("supportsSubscription", "supportsMediaUpload", "supportsMediaDownload"):
            if m.get(k):
                row["ext"][k] = True
        ir.add("operation", row)
    for name in sorted(spec["components"]["schemas"]):
        conv.named(name)
    for (rt, pat), applies in sorted(templates.items()):
        iid = "idf:%s:%s" % (sid, rt)
        row = dict(id=iid, name="resource_name:%s" % rt, match={"pattern": pat, "template": rt}, decodes=["parent_ids"],
                   applies=sorted(applies, key=core.dumps), **H("parameters.pattern %s" % pat))
        ir.add("id_format", row)


def reports(ir):
    for sid, e in sorted(core.registry().items()):
        if not sid.startswith("gws_reports_activity__"):
            continue
        app = e["app"]
        t = io.open(core.nemo(e["file"]), encoding="utf-8").read()
        for sec in re.findall(r'<section itemscope itemtype="http://developers.google.com/ReferenceObject">(.*?)</section>', t, re.S):
            mn = re.search(r'<meta itemprop="name" content="([^"]*)"', sec)
            mt = re.search(r'<meta itemprop="path" content="([^"]*)"', sec)
            if not mn:
                continue
            key = mn.group(1)
            title = re.search(r'<h3[^>]*data-text="([^"]*)"', sec)
            props = []
            for row in re.findall(r'<tr>\s*<td><code itemprop="property"[^>]*>(.*?)</code></td>\s*<td>(.*?)</td>\s*</tr>', sec, re.S):
                pname = html.unescape(re.sub(r"<[^>]+>", "", row[0])).strip()
                pt = re.search(r"<code[^>]*>([^<]+)</code>", row[1])
                props.append({"name": pname, "scalar": pt.group(1).strip() if pt else "unknown", "required": False})
            loc = "%s #%s" % (app, key)
            pid = "sh:%s:%s" % (sid, key)
            if not ir.has("shape", pid):
                ir.add("shape", dict(id=pid, name=None, origin="inline", kind="object", props=props, src=ir.src(sid, loc + " Parameters"),
                                     grade="stated", life=ir.life()))
            cid = "cat:audit:%s:%s:%s" % (app, mt.group(1) if mt else "", key)
            row = dict(id=cid, catalog="audit", key=key, display=html.unescape(title.group(1)) if title else None,
                       category=app, payload=pid, targets=[], src=ir.src(sid, loc), grade="stated", life=ir.life())
            row["ext"] = {"event_type": mt.group(1) if mt else None, "application_name": app}
            ir.add("catalog", row)


def scopes_and_events(ir):
    sid = "gws_oauth_scopes"
    t = io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8").read()
    for sc in sorted(set(re.findall(r"https://www\.googleapis\.com/auth/[a-zA-Z0-9._/-]+", t))):
        sc = sc.rstrip(".")
        gid = "gr:oauth_scope:%s" % sc
        if ir.has("grant", gid):
            ir.get("grant", gid)["ext"]["listed_in_scope_doc"] = True
        else:
            ir.add("grant", dict(id=gid, kind="oauth_scope", name=sc, operations=[], src=ir.src(sid, "scope list"),
                                 grade="stated", life=ir.life()))
    for sid in ("gws_events_chat", "gws_events_drive", "gws_events_meet"):
        t = io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8").read()
        for n in sorted(set(re.findall(r"google\.workspace\.[a-z]+\.[a-zA-Z]+\.v\d+\.[a-zA-Z]+", t))):
            ir.add("catalog", dict(id="cat:event:%s" % n, catalog="event", key=n, display=None, category=n.split(".")[2],
                                   payload=None, targets=[], src=ir.src(sid, "event types"), grade="stated", life=ir.life()))


def main():
    ir = core.IR(P)
    lex = core.lexicon(P)
    for src in lex["sources"]["discovery"]:
        discovery(ir, src)
    reports(ir)
    scopes_and_events(ir)
    print(json.dumps(ir.write(), ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
