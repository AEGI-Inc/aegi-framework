"""GSA CIO-IT Security-11-62 Rev 3 (2023-03-01) 19개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
GSA 원문은 PDF 라 열지 않았고, standards_items_all 의 title·notes·threshold 로 판정 조건을 정했다. 조건이 부족하면 unknown·org_policy·manual 로 둔다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, glob, os, sys, collections

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
RAW, UNIQ, DS, OUT, SET = P.RAW, P.UNIQ, P.DS, P.out("gsa_cio_it_11_62"), P.EXTRA
SF = os.path.join(RAW, "salesforce")
STD = "GSA CIO-IT Security-11-62 Rev 3 (2023-03-01)"
ITEMS = P.ITEMS

std_items = [x for x in json.load(open(ITEMS, encoding="utf-8")) if x["source"] == STD]
objs = json.load(open(os.path.join(DS, "objects.json"), encoding="utf-8"))
keys = {o["fixture_key"] for o in objs}
org_key = next(o["fixture_key"] for o in objs if o["canonical"]["provider"] == "salesforce" and o["canonical"]["object_type"] == "Organization")

# 항목 id 가 겹친다(3 Assumptions 3건, 7 Profile Management 2건, 9 External Customer Access 2건). 겹치면 'id / title' 을 item_id 로 쓴다
cnt = collections.Counter(x["id"] for x in std_items)
def iid_of(x): return x["id"] if cnt[x["id"]] == 1 else f'{x["id"]} / {x["title"]}'
# 묶은 finding: (id) 후보 목록에서 finding 문장이 같은 것, 없으면 등장 순서
cands = collections.defaultdict(list)
for f in json.load(open(UNIQ, encoding="utf-8")):
    for s in f["sources"]:
        if s["source"] == STD: cands[s["id"]].append(f)
seen = collections.Counter()
FID = {}
for x in std_items:
    c = cands.get(x["id"], [])
    hit = next((f for f in c if f["finding"] == x["finding"]), None)
    FID[iid_of(x)] = (hit or (c[seen[x["id"]]] if seen[x["id"]] < len(c) else {})).get("finding_id")
    seen[x["id"]] += 1

def rec(call):
    out = []
    for f in sorted(glob.glob(os.path.join(SF, f"{call}-*.json"))):
        out += json.load(open(f, encoding="utf-8"))["payload"].get("records", [])
    return out
hc = {r["DurableId"]: r for r in json.load(open(os.path.join(SET, "salesforce", "SFS-01-0002.json"), encoding="utf-8"))["payload"]["records"]}
profiles = rec("SF-03")
psets = [p for p in json.load(open(os.path.join(SF, "SF-04-0001.json"), encoding="utf-8"))["payload"]["records"] if not p.get("IsOwnedByProfile")]
saml = json.load(open(os.path.join(SF, "SF-01-0002.json"), encoding="utf-8"))["payload"]["records"]

items = {}
def emit(x, status, rule, threshold="", targets=(), note=""):
    i = iid_of(x)
    items[i] = {"item_id": i, "title": x["title"], "finding_id": FID.get(i), "status": status, "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}
def R(source, field, condition, combine): return {"source": source, "field": field, "condition": condition, "combine": combine}
def orgt(value, status): return [{"key": org_key, "in_graph": org_key in keys, "name": "Organization", "value": value, "status": status}]
def hcv(d): return {"RiskType": hc[d]["RiskType"], "OrgValue": hc[d]["OrgValue"], "StandardValue": hc[d]["StandardValue"]} if d in hc else None
MAN = lambda why: R("(값으로 보지 않음)", "-", why, "")

for x in std_items:
    k, t = x["id"], x["title"]
    if k == "3 Assumptions" and t.startswith("Internal apps"):
        mf, sa = hc.get("Identity.mfaEnabled"), hc.get("Identity.samlEnabled")
        ok = bool(mf and sa and mf["RiskType"] == "MEETS_STANDARD" and sa["RiskType"] == "MEETS_STANDARD")
        emit(x, "pass" if ok else "fail",
             R("SFS-01 Tooling API SecurityHealthCheckRisks, SF-01 SamlSsoConfig", "Identity.mfaEnabled, Identity.samlEnabled 의 RiskType", "둘 다 MEETS_STANDARD(MFA 활성, SAML 활성)", "둘 다 만족해야 통과"),
             "MFA 및 SSO 사용", orgt({"mfaEnabled": hcv("Identity.mfaEnabled"), "samlEnabled": hcv("Identity.samlEnabled"), "SamlSsoConfig 개수": len(saml)}, "pass" if ok else "fail"),
             note="Health Check 의 Identity.* 는 조직 단위 값이라 내부 사용자별 MFA 등록 여부는 보지 못한다. 조직 설정이 꺼져 있으면 '내부 앱이 MFA·SSO 를 쓴다'는 가정이 충족되지 않는 것으로 봤다. SamlSsoConfig 도 0건.")
    elif k == "3 Assumptions" and t.startswith("External apps"):
        emit(x, "org_policy", R("SFS-01 SecurityHealthCheckRisks", "Identity.mfaEnabled", "비즈니스 오너·ISSM 이 정한 MFA", "조직 결정"), "",
             orgt({"mfaEnabled": hcv("Identity.mfaEnabled")}, "unknown"),
             note="원문이 외부 앱 MFA 를 비즈니스 오너·ISSM 판단에 맡긴다. 외부 사용자(커뮤니티) 로그인 설정은 수집하지 않았고, 참고로 조직 MFA 값만 보인다.")
    elif k == "3 Assumptions":
        grp = collections.defaultdict(collections.Counter)
        for r in hc.values():
            grp[r["SettingGroup"]][r["RiskType"]] += 1
        bad = any(r["RiskType"] in ("HIGH_RISK", "MEDIUM_RISK") for r in hc.values())
        st = "fail" if bad else "pass"
        emit(x, st, R("SFS-01 SecurityHealthCheckRisks", "SettingGroup 별 RiskType", "HIGH_RISK, MEDIUM_RISK 없음", "모든 Health Check 항목 확인"), "HIGH_RISK, MEDIUM_RISK 없음",
             orgt({g: dict(c) for g, c in grp.items()}, st),
             note="GSA 참조 문서 값 대신 Salesforce Health Check 기본 기준선으로 판정. HIGH_RISK 또는 MEDIUM_RISK 항목이 하나라도 있으면 위반")
    elif k == "4.1 Salesforce Organization":
        emit(x, "not_collected", R("(수집 없음)", "설치된 AppExchange 패키지(InstalledSubscriberPackage 등)", "GSA CTO 가 승인한 앱만 설치", "승인 목록은 조직이 정함"), "",
             note="설치 패키지를 읽는 호출이 수집에 없다. 연결 앱(ConnectedApplication)은 AppExchange 패키지와 같은 것이 아니라 대체하지 않았다. 승인 절차 자체는 사람 운영.")
    elif k == "6 Access Security":
        ts = []
        for p in profiles:
            if p.get("PermissionsModifyAllData") or p.get("PermissionsViewAllData"):
                ts.append({"key": f"im:salesforce:Profile:{p['Id']}", "in_graph": f"im:salesforce:Profile:{p['Id']}" in keys, "name": p["Name"],
                           "value": {"ModifyAllData": p.get("PermissionsModifyAllData"), "ViewAllData": p.get("PermissionsViewAllData")}, "status": "unknown"})
        for p in psets:
            if p.get("PermissionsModifyAllData") or p.get("PermissionsViewAllData"):
                ts.append({"key": f"im:salesforce:PermissionSet:{p['Id']}", "in_graph": f"im:salesforce:PermissionSet:{p['Id']}" in keys, "name": p["Name"],
                           "value": {"ModifyAllData": p.get("PermissionsModifyAllData"), "ViewAllData": p.get("PermissionsViewAllData")}, "status": "unknown"})
        emit(x, "org_policy", R("SF-03 Profile, SF-04 PermissionSet(프로필 소유 제외)", "PermissionsModifyAllData, PermissionsViewAllData", "최소화. 허용 대상은 조직이 정함", "두 권한 중 하나라도 가진 프로필·권한 세트를 보여 줌"), "", ts,
             note=f"원문이 '최대한 최소화'라 허용 목록을 조직이 정해야 한다. View All·Modify All 중 하나를 가진 프로필 {sum(1 for t in ts if ':Profile:' in t['key'])}개, 권한 세트 {sum(1 for t in ts if ':PermissionSet:' in t['key'])}개.")
    elif k == "7 Profile Management" and t.startswith("Field-level"):
        owd = hc.get("SharingSettings.orgWideDefaults")
        rt = owd["RiskType"] if owd else None
        st = "pass" if rt == "MEETS_STANDARD" else ("fail" if rt in ("HIGH_RISK", "MEDIUM_RISK") else "unknown")
        emit(x, st, R("SFS-01 SecurityHealthCheckRisks", "SharingSettings.orgWideDefaults.RiskType", "== MEETS_STANDARD", "단일 Health Check 항목 확인"), "MEETS_STANDARD",
             orgt({"orgWideDefaults": hcv("SharingSettings.orgWideDefaults")}, st),
             note="GSA 참조 문서 값 대신 Salesforce Health Check 기본 기준선으로 판정. 필드 수준 보안과 공유 규칙은 수집하지 않았다")
    elif k == "7.1 Table 7-1":
        grp = collections.defaultdict(collections.Counter)
        for r in hc.values():
            if r["SettingGroup"] in ("PasswordPolicies", "SessionSettings", "NetworkSecurity", "Identity", "RemoteSiteSettings", "CertificateAndKeyManagement"):
                grp[r["SettingGroup"]][r["RiskType"]] += 1
        bad = any(c.get("HIGH_RISK", 0) + c.get("MEDIUM_RISK", 0) > 0 for c in grp.values())
        st = "fail" if bad else "pass"
        emit(x, st, R("SFS-01 SecurityHealthCheckRisks", "PasswordPolicies, SessionSettings, NetworkSecurity, Identity, RemoteSiteSettings, CertificateAndKeyManagement 항목", "HIGH_RISK, MEDIUM_RISK 없음", "지정 영역 항목 확인"), "HIGH_RISK, MEDIUM_RISK 없음",
             orgt({g: dict(c) for g, c in grp.items()}, st),
             note="GSA 참조 문서 값 대신 Salesforce Health Check 기본 기준선으로 판정. 해당 영역 중 HIGH_RISK 또는 MEDIUM_RISK 가 있으면 위반")
    elif k == "9 External Customer Access" and t.startswith("External users use"):
        emit(x, "not_collected", R("(수집 없음)", "Experience Cloud 사이트·커뮤니티 로그인 흐름의 MFA 설정", "외부 사용자가 GSA 승인 MFA 사용", ""), "MFA 필수",
             note="커뮤니티 사이트·로그인 정책을 읽는 호출이 수집에 없다. 조직 Identity.mfaEnabled 는 내부 직접 로그인 기준이라 외부 사용자 판정에 쓰지 않았다(해석, 출처 미확인).")
    elif k == "9.1 Customer Community Authentication":
        emit(x, "not_collected", R("(수집 없음)", "Experience Cloud 사이트·커뮤니티 로그인 흐름의 MFA 설정", "모든 사용자·관리자가 MFA", ""), "모든 사용자·관리자 MFA",
             note="커뮤니티 사용자별 MFA 등록·로그인 흐름이 수집에 없다. 위 '9 External Customer Access / External users' 항목과 같은 이유.")
    elif k == "9 External Customer Access":
        emit(x, "manual", MAN("Chatter 고객 그룹에 문서를 올리지 않는 운영"), "", note="그룹 소유자의 운영 준수. 고객 Chatter 그룹(CollaborationGroup)과 게시물은 수집하지 않았다.")
    else:
        why = {"4.4/4.5 ATU Process": "ATU 승인·문서 절차", "4.5 Step 4": "Apex·Visualforce 코드 스캔(Checkmarx) 결과 조치", "4.7 Baseline Security Configuration Settings": "ISSM 이 정한 주기의 설정 점검",
               "5 Security Configuration Options Parameters": "편차 BPD 문서화 절차", "7 Profile Management": "권한 세트로 탭·개체 접근을 부여하는 운영 방식",
               "9.2 Procedure to Acquire External Access Accounts": "외부 사용자 HSPD-12 신원 심사", "9.3 Processing External Access Accounts": "외부 계정 발급 티켓 절차",
               "10 Scanning of the Salesforce Environments": "코드 스캔 월 1회 및 조치 기한 운영", "11 Customer Chatter Groups with External Access": "그룹 소유자·OCISO 감사 운영"}[k]
        emit(x, "manual", MAN(why), x.get("threshold") or "", note="SaaS 설정값으로 정해지는 조건이 아니라 사람의 승인·운영 절차(또는 코드 스캔)다.")

out = {"standard": STD, "tier": std_items[0]["source_tier"], "provider": "salesforce", "raw_run": os.path.basename(RAW.rstrip("\\/")), "items": [items[iid_of(x)] for x in std_items]}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(out["items"]), "items", dict(collections.Counter(i["status"] for i in out["items"])), "누락:", sorted(set(iid_of(x) for x in std_items) - set(items)), "finding 미연결:", [i["item_id"] for i in out["items"] if not i["finding_id"]])
for i in out["items"]:
    print(f"{i['item_id'][:70]:70} {i['status']:13} {i['finding_id']}")
