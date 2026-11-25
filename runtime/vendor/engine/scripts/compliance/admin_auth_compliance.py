"""ISMS-P 2.10.2 관리자 인증: Profile로 정규화된 Object를 읽는 독립 실험.

사용: python scripts/compliance/admin_auth_compliance.py objects.json output.json [company-policy.json]
수집·게시를 수행하지 않으며 결과는 인증 적합성 판정이 아니다.
"""
import json
import os
import sys

SOURCES = {
    "gws": ["CIS GWS 1.4.0 4.1.1.1", "Google small business checklist 2", "Google Security health: Two-step verification for admins"],
    "okta": ["DISA Okta STIG OKTA-APP-000560", "Okta HealthInsight MFA for the Admin Console", "DISA Okta STIG OKTA-APP-000190"],
}


def obj(provider, kind, props, key, observed=None):
    return {"provider": provider, "kind": kind, "properties": props, "key": key, "observed_at": observed}


def evaluate_gws(objects):
    results = []
    for o in objects:
        if o.get("provider") != "gws" or o.get("kind") != "User":
            continue
        p = o.get("properties") or {}
        # An absent flag cannot establish that this user is not an administrator.
        admin, delegated, suspended = p.get("isAdmin"), p.get("isDelegatedAdmin"), p.get("suspended")
        if suspended is True or (admin is False and delegated is False):
            continue
        if suspended is not False or (admin is not True and delegated is not True):
            status = "unknown"
            reason = "관리자 또는 활성 여부를 확인할 수 없습니다."
        elif p.get("isEnforcedIn2Sv") is True:
            status, reason = "pass", "2단계 인증이 강제됩니다."
        elif p.get("isEnforcedIn2Sv") is False:
            status, reason = "fail", "2단계 인증이 강제되지 않습니다."
        elif p.get("isEnforcedIn2Sv") is None:
            status, reason = "not_collected", "2단계 인증 강제 여부가 수집되지 않았습니다."
        else:
            status, reason = "unknown", "2단계 인증 강제 값을 해석할 수 없습니다."
        results.append({"target": o["key"], "status": status, "message": reason,
                        "enforced": p.get("isEnforcedIn2Sv"), "enrolled": p.get("isEnrolledIn2Sv"),
                        "observed_at": o.get("observed_at"), "sources": SOURCES["gws"],
                        "scope": "관리자별 2단계 인증 강제 여부; 실제 로그인 성공이나 인증수단 강도는 확인하지 않음"})
    return results


def evaluate_okta_policy(rules):
    # Caller supplies rules verified to belong to the Admin Console policy.
    if any(r.get("properties", {}).get("status") not in ("ACTIVE", "INACTIVE") for r in rules):
        return {"status": "unknown", "message": "규칙 활성 상태를 확인할 수 없습니다.", "sources": SOURCES["okta"]}
    active = [r for r in rules if r.get("properties", {}).get("status") == "ACTIVE"]
    if not active or any(not isinstance(r.get("properties", {}).get("priority"), int) for r in active):
        return {"status": "unknown", "message": "활성 규칙 또는 우선순위를 확인할 수 없습니다.", "sources": SOURCES["okta"]}
    priority = min(r["properties"]["priority"] for r in active)
    selected = [r for r in active if r["properties"]["priority"] == priority]
    if len(selected) != 1:
        return {"status": "unknown", "message": "최우선 규칙이 여러 개입니다.", "sources": SOURCES["okta"]}
    r = selected[0]
    action = r["properties"].get("actions") or {}
    factor = ((action.get("appSignOn") or {}).get("verificationMethod") or {}).get("factorMode")
    status = "pass" if factor == "2FA" else ("fail" if factor == "1FA" else "not_collected" if factor is None else "unknown")
    constraints = ((action.get("appSignOn") or {}).get("verificationMethod") or {}).get("constraints")
    phishing = [((c.get("possession") or {}).get("phishingResistant")) for c in constraints if isinstance(c, dict)] if isinstance(constraints, list) else []
    phishing_status = "unknown" if not phishing or len(phishing) != len(constraints or []) or any(x is None for x in phishing) else ("pass" if all(x == "REQUIRED" for x in phishing) else "fail")
    return {"target": r["key"], "status": status, "factor_mode": factor,
            "phishing_resistant_status": phishing_status,
            "message": {"pass": "최우선 활성 규칙이 MFA를 요구합니다.", "fail": "최우선 활성 규칙이 MFA를 요구하지 않습니다.", "not_collected": "MFA 요구 설정을 수집하지 못했습니다.", "unknown": "MFA 요구 여부를 확인할 수 없습니다."}[status],
            "observed_at": r.get("observed_at"), "sources": SOURCES["okta"],
            "scope": "관리자 콘솔의 최우선 활성 규칙만 확인하며 모든 관리자 적용 여부는 확인하지 않습니다."}


