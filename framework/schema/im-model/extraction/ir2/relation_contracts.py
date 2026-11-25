"""Source-transcribed relation recipes, separate from direct ID-space pairs.

No network, model calls, credentials, or production graph writes. The contract
describes a transformation; it is not evidence that tenant records were read.
Run after rel_audit.py to write out2/relation_resolution.json and a Markdown ledger.
"""
from __future__ import annotations

import ast
import collections
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT = HERE / "collect/carto/snapshot"


def recipe(category, operator, inputs, rule, guards, intel, functions, **extra):
    return dict(category=category, operator=operator, inputs=inputs, rule=rule,
                guards=guards, intel=intel, functions=functions.split(), **extra)


# Exact Cartography class names are lookup keys, never a name-similarity rule.
RECIPES = {}


def put(classes, spec):
    for cls in classes.split():
        if cls in RECIPES:
            raise ValueError(f"duplicate recipe: {cls}")
        RECIPES[cls] = spec


put("GitHubBranchProtectionRuleToRepositoryRel", recipe(
    "D", "context", ["github.branch_protection"],
    "BranchProtectionRule.id -> repository URL from the enclosing Repository query; REST protection is scoped by repository and branch.",
    ["Keep repository and branch context; do not treat branch protection as a global REST ID."],
    "github/repos.py", "_transform_branch_protection_rules"))
put("GitHubExternalIdentityToUserRel", recipe(
    "D", "project", ["github.external_identities"],
    "(organization URL, ExternalIdentity.id) -> ExternalIdentity.user.url",
    ["SCIM User and GraphQL ExternalIdentity are not interchangeable.", "Omit null/unlinked user."],
    "github/external_identities.py", "transform_external_identities"))
put("GitHubTeamChildTeamMemberOfRel GitHubTeamChildTeamRel", recipe(
    "D", "project", ["github.teams"],
    "childTeams.nodes.url -> parent Team.url",
    ["Organization teams only, preserving Q1.", "MEMBER_OF_TEAM is a deprecated alias of MEMBER_OF; count one semantic relation."],
    "github/teams.py", "transform_teams", alias_group="github.child_team"))
put("ProgrammingLanguageToRepositoryRel", recipe(
    "D", "project", ["github.languages"],
    "Repository.languages.nodes.name -> Repository.url (REST equivalent: language response object keys, not the byte counts)",
    ["Language.name is a dictionary key; Language.id is not necessary."],
    "github/repos.py", "_transform_repo_languages"))
put("GitHubRulesetRuleToRulesetRel", recipe(
    "D", "project", ["github.rulesets"],
    "RepositoryRule.id -> RepositoryRuleset.id; REST rules[] uses (ruleset context, index, content hash) as a snapshot-local key.",
    ["Never map the whole ruleset response to a rule.", "REST synthesized rule identity can change on reorder; no continuity claim."],
    "github/repos.py", "_normalize_rest_ruleset_rule_id _transform_rulesets"))
put("DependencyGraphManifestToRepositoryRel", recipe(
    "D", "project", ["github.dependency_manifests"],
    "(repository URL, manifest.blobPath) -> repository URL",
    ["Preserve repository and revision context; blobPath alone is not an ID."],
    "github/repos.py", "_transform_dependency_manifests"))
put("DependencyGraphManifestToDependencyRel GitHubDependencyToRepositoryRel", recipe(
    "D", "project", ["github.dependency_manifests"],
    "manifest.dependencies.nodes -> (ecosystem, canonical package name, requirements); attach manifest and repository context",
    ["Do not merge different package ecosystems.", "A requirement range is not an exact version.", "Upstream legacy dependency ID omits ecosystem; our typed key retains it."],
    "github/repos.py", "_transform_dependency_graph _canonicalize_dependency_name"))
put("GoogleWorkspaceGroupToGroupMemberRel GoogleWorkspaceGroupToGroupOwnerRel", recipe(
    "D", "conditional_project", ["gws.groups", "gws.memberships"],
    "GROUP membership preferredMemberKey.id email joins Group.groupKey.id in the same customer; OWNER role -> OWNER_OF, otherwise MEMBER_OF",
    ["Use explicit type GROUP; never guess USER when type is absent.", "Resolve email aliases uniquely within customer.", "Upstream group OWNER_OF does not also emit MEMBER_OF."],
    "googleworkspace/groups.py", "transform_groups"))
