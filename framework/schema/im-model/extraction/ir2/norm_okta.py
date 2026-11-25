# -*- coding: utf-8 -*-
"""Okta -> IR2. 범위: Management, OAuth, IdP, Identity Governance (IR 설계.md 1절).

    python norm_okta.py

1. OpenAPI 5종: management, oauth, idp (okta-management-openapi-spec 2026.09.2), Identity Governance 관리자와 최종 사용자
   (developer.okta.com 명세 원본, 2026-10-15 받음). 동작별 권한: OAuth scope, x-okta-iam-permissions(privilege),
   x-okta-iam-admin-roles(role)
2. System Log 이벤트 유형 JSON: 이벤트 유형마다 감사 카탈로그(기계 키 = 유형 id). payload 는 debugData 스키마, targets 는
   유형이 말한 대상 스키마(stated). event-hook-eligible 태그가 있으면 이벤트 카탈로그도 둔다
3. 관리자 권한 안내(okta.users.read ...), 표준 역할 안내(SUPER_ADMIN ...) -> 권한 어휘
4. 키: JSON Web Key 모양(kid, kty 속성)의 kid 는 RFC 7517 근거라 stated. 이름 규약 키는 쓰지 않는다 (IR 설계.md 11절)
"""
import io
import json
import re
import sys

import core
import openapi2
import tenant_log

P = "okta"
SPECS = [("okta_management_openapi", ["/api/v1"]), ("okta_oauth_openapi", []), ("okta_idp_openapi", []),
         ("okta_iga_openapi", []), ("okta_iga_enduser_openapi", []),
         ("okta_iga_requests_v1_openapi", []), ("okta_iga_requests_v2_openapi", []),
         # 2026-10-18 수집 범위 보완: Privileged Access, Aerial(다중 조직), Okta for AI Agents (태그마다 파일)
         ("okta_opa_openapi", []), ("okta_aerial_openapi", []), ("okta_asa_openapi", [])] + [(sid, []) for sid in ['okta_ai_resource_servers_a2aserverregistration', 'okta_ai_resource_servers_apiserverregistration', 'okta_ai_resource_servers_mcpserverregistration', 'okta_ai_resource_servers_resourceserverclientauthsettings', 'okta_ai_resource_servers_stsauthorization', 'okta_ai_resource_servers_virtualmcpserverresource', 'okta_ai_workload_principals_agentconnections', 'okta_ai_workload_principals_agentpotentialconnections', 'okta_ai_workload_principals_agentproviders', 'okta_ai_workload_principals_agentpublickey', 'okta_ai_workload_principals_agentregistration', 'okta_ai_workload_principals_agentschema', 'okta_ai_workload_principals_delegationlinks', 'okta_ai_workload_principals_virtualmcpconnections', 'okta_ai_workload_principals_virtualmcpregistration', 'okta_ai_workload_principals_workloadprincipaloperations']]
EVT_TYPES = {"String": "string", "Boolean": "boolean", "Integer": "integer", "Long": "integer", "Double": "number",
             "List": "array", "Map": "object", "Object": "object"}


def okta_life(o, state):
    lc = (o.get("x-okta-lifecycle") or {}).get("lifecycle")
    if lc == "DEPRECATED":
        return "deprecated", None
    return state, None


