# -*- coding: utf-8 -*-
"""2단계: 중복 공간 판정 (2026-10-18).

    python dup_audit.py <p> [--send]     # out2/<p>/map/same_entity.json

같은 대상을 가리키는 ID 공간을 묶는다. 신호는 여섯 가지다.

| 신호 | 근거 | 세기 |
| S1 node_id | GitHub REST 예시의 node_id 를 해독한 GraphQL 타입 = 그 GraphQL 공간 | REST 공간의 node_id 가 한 타입으로만 풀리면 강함, 여러 타입이면(다형) 후보 |
| S2 같은 키 값 | 두 공간의 자기 키 값이 같다 (부모 안 공간, D5 연결 레코드 제외) | 실측 값이 겹치면 강함, 문서 예시만 겹치면 후보 |
| S3 D5 대상 | D5 로 세운 대상(부모 안 키)의 연결 레코드 키 값이 다른 공간의 원문 또는 학습 형식에 맞는다 | 강함 (형식 맞춤). 못 정하면 미정 |
| S4 형식 쌍 | Jev 키의 예시 값이 다른 공간의 원문 ID 형식에 맞는다 (format_twins) | 후보 |
| S5 기존 규칙 | map3.check 의 중복 후보 (값 쌍, 왕복) | 후보 |
| S6 같은 접두사 | 학습 접두사의 키 값을 가진 다른 공간 (Okta 00u 가 13개 공간) | 후보 |

후보는 Jev 중복 과제로 확인한다. 같은 대상 0.8 이상이고 하위 유형 0.6 미만이면 같음이다.
연결 레코드 대상 Choice는 0.7 이상을 쓴다. 합친 값은 판정 기록이며 현재 임계값으로 쓰지 않는다.
같음 쌍으로 묶음을 만들고 대표 공간을 고른다(전역 위치 > 부모 안 > ... 순). 지도 공간은 바꾸지 않는다. rel_audit 이 묶음을 읽어 쓴다.
"""
import base64
import collections
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from map3 import Map3, decode_node_id   # noqa: E402

FORM_RANK = ["global", "local", "singleton", "local_singleton", "model_key", "write_addressed", "key_only", "value_identity",
             "promoted_key", "ref_only", "catalog_key", "composite_key"]
PLACEHOLDER = re.compile(r"^(\d{1,5}|string|abc.*|x+|test.*|example.*|id|1234.*)$", re.I)


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)


def collect(p):
    m = Map3(p)
    m.run()
    sp = {s["name"]: s for s in m.space.values()}
    shape_sp = dict(m.shape_space)
    kv = collections.defaultdict(lambda: collections.defaultdict(set))   # 공간 -> 값 -> 등급
    gql_types = collections.defaultdict(set)                             # REST 공간 -> node_id 해독 타입
    for ins in m.insts:
        o = m.ops.get((ins.get("of") or {}).get("operation", ""))
        if not o or not m.resp(o) or ins["grade"] not in ("observed", "example"):
            continue
        for sid, name, v, _ in m.walk(ins["value"], m.resp(o)):
            r = m.id_role.get((sid, name))
            if r and r["role"] in ("self_key", "address_key") and isinstance(r.get("target"), str):
                if len(v) >= 6 and "{" not in v and not PLACEHOLDER.match(v):
                    kv[r["target"]][v].add(ins["grade"])
            if name == "node_id" and shape_sp.get(sid) and o.get("surface") != "graphql":
                t = decode_node_id(v)
                if t:
                    gql_types[shape_sp[sid]].add(t)
    return m, sp, kv, gql_types