put("GoogleWorkspaceGroupToGroupInheritedMemberRel", recipe(
    "D", "reachability", ["gws.group_edges"],
    "MEMBER_OF followed by MEMBER_OF+ (path length >= 2)",
    ["Cycle-safe traversal, no self result.", "No cross-customer traversal.", "Retain direct and inherited as distinct evidence when both paths exist."],
    "googleworkspace/groups.py", "get_group_inherited_member_relationships"))
put("GoogleWorkspaceGroupToGroupInheritedOwnerRel", recipe(
    "D", "reachability", ["gws.group_edges"],
    "OWNER_OF followed by MEMBER_OF+; only the first edge is OWNER_OF",
    ["Do not propagate arbitrary OWNER_OF chains.", "Cycle-safe traversal, no self result, same customer only."],
    "googleworkspace/groups.py", "get_group_inherited_owner_relationships"))
put("GoogleWorkspaceUserToDeviceRel", recipe(
    "D", "join", ["gws.devices", "gws.device_users", "gws.users"],
    "APPROVED DeviceUser.name parent devices/{id} joins Device.name; DeviceUser.userEmail joins User primaryEmail/aliases",
    ["Device.name resource identifier differs from deviceId.", "Upstream keeps the first approved user; without proven ordering multiple distinct owners are ambiguous."],
    "googleworkspace/devices.py", "transform_devices"))
put("GoogleWorkspaceUserToOAuthAppRel", recipe(
    "D", "project", ["gws.oauth_tokens"],
    "directory.tokens.list request userKey -> Token.clientId, with scopes on the authorization edge",
    ["Token is an authorization record, not an OAuthApp identity.", "Do not read or persist access-token material."],
    "googleworkspace/oauth_apps.py", "get_oauth_tokens_for_user transform_oauth_apps_and_authorizations"))
put("JiraGroupAdminRel", recipe(
    "D", "filtered_context", ["jira.admin_groups"],
    "GET group/bulk?accessType=admin or site-admin, groupId -> current tenant",
    ["mypermissions only checks the caller; it cannot identify administrator groups.", "Keep accessType and pagination completeness as evidence."],
    "jira/access.py", "get transform"))
put("OktaReplyUriToOktaApplicationRel", recipe(
    "D", "project", ["okta.applications"],
    "Application.settings.oauthClient.redirect_uris[] exact URI -> Application.id",
    ["Do not normalize URI paths, queries, or trailing slash.", "URI is a value node, not an independently collected API entity."],
    "okta/applications.py", "_transform_okta_reply_uris"))
put("SalesforceConnectedAppToUserRel", recipe(
    "D", "name_join", ["salesforce.apps", "salesforce.oauth_tokens"],
    "ConnectedApplication.Name = OauthToken.AppName; OauthToken.UserId -> User.Id",
    ["Exact name join in one org and snapshot.", "Duplicate app names are ambiguous; do not fan out.", "Renames break this join; it is not a stable ID reference."],
    "salesforce/connectedapps.py", "get_apps get_oauth_tokens transform"))
put("GitHubActionToWorkflowRel", recipe(
    "E", "parse_workflow", ["github.workflow_files"],
    "Parse job-level/step-level uses -> Action identity -> workflow context",
    ["Local action identity includes repository.", "Do not evaluate expressions or execute workflow code.", "Dynamic uses stays unresolved."],
    "github/actions.py", "get_workflow_content transform_actions"))
put("GitHubWorkflowToSecretRel", recipe(
    "E", "parse_workflow", ["github.workflow_files", "github.secret_metadata"],
    "Parse literal secrets.NAME and secrets['NAME']; join visible secret metadata by workflow scope and name",
    ["Secret names only; no secret value.", "Same name in org/repo/environment requires visibility and precedence; no indiscriminate fan-out.", "Dynamic index stays unresolved."],
    "github/actions.py", "enrich_workflow_with_parsed_content"))
