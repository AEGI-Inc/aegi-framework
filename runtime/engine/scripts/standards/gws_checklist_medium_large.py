r"""Google Workspace Security checklist for medium and large businesses (100+ users) 64개를 판정한다. 수집 원본만 읽는다.
항목 문장은 standards_items_all 의 title·notes 를 따른다. 같은 설정의 CIS 항목과는 cis_gws.py 와 같은 필드·해석을 쓴다.
사용: run_all.py 가 부른다(README.md)
"""
STD = "Google Workspace Security checklist for medium and large businesses (100+ users)"
SLUG = "gws_checklist_medium_large"
import std_paths as P
import json, sys, glob, os, datetime, urllib.parse
from gws_common import Run, dur

RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out(SLUG)
ITEMS = P.ITEMS
_its = [i for i in json.load(open(ITEMS, encoding="utf-8")) if i["source"] == STD]
TIER = _its[0]["source_tier"]
titles = {i["id"]: i["title"] for i in _its}
R = Run(RAW, UNIQ, DS, STD, titles)
users = R.users
S = lambda **k: k
RULE = lambda src, field, cond="", comb="": {"source": src, "field": field, "condition": cond, "combine": comb}

_c = json.load(open(os.path.join(R.gw, "GW-03-0001.json"), encoding="utf-8"))
NOW = datetime.datetime.fromisoformat(_c["collected_at"].replace("Z", "+00:00"))


def nc(iid, source, field, note, cond=""):
    R.emit(iid, "not_collected", RULE(source, field, cond), cond, note=note)


def om(iid, status, source, field, note, cond="", targets=()):
    R.emit(iid, status, RULE(source, field, cond), cond, targets, note)


def judge_users(iid, pop, field, cond, test, val, note="", comb="대상 사용자마다 본다. 하나라도 위반이면 위반", thr=None):
    ts = []
    for u in pop:
        ok = test(u)
        st = "unknown" if ok is None else ("pass" if ok else "fail")
        ts.append({**R.ukey(u), "name": u["primaryEmail"], "value": val(u), "status": st})
    sts = [t["status"] for t in ts]
    st = "fail" if "fail" in sts else ("unknown" if "unknown" in sts else "pass")
    R.emit(iid, st, RULE("GW-03 users", field, cond, comb), thr if thr is not None else cond, ts, note)


def pol_t(stype, fields, st="unknown"):
    e = R.eff(stype)
    return {**R.pkey(e["name"]), "name": stype, "value": {k: e["value"].get(k) for k in fields}, "status": st}


def pol_unknown(iid, stype, fields, note, cond=""):
    """값은 있으나 기준에 판정할 값이 없어 현재 값만 보여 준다"""
    if not R.eff(stype):
        R.absent(iid, stype, f"{stype} 가 GW-24 에 없다"); return
    R.emit(iid, "unknown", RULE("GW-24 " + stype, ",".join(fields), cond, "같은 설정의 정책 중 sortOrder 가 가장 큰 값"), cond, [pol_t(stype, fields)], note)


def lastlogin(u):
    t = u.get("lastLoginTime") or ""
    if t.startswith("1970"): return None
    return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))


email2id = {u["primaryEmail"]: u["id"] for u in users}
tokens = []
for p in sorted(glob.glob(os.path.join(R.gw, "GW-05-*.json"))):
    e = json.load(open(p, encoding="utf-8"))
    for t in (e["payload"] or {}).get("items", []):
        em = e["request_params"]["user"]
        tokens.append({"user": em, "uid": email2id.get(em), "client": t["clientId"], "name": t.get("displayText"), "scopes": t.get("scopes", [])})
tok_key = lambda t: R.tkey(f"im:gws:Token:{t['uid']}|{t['client']}")

org_domains = set()
for pg in R.payloads("GW-02"):
    for d in pg.get("domains", []):
        org_domains.add(d["domainName"].lower())
        for a in d.get("domainAliases", []): org_domains.add(a["domainAliasName"].lower())

files = {}
perms = {}
for p in sorted(glob.glob(os.path.join(R.gw, "GW-07-*.json"))):
    e = json.load(open(p, encoding="utf-8")); pl = e["payload"] or {}
    for f in pl.get("files", []): files[f["id"]] = f
    if "permissions" in pl: perms[e["request_params"]["file"]] = pl["permissions"]


