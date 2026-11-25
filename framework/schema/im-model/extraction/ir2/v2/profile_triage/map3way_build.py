# -*- coding: utf-8 -*-
"""세 모델 오브젝트 대조 1/2: 데이터 (python map3way_build.py -> out2/profile_triage/data.json)

기존 오브젝트 목록, Cartography 노드, IM 오브젝트 모델 v1을 연구 ID 공간으로 이어 한 표로 만든다.

허브: IM v1 연구 Object 타입(out2/v1/object_types.json)의 members(ID 공간 이름).
- 기존 목록: aegi-schema AEGI_Object_List_Final_2026-09-20.xlsx 의 Final_Reconciliation 행을
  object_audit.py 가 근거 API 경로로 공간에 이은 결과(out2/object_audit.json, rows).
- Cartography: carto_audit.py 가 노드의 수집 API 로 공간에 이은 결과(out2/carto_audit.json).
- IM v1 실행 Profile: docs/spec/model-v1/runtime-catalog.json profiles 의 research_type_id.
- 대시보드 v1/v2 데이터셋: environment_v2 픽스처와 measured_v2 객체의 catalog_ref.id (기존 목록 ID).
"""
import collections
import io
import json
import os
import re
import sys

WT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "out2", "profile_triage")
os.makedirs(OUT, exist_ok=True)
IR2 = os.path.join(WT, "candidate-extraction", "ir2")
OUT2 = os.path.join(IR2, "out2")


def jl(p):
    return json.load(io.open(p, encoding="utf-8"))


types = jl(os.path.join(OUT2, "v1", "object_types.json"))
audit = jl(os.path.join(OUT2, "object_audit.json"))
carto = jl(os.path.join(OUT2, "carto_audit.json"))
catalog = jl(os.path.join(WT, "docs", "spec", "model-v1", "runtime-catalog.json"))

# ---- 연구 타입 색인
space2type = {}
type_by_id = {}
for t in types:
    type_by_id[t["id"]] = t
    for m in t["members"]:
        space2type[(t["provider"], m)] = t["id"]

# ---- 연구 동작(API): 동작 응답에서 닿는 모양
def ops_for_provider(p):
    d = os.path.join(OUT2, p, "ir")
    if not os.path.exists(os.path.join(d, "operation.jsonl")):
        return {}, {}
    shapes = {}
    for l in io.open(os.path.join(d, "shape.jsonl"), encoding="utf-8"):
        x = json.loads(l)
        shapes[x["id"]] = x
    ops = {}
    for l in io.open(os.path.join(d, "operation.jsonl"), encoding="utf-8"):
        x = json.loads(l)
        ops[x["id"]] = x
    return ops, shapes


def refs(o, acc, depth=0):
    if depth > 6:
        return
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ("src", "ext", "life"):
                continue
            refs(v, acc, depth + 1)
    elif isinstance(o, list):
        for v in o:
            refs(v, acc, depth + 1)
    elif isinstance(o, str) and o.startswith("sh:"):
        acc.add(o)


def reach(shapes, start, maxd=3):
    seen = {start}
    front = [start]
    for _ in range(maxd):
        nxt = []
        for s in front:
            acc = set()
            refs(shapes.get(s, {}), acc)
            for a in acc - seen:
                seen.add(a)
                nxt.append(a)
        front = nxt
    return seen


def op_label(o):
    if o.get("path") and o.get("method"):
        return "%s /%s" % (o["method"], o["path"]["template"].lstrip("/"))
    return o.get("name") or o["id"]


shape2ops = collections.defaultdict(dict)   # provider -> shape -> [op labels]
for p in sorted({t["provider"] for t in types}):
    ops, shapes = ops_for_provider(p)
    m = collections.defaultdict(list)
    for oid, o in ops.items():
        if o.get("method") not in (None, "GET") and o.get("kind") != "read":
            continue
        for r in o.get("responses") or []:
            if not str(r.get("status", "")).startswith("2") or not r.get("shape"):
                continue
            for s in reach(shapes, r["shape"]):
                lab = op_label(o)
                if lab not in m[s]:
                    m[s].append(lab)
    shape2ops[p] = m


