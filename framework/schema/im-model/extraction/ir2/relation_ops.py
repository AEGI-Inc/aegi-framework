"""Pure operators for the derived layer. No network or production writes.

The scope is (tenant, snapshot); a caller must supply both. Inputs are explicit
API projections, never arbitrarily matched names. File parsers return references
and diagnostics; they do not assert that a referenced object actually exists.
"""
from __future__ import annotations

from collections import defaultdict, deque
import hashlib
import json
import re

import yaml


def scope_of(row):
    scope = row.get("scope")
    if not isinstance(scope, (tuple, list)) or len(scope) != 2 or not all(isinstance(x, str) and x for x in scope):
        raise ValueError("scope must contain nonempty tenant and snapshot")
    return tuple(scope)


def unique_join(left, right, left_field, right_field, right_id="id"):
    """Many left rows -> one right identity, within the same tenant/snapshot.

    Ambiguous or absent keys produce a diagnostic instead of a Cartesian join.
    The caller chooses case/alias rules before calling; values are exact here.
    """
    index = defaultdict(set)
    for row in right:
        sc = scope_of(row)
        value, ident = row.get(right_field), row.get(right_id)
        if isinstance(value, str) and value and isinstance(ident, str) and ident:
            index[sc, value].add(ident)
    links, issues = [], []
    for row in left:
        sc = scope_of(row)
        value = row.get(left_field)
        if not isinstance(value, str) or not value:
            issues.append(dict(scope=sc, id=row.get("id"), reason="missing_join_key"))
            continue
        matches = index[sc, value]
        if len(matches) == 1:
            links.append(dict(scope=sc, source=row["id"], target=next(iter(matches))))
        else:
            issues.append(dict(scope=sc, id=row.get("id"), reason="ambiguous" if matches else "unmatched"))
    return sorted(links, key=lambda r: (r["scope"], r["source"], r["target"])), issues


def inherited_groups(edges, owner=False):
    """MEMBER_OF . MEMBER_OF+ or OWNER_OF . MEMBER_OF+, with witnesses.

    Each witness uses distinct edges, mirroring Cypher variable-length path
    semantics. Direct and inherited evidence may coexist. Self results omitted.
    """
    members = defaultdict(set)
    starts = set()
    for edge in edges:
        sc = scope_of(edge)
        a, b = edge["source"], edge["target"]
        if edge["label"] == "MEMBER_OF":
            members[sc, a].add(b)
        if edge["label"] == ("OWNER_OF" if owner else "MEMBER_OF"):
            starts.add((sc, a, b))
    result = {}
    for sc, a, b in sorted(starts):
        # Exclude the first MEMBER_OF edge from the repeated tail. Otherwise a
        # two-node cycle could manufacture an inherited copy of that same edge.
        forbidden = (a, b) if not owner else None
        queue = deque([(b, (a, b))])
        visited = {b}
        while queue:
            current, path = queue.popleft()
            for nxt in sorted(members[sc, current]):
                if (current, nxt) == forbidden:
                    continue
                if nxt != a:
                    result.setdefault((sc, a, nxt), path + (nxt,))
                if nxt not in visited:
                    visited.add(nxt)
                    queue.append((nxt, path + (nxt,)))
    return [dict(scope=sc, source=a, target=b,
                 label="INHERITED_OWNER_OF" if owner else "INHERITED_MEMBER_OF", witness=list(path))
            for (sc, a, b), path in sorted(result.items())]


def salesforce_authorizations(apps, token_metadata):
    # OauthToken has no ConnectedApplication FK. Do not keep credential fields.
    projected = [dict(scope=scope_of(r), id=r["Id"], AppName=r.get("AppName"), UserId=r.get("UserId"))
                 for r in token_metadata]
    links, issues = unique_join(projected, apps, "AppName", "Name", "Id")
    users = {(scope_of(r), r["id"]): r.get("UserId") for r in projected}
    result = {(tuple(r["scope"]), r["target"], users[tuple(r["scope"]), r["source"]]) for r in links
              if users[tuple(r["scope"]), r["source"]]}
    return [dict(scope=sc, source=u, target=a, label="AUTHORIZED", grade="derived_name_join")
            for sc, a, u in sorted(result)], issues


def oauth_authorizations(token_metadata):
    out, issues = set(), []
    for row in token_metadata:
        sc = scope_of(row)
        if not row.get("userKey") or not row.get("clientId"):
            issues.append(dict(scope=sc, reason="missing_request_context_or_client"))
            continue
        scopes = row.get("scopes") or []
        if not isinstance(scopes, list) or not all(isinstance(s, str) for s in scopes):
            raise ValueError("OAuth scopes must be a string list")
        out.add((sc, row["userKey"], row["clientId"], tuple(sorted(set(scopes)))))
    return [dict(scope=sc, source=u, target=c, label="AUTHORIZED", scopes=list(ss))
            for sc, u, c, ss in sorted(out)], issues


def reply_uris(apps):
    out = set()
    for row in apps:
        sc = scope_of(row)
        uris = ((row.get("settings") or {}).get("oauthClient") or {}).get("redirect_uris") or []
        if not isinstance(uris, list):
            raise ValueError("redirect_uris must be a list")
        for uri in uris:
            if not isinstance(uri, str) or not uri:
                raise ValueError("redirect URI must be a nonempty string")
            out.add((sc, row["id"], uri))
    return [dict(scope=sc, source=app, target=uri, label="REPLYURI") for sc, app, uri in sorted(out)]