def perm_class(p):
    """anyone=인터넷 전체, domain=조직 도메인 전체, external=조직 밖 사용자·그룹·도메인"""
    t = p.get("type")
    if t == "anyone": return "anyone"
    if t == "domain": return "company" if (p.get("domain") or "").lower() in org_domains or not p.get("domain") else "external"
    if t in ("user", "group"):
        d = (p.get("emailAddress") or "").split("@")[-1].lower()
        return "internal_principal" if d in org_domains else "external"
    return "other"


def file_share(cls, role):
    """파일마다 (cls, role) 권한이 있는지. 반환: 대상 목록, 상태"""
    ts = []
    for fid, f in files.items():
        if fid not in perms:
            ts.append({**R.tkey("im:gws:File:" + fid), "name": f.get("name"), "value": "권한 목록 미수집", "status": "unknown"}); continue
        hit = [p for p in perms[fid] if perm_class(p) == cls and p.get("role") == role]
        ts.append({**R.tkey("im:gws:File:" + fid), "name": f.get("name"), "value": sorted({f"{perm_class(p)}:{p.get('role')}" for p in perms[fid]}), "status": "fail" if hit else "pass"})
    sts = [t["status"] for t in ts]
    return ts, ("fail" if "fail" in sts else ("unknown" if "unknown" in sts else "pass"))


calacl = []
for p in sorted(glob.glob(os.path.join(R.gw, "GW-22-*.json"))):
    e = json.load(open(p, encoding="utf-8")); u = e["request_params"]["user"]
    for r in (e["payload"] or {}).get("items", []): calacl.append((u, r))
acl_key = lambda u, r: R.tkey("im:gws:AclRule:" + urllib.parse.quote(u, safe="") + "|" + urllib.parse.quote(r["id"], safe=""))


def public_calendar(iid, cond, note=""):
    ts = []
    for u, r in calacl:
        bad = (r.get("scope") or {}).get("type") == "default" and r.get("role") != "none"
        ts.append({**acl_key(u, r), "name": f"{u} 기본 캘린더 {r['id']}", "value": {"scope": r.get("scope"), "role": r.get("role")}, "status": "fail" if bad else "pass"})
    R.emit(iid, "fail" if any(t["status"] == "fail" for t in ts) else "pass",
           RULE("GW-22 calendars/primary/acl", "items[].scope.type, role", cond, "캘린더 ACL 규칙마다 본다. 하나라도 위반이면 위반"), cond, ts,
           ("GW-22 는 사용자별 기본(primary) 캘린더 ACL 만 수집하고 정지 사용자와 보조 캘린더는 없다. " + note).strip())


def finish():
    R.write(OUT, STD, TIER, RAW)

pol = R.pol
act = [u for u in users if not u.get("suspended")]
CIS = "CIS 스크립트(cis_gws.py)와 같은 해석"
NOGW24 = "GW-24 163종에 이 설정이 없다"


def A(iid, what, note=None):
    R.absent(iid, what, note or NOGW24)


def M(iid, field, note=""):
    om(iid, "manual", "없음", field, note or "정기 검토·운영 절차·조직 판단이라 값으로 위반이 정해지지 않는다")


# ---- Administrator accounts / Accounts ----
M("Administrator accounts: super admin protection", "슈퍼관리자 계정 보호 조치", "세부 조치는 별도 문서를 참조하라고만 적혀 값이 정해지지 않는다")
judge_users("Accounts: Require 2-Step Verification", act, "isEnforcedIn2Sv", "정지되지 않은 모든 사용자 isEnforcedIn2Sv == true", lambda u: bool(u.get("isEnforcedIn2Sv")), lambda u: u.get("isEnforcedIn2Sv"),
            note="유예 기간·방식 같은 추가 조건은 이 문장에 없어 강제 여부만 봤다")
A("Accounts: Enforce security keys", "2SV 방식을 보안 키만으로 제한", "2SV 방식 설정이 GW-24 에 없다(security.passkeys_restriction 은 패스키 종류 제한으로 다른 설정)")
nc("Accounts: Password Alert", "없음", "Password Alert", "Password Alert 설정이 GW-24 에 없다", "켬")
R.setting("Accounts: Unique passwords", "security.password", "allowReuse", lambda v: v.get("allowReuse") is False, "== false (재사용 금지)",
          note="항목 문장에 값이 없어 '재사용 억제'를 allowReuse == false 로 읽었다(" + CIS + ", CIS 4.1.5.1)")