def type_apis(t):
    out = []
    m = shape2ops.get(t["provider"], {})
    for s in t.get("source_shapes") or []:
        for lab in m.get(s, []):
            if lab not in out:
                out.append(lab)
        mm = re.search(r":op:([^:]+):resp", s)
        if mm and not m.get(s):
            out.append("op " + mm.group(1))
    return out


# ---- 수집기 호출 ID -> 엔드포인트
PROV_FILES = os.path.join(WT, "scripts", "collect", "providers")
call_eps = {}
call_title = {}
sf_q = {}
sf_src = io.open(os.path.join(PROV_FILES, "salesforce.ts"), encoding="utf-8").read()
for k, q in re.findall(r"^\s+(\w+):\s*'(SELECT[^']+)'", sf_src, re.M):
    sf_q[k] = "SOQL " + re.search(r"FROM (\w+)", q).group(1)
for fn in ("github.ts", "okta.ts", "slack.ts", "gws.ts", "salesforce.ts", "atlassian.ts", "worker.ts"):
    src = io.open(os.path.join(PROV_FILES, fn), encoding="utf-8").read()
    starts = [(m.start(), m.group(1), m.group(2)) for m in
              re.finditer(r"(?:call\(|id:\s*)'([A-Z]{2}-\d{2})'(?:,\s*'([^']*)')?", src)]
    for i, (pos, cid, title) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
        body = src[pos:end]
        eps = []
        for s in re.findall(r"'([^'\n]*)'|`([^`\n]*)`", body):
            s = s[0] or s[1]
            s2 = re.sub(r"\$\{(DIR|BASE|base|root)\}", "", s)
            s2 = re.sub(r"\$\{[^}]+\}", "{}", s2)
            if s2.startswith("/") and len(s2) > 2:
                eps.append(s2.split("?")[0])
            elif fn == "slack.ts" and re.fullmatch(r"[a-z]+(\.[a-zA-Z0-9]+){1,3}", s2):
                eps.append(s2)
            elif fn == "atlassian.ts" and False:
                pass
        if fn == "salesforce.ts":
            eps += [sf_q[k] for k in re.findall(r"SALESFORCE_QUERIES\.(\w+)", body) if k in sf_q]
        if "graphql(" in body:
            g = re.search(r"\{\s*(\w+)\s*\(", body)
            eps.append("GraphQL " + (g.group(1) if g else "query"))
        dedup = []
        for e in eps:
            if e not in dedup:
                dedup.append(e)
        call_eps.setdefault(cid, dedup)
        if title:
            call_title.setdefault(cid, title)

# ---- 대시보드 데이터셋(기존 v1/v2 시절)
ds_presence = collections.defaultdict(set)   # old id -> {"fixture","measured"}
ds_type = {}
for ds, tag in (("aegi_inc_environment_v2", "v2 픽스처"), ("aegi_inc_measured_v2", "v2 실측")):
    for o in jl(os.path.join(WT, "src", "data", ds, "objects.json")):
        cid = (o.get("catalog_ref") or {}).get("id")
        if not cid:
            continue
        base = cid.split("::")[0]
        ds_presence[base].add(tag)
        ds_type[base] = (o["canonical"]["provider"], o["canonical"]["object_type"], o["canonical"].get("interfaces") or [])

PMAP = {"GitHub": "github", "Okta": "okta", "Slack": "slack", "Google Workspace": "gws"}

rows = {}   # key -> row


def row_for_type(tid):
    if tid not in rows:
        t = type_by_id[tid]
        rows[tid] = {"key": tid, "provider": t["provider"], "im_types": [{
            "id": tid, "space": t["canonical_space"], "members": t["members"],
            "interfaces": t["interfaces"], "status": t["status"], "apis": type_apis(t)}],
            "old": [], "carto": [], "profile": [], "notes": []}
    return rows[tid]


