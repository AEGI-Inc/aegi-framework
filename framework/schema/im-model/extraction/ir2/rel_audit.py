# -*- coding: utf-8 -*-
"""2단계: ID x ID relation 의 누락과 중복 조사 (2026-10-18).

    python rel_audit.py          # out2/rel_audit.json

1. 우리 쪽 쌍: 정보 지도에서 두 ID 공간을 잇는 것을 모두 모은다 (pairs()).
   - ref: 한 공간 레코드의 필드가 다른 공간을 가리킨다 (info_map refs)
   - relation: 자기 id 없는 조합 레코드가 여러 공간을 잇는다 (relation:... 결정자)
   - parent: 부모 안 공간과 부모 (local 의 parent_positions)
   - link: D5 연결 레코드 (relation_of)
   - composite: 복합키 자격증명의 키 자리 (key_fields)
2. 기준: Cartography 간선 (collect/carto, 노드와 공간은 carto_audit 결과로 잇는다)
3. 판정: 기준의 두 노드가 닿는 공간 쌍 사이에 우리 쪽 쌍이 있으면 있음. 없으면 이유를 붙인다.
이름 비교는 하지 않는다. Cartography 노드 이름과 공간을 잇는 것은 carto_audit 의 API 대조 결과다.
"""
import collections
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CARTO = os.path.join(HERE, "collect", "carto")
PROV = {"slack": "slack", "github": "github", "okta": "okta", "googleworkspace": "gws", "jira": "jira", "salesforce": "salesforce"}


def relation_parts(det, names):
    """relation:AxBx?f@shape -> [A, B, ?f]. 공간 이름에 x 가 들어 있어 알려진 이름으로 나눈다 (가장 긴 것 먼저)"""
    body = det[len("relation:"):].split("@")[0]
    toks = body.split("x")
    best = {0: []}
    for i in range(len(toks)):
        if i not in best:
            continue
        for j in range(i + 1, len(toks) + 1):
            w = "x".join(toks[i:j])
            if w in names or w.startswith("?"):
                if j not in best or len(best[j]) > len(best[i]) + 1:
                    best[j] = best[i] + [w]
    return best.get(len(toks)) or []


def canon_of(p):
    """dup_audit 의 같은 대상 묶음: 공간 -> 대표 공간 (묶음이 없으면 자기 자신)"""
    f = os.path.join(HERE, "out2", p, "map", "same_entity.json")
    c = {}
    if USE_SAME and os.path.exists(f):
        for g in json.load(io.open(f, encoding="utf-8"))["groups"]:
            for x in g["members"]:
                c[x] = g["canonical"]
    return c


USE_SAME = "--raw" not in sys.argv


