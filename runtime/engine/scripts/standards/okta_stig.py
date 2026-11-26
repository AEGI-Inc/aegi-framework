"""DISA Okta IDaaS STIG V1R2 29개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
판정식은 STIG 의 Check 절차(Prowler 사본 CheckText)를 따른다. 값 판정 17개는 20261028-config-checks/config_rules_proto.py 와 같은 식이다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, glob, os, sys

RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out("okta_stig")
OK = os.path.join(RAW, "okta")
STD = "DISA Okta IDaaS STIG V1R2"
titles = json.load(open(P.TITLES, encoding="utf-8"))["okta_stig"]  # Prowler compliance 파일의 요구사항 설명
# 기준 항목 → 묶은 finding (findings_unique_all 의 sources)
fid = {s["id"]: f["finding_id"] for f in json.load(open(UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"].startswith("DISA Okta")}
keys = {o["fixture_key"] for o in json.load(open(os.path.join(DS, "objects.json"), encoding="utf-8"))}

def load(call, kind=None):
    """(request_params, 레코드) 목록. kind 가 있으면 그 종류의 페이지만"""
    out = []
    for f in sorted(glob.glob(os.path.join(OK, f"{call}-*.json"))):
        e = json.load(open(f, encoding="utf-8")); rp = e.get("request_params") or {}
        if kind and rp.get("kind") != kind: continue
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
authenticators = [x for _, x in load("OK-22", "authenticators")]
zones = [x for _, x in load("OK-22", "zones")]
idps = [x for _, x in load("OK-18")]
apps = [x for _, x in load("OK-07") if x.get("label")]
tokens = [x for _, x in load("OK-16")]

def key(t, i):
    k = f"im:okta:{t}:{i}"
    return {"key": k, "in_graph": k in keys}

items = {}
def emit(iid, status, rule, threshold="", targets=(), note=""):
    """status: pass | fail | unknown(값 없음) | not_collected(수집 없음) | org_policy(조직이 정한 값 필요) | manual(사람 검토)"""
    items[iid] = {"item_id": iid, "title": titles.get(iid, ""), "finding_id": fid.get(iid), "status": status,
                  "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}

def worst(ts):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in ts), key=lambda s: order[s]) if ts else "unknown"

# 1) 비밀번호 정책: 활성 PASSWORD 정책마다 본다. 하나라도 어기면 위반
PW = [("OKTA-APP-000170", "settings.password.lockout.maxAttempts", lambda v: v == 3, "== 3"),
      ("OKTA-APP-000650", "settings.password.complexity.minLength", lambda v: v >= 15, ">= 15"),
      ("OKTA-APP-000670", "settings.password.complexity.minUpperCase", lambda v: v >= 1, ">= 1"),
      ("OKTA-APP-000680", "settings.password.complexity.minLowerCase", lambda v: v >= 1, ">= 1"),
      ("OKTA-APP-000690", "settings.password.complexity.minNumber", lambda v: v >= 1, ">= 1"),
      ("OKTA-APP-000700", "settings.password.complexity.minSymbol", lambda v: v >= 1, ">= 1"),
      ("OKTA-APP-000740", "settings.password.age.minAgeMinutes", lambda v: v >= 1440, ">= 1440"),
      ("OKTA-APP-000745", "settings.password.age.maxAgeDays", lambda v: v == 60, "== 60"),
      ("OKTA-APP-002980", "settings.password.complexity.dictionary.common.exclude", lambda v: v is True, "== true"),
      ("OKTA-APP-003010", "settings.password.age.historyCount", lambda v: v >= 5, ">= 5")]
pw = [p for p in policies.values() if p.get("type") == "PASSWORD" and p.get("status") == "ACTIVE"]
for iid, path, ok, want in PW:
    ts = []
    for p in pw:
        v = get(p, path)
        ts.append({**key("Policy", p["id"]), "name": p["name"], "value": v, "status": "unknown" if v is None else ("pass" if ok(v) else "fail")})
    emit(iid, worst(ts), {"source": "OK-10 PASSWORD 정책", "field": path, "condition": want, "combine": "활성 정책마다 보고 하나라도 어기면 위반"}, want, ts)

# 2) 전역 세션 정책(Default Policy): 1순위 규칙이 Default Rule 이 아닌 별도 규칙이어야 하고 그 값을 본다
SO = [("OKTA-APP-000020", "actions.signon.session.maxSessionIdleMinutes", lambda v: v == 15, "== 15"),
      ("OKTA-APP-001665", "actions.signon.session.maxSessionLifetimeMinutes", lambda v: v == 1080, "== 1080"),
      ("OKTA-APP-001710", "actions.signon.session.usePersistentCookie", lambda v: v is False, "== false")]
default = next((p for p in policies.values() if p.get("type") == "OKTA_SIGN_ON" and p.get("name") == "Default Policy"), None)
top = (rules.get(default["id"]) or [None])[0] if default else None
for iid, path, ok, want in SO:
    rule = {"source": "OK-10 Global Session Policy 규칙", "field": path, "condition": f"1순위 규칙이 Default Rule 이 아니고 {want}", "combine": "구조 조건을 어기면 값과 무관하게 위반"}
    if not default: emit(iid, "unknown", rule, want, note="Default Policy 없음"); continue
    v = get(top, path) if top else None
    st = "fail" if not top or top.get("name") == "Default Rule" else ("unknown" if v is None else ("pass" if ok(v) else "fail"))
    emit(iid, st, rule, want, [{**key("PolicyRule", top["id"]), "name": top.get("name"), "value": v, "status": st}] if top else [])

# 3) 앱 로그인 정책: STIG 가 가리키는 정책의 1순위 활성 규칙
for iid, pname, kind in [("OKTA-APP-000560", "Okta Admin Console", "mfa"), ("OKTA-APP-000570", "Okta Dashboard", "mfa"),
                         ("OKTA-APP-000190", "Okta Admin Console", "phr"), ("OKTA-APP-000180", "Okta Dashboard", "phr")]:
    p = next((p for p in policies.values() if p.get("type") == "ACCESS_POLICY" and p.get("name") == pname), None)
    rs = [r for r in rules.get(p["id"], []) if r.get("status") == "ACTIVE"] if p else []
    if kind == "mfa":
        rule = {"source": f"OK-10 '{pname}' 앱 로그인 정책", "field": "1순위 규칙 actions.appSignOn.verificationMethod.factorMode", "condition": "== 2FA", "combine": "1순위 활성 규칙 하나만 본다"}
        v = get(rs[0], "actions.appSignOn.verificationMethod.factorMode") if rs else None
        st = "unknown" if v is None else ("pass" if v == "2FA" else "fail")
    else:
        rule = {"source": f"OK-10 '{pname}' 앱 로그인 정책", "field": "1순위 규칙 verificationMethod.constraints[].possession.phishingResistant", "condition": "모두 REQUIRED", "combine": "1순위 활성 규칙 하나만 본다. constraints 가 없으면 위반"}
        cons = get(rs[0], "actions.appSignOn.verificationMethod.constraints") if rs else None
        v = [get(c, "possession.phishingResistant") for c in cons] if cons else None
        st = "unknown" if not rs else ("pass" if v and all(x == "REQUIRED" for x in v) else "fail")
    emit(iid, st, rule, rule["condition"], [{**key("PolicyRule", rs[0]["id"]), "name": rs[0].get("name"), "value": v, "status": st}] if rs else [])

# 4) 인증자: Smart Card 인증자가 있고 활성, Okta Verify 의 FIPS 준수가 켜짐
sc = [a for a in authenticators if a.get("type") == "smart_card_idp" or "smart" in (a.get("name") or "").lower()]
emit("OKTA-APP-001670", "pass" if any(a.get("status") == "ACTIVE" for a in sc) else "fail",
     {"source": "OK-22 /api/v1/authenticators", "field": "type·name 이 Smart Card 인 인증자의 status", "condition": "있고 ACTIVE", "combine": "하나라도 활성이면 통과"},
     "Smart Card 인증자 ACTIVE", [{**key("AuthenticatorBase", a["id"]), "name": a["name"], "value": a.get("status"), "status": "pass" if a.get("status") == "ACTIVE" else "fail"} for a in sc],
     note="" if sc else f"인증자 목록에 Smart Card 없음 ({', '.join(a['name'] for a in authenticators)})")
ov = next((a for a in authenticators if a.get("key") == "okta_verify"), None)
fv = get(ov, "settings.compliance.fips") if ov else None
st = "unknown" if fv is None else ("pass" if fv == "REQUIRED" else "fail")
emit("OKTA-APP-001700", st, {"source": "OK-22 /api/v1/authenticators", "field": "okta_verify settings.compliance.fips", "condition": "== REQUIRED", "combine": "Okta Verify 인증자 하나"},
     "FIPS 준수 켜짐(REQUIRED)", [{**key("AuthenticatorBase", ov["id"]), "name": ov["name"], "value": fv, "status": st}] if ov else [],
     note="API 값 REQUIRED 를 콘솔의 'FIPS Compliance 켜짐'으로 본 것은 필드 이름에 따른 해석이다(출처 미확인)")

# 5) Smart Card IdP: 활성인지는 판정, 인증서가 DOD 승인 CA 인지는 조직이 정한 CA 목록이 필요
sci = [i for i in idps if i.get("type") in ("X509", "SMART_CARD")]
emit("OKTA-APP-001920", "fail" if not any(i.get("status") == "ACTIVE" for i in sci) else "org_policy",
     {"source": "OK-18 /api/v1/idps", "field": "type 이 Smart Card(X509) 인 IdP 의 status, 인증서 체인", "condition": "ACTIVE 이고 인증서가 승인 CA", "combine": "IdP 가 없거나 비활성이면 위반, 있으면 CA 목록 필요"},
     "", [{**key("IdentityProvider", i["id"]), "name": i.get("name"), "value": i.get("status"), "status": "pass" if i.get("status") == "ACTIVE" else "fail"} for i in sci],
     note="" if sci else "IdP 목록이 비어 있음")

# 6) 네트워크
dz = next((z for z in zones if z.get("type") == "DYNAMIC_V2"), None)
bl = [z for z in zones if z.get("usage") == "BLOCKLIST" and z.get("type") == "IP"]
emit("OKTA-APP-003243", "pass" if dz and dz.get("status") == "ACTIVE" else ("org_policy" if any(z.get("gateways") for z in bl) else "fail"),
     {"source": "OK-22 /api/v1/zones", "field": "DYNAMIC_V2 차단 영역 status, IP 차단 목록 gateways", "condition": "CSSP 목록이 없으면 Enhanced dynamic zone blocklist 가 ACTIVE",
      "combine": "동적 영역이 활성이면 통과, IP 차단 목록에 값이 있으면 CSSP 목록과 대조 필요, 둘 다 없으면 위반"},
     "Enhanced dynamic zone blocklist ACTIVE",
     [{**key("NetworkZone", z["id"]), "name": z["name"], "value": {"status": z.get("status"), "gateways": len(z.get("gateways") or [])}, "status": "pass" if z.get("status") == "ACTIVE" and (z.get("type") == "DYNAMIC_V2" or z.get("gateways")) else "fail"} for z in ([dz] if dz else []) + bl])
net = get(top, "conditions.network.connection") if top else None
emit("OKTA-APP-003242", "fail" if net in (None, "ANYWHERE") else "org_policy",
     {"source": "OK-10 Global Session Policy 규칙", "field": "1순위 규칙 conditions.network.connection", "condition": "ANYWHERE 가 아님(특정 IP 범위로 허용·차단)",
      "combine": "IP 조건이 없으면 위반, 있으면 조직이 정한 범위와 맞는지는 조직 정책 필요"},
     "", [{**key("PolicyRule", top["id"]), "name": top.get("name"), "value": net, "status": "fail" if net in (None, "ANYWHERE") else "unknown"}] if top else [])
ts = []
for a in apps:
    pid = (get(a, "_links.accessPolicy.href") or "").rstrip("/").split("/")[-1]
    rs = rules.get(pid, [])
    has = any(get(r, "conditions.network.connection") not in (None, "ANYWHERE") for r in rs if r.get("status") == "ACTIVE")
    ts.append({**key("Application", a["id"]), "name": a["label"], "value": [get(r, "conditions.network.connection") for r in rs], "status": "pass" if has else "fail"})
emit("OKTA-APP-003244", worst(ts), {"source": "OK-07 앱, OK-10 앱 로그인 정책 규칙", "field": "앱의 accessPolicy 규칙 conditions.network.connection", "condition": "활성 규칙 중 하나라도 네트워크 영역 조건이 있음",
     "combine": "앱 하나라도 네트워크 조건이 없으면 위반. 필요한 허용·차단 목록이 다 들어 있는지는 보지 않음"}, "", ts)

# 7) API 토큰
ts = [{**key("ApiToken", t["id"]), "name": t.get("name"), "value": get(t, "network.connection"), "status": "fail" if get(t, "network.connection") in (None, "ANYWHERE") else "pass"} for t in tokens]
emit("OKTA-APP-003240", worst(ts), {"source": "OK-16 /api/v1/api-tokens", "field": "network.connection", "condition": "ANYWHERE 가 아님", "combine": "토큰 하나라도 어기면 위반"}, "네트워크 영역 지정", ts)
emit("OKTA-APP-003241", "manual", {"source": "OK-16 API 토큰, OK-02 사용자", "field": "토큰 주인(userId)", "condition": "토큰 전용으로 새로 만든 계정", "combine": "계정이 전용인지는 값으로 정해지지 않음"},
     "", [{**key("ApiToken", t["id"]), "name": t.get("name"), "value": t.get("userId") and "userId 있음", "status": "unknown"} for t in tokens],
     note="전용 계정 여부는 API 값으로 판정되지 않는다. 지난 PoC 는 주인 역할이 SUPER_ADMIN 이면 위반으로 봤는데 STIG 문구에는 없는 조건이라 뺐다")

# 8) API 로 볼 수 없거나 수집하지 않는 것
emit("OKTA-APP-000025", "unknown", {"source": "미확인", "field": "Okta Admin Console 앱 Sign On 탭 'Maximum app session idle time'", "condition": "== 15분", "combine": ""}, "15분",
     note="이 값이 어느 API 응답에 들어 있는지 확인하지 못했다. OK-07 앱 settings 와 OK-10 규칙에서는 찾지 못함")
emit("OKTA-APP-000090", "not_collected", {"source": "Workflows Automations", "field": "35일 미사용 계정 비활성화 Automation", "condition": "있음", "combine": ""}, "35일",
     note="Workflows 는 수집 호출이 없다. 외부 디렉터리로 사용자를 받으면 해당 없음(STIG 원문)")
emit("OKTA-APP-000200", "manual", {"source": "로그인 화면", "field": "DOD 표준 동의 배너", "condition": "있고 완전함", "combine": ""}, note="STIG 절차가 로그인 화면을 직접 보는 것이다")
emit("OKTA-APP-001430", "not_collected", {"source": "/api/v1/logStreams", "field": "활성 로그 스트림", "condition": "있음, 또는 SIEM 이 API 로 가져감", "combine": ""},
     note="logStreams 는 수집에서 403. SIEM 이 API 로 가져가는지는 사람 확인")

out = {"standard": STD, "tier": 1, "provider": "okta", "raw_run": os.path.basename(RAW.rstrip("\\/")),
       "items": [items[k] for k in sorted(items)]}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
missing = sorted(set(titles) - set(items))
import collections
print(len(items), "items", dict(collections.Counter(i["status"] for i in items.values())), "누락:", missing)
for i in out["items"]:
    print(f"{i['item_id']}  {i['status']:13} {i['finding_id']}  " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in i["targets"])[:110])
print("그래프에 없는 대상 키:", sorted({t["key"] for i in items.values() for t in i["targets"] if not t["in_graph"]}))
