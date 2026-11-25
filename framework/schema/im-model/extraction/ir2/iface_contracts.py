"""Stage-3 contracts: validate projected Object rows, audit type requirements.

Raw API schemas are not Object rows. A URL/permission/secret in an API response
creates a routing obligation; it does not by itself disqualify an Integration.
The type audit never claims that uncollected rows passed their contracts.
"""
import collections
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
PROVIDERS = ("github", "okta", "slack", "gws", "jira", "confluence", "salesforce", "atlassian")
ROW = {
    "Tenant": {},
    "Principal": {"principal_kind": ["human", "service", "group", "unknown"]},
    "Integration": {"operational_state": ["active", "suspended", "inactive", "unknown"]},
    "Credential": {"material_location": ["tenant_side", "counterparty_side", "both", "third_party", "none"], "expires_at": "timestamp_or_null"},
    "Assignment": {"expires_at": "timestamp_or_null"},
    "Policy": {},
    "Endpoint": {"endpoint_owner": ["provider_hosted", "customer_hosted", "third_party_hosted"],
                 "blocking": ["none", "blocking_fail_open", "blocking_fail_closed"]},
    "Resource": {},
    "Automation": {"run_as_resolution": ["static_principal", "caller", "platform_superuser", "per_step", "unknown"]},
}
PROFILE = {i: {} for i in ROW}
PROFILE.update(Credential={"credential_kind": ["bearer_token", "bearer_url", "key_pair", "certificate", "federation"],
                           "rotation": ["api", "console", "counterparty", "none"]},
               Endpoint={"direction": ["in", "out", "both"]}, Resource={"grant_target": "boolean"})
HIDE = {"client_secret", "signing_secret", "verification_token", "refresh_token", "access_token",
        "bot_access_token", "app_token", "api_token", "sharedSecret", "privateKeyData"}
TOKEN = re.compile(r"^xox|hooks\.slack\.com/services/")


def sources():
    manifest = json.loads((HERE / "collect/interface_contracts/sources.json").read_text(encoding="utf-8"))
    for row in manifest["sources"]:
        path = (HERE / row["file"]).resolve()
        if not path.is_relative_to(HERE) or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError("interface contract source changed")
    return manifest


def matches(value, spec):
    if isinstance(spec, list):
        return isinstance(value, str) and value in spec
    if spec == "boolean":
        return isinstance(value, bool)
    if spec == "timestamp_or_null":
        if value is None:
            return True
        if not isinstance(value, str) or "T" not in value:
            return False
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return True
        except ValueError:
            return False
    return False


def leaves(value, prefix=""):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from leaves(child, prefix + ("." if prefix else "") + str(key))
    elif isinstance(value, list):
        for child in value:
            yield from leaves(child, prefix + "[]")
    else:
        yield prefix, value


def check_object(row, profile=None, root_tenant=False, property_roles=None):
    """Return paths and reason codes only; never echo material or personal values.

    profile.judged contains type constants. row.judged contains row values.
    This validator reports issues and never edits or removes input fields.
    """
    profile = profile or {}
    property_roles = property_roles or {}
    errors, review = [], []
    def issue(path, code):
        errors.append(dict(path=path, code=code))
    interfaces = row.get("interfaces")
    if not isinstance(interfaces, list) or not interfaces or any(not isinstance(i, str) or i not in ROW for i in interfaces):
        issue("interfaces", "invalid_interface_list")
        return dict(valid=False, errors=errors, review=[])
    if len(set(interfaces)) != len(interfaces):
        issue("interfaces", "duplicate_interface")
    ids = row.get("identifiers") or {}
    primary = ids.get("primary")
    if (not isinstance(primary, list) or not primary or not all(
            isinstance(k, str) and isinstance(ids.get(k), dict) and ids[k].get("value") not in (None, "") for k in primary)):
        issue("identifiers.primary", "missing_identity_material")
    judged, constants = row.get("judged") or {}, profile.get("judged") or {}
    for iface in sorted(set(interfaces)):
        for field, spec in ROW[iface].items():
            if field not in judged:
                issue("judged."+field, "row_value_missing")
            elif not matches(judged[field], spec):
                issue("judged."+field, "invalid_row_value")
        for field, spec in PROFILE[iface].items():
            if field not in constants:
                issue("profile.judged."+field, "profile_constant_missing")
            elif not matches(constants[field], spec):
                issue("profile.judged."+field, "invalid_profile_constant")
            if field in judged:
                issue("judged."+field, "profile_constant_in_row")
    tenant = (row.get("references") or {}).get("tenant")
    if not root_tenant or "Tenant" not in interfaces or "Integration" in interfaces:
        if not isinstance(tenant, dict) or len(tenant.get("targets") or []) != 1:
            issue("references.tenant", "exactly_one_tenant_required")
    if "Credential" in interfaces and judged.get("material_location") == "none":
        review.append(dict(path="judged.material_location", code="reconsider_credential_interface"))
    if "Assignment" in interfaces and "Credential" in interfaces:
        review.append(dict(path="judged.expires_at", code="shared_expiry_must_describe_same_fact"))
    props = row.get("properties") or {}
    for path, value in leaves(props):
        name = path.rsplit(".", 1)[-1].replace("[]", "")
        if (name in HIDE or path.replace("[]", "").endswith("_embedded.activation.challenge")
                or isinstance(value, str) and TOKEN.search(value)):
            issue("properties."+path, "credential_material_must_be_redacted")
        if "Integration" in interfaces:
            if isinstance(value, str) and re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", value):
                issue("properties."+path, "integration_url_requires_routing")
    # Role declarations come from the source mapping, not an English-name guess.
    # Empty permission lists still need routing; ordinary scope enums do not.
    if "Integration" in interfaces:
        for path, role in property_roles.items():
            value, exists = props, True
            for part in path.split("."):
                if not isinstance(value, dict) or part not in value:
                    exists = False
                    break
                value = value[part]
            if exists and role == "permission_list":
                issue("properties."+path, "permissions_belong_in_relation")
            if exists and role == "url":
                issue("properties."+path, "integration_url_requires_routing")
    def jwk_material(value, path=""):
        if isinstance(value, dict):
            if "kty" in value:
                for field in ("n", "e", "x5c"):
                    if field in value:
                        issue("properties."+path+("." if path else "")+field, "credential_material_must_be_redacted")
            for key, child in value.items():
                jwk_material(child, path+("." if path else "")+key)
        elif isinstance(value, list):
            for child in value:
                jwk_material(child, path+"[]")
    jwk_material(props)
    # Do not infer row fields from a type label, a display name, or missing data.
    unique = lambda rows: sorted({(r["path"], r["code"]) for r in rows})
    return dict(valid=not errors, errors=[dict(path=p, code=c) for p, c in unique(errors)],
                review=[dict(path=p, code=c) for p, c in unique(review)])