def row_loose(key, provider):
    if key not in rows:
        rows[key] = {"key": key, "provider": provider, "im_types": [], "old": [], "carto": [], "profile": [], "notes": []}
    return rows[key]


# 기존 목록
old_ids_seen = set()
for P, g in audit.items():
    for r in g["rows"]:
        old_ids_seen.add(r["id"])
        ent = {"id": r["id"], "name": r["name"], "interface": r["interface"], "verdict": r["verdict"],
               "api": re.split(r"\n\s*[\[{]", r["api"])[0][:400], "dataset": sorted(ds_presence.get(r["id"], []))}
        tids = []
        lost = []
        for s in r["spaces"]:
            tid = space2type.get((P, s))
            if tid:
                if tid not in tids:
                    tids.append(tid)
            else:
                lost.append(s)
        ent["unmapped_spaces"] = lost
        if tids:
            for tid in tids:
                row_for_type(tid)["old"].append(dict(ent, shared=len(tids) > 1))
        else:
            why = "근거 API가 연구 원문에 없음" if not r["spaces"] else "공간이 연구 Object 타입이 아님(" + ", ".join(lost) + ")"
            row_loose("old:" + r["id"], P)["old"].append(dict(ent, why=why))

# 기존 데이터셋에만 있고 목록에 없는 ID
for cid, tags in ds_presence.items():
    if cid in old_ids_seen:
        continue
    p, ot, ifs = ds_type[cid]
    row_loose("old:" + cid, p)["old"].append({"id": cid, "name": ot, "interface": "; ".join(ifs), "verdict": "데이터셋 전용",
                                             "api": "", "dataset": sorted(tags), "unmapped_spaces": [],
                                             "why": "2026-09-20 목록 밖의 보강 ID(대시보드 v2 정규화가 추가)"})

# Cartography
for P, nodes in carto.items():
    for n in nodes:
        ent = {"node": n["node"], "status": n["status"], "id_field": n["id_field"], "evidence": n["evidence"],
               "apis": [a["api"] for a in n["apis"]], "derived": n["derived"],
               "spaces": [s["name"] for s in n["spaces"]] + [s["name"] for s in n.get("rest_equiv") or []]}
        tids = []
        provs = [P] if P != "jira" else ["jira", "confluence", "atlassian"]
        for s in ent["spaces"]:
            for pp in provs:
                tid = space2type.get((pp, s))
                if tid and tid not in tids:
                    tids.append(tid)
        if tids:
            for tid in tids:
                row_for_type(tid)["carto"].append(dict(ent, shared=len(tids) > 1))
        else:
            why = {"derived": "API 응답이 아니라 파일이나 설정 값을 파싱해 만든 노드",
                   "no_operation": "수집 API가 연구 원문에 없음"}.get(n["status"], "공간이 연구 Object 타입이 아님(" + ", ".join(ent["spaces"]) + ")")
            row_loose("carto:%s:%s" % (P, n["node"]), P)["carto"].append(dict(ent, why=why))

# IM 실행 Profile
for pf in catalog["profiles"]:
    calls = re.findall(r"\b([A-Z]{2}-\d{2})\b", pf["evidence"])
    eps = []
    for c in calls:
        for e in call_eps.get(c, []):
            if e not in eps:
                eps.append(e)
    ent = {"object_type": pf["object_type"], "provider": pf["provider"], "interfaces": pf["interfaces"],
           "calls": calls, "call_titles": [call_title.get(c, "") for c in calls], "endpoints": eps,
           "source_shape": pf.get("source_shape") or pf.get("source_space"),
           "agreement": pf.get("research_agreement"), "research_interfaces": pf.get("research_interfaces"),
           "basis": pf.get("decision_basis"), "evidence": pf["evidence"]}
    tid = pf.get("research_type_id")
    if tid and tid in type_by_id:
        row_for_type(tid)["profile"].append(ent)
    else:
        row_loose("profile:%s:%s" % (pf["provider"], pf["object_type"]), pf["provider"])["profile"].append(dict(ent, why="연구 타입 연결 없음"))