def candidates(p, m, sp, kv, gql_types):
    cand = collections.defaultdict(list)                                 # frozenset -> [(신호, 세기, 근거)]

    def add(a, b, sig, strong, why):
        if a and b and a != b and a in sp and b in sp:
            cand[frozenset((a, b))].append((sig, strong, why))
    # S1
    for g, rs in sorted(getattr(m, "node_equiv", {}).items()):
        for r in sorted(rs):
            poly = len(gql_types.get(r, ())) > 1
            add(g, r, "S1", not poly, "REST %s 의 node_id 가 GraphQL 타입 %s 로 풀린다%s" % (
                r, sorted(gql_types.get(r, ())), " (여러 타입: 다형)" if poly else ""))
    # S2
    by_val = collections.defaultdict(dict)
    for s_, vals in kv.items():
        for v, g in vals.items():
            by_val[v][s_] = g
    shared = collections.defaultdict(lambda: [0, 0, []])
    for v, d in by_val.items():
        if len(d) < 2 or len(d) > 6:                                     # 7곳 이상에 같은 값이면 자리 표시일 가능성이 크다
            continue
        ss = sorted(d)
        for i in range(len(ss)):
            for j in range(i + 1, len(ss)):
                k = (ss[i], ss[j])
                shared[k][0] += 1
                if "observed" in d[ss[i]] and "observed" in d[ss[j]]:
                    shared[k][1] += 1
                if len(shared[k][2]) < 2:
                    shared[k][2].append(v)
    for (a, b), (n, nobs, ex) in sorted(shared.items()):
        # 부모 안 공간의 키는 부모마다 따로다 (org 비밀값 GH_TOKEN 과 repo 비밀값 GH_TOKEN). D5 연결 레코드의 키는 상대의 id 다
        # (Okta AppUser 의 id 는 사용자 id). 둘 다 같은 키 값이 같은 대상을 뜻하지 않는다
        if any(sp[x]["form"] == "local" or sp[x].get("relation_of") or sp[x].get("link_record") for x in (a, b)):
            continue
        # 문서 예시는 여러 스키마가 같은 값을 재사용한다 (Okta JWK). 실측 값이 겹칠 때만 강하다
        add(a, b, "S2", nobs >= 1, "키 값 %d개가 같다 (실측 %d) 예 %s" % (n, nobs, ex))
    # S3
    rx = []
    for f in m.idfs:
        pat = (f.get("match") or {}).get("pattern")
        if pat and m.idf_space.get(f["id"]) and (f.get("match") or {}).get("prefixes"):
            rx.append((m.idf_space[f["id"]], re.compile(pat)))
    for pf, tg in (getattr(m, "learned_prefix", {}) or {}).items():
        rx.append((tg[0] if len(tg) == 1 else None, re.compile("^" + re.escape(pf) + r"[A-Za-z0-9]{8,}$")))
    for n, s in sp.items():
        if s["form"] != "promoted_key":
            continue
        L = s.get("promoted_from")
        vals = set(kv.get(L, {}))
        tg = set()
        for v in vals:
            tg |= {t for t, r_ in rx if t and r_.match(v)}
        if len(tg) == 1:
            add(n, next(iter(tg)), "S3", True, "연결 레코드 %s 의 키 값이 %s 의 형식에 맞는다 %s" % (L, next(iter(tg)), sorted(vals)[:2]))
        else:
            cand.setdefault(frozenset((n, "?")), []).append(("S3", False, "연결 레코드 %s 의 키 값으로 대상을 못 정했다 (값 %d)" % (L, len(vals))))
    # S4
    for t in getattr(m, "format_twins", []) or []:
        add(m.shape_space.get(t["shape"]), m.idf_space.get(t["id_format"]) if isinstance(m.idf_space.get(t["id_format"]), str) else None,
            "S4", False, "Jev 키 %s 예시 %s 가 원문 형식 %s 에 맞는다" % (t["prop"], t["values"][:2], t["id_format"]))
    # S5
    for d in getattr(m, "duplicates", []) or []:
        a, b = d["spaces"]
        add(a, b, "S5", False, "map3 중복 후보: %s" % d["why"][:2])
    # S6
    for pf, cnt in (getattr(m, "prefix_shared", {}) or {}).items():
        for t in (m.learned_prefix or {}).get(pf, []):
            for o_ in cnt:
                if o_ != t:
                    add(o_, t, "S6", False, "키 값이 같은 접두사 %s 로 시작한다" % pf)
    return cand


