"""기준별 판정 파일들을 대시보드 PoC 가 읽는 standard_results.json 하나로 묶는다. 판정은 다시 하지 않는다.
묶은 finding 의 문장과 분류(1층·6종)를 findings_unique_all.json, kinds_bottomup.json 에서 붙인다.
대상 0개라 pass 인 항목은 수집 실행 기록을 보고, 기대는 호출이 full 이 아니면 not_collected 로 바꾼다(guard_empty_pass).
사용: run_all.py 가 부른다(README.md). 직접: python build_standard_results.py <out.json> <기준 판정 파일> ... [--run-record <collected/runs/<run>.json>]
"""
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFS = os.path.join(HERE, "defs")
UNIQ = os.path.join(DEFS, "findings_unique_all.json")
KINDS = os.path.join(DEFS, "kinds_bottomup.json")

SHORT = {"DISA Okta IDaaS STIG V1R2": "DISA Okta STIG V1R2", "CISA SCuBA Google Workspace Baseline 0.6": "CISA SCuBA GWS 0.6",
         "CIS Google Workspace Foundations Benchmark 1.4.0": "CIS GWS 1.4.0",
         "Salesforce Health Check 기본 기준선 (SecurityHealthCheckRisks StandardValue)": "Salesforce Health Check",
         "CIS GitHub Benchmark 1.2.0": "CIS GitHub 1.2.0",
         "GSA CIO-IT Security-11-62 Rev 3 (2023-03-01)": "GSA 11-62 Rev3 (Salesforce)",
         "GitHub Docs: Best practices for preventing data leaks in your organization": "GitHub Docs 데이터 유출 방지",
         "Okta HealthInsight tasks and recommendations": "Okta HealthInsight", "Slack Help: Security tips to protect your workspace": "Slack 보안 팁",
         "Atlassian Support: How do I keep my organization secure?": "Atlassian 보안 가이드",
         "Google Workspace Security checklist for medium and large businesses (100+ users)": "GWS 체크리스트 (중대형)",
         "Google Workspace Security checklist for small businesses (1-100 users)": "GWS 체크리스트 (소규모)",
         "Google Workspace Security checklists (medium/large and small)": "GWS 체크리스트 (공통)",
         "Google Workspace Security health page": "GWS 보안 상태 페이지",
         "AEGI 자체 점검: Google Workspace 계정과 기기": "AEGI 점검 (GWS)", "AEGI 자체 점검: Okta 계정": "AEGI 점검 (Okta)",
         "AEGI 자체 점검: Salesforce 계정": "AEGI 점검 (Salesforce)", "AEGI 자체 점검: Slack 계정": "AEGI 점검 (Slack)",
         "AEGI 관계 점검: Atlassian": "AEGI 관계 점검 (Atlassian)",
         "AEGI 관계 점검: GitHub": "AEGI 관계 점검 (GitHub)",
         "AEGI 관계 점검: Google Workspace": "AEGI 관계 점검 (GWS)",
         "AEGI 관계 점검: Okta": "AEGI 관계 점검 (Okta)",
         "AEGI 관계 점검: Salesforce": "AEGI 관계 점검 (Salesforce)",
         "AEGI 관계 점검: Slack": "AEGI 관계 점검 (Slack)"}


def fill_finding(f, fid, uniq, kinds, default_text=""):
    u = uniq.get(fid, {}) if fid else {}
    k = kinds.get(fid, {}) if fid else {}
    f["text"] = u.get("finding") or default_text
    f["layer"] = k.get("layer", "")
    f["group"] = k.get("group", "")
    f["kind"] = k.get("kind", "")
    return f


def item_targets(status, targets):
    """사람이 정할 항목(org_policy, manual)의 대상은 값을 보여 줄 뿐 판정하지 않았으므로 항목 상태를 따른다.
    기준 스크립트가 이런 대상을 unknown 으로 내면 화면에서 판정 불가로 세어지는 문제를 막는다."""
    if status not in ("org_policy", "manual"):
        return list(targets)
    return [{**t, "status": status} if t.get("status") == "unknown" else t for t in targets]