# 연구 타입 연결이 없는 Profile: source_shape 를 가진 연구 타입, 그다음 기존 목록 이름으로 짝짓는다
shape2type = {}
for t in types:
    for sh in t.get("source_shapes") or []:
        shape2type.setdefault(sh, t["id"])
for k in [k for k in list(rows) if k.startswith("profile:")]:
    r = rows[k]
    pf = r["profile"][0]
    tid = shape2type.get(pf["source_shape"] or "")
    target = None
    how = None
    if tid:
        target, how = row_for_type(tid), "원본 모양이 같은 연구 타입"
    else:
        for r2 in rows.values():
            if r2 is r or r2["provider"] != pf["provider"]:
                continue
            names = {o["name"] for o in r2["old"]} | {ds_type.get(o["id"], (0, None))[1] for o in r2["old"]}
            if pf["object_type"] in names and any(o["verdict"] != "제외" for o in r2["old"]):
                target, how = r2, "기존 목록 이름으로 짝지음(연구 타입 연결 없음)"
                break
    if target is not None:
        target["profile"].append(dict(pf, why=how))
        del rows[k]
    else:
        pf["why"] = "연구 타입과 기존 목록 어디에도 연결 없음(정규화가 레코드에서 투영)"

# 공간에 닿지 않은 기존 목록 행: 같은 이름의 IM Profile 이 있는 행에 붙인다
prof_rows = collections.defaultdict(list)
for r in rows.values():
    for pf in r["profile"]:
        prof_rows[(pf["provider"], pf["object_type"].lower())].append(r)
for k in [k for k in list(rows) if k.startswith("old:")]:
    r = rows[k]
    if not r["profile"]:
        o = r["old"][0]
        if o["verdict"] == "제외":
            continue
        names = {o["name"].lower(), (ds_type.get(o["id"], (0, ""))[1] or "").lower()}
        hit = None
        for n in names:
            if prof_rows.get((r["provider"], n)):
                hit = prof_rows[(r["provider"], n)][0]
                break
        if hit is not None and hit is not r:
            hit["old"].append(dict(o, why=(o.get("why") or "") + "; 이름으로 IM Profile 과 짝지음"))
            del rows[k]

# 같은 대상을 다른 연구 공간이 나눠 가진 경우: 기존 포함 항목 이름이 IM Profile 이름과 같으면 Profile 행으로 합친다
def merge(src, dst, why):
    for it in src["im_types"]:
        if it["id"] not in {x["id"] for x in dst["im_types"]}:
            dst["im_types"].append(it)
    dst["old"] += [o for o in src["old"] if o not in dst["old"]]
    dst["carto"] += [c for c in src["carto"] if c not in dst["carto"]]
    dst["profile"] += src["profile"]
    dst["notes"] += src["notes"] + [why]
    del rows[src["key"]]


prof_rows = collections.defaultdict(list)
for r in rows.values():
    for pf in r["profile"]:
        prof_rows[(pf["provider"], pf["object_type"].lower())].append(r)
for k in list(rows):
    r = rows.get(k)
    if r is None or r["profile"]:
        continue
    for o in r["old"]:
        if o["verdict"] == "제외":
            continue
        names = [o["name"].lower(), (ds_type.get(o["id"], (0, ""))[1] or "").lower()]
        hit = next((prof_rows[(r["provider"], n)][0] for n in names if prof_rows.get((r["provider"], n))), None)
        if hit is not None and hit is not r and hit["key"] in rows:
            merge(r, hit, "기존 %s(%s)이 IM Profile과 다른 연구 공간에 닿아 이름으로 합침" % (o["id"], o["name"]))
            break