M("Accounts: Review account activity", "계정 활동 보고서·경고 정기 검토")
# 관리자 알림: 의심 로그인 / 침해된 기기 / 다른 관리자의 설정 변경
al = {x["value"].get("displayName"): x for x in pol.get("rule.system_defined_alerts", [])}
want = [n for n in ("Suspicious login", "Device compromised") if n in al] + sorted(n for n in al if "settings changed" in n.lower())
ts = []
for n in want:
    x = al[n]; ac = (x["value"].get("action") or {}).get("alertCenterAction") or {}
    ok = x["value"].get("state") == "ACTIVE" and bool(ac.get("recipients"))
    ts.append({**R.pkey(x["name"]), "name": n, "value": {"state": x["value"].get("state"), "recipients": len(ac.get("recipients") or [])}, "status": "pass" if ok else "fail"})
R.emit("Accounts: Admin email alerts", "fail" if any(t["status"] == "fail" for t in ts) else "pass", RULE("GW-24 rule.system_defined_alerts", "displayName, state, action.alertCenterAction.recipients", "의심 로그인·침해된 기기·설정 변경 규칙이 ACTIVE 이고 받는 사람이 있음", "해당 규칙마다 본다. 하나라도 어기면 위반"),
       "알림 켬", ts, "항목의 세 사건을 시스템 규칙 이름에 대응시켰다: 의심 로그인=Suspicious login, 침해된 모바일 기기=Device compromised, 다른 관리자의 설정 변경='settings changed' 로 끝나는 규칙(Calendar·Drive·Email·Mobile). 이 대응은 추정이다(출처 미확인). 이메일 알림 여부는 값에 없어 Alert Center 수신자 유무로 봤다")
A("Accounts: Login challenges", "Post-SSO verification(로그인 챌린지)", "GW-24 security.login_challenges 에는 enableEmployeeIdChallenge(직원 ID 챌린지)만 있다(cis_gws.py 4.1.4.1 과 같은 해석)")
M("Accounts: Secure compromised accounts", "침해 계정 대응(정지·기기 검토·로그 검토)", "사고 대응 절차")
tk = [(k, v) for k, v in sorted(pol.items()) if k == "takeout.service_status" or k.endswith(".user_takeout")]
tts = []
for k, vs in tk:
    e = max(vs, key=lambda t: t["sort"]); tts.append({**R.pkey(e["name"]), "name": k, "value": e["value"].get("serviceState") or e["value"].get("takeoutStatus"), "status": "org_policy"})
om("Accounts: Google Takeout", "org_policy", "GW-24 takeout.service_status, *.user_takeout", "serviceState, takeoutStatus", "침해 계정·퇴사 예정자가 누구인지는 조직이 정한다. 조직 전체의 Takeout 현재 값만 보여 준다", "대상 사용자는 Takeout 끔", tts)
dts = [{**R.ukey(u), "name": u["primaryEmail"], "value": {"suspended": u.get("suspended"), "lastLoginTime": u.get("lastLoginTime")}, "status": "org_policy"} for u in users]
om("Accounts: Departing user access", "org_policy", "GW-03 users", "suspended, lastLoginTime", "퇴사자 목록은 조직(HR) 정보가 필요하다. 사용자별 정지 여부와 마지막 로그인만 보여 준다", "퇴사 사용자 접근 회수", dts)

# ---- Apps ----
FULLSC = lambda s: s in ("https://mail.google.com/", "https://www.googleapis.com/auth/drive") or "/auth/gmail." in s or "/auth/drive" in s
hit = [t for t in tokens if any(FULLSC(s) for s in t["scopes"])]
om("Apps: Review third-party apps", "org_policy", "GW-05 users/{userKey}/tokens", "items[].scopes", "무엇이 허용 가능한지는 조직이 정한다. Gmail·Drive scope 를 가진 토큰을 보여 준다(scope 와 서비스 대응은 문자열 형태에 따른 추정, 출처 미확인). 전체 범위 같은 고정 규칙은 Mondoo 스크립트 참조",
   "승인된 앱만 Gmail·Drive 접근", [{**tok_key(t), "name": f"{t['name']} ({t['user']})", "value": [s for s in t["scopes"] if FULLSC(s)], "status": "org_policy"} for t in hit])