put("GitHubCodeOwnerRuleToTeamRel GitHubCodeOwnerRuleToUserRel GitHubRepositoryToCodeOwnerRuleRel DependencyGraphManifestToCodeOwnerRuleMatchLink", recipe(
    "E", "parse_codeowners", ["github.codeowners_files", "github.owner_inventory", "github.dependency_manifests"],
    "Select .github/CODEOWNERS then CODEOWNERS then docs/CODEOWNERS for the same ref; rule identity includes repository/file/line; last matching rule wins",
    ["An empty owner list overrides earlier owners.", "Resolve users/teams uniquely with write access and visibility.", "Unsupported patterns and unknown owners are diagnostics, not guessed links."],
    "github/codeowners.py", "parse_codeowners_content get_effective_codeowners_file match_codeowner_rule_for_path build_manifest_codeowner_matches"))
put("GitHubPythonLibraryToRepositoryRel", recipe(
    "E", "parse_requirements", ["github.python_dependency_files"],
    "requirements.txt, setup.cfg or supported lockfile -> Python distribution coordinate -> repository context",
    ["Keep requirement/specifier/source and revision; unpinned requirements are not exact versions.", "Do not execute setup.py, install dependencies or follow URLs."],
    "github/repos.py", "_transform_requirements_txt _transform_setup_cfg_requirements _transform_python_requirements"))
put("GitHubContainerImageContainsImageRel", recipe(
    "E", "oci_index", ["oci.manifests"],
    "OCI index digest -> manifests[].digest excluding attestation-manifest descriptors",
    ["Validate manifest digest against raw bytes.", "Do not equate digest and package-version ID."],
    "github/container_images.py", "transform_container_images"))
put("GitHubContainerImageToLayerRel GitHubContainerImageToHeadLayerRel GitHubContainerImageToTailLayerRel GitHubContainerImageLayerToNextRel", recipe(
    "E", "oci_layers", ["oci.manifests", "oci.configs"],
    "config.rootfs.diff_ids in order -> HAS_LAYER/all, HEAD/first, TAIL/last, NEXT/adjacent",
    ["diff_id is the uncompressed layer key, distinct from compressed layers[].digest.", "Align layer count and config descriptor digest.", "empty_layer history does not consume a diff_id."],
    "github/container_images.py", "transform_container_images transform_container_image_layers"))
put("GitHubContainerImageToPackageRel GitHubContainerImageTagToPackageRel GitHubContainerImageTagToImageRel", recipe(
    "E", "registry_coordinates", ["github.package_versions", "oci.manifests"],
    "Registry repository/package URI, tag URI, and manifest digest form separate typed identities; metadata carries package context",
    ["Tag is mutable; retain observation snapshot.", "Package version ID is not an image digest or tag URI."],
    "github/container_images.py", "get_container_images transform_container_images"))
put("GitHubContainerImageAttestationAttestsRel", recipe(
    "E", "attestation_subject", ["github.attestations", "oci.manifests"],
    "Attestation ID scoped by org/digest/predicate/index -> subject image digest",
    ["Bind subject to requested digest; decoding DSSE is not signature verification.", "Upstream inline bundle only; bundle_url follow-up is required for lazy bundles."],
    "github/container_image_attestations.py", "transform_attestations"))
put("GitHubContainerImageToParentImageRel", recipe(
    "E", "external_match", ["oci.parent_evidence", "oci.manifests"],
    "Explicit parent_image_digest from verified provenance or separately scored history analysis -> existing parent image",
    ["OCI layer order alone does not prove a base image.", "Pinned GitHub attestation transformer sets parent_image_digest=None; schema declaration alone produces no BUILT_FROM."],
    "github/container_image_attestations.py", "transform_attestations", upstream_producer="not_populated_by_attestation_transform"))
put("GitHubRepoProvenancePackagedFromMatchLink", recipe(
    "E", "external_match", ["oci.image_inventory", "github.repositories"],
    "Image.source_uri exact repository URL -> GitHubRepository.url",
    ["Keep provenance origin and verification status; signature verification is separate.", "Only link existing, uniquely identified repository."],
    "github/supply_chain.py", "sync"))
put("ImagePackagedByWorkflowMatchLink", recipe(
    "E", "external_match", ["oci.image_inventory", "github.workflows"],
    "(Image.invocation_uri, Image.invocation_workflow) = (Workflow.repo_url, Workflow.path)",
    ["Both repository URL and workflow path must match in one observation scope."],
    "github/supply_chain.py", "sync"))