def normalize_object(o):
    c = o.get("canonical") or {}
    observations = ((c.get("source") or {}).get("observations") or [])
    times = {x.get("collected_at") for x in observations if x.get("collected_at")}
    result = obj(c.get("provider"), c.get("object_type"), c.get("properties") or {}, o.get("fixture_key"),
                 next(iter(times)) if len(times) == 1 else None)
    result["references"] = c.get("references") or {}
    return result


def evaluate_okta(objects):
    policies = [o for o in objects if o["provider"] == "okta" and o["kind"] == "Policy"
                and o["properties"].get("name") == "Okta Admin Console"
                and o["properties"].get("type") == "ACCESS_POLICY"]
    if len(policies) != 1:
        return {"status": "unknown", "message": "관리자 콘솔 정책을 유일하게 확인할 수 없습니다.", "sources": SOURCES["okta"]}
    policy = policies[0]
    rules = []
    ambiguous = False
    for o in objects:
        if o["provider"] != "okta" or o["kind"] != "PolicyRule":
            continue
        targets = ((o.get("references") or {}).get("parent") or {}).get("targets") or []
        keys = [t.get("value") for t in targets if t.get("identifier_type") == "primary" and not t.get("status")]
        if policy["key"] in keys and len(keys) == 1:
            rules.append(o)
        elif not keys or policy["key"] in keys:
            ambiguous = True
    if ambiguous:
        return {"status": "unknown", "message": "일부 규칙의 정책 연결이 불명확합니다.", "sources": SOURCES["okta"]}
    return evaluate_okta_policy(rules)


def compare_policy(observed, required, applicable):
    """기준 및 적용 대상을 모르면 인증 설정을 회사 기준 위반으로 해석하지 않는다."""
    if not applicable:
        return "unknown"
    if observed is None:
        return "not_collected"
    if required is None:
        return "pass" if observed is True else "fail"
    if required is False:
        return "not_required"
    return "compliant" if observed is True else "noncompliant"


def auxiliary_enrollment(objects, provider, field):
    """등록 관측은 강제 정책이나 관리자 전체의 적용 여부와 다르다."""
    results = []
    for item in objects:
        if item.get("provider") != provider:
            continue
        props = item.get("properties") or {}
        if field not in props or props[field] is None:
            continue
        if provider == "slack" and not any(props.get(flag) is True for flag in ("is_admin", "is_owner", "is_primary_owner")):
            continue
        results.append({"target": item["key"], "value": props[field], "observed_at": item.get("observed_at")})
    return results