nc("Apps: Block less secure apps", "Reports API usage", "isLessSecureAppsAccessAllowed", "Admin 콘솔에 설정 화면이 없고(Mondoo 문서: 2024년 Google 이 지원 제거) 수집에도 값이 없다")
if not R.eff("api_controls.unconfigured_third_party_apps"):
    R.absent("Apps: Allowlist of approved third-party apps", "api_controls.unconfigured_third_party_apps", "api_controls.unconfigured_third_party_apps 가 GW-24 에 없다")
else:
    om("Apps: Allowlist of approved third-party apps", "org_policy", "GW-24 api_controls.unconfigured_third_party_apps, workspace_marketplace.apps_allowlist", "accessLevel, apps", "승인 앱 목록은 조직이 정한다. 현재 값(미구성 앱 접근 수준, Marketplace 허용 목록 앱 수)만 보여 준다",
       "승인된 앱 허용 목록", [pol_t("api_controls.unconfigured_third_party_apps", ["accessLevel"], "org_policy")] +
                         ([{**R.pkey(al["name"]), "name": "workspace_marketplace.apps_allowlist", "value": {"apps": len(al["value"].get("apps", []))}, "status": "org_policy"}]
                          if (al := R.eff("workspace_marketplace.apps_allowlist")) else []))
A("Apps: Context-Aware Access", "컨텍스트 인식 액세스 정책")
om("Apps: Client-side encryption", "org_policy", "없음", "클라이언트 측 암호화 구성", "원문이 '고려'(consider) 수준이고 민감 데이터 취급 여부는 조직이 판단한다. 클라이언트 측 암호화 설정은 GW-24 163종에 없다", "민감 데이터 취급 시 구성")

# ---- Calendar / Chat / Chrome / Devices ----
A("Calendar: External guest invitation warning", "외부 게스트 초대 경고", NOGW24 + " (cis_gws.py 3.1.1.1.3 과 같은 해석)")
_chat_miss = [t for t in ("chat.external_chat_restriction", "chat.chat_external_spaces") if not R.eff(t)]
if _chat_miss:
    R.absent("Google Chat: Limit external chat and rooms", ", ".join(_chat_miss), f"{', '.join(_chat_miss)} 가 GW-24 에 없다")
else:
    ex, sp = pol_t("chat.external_chat_restriction", ["allowExternalChat", "externalChatRestriction"]), pol_t("chat.chat_external_spaces", ["enabled", "domainAllowlistMode"])
    ve, vs_ = R.eff("chat.external_chat_restriction")["value"], R.eff("chat.chat_external_spaces")["value"]
    ok1 = ve.get("allowExternalChat") is False or ve.get("externalChatRestriction") == "TRUSTED_DOMAINS"
    ok2 = vs_.get("enabled") is False or vs_.get("domainAllowlistMode") not in (None, "ALL_DOMAINS")
    ex["status"], sp["status"] = ("pass" if ok1 else "fail"), ("pass" if ok2 else "fail")
    R.emit("Google Chat: Limit external chat and rooms", "pass" if ok1 and ok2 else "fail", RULE("GW-24 chat.external_chat_restriction, chat.chat_external_spaces", "allowExternalChat, externalChatRestriction, enabled, domainAllowlistMode", "외부 채팅이 꺼졌거나 허용 도메인만, 외부 스페이스가 꺼졌거나 허용 도메인만", "두 설정 모두 만족해야 통과"),
           "외부 채팅·스페이스 제한", [ex, sp], "필요한 사용자 범위는 조직이 정하지만 '제한'을 CIS 3.1.4.2.1·3.1.4.3.1 과 같이 꺼짐 또는 허용 도메인만으로 읽었다(cis_gws.py 와 같은 해석). 외부 스페이스가 모든 도메인에 열려 있어 위반")
A("Google Chat: Chat invitation policy", "채팅 초대 자동 수락 정책")
for i in ("Chrome: Relaunch to apply updates", "Chrome: Basic policies", "Chrome: Advanced policies", "Chrome: Legacy Browser Support"):
    nc(i, "Chrome Policy API", "Chrome 정책", "Chrome Policy API 를 수집하지 않았다")
M("Mobile devices, computers, and other endpoints", "별도 기기 관리 체크리스트 이행", "원문은 별도 문서 링크만 제공하고 구체 항목이 이 페이지에 없다")