put("GitHubRepoDockerfilePackagedFromMatchLink", recipe(
    "E", "scored_match", ["oci.image_history", "github.dockerfiles", "github.repositories"],
    "Compare nonempty build history with Dockerfile commands and preserve match_method/confidence/matched_commands/total_commands",
    ["A similarity match is model/heuristic evidence, not a stated ID reference.", "Retain threshold and competing candidates; do not silently choose a repository."],
    "github/supply_chain.py", "get_unmatched_container_images_with_history sync"))
put("GitHubRepoPackageOwnerPackagedFromMatchLink", recipe(
    "E", "external_match", ["oci.image_inventory", "github.package_repository_links"],
    "Explicit package.repository metadata joins digest-associated package to repository",
    ["Package owner organization alone is insufficient to select one repository.", "Only fallback when this snapshot has no higher-priority match and exactly one repository owns the package.", "Keep match_method=package_owner and upstream confidence=0.6; ownership does not prove build source."],
    "github/supply_chain.py", "_get_unmatched_ghcr_image_owner_repos sync"))
put("OktaLogStreamToAWSAccountRel", recipe(
    "E", "external_match", ["okta.log_streams", "aws.accounts"],
    "OktaLogStream.settings.accountId -> existing AWSAccount.id",
    ["AWS account is a separate inventory and identity namespace.", "Non-AWS stream or absent accountId creates no AWS link."],
    "okta/log_streams.py", "_transform_okta_log_streams"))
put("OktaGroupToAWSRoleHasRoleMatchLink OktaGroupToAWSRoleAllowedByMatchLink", recipe(
    "E", "configured_mapping", ["okta.aws_app_groups", "okta.aws_mapping_config", "aws.roles"],
    "Configured SAML group-name mapping or AWS SSO permission-set mapping -> existing AWS role ARN",
    ["Restrict to groups assigned to the AWS app in the same Okta org.", "Validate AWS partition/account/role against inventory.", "ALLOWED_BY is a deprecated alias of HAS_ROLE; count one semantic relation."],
    "okta/awssaml.py", "query_for_okta_to_aws_role_mapping transform_okta_group_to_aws_role", alias_group="okta.aws_role"))


