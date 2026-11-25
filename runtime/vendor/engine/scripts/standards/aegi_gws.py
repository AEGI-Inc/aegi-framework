"""AEGI 자체 점검: Google Workspace 계정과 기기. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)"""
import aegi_common as A

S = A.Standard("aegi_gws", "AEGI 자체 점검: Google Workspace 계정과 기기", "gws")

users, now = A.gws_accounts()
okta, _ = A.okta_accounts()
if users is None:
    for iid in ("AEGI-GWS-01", "AEGI-GWS-02"):
        S.not_collected(iid, {"source": "GW-03 users.list", "field": "", "condition": "", "combine": ""}, "GW-03 사용자 원본이 수집에 없다")
else:
    A.inactive_item(S, "AEGI-GWS-01", users, now, "GW-03 users.list")
    A.leftover_item(S, "AEGI-GWS-02", users, [("Okta", okta)], "GW-03 users.list")

# ---- 기기(Cloud Identity devices, deviceUsers). 기기 에이전트가 없으면 상태 값이 비어 위반(상태 확인 불가)으로 둔다 ----
DEV, DU = "RG-GW-cloudidentity.devices.list", "RG-GW-cloudidentity.devices.deviceUsers.list"
devs, dus = A.load("gws", DEV), A.load("gws", DU)
dev_rule = lambda field, cond: {"source": "Cloud Identity devices.list" if field == "encryptionState" else "Cloud Identity devices.deviceUsers.list",
                                "field": field, "condition": cond, "combine": "기기마다 판정, 하나라도 맞지 않거나 관리 에이전트가 없어 상태를 알 수 없으면 위반"}
NOTE_NC = "Cloud Identity 기기 원본이 수집에 없다(GWS 도메인 위임 scope 에 cloud-identity.devices 필요)"

if devs is None:
    S.not_collected("AEGI-GWS-03", dev_rule("encryptionState", "ENCRYPTED"), NOTE_NC)
else:
    ts = []
    for e in devs:
        for d in (e["payload"] or {}).get("devices", []):
            v = d.get("encryptionState")
            if v == "ENCRYPTED":
                st, val = "pass", v
            elif v == "NOT_ENCRYPTED":
                st, val = "fail", v
            elif not v:
                st, val = "fail", "관리 에이전트 없음(상태 확인 불가)"
            else:
                st, val = "unknown", v
            ts.append(A.target(f"im:gws:GoogleAppsCloudidentityDevicesV1Device:{A.Q(d['name'])}", f"{d.get('deviceType', '')} {d.get('model') or d.get('osVersion') or ''}".strip(),
                               val, st))
    S.emit("AEGI-GWS-03", A.worst(ts), dev_rule("encryptionState", "ENCRYPTED"), "ENCRYPTED", ts,
           "값 없음은 기기에 관리 에이전트가 없어 Google 이 암호화 상태를 확인하지 못하는 경우라 위반으로 판정한다")

if dus is None:
    for iid, field, cond in (("AEGI-GWS-04", "passwordState", "PASSWORD_SET"), ("AEGI-GWS-05", "managementState", "APPROVED, BLOCKED, WIPING, WIPED")):
        S.not_collected(iid, dev_rule(field, cond), NOTE_NC)
else:
    # 그래프 키는 「요청한 기기 id | 기기 사용자 이름」(수집기 레지스트리 규칙)
    rows = [((e.get("request_params") or {}).get("devicesId", ""), u) for e in dus for u in (e["payload"] or {}).get("deviceUsers", [])]
    key = lambda pu: f"im:gws:GoogleAppsCloudidentityDevicesV1DeviceUser:{A.Q(pu[0])}|{A.Q(pu[1]['name'])}"
    ts = []
    for pu in rows:
        u = pu[1]
        v = u.get("passwordState")
        if v == "PASSWORD_SET":
            st, val = "pass", v
        elif v == "PASSWORD_NOT_SET":
            st, val = "fail", v
        elif not v:
            st, val = "fail", "관리 에이전트 없음(상태 확인 불가)"
        else:
            st, val = "unknown", v
        ts.append(A.target(key(pu), u.get("userEmail") or u["name"], val, st))
    S.emit("AEGI-GWS-04", A.worst(ts), dev_rule("passwordState", "PASSWORD_SET"), "PASSWORD_SET", ts,
           "값 없음은 기기에 관리 에이전트가 없어 화면 잠금 비밀번호 상태를 확인하지 못하는 경우라 위반으로 판정한다")
    ok, bad = {"APPROVED", "BLOCKED", "WIPING", "WIPED"}, {"PENDING_APPROVAL", "UNAPPROVED"}
    ts = []
    for pu in rows:
        u = pu[1]
        v = u.get("managementState")
        ts.append(A.target(key(pu), u.get("userEmail") or u["name"], v or "값 없음", "pass" if v in ok else "fail" if v in bad else "unknown"))
    S.emit("AEGI-GWS-05", A.worst(ts), dev_rule("managementState", "APPROVED, BLOCKED, WIPING, WIPED"), "관리 승인 또는 차단", ts,
           "승인 대기(PENDING_APPROVAL), 미승인(UNAPPROVED) 기기가 업무 계정으로 동기화되면 위반")

S.finish()