# ---- Drive ----
for i, w in [("Drive: Restrict external sharing", "외부 공유 제한(도메인 허용 목록·신뢰 규칙)"), ("Drive: Warn on external sharing", "외부 공유 경고"), ("Drive: Prevent publishing on the web", "웹 게시"),
             ("Drive: Access Checker", "Access Checker"), ("Drive: Prevent group membership discovery", "그룹 멤버십 외부 노출"), ("Drive: External collaborators sign in", "외부 협업자 Google 로그인 요구"),
             ("Drive: Moving files out of shared drives", "다른 조직으로 공유 드라이브 파일 이동"), ("Drive: Offline access to Docs", "문서 오프라인 접근"), ("Drive: Docs add-ons", "Docs 추가 기능")]:
    A(i, w, "Drive 공유·오프라인·추가 기능 설정이 GW-24 163종에 없다")
if not R.eff("drive_and_docs.shared_drive_creation"):
    R.absent("Drive: Shared drive creation and settings", "drive_and_docs.shared_drive_creation", "drive_and_docs.shared_drive_creation 가 GW-24 에 없다")
else:
    sd = R.eff("drive_and_docs.shared_drive_creation")["value"]
    ok = sd.get("allowManagersToOverrideSettings") is False and sd.get("allowNonMemberAccess") is False
    t = pol_t("drive_and_docs.shared_drive_creation", ["allowSharedDriveCreation", "allowManagersToOverrideSettings", "allowNonMemberAccess"], "pass" if ok else "fail")
    R.emit("Drive: Shared drive creation and settings", "pass" if ok else "fail", RULE("GW-24 drive_and_docs.shared_drive_creation", "allowManagersToOverrideSettings, allowNonMemberAccess", "둘 다 false", "같은 설정의 정책 중 sortOrder 가 가장 큰 값"), "관리자 설정 변경 불가, 비회원 접근 불가", [t],
           "'누가 만들 수 있는가'는 조직이 정하는 값이라 보지 않았다(allowSharedDriveCreation 은 값만 보여 줌). 내용 접근·설정 변경 제한은 CIS 3.1.2.1.2.2·3.1.2.1.2.3 과 같은 필드·값으로 봤다")
R.setting("Drive: Drive for desktop", "drive_and_docs.drive_for_desktop", "allowDriveForDesktop", lambda v: v.get("allowDriveForDesktop") is False, "== false (필수 사용자만 예외)",
          note="예외 OU·그룹은 보지 않고 최상위 조직 정책만 봤다(cis_gws.py 3.1.2.3.1 과 같은 필드)")
dlp = [x for x in pol.get("rule.dlp", []) if x["value"].get("state", "ACTIVE") == "ACTIVE" and any(tg.startswith("google.workspace.drive.") for tg in x["value"].get("triggers", [])) and (x["value"].get("action") or {}).get("driveAction")]
R.emit("Drive: DLP rules", "pass" if dlp else "fail", RULE("GW-24 rule.dlp", "triggers, state, action.driveAction", "Drive 트리거가 있고 Drive 조치(경고·차단)가 있는 활성 규칙 1개 이상", "규칙 수"), "규칙 1개 이상",
       [{**R.pkey(x["name"]), "name": x["value"].get("displayName"), "value": x["value"].get("triggers"), "status": "pass"} for x in dlp[:50]], f"해당 규칙 {len(dlp)}개(CIS 4.2.3.1 과 같은 트리거 기준, 대상 목록은 50개까지). 감지 대상 데이터 정의는 조직이 한다")

# ---- Gmail ----
nc("Gmail: SPF, DKIM, DMARC", "DNS", "TXT 레코드", "DNS 조회는 수집하지 않는다", "SPF·DKIM·DMARC 모두 설정")
nc("Gmail: MX priority", "DNS", "MX 레코드", "DNS 조회는 수집하지 않는다", "Google 메일 서버가 최우선")
for i, w in [("Gmail: Inbound gateway SPF", "인바운드 게이트웨이"), ("Gmail: TLS for partner domains", "TLS 보안 전송 규정"), ("Gmail: Authentication for approved senders", "승인 발신자 인증"),
             ("Gmail: Disable IMAP and POP", "POP·IMAP 접근"), ("Gmail: Disable automatic forwarding", "자동 전달(조직 설정)"), ("Gmail: Comprehensive mail storage", "종합 메일 저장"),
             ("Gmail: Spam filter bypass for internal senders", "내부 발신자 스팸 필터 우회"), ("Gmail: Spam/phishy headers in routing rules", "라우팅 규칙의 X-Gm-Spam·X-Gm-Phishy 헤더"),
             ("Gmail: Overriding spam filters", "스팸 필터 우회 규칙"), ("Gmail: Approved senders list", "승인된 발신자 목록"), ("Gmail: IP allowlist", "Gmail IP 허용 목록")]:
    A(i, w, NOGW24 + (". 사용자별 autoForwarding.enabled 는 GW-15 에서 전원 false 이지만 조직의 자동 전달 허용 설정이 아니라 사용자 상태라 판정에 쓰지 않았다(cis_gws.py 3.1.3.5.2 와 같은 해석)" if i == "Gmail: Disable automatic forwarding" else ""))