# v2 브랜치 결정으로 바뀐 IM 수집 타입
V2_NOTES = {("okta", "OAuth2Client"): "v2(V2-D05): 같은 client_id 의 Application 으로 합침"}
for r in rows.values():
    for pf in r["profile"]:
        n = V2_NOTES.get((pf["provider"], pf["object_type"]))
        if n and n not in r["notes"]:
            r["notes"].append(n)

# Link 전용
for lo in catalog.get("link_only", []):
    for r in rows.values():
        if r["provider"] == lo["provider"] and any(c["node"].endswith(lo["object_type"]) for c in r["carto"]):
            r["notes"].append("IM v1: Object로 만들지 않고 신원 Link 재료로만 씀 (GF1)")
        for o in r["old"]:
            if o["name"] == lo["object_type"] and r["provider"] == lo["provider"]:
                r["notes"].append("IM v1: Object로 만들지 않고 신원 Link 재료로만 씀 (GF1)")

# 공급자 표기
PNAME = {"github": "GitHub", "okta": "Okta", "slack": "Slack", "gws": "Google Workspace", "salesforce": "Salesforce",
         "jira": "Jira", "confluence": "Confluence", "atlassian": "Atlassian"}
for r in rows.values():
    pr = r["provider"]
    if r["profile"] and r["profile"][0]["provider"] == "atlassian" and pr in ("jira", "confluence"):
        pass
    r["provider_name"] = PNAME.get(pr, pr)
    has_old = any(o["verdict"] in ("포함", "데이터셋 전용") for o in r["old"])
    has_old_ex = any(o["verdict"] == "제외" for o in r["old"])
    r["flags"] = {"old": has_old, "old_excluded": has_old_ex and not has_old, "carto": bool(r["carto"]),
                  "im_type": bool(r["im_types"]), "im_profile": bool(r["profile"])}
    # 인터페이스 차이
    im_if = set()
    if r["profile"]:
        for p in r["profile"]:
            im_if |= set(p["interfaces"])
    else:
        for it in r["im_types"]:
            im_if |= set(it["interfaces"])
    old_if = set()
    sets = []
    for o in r["old"]:
        if o["verdict"] in ("포함", "데이터셋 전용") and o["interface"]:
            one = {x.strip() for x in re.split(r"[;,/]", o["interface"]) if x.strip()}
            sets.append(one)
            old_if |= one
    r["iface_diff"] = bool(im_if and sets and all(x != im_if for x in sets))
    r["im_ifaces"] = sorted(im_if)
    r["old_ifaces"] = sorted(old_if)

# 연구 타입 중 셋 어디에도 안 닿은 것: 공급자별 수만
untouched = collections.Counter()
untouched_if = collections.defaultdict(collections.Counter)
used_types = {it["id"] for r in rows.values() for it in r["im_types"]}
for t in types:
    if t["id"] not in used_types:
        untouched[t["provider"]] += 1
        for i in t["interfaces"]:
            untouched_if[t["provider"]][i] += 1

out = {"rows": sorted(rows.values(), key=lambda r: (r["provider"], r["key"])),
       "research_only": {p: {"count": c, "interfaces": dict(untouched_if[p])} for p, c in untouched.items()},
       "totals": {"research_types": len(types), "profiles": len(catalog["profiles"]),
                  "carto_nodes": sum(len(v) for v in carto.values()),
                  "old_rows": sum(len(g["rows"]) for g in audit.values()),
                  "old_included": sum(1 for g in audit.values() for r in g["rows"] if r["verdict"] == "포함")},
       "calls": {k: {"title": call_title.get(k, ""), "endpoints": v} for k, v in sorted(call_eps.items())}}
json.dump(out, io.open(os.path.join(OUT, "data.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
c = collections.Counter()
for r in out["rows"]:
    f = r["flags"]
    c[(r["provider"], f["old"], f["carto"], f["im_profile"])] += 1
for k, v in sorted(c.items()):
    print(k, v)
print(out["totals"], {p: v["count"] for p, v in out["research_only"].items()})