def audit():
    manifest = sources()
    result, summary = {}, {}
    for provider in PROVIDERS:
        base = HERE / "out2" / provider
        judgements = json.loads((base / "iface/judgement.json").read_text(encoding="utf-8"))
        info = json.loads((base / "map/info_map.json").read_text(encoding="utf-8"))
        rows = []
        grouped = collections.defaultdict(list)
        for item in info["items"]:
            if item["det"].startswith("space:"):
                grouped[item["det"][6:]].append(item)
        for name, judgement in sorted(judgements.items()):
            if judgement["verdict"] != "object":
                continue
            interfaces = sorted(judgement["interfaces"])
            requirements, findings = {}, []
            for iface in interfaces:
                requirements[iface] = dict(row=ROW[iface], profile=PROFILE[iface])
            items = grouped.get(name, [])
            if "Integration" in interfaces:
                for item in items:
                    path = item["rel"]
                    leaf = path.rsplit(".", 1)[-1].replace("[*]", "")
                    if leaf in HIDE:
                        findings.append(dict(field=path, action="redact", reason="material_field_in_source"))
                    elif leaf in ("scope", "scopes", "permissions", "privileges"):
                        findings.append(dict(field=path, action="relation", reason="permission_field_requires_routing"))
                    elif item["kind"] in ("ref_url", "embedded_ref"):
                        findings.append(dict(field=path, action="reference_or_endpoint_review", reason="source_reference_not_raw_property"))
            if "Assignment" in interfaces and judgement["interfaces"]["Assignment"].get("by") == "rule":
                findings.append(dict(field="interfaces.Assignment", action="review", reason="link_record_alone_does_not_prove_permission_assignment"))
            rows.append(dict(space=name, interfaces=interfaces, requirements=requirements, source_routing=findings,
                             contract_status="requires_projected_row", model_status=judgement["model_status"]))
        result[provider] = rows
        summary[provider] = dict(objects=len(rows), row_contracts_checked=0,
                                 source_routing_obligations=sum(len(r["source_routing"]) for r in rows),
                                 pending_model=sum(v["model_status"] != "ready" for v in judgements.values()),
                                 undecided_scored=sum(v["verdict"] == "undecided" and v["model_status"] == "ready" for v in judgements.values()))
    output = dict(source_manifest=manifest, summary=summary, objects=result,
                  limitation="type audit only; uncollected Object rows are not marked contract-compliant")
    out = HERE / "out2"
    (out / "iface_contract_audit.json").write_text(json.dumps(output, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    lines = ["# Interface 계약 점검", "", "타입 수준의 필수 필드와 분리 과제다. 실제 Object 행의 계약 통과 수는 0개이며 미수집을 통과로 세지 않는다.", "",
             "| provider | 객체 판정 | 모델 응답 대기 | 판정 후 미정 | 원본 필드 분리 과제 |", "| --- | --- | --- | --- | --- |"]
    lines += [f"| {p} | {r['objects']} | {r['pending_model']} | {r['undecided_scored']} | {r['source_routing_obligations']} |" for p,r in summary.items()]
    (out / "iface_contract_audit.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    return summary


if __name__ == "__main__":
    print(json.dumps(audit(), sort_keys=True))