def judge(p, do_send):
    import jev_judge as J
    import jev_tasks as T
    m, sp, kv, gql_types = collect(p)
    cand = candidates(p, m, sp, kv, gql_types)
    shapes = m.shapes
    cache = J.load_cache(p)
    key = J.api_key() if do_send else None
    if do_send and not key:
        sys.exit("TYPESAFE_API_KEY 가 없다 (환경 변수 또는 setup-output/secrets/jev.txt)")
    rows, sent = [], 0
    with io.open(J.cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        glob = sorted(n for n, s in sp.items() if s["form"] == "global" and s.get("object_candidate", True))
        opts = {}
        for n in glob:
            v = T.space_view(sp[n], shapes, max_props=10)
            opts[n] = "Object at endpoints %s, schemas %s, fields %s" % (v["endpoints"][:2], v["schemas"][:2], v["fields"][:8])
        for pair, ev in sorted(cand.items(), key=lambda x: sorted(x[0])):
            if "?" in pair:
                # S3 미정: 연결 레코드 경로의 마지막 인자가 어느 전역 공간의 id 인가 (Jev Choice, 선택지는 전역 공간과 none)
                n = next(x for x in pair if x != "?")
                L = sp[n].get("promoted_from")
                ep = "/" + ((sp.get(L) or {}).get("item_positions") or [""])[0]
                tmpl = next((o["path"]["template"] for o in m.ops.values() if o.get("path") and
                             "/".join("{}" if x.startswith("{") else x for x in o["path"]["template"].split("/")) == ep.strip("/")), ep)
                body = {"state": {"endpoint": "/" + tmpl.strip("/"), "last_path_parameter": n.split(".")[-1],
                                  "record_fields": T.space_view(sp[L], shapes, max_props=15)["fields"] if L in sp else []},
                        "model": T.MODEL, "questions": T.keyfield_question(opts)} if opts and len(opts) <= 120 else None
                row = {"pair": [n], "signals": ev, "decision": "undecided"}
                if body:
                    k = J.ckey(body)
                    resp = cache.get(k)
                    if resp is None and do_send:
                        try:
                            resp = J.send(body, key)
                        except Exception as e:                            # noqa: BLE001
                            print("Jev 실패 %s %s" % (n, e))
                            resp = None
                        if resp is not None:
                            cf.write(json.dumps({"key": k, "pair": [n], "task": "promoted_target", "response": resp},
                                                ensure_ascii=False, sort_keys=True) + "\n")
                            cf.flush()
                            cache[k] = resp
                            sent += 1
                    t = ((resp or {}).get("answers") or {}).get("target") or {}
                    ch, pr_ = t.get("choice"), (t.get("probabilities") or {}).get(t.get("choice"))
                    row["jev_target"] = [ch, pr_]
                    if ch and ch != "none" and (pr_ or 0) >= 0.7:
                        row["pair"] = sorted([n, ch])
                        row["decision"] = "same"
                        row["basis"] = "jev_target"
                    elif ch == "none" and (pr_ or 0) >= 0.7:
                        row["decision"] = "no_existing_space"           # 지도에 아직 없는 대상 (새 공간으로 남긴다)
                rows.append(row)
                continue
            a, b = sorted(pair)
            strong = any(s for _, s, _ in ev)
            row = {"pair": [a, b], "signals": [list(x) for x in ev]}
            if strong:
                row["decision"] = "same"
                row["basis"] = "rule"
            else:
                sh = set()
                for _, _, w in ev:
                    sh |= set(re.findall(r"'([A-Za-z_][A-Za-z0-9_.]*)'", w))
                body = {"state": T.duplicate_state(p, a, b, sp[a], sp[b], shapes, sh), "model": T.MODEL, "questions": T.DUPLICATE_QUESTIONS}
                k = J.ckey(body)
                resp = cache.get(k)
                if resp is None and do_send:
                    try:
                        resp = J.send(body, key)
                    except Exception as e:                                # noqa: BLE001
                        print("Jev 실패 %s %s" % ([a, b], e))
                        resp = None
                    if resp is not None:
                        cf.write(json.dumps({"key": k, "pair": [a, b], "task": "duplicates2", "response": resp}, ensure_ascii=False,
                                            sort_keys=True) + "\n")
                        cf.flush()
                        cache[k] = resp
                        sent += 1
                ans = {q: v.get("noul") for q, v in ((resp or {}).get("answers") or {}).items()}
                row["jev"] = ans
                row["combined"] = T.duplicate_combine(ans) if ans else None
                # 판정 (2026-10-18): 규칙 신호가 이미 있으므로 Jev 는 「같은 대상인가」와 「하위 유형인가」만 본다.
                # 「같은 id 로 식별」 진술은 공간 설명에 id 필드가 드러나지 않아 같은 대상 0.93 인 쌍(GitHub Team, team-full)도
                # 0.41 이었다. 네 진술 합치기(combined)는 기록으로 남긴다
                se, vp = ans.get("same_entity"), ans.get("variant_of_parent")
                if se is None or vp is None:
                    row["decision"] = "pending"
                elif se >= 0.8 and vp < 0.6:                 # 하위 유형 진술은 잡음이 커서 0.6 미만 (정답표 GitHub 27쌍으로 확인)
                    row["decision"] = "same"
                    row["basis"] = "jev"
                elif (ans.get("scoped_view") or 0) >= 0.7 or (ans.get("variant_of_parent") or 0) >= 0.7:
                    row["decision"] = "view_or_variant"
                else:
                    row["decision"] = "different"
            rows.append(row)
    # 명시된 원문의 다름 근거는 모델의 대상 선택보다 우선한다. 원래 모델 응답은 행과 캐시에 보존한다.
    for a, b, evidence in m.source_distinct_pairs():
        pair = sorted((a, b))
        hit = [r for r in rows if r["pair"] == pair]
        if not hit:
            hit = [{"pair": pair, "signals": [["source_distinct", True, evidence["locator"]]]}]
            rows.extend(hit)
        for row in hit:
            row["decision"], row["basis"] = "different", "stated"
            row["source_evidence"] = evidence
    # Source explicitly identifies the target of a promoted alternate key.
    # Keep the preceding model response as evidence, but let the stated target win.
    for name, space in sp.items():
        stated, external = space.get("stated_target"), space.get("external_locator")
        if not stated and not external:
            continue
        row = next((r for r in rows if name in r["pair"]), None)
        if row is None:
            row = {"pair": [name], "signals": []}
            rows.append(row)
        if row.get("jev_target"):
            row["previous_jev_target"] = row["jev_target"]
        if external:
            row.update(pair=[name], decision="external_locator", basis="stated",
                       source_evidence=external["evidence"], locator_kind=external["locator_kind"])
            continue
        row.update(pair=sorted([name, stated["target"]]), decision="same", basis="stated",
                   source_evidence=stated["evidence"], key_kind=stated["key_kind"])
    for a, b, evidence in m.source_same_pairs():
        pair = sorted((a,b))
        hit = [r for r in rows if r["pair"] == pair]
        if not hit:
            hit = [dict(pair=pair, signals=[["source_same", True, evidence["locator"]]])]
            rows.extend(hit)
        for row in hit:
            row.update(decision="same", basis="stated", source_evidence=evidence)
    # 사람 결정 (same_entity_decisions.json): 같음은 가장 먼저 묶고, 다름은 반대 근거로 쓴다. 규칙과 Jev 판정보다 앞선다
    hd = {}
    hp = os.path.join(HERE, "same_entity_decisions.json")
    if os.path.exists(hp):
        hd = json.load(io.open(hp, encoding="utf-8")).get(p) or {}
    forced_same = {frozenset(x) for x in hd.get("same") or []}
    forced_diff = {frozenset(x) for x in hd.get("different") or []}
    for r in rows:
        if len(r["pair"]) == 2 and frozenset(r["pair"]) in forced_diff and r["decision"] == "same":
            r["decision"], r["basis"] = "different", "human"
    for x in sorted(forced_same, key=sorted):
        hit = [r for r in rows if len(r["pair"]) == 2 and frozenset(r["pair"]) == x]
        if hit:
            hit[0]["decision"], hit[0]["basis"] = "same", "human"
        elif all(y in sp for y in x):
            rows.append({"pair": sorted(x), "signals": [["human", True, hd.get("why", "")]], "decision": "same", "basis": "human"})
    polymorphic = apply_v2_same_entity(p, rows)
    # 묶을 때 반대 근거를 지킨다: 「다름」으로 판정한 두 공간이 이어 붙기로 한 묶음에 들어가면 그 합치기를 하지 않는다
    # (GitHub GraphQL Team 이 enterprise-team 과 team-full 양쪽에 붙어 둘을 한 묶음으로 만들었다). 강한 근거부터 묶는다
    uf = UF()
    # 「보기나 하위 유형」(view_or_variant)은 반대 근거로 쓰지 않는다. 팀 범위에서 본 저장소처럼 같은 대상의 보기일 수 있다
    diff = {frozenset(r["pair"]) for r in rows if r["decision"] == "different" and len(r["pair"]) == 2 and r.get("basis") != "jev_ignored"}
    diff -= forced_same                                      # 사람이 같다고 한 쌍은 반대 근거가 아니다
    members = collections.defaultdict(set)
    order = {"human": -2, "stated": -1, "rule": 0, "jev_target": 1, "jev": 2}
    for r in sorted((r for r in rows if r["decision"] == "same"), key=lambda r: (order.get(r.get("basis"), 9), r["pair"])):
        a, b = r["pair"]
        ga, gb = uf.find(a), uf.find(b)
        A = members[ga] | {a, ga}
        B = members[gb] | {b, gb}
        if any(frozenset((x, y)) in diff for x in A for y in B):
            r["decision"] = "same_refused"
            r["refused_by"] = sorted(sorted(z) for z in diff if len(z & A) == 1 and len(z & B) == 1)[:2]
            continue
        uf.union(a, b)
        g = uf.find(a)
        members[g] = A | B
    groups = collections.defaultdict(set)
    for x in list(uf.p):
        groups[uf.find(x)].add(x)

    def rank(n):
        s = sp[n]
        return (FORM_RANK.index(s["form"]) if s["form"] in FORM_RANK else 99, -len(s.get("item_positions") or []), n)
    out_groups = []
    for g in groups.values():
        if len(g) < 2:
            continue
        mem = sorted(g, key=rank)
        out_groups.append({"canonical": mem[0], "members": mem, "forms": {x: sp[x]["form"] for x in mem}})
    out_groups.sort(key=lambda x: x["canonical"])
    res = {"provider": p, "pairs": rows, "groups": out_groups, **({"polymorphic": polymorphic} if polymorphic else {}),
           "counts": dict(collections.Counter(r["decision"] for r in rows)),
           "signal_counts": dict(collections.Counter(s for r in rows for s, _, _ in r["signals"]))}
    with io.open(os.path.join(HERE, "out2", p, "map", "same_entity.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"provider": p, "pairs": len(rows), "sent": sent, "counts": res["counts"], "groups": len(out_groups),
                      "largest": max([len(g["members"]) for g in out_groups] or [0])}, ensure_ascii=False))
    return res