def pairs(p):
    m = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))
    canon = canon_of(p)
    sp = m["spaces"]
    names = set(sp)
    pos_owner = {}
    for n, s in sp.items():
        for P in s.get("positions") or []:            # 쓰기로만 주소가 있는 공간(write_addressed)의 위치도 부모가 된다
            pos_owner.setdefault(P, n)
        for P in s.get("item_positions") or []:
            pos_owner[P] = n
    out = collections.defaultdict(set)                 # frozenset({a, b}) -> {(방식, 근거)}

    # v2 판별값 조건부 공간 (dup_audit polymorphic, V2-S4, V2-S5): 판별 필드 값마다 다른 공간을 가리킨다.
    # 그 공간이 끼는 쌍은 경우마다 대상 공간과의 쌍으로도 센다
    poly = {}
    f = os.path.join(HERE, "out2", p, "map", "same_entity.json")
    if USE_SAME and os.path.exists(f):
        for e in json.load(io.open(f, encoding="utf-8")).get("polymorphic") or []:
            poly[e["space"]] = [(t, "%s=%s (%s)" % (e["field"], v, e["v2_decision"])) for v, t in sorted(e["cases"].items())]

    def add(a, b, how, why):
        for x, wx in [(a, None), *poly.get(a, [])]:
            for y, wy in [(b, None), *poly.get(b, [])]:
                cond = "; ".join(w for w in (wx, wy) if w)
                x2, y2 = canon.get(x, x), canon.get(y, y)  # 같은 대상 묶음은 대표 공간으로 (dup_audit)
                if x2 and y2 and x2 in names and y2 in names:  # 같은 공간끼리도 relation 이다 (팀의 상위 팀, 그룹 안 그룹)
                    out[frozenset((x2, y2))].add(("conditional_ref" if cond else how, "%s when %s" % (why, cond) if cond else why))
    for a, b, n in m["refs"]:
        add(a, b, "ref", "%s 레코드의 필드가 %s 를 가리킨다 (%d)" % (a, b, n))
    for it in m["items"]:
        d = it["det"]
        if d.startswith("space:"):
            for case in it.get("cases") or []:
                guard = case["when"]
                add(d[6:], case["target"], "conditional_ref", "%s when %s=%s" % (it["rel"], guard["path"], guard["equals"]))
        if d.startswith("relation:"):
            ps = [x for x in relation_parts(d, names) if not x.startswith("?")]
            for i in range(len(ps)):
                for j in range(i + 1, len(ps)):
                    add(ps[i], ps[j], "relation", d)
    for n, s in sp.items():
        for P in s.get("parent_positions") or []:
            add(n, pos_owner.get(P), "parent", "%s 는 %s 아래 (%s)" % (n, pos_owner.get(P), P))
        for x in s.get("relation_of") or []:
            par = pos_owner.get(x, x)
            for y in s.get("relation_of") or []:
                if x < y:
                    add(pos_owner.get(x, x), pos_owner.get(y, y), "link", "D5 연결 레코드 %s" % n)
        if s["form"] == "composite_key":
            ks = s.get("key_parts") or []
            for k in ks:
                add(n, k, "composite", "복합키 자리")
    # path: 부모 위치 아래 동작이 다른 공간의 레코드를 돌려준다 (GET /groups/{id}/users -> 그룹 x 사용자). 경로 맥락
    from map3 import Map3, segs
    mm = Map3(p)
    shape_sp = {x: n for n, s in sp.items() for x in s.get("shapes") or []}
    for o in sorted(mm.ops.values(), key=lambda o: o["id"]):
        if not o.get("path") or not o["path"]["positions"] or o.get("method") not in ("GET", None):
            continue
        t = o["path"]["template"]
        ss = segs(t)
        idx = [i for i, x in enumerate(ss) if x.startswith("{")]
        last_is_param = ss[-1].startswith("{")
        par_i = idx[-2] if last_is_param and len(idx) >= 2 else (idx[-1] if not last_is_param else None)
        if par_i is None:
            continue
        P = "/".join("{}" if x.startswith("{") else x for x in ss[:par_i + 1])
        parent = pos_owner.get(P)
        r = mm.resp(o)
        if not parent or not r:
            continue
        for e in set(mm.element(r) + mm.obj(r)):
            es = shape_sp.get(e)
            if es and es != parent:
                add(parent, es, "path", "%s %s" % (o.get("method"), t))
    # rpc: 경로가 없는 동작은 필수 인자 값이 원문 ID 형식에 맞는 공간이 맥락이다 (map3.rpc_context). 응답이 다른 공간의
    # 레코드를 돌려주거나 다른 공간을 가리키면 맥락 x 그 공간 (Slack conversations.members -> 채널 x 사용자)
    mm.build_edges()
    mm.spaces()
    mm.ids()
    for o in sorted(mm.ops.values(), key=lambda o: o["id"]):
        if o.get("path"):
            continue
        ctx = mm.rpc_context(o["id"], o)
        r = mm.resp(o)
        if not ctx or not r:
            continue
        tg = set()
        for e in set(mm.element(r) + mm.obj(r)):
            if shape_sp.get(e):
                tg.add(shape_sp[e])
            for pr in (mm.shapes.get(e) or {}).get("props") or []:
                ro = mm.id_role.get((e, pr["name"]))
                if ro and ro["role"] == "ref" and isinstance(ro.get("target"), str):
                    tg.add(ro["target"])
                for x in mm.obj((mm.shapes.get(pr.get("shape") or "") or {}).get("items", {}).get("shape") or "") if (mm.shapes.get(pr.get("shape") or "") or {}).get("kind") == "array" else []:
                    if shape_sp.get(x):
                        tg.add(shape_sp[x])
        for t_ in tg:
            if t_ != ctx:
                add(ctx, t_, "rpc", "%s (맥락 %s)" % (o["name"], ctx))
    return out, sp