# Collection contracts are concrete public API/file locators, not scheduled jobs.
INPUTS = {
    "github.branch_protection": "Repository.branchProtectionRules.nodes with enclosing repository URL, or GET /repos/{owner}/{repo}/branches/{branch}/protection",
    "github.external_identities": "Organization.samlIdentityProvider.externalIdentities.nodes { id user { url } }",
    "github.teams": "Organization.teams.nodes { url childTeams { nodes { url } } }",
    "github.languages": "Repository.languages.nodes { name }, or GET /repos/{owner}/{repo}/languages",
    "github.rulesets": "Repository.rulesets.nodes { id rules { nodes { id type parameters } } }, or REST rulesets/{ruleset_id}",
    "github.dependency_manifests": "Repository.dependencyGraphManifests.nodes { blobPath dependencies { nodes { packageName packageManager requirements packageUrl } } }",
    "github.workflow_files": "GET /repos/{owner}/{repo}/contents/{workflow_path}?ref={commit}; preserve workflow ID, repository, ref and content digest",
    "github.secret_metadata": "Actions org/repo/environment secrets LIST metadata and visibility; names/IDs only",
    "github.codeowners_files": "GET contents/{.github/CODEOWNERS,CODEOWNERS,docs/CODEOWNERS}?ref={commit}; record 404 versus failed/incomplete reads",
    "github.owner_inventory": "Users and visible teams plus repository write-access evidence, scoped owner/name aliases",
    "github.python_dependency_files": "Repository requirements.txt/setup.cfg/uv.lock/package lock content at a pinned ref",
    "github.package_versions": "GET /orgs/{org}/packages/container/{package_name}/versions, preserving package URI, version.name digest and metadata.container.tags",
    "github.attestations": "GET /orgs/{org}/attestations/{subject_digest}; inline DSSE bundle or explicitly collected bundle_url content",
    "github.repositories": "Repository URL and stable API identity inventory",
    "github.workflows": "GET /repos/{owner}/{repo}/actions/workflows with repository URL and workflow path",
    "github.dockerfiles": "Dockerfile content at known repository/ref/path; do not execute build commands",
    "github.package_repository_links": "Package.repository metadata and version-to-package association",
    "oci.manifests": "GET registry /v2/{repository}/manifests/{digest}; raw bytes, mediaType, manifest/index descriptors, registry repository context",
    "oci.configs": "GET registry /v2/{repository}/blobs/{config_digest}; raw bytes plus rootfs.diff_ids and history",
    "oci.parent_evidence": "Independent parent image provenance or a scored base-image matcher output; GitHub attestation transform currently does not populate this field",
    "oci.image_inventory": "Existing Image digest/URI plus source_uri, invocation_uri and invocation_workflow, with evidence source and verification status",
    "oci.image_history": "Verified OCI config history, retaining empty_layer flags and ordered nonempty commands",
    "gws.groups": "cloudidentity.groups.list group name and groupKey.id; Directory equivalent aliases need same-customer resolution",
    "gws.memberships": "cloudidentity.groups.memberships.list with parent group context, type, preferredMemberKey.id and roles[].name",
    "gws.group_edges": "Completed, customer-scoped MEMBER_OF/OWNER_OF graph from direct membership inputs",
    "gws.devices": "cloudidentity.devices.list with name and deviceId",
    "gws.device_users": "cloudidentity.devices.deviceUsers.list with name,userEmail,managementState and ordering evidence",
    "gws.users": "directory.users.list with id,primaryEmail,aliases and customer context",
    "gws.oauth_tokens": "directory.tokens.list(userKey); preserve request userKey, response clientId and scopes, no access-token values",
    "jira.admin_groups": "GET /rest/api/3/group/bulk?accessType=admin and accessType=site-admin, all pages with current tenant context",
    "okta.applications": "GET /api/v1/apps { id settings.oauthClient.redirect_uris }",
    "okta.log_streams": "GET /api/v1/logStreams { id type settings.accountId }",
    "okta.aws_app_groups": "Groups assigned to amazon_aws/AWS SSO application in this Okta org",
    "okta.aws_mapping_config": "Organization-specific mapping regex/configuration or AWS SSO permission-set mapping, explicitly provided (never infer naming convention)",
    "aws.accounts": "Existing AWS account inventory keyed by 12-digit account ID",
    "aws.roles": "Existing AWS IAM role inventory keyed by full ARN including partition and role path",
    "salesforce.apps": "SELECT Id,Name FROM ConnectedApplication",
    "salesforce.oauth_tokens": "SELECT Id,AppName,UserId FROM OauthToken (metadata, no credential value)",
}


