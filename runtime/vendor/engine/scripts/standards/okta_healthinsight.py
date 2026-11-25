"""Okta HealthInsight tasks and recommendations 16개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
기준 문서(HealthInsight 보안 권고 페이지)에는 수치 문턱값이 없다. 문서 문장이 정하는 구조 조건만 pass/fail 로 판정하고,
조직이 정해야 하는 값(몇 명, 얼마나 짧게, 어떤 IP)은 org_policy 로 두어 현재 값을 보여 준다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, glob, os, sys, collections

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out("okta_healthinsight")
OK = os.path.join(RAW, "okta")
STD = "Okta HealthInsight tasks and recommendations"
ITEMS = P.ITEMS

std_items = [x for x in json.load(open(ITEMS, encoding="utf-8")) if x["source"] == STD]
titles = {x["id"]: x["title"] for x in std_items}
fid = {s["id"]: f["finding_id"] for f in json.load(open(UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"] == STD}
objs = json.load(open(os.path.join(DS, "objects.json"), encoding="utf-8"))
keys = {o["fixture_key"] for o in objs}

def load(call, kind=None, probe=None):
    out = []
    for f in sorted(glob.glob(os.path.join(OK, f"{call}-*.json"))):
        e = json.load(open(f, encoding="utf-8")); rp = e.get("request_params") or {}
        if kind and rp.get("kind") != kind: continue
        if probe and rp.get("probe") != probe: continue
        for x in e["payload"] if isinstance(e["payload"], list) else [e["payload"]]:
            if isinstance(x, dict): out.append((rp, x))
    return out

def get(o, path):
    for k in path.split("."):
        if not isinstance(o, dict) or k not in o: return None
        o = o[k]
    return o

policies = {x["id"]: x for rp, x in load("OK-10") if not rp.get("policy") and "id" in x}
rules = {}
for rp, x in load("OK-10"):
    if rp.get("policy") and "id" in x: rules.setdefault(rp["policy"], []).append(x)
for v in rules.values(): v.sort(key=lambda r: r.get("priority", 99))
zones = [x for _, x in load("OK-22", "zones")]
apps = [x for _, x in load("OK-07") if x.get("label")]
threat = next((x for _, x in load("OK-90", probe="ThreatInsightConfiguration")), None)
threat_key = next((o["fixture_key"] for o in objs if o["canonical"]["provider"] == "okta" and o["canonical"]["object_type"] == "ThreatInsightConfiguration"), None)
behaviors = [x for _, x in load("OK-90", probe="behaviors")]
org = next(iter(load("OK-01")), (None, {}))[1]

# 사용자·그룹에 부여된 SUPER_ADMIN (OK-06)
super_users, super_groups = [], []
for f in sorted(glob.glob(os.path.join(OK, "OK-06-*.json"))):
    e = json.load(open(f, encoding="utf-8")); rp = e.get("request_params") or {}
    if not isinstance(e["payload"], list) or "role" in rp: continue
    if rp.get("user") and any(r.get("type") == "SUPER_ADMIN" for r in e["payload"]): super_users.append(rp["user"])
    if rp.get("group") and any(r.get("type") == "SUPER_ADMIN" for r in e["payload"]): super_groups.append(rp["group"])
users = {x["id"]: x for _, x in load("OK-02")}

def key(t, i):
    k = f"im:okta:{t}:{i}"
    return {"key": k, "in_graph": k in keys}

items = {}
def emit(iid, status, rule, threshold="", targets=(), note=""):
    items[iid] = {"item_id": iid, "title": titles.get(iid, ""), "finding_id": fid.get(iid), "status": status,
                  "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}

def worst(ts):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in ts), key=lambda s: order[s]) if ts else "unknown"

def R(source, field, condition, combine): return {"source": source, "field": field, "condition": condition, "combine": combine}
DOC = "문서 문장: "

# 1) Super admin 수: 몇 명까지인지는 문서에 없다
ts = [{**key("User", u), "name": (users.get(u, {}).get("profile") or {}).get("login", u), "value": "SUPER_ADMIN", "status": "unknown"} for u in super_users]
ts += [{**key("Group", g), "name": "그룹", "value": "SUPER_ADMIN", "status": "unknown"} for g in super_groups]
emit("Limit the number of super admin roles", "org_policy",
     R("OK-05/OK-06 역할 부여", "SUPER_ADMIN 역할이 부여된 사용자·그룹", "조직이 정한 허용 인원 이하", "역할 보유 주체 수를 센다"), "", ts,
     note=f"SUPER_ADMIN 보유 사용자 {len(super_users)}명, 그룹 {len(super_groups)}개. 허용 인원은 문서에 없고 조직이 정한다.")

# 2) ThreatInsight
act = threat.get("action") if threat else None
st = "not_collected" if threat is None else ("pass" if act == "block" else "fail")
emit("Enable Okta ThreatInsight to block suspicious IP addresses", st,
     R("OK-90 /api/v1/threats/configuration", "action", "== block", "조직 설정 하나"), "block",
     [{"key": threat_key, "in_graph": threat_key in keys, "name": "ThreatInsightConfiguration", "value": act, "status": st}] if threat else [],
     note="항목 제목이 'block suspicious IP addresses' 라 action 이 block 인 것을 켜짐으로 해석했다. audit 은 기록만 한다(해석, 출처 미확인).")

# 3) 세션 수명: 제한의 기준값은 문서에 없다. 수명이 무제한(0)이면 '제한되지 않음'이라 위반, 그 밖은 조직 값
so = [p for p in policies.values() if p.get("type") == "OKTA_SIGN_ON"]
ts = []
for p in so:
    for r in rules.get(p["id"], []):
        l, i = get(r, "actions.signon.session.maxSessionLifetimeMinutes"), get(r, "actions.signon.session.maxSessionIdleMinutes")
        ts.append({**key("PolicyRule", r["id"]), "name": f"{p['name']} / {r['name']}", "value": {"idleMin": i, "lifetimeMin": l, "status": r.get("status")},
                   "status": "fail" if l == 0 else ("unknown" if l is None else "unknown")})
unl = any(t["status"] == "fail" for t in ts)
emit("Enforce a limited session lifetime for all policies", "fail" if unl else "org_policy",
     R("OK-10 OKTA_SIGN_ON 정책 규칙", "actions.signon.session.maxSessionLifetimeMinutes", "0(무제한)이 아님. 얼마나 짧아야 하는지는 조직이 정함", "규칙 하나라도 무제한이면 위반"), "", ts,
     note="문서에 기준값이 없다. 수명 0 을 무제한으로 본 것은 Okta 세션 설정의 0 의미에 따른 해석이다(출처 미확인).")

# 4~8) 조직 알림: OK-01 응답에 필드가 없다
for iid, fld in [("Enable Suspicious Activity Reporting", "reportSuspiciousActivityEnabled"),
                 ("Enable new sign-on email notifications", "sendEmailForNewDeviceEnabled"),
                 ("Enable authenticator enrollment notifications", "sendEmailForFactorEnrollmentEnabled"),
                 ("Enable authenticator reset notifications", "sendEmailForFactorResetEnabled"),
                 ("Password changed notification for end users", "sendEmailForPasswordChangedEnabled")]:
    emit(iid, "pass" if org.get(fld) is True else ("fail" if fld in org else "not_collected"),
         R("OK-01 /api/v1/org", fld, "== true", "조직 설정 하나"), "켜짐",
         note=f"수집한 OK-01 응답에 {fld} 가 없다. 이 값을 주는 호출은 수집 목록에 없다. 필드 이름은 Mondoo 기준과 같은 이름을 쓴 것(출처: Mondoo 쿼리, HealthInsight 문서에는 필드 이름 없음).")

# 9) SAML/OIDC
ts = [{**key("Application", a["id"]), "name": a["label"], "value": a.get("signOnMode"), "status": "pass" if a.get("signOnMode") in ("OPENID_CONNECT", "SAML_2_0") else "fail"}
      for a in apps if a.get("signOnMode") != "BOOKMARK" and a.get("status") == "ACTIVE"]
emit("Use SAML or OIDC authentication for app access", worst(ts),
     R("OK-07 /api/v1/apps", "signOnMode", "OPENID_CONNECT 또는 SAML_2_0 (ACTIVE 앱, BOOKMARK 제외)", "앱마다 보고 하나라도 어기면 위반"), "OIDC 또는 SAML", ts,
     note="BOOKMARK 는 로그인 방식이 없는 링크라 제외했다. 문서에 제외 규정은 없고 같은 값을 보는 Mondoo 기준의 식을 따른 해석이다(출처 미확인).")

# 10) 인증 빈도: 앱 로그인 정책 규칙의 재인증 주기. 얼마나 짧아야 하는지는 문서에 없다
ts = []
for p in policies.values():
    if p.get("type") != "ACCESS_POLICY": continue
    for r in rules.get(p["id"], []):
        v = get(r, "actions.appSignOn.verificationMethod.reauthenticateIn")
        ts.append({**key("PolicyRule", r["id"]), "name": f"{p['name']} / {r['name']}", "value": v, "status": "unknown"})
emit("Change the authentication frequency", "org_policy",
     R("OK-10 ACCESS_POLICY 규칙", "actions.appSignOn.verificationMethod.reauthenticateIn", "조직이 정한 재인증 주기 이하", "규칙마다 값을 보여 줌"), "", ts,
     note="문서에 기준 주기가 없다. 값은 ISO 8601 기간(PT0S 는 매번 재인증).")

# 11) 위험 점수
ts = []
for p in policies.values():
    if p.get("type") != "ACCESS_POLICY": continue
    for r in rules.get(p["id"], []):
        lvl = get(r, "conditions.riskScore.level")
        fm = get(r, "actions.appSignOn.verificationMethod.factorMode")
        mfa_req = fm == "2FA"
        ok = r.get("status") == "ACTIVE" and lvl in ("MEDIUM", "HIGH") and mfa_req
        ts.append({**key("PolicyRule", r["id"]), "name": f"{p['name']} / {r['name']}",
                   "value": {"status": r.get("status"), "riskScoreLevel": lvl, "factorMode": fm, "requiresMfa": mfa_req},
                   "status": "pass" if ok else "fail"})
emit("Evaluate a risk score for each request", "pass" if any(t["status"] == "pass" for t in ts) else "fail",
     R("OK-10 ACCESS_POLICY 규칙", "status, conditions.riskScore.level, actions.appSignOn.verificationMethod.factorMode", "ACTIVE 이고 level 이 MEDIUM 또는 HIGH 이면서 factorMode == 2FA 인 규칙이 1개 이상", "규칙 중 하나라도 만족하면 통과, 없으면 위반"),
     "MEDIUM 또는 HIGH 위험에서 2FA 요구", ts,
     note="ACTIVE 인 ACCESS_POLICY 규칙 중 riskScore.level 이 MEDIUM 또는 HIGH 이면서 factorMode 가 2FA 인 규칙이 있으면 통과, 없으면 위반. ANY 나 None 은 위험 수준을 가리지 않는 것으로 해석")

# 12) 차단 영역: 어떤 IP·위치를 막을지는 조직이 정한다. 차단 영역에 내용이 하나도 없으면 위반
def content(z):
    return bool(z.get("gateways")) or any(get(z, f"{k}.include") for k in ("locations", "ipServiceCategories", "asns"))
bl = [z for z in zones if z.get("usage") == "BLOCKLIST"]
ts = [{**key("NetworkZone", z["id"]), "name": z["name"], "value": {"type": z.get("type"), "status": z.get("status"), "has_entries": content(z)},
       "status": "unknown" if z.get("status") == "ACTIVE" and content(z) else "fail"} for z in bl]
has = any(t["status"] == "unknown" for t in ts)
emit("Blocklist Network Zones to deny access to your Okta tenant", "org_policy" if has else "fail",
     R("OK-22 /api/v1/zones", "usage == BLOCKLIST 영역의 status 와 gateways·locations·ipServiceCategories·asns", "활성 차단 영역에 막을 대상이 들어 있음. 무엇을 막을지는 조직이 정함",
       "활성이고 내용이 있는 차단 영역이 없으면 위반, 있으면 조직 값과 대조 필요"), "", ts,
     note="차단 영역 중 활성이면서 IP·위치·ASN·익명화 범주가 하나라도 든 것이 없으면 '차단 목록이 없다'로 봤다(해석, 출처 미확인).")

# 13) 강한 비밀번호 정책: 강함의 값은 문서에 없다
pw = [p for p in policies.values() if p.get("type") == "PASSWORD"]
ts = [{**key("Policy", p["id"]), "name": p["name"], "value": {"maxAttempts": get(p, "settings.password.lockout.maxAttempts"), "historyCount": get(p, "settings.password.age.historyCount"),
       "minAgeMinutes": get(p, "settings.password.age.minAgeMinutes"), "minLength": get(p, "settings.password.complexity.minLength")}, "status": "unknown"} for p in pw]
emit("Enable strong password policy settings", "org_policy",
     R("OK-10 PASSWORD 정책", "settings.password.lockout.maxAttempts, age.historyCount, age.minAgeMinutes, complexity.minLength", "조직이 정한 값 이상(잠금은 이하)", "정책마다 값을 보여 줌"), "", ts,
     note="문서는 잠금·이력·최소 기간·최소 길이를 강하게 하라고만 하고 값을 주지 않는다.")

# 14) MFA 등록 정책의 필수 인증자
mfa = [p for p in policies.values() if p.get("type") == "MFA_ENROLL"]
ts = []
for p in mfa:
    req = [a.get("key") for a in get(p, "settings.authenticators") or [] if get(a, "enroll.self") == "REQUIRED"]
    req += [n for n, v in (get(p, "settings.factors") or {}).items() if get(v, "enroll.self") == "REQUIRED"]
    ts.append({**key("Policy", p["id"]), "name": p["name"], "value": {"REQUIRED": req}, "status": "fail" if not req else "unknown"})
emit("Set a required authenticator for MFA enrollment policies", "fail" if any(t["status"] == "fail" for t in ts) else "org_policy",
     R("OK-10 MFA_ENROLL 정책", "settings.authenticators[].enroll.self == REQUIRED", "필수(REQUIRED) 인증자가 지정됨", "정책마다 보고 하나라도 필수 인증자가 없으면 위반"), "필수 인증자 있음", ts,
     note="필수 인증자가 있는 정책의 값이 okta_password 뿐이라 문서가 말하는 MFA 등록 보장과 같은지 해석이 갈려 org_policy 로 판정. 비밀번호만으로 충분한지는 조직이 정한다")

# 15) MFA 요구와 행동 감지의 충돌
ts = [{**key("BehaviorRule", b["id"]), "name": b.get("name"), "value": b.get("status"), "status": "unknown"} for b in behaviors]
emit("MFA requirements", "manual",
     R("OK-10 정책 규칙, OK-90 /api/v1/behaviors", "규칙 조건과 행동 감지 규칙", "MFA 요구가 행동 감지와 충돌하지 않음", "충돌 판정 기준이 문서에 없음"), "", ts,
     note="행동 감지 규칙 8개는 모두 ACTIVE 이나 문서에 '충돌'의 판정 기준이 없고, 정책 규칙에서 행동 감지 조건 필드(behaviors)를 가진 규칙도 수집 원본에서 보이지 않는다. 판정 기준이 문서에 없어 사람 검토")

# 16) Admin Console MFA: okta_stig.py(OKTA-APP-000560)와 같은 해석 — 'Okta Admin Console' 정책의 1순위 활성 규칙 factorMode == 2FA
p = next((p for p in policies.values() if p.get("type") == "ACCESS_POLICY" and p.get("name") == "Okta Admin Console"), None)
rs = [r for r in rules.get(p["id"], []) if r.get("status") == "ACTIVE"] if p else []
v = get(rs[0], "actions.appSignOn.verificationMethod.factorMode") if rs else None
st = "unknown" if v is None else ("pass" if v == "2FA" else "fail")
emit("MFA for the Admin Console", st,
     R("OK-10 'Okta Admin Console' 앱 로그인 정책", "1순위 활성 규칙 actions.appSignOn.verificationMethod.factorMode", "== 2FA", "1순위 활성 규칙 하나만 본다"), "2FA",
     [{**key("PolicyRule", rs[0]["id"]), "name": rs[0].get("name"), "value": v, "status": st}] if rs else [],
     note="DISA STIG OKTA-APP-000560 과 같은 해석(같은 값을 보므로).")

out = {"standard": STD, "tier": std_items[0]["source_tier"], "provider": "okta", "raw_run": os.path.basename(RAW.rstrip("\\/")),
       "items": [items[x["id"]] for x in std_items if x["id"] in items]}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
missing = sorted(set(titles) - set(items))
print(len(out["items"]), "items", dict(collections.Counter(i["status"] for i in out["items"])), "누락:", missing)
for i in out["items"]:
    print(f"{i['item_id'][:60]:60} {i['status']:13} {i['finding_id']}  " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in i["targets"])[:90])
print("그래프에 없는 대상 키:", sorted({t["key"] for i in out["items"] for t in i["targets"] if not t["in_graph"]}))
