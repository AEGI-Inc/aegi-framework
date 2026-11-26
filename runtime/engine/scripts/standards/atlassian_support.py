"""Atlassian Support: How do I keep my organization secure? 판정. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)"""
SLUG = "atlassian_support"
STD = 'Atlassian Support: How do I keep my organization secure?'
import std_paths as P
import json, glob, os, sys, collections, urllib.parse

RAW = P.RAW
ITEMS = P.ITEMS
UNIQ = P.UNIQ
OBJ = P.OBJ
OUT = P.out(SLUG)

std_items = [i for i in json.load(open(ITEMS, encoding="utf-8")) if i["source"] == STD]
TIER = std_items[0]["source_tier"]
fid = {s["id"]: f["finding_id"] for f in json.load(open(UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"] == STD}
keys = {o["fixture_key"] for o in json.load(open(OBJ, encoding="utf-8"))}
Q = lambda s: urllib.parse.quote(s, safe="")

def load(prov, call):
    out = []
    for f in sorted(glob.glob(os.path.join(RAW, prov, f"{call}-*.json"))):
        e = json.load(open(f, encoding="utf-8"))
        out.append((e.get("request_params") or {}, e["payload"]))
    return out

def K(k): return {"key": k, "in_graph": k in keys}

results = {}
def emit(iid, status, rule, threshold="", targets=(), note=""):
    results[iid] = {"item_id": iid, "title": next(i["title"] for i in std_items if i["id"] == iid), "finding_id": fid.get(iid),
                    "status": status, "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}

def worst(ts):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in ts), key=lambda s: order[s]) if ts else "pass"

def NC(iid, source, field, cond, note="", threshold=""):
    emit(iid, "not_collected", {"source": source, "field": field, "condition": cond, "combine": ""}, threshold, note=note)
def MAN(iid, source, field, cond, note="", threshold="", targets=()):
    emit(iid, "manual", {"source": source, "field": field, "condition": cond, "combine": "값으로 위반이 정해지지 않음"}, threshold, targets, note)

def finish(provider):
    ids = [i["id"] for i in std_items]
    missing = [i for i in ids if i not in results]
    out = {"standard": STD, "tier": TIER, "provider": provider, "raw_run": os.path.basename(RAW),
           "items": [results[i] for i in ids if i in results]}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(SLUG, len(results), "items /", len(ids), dict(collections.Counter(r["status"] for r in results.values())), "누락:", missing)
    for r in out["items"]:
        print(f"  {r['item_id'][:60]:60} {r['status']:13} {r['finding_id']}  " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in r["targets"])[:90])
    print("그래프에 없는 대상 키:", sorted({t["key"] for r in results.values() for t in r["targets"] if not t["in_graph"]}))

# ---- Slack ----
def slack_load():
    users = {u["id"]: u for _, p in load("slack", "SL-02") for u in p["members"]}
    chans = [c for _, p in load("slack", "SL-03") if "channels" in p for c in p["channels"]]
    mem = {rp["channel"]: p["members"] for rp, p in load("slack", "SL-04")}
    team = [p["team"] for _, p in load("slack", "SL-00") if "team" in p][0]
    return users, chans, mem, team
def ukey(u): return K(f"im:slack:200.members[*]:{u['id']}")
def ckey(c): return K(f"im:slack:conversation:{c['id']}")
def human(u): return not u.get("deleted") and not u.get("is_bot") and u["id"] != "USLACKBOT" and not u.get("is_invited_user")
def email_check(user_filter_note):
    users, *_ = slack_load()
    ts = []
    for u in users.values():
        if not human(u): continue
        v = u.get("is_email_confirmed")
        ts.append({**ukey(u), "name": u.get("name"), "value": v, "status": "pass" if v is True else "fail"})
    return ts
def ext_shared_targets():
    _, chans, _, _ = slack_load()
    return [{**ckey(c), "name": c["name"], "value": {"is_ext_shared": c.get("is_ext_shared"), "is_pending_ext_shared": c.get("is_pending_ext_shared")},
             "status": "fail" if c.get("is_ext_shared") else "pass"} for c in chans]

# ---- Atlassian ----
def jira_users():
    return {u["accountId"]: u for _, p in load("atlassian", "JI-02") for u in p}
def jkey(u): return K(f"im:jira:User:{Q(u['accountId'])}")
def conf_spaces():
    return [s for _, p in load("atlassian", "CF-01") for s in p["results"]]
def conf_perms():
    d = collections.defaultdict(list)
    for rp, p in load("atlassian", "CF-02"):
        d[rp["space"]] += p["results"]
    return d
def skey(s): return K(f"im:confluence:spaces:{s['id']}")

ORG = "Atlassian 조직 관리 API"
def nc(i, f, c, note=""): NC(i, ORG, f, c, "조직 관리 API 는 수집하지 않는다. " + note)
MAN("1", "(없음)", "클라우드 현황 파악", "어떤 앱·제품·사용자가 있는지 파악함", "운영 절차")
nc("2", "organization", "조직이 있고 도메인이 인증됨")
MAN("3", "(없음)", "앱별 위험 수준 구성", "위험도에 맞게 앱 설정", "조직이 정하는 위험 수준이라 값으로 정해지지 않는다")
nc("4", "SSO 설정", "SAML·Google Workspace SSO 구성", "Guard Standard 필요.")
nc("5", "SCIM 설정", "SCIM 자동 프로비저닝 구성", "Guard Standard 필요.")
nc("6", "인증 정책", "인증 정책 구성")
nc("7a", "인증 정책 2단계 인증 강제", "조직 전체 2단계 인증 강제", "Guard Standard 필요.")
nc("7b", "인증 정책 소셜 로그인", "Google·Microsoft·Apple·Slack 로그인 차단")
nc("7c", "인증 정책 비밀번호", "비밀번호 강도·만료 규칙")
cf = sum(len(p.get("results", [])) for _, p in load("atlassian", "CF-90")); ji = sum(len(p.get("records", [])) for _, p in load("atlassian", "JI-90"))
MAN("8", "CF-90 audit, JI-90 auditing/record", "감사 기록", "정기적으로 검토함", f"감사 기록 API 는 읽혔다(Confluence {cf}건, Jira {ji}건 수집). 정기 검토는 운영 절차라 값으로 정해지지 않는다")
us = jira_users()
MAN("9", "JI-02 users/search, JI-03 group/bulk", "사용자·그룹 목록", "정기적으로 계정을 감사하고 관리자 접근을 제한함", f"사용자 {len(us)}명 수집. 필요 없는 계정·관리자 여부는 값으로 정해지지 않는다(주기는 조직이 정함)")
MAN("10", "(없음)", "교육", "팀에 보안 모범 사례를 교육함", "SaaS 설정이 아니다")
nc("11", "모바일 정책", "MAM·MDM 정책 구성", "Guard Standard 필요.")
nc("12", "데이터 분류", "데이터 분류 수준·규칙", "Guard Premium 필요.")
nc("13", "데이터 보호 정책", "데이터 보호 정책 구성", "일부 Guard Standard/Premium 필요.")
nc("14", "위협 탐지 설정", "의심 활동 탐지·알림 구성", "Guard Premium 필요.")
nc("15", "분류·보호 정책 조합", "분류 규칙과 데이터 보호 정책 함께 구성", "Guard Premium 필요.")
finish("atlassian")