R.setting("Gmail: External recipient warnings", "gmail.external_recipient_warning", "enabled", lambda v: v.get("enabled") is True, "== true")
SPF = ["detectDomainNameSpoofing", "detectEmployeeNameSpoofing", "detectDomainSpoofingFromUnauthenticatedSenders", "detectUnauthenticatedEmails", "detectGroupsSpoofing"]
R.setting("Gmail: Spoofing protection", "gmail.spoofing_and_authentication", ",".join(SPF), lambda v: all(v.get(k) is True for k in SPF), "다섯 탐지 모두 true",
          note="문장은 '추가 스푸핑 보호 켬'뿐이라 탐지 5종이 모두 켜져야 켠 것으로 읽었다. 조치(스팸함 등)는 요구하지 않았다(CIS 3.1.3.4.3.x 보다 느슨한 해석)")
gm = [x for x in pol.get("rule.dlp", []) if x["value"].get("state", "ACTIVE") == "ACTIVE" and any(tg.startswith("google.workspace.gmail.") for tg in x["value"].get("triggers", []))]
blk = [x for x in gm if any(k != "warnUser" for k in ((x["value"].get("action") or {}).get("gmailAction") or {}))]
R.emit("Gmail: Outbound sensitive data DLP", "pass" if blk else "fail", RULE("GW-24 rule.dlp", "triggers, state, action.gmailAction", "Gmail 발신 트리거가 있고 Gmail 조치가 경고(warnUser) 이외(차단)인 활성 규칙 1개 이상", "규칙 수"), "발신 메일 차단 규칙 1개 이상",
       [{**R.pkey(x["name"]), "name": x["value"].get("displayName"), "value": list(((x["value"].get("action") or {}).get("gmailAction") or {}).keys()), "status": "pass" if x in blk else "fail"} for x in gm[:50]],
       f"Gmail 발신 트리거 규칙 {len(gm)}개가 있으나 조치가 모두 warnUser(경고)라 '차단' 규칙은 {len(blk)}개다. 차단 조치의 필드 이름은 warnUser 가 아닌 키로 봤다(출처 미확인). 탐지기(detector) 종류는 보지 않았다")

# ---- Groups / Sites / Vault / Next steps ----
gw04_groups = [g for p in R.payloads("GW-04") if isinstance(p, dict) for g in (p.get("groups") or [])]
grp_settings = {}
for call_id in ("GW-21", "RG-GW-groupsSettings.groups.get"):
    for pl in R.payloads(call_id):
        if isinstance(pl, dict) and pl.get("email"):
            grp_settings[pl["email"].lower()] = pl