V2_OVERRIDES = os.path.join(HERE, "v2", "research_overrides_v2.json")


def _space_props(p, name):
    """공간 모양들의 속성 이름 (v2 근거 검사용)."""
    info = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))["spaces"]
    ids = set(info.get(name, {}).get("shapes") or [])
    out = set()
    for line in io.open(os.path.join(HERE, "out2", p, "ir", "shape.jsonl"), encoding="utf-8"):
        s = json.loads(line)
        if s["id"] in ids:
            out |= {x.get("name") for x in s.get("props") or []}
    return out


def apply_v2_same_entity(p, rows):
    """v2 사용자 결정(v2/research_overrides_v2.json)을 사람 결정 뒤에 적용한다.

    different: 모델이 같다고 한 쌍을 나눈다. basis: 같음은 두고 근거를 규칙이나 사람 결정으로 바꾼다(속성 검사가 통과할 때만).
    polymorphic: 판별 필드 값에 따라 다른 공간을 가리키는 공간을 기록한다. 결정과 맞는 쌍이 없으면 실패한다.
    """
    if not os.path.exists(V2_OVERRIDES):
        return []
    v2 = json.load(io.open(V2_OVERRIDES, encoding="utf-8"))["same_entity"].get(p) or {}

    def hit(pair, code):
        x = frozenset(pair)
        found = [r for r in rows if len(r["pair"]) == 2 and frozenset(r["pair"]) == x and r["decision"] == "same"]
        if not found:
            raise ValueError("v2 same-entity decision %s does not match a same pair %s" % (code, sorted(pair)))
        return found
    for e in v2.get("different") or []:
        for r in hit(e["pair"], e["code"]):
            r["previous"] = {"decision": r["decision"], "basis": r.get("basis")}
            r["decision"], r["basis"], r["v2_decision"] = "different", "human", e["code"]
    for e in v2.get("basis") or []:
        for pair in e["pairs"]:
            if e["check"] != "none":
                a, b = (_space_props(p, x) for x in pair)
                ok = a == b if e["check"] == "identical_properties" else (a <= b or b <= a)
                if not a or not b or not ok:
                    raise ValueError("v2 basis check %s failed for %s" % (e["code"], sorted(pair)))
            for r in hit(pair, e["code"]):
                r["previous"] = {"decision": r["decision"], "basis": r.get("basis")}
                r["basis"] = "human" if e["rule"] == "human_q2" else "rule"
                r["v2_rule"], r["v2_decision"] = e["rule"], e["code"]
    poly = []
    spaces = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))["spaces"]
    for e in v2.get("polymorphic") or []:
        missing = [x for x in [e["space"], *e["cases"].values()] if x not in spaces]
        if missing:
            raise ValueError("v2 polymorphic decision %s names unknown spaces %s" % (e["code"], missing))
        poly.append({"space": e["space"], "field": e["field"], "cases": e["cases"], "v2_decision": e["code"]})
    return poly


