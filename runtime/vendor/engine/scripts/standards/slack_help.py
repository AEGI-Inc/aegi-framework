"""Slack Help: Security tips to protect your workspace 판정. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)"""
SLUG = "slack_help"
STD = 'Slack Help: Security tips to protect your workspace'
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

users, chans, mem, team = slack_load()
TK = K(f"im:slack:200.team:{team['id']}")
emit("Set up two-factor authentication", "not_collected", {"source": "SL-02 users.list", "field": "has_2fa", "condition": "모든 사용자 2FA 사용(또는 워크스페이스 2FA 필수)", "combine": "사용자마다"}, "2FA 필수",
     note="users.list 응답에 has_2fa 필드가 없고 2FA 필수 설정을 읽는 호출도 수집에 없다. 이 워크스페이스는 모든 사용자에 enterprise_user 가 있어 SSO 로 2FA 를 관리할 수 있으나 그것이 설정된 값은 수집에 없다")
emit("Manage apps with care", "unknown", {"source": "SL-08 admin.apps.approved.list·restricted.list", "field": "approved_apps, restricted_apps", "condition": "앱 승인 필요 설정이 켜져 있음", "combine": ""},
     targets=[{**TK, "name": team["name"], "value": {"approved_apps": 0, "restricted_apps": 0}, "status": "unknown"}],
     note="승인·제한 앱 목록은 팀·엔터프라이즈 모두 비어 있다. 이 값으로 앱 승인 요구 설정이 켜져 있는지는 알 수 없다(출처 미확인)")
emit("Only invite people you know", "not_collected", {"source": "(없음)", "field": "초대 승인 필요 설정", "condition": "초대에 관리자 승인 필요", "combine": ""}, "관리자 승인 필요", note="초대 설정을 읽는 호출이 수집에 없다")
ed = (team.get("email_domain") or "").strip()
iv = team.get("is_verified")
ed_st = "pass" if not ed else ("pass" if iv is True else ("fail" if iv is False else "unknown"))
emit("Verify email domains", ed_st, {"source": "SL-00 team.info", "field": "email_domain, is_verified", "condition": "자동 가입 허용 이메일 도메인이 없거나 검증됨", "combine": ""},
     "email_domain 비어 있음 또는 is_verified == true",
     targets=[{**TK, "name": team["name"], "value": {"email_domain": team.get("email_domain"), "is_verified": team.get("is_verified")}, "status": ed_st}],
     note="email_domain 이 비어 있으면 자동 가입 도메인이 없어 통과, 값이 있고 is_verified 가 true 면 통과, false 면 위반")
act = [u for u in users.values() if human(u)]
MAN("Deactivate members' accounts who no longer need access", "SL-02 users.list", "deleted", "필요 없어진 계정이 비활성화됨",
    f"누가 접근이 필요 없는지는 값으로 정해지지 않는다. 참고: 사람 계정 {len(act)}개가 모두 활성(deleted=false)")
ext = [c for c in chans if c.get("is_ext_shared")]
MAN("Use Slack Connect to work with external people", "SL-03 conversations.list", "is_ext_shared", "외부 협업을 Slack Connect 로 함",
    f"외부 공유 채널 {len(ext)}개. 이메일·게스트로 협업하는지는 값으로 정해지지 않는다")
guests = [u for u in users.values() if u.get("is_restricted") or u.get("is_ultra_restricted")]
emit("Use guest accounts and limit the channels they're invited to", "pass" if not guests else "unknown",
     {"source": "SL-02 users.list, SL-04 conversations.members", "field": "is_restricted, is_ultra_restricted", "condition": "게스트가 필요한 채널에만 있음", "combine": "게스트 사용자마다"}, "",
     [{**ukey(u), "name": u["name"], "value": {"is_restricted": u.get("is_restricted"), "is_ultra_restricted": u.get("is_ultra_restricted")}, "status": "unknown"} for u in guests],
     f"게스트 {len(guests)}명이라 위반 대상이 없다. 게스트가 있으면 필요한 채널의 범위는 값으로 정해지지 않는다")
emit("Manage email display", "not_collected", {"source": "(없음)", "field": "이메일 표시 설정", "condition": "이메일 표시가 관리자·소유자로 제한됨", "combine": ""}, note="설정을 읽는 호출이 수집에 없다")
emit("Set session duration", "not_collected", {"source": "(없음)", "field": "세션 지속 시간 설정", "condition": "로그인 세션 시간이 제한됨", "combine": ""}, note="설정을 읽는 호출이 수집에 없다. 제한 시간 값은 조직이 정함")
MAN("Understand Slack usage - Analytics", "(없음)", "분석 데이터", "분석 데이터를 확인함", "운영 활동이라 SaaS 설정 값이 아니다")
n = sum(len(p.get("entries", [])) for _, p in load("slack", "SL-11"))
MAN("Understand Slack usage - Audit logs and anomaly events", "SL-11 audit/v1/logs", "entries", "감사 로그·이상 이벤트를 모니터링함", f"감사 로그 API 는 읽혔다(항목 {n}개). 모니터링을 하는지는 운영 절차라 값으로 정해지지 않는다")
MAN("Understand Slack usage - SIEM or SOAR tools", "(없음)", "SIEM·SOAR 연동", "Slack 이벤트를 SIEM·SOAR 로 보냄", "Slack 밖의 운영 구성이다")
finish("slack")
