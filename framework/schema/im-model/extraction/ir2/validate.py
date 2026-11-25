# -*- coding: utf-8 -*-
"""정규화 끝 게이트 (IR 설계.md 4.2). provider 하나의 out2/<provider>/ir 을 검사한다.

    python validate.py github            # 여럿이면 공백으로, all 이면 8개 전부

검사: 머리, 참조 무결성, union 보존(원문 다시 읽기), 이름 보존(표본 대조), 수명(removed 없음), 완성도 보고,
같은 동작을 여러 출처가 말할 때 높은 순위 출처가 오래된 판인지(4.3).
결과: out2/<provider>/validation.json, out2/<provider>/issues.jsonl (8절 형식, stage=normalize, needs 는 수집 단계)
"""
import collections
import hashlib
import io
import json
import os
import re
import sys

import core
import ir_schema as S
import sdl2

PROVIDERS = ("github", "okta", "slack", "salesforce", "gws", "jira", "confluence", "atlassian", "m365")
RECORD_KINDS = ("read_one", "read_many", "search")


def refs_of(kind, r):
    """행이 가리키는 (종류, id) 목록"""
    out = []
    sh = lambda x: out.append(("shape", x)) if isinstance(x, str) and x else None
    if kind == "shape":
        for p in r.get("props") or []:
            sh(p.get("shape"))
        if isinstance(r.get("items"), dict):
            sh(r["items"].get("shape"))
        for a in r.get("alts") or []:
            sh(a)
        for v in ((r.get("discriminator") or {}).get("map") or {}).values():
            sh(v)
        for a in (r.get("ext") or {}).get("allOf") or []:
            if a.startswith("sh:"):
                sh(a)
        add = (r.get("ext") or {}).get("additional")
        if isinstance(add, dict):
            sh(add.get("shape"))
    elif kind == "operation":
        sh(r.get("request"))
        for x in r.get("responses") or []:
            sh(x.get("shape"))
        for p in r.get("params") or []:
            sh(p.get("shape"))
        out += [("grant", g) for g in r.get("grants") or []]
    elif kind == "key_decl":
        sh(r["shape"])
    elif kind == "id_format":
        for a in r.get("applies") or []:
            sh(a.get("shape"))
            if a.get("operation"):
                out.append(("operation", a["operation"]))
    elif kind == "ref_decl":
        sh(r["from"].get("shape"))
        to = r["to"]
        for x in to.get("shapes") or []:
            sh(x)
        if to.get("key_decl"):
            out.append(("key_decl", to["key_decl"]))
        if to.get("id_format"):
            out.append(("id_format", to["id_format"]))
    elif kind == "binding":
        out.append(("operation", r["operation"]))
        to = r["to"]
        sh(to.get("shape"))
        if to.get("key_decl"):
            out.append(("key_decl", to["key_decl"]))
        if to.get("id_format"):
            out.append(("id_format", to["id_format"]))
    elif kind == "catalog":
        sh(r.get("payload"))
        for t in r.get("targets") or []:
            sh(t.get("shape"))
    elif kind == "grant":
        out += [("operation", o) for o in r.get("operations") or []]
    elif kind == "instance":
        of = r["of"]
        sh(of.get("shape"))
        if of.get("operation"):
            out.append(("operation", of["operation"]))
        if of.get("catalog"):
            out.append(("catalog", of["catalog"]))
    elif kind == "hole":
        at = r["at"]
        sh(at.get("shape"))
        if at.get("operation"):
            out.append(("operation", at["operation"]))
        if at.get("catalog"):
            out.append(("catalog", at["catalog"]))
    return out


def raw_merge(schemas, sch, seen=()):
    """원문 스키마의 속성 이름 집합 (allOf 를 따라 합친다). 검증기는 변환기와 따로 계산한다"""
    names = set((sch.get("properties") or {}).keys())
    for part in sch.get("allOf") or []:
        if "$ref" in part:
            n = part["$ref"].split("/")[-1]
            if n in seen:
                continue
            names |= raw_merge(schemas, schemas.get(n) or {}, seen + (n,))
        else:
            names |= raw_merge(schemas, part, seen)
    return names