def carto_rels():
    nodes = json.load(io.open(os.path.join(CARTO, "carto_nodes.json"), encoding="utf-8"))
    loose = json.load(io.open(os.path.join(CARTO, "carto_loose_rels.json"), encoding="utf-8"))
    labels = {n["label"] for n in nodes}
    out = []
    for n in nodes:
        for r in n["rels"]:
            if r.get("target"):
                out.append((n["module"], n["label"], r["label"], r["target"], r.get("class")))
        sr = n.get("sub_resource")
        if sr and sr.get("target"):
            out.append((n["module"], n["label"], sr["label"], sr["target"], sr.get("class")))
    for r in loose:
        src = r.get("source")
        if not src:                                    # 노드에 안 붙은 간선: 클래스 이름 앞부분이 노드 라벨 (기준 자료 읽기용)
            c = [l for l in labels if r["class"].startswith(l + "To")]
            src = max(c, key=len) if c else None
        if src and r.get("target"):
            out.append((r["module"], src, r["label"], r["target"], r["class"]))
    return sorted(set(out))


def audit():
    with io.open(os.path.join(HERE, "source_reference_facts.json"), encoding="utf-8") as f:
        derivations = json.load(f).get("derived_relations") or []
    for rule in derivations:
        path = os.path.abspath(os.path.join(HERE, rule["evidence"]["file"]))
        if os.path.commonpath((HERE, path)) != HERE:
            raise ValueError("대조 근거 파일이 작업 경로 밖이다")
        with open(path, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() != rule["evidence"]["sha256"]:
                raise ValueError("파생 관계 근거의 해시가 다르다")
    ca = json.load(io.open(os.path.join(HERE, "out2", "carto_audit.json"), encoding="utf-8"))
    node_sp = collections.defaultdict(set)             # (provider, 노드) -> 공간
    for p, rows in ca.items():
        for r in rows:
            for s in r["spaces"] + r.get("rest_equiv", []):
                if s.get("object_candidate", True):
                    node_sp[(p, r["node"])].add(s["name"])
    res = {}
    cache = {}
    for mod, a, lab, b, cls in carto_rels():
        p = PROV.get(mod)
        if not p:
            continue
        if p not in cache:
            cache[p] = pairs(p)
        pr, sp = cache[p]
        cn = canon_of(p)
        A = {cn.get(x, x) for x in node_sp.get((p, a), set())}
        B = {cn.get(x, x) for x in node_sp.get((p, b), set())}
        row = {"source": a, "label": lab, "target": b, "class": cls, "source_spaces": sorted(A), "target_spaces": sorted(B)}
        if lab == "RESOURCE":
            row["kind"] = "tenant"                     # 소속 간선: 우리 지도는 테넌트 소속을 모든 레코드의 맥락으로 둔다 (묵시)
        if not A or not B:
            row["status"] = "node_unmapped"
            row["why"] = "노드가 공간에 닿지 않음: " + ", ".join(x for x, y in ((a, A), (b, B)) if not y)
        else:
            hits = [(x, y, sorted(pr[frozenset((x, y))])) for x in sorted(A) for y in sorted(B) if frozenset((x, y)) in pr]
            if hits:
                row["status"] = "found"
                row["hits"] = [{"a": x, "b": y, "how": sorted({h for h, _ in e}), "why": [w for _, w in e][:2]} for x, y, e in hits]
            else:
                row["status"] = "missing"
                for rule in derivations:
                    if (p, a, b, lab) == (rule["provider"], rule["source"], rule["target"], rule["label"]):
                        row["gap_class"] = rule["gap_class"]
                        row["why"] = rule["reason"]
                        row["source_evidence"] = rule["evidence"]
        res.setdefault(p, []).append(row)
    # The derived/external layer is an overlay, not a manufactured ID-space hit.
    # Validate every remaining baseline edge against an exact source contract.
    from relation_contracts import build as build_contracts
    contracts = build_contracts(res)
    lookup = {(r["provider"], r["source"], r["label"], r["target"], r["class"]): r
              for r in contracts["recipes"]}
    for p, rows in res.items():
        for row in rows:
            if row.get("kind") == "tenant":
                continue
            contract = lookup.get((p, row["source"], row["label"], row["target"], row["class"]))
            if contract:
                row["resolution"] = {k: contract[k] for k in (
                    "category", "operator", "direction", "inputs", "rule", "guards",
                    "implementation_status", "local_operator", "definition_status", "observation_status")}
            else:
                row["resolution"] = dict(definition_status="direct_pair", semantic_validation="not_performed")
    with io.open(os.path.join(HERE, "out2", "rel_audit.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
    return res


PROFILE_DOCS = ["Slack_Profiles_v3.md", "Okta_Profiles_v3.md", "Pilot_Profiles_v3.md"]
PROF_PROV = {"slack": "slack", "okta": "okta", "github": "github", "google_workspace": "gws"}


def profiles():
    import re
    import yaml
    out = []
    snapshot = os.path.join(HERE, "collect", "interface_contracts", "profiles")
    manifest_path = os.path.join(snapshot, "sources.json")
    pinned = {}
    if os.path.exists(manifest_path):
        manifest = json.load(io.open(manifest_path, encoding="utf-8"))
        for row in manifest["sources"]:
            path = os.path.abspath(os.path.join(HERE, row["file"]))
            if os.path.commonpath((os.path.abspath(snapshot), path)) != os.path.abspath(snapshot):
                raise ValueError("profile source outside snapshot")
            with open(path, "rb") as stream:
                raw = stream.read()
            if hashlib.sha256(raw).hexdigest() != row["sha256"]:
                raise ValueError("pinned profile source changed")
            pinned[row["name"]] = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    for f in PROFILE_DOCS:
        t = pinned[f] if pinned else io.open(os.path.join(HERE, "..", "..", "..", "aegi-knowledge", "schema", "specs", f), encoding="utf-8").read()
        for blk in re.findall(r"```yaml\n(.*?)```", t, re.S):
            try:
                d = yaml.safe_load(blk)
            except Exception:
                continue
            if isinstance(d, dict) and d.get("object_type"):
                d["_doc"] = f
                out.append(d)
    return out


def leaf(m, shapes, path):
    """레코드 모양들에서 경로(a.b, a[].b)를 따라가 마지막 필드를 담은 모양 -> [(모양, 필드)]"""
    segs_ = [x.replace("[]", "") for x in path.split(".")]
    cur = set(shapes)
    for i, sgm in enumerate(segs_):
        nxt = set()
        for x in cur:
            for y in m.obj(x) or [x]:
                for pr in (m.shapes.get(y) or {}).get("props") or []:
                    if pr["name"] != sgm:
                        continue
                    if i == len(segs_) - 1:
                        nxt.add((y, sgm))
                    else:
                        sh = m.shapes.get(pr.get("shape") or "") or {}
                        nxt.add((sh.get("items") or {}).get("shape") if sh.get("kind") == "array" else pr.get("shape"))
        if i == len(segs_) - 1:
            return sorted(z for z in nxt if isinstance(z, tuple))
        cur = {z for z in nxt if z}
    return []


def profile_audit():
    from object_audit import Matcher
    from map3 import Map3
    profs = profiles()
    res = {}
    mts, maps, prs = {}, {}, {}
    def spaces_of(p, d):
        mt = mts[p]
        eps = d.get("endpoints") or (d.get("collect") or {}).get("endpoints") or []
        sp = set()
        for e in eps:
            if e.get("role") not in ("primary", "detail"):
                continue
            for oid in mt.ops_for("%s %s" % (e.get("method", "GET"), e.get("path", ""))):
                sp |= {s for _, s in mt.spaces_for(oid)}
        return sp
    for d in profs:
        p = PROF_PROV.get(d.get("provider"))
        if not p:
            continue
        if p not in mts:
            mts[p] = Matcher(p)
            m = Map3(p)
            m.build_edges()
            m.spaces()
            m.ids()
            maps[p] = m
            prs[p] = pairs(p)[0]
    by_type = collections.defaultdict(set)
    for d in profs:
        p = PROF_PROV.get(d.get("provider"))
        if p:
            by_type[(p, d["object_type"])] |= spaces_of(p, d)
    for d in profs:
        p = PROF_PROV.get(d.get("provider"))
        if not p:
            continue
        m, pr = maps[p], prs[p]
        src = by_type[(p, d["object_type"])]
        shs = [x for x, n in m.shape_space.items() if n in src]
        for name, ref in sorted((d.get("references") or {}).items()):
            if not isinstance(ref, dict):
                continue
            tgt_t = ref.get("object_type")
            tgt = by_type.get((p, tgt_t), set())
            row = {"profile": "%s.%s" % (d.get("provider"), d["object_type"]), "ref": name, "path": ref.get("path") or ref.get("from"),
                   "target_type": tgt_t, "relation_type": ref.get("relation_type"), "source_spaces": sorted(src), "target_spaces": sorted(tgt)}
            if name == "tenant":
                row["status"] = "tenant"
            elif not src:
                row["status"] = "source_unmapped"
            elif not ref.get("path"):
                row["status"] = "from_request"              # $request 에서 오는 참조: 경로 맥락이나 RPC 맥락으로 본다
                hits = [(a, b) for a in src for b in tgt if frozenset((a, b)) in pr]
                row["status"] = "found" if hits else "from_request_missing"
            else:
                lf = leaf(m, shs, ref["path"])
                roles = [m.id_role.get(z) for z in lf]
                tg = sorted({r["target"] for r in roles if r and isinstance(r.get("target"), str)})
                row["field_found"] = bool(lf)
                row["map_targets"] = tg
                if not lf:
                    row["status"] = "field_not_in_schema"
                elif not tg:
                    row["status"] = "target_unknown"
                elif tgt and set(tg) & tgt:
                    row["status"] = "found"
                elif not tgt:
                    row["status"] = "found_target_profile_unmapped" if tg else "target_profile_unmapped"
                else:
                    row["status"] = "target_differs"
            res.setdefault(p, []).append(row)
    with io.open(os.path.join(HERE, "out2", "rel_audit_profiles.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "profiles" in sys.argv:
        for p, rows in profile_audit().items():
            print("==", p, dict(collections.Counter(x["status"] for x in rows)))
            for x in rows:
                if x["status"] not in ("found", "tenant"):
                    print("   %-26s %-22s %-24s -> %-14s %s src=%s tgt=%s map=%s" % (x["status"], x["profile"], x["ref"], x["target_type"], x["relation_type"], x["source_spaces"][:2], x["target_spaces"][:2], x.get("map_targets")))
        sys.exit(0)
    r = audit()
    for p, rows in r.items():
        c = collections.Counter((x.get("kind", "rel"), x["status"]) for x in rows)
        print("==", p, dict(c))
        for x in rows:
            if x["status"] != "found" and x.get("kind") != "tenant":
                print("   %-9s %s -%s-> %s  %s | %s" % (x["status"], x["source"], x["label"], x["target"], x["source_spaces"][:2], x["target_spaces"][:2]))