def jira_admin_groups(responses):
    out = set()
    for response in responses:
        sc = scope_of(response)
        if response.get("accessType") not in ("admin", "site-admin") or response.get("complete") is not True:
            raise ValueError("requires complete admin/site-admin group/bulk snapshot")
        for group in response["groups"]:
            if not group.get("groupId"):
                raise ValueError("missing groupId")
            out.add((sc, group["groupId"], response["accessType"]))
    return [dict(scope=sc, source=g, target=sc[0], label="ADMIN_OF", accessType=t) for sc, g, t in sorted(out)]


def workflow_references(content, repository, workflow_id, scope):
    """Return literal action references and secret *names*, never secret values.

    Structured YAML traversal excludes comments. Only uses in jobs or steps is
    an action. Unresolved dynamic expressions are retained as reason codes only.
    """
    sc = scope_of(dict(scope=scope))
    if not isinstance(content, str) or len(content.encode("utf-8")) > 3_000_000:
        raise ValueError("workflow must be text under 3 MB")
    try:
        root = yaml.load(content, Loader=yaml.BaseLoader)
    except yaml.YAMLError as exc:
        raise ValueError("invalid workflow YAML") from exc
    if not isinstance(root, dict) or not isinstance(root.get("jobs", {}), dict):
        raise ValueError("workflow jobs must be an object")
    uses, secrets, issues, strings, visited = set(), set(), set(), [], set()
    todo = [root]
    while todo:
        value = todo.pop()
        if isinstance(value, str):
            strings.append(value)
        elif isinstance(value, (dict, list)):
            if id(value) in visited:
                continue
            visited.add(id(value))
            todo.extend(value.values() if isinstance(value, dict) else value)
    for job in root.get("jobs", {}).values():
        if not isinstance(job, dict):
            continue
        steps = job.get("steps", [])
        if not isinstance(steps, list):
            raise ValueError("workflow steps must be an array")
        for obj in [job] + [s for s in steps if isinstance(s, dict)]:
            ref = obj.get("uses")
            if not isinstance(ref, str) or not ref:
                continue
            if "${{" in ref:
                issues.add("dynamic_uses")
            elif ref.startswith(("./", "docker://")) or re.fullmatch(r"[^\s/]+/[^\s@]+@[^\s]+", ref):
                # Repository context disambiguates local paths. These are parsed
                # references, not proof the action exists or that it is trusted.
                uses.add((repository if ref.startswith("./") else sc[0], ref))
            else:
                issues.add("invalid_uses")
    token_pattern = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"\\]|\\.)*\"|[A-Za-z_][A-Za-z0-9_]*|[^\s]", re.S)
    for value in strings:
        for expression in re.findall(r"\$\{\{(.*?)\}\}", value, re.S):
            tokens = token_pattern.findall(expression)
            for i, token in enumerate(tokens):
                if token.lower() != "secrets" or (i and tokens[i-1] == "."):
                    continue
                rest = tokens[i+1:]
                if len(rest) >= 2 and rest[0] == "." and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", rest[1]):
                    secrets.add(rest[1])
                elif len(rest) >= 3 and rest[0] == "[" and rest[2] == "]" and re.fullmatch(r"['\"][A-Za-z_][A-Za-z0-9_]*['\"]", rest[1]):
                    secrets.add(rest[1][1:-1])
                elif rest and rest[0] == "[":
                    issues.add("dynamic_secret_index")
    return dict(scope=sc, workflow_id=workflow_id, actions=[list(x) for x in sorted(uses)],
                secret_names=sorted(secrets), issues=sorted(issues), status="parsed_references_only")


def digest_bytes(raw, digest):
    if not isinstance(raw, bytes) or not isinstance(digest, str):
        raise ValueError("requires raw bytes and digest")
    match = re.fullmatch(r"(sha256|sha512):([0-9a-f]+)", digest)
    if not match or hashlib.new(match[1], raw).hexdigest() != match[2]:
        raise ValueError("digest mismatch or unsupported algorithm")
    return json.loads(raw)


def oci_structure(raw_manifest, manifest_digest, config_raw=None):
    """Verified manifest/index structure; no inferred base image or provenance.

    HAS_LAYER / HEAD / TAIL target uncompressed diff_ids, not blob digests.
    Layer identity remains a typed digest; callers provide registry scope.
    """
    manifest = digest_bytes(raw_manifest, manifest_digest)
    index_types = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
    image_types = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}
    edges = []
    valid = lambda d: isinstance(d, str) and bool(re.fullmatch(r"(?:sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})", d))
    if manifest.get("mediaType") in index_types:
        for child in manifest.get("manifests") or []:
            if (child.get("annotations") or {}).get("vnd.docker.reference.type") == "attestation-manifest":
                continue
            if not valid(child.get("digest")):
                raise ValueError("invalid child digest")
            edges.append((manifest_digest, "CONTAINS_IMAGE", child["digest"]))
    elif manifest.get("mediaType") in image_types:
        if config_raw is None:
            return dict(edges=[], issues=["config_not_collected"])
        config = digest_bytes(config_raw, (manifest.get("config") or {}).get("digest"))
        diff_ids = (config.get("rootfs") or {}).get("diff_ids")
        layers = manifest.get("layers")
        if not isinstance(diff_ids, list) or not isinstance(layers, list) or len(layers) != len(diff_ids):
            raise ValueError("layer/diff_id counts differ")
        if not all(valid(d) for d in diff_ids) or not all(valid(l.get("digest")) for l in layers):
            raise ValueError("invalid layer digest or diff_id")
        edges += [(manifest_digest, "HAS_LAYER", d) for d in diff_ids]
        if diff_ids:
            edges += [(manifest_digest, "HEAD", diff_ids[0]), (manifest_digest, "TAIL", diff_ids[-1])]
        edges += [(a, "NEXT", b) for a, b in zip(diff_ids, diff_ids[1:])]
    else:
        raise ValueError("unsupported manifest media type")
    return dict(edges=[list(e) for e in sorted(set(edges))], issues=[])