def event_types(ir):
    sid = "okta_event_types"
    d = json.load(io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8"))
    ver = d["versions"][0]
    schemas = ver.get("schemas", {})
    sh = lambda n: "sh:%s:%s" % (sid, n)
    built = set()

    def build(name):
        if name in built:
            return sh(name)
        built.add(name)
        s = schemas.get(name) or {}
        props = []
        for k, v in sorted((s.get("properties") or {}).items()):
            t = v.get("type")
            e = {"name": k, "required": False}
            if t in schemas:
                e["shape"] = build(t)
            else:
                e["scalar"] = EVT_TYPES.get(t, t)
                if v.get("format"):
                    e["format"] = v["format"]
            props.append(e)
            ex = [x for x in v.get("examples") or [] if x not in (None, "")]
            for i, x in enumerate(ex):
                ir.add("instance", dict(id="in:prop=%s|shape=%s#%d" % (k, sh(name), i), of={"shape": sh(name), "prop": k},
                                        value=x, src=ir.src(sid, "schemas.%s.properties.%s.examples" % (name, k)),
                                        grade="example", life=ir.life()))
        row = dict(id=sh(name), name=name, origin="named", kind="object", props=props,
                   src=ir.src(sid, "schemas.%s" % name), grade="stated", life=ir.life())
        row["ext"] = {"field_flags": {k: {f: v[f] for f in ("sensitive", "personal", "customer") if f in v}
                                      for k, v in sorted((s.get("properties") or {}).items())}}
        ir.add("shape", row)
        return sh(name)
    for e in sorted(ver["eventTypes"], key=lambda x: x["id"]):
        sch = e.get("schema") or {}
        payload = build(sch["debugData"]) if sch.get("debugData") else None
        targets = [{"shape": build(t), "type_name": t, "role": "target"} for t in sch.get("targets") or []]
        if sch.get("actor"):
            targets.append({"shape": build(sch["actor"]), "type_name": sch["actor"], "role": "actor"})
        loc = "versions[0].eventTypes[id=%s]" % e["id"]
        ext = {"beta": e.get("beta"), "internal": e.get("internal"), "tags": e.get("tags"), "info": e.get("info"),
               "change_details": sch.get("changeDetails") or []}
        row = dict(id="cat:audit:%s" % e["id"], catalog="audit", key=e["id"], display=None, category=e.get("category"),
                   payload=payload, targets=targets, src=ir.src(sid, loc), grade="stated", life=ir.life())
        row["ext"] = ext
        ir.add("catalog", row)
        # 참조 선언: LogEvent.target[] 원소가 이 유형에서는 이 대상 스키마들이다 (이벤트 유형 JSON 이 말함)
        tg = [t["shape"] for t in targets if t["role"] == "target"]
        if tg:
            rr = dict(id="rd:%s:%s" % (sid, e["id"]), to={"shapes": tg}, poly=len(tg) > 1, src=ir.src(sid, loc + ".schema.targets"),
                      grade="stated", life=ir.life(), **{"from": {"shape": "sh:okta_management_openapi:LogEvent.target", "prop": "[*]"}})
            rr["ext"] = {"catalog": row["id"], "note": "LogEvent.target 배열 원소. 이 이벤트 유형에서만 성립한다"}
            ir.add("ref_decl", rr)
        if "event-hook-eligible" in (e.get("tags") or []):
            r2 = dict(row, id="cat:event:%s" % e["id"], catalog="event", src=ir.src(sid, loc + ".tags[event-hook-eligible]"))
            r2["ext"] = {"delivery": "event_hook"}
            ir.add("catalog", r2)


def permission_docs(ir):
    lex = core.lexicon(P)
    for src in lex["sources"].get("permission_docs", []):
        text = io.open(core.nemo(core.registry()[src["id"]]["file"]), encoding="utf-8").read()
        kind = {"admin_permission": "privilege", "admin_role": "role"}[src["kind"]]
        for name in sorted(set(re.findall(src["pattern"], text))):
            gid = "gr:%s:%s" % (kind, name)
            if ir.has("grant", gid):
                ir.get("grant", gid)["ext"].setdefault("also_in", []).append(src["id"])
                continue
            ir.add("grant", dict(id=gid, kind=kind, name=name, operations=[], src=ir.src(src["id"], "pattern %s" % src["pattern"]),
                                 grade="stated", life=ir.life()))


def jwk_keys(ir):
    n = 0
    for s in sorted(ir.rows["shape"].values(), key=lambda r: r["id"]):
        names = {p["name"] for p in s.get("props") or []}
        if s["kind"] == "object" and {"kid", "kty"} <= names:
            ir.add("key_decl", dict(id="kd:%s" % s["id"], shape=s["id"], props=["kid"], form="global",
                                    evidence="RFC 7517 JSON Web Key kid (kty 와 함께 있는 JWK 모양)",
                                    src=s["src"], grade="stated", life=ir.life()))
            n += 1
    return n


def main():
    ir = core.IR(P)
    for sid, strip in SPECS:
        openapi2.OpenAPIConv(ir, sid, strip_prefixes=strip, lifecycle=okta_life).run()
    event_types(ir)
    permission_docs(ir)
    jwk = jwk_keys(ir)
    tenant = sum(tenant_log.ingest(ir, sid, "/api/v1") for sid in
                 ("okta_tenant_5102035_0925", "okta_tenant_5102035_0926", "okta_tenant_9523037_0927"))   # 테넌트 실측 (4순위)
    counts = ir.write()
    print(json.dumps(dict(counts, jwk_stated=jwk, tenant_instances=tenant), ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