TENANT_OBJECT_TYPES = {
    "gws": "Customer",
    "okta": "OrgSetting",
    "salesforce": "Organization",
    "atlassian": "ServerInformation",
    "aws": "Account",
    "github": "organization-full",
}


def load_tenant_targets(dataset_dir):
    """데이터셋 objects.json 에서 SaaS 별 단일 테넌트(조직) 객체 정보를 읽는다."""
    if not dataset_dir:
        return {}
    obj_path = os.path.join(dataset_dir, "objects.json")
    if not os.path.exists(obj_path):
        return {}
    with open(obj_path, encoding="utf-8") as f:
        objs = json.load(f)
    tenants = {}
    for provider, obj_type in TENANT_OBJECT_TYPES.items():
        matches = [
            o for o in objs
            if o.get("canonical", {}).get("provider") == provider
            and o.get("canonical", {}).get("object_type") == obj_type
        ]
        if len(matches) == 1:
            o = matches[0]
            c = o.get("canonical", {})
            tenants[provider] = {
                "key": o["fixture_key"],
                "in_graph": True,
                "name": c.get("display_name") or c.get("name") or obj_type,
            }
    return tenants


def fill_empty_fail_targets(it, provider, tenants):
    """fail 인데 target 이 비어 있으면 해당 SaaS 의 조직 객체 키 하나를 target 으로 붙인다."""
    targets = item_targets(it["status"], it.get("targets") or [])
    if it.get("status") == "fail" and not targets and provider in tenants:
        t = tenants[provider]
        val = it.get("threshold") or it.get("note") or ""
        return [{
            "key": t["key"],
            "in_graph": t["in_graph"],
            "name": t["name"],
            "value": val,
            "status": "fail",
            "note": "설정이 없어 조직 객체에 붙임",
        }]
    return targets


CALL_ID = re.compile(r"\b[A-Z]{2,3}-\d{2,3}\b")  # GH-33, GHS-03, SFS-01, GW-24 ...


def load_call_states(paths):
    """수집 실행 기록(collected/runs/<run>.json)에서 호출마다 completeness 를 읽는다.
    앞 기록(본 run)에서 full 이 아닌 호출만 뒤 기록(추가 설정 수집 run) 값으로 바꾼다. 파일이 없으면 그 기록은 비어 있다"""
    states = {}
    for p in paths:
        if not os.path.exists(p):
            print(f"수집 실행 기록이 없음: {p}. 이 기록의 호출은 모두 「기록 없음」으로 본다", file=sys.stderr)
            continue
        for c in json.load(open(p, encoding="utf-8")).get("calls", []):
            if states.get(c["call_id"]) != "full":
                states[c["call_id"]] = c.get("completeness")
    return states


def guard_empty_pass(it, states):
    """대상 0개라 pass 인 항목이 기대는 호출(rule.source 의 호출 ID)이 full 이 아니면 not_collected 로 바꾼다.
    partial·failed·skipped·기록 없음이면 0개가 정말 없는 것인지 읽지 못한 것인지 알 수 없다. states 가 None 이면(실행 기록을 받지 않음) 그대로 둔다"""
    if states is None or it.get("status") != "pass" or it.get("targets"):
        return it
    ids = sorted(set(CALL_ID.findall((it.get("rule") or {}).get("source", ""))))
    open_calls = [f"{c} {states.get(c) or '기록 없음'}" for c in ids if states.get(c) != "full"]
    if not open_calls:
        return it
    note = f"대상 0개지만 수집이 끝까지 되지 않아({', '.join(open_calls)}) 정말 없는지 알 수 없다"
    return {**it, "status": "not_collected", "note": note + (f". 판정기 설명: {it['note']}" if it.get("note") else "")}


