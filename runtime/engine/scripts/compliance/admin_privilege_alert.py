"""ISMS-P 2.11.3: administrator privilege grant alert configuration.

Reads the existing GW-24 normalized policy. This does not prove delivery,
review, or that security events are actually detected.
"""
from admin_auth_compliance import normalize_object

RULE_NAME = "User granted Admin privilege"
SOURCE = "CIS Google Workspace 1.4.0 6.4"

def evaluate(objects, company_policy=None):
    if company_policy not in (None, {}):
        raise ValueError("this check accepts no company policy")
    rows = []
    for raw in objects:
        if not raw.get("fixture_key"):
            continue
        item = normalize_object(raw)
        props = item["properties"]
        value = props.get("setting_value")
        if (item["provider"] != "gws" or item["kind"] != "Policy"
                or props.get("setting_type") != "settings/rule.system_defined_alerts"
                or not isinstance(value, dict) or value.get("displayName") != RULE_NAME):
            continue
        action = value.get("action")
        alert = action.get("alertCenterAction") if isinstance(action, dict) else None
        conf = alert.get("alertCenterConfig") if isinstance(alert, dict) else None
        recipients = alert.get("recipients") if isinstance(alert, dict) else None
        state = value.get("state")
        severity = conf.get("severity") if isinstance(conf, dict) else None
        recipient = (any(isinstance(r, dict) and r.get("allSuperAdmins") is True for r in recipients)
                     if isinstance(recipients, list) else None)
        any_recipient = bool(recipients) if isinstance(recipients, list) else None
        conditions = [
            {"name": "규칙 활성화", "value": state, "expected": "ACTIVE", "status": "not_collected" if state is None else "pass" if state == "ACTIVE" else "fail" if state == "INACTIVE" else "unknown"},
            {"name": "심각도", "value": severity, "expected": "MEDIUM", "status": "not_collected" if severity is None else "pass" if severity == "MEDIUM" else "fail" if isinstance(severity, str) else "unknown"},
            {"name": "전체 최고 관리자 수신", "value": recipient, "expected": True, "status": "not_collected" if recipient is None else "pass" if recipient else "fail"},
        ]
        statuses = [x["status"] for x in conditions]
        status = "fail" if "fail" in statuses else "unknown" if "unknown" in statuses else "not_collected" if "not_collected" in statuses else "pass"
        scuba_conditions = [conditions[0], {"name": "수신 대상 존재", "value": any_recipient, "expected": True, "status": "not_collected" if any_recipient is None else "pass" if any_recipient else "fail"}]
        scuba_statuses = [condition["status"] for condition in scuba_conditions]
        scuba_status = "fail" if "fail" in scuba_statuses else "unknown" if "unknown" in scuba_statuses else "not_collected" if "not_collected" in scuba_statuses else "pass"
        # Keep the existing CIS result intact; the cross-provider baseline uses
        # only enabled + recipient presence, not CIS severity or recipient scope.
        rows.append({"target": item["key"], "status": status, "observed_at": item["observed_at"], "conditions": conditions,
                     "common_status": scuba_status, "common_conditions": scuba_conditions,
                     "references": [{"source": "CISA SCuBA GWS.COMMONCONTROLS.13.1", "status": scuba_status,
                                     "scope": "전체 시스템 규칙 중 이 규칙의 활성화와 수신 대상만 확인한 부분 결과", "conditions": scuba_conditions}]})
    return {"criterion": "2.11.3", "check": "관리자 권한 부여 경고 설정", "source": SOURCE,
            "scope": "Google Workspace의 해당 경고 규칙 설정만 확인합니다. 실제 경고 전달, 이벤트 발생과 대응 여부는 확인하지 않습니다.",
            "gws": rows if rows else [{"status": "not_collected", "conditions": [], "message": "해당 경고 규칙이 수집된 데이터에 없습니다."}],
            "other_saas": "다른 SaaS의 관리자 권한 부여 경고 설정 검사는 아직 연결하지 않았습니다.",
            "other_providers": [
                {"name":"Okta", "status":"not_supported", "reason":"기존 목록에서 동일한 권한 부여 경고 설정 검사를 찾지 못했습니다. System Log 이벤트 수집은 경고 설정과 별도입니다."},
                {"name":"GitHub", "status":"not_supported", "reason":"기존 목록의 알림 검사는 다른 대상이며 감사 로그 검토는 경고 설정 확인과 다릅니다."},
                {"name":"Slack", "status":"not_supported", "reason":"관리자 역할 변경 감사 이벤트와 경고 규칙 설정은 다릅니다. 해당 설정의 수집 경로를 확인하지 못했습니다."},
                {"name":"Salesforce", "status":"not_supported", "reason":"기존 설정 모니터링 항목은 수동 검사이며 관리자 권한 부여 경고 설정은 확인하지 못했습니다."},
                {"name":"Atlassian", "status":"not_supported", "reason":"의심 활동 알림은 미수집으로 기록되어 있고 관리자 권한 부여에 적용되는지 확인하지 못했습니다."}
            ]}