def raw_alts(sch):
    if isinstance(sch.get("items"), list) and sch.get("type") != "array" and len(sch["items"]) >= 2:
        return len(sch["items"])                        # Slack 구판: type 없는 items 대안 목록
    for k in ("oneOf", "anyOf"):
        alts = sch.get(k)
        if isinstance(alts, list):
            non = [a for a in alts if not (isinstance(a, dict) and a.get("type") == "null")]
            if len(non) >= 2:
                return len(non)
    return 0


def check(provider):
    ir = core.load_ir(provider)
    idx = {k: {r["id"]: r for r in rows} for k, rows in ir.items()}
    res, issues = {"provider": provider, "counts": {k: len(v) for k, v in ir.items()}}, []

    # 1. 머리와 규격
    viol, sample = collections.Counter(), []
    for k, rows in ir.items():
        for r in rows:
            for e in S.check_row(k, r):
                viol[k + ": " + e.split(":")[0]] += 1
                if len(sample) < 10:
                    sample.append({"kind": k, "id": r.get("id"), "error": e})
            if r.get("src", {}).get("source") not in idx["source"]:
                viol[k + ": 출처 행 없음"] += 1
    res["header"] = {"rows": sum(len(v) for v in ir.values()), "violations": sum(viol.values()), "by_type": dict(viol),
                     "sample": sample}

    # 2. 참조 무결성
    nref, missing = 0, collections.Counter()
    msample = []
    for k, rows in ir.items():
        for r in rows:
            for tk, tid in refs_of(k, r):
                nref += 1
                if tid not in idx[tk]:
                    missing["%s->%s" % (k, tk)] += 1
                    if len(msample) < 10:
                        msample.append({"from": r["id"], "to_kind": tk, "to": tid})
    res["ref_integrity"] = {"refs": nref, "missing": sum(missing.values()), "by_type": dict(missing), "sample": msample}

    # 3, 4. union 보존, 이름 보존 (원문을 다시 읽는다)
    uni = {"expected": 0, "preserved": 0, "missing": []}
    names = {"sampled": 0, "name_ok": 0, "props_ok": 0, "mismatch": []}
    for s in ir["source"]:
        e = core.registry()[s["id"]]
        if e["kind"] != "api_schema":
            continue
        path = core.nemo(e["file"])
        if e["naming"] == "graphql":
            for t in sdl2.parse(io.open(path, encoding="utf-8").read()):
                if t["kind"] in ("union", "interface"):
                    uni["expected"] += 1
                    sh = idx["shape"].get("sh:%s:%s" % (s["id"], t["name"]))
                    if sh and sh["kind"] == "union":
                        uni["preserved"] += 1
                    else:
                        uni["missing"].append("%s:%s" % (s["id"], t["name"]))
            continue
        spec = core.load_spec(path)
        if e["naming"] == "discovery":
            schemas = spec.get("schemas") or {}
        else:
            schemas = spec.get("definitions") if "swagger" in spec else (spec.get("components") or {}).get("schemas") or {}
        schemas = schemas or {}
        for n, sch in sorted(schemas.items()):
            if not isinstance(sch, dict):
                continue
            k = raw_alts(sch)
            sh = idx["shape"].get("sh:%s:%s" % (s["id"], n))
            if k:
                uni["expected"] += 1
                if sh and sh["kind"] == "union" and len(sh.get("alts") or []) == k:
                    uni["preserved"] += 1
                else:
                    uni["missing"].append("%s:%s" % (s["id"], n))
        pick = sorted(schemas, key=lambda n: hashlib.sha256(n.encode("utf-8")).hexdigest())[:40]
        for n in pick:
            sch = schemas[n]
            if not isinstance(sch, dict):
                continue
            names["sampled"] += 1
            sh = idx["shape"].get("sh:%s:%s" % (s["id"], n))
            if not sh or sh.get("name") != n:
                names["mismatch"].append({"schema": "%s:%s" % (s["id"], n), "why": "모양 없음 또는 이름 다름"})
                continue
            names["name_ok"] += 1
            want = raw_merge(schemas, sch)
            got = {p["name"] for p in sh.get("props") or []}
            if want == got:
                names["props_ok"] += 1
            else:
                names["mismatch"].append({"schema": "%s:%s" % (s["id"], n), "only_raw": sorted(want - got)[:5],
                                          "only_ir": sorted(got - want)[:5]})
    uni["missing_count"] = len(uni["missing"])
    uni["missing"] = uni["missing"][:20]
    res["union_preservation"] = uni
    res["name_preservation"] = names

    # 5. 수명
    removed = [r["id"] for rows in ir.values() for r in rows if (r.get("life") or {}).get("state") == "removed"]
    man = json.load(io.open(os.path.join(core.OUT2, provider, "ir", "manifest.json"), encoding="utf-8"))
    res["lifecycle"] = {"removed_in_output": len(removed), "dropped_by_normalizer": len(man.get("dropped_removed", [])),
                        "deprecated": sum(1 for rows in ir.values() for r in rows if (r.get("life") or {}).get("state") == "deprecated"),
                        "collisions": len(man.get("collisions", []))}

    # 6. 완성도
    keyed = {k["shape"] for k in ir["key_decl"]}
    no_resp, rec, rec_nokey, no_body = [], set(), set(), 0

    def record_like(sid, depth=0, many=False):
        """레코드형 모양: 단건 조회 응답 객체, 목록 조회 응답의 원소. 목록 응답이 객체 래퍼면 그 안 배열의 원소를 본다"""
        s = idx["shape"].get(sid)
        if not s or depth > 3:
            return
        if s["kind"] == "object":
            arrs = [p["shape"] for p in s.get("props") or [] if p.get("shape") and (idx["shape"].get(p["shape"]) or {}).get("kind") == "array"]
            if many and arrs:
                for a in arrs:
                    record_like(a, depth + 1)
                return
            rec.add(sid)
        elif s["kind"] == "array" and isinstance(s.get("items"), dict) and s["items"].get("shape"):
            record_like(s["items"]["shape"], depth + 1)
        elif s["kind"] == "union":
            for a in s.get("alts") or []:
                record_like(a, depth + 1)
    for o in ir["operation"]:
        ok = [x for x in o["responses"] if x["status"] is None or str(x["status"]).startswith("2")]
        if not any(x["shape"] for x in ok):
            if ok and all(x["media"] is None and x["status"] is not None for x in ok):
                no_body += 1                       # 원문이 본문 없음(204 등)을 말한다. 빈 곳이 아니다
            else:
                no_resp.append(o["id"])
            continue
        if o["kind"] in RECORD_KINDS:
            for x in ok:
                if x["shape"]:
                    record_like(x["shape"], many=o["kind"] != "read_one")
    rec_nokey = sorted(s for s in rec if s not in keyed)
    cat_nokey = [c["id"] for c in ir["catalog"] if not c.get("key")]
    audit_notarget = [c["id"] for c in ir["catalog"] if c["catalog"] == "audit" and not c.get("targets")]
    holes = collections.Counter(h["hole"] for h in ir["hole"])
    res["completeness"] = {
        "operations": len(ir["operation"]), "operations_without_response_shape": len(no_resp),
        "operations_without_body_by_spec": no_body,
        "record_shapes": len(rec), "record_shapes_without_key_decl": len(rec_nokey),
        "catalog": len(ir["catalog"]), "catalog_without_key": len(cat_nokey),
        "audit_catalog": sum(1 for c in ir["catalog"] if c["catalog"] == "audit"),
        "audit_without_targets": len(audit_notarget), "holes": dict(sorted(holes.items())), "holes_total": sum(holes.values()),
        "key_decl_by_grade": dict(collections.Counter(k["grade"] for k in ir["key_decl"])),
        "operation_kind_grade": dict(collections.Counter(o["kind_grade"] for o in ir["operation"])),
    }

    # 7. 같은 동작, 여러 출처 (4.3)
    by_name = collections.defaultdict(list)
    for o in ir["operation"]:
        by_name[(o["surface"], o["name"])].append(o)
    stale = 0
    for (surf, name), os_ in sorted(by_name.items()):
        srcs = {(o["src"]["rank"], o["src"]["snapshot"] or "", o["src"]["source"]) for o in os_}
        if len({x[2] for x in srcs}) < 2:
            continue
        best = min(srcs)
        newer = [x for x in srcs if x[1] > best[1]]
        if newer:
            stale += 1
            issues.append({"stage": "normalize", "kind": "stale_higher_rank_source", "subject": {"operation": name},
                           "needs": {"stage": "collect", "fact": "source", "detail": "순위가 높은 출처의 판이 더 오래되었다. 판을 고정하거나 새 명세를 받는다"},
                           "evidence": {"sources": sorted([list(x) for x in srcs])}})
    res["source_overlap"] = {"operations_in_multiple_sources": sum(1 for v in by_name.values() if len({o["src"]["source"] for o in v}) > 1),
                             "stale_higher_rank": stale}

    # 문제 기록 (8절)
    for oid in no_resp:
        o = idx["operation"][oid]
        issues.append({"stage": "normalize", "kind": "operation_without_response_shape", "subject": {"operation": oid},
                       "needs": {"stage": "collect", "fact": "shape", "detail": "응답 스키마가 있는 자료(명세, 예시, 테넌트 응답)"},
                       "evidence": {"source": o["src"]["source"], "locator": o["src"]["locator"]}})
    for sid in rec_nokey:
        issues.append({"stage": "normalize", "kind": "record_shape_without_key", "subject": {"shape": sid},
                       "needs": {"stage": "collect", "fact": "key_decl", "detail": "원문 키 근거 또는 사전 한 줄, 테넌트 키 값"},
                       "evidence": {"source": idx["shape"][sid]["src"]["source"]}})
    for cid in cat_nokey:
        issues.append({"stage": "normalize", "kind": "catalog_without_key", "subject": {"catalog": cid},
                       "needs": {"stage": "collect", "fact": "catalog", "detail": "기계 키 목록 (테넌트 4순위, 예: Atlassian event-actions)"},
                       "evidence": {"display": idx["catalog"][cid].get("display")}})
    nt = collections.Counter(idx["catalog"][c]["src"]["source"] for c in audit_notarget)
    for src, n in sorted(nt.items()):
        issues.append({"stage": "normalize", "kind": "audit_without_targets", "subject": {"source": src},
                       "needs": {"stage": "collect", "fact": "catalog.targets", "detail": "대상 선언이 있는 자료 또는 테넌트 감사 로그"},
                       "evidence": {"catalog_entries": n}})
    for h, n in sorted(holes.items()):
        issues.append({"stage": "normalize", "kind": "hole_" + h, "subject": {"hole": h},
                       "needs": {"stage": "collect", "fact": "shape", "detail": "속성이 있는 모양 (예시, SDK 타입, 테넌트 응답)"},
                       "evidence": {"count": n}})
    p = os.path.join(core.OUT2, provider, "normalize_issues.jsonl")
    if os.path.exists(p):
        issues += [json.loads(l) for l in io.open(p, encoding="utf-8")]
    issues.sort(key=core.dumps)
    by_kind = collections.Counter(i["kind"] for i in issues)
    res["issues"] = {"total": len(issues), "by_kind": dict(sorted(by_kind.items())),
                     "to_collect": sum(1 for i in issues if i["needs"]["stage"] == "collect")}
    res["pass"] = res["header"]["violations"] == 0 and res["ref_integrity"]["missing"] == 0 and \
        res["lifecycle"]["removed_in_output"] == 0 and uni["missing_count"] == 0 and res["lifecycle"]["collisions"] == 0
    out = os.path.join(core.OUT2, provider)
    with io.open(os.path.join(out, "validation.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    with io.open(os.path.join(out, "issues.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        for i in issues:
            f.write(core.dumps(i) + "\n")
    return res


def main(args):
    ps = PROVIDERS if args == ["all"] else args
    for p in ps:
        r = check(p)
        c = r["completeness"]
        print("%-11s pass=%s 머리위반=%d 참조누락=%d union=%d/%d 이름=%d/%d 응답없음=%d/%d 키없음=%d/%d 문제=%d" % (
            p, r["pass"], r["header"]["violations"], r["ref_integrity"]["missing"],
            r["union_preservation"]["preserved"], r["union_preservation"]["expected"],
            r["name_preservation"]["props_ok"], r["name_preservation"]["sampled"],
            c["operations_without_response_shape"], c["operations"], c["record_shapes_without_key_decl"], c["record_shapes"],
            r["issues"]["total"]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:] or ["all"])