def main():
    OUT, args = sys.argv[1], sys.argv[2:]
    files, failed_detectors, run_records = [], [], None
    dataset_dir = os.environ.get("AEGI_STD_DATASET")
    while args:
        arg = args.pop(0)
        if arg == "--failed-detector":
            if not args:
                raise SystemExit("--failed-detector 뒤에 판정기 이름이 필요함")
            failed_detectors.append(args.pop(0))
        elif arg == "--dataset":
            if not args:
                raise SystemExit("--dataset 뒤에 데이터셋 폴더가 필요함")
            dataset_dir = args.pop(0)
        elif arg == "--run-record":
            if not args:
                raise SystemExit("--run-record 뒤에 수집 실행 기록 파일이 필요함")
            run_records = (run_records or []) + [args.pop(0)]
        else:
            files.append(arg)
    if run_records is None and os.environ.get("AEGI_STD_RAW"):
        import std_paths  # run_all.py 가 넘긴 환경변수로 실행 기록 경로(RUNS)를 정한다
        run_records = std_paths.RUN_RECORDS
    call_states = load_call_states(run_records) if run_records is not None else None

    tenants = load_tenant_targets(dataset_dir)

    uniq = {f["finding_id"]: f for f in json.load(open(UNIQ, encoding="utf-8"))}
    kinds = {k["finding_id"]: k for k in json.load(open(KINDS, encoding="utf-8"))}

    standards, findings = [], {}
    for fn in files:
        s = json.load(open(fn, encoding="utf-8"))
        if s.get("not_applicable") is True:
            if s.get("items") != []:
                raise SystemExit(f"해당 없음 판정 파일에 항목이 있음: {fn}")
            continue
        sid = SHORT.get(s["standard"], s["standard"])
        standards.append({"id": sid, "name": s["standard"], "tier": s["tier"], "provider": s["provider"], "raw_run": s["raw_run"]})
        for it in s["items"]:
            it = guard_empty_pass(it, call_states)
            fid = it["finding_id"] or f"{sid}:{it['item_id']}"
            f = findings.setdefault(fid, {"id": fid, "provider": s["provider"], "text": "",
                                          "layer": "", "group": "", "kind": "", "items": []})
            fill_finding(f, it["finding_id"], uniq, kinds, default_text=it["title"])
            f["items"].append({"standard": sid, **{x: fill_empty_fail_targets(it, s["provider"], tenants) if x == "targets" else it[x] for x in ("item_id", "title", "status", "threshold", "rule", "targets", "note")}})

    # 위협 제목 규칙 검사(aegi-knowledge policies.yaml title_check). 위반이 있으면 판정 문장이 Threat 목록 제목이 되므로 모든 문장을 본다.
    # 규칙 값은 엔진 생성 파일(src/ontology/generated.ts THREAT_TITLE_CHECK)에서 읽는다. 게시(standards:publish)도 같은 검사로 거절한다.
    import re
    _gen = open(os.path.join(HERE, "..", "..", "src", "ontology", "generated.ts"), encoding="utf-8").read()
    CHECK = json.loads(re.search(r"export const THREAT_TITLE_CHECK = (\{.*?\}) as const", _gen).group(1))
    bad = sorted(f["id"] for f in findings.values() if f["text"].strip().endswith(tuple(CHECK["forbidden_endings"])) or any(c in f["text"] for c in CHECK["forbidden_chars"]))
    if bad:
        sys.exit(f"판정 문장 {len(bad)}개가 위협 제목 규칙(명사형 끝, 금지 글자)에 맞지 않음. defs/findings_unique_all.json 의 finding 을 명사형으로 고칠 것: {', '.join(bad[:20])}")

    out = {"generated_at": datetime.date.today().isoformat(), "standards": standards,
           "note": "기준 하나 단위로 판정한 결과를 공개 기준끼리 묶은 finding 으로 모았다. 판정은 scripts/standards 의 기준별 스크립트가 했다.",
           "findings": sorted(findings.values(), key=lambda f: f["id"]),
           "failed_detectors": sorted(set(failed_detectors))}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(standards), "standards,", len(findings), "findings,", sum(len(f["items"]) for f in findings.values()), "items")
    print("기준 2개 이상 걸친 finding:", sum(1 for f in findings.values() if len({i["standard"] for i in f["items"]}) > 1))


if __name__ == "__main__":
    main()
