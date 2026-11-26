"""CIS Google Workspace Foundations Benchmark 1.4.0 86개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
항목 문장과 Audit 절차는 Prowler 사본(CIS 원문은 로그인 필요)을 따른다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, sys
from gws_common import Run, dur

RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out("cis_gws")
STD = "CIS Google Workspace Foundations Benchmark 1.4.0"
titles = json.load(open(P.TITLES, encoding="utf-8"))["cis_gws"]  # Prowler compliance 파일의 요구사항 설명
R = Run(RAW, UNIQ, DS, "CIS Google", titles)

# ---- 1 Directory ----
admins = [u for u in R.users if u.get("isAdmin") and not u.get("suspended")]
n = len(admins)
R.emit("1.1.1", "pass" if 2 <= n <= 4 else "fail", {"source": "GW-03 users", "field": "isAdmin(슈퍼 관리자)", "condition": "2 <= 수 <= 4", "combine": "정지되지 않은 슈퍼 관리자 수"},
       "2~4명", [{**R.ukey(u), "name": u["primaryEmail"], "value": True, "status": "pass" if 2 <= n <= 4 else "fail"} for u in admins], note=f"슈퍼 관리자 {n}명")
R.emit("1.1.2", "manual", {"source": "GW-03 users", "field": "슈퍼 관리자 계정의 일상 업무 사용", "condition": "", "combine": ""}, note="슈퍼 관리자를 일상 업무에 쓰는지는 값으로 정해지지 않는다")
R.absent("1.2.1.1", "외부 디렉터리 공유", "GW-24 에 directory.workspace_resource_type_visibility 는 있지만 External Directory sharing 과 다른 설정이다")

# ---- 3.1.1 Calendar ----
for i, w in [("3.1.1.1.1", "기본 캘린더 외부 공유 수준"), ("3.1.1.1.2", "기본 캘린더 내부 공유 수준"), ("3.1.1.1.3", "외부 초대 경고"),
             ("3.1.1.2.1", "보조 캘린더 외부 공유 수준"), ("3.1.1.2.2", "보조 캘린더 내부 공유 수준"), ("3.1.1.3.1", "Calendar 웹 오프라인")]:
    R.absent(i, w)

# ---- 3.1.2 Drive ----
for i, w in [("3.1.2.1.1.1", "외부 공유 경고"), ("3.1.2.1.1.2", "웹 게시·공개 공유"), ("3.1.2.1.1.3", "허용 목록 도메인 공유 제한"), ("3.1.2.1.1.4", "허용 도메인 공유 경고"),
             ("3.1.2.1.1.5", "Access Checker"), ("3.1.2.1.1.6", "외부 배포 권한"), ("3.1.2.2.1", "문서 오프라인 접근")]:
    R.absent(i, w, "Drive 공유·오프라인 설정이 GW-24 163종에 없다")
SD = "drive_and_docs.shared_drive_creation"
R.setting("3.1.2.1.2.1", SD, "allowSharedDriveCreation", lambda v: v.get("allowSharedDriveCreation") is True, "== true (생성 금지 체크 해제)")
R.setting("3.1.2.1.2.2", SD, "allowManagersToOverrideSettings", lambda v: v.get("allowManagersToOverrideSettings") is False, "== false")
R.setting("3.1.2.1.2.3", SD, "allowNonMemberAccess", lambda v: v.get("allowNonMemberAccess") is False, "== false")
R.setting("3.1.2.1.2.4", SD, "allowedPartiesForDownloadPrintCopy", lambda v: v.get("allowedPartiesForDownloadPrintCopy") != "ALL", "!= ALL")
R.setting("3.1.2.3.1", "drive_and_docs.drive_for_desktop", "allowDriveForDesktop", lambda v: v.get("allowDriveForDesktop") is False, "== false")

# ---- 3.1.3 Gmail ----
R.absent("3.1.3.1.1", "메일 위임 허용", "조직 설정은 없고, 사용자별 위임 현황만 GW-15 delegates 에 있다")
R.setting("3.1.3.1.2", "gmail.web_offline", "enabled", lambda v: v.get("enabled") is False, "== false")
for i, w in [("3.1.3.2.1", "DKIM"), ("3.1.3.2.2", "SPF TXT 레코드"), ("3.1.3.2.3", "DMARC TXT 레코드")]:
    R.emit(i, "not_collected", {"source": "DNS", "field": w, "condition": "", "combine": ""}, note="DNS 조회는 수집하지 않는다")
R.absent("3.1.3.3.1", "격리함 관리자 알림")
A = "gmail.email_attachment_safety"
R.setting("3.1.3.4.1.1", A, "enableEncryptedAttachmentProtection", lambda v: v.get("enableEncryptedAttachmentProtection") is True, "== true")
R.setting("3.1.3.4.1.2", A, "enableAttachmentWithScriptsProtection", lambda v: v.get("enableAttachmentWithScriptsProtection") is True, "== true")
R.setting("3.1.3.4.1.3", A, "enableAnomalousAttachmentProtection", lambda v: v.get("enableAnomalousAttachmentProtection") is True, "== true")
L = "gmail.links_and_external_images"
R.setting("3.1.3.4.2.1", L, "enableShortenerScanning", lambda v: v.get("enableShortenerScanning") is True, "== true")
R.setting("3.1.3.4.2.2", L, "enableExternalImageScanning", lambda v: v.get("enableExternalImageScanning") is True, "== true")
R.setting("3.1.3.4.2.3", L, "enableAggressiveWarningsOnUntrustedLinks", lambda v: v.get("enableAggressiveWarningsOnUntrustedLinks") is True, "== true")
S = "gmail.spoofing_and_authentication"
# CIS Audit 은 켜짐에 더해 조치가 'Move email to spam' 이어야 한다(3.1.3.4.3.4 는 조치 언급 없음)
for i, f, c in [("3.1.3.4.3.1", "detectDomainNameSpoofing", "domainNameSpoofingConsequence"), ("3.1.3.4.3.2", "detectEmployeeNameSpoofing", "employeeNameSpoofingConsequence"),
                ("3.1.3.4.3.3", "detectDomainSpoofingFromUnauthenticatedSenders", "domainSpoofingConsequence"), ("3.1.3.4.3.5", "detectGroupsSpoofing", "groupsSpoofingConsequence")]:
    R.setting(i, S, f"{f},{c}", lambda v, f=f, c=c: v.get(f) is True and v.get(c) == "SPAM_FOLDER", "켜짐이고 조치 == SPAM_FOLDER")
R.setting("3.1.3.4.3.4", S, "detectUnauthenticatedEmails", lambda v: v.get("detectUnauthenticatedEmails") is True, "== true")
for i, w in [("3.1.3.5.1", "POP·IMAP 접근"), ("3.1.3.5.2", "자동 전달(조직 설정)"), ("3.1.3.5.3", "사용자별 아웃바운드 게이트웨이"), ("3.1.3.6.2", "내부 발신자 스팸 필터 우회"),
             ("3.1.3.7.1", "종합 메일 저장"), ("3.1.3.7.2", "TLS 보안 전송 규정")]:
    R.absent(i, w)
R.setting("3.1.3.5.4", "gmail.external_recipient_warning", "enabled", lambda v: v.get("enabled") is True, "== true")
R.setting("3.1.3.6.1", "gmail.enhanced_pre_delivery_message_scanning", "enableImprovedSuspiciousContentDetection", lambda v: v.get("enableImprovedSuspiciousContentDetection") is True, "== true")

# ---- 3.1.4 Chat ----
R.setting("3.1.4.1.1", "chat.chat_file_sharing", "externalFileSharing", lambda v: v.get("externalFileSharing") == "NO_FILES", "== NO_FILES")
R.setting("3.1.4.1.2", "chat.chat_file_sharing", "internalFileSharing", lambda v: v.get("internalFileSharing") == "NO_FILES", "== NO_FILES")
R.setting("3.1.4.2.1", "chat.external_chat_restriction", "allowExternalChat,externalChatRestriction",
          lambda v: v.get("allowExternalChat") is False or v.get("externalChatRestriction") == "TRUSTED_DOMAINS", "외부 채팅 꺼짐 또는 허용 도메인만",
          note="CIS Audit 은 '켜짐 + 허용 도메인만'을 확인하라고 적었다. 외부 채팅이 꺼진 경우는 그보다 좁아 통과로 봤다")
R.setting("3.1.4.3.1", "chat.chat_external_spaces", "enabled,domainAllowlistMode",
          lambda v: v.get("enabled") is False or v.get("domainAllowlistMode") not in (None, "ALL_DOMAINS"), "외부 스페이스 꺼짐 또는 허용 도메인만",
          note="외부 스페이스가 꺼진 경우는 통과로 봤다(위와 같은 이유)")
R.setting("3.1.4.4.1", "chat.chat_apps_access", "enableApps", lambda v: v.get("enableApps") is False, "== false")
R.setting("3.1.4.4.2", "chat.chat_apps_access", "enableWebhooks", lambda v: v.get("enableWebhooks") is False, "== false")

# ---- 3.1.6~3.1.9 Groups·Sites·추가 서비스·Marketplace ----
for i, w in [("3.1.6.1", "그룹 외부 접근"), ("3.1.6.2", "그룹 생성 권한"), ("3.1.6.3", "대화 보기 기본 권한")]:
    R.absent(i, w, "Groups for Business 공유 설정이 GW-24 에 없다(서비스 켜짐 여부만 있음)")
R.setting("3.1.7.1", "sites.service_status", "serviceState", lambda v: v.get("serviceState") == "DISABLED", "== DISABLED")
R.setting("3.1.8.1", "groups.service_status", "serviceState", lambda v: v.get("serviceState") == "DISABLED", "== DISABLED",
          note="추가 Google 서비스의 'Google Groups' 를 groups.service_status 로 봤다(groups_for_business 는 Groups for Business)")
R.setting("3.1.9.1.1", "workspace_marketplace.apps_allowlist", "apps", lambda v: None, "선택한 앱만 설치·실행 허용", note="허용 목록(apps)은 있지만 '선택한 앱만' 모드인지는 값에 없다")

# ---- 4.1 인증 ----
R.enforced_2sv("4.1.1.1", lambda u: u.get("isAdmin") or u.get("isDelegatedAdmin"), "관리자에게 2SV 강제, 유예 2주, 기기 신뢰 끔, SMS·전화 제외",
               "2SV 유예 기간·기기 신뢰·방식 설정은 GW-24 에 없어, 2SV 가 강제된 관리자의 나머지 조건은 판정하지 못한다")
R.emit("4.1.1.2", "not_collected", {"source": "없음", "field": "2SV 방식 '보안 키만'", "condition": "관리자·고가치 계정은 보안 키만", "combine": ""}, note="2SV 방식 설정이 GW-24 에 없다")
R.enforced_2sv("4.1.1.3", lambda u: True, "모든 사용자에게 2SV 강제, 유예 2주, 기기 신뢰 끔, SMS·전화 제외",
               "2SV 유예 기간·기기 신뢰·방식 설정은 GW-24 에 없어, 2SV 가 강제된 사용자의 나머지 조건은 판정하지 못한다")
R.setting("4.1.2.1", "security.super_admin_account_recovery", "enableAccountRecovery", lambda v: v.get("enableAccountRecovery") is False, "== false")
R.setting("4.1.2.2", "security.user_account_recovery", "enableAccountRecovery", lambda v: v.get("enableAccountRecovery") is True, "== true")
R.setting("4.1.3.1", "security.advanced_protection_program", "enableAdvancedProtectionSelfEnrollment,securityCodeOption",
          lambda v: v.get("enableAdvancedProtectionSelfEnrollment") is True and v.get("securityCodeOption") == "NOT_ALLOWED", "등록 허용이고 보안 코드 생성 금지(NOT_ALLOWED)",
          note="'Do not allow users to generate security codes' 를 NOT_ALLOWED 로 봤다(필드 값 이름에 따른 해석)")
R.absent("4.1.4.1", "Post-SSO verification", "GW-24 security.login_challenges 에는 enableEmployeeIdChallenge(직원 ID 챌린지)만 있다")
R.setting("4.1.5.1", "security.password", "allowedStrength,minimumLength,enforceRequirementsAtLogin,allowReuse,expirationDuration",
          lambda v: v.get("allowedStrength") == "STRONG" and v.get("minimumLength", 0) >= 14 and v.get("enforceRequirementsAtLogin") is True
                    and v.get("allowReuse") is False and dur(v.get("expirationDuration", "0s")) == 365 * 86400,
          "STRONG, 14자 이상, 다음 로그인 때 적용, 재사용 금지, 만료 365일")

# ---- 4.2 접근·데이터 통제 ----
R.absent("4.2.1.1", "Google 서비스별 앱 접근 제한(Manage Google Services)")
R.emit("4.2.1.2", "manual", {"source": "GW-05 tokens", "field": "서드파티 앱 정기 검토", "condition": "", "combine": ""})
R.setting("4.2.1.3", "api_controls.internal_apps", "trustInternalApps", lambda v: v.get("trustInternalApps") is True, "== true")
R.emit("4.2.1.4", "manual", {"source": "없음", "field": "도메인 전체 위임 정기 검토", "condition": "", "combine": ""})
R.absent("4.2.2.1", "컨텍스트 인식 액세스 지역 제한")
dlp = [x for x in R.pol.get("rule.dlp", []) if x["value"].get("state", "ACTIVE") == "ACTIVE" and any(t.startswith("google.workspace.drive.") for t in x["value"].get("triggers", []))]
R.emit("4.2.3.1", "pass" if dlp else "fail", {"source": "GW-24 rule.dlp", "field": "triggers, state", "condition": "Drive 트리거가 있는 활성 규칙 1개 이상", "combine": "규칙 수"},
       "규칙 1개 이상", [{**R.pkey(x["name"]), "name": x["value"].get("displayName"), "value": x["value"].get("triggers"), "status": "pass"} for x in dlp])
R.setting("4.2.4.1", "security.session_controls", "webSessionDuration", lambda v: dur(v.get("webSessionDuration", "0s")) <= 43200, "<= 43200s (12시간)")
R.absent("4.2.5.1", "Google Cloud 세션 제어")

# ---- 4.3·5 정기 검토 ----
for i in ("4.3.1", "4.3.2", "5.1.1.1", "5.1.1.2"):
    R.emit(i, "manual", {"source": "없음", "field": "보고서·대시보드 정기 검토", "condition": "", "combine": ""})

# ---- 6 시스템 정의 경보 규칙: 켜짐, 정해진 심각도, 받는 사람(전체 슈퍼 관리자) ----
alerts = {x["value"].get("displayName"): x for x in R.pol.get("rule.system_defined_alerts", [])}
for i, name, sev in [("6.1", "User's password changed", "MEDIUM"), ("6.2", "Government-backed attacks", "HIGH"), ("6.3", "User suspended due to suspicious activity", "HIGH"),
                     ("6.4", "User granted Admin privilege", "MEDIUM"), ("6.5", "Suspicious programmatic login", "LOW"), ("6.6", "Suspicious login", "LOW"),
                     ("6.7", "Leaked password", "MEDIUM"), ("6.8", "Gmail potential employee spoofing", "MEDIUM")]:
    rule = {"source": "GW-24 rule.system_defined_alerts", "field": "state, alertCenterConfig.severity, recipients", "condition": f"ACTIVE, 심각도 {sev}, 전체 슈퍼 관리자에게", "combine": "이름이 같은 시스템 규칙 하나"}
    x = alerts.get(name)
    if not x: R.emit(i, "not_collected", rule, note=f"'{name}' 규칙이 수집에 없다"); continue
    ac = (x["value"].get("action") or {}).get("alertCenterAction") or {}
    val = {"state": x["value"].get("state"), "severity": (ac.get("alertCenterConfig") or {}).get("severity"), "allSuperAdmins": any(r.get("allSuperAdmins") for r in ac.get("recipients", []))}
    st = "pass" if val["state"] == "ACTIVE" and val["severity"] == sev and val["allSuperAdmins"] else "fail"
    R.emit(i, st, rule, rule["condition"], [{**R.pkey(x["name"]), "name": name, "value": val, "status": st}], note="이메일 알림 켜짐 여부는 값에 없어 보지 않았다")

R.write(OUT, STD, 1, RAW)