def checked_sources():
    manifest = json.loads((HERE / "collect/carto/snapshot_manifest.json").read_text(encoding="utf-8"))
    result = {}
    for row in manifest["files"]:
        path = SNAPSHOT / row["path"]
        if not path.resolve().is_relative_to(SNAPSHOT.resolve()):
            raise ValueError("source path outside snapshot")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise ValueError(f"source hash mismatch: {row['path']}")
        tree = ast.parse(data.decode("utf-8")) if path.suffix == ".py" else ast.Module(body=[], type_ignores=[])
        result[row["path"]] = dict(row, definitions={
            n.name: n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))})
    # Salesforce was collected in the previous B/C investigation at the same commit.
    facts = json.loads((HERE / "source_reference_facts.json").read_text(encoding="utf-8"))
    ev = facts["derived_relations"][0]["evidence"]
    data = (HERE / ev["file"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != ev["sha256"]:
        raise ValueError("Salesforce source hash mismatch")
    result["cartography/intel/salesforce/connectedapps.py"] = dict(
        path=ev["file"], sha256=ev["sha256"], url=ev["url"], definitions={
            n.name: n for n in ast.parse(data.decode("utf-8")).body if isinstance(n, ast.FunctionDef)})
    return result


def evidence(src, name):
    node = src["definitions"].get(name)
    if node is None:
        raise ValueError(f"missing source definition {src['path']}:{name}")
    return {k: src[k] for k in ("path", "sha256", "url")} | dict(
        locator=name, start=node.lineno, end=node.end_lineno)


def build(audit=None):
    from rel_audit import carto_rels, PROV
    sources = checked_sources()
    classes = {name: src for src in sources.values() for name, node in src["definitions"].items()
               if isinstance(node, ast.ClassDef) and "/models/" in src["path"]}
    if audit is None:
        audit = json.loads((HERE / "out2/rel_audit.json").read_text(encoding="utf-8"))
    rows, seen = [], set()
    for mod, a, label, b, cls in carto_rels():
        if cls not in RECIPES:
            continue
        p = PROV[mod]
        spec = RECIPES[cls]
        ev = [evidence(classes[cls], cls)]
        src = sources["cartography/intel/" + spec["intel"]]
        ev += [evidence(src, name) for name in spec["functions"]]
        class_node = classes[cls]["definitions"][cls]
        direction = next((ast.unparse(n.value).rsplit(".", 1)[-1] for n in class_node.body
                          if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
                          and n.target.id == "direction"), None)
        if direction not in ("INWARD", "OUTWARD"):
            raise ValueError(f"missing direction: {cls}")
        for inp in spec["inputs"]:
            if inp not in INPUTS:
                raise ValueError(f"unregistered input: {inp}")
        seen.add(cls)
        local = {
            "GoogleWorkspaceGroupToGroupInheritedMemberRel": "inherited_groups(owner=False)",
            "GoogleWorkspaceGroupToGroupInheritedOwnerRel": "inherited_groups(owner=True)",
            "GoogleWorkspaceUserToOAuthAppRel": "oauth_authorizations",
            "SalesforceConnectedAppToUserRel": "salesforce_authorizations",
            "JiraGroupAdminRel": "jira_admin_groups",
            "OktaReplyUriToOktaApplicationRel": "reply_uris",
            "GitHubActionToWorkflowRel": "workflow_references (references only)",
            "GitHubWorkflowToSecretRel": "workflow_references (names only; metadata join still required)",
            "GitHubContainerImageContainsImageRel": "oci_structure",
            "GitHubContainerImageToLayerRel": "oci_structure",
            "GitHubContainerImageToHeadLayerRel": "oci_structure",
            "GitHubContainerImageToTailLayerRel": "oci_structure",
            "GitHubContainerImageLayerToNextRel": "oci_structure",
        }.get(cls)
        rows.append(dict(provider=p, source=a, label=label, target=b, **{"class": cls},
                         direction=direction, **spec, evidence=ev,
                         local_operator=local, implementation_status="local_operator" if local else "collection_contract",
                         definition_status="source_backed", observation_status="not_collected"))
    if seen != set(RECIPES):
        raise ValueError(f"recipes absent from baseline: {sorted(set(RECIPES)-seen)}")
    missing = [(p, r["class"]) for p, rr in audit.items() for r in rr
               if r.get("kind") != "tenant" and r["status"] != "found" and r["class"] not in seen]
    if missing:
        raise ValueError(f"unclassified relations: {missing}")
    counts = collections.Counter(r["category"] for r in rows)
    return dict(version=1, method="source_transcription", recipes=rows,
                summary=dict(contracts=len(rows), categories=dict(sorted(counts.items())),
                             direct_pair_found=sum(r["status"] == "found" for rr in audit.values()
                                                   for r in rr if r.get("kind") != "tenant"),
                             unclassified=len(missing), observed_relations=None),
                collection_plan=[dict(id=k, locator=v, status="not_collected") for k, v in sorted(INPUTS.items())])


def main():
    result = build()
    out = HERE / "out2"
    (out / "relation_resolution.json").write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    lines = ["# 남은 relation 처리 대장", "", "정의와 생성 규칙의 조사 결과다. 실측 관계 수가 아니다. 실제 입력 수집은 not_collected로 표시한다.", "",
             "| provider | 관계 클래스 | 원인 | 연산 | 규칙 |", "| --- | --- | --- | --- | --- |"]
    for r in result["recipes"]:
        lines.append(f"| {r['provider']} | {r['class']} | {r['category']} | {r['operator']} | {r['rule']} |")
    lines += ["", "## 수집 입력", "", "| 입력 | 수집 위치 | 상태 |", "| --- | --- | --- |"]
    lines += [f"| {r['id']} | {r['locator']} | {r['status']} |" for r in result["collection_plan"]]
    (out / "relation_resolution.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    print(json.dumps(result["summary"], sort_keys=True))


if __name__ == "__main__":
    main()