M("Google Groups: Security groups", "보안 그룹 사용", "어떤 앱이 민감한지는 조직이 정한다." + (" GW-04 그룹 목록에 그룹이 없다" if not gw04_groups else f" GW-04 그룹 {len(gw04_groups)}개"))
M("Google Groups: Security conditions on admin roles", "관리자 역할 보안 조건", "허용할 관리자는 조직이 정한다(GW-06 역할 할당 참조)")
if grp_settings:
    gs_list = list(grp_settings.values())
    def grp_judge(iid, cond, thr, pred, fields, note=""):
        ts = []
        for g in gs_list:
            ok = pred(g)
            ts.append({**R.tkey(f"im:gws:Group:{g['email']}"), "name": g["email"], "value": {k: g.get(k) for k in fields}, "status": "pass" if ok else "fail"})
        R.emit(iid, "fail" if any(t["status"] == "fail" for t in ts) else "pass",
               RULE("RG-GW-groupsSettings.groups.get / GW-21", ",".join(fields), cond, "그룹마다 본다. 하나라도 위반이면 위반"), thr, ts, note)
    grp_judge("Google Groups: Set groups to Private",
              "whoCanJoin in (INVITED_CAN_JOIN, CAN_REQUEST_TO_JOIN), whoCanViewGroup != ANYONE_CAN_VIEW, whoCanDiscoverGroup != ANYONE_CAN_DISCOVER",
              "Private",
              lambda g: g.get("whoCanJoin") in ("INVITED_CAN_JOIN", "CAN_REQUEST_TO_JOIN") and g.get("whoCanViewGroup") != "ANYONE_CAN_VIEW" and g.get("whoCanDiscoverGroup") != "ANYONE_CAN_DISCOVER",
              ["whoCanJoin", "whoCanViewGroup", "whoCanDiscoverGroup"])
    grp_judge("Google Groups: Internal groups no public access",
              "whoCanJoin != ANYONE_CAN_JOIN, whoCanViewGroup != ANYONE_CAN_VIEW, whoCanDiscoverGroup != ANYONE_CAN_DISCOVER, whoCanPostMessage != ANYONE_CAN_POST",
              "인터넷 전체 접근·게시 불가",
              lambda g: g.get("whoCanJoin") != "ANYONE_CAN_JOIN" and g.get("whoCanViewGroup") != "ANYONE_CAN_VIEW" and g.get("whoCanDiscoverGroup") != "ANYONE_CAN_DISCOVER" and g.get("whoCanPostMessage") != "ANYONE_CAN_POST",
              ["whoCanJoin", "whoCanViewGroup", "whoCanDiscoverGroup", "whoCanPostMessage"])
    R.emit("Google Groups: Access settings", "org_policy",
           RULE("RG-GW-groupsSettings.groups.get / GW-21", "allowExternalMembers,whoCanJoin,whoCanViewMembership,whoCanViewGroup,whoCanPostMessage,whoCanDiscoverGroup,messageModerationLevel", "조직이 정한 접근 설정 준수", "그룹마다 본다"),
           "", [{**R.tkey(f"im:gws:Group:{g['email']}"), "name": g["email"], "value": {k: g.get(k) for k in ("allowExternalMembers", "whoCanJoin", "whoCanViewMembership", "whoCanViewGroup", "whoCanPostMessage", "whoCanDiscoverGroup", "messageModerationLevel")}, "status": "unknown"} for g in gs_list],
           "외부 멤버·메시지·가시성 허용 기준은 조직이 정한다")
    grp_judge("Google Groups: Spam moderation",
              "spamModerationLevel in (MODERATE, SILENTLY_MODERATE, REJECT)",
              "켬",
              lambda g: g.get("spamModerationLevel") in ("MODERATE", "SILENTLY_MODERATE", "REJECT"),
              ["spamModerationLevel"])
else:
    gs_note = (f"GW-04 에 그룹 {len(gw04_groups)}개가 있으나 Groups Settings API(GW-21, RG-GW-groupsSettings.groups.get)가 수집되지 않았다"
               if gw04_groups else "Groups Settings API 를 수집하지 않았고 GW-04 에는 그룹이 없다")
    for i, w in [("Google Groups: Set groups to Private", "그룹 공개 범위"), ("Google Groups: Access settings", "그룹 외부 멤버·메시지·가시성"), ("Google Groups: Internal groups no public access", "내부 그룹의 인터넷 공개·게시"), ("Google Groups: Spam moderation", "그룹 스팸 검토")]:
        nc(i, "Groups Settings API", w, gs_note)
A("Google Groups: Limit group creation", "그룹 생성 권한", "Groups for Business 공유 설정이 GW-24 에 없다(cis_gws.py 3.1.6.2 와 같은 해석)")
A("Sites: Block sharing outside domain", "Sites 외부 공유", "Sites 공유 설정이 GW-24 에 없다(sites.sites_creation_and_modification 은 생성·수정 권한)")
M("Vault: Protect Vault-privileged accounts", "Vault 권한 계정 보호", "Vault 권한이 어느 역할에 있는지는 GW-06 에서 확인되지 않았다")
M("Vault: Audit Vault activity", "Vault 활동 정기 감사")
M("Next steps: Security center review", "보안 센터 정기 검토")
M("Next steps: Admin audit log review", "관리자 감사 로그 정기 검토", "로그 수집 자체는 GW-10, 검토 행위는 값이 아니다")
finish()
