"""CISA SCuBA Google Workspace Baseline 0.6 133개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
항목 문장은 Prowler 사본(0.6)을 따른다. 설정값 해석은 ScubaGoggles 기준선의 Implementation 절을 따르되, 0.6 과 문장이 같은 항목에만 썼다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, sys
from gws_common import Run, dur

RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out("scuba_gws")
STD = "CISA SCuBA Google Workspace Baseline 0.6"
titles = json.load(open(P.TITLES, encoding="utf-8"))["scuba_gws"]  # Prowler compliance 파일의 요구사항 설명
R = Run(RAW, UNIQ, DS, "CISA SCuBA", titles)
pol, users = R.pol, R.users

# ---- COMMONCONTROLS ----
ts = [{**R.tkey(f"im:gws:User:{u['id']}"), "name": u["primaryEmail"], "value": u.get("isEnforcedIn2Sv"), "status": "pass" if u.get("isEnforcedIn2Sv") else "fail"} for u in users if not u.get("suspended")]
R.emit("GWS.COMMONCONTROLS.1.1", "fail" if any(t["status"] == "fail" for t in ts) else "unknown",
     {"source": "GW-03 users", "field": "isEnforcedIn2Sv", "condition": "2SV 가 강제되고 그 방식이 피싱 방지(보안 키·패스키)", "combine": "활성 사용자마다 본다. 2SV 자체가 강제되지 않은 사용자가 있으면 위반"},
     "피싱 방지 MFA 강제", ts, note="2SV 강제 방식(보안 키만 허용 등) 설정은 GW-24 에 없어, 2SV 가 강제된 사용자의 방식은 판정하지 못한다")
for i, w in [("1.2", "2SV 허용 방식"), ("1.3", "2SV 허용 방식(SMS·음성)"), ("1.4", "2SV 신규 등록 유예 기간"), ("1.5", "2SV 기기 신뢰 허용")]:
    R.absent(f"GWS.COMMONCONTROLS.{i}", w)
R.absent("GWS.COMMONCONTROLS.2.1", "컨텍스트 인식 액세스(CAA) 정책")
R.absent("GWS.COMMONCONTROLS.3.1", "Post-SSO verification(조직 SSO 프로필)", "GW-24 security.login_challenges 에는 enableEmployeeIdChallenge(직원 ID 챌린지)만 있다. Post-SSO 확인과 다른 설정이다")
R.absent("GWS.COMMONCONTROLS.3.2", "Post-SSO verification(기타 SSO 프로필)", "위와 같음")
R.setting("GWS.COMMONCONTROLS.4.1", "security.session_controls", "webSessionDuration", lambda v: dur(v.get("webSessionDuration", "0s")) <= 43200, "<= 43200s (12시간)")
R.setting("GWS.COMMONCONTROLS.5.1", "security.password", "allowedStrength", lambda v: v.get("allowedStrength") == "STRONG", "== STRONG")
R.setting("GWS.COMMONCONTROLS.5.2", "security.password", "minimumLength", lambda v: v.get("minimumLength", 0) >= 12, ">= 12")
R.setting("GWS.COMMONCONTROLS.5.3", "security.password", "minimumLength", lambda v: v.get("minimumLength", 0) >= 15, ">= 15")
R.setting("GWS.COMMONCONTROLS.5.4", "security.password", "enforceRequirementsAtLogin", lambda v: v.get("enforceRequirementsAtLogin") is True, "== true")
R.setting("GWS.COMMONCONTROLS.5.5", "security.password", "allowReuse", lambda v: v.get("allowReuse") is False, "== false")
R.setting("GWS.COMMONCONTROLS.5.6", "security.password", "expirationDuration", lambda v: dur(v.get("expirationDuration", "0s")) == 0, "== 0s (만료 없음)")
sso = [x for p in R.payloads("GW-17") for x in (p.get("inboundSsoAssignments") or [])]
admins = [u for u in users if u.get("isAdmin")]
R.emit("GWS.COMMONCONTROLS.6.1", "pass" if not sso else "unknown",
     {"source": "GW-17 inboundSsoAssignments, GW-03 users", "field": "SSO 할당 대상 OU·그룹, 관리자 orgUnitPath", "condition": "관리자가 SSO 할당 대상에 들지 않음", "combine": "SSO 할당이 하나도 없으면 모든 관리자가 클라우드 전용"},
     "관리자는 클라우드 전용", [{**R.tkey(f"im:gws:User:{u['id']}"), "name": u["primaryEmail"], "value": u.get("orgUnitPath"), "status": "pass" if not sso else "unknown"} for u in admins],
     note="" if not sso else "SSO 할당이 있어 관리자 OU 와 대조가 필요하다(이 스크립트는 하지 않음)")
n = len([u for u in admins if not u.get("suspended")])
R.emit("GWS.COMMONCONTROLS.6.2", "pass" if 2 <= n <= 8 else "fail",
     {"source": "GW-03 users", "field": "isAdmin(슈퍼 관리자)", "condition": "2 <= 수 <= 8", "combine": "정지되지 않은 슈퍼 관리자 수"},
     "2~8명", [{**R.tkey(f"im:gws:User:{u['id']}"), "name": u["primaryEmail"], "value": True, "status": "pass" if 2 <= n <= 8 else "fail"} for u in admins], note=f"슈퍼 관리자 {n}명")
R.emit("GWS.COMMONCONTROLS.7.1", "manual", {"source": "없음", "field": "관리 도메인과 충돌하는 비관리 계정", "condition": "", "combine": ""}, note="충돌 계정 목록은 Admin 콘솔 전송 도구에서만 보인다")
R.setting("GWS.COMMONCONTROLS.8.1", "security.super_admin_account_recovery", "enableAccountRecovery", lambda v: v.get("enableAccountRecovery") is False, "== false")
R.setting("GWS.COMMONCONTROLS.8.2", "security.user_account_recovery", "enableAccountRecovery", lambda v: v.get("enableAccountRecovery") is False, "== false")
R.absent("GWS.COMMONCONTROLS.8.3", "사용자 복구 전화·이메일 추가 허용")
R.absent("GWS.COMMONCONTROLS.9.1", "사용자별 Advanced Protection 등록 상태", "GW-24 에는 자가 등록 허용(enableAdvancedProtectionSelfEnrollment)만 있고 등록 여부는 없다")
R.emit("GWS.COMMONCONTROLS.9.2", "org_policy", {"source": "없음", "field": "민감 사용자 목록, 사용자별 APP 등록 상태", "condition": "", "combine": ""}, note="민감 사용자 정의는 조직이 정한다. 등록 상태도 수집 없음")
R.setting("GWS.COMMONCONTROLS.10.1", "api_controls.unconfigured_third_party_apps", "accessLevel",
        lambda v: True if v.get("accessLevel") in ("BLOCK_ALL", "ALLOW_SIGN_IN_ONLY") else (False if v.get("accessLevel") == "ACCESS_LEVEL_UNSPECIFIED" else None),
        "BLOCK_ALL 또는 ALLOW_SIGN_IN_ONLY",
        note="ACCESS_LEVEL_UNSPECIFIED 는 제한을 고르지 않은 상태(콘솔의 무제한 허용)로 보고 위반 판정. BLOCK_ALL, ALLOW_SIGN_IN_ONLY 만 통과. 출처 https://docs.cloud.google.com/identity/docs/concepts/supported-policy-api-settings")
R.emit("GWS.COMMONCONTROLS.10.2", "not_collected", {"source": "없음", "field": "최소 접근 요건 미충족 앱 차단", "condition": "", "combine": ""}, note="서비스별 API 접근 제한(Manage Google Services) 설정이 GW-24 에 없다")
R.emit("GWS.COMMONCONTROLS.10.3", "org_policy", {"source": "GW-05 tokens", "field": "부여된 scope", "condition": "고위험 scope 는 명시적으로 신뢰한 앱만", "combine": ""}, note="신뢰 앱 목록이 수집에 없다")
R.emit("GWS.COMMONCONTROLS.10.4", "manual", {"source": "없음", "field": "도메인 전체 위임 앱 정기 검토", "condition": "", "combine": ""})
R.setting("GWS.COMMONCONTROLS.10.5", "api_controls.internal_apps", "trustInternalApps", lambda v: v.get("trustInternalApps") is True, "== true")
R.setting("GWS.COMMONCONTROLS.11.1", "workspace_marketplace.apps_allowlist", "apps", lambda v: None, "허용 목록 앱만 설치 허용, 내부 앱 예외 없음",
        note="허용 목록(apps)은 있지만 '허용 목록 앱만 설치' 모드와 내부 앱 예외 여부는 값에 없다")
tk = [(k, v) for k, v in pol.items() if k == "takeout.service_status" or k.endswith(".user_takeout")]
ts = []
for k, vs in tk:
    eff = max(vs, key=lambda t: t["sort"]); val = eff["value"].get("serviceState") or eff["value"].get("takeoutStatus")
    ts.append({**R.pkey(eff["name"]), "name": k, "value": val, "status": "pass" if val == "DISABLED" else "fail"})
R.emit("GWS.COMMONCONTROLS.12.1", "fail" if any(t["status"] == "fail" for t in ts) else "pass",
     {"source": "GW-24 takeout.service_status, *.user_takeout", "field": "serviceState, takeoutStatus", "condition": "== DISABLED", "combine": "Takeout 서비스와 서비스별 Takeout 하나라도 켜져 있으면 위반"}, "DISABLED", ts)
al = [x for x in pol.get("rule.system_defined_alerts", [])]
ts = [{**R.pkey(x["name"]), "name": x["value"].get("displayName"), "value": {"state": x["value"].get("state"), "recipients": len(((x["value"].get("action") or {}).get("alertCenterAction") or {}).get("recipients") or [])},
       "status": "pass" if x["value"].get("state") == "ACTIVE" and ((x["value"].get("action") or {}).get("alertCenterAction") or {}).get("recipients") else "fail"} for x in al]
R.emit("GWS.COMMONCONTROLS.13.1", "fail" if any(t["status"] == "fail" for t in ts) else ("pass" if ts else "not_collected"),
     {"source": "GW-24 rule.system_defined_alerts", "field": "state, action.alertCenterAction.recipients", "condition": "모두 ACTIVE 이고 받는 사람이 있음", "combine": "시스템 정의 규칙 하나라도 어기면 위반"}, "전부 ACTIVE + 받는 사람", ts)
R.emit("GWS.COMMONCONTROLS.14.1", "manual", {"source": "없음", "field": "SIEM 으로 로그 전송", "condition": "", "combine": ""}, note="BigQuery 내보내기 등 전송 설정은 수집에 없고 SIEM 쪽 확인이 필요하다")
R.emit("GWS.COMMONCONTROLS.14.2", "manual", {"source": "없음", "field": "로그 6개월 이상 보관", "condition": "", "combine": ""})
R.setting("GWS.COMMONCONTROLS.15.1", "data_regions.data_at_rest_region", "region", lambda v: v.get("region") == "US", "== US")
R.setting("GWS.COMMONCONTROLS.15.2", "data_regions.data_processing_region", "limitToStorageRegion", lambda v: None, "보조 데이터 저장소 미국",
        note="0.6 문장은 '보조 데이터 저장소', GW-24 값은 '처리 지역을 저장 지역으로 제한'이라 같은 설정인지 확인하지 못했다")
R.emit("GWS.COMMONCONTROLS.16.1", "org_policy", {"source": "GW-24 *.service_status", "field": "serviceState", "condition": "필수가 아닌 추가 서비스는 DISABLED", "combine": ""},
     targets=[{**R.pkey(max(v, key=lambda t: t["sort"])["name"]), "name": k, "value": max(v, key=lambda t: t["sort"])["value"].get("serviceState"), "status": "unknown"} for k, v in sorted(pol.items()) if k.endswith(".service_status")],
     note="어느 서비스가 필수인지는 조직이 정한다")
R.emit("GWS.COMMONCONTROLS.16.2", "org_policy", {"source": "GW-24 *.service_status", "field": "serviceState 와 OU·그룹", "condition": "필수 서비스는 승인된 사용자에게만", "combine": ""}, note="승인 사용자 정의는 조직이 정한다")
R.setting("GWS.COMMONCONTROLS.17.1", "multi_party_approval.require_approvals", "multiPartyApprovalState", lambda v: v.get("multiPartyApprovalState") == "ENABLED", "== ENABLED")
dlp = pol.get("rule.dlp", [])
for i, svc in [("18.1", "drive"), ("18.2", "gmail"), ("18.3", "chat")]:
    hit = [x for x in dlp if any(t.startswith(f"google.workspace.{svc}.") for t in x["value"].get("triggers", [])) and x["value"].get("state", "ACTIVE") == "ACTIVE"]
    R.emit(f"GWS.COMMONCONTROLS.{i}", "pass" if hit else "fail",
         {"source": "GW-24 rule.dlp", "field": "triggers, state", "condition": f"google.workspace.{svc}.* 트리거가 있는 활성 규칙 1개 이상", "combine": "규칙 수"},
         "규칙 1개 이상", [{**R.pkey(x["name"]), "name": x["value"].get("displayName"), "value": x["value"].get("triggers"), "status": "pass"} for x in hit])
R.emit("GWS.COMMONCONTROLS.18.4", "org_policy", {"source": "GW-24 rule.dlp", "field": "action.alertCenterAction.alertCenterConfig.severity", "condition": "조직에 맞는 심각도", "combine": ""})

# ---- GMAIL ----
R.absent("GWS.GMAIL.1.1", "메일 위임 허용", "조직 설정은 없고, 사용자별 위임 현황만 GW-15 delegates 에 있다")
for i, w in [("2.1", "DKIM"), ("3.1", "SPF TXT 레코드"), ("4.1", "DMARC TXT 레코드"), ("4.2", "DMARC p 값"), ("4.3", "DMARC rua"), ("4.4", "DMARC 기관 연락처")]:
    R.emit(f"GWS.GMAIL.{i}", "not_collected", {"source": "DNS", "field": w, "condition": "", "combine": ""}, note="DNS 조회는 수집하지 않는다")
A = "gmail.email_attachment_safety"
R.setting("GWS.GMAIL.5.1", A, "enableEncryptedAttachmentProtection", lambda v: v.get("enableEncryptedAttachmentProtection") is True, "== true")
R.setting("GWS.GMAIL.5.2", A, "enableAttachmentWithScriptsProtection", lambda v: v.get("enableAttachmentWithScriptsProtection") is True, "== true")
R.setting("GWS.GMAIL.5.3", A, "enableAnomalousAttachmentProtection", lambda v: v.get("enableAnomalousAttachmentProtection") is True, "== true")
R.setting("GWS.GMAIL.5.4", A, "applyFutureRecommendedSettingsAutomatically", lambda v: v.get("applyFutureRecommendedSettingsAutomatically") is True, "== true")
KEEP = ("SPAM_FOLDER", "QUARANTINE")
R.setting("GWS.GMAIL.5.5", A, "encryptedAttachmentProtectionConsequence,attachmentWithScriptsProtectionConsequence,anomalousAttachmentProtectionConsequence",
        lambda v: all(v.get(k) in KEEP for k in ("encryptedAttachmentProtectionConsequence", "attachmentWithScriptsProtectionConsequence", "anomalousAttachmentProtectionConsequence")),
        "세 조치 모두 스팸함 또는 격리", note="WARNING 은 경고를 붙여 받은편지함에 둔다는 뜻으로 해석했다")
for i in ("5.6", "6.5", "7.8", "15.2", "16.2"):
    R.emit(f"GWS.GMAIL.{i}", "manual", {"source": "없음", "field": "외부 보호 솔루션이 GWS 와 동등한지", "condition": "", "combine": ""})
L = "gmail.links_and_external_images"
R.setting("GWS.GMAIL.6.1", L, "enableShortenerScanning", lambda v: v.get("enableShortenerScanning") is True, "== true")
R.setting("GWS.GMAIL.6.2", L, "enableExternalImageScanning", lambda v: v.get("enableExternalImageScanning") is True, "== true")
R.setting("GWS.GMAIL.6.3", L, "enableAggressiveWarningsOnUntrustedLinks", lambda v: v.get("enableAggressiveWarningsOnUntrustedLinks") is True, "== true")
R.setting("GWS.GMAIL.6.4", L, "applyFutureSettingsAutomatically", lambda v: v.get("applyFutureSettingsAutomatically") is True, "== true")
S = "gmail.spoofing_and_authentication"
for i, f in [("7.1", "detectDomainNameSpoofing"), ("7.2", "detectEmployeeNameSpoofing"), ("7.3", "detectDomainSpoofingFromUnauthenticatedSenders"), ("7.4", "detectUnauthenticatedEmails"), ("7.5", "detectGroupsSpoofing")]:
    R.setting(f"GWS.GMAIL.{i}", S, f, lambda v, f=f: v.get(f) is True, "== true")
CS = ("domainNameSpoofingConsequence", "employeeNameSpoofingConsequence", "domainSpoofingConsequence", "unauthenticatedEmailConsequence", "groupsSpoofingConsequence")
R.setting("GWS.GMAIL.7.6", S, ",".join(CS), lambda v: all(v.get(k) in KEEP for k in CS), "다섯 조치 모두 스팸함 또는 격리", note="WARNING·NO_ACTION 은 받은편지함에 둔다는 뜻으로 해석했다")
R.setting("GWS.GMAIL.7.7", S, "applyFutureSettingsAutomatically", lambda v: v.get("applyFutureSettingsAutomatically") is True, "== true")
R.setting("GWS.GMAIL.8.1", "gmail.user_email_uploads", "enableMailAndContactsImport", lambda v: v.get("enableMailAndContactsImport") is False, "== false")
for i, w in [("9.1", "POP·IMAP 접근"), ("10.1", "Google Workspace Sync"), ("11.1", "자동 전달(조직 설정)"), ("12.1", "사용자별 아웃바운드 게이트웨이"), ("14.1", "이메일 허용 목록"),
             ("16.1", "보안 샌드박스"), ("17.1", "종합 메일 저장"), ("18.1", "스팸 필터 우회 도메인 목록"), ("18.2", "스팸 우회·경고 숨김 도메인 목록"), ("18.3", "내·외부 전체 스팸 우회")]:
    R.absent(f"GWS.GMAIL.{i}", w)
R.setting("GWS.GMAIL.13.1", "gmail.external_recipient_warning", "enabled", lambda v: v.get("enabled") is True, "== true")
R.setting("GWS.GMAIL.15.1", "gmail.enhanced_pre_delivery_message_scanning", "enableImprovedSuspiciousContentDetection", lambda v: v.get("enableImprovedSuspiciousContentDetection") is True, "== true")

# ---- DRIVEDOCS ----
for i, w in [("1.1", "외부 공유 허용 도메인 제한"), ("1.2", "허용 목록 외 파일 수신"), ("1.3", "허용 목록 외 공유 경고"), ("1.4", "Google 계정 없는 사용자와 공유"), ("1.5", "링크 소지자 누구나 공유"),
             ("1.6", "Access Checker"), ("1.7", "다른 조직 공유 드라이브로 이동"), ("1.8", "새 항목 기본 접근 수준"), ("1.10", "외부 링크 응답 양식"), ("1.11", "외부 양식 응답 제출")]:
    R.absent(f"GWS.DRIVEDOCS.{i}", w, "Drive 공유 설정(drive_and_docs.external_sharing 류)이 GW-24 163종에 없다")
R.setting("GWS.DRIVEDOCS.1.9", "drive_and_docs.external_file_warning", "highlightingEnabled", lambda v: v.get("highlightingEnabled") is True, "== true")
R.setting("GWS.DRIVEDOCS.2.1", "drive_and_docs.shared_drive_creation", "allowManagersToOverrideSettings", lambda v: v.get("allowManagersToOverrideSettings") is False, "== false")
R.setting("GWS.DRIVEDOCS.2.2", "drive_and_docs.shared_drive_creation", "allowNonMemberAccess", lambda v: v.get("allowNonMemberAccess") is True, "== true")
R.setting("GWS.DRIVEDOCS.3.1", "drive_and_docs.file_security_update", "securityUpdate,allowUsersToManageUpdate",
        lambda v: v.get("securityUpdate") == "APPLY_TO_IMPACTED_FILES" and v.get("allowUsersToManageUpdate") is False, "APPLY_TO_IMPACTED_FILES 이고 사용자 변경 불가")
R.setting("GWS.DRIVEDOCS.4.1", "drive_and_docs.drive_sdk", "enableDriveSdkApiAccess", lambda v: v.get("enableDriveSdkApiAccess") is False, "== false")
R.absent("GWS.DRIVEDOCS.5.1", "Docs 추가 기능(Add-ons)")
R.setting("GWS.DRIVEDOCS.6.1", "drive_and_docs.drive_for_desktop", "allowDriveForDesktop,restrictToAuthorizedDevices",
        lambda v: v.get("allowDriveForDesktop") is False or v.get("restrictToAuthorizedDevices") is True, "꺼져 있거나 승인 기기로 제한")

# ---- CALENDAR ----
for i, w in [("1.1", "기본 캘린더 외부 공유 수준"), ("1.2", "보조 캘린더 외부 공유 수준"), ("2.1", "외부 초대 경고"), ("3.1", "Calendar Interop"), ("3.2", "Interop 연결 방식")]:
    R.absent(f"GWS.CALENDAR.{i}", w, "조직 설정이 GW-24 에 없다. 1.1 은 사용자별 기본 캘린더 ACL 이 GW-22 에 있다" if i == "1.1" else "")
R.setting("GWS.CALENDAR.4.1", "calendar.appointment_schedules", "enablePayments", lambda v: v.get("enablePayments") is False, "== false")

# ---- CHAT ----
R.absent("GWS.CHAT.1.1", "1:1·그룹 대화 기록 설정")
R.absent("GWS.CHAT.1.2", "사용자 기록 설정 변경 허용")
R.setting("GWS.CHAT.2.1", "chat.chat_file_sharing", "externalFileSharing", lambda v: v.get("externalFileSharing") == "NO_FILES", "== NO_FILES")
R.setting("GWS.CHAT.3.1", "chat.space_history", "historyState", lambda v: v.get("historyState") == "HISTORY_ALWAYS_ON" if v.get("historyState") in ("HISTORY_ALWAYS_ON", "DEFAULT_HISTORY_ON", "DEFAULT_HISTORY_OFF", "HISTORY_ALWAYS_OFF") else None,
        "== HISTORY_ALWAYS_ON", note="ScubaGoggles 는 'History is ALWAYS ON' 을 요구한다. DEFAULT_HISTORY_ON 은 사용자가 끌 수 있어 위반으로 봤다")
R.setting("GWS.CHAT.4.1", "chat.external_chat_restriction", "allowExternalChat,externalChatRestriction",
        lambda v: v.get("allowExternalChat") is False or v.get("externalChatRestriction") == "TRUSTED_DOMAINS", "외부 채팅 꺼짐 또는 허용 도메인만")
R.setting("GWS.CHAT.5.1", "chat.content_reporting", "oneOnOneDirectMessagesReporting,spacesReporting,groupDirectMessagesReporting",
        lambda v: None if "CONTENT_REPORTING_STATE_UNSPECIFIED" in (v.get("oneOnOneDirectMessagesReporting"), v.get("spacesReporting"), v.get("groupDirectMessagesReporting")) else all(v.get(k) == "ENABLED" for k in ("oneOnOneDirectMessagesReporting", "spacesReporting", "groupDirectMessagesReporting")),
        "모든 대화 유형 신고 켜짐", note="값이 UNSPECIFIED 면 켜짐·꺼짐을 알 수 없다")
R.setting("GWS.CHAT.5.2", "chat.content_reporting", "spacesReportingType", lambda v: None, "모든 신고 범주 선택", note="신고 범주 목록이 값에 없다")

# ---- MEET ----
R.setting("GWS.MEET.1.1", "meet.meet_joining", "allowedAudience", lambda v: v.get("allowedAudience") in ("TRUSTED", "SAME_ORGANIZATION_ONLY", "RESTRICTED"), "TRUSTED 또는 RESTRICTED",
        note="ScubaGoggles: Meeting access type 을 Trusted 또는 Restricted 로")
R.setting("GWS.MEET.2.1", "meet.safety_access", "meetingsAllowedToJoin", lambda v: v.get("meetingsAllowedToJoin") != "ALL", "ALL 이 아님(조직 또는 Workspace 조직 회의만)")
R.setting("GWS.MEET.3.1", "meet.safety_host_management", "enableHostManagement", lambda v: v.get("enableHostManagement") is True, "== true")
R.setting("GWS.MEET.4.1", "meet.safety_external_participants", "enableExternalLabel", lambda v: v.get("enableExternalLabel") is True, "== true")
R.setting("GWS.MEET.5.1", "meet.meet_incoming_call_restrictions", "allowedCallers", lambda v: v.get("allowedCallers") == "CONTACTS_AND_ORGANIZATION_ONLY", "== CONTACTS_AND_ORGANIZATION_ONLY")
R.setting("GWS.MEET.6.1", "meet.automatic_recording", "enabled", lambda v: v.get("enabled") is False, "== false")
R.setting("GWS.MEET.6.2", "meet.automatic_transcription", "enabled", lambda v: v.get("enabled") is False, "== false")

# ---- GROUPS · SITES · CLASSROOM ----
for i, w in [("1.1", "그룹 외부 접근"), ("1.2", "그룹 외부 멤버 추가"), ("1.3", "그룹 외부 게시"), ("2.1", "그룹 생성 권한"), ("3.1", "대화 보기 기본 권한"), ("4.1", "디렉터리에서 그룹 숨김")]:
    R.absent(f"GWS.GROUPS.{i}", w, "Groups for Business 공유 설정이 GW-24 에 없다(서비스 켜짐 여부만 있음)")
R.setting("GWS.SITES.1.1", "sites.service_status", "serviceState", lambda v: v.get("serviceState") == "DISABLED", "== DISABLED")
R.setting("GWS.CLASSROOM.1.1", "classroom.class_membership", "whoCanJoinClasses", lambda v: v.get("whoCanJoinClasses") in ("ANYONE_IN_DOMAIN", "ANYONE_IN_ALLOWLISTED_DOMAINS"), "도메인 또는 허용 도메인 사용자")
R.setting("GWS.CLASSROOM.1.2", "classroom.class_membership", "whichClassesCanUsersJoin", lambda v: v.get("whichClassesCanUsersJoin") in ("CLASSES_IN_DOMAIN", "CLASSES_IN_ALLOWLISTED_DOMAINS"), "도메인 또는 허용 도메인 수업")
R.setting("GWS.CLASSROOM.2.1", "classroom.api_data_access", "enableApiAccess", lambda v: v.get("enableApiAccess") is False, "== false")
R.setting("GWS.CLASSROOM.3.1", "classroom.roster_import", "rosterImportOption", lambda v: v.get("rosterImportOption") == "OFF", "== OFF")
R.setting("GWS.CLASSROOM.4.1", "classroom.student_unenrollment", "whoCanUnenrollStudents", lambda v: v.get("whoCanUnenrollStudents") == "TEACHERS_ONLY", "== TEACHERS_ONLY")
R.setting("GWS.CLASSROOM.5.1", "classroom.teacher_permissions", "whoCanCreateClasses", lambda v: v.get("whoCanCreateClasses") == "VERIFIED_TEACHERS_ONLY", "== VERIFIED_TEACHERS_ONLY")

R.write(OUT, STD, 1, RAW)