def evaluate(objects, company_policy=None):
    normalized = [normalize_object(o) for o in objects if o.get("fixture_key")]
    policy = company_policy or {}
    if set(policy) - {"require_mfa"} or ("require_mfa" in policy and not isinstance(policy["require_mfa"], bool)):
        raise ValueError("company policy requires a boolean require_mfa")
    required = policy.get("require_mfa")
    gws = evaluate_gws(normalized)
    for row in gws:
        raw_status = row.pop("status")
        row["observation_status"] = raw_status
        row["status"] = raw_status if raw_status in ("unknown", "not_collected") else compare_policy(row.get("enforced"), required, True)
        row["basis"] = "CIS GWS 4.1.1.1 및 Google 체크리스트의 관리자 MFA 강제" if required is None else "입력된 회사 MFA 강제 기준"
    okta = evaluate_okta(normalized)
    okta_raw = okta.pop("status")
    okta["observation_status"] = okta_raw
    okta["status"] = okta_raw
    okta["basis"] = "DISA Okta STIG 및 Okta HealthInsight 관리자 콘솔 규칙"
    okta["company_comparison_scope"] = "정책이 모든 관리자에게 적용되는지는 별도 확인이 필요합니다."
    if required is not None:
        okta["company_status"] = "unknown"
    github = []
    for o in normalized:
        if o["provider"] == "github" and o["kind"] in ("Organization", "organization-full"):
            value = o["properties"].get("two_factor_requirement_enabled")
            github.append({"target": o["key"], "status": ("pass" if value is True else "fail" if value is False else "not_collected"), "organization_2fa_required": value,
                "observed_at": o.get("observed_at"), "scope": "조직 구성원 MFA 요구 설정. 관리자별 실제 사용 및 적용은 확인하지 못함",
                "sources": ["CIS GitHub 1.2.0 1.3.5", "GitHub Docs Secure accounts / 2FA organization"]})
    slack_enrollment = auxiliary_enrollment(normalized, "slack", "has_2fa")
    salesforce_enrollment = auxiliary_enrollment(normalized, "salesforce", "mfa_methods")
    return {"criterion": "2.10.2", "check": "관리자 인증 보호",
            "decision_basis": {"company_require_mfa": required, "default_check": "기존 공개 기준에 따른 MFA 강제 여부", "recommendation": "관리자 MFA 강제", "recommendation_sources": ["CIS GWS 1.4.0 4.1.1.1", "DISA Okta STIG OKTA-APP-000560"], "recommendation_is_company_policy": False},
            "gws": gws,
            "gws_coverage": "대상 또는 수집 범위를 확인할 수 없습니다." if not gws else "수집된 관리자 후보만 확인",
            "okta": okta,
            "github": github or [{"status": "not_collected", "scope": "조직 인증 설정을 수집한 Object가 없습니다."}],
            "slack": {"status": "unknown" if slack_enrollment else "not_collected", "scope": "관리자 인증 강제 정책 미확인; 등록 상태는 강제 여부와 다름", "enrollment_observations": slack_enrollment},
            "salesforce": {"status": "not_collected", "scope": "사용자와 Profile·권한 세트 관계가 있으나 관리자 판별 및 MFA 강제 값을 확인하지 못함",
                           "enrollment_observations": salesforce_enrollment,
                           "next_step": "관리자 정의와 권한 범위를 정하고 MFA 강제 설정의 수집·정규화 여부를 확인"},
            "atlassian": {"status": "not_collected", "scope": "사용자·그룹·프로젝트 역할 관계가 있으나 조직 관리자 인증 강제 값을 확인하지 못함",
                          "next_step": "조직 관리자 범위와 인증 정책을 확인할 데이터 경로를 조사"},
            "scope": "관측된 설정의 일부 결과이며 ISMS-P 항목 전체의 적합성 판정이 아닙니다."}


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: admin_auth_compliance.py objects.json output.json [company-policy.json]")
    if os.path.abspath(sys.argv[1]) == os.path.abspath(sys.argv[2]) or (len(sys.argv) == 4 and os.path.abspath(sys.argv[2]) == os.path.abspath(sys.argv[3])):
        raise SystemExit("output must differ from input and policy files")
    with open(sys.argv[1], encoding="utf-8") as f:
        objects = json.load(f)
    if not isinstance(objects, list):
        raise SystemExit("objects.json must contain an array")
    company_policy = None
    if len(sys.argv) == 4:
        with open(sys.argv[3], encoding="utf-8") as f:
            company_policy = json.load(f)
        if not isinstance(company_policy, dict):
            raise SystemExit("company-policy.json must contain an object")
    result = evaluate(objects, company_policy)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
