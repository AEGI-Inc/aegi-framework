# -*- coding: utf-8 -*-
"""Cartography 노드가 정보 지도의 ID 공간에 닿는지 조사한다 (2026-10-18).

    python carto_audit.py          # out2/carto_audit.json

기준: cartography-cncf/cartography main d994439 (2026-10-16) 의 models/<provider>/*.py 노드 선언과
intel/<provider>/*.py 가 부르는 API. 노드마다 수집 API 를 손으로 적었다 (아래 NODES, 근거 파일 함께).
노드와 공간은 이름이 아니라 수집 API 로 잇는다. object_audit.Matcher 와 같은 규칙이다:
REST 는 메서드와 경로 틀, Slack 과 Google 은 메서드 id, GitHub GraphQL 은 SDL 타입 이름, Salesforce 는 sObject API 이름.
API 응답이 아니라 파일 내용을 파싱해 만든 노드는 derived 로 따로 센다. 판정이 아니라 조사용이다.
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from object_audit import Matcher   # noqa: E402

# (노드 라벨, Cartography id 필드, 수집 API 목록, 근거 intel 파일, derived 이유 또는 None)
NODES = {
    "slack": [
        ("SlackTeam", "id", ["auth.teams.list", "team.info"], "teams.py", None),
        ("SlackUser", "id", ["users.list"], "users.py", None),
        ("SlackBot", "id", ["users.list"], "users.py (is_bot 또는 is_app_user 인 회원)", None),
        ("SlackChannel", "id", ["conversations.list", "conversations.members"], "channels.py", None),
        ("SlackGroup", "id", ["usergroups.list"], "groups.py", None),
    ],
    "github": [
        ("GitHubOrganization", "url", ["GraphQL Organization", "GET /orgs/{org}"], "organizations.py", None),
        ("GitHubUser", "html_url", ["GraphQL User"], "users.py", None),
        ("GitHubTeam", "url", ["GraphQL Team"], "teams.py", None),
        ("GitHubRepository", "id", ["GraphQL Repository", "GET /orgs/{org}/repos"], "repos.py", None),
        ("GitHubBranch", "id", ["GraphQL Ref"], "repos.py (defaultBranchRef)", None),
        ("GitHubBranchProtectionRule", "id", ["GraphQL BranchProtectionRule"], "repos.py", None),
        ("GitHubRuleset", "id", ["GET /repos/{owner}/{repo}/rulesets/{ruleset_id}"], "repos.py", None),
        ("GitHubRulesetRule", "id", ["GraphQL RepositoryRule"], "repos.py (REST rules[]에는 합성키를 부여)", None),
        ("GitHubWebhook", "id", ["GET /orgs/{org}/hooks", "GET /repos/{owner}/{repo}/hooks"], "webhooks.py", None),
        ("GitHubAppInstallation", "id", ["GET /orgs/{org}/installations"], "app_installations.py", None),
        ("GitHubPersonalAccessToken", "id", ["GET /orgs/{org}/personal-access-tokens", "GET /orgs/{org}/credential-authorizations"],
         "personal_access_tokens.py", None),
        ("GitHubExternalIdentity", "id", ["GraphQL ExternalIdentity"], "external_identities.py", None),
        ("GitHubEnvironment", "id", ["GET /repos/{owner}/{repo}/environments"], "repos.py", None),
        ("GitHubActionsSecret", "id", ["GET /orgs/{org}/actions/secrets", "GET /repos/{owner}/{repo}/actions/secrets",
                                       "GET /repos/{owner}/{repo}/environments/{environment_name}/secrets"], "actions.py", None),
        ("GitHubActionsVariable", "id", ["GET /orgs/{org}/actions/variables", "GET /repos/{owner}/{repo}/actions/variables",
                                         "GET /repos/{owner}/{repo}/environments/{environment_name}/variables"], "actions.py", None),
        ("GitHubWorkflow", "id", ["GET /repos/{owner}/{repo}/actions/workflows"], "actions.py", None),
        ("GitHubDependabotAlert", "id", ["GET /orgs/{org}/dependabot/alerts"], "dependabot_alerts.py", None),
        ("GitHubDependencyGraphManifest", "id", ["GraphQL DependencyGraphManifest"], "repos.py", None),
        ("GitHubDependency", "id", ["GraphQL DependencyGraphDependency"], "repos.py", None),
        ("GitHubPackage", "html_url", ["GET /orgs/{org}/packages"], "packages.py", None),
        ("GitHubContainerImage", "digest", [], "container_images.py", "OCI manifest digest, package-version ID와 별개"),
        ("GitHubContainerImageTag", "uri", [], "container_image_tags.py", "레지스트리 URI와 tag의 조합, package-version ID와 별개"),
        ("GitHubContainerImageAttestation", "id", ["GET /orgs/{org}/attestations/{subject_digest}"], "container_image_attestations.py", None),
        ("GitHubOrganizationDomain", "id", ["GraphQL VerifiableDomain"], "organizations.py", None),
        ("ProgrammingLanguage", "language_name", ["GraphQL Language"], "repos.py", None),
        ("GitHubContainerImageLayer", "diff_id", [], "container_images.py", "ghcr.io 레지스트리 매니페스트에서 읽음 (GitHub API 밖)"),
        ("GitHubAction", "id", [], "actions.py, workflow_parser.py", "워크플로 파일의 uses: 줄을 파싱"),
        ("GitHubCodeOwnerRule", "id", [], "codeowners.py", "CODEOWNERS 파일 내용을 파싱"),
        ("PythonLibrary", "id", [], "lockfiles.py", "requirements, lockfile 내용을 파싱"),
    ],
    "okta": [
        ("OktaOrganization", "id", ["GET /api/v1/org"], "organization.py", None),
        ("OktaUser", "id", ["GET /api/v1/users"], "users.py", None),
        ("OktaUserType", "id", ["GET /api/v1/meta/types/user"], "users.py", None),
        ("OktaUserRole", "id", ["GET /api/v1/users/{userId}/roles"], "users.py", None),
        ("OktaGroup", "id", ["GET /api/v1/groups"], "groups.py", None),
        ("OktaGroupRule", "id", ["GET /api/v1/groups/rules"], "groups.py", None),
        ("OktaGroupRole", "id", ["GET /api/v1/groups/{groupId}/roles"], "groups.py", None),
        ("OktaApplication", "id", ["GET /api/v1/apps"], "applications.py", None),
        ("OktaUserFactor", "id", ["GET /api/v1/users/{userId}/factors"], "factors.py", None),
        ("OktaAuthenticator", "id", ["GET /api/v1/authenticators"], "authenticators.py", None),
        ("OktaDevice", "id", ["GET /api/v1/devices"], "devices.py", None),
        ("OktaApiToken", "id", ["GET /api/v1/api-tokens"], "api_tokens.py", None),
        ("OktaNetworkZone", "id", ["GET /api/v1/zones"], "network_zones.py", None),
        ("OktaLogStream", "id", ["GET /api/v1/logStreams"], "log_streams.py", None),
        ("OktaTrustedOrigin", "id", ["GET /api/v1/trustedOrigins"], "origins.py", None),
        ("OktaPolicy", "id", ["GET /api/v1/policies"], "policies.py", None),
        ("OktaPolicyRule", "id", ["GET /api/v1/policies/{policyId}/rules"], "policies.py", None),
        ("ReplyUri", "id", [], "applications.py", "앱 설정의 redirect_uris 값 하나하나를 노드로 만듦"),
    ],
    "gws": [
        ("GoogleWorkspaceTenant", "id", ["directory.customers.get"], "tenant.py", None),
        ("GoogleWorkspaceUser", "id", ["directory.users.list"], "users.py", None),
        ("GoogleWorkspaceGroup", "name", ["cloudidentity.groups.list"], "groups.py", None),
        ("GoogleWorkspaceDevice", "deviceId", ["cloudidentity.devices.list"], "devices.py", None),
        ("GoogleWorkspaceOAuthApp", "client_id", ["directory.tokens.list"], "oauth_apps.py", None),
    ],
    "jira": [
        ("JiraTenant", "id", ["GET /rest/api/3/serverInfo"], "access.py", None),
        ("JiraUser", "id", ["GET /rest/api/3/users/search"], "access.py", None),
        ("JiraGroup", "id", ["GET /rest/api/3/group/bulk"], "access.py", None),
        ("JiraProject", "id", ["GET /rest/api/3/project/search"], "access.py", None),
        ("JiraProjectRole", "id", ["GET /rest/api/3/project/{projectIdOrKey}/role/{id}"], "access.py", None),
        ("JiraPermissionGrant", "id", ["GET /rest/api/3/permissionscheme/{schemeId}"], "access.py (scheme 응답의 permissions[])", None),
    ],
    "salesforce": [
        ("SalesforceOrganization", "Id", ["sObject Organization"], "organization.py", None),
        ("SalesforceUser", "Id", ["sObject User"], "users.py", None),
        ("SalesforceProfile", "Id", ["sObject Profile"], "profiles.py", None),
        ("SalesforceUserRole", "Id", ["sObject UserRole"], "userroles.py", None),
        ("SalesforcePermissionSet", "Id", ["sObject PermissionSet", "sObject PermissionSetAssignment"], "permissionsets.py", None),
        ("SalesforceGroup", "Id", ["sObject Group", "sObject GroupMember"], "groups.py", None),
        ("SalesforceConnectedApp", "Id", ["sObject ConnectedApplication"], "connectedapps.py (OAuthToken은 별도 레코드, AppName으로 이름 조인)", None),
    ],
    # 기준: cartography-cncf/cartography main 86625aa (2026-11-20) 의 models/microsoft, intel/microsoft
    "m365": [
        ("AzureTenant", "id", ["GET /organization"], "entra/users.py L84", None),
        ("EntraUser", "id", ["GET /users"], "entra/users.py L112", None),
        ("EntraGroup", "id", ["GET /groups"], "entra/groups.py L53", None),
        ("EntraApplication", "id", ["GET /applications"], "entra/applications.py L52", None),
        ("EntraServicePrincipal", "id", ["GET /servicePrincipals"], "entra/service_principals.py L52", None),
        ("EntraAppRoleAssignment", "id", ["GET /servicePrincipals/{servicePrincipal-id}/appRoleAssignedTo"], "entra/app_role_assignments.py L80", None),
        ("EntraRoleDefinition", "id", ["GET /roleManagement/directory/roleDefinitions"], "entra/directory_roles.py L30-32", None),
        ("EntraRoleAssignment", "id", ["GET /roleManagement/directory/roleAssignments"], "entra/directory_roles.py L46-48", None),
        ("EntraDomain", "id", ["GET /domains"], "entra/domains.py L34", None),
        ("EntraOU", "id", ["GET /directory/administrativeUnits"], "entra/ou.py L30", None),
        ("IntuneManagedDevice", "id", ["GET /deviceManagement/managedDevices"], "intune/managed_devices.py L32", None),
        ("IntuneCompliancePolicy", "id", ["GET /deviceManagement/deviceCompliancePolicies"], "intune/compliance_policies.py L41", None),
        ("IntuneDetectedApp", "id", [], "intune/detected_apps.py L51,62; intune/reports.py L139 (Graph 대응 GET /deviceManagement/detectedApps -> 공간 microsoft.graph.detectedApp)", "POST /deviceManagement/reports/exportJobs 로 내보낸 zip 안 CSV(AppInvAggregate, AppInvRawData)를 파싱해 생성"),
        ("M365License", "id", ["GET /subscribedSkus"], "o365/licenses.py L27", None),
        ("M365ServicePlan", "id", [], "o365/licenses.py L67-90", "subscribedSkus[].servicePlans[] 에서 tenant_id:service_plan_id 합성 키로 파생"),
        ("DefenderMachine", "id", ["GET https://api.security.microsoft.com/api/machines"], "defender/machines.py L17 (MDE API)", None),
        ("DefenderAlert", "id", ["GET /security/alerts_v2"], "defender/alerts.py L16", None),
    ],
}


# GraphQL 로 수집하는 GitHub 노드의 같은 대상 REST 동작 (GraphQL 쪽 공간은 key_only 라 후보가 아니다, 루프 18 결정)
REST_EQUIV = {
    "GitHubOrganization": ["GET /orgs/{org}"],
    "GitHubUser": ["GET /users/{username}"],
    "GitHubTeam": ["GET /orgs/{org}/teams/{team_slug}"],
    "GitHubRepository": ["GET /repos/{owner}/{repo}"],
    "GitHubBranch": ["GET /repos/{owner}/{repo}/branches/{branch}"],
    "GitHubBranchProtectionRule": ["GET /repos/{owner}/{repo}/branches/{branch}/protection"],
    "GitHubExternalIdentity": [],  # SCIM User는 SAML ExternalIdentity의 같은 대상 근거가 아니다.
    "GitHubDependencyGraphManifest": ["GET /repos/{owner}/{repo}/dependency-graph/sbom"],
    "GitHubDependency": ["GET /repos/{owner}/{repo}/dependency-graph/sbom"],
    "GitHubOrganizationDomain": [],
    "ProgrammingLanguage": ["GET /repos/{owner}/{repo}/languages"],
    "GitHubDependabotAlert": ["GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}"],
}


def spaces_of(mt, apis):
    sp, ops = set(), []
    for a in apis:
        o = mt.ops_for(a)
        ops += o
        for oid in o:
            sp |= mt.spaces_for(oid)
    return sorted({s for _, s in sp}), ops


def audit(providers=None):
    out = {}
    targets = {p: NODES[p] for p in providers} if providers else NODES
    for p, nodes in targets.items():
        mt = Matcher(p)
        flags = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))["spaces"]
        rows = []
        for label, idf, apis, ev, derived in nodes:
            hits, ops = [], []
            for a in apis:
                if a.startswith("sObject "):
                    n = a.split()[1]
                    hits.append({"api": a, "ops": [], "spaces": [("sobject", n)] if n in flags else []})
                    continue
                o = mt.ops_for(a)
                sp = set()
                for oid in o:
                    if label == "JiraPermissionGrant":
                        # access.py는 scheme.permissions[]의 id를 사용한다. scheme 자체와 동일시하지 않는다.
                        slots = mt.m.path_slots(mt.m.resp(mt.m.ops[oid]), "permissions[*]")
                        for sid, prop in slots:
                            for pr in mt.m.shapes[sid].get("props") or []:
                                if pr["name"] == prop:
                                    sp |= {("response:permissions[*]", mt.m.shape_space[s]) for s in mt.m.obj(pr.get("shape"))
                                           if s in mt.m.shape_space}
                    else:
                        sp |= mt.spaces_for(oid)
                sp |= {("graphql", s) for s in mt.graphql_spaces(a)}
                ops += o
                hits.append({"api": a, "ops": o[:4], "spaces": sorted(sp)})
            spaces = sorted({s for h in hits for _, s in h["spaces"]})
            if derived:
                status = "derived"
            elif spaces:
                status = "space"
            elif not ops and not any(h["api"].startswith("sObject") for h in hits):
                status = "no_operation"
            else:
                status = "no_space"
            rest, _ = spaces_of(mt, REST_EQUIV.get(label, [])) if p == "github" else ([], [])
            rows.append({"node": label, "rest_equiv": [{"name": x, "form": flags[x]["form"]} for x in rest if x in flags], "id_field": idf, "evidence": ev, "derived": derived, "status": status, "apis": hits,
                         "spaces": [{"name": s, "form": flags[s]["form"], "object_candidate": flags[s].get("object_candidate", True)}
                                    for s in spaces if s in flags]})
        out[p] = rows
    out_name = "carto_audit_%s.json" % providers[0] if providers and len(providers) == 1 else "carto_audit.json"
    with io.open(os.path.join(HERE, "out2", out_name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    for p, rows in audit(args or None).items():
        print("==", p)
        for r in rows:
            print("  %-34s %-12s %s" % (r["node"], r["status"], ", ".join("%s(%s%s)" % (s["name"], s["form"], "" if s["object_candidate"] else ",후보아님")
                                                                         for s in r["spaces"])[:150]), "| REST:" + ",".join(x["name"] for x in r["rest_equiv"]) if r["rest_equiv"] else "")