def credential_rows(p):
    """복합키 자격증명을 「설치 x 자격증명 종류」 한 행으로 묶는다 (사용자 결정, 1단계 문서 13.6, 2026-10-18).

    - 종류 = 발급 계열 x 값 접두사의 기본형. 발급 계열은 RPC 메서드 이름의 첫 조각(oauth, tooling, openid, apps) 또는
      REST 경로의 마지막 글자 조각(Okta token). 접두사는 회전 표시(xoxe.)를 뗀다 (xoxe.xoxb -> xoxb).
      같은 접두사라도 계열이 다르면 다른 종류다 (tooling.tokens.rotate 의 xoxe.xoxp 는 앱 설정 토큰, oauth 의 xoxp 는 사용자 토큰).
      접두사가 없으면 값 자리 이름(client_secret, url)을 쓴다
    - 갱신 토큰(refresh_token, xoxe-)은 같은 레코드의 접근 토큰 행의 상태다. 회전 동작(begin/completeShortTokenRotation)이
      돌려주는 토큰도 같은 종류 행의 상태와 이력이다 (그 행의 키를 따른다)
    """
    m = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))
    comp = {k: v for k, v in m["spaces"].items() if v["form"] == "composite_key"}
    if not comp:
        return []
    ops = {o["id"]: o for o in Map3(p).ops.values()}

    def family(v):
        o = ops.get((v.get("operations") or [""])[0]) or {}
        if o.get("path"):
            lit = [x for x in o["path"]["template"].split("/") if x and not x.startswith("{")]
            return lit[-1] if lit else "?"
        return (o.get("name") or "?").split(".")[0]

    def base(v):
        pre = sorted({x.split(".")[-1] for x in v.get("token_prefixes") or []})
        return pre
    access, refresh = {}, []
    for k, v in sorted(comp.items()):
        pre = base(v)
        is_refresh = v["material"]["prop"] == "refresh_token" or pre == ["xoxe"]
        if is_refresh:
            refresh.append(k)
            continue
        kind = (family(v), "+".join(pre) if pre else v["material"]["prop"])
        access[k] = kind
    rows = collections.OrderedDict()
    for k, kind in sorted(access.items(), key=lambda x: (x[1], x[0])):
        r = rows.setdefault(kind, {"family": kind[0], "kind": kind[1], "members": [], "state": [], "key_parts": set()})
        r["members"].append(k)
        r["key_parts"] |= set(comp[k].get("key_parts") or [])
    for k in refresh:                                    # 같은 레코드(값을 담은 모양)의 접근 토큰 행으로
        sh = comp[k]["material"]["shape"]
        sib = [a for a in access if comp[a]["material"]["shape"] == sh]
        if sib:
            rows[access[sib[0]]]["state"].append(k)
        else:
            rows.setdefault((family(comp[k]), "refresh"), {"family": family(comp[k]), "kind": "refresh", "members": [k], "state": [],
                                                        "key_parts": set(comp[k].get("key_parts") or [])})
    # 접두사가 여럿 섞인 자리(구형 oauth.access 의 xoxa, xoxp)는 그 접두사들을 모두 가진 행이 있으면 그 행으로
    # 키 없는 자리(회전 응답)는 같은 종류에 키 있는 자리가 있으면 그 행의 상태와 이력이다
    for r in rows.values():
        keyed = [x for x in r["members"] if comp[x].get("key_parts")]
        if keyed:
            r["state"] += [x for x in r["members"] if not comp[x].get("key_parts")]
            r["members"] = keyed
    out = []
    for (fam, kind), r in rows.items():
        out.append({"row": "%s:%s" % (fam, kind), "family": fam, "kind": kind, "members": r["members"], "state": sorted(r["state"]),
                    "key_parts": sorted(r["key_parts"]), "keyless": [x for x in r["members"] if not comp[x].get("key_parts")]})
    with io.open(os.path.join(HERE, "out2", p, "map", "credential_rows.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    return out


if __name__ == "__main__":
    if "--credentials" in sys.argv:
        sys.stdout.reconfigure(encoding="utf-8")
        for p in [a for a in sys.argv[1:] if not a.startswith("--")]:
            for r in credential_rows(p):
                print(p, r["row"], "| 행", r["members"], "| 상태", r["state"], "| 키", r["key_parts"], "| 키 없음", r["keyless"])
        sys.exit(0)
    sys.stdout.reconfigure(encoding="utf-8")
    for p in [a for a in sys.argv[1:] if not a.startswith("--")]:
        judge(p, "--send" in sys.argv)
