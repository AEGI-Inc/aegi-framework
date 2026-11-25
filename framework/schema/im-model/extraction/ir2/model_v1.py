"""Type-level Object catalog and stage-4 relation applications.

Exports a reviewable research snapshot, not collected Object/Relation instances.
Closed relation vocabulary is read from the pinned schema. Unknown meanings stay
null with a reason; they are not renamed to a vaguely similar relation type.
"""
import collections
import hashlib
import json
from pathlib import Path
import re

import iface_contracts as C
import rel_audit as R

HERE = Path(__file__).resolve().parent
OUT = HERE / "out2"
V1 = OUT / "v1"
DECISIONS = HERE / "relation_decisions_step4.json"
V2_OVERRIDES = HERE / "v2" / "research_overrides_v2.json"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def stable_id(kind, *parts):
    raw = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return kind+":"+hashlib.sha256(raw.encode()).hexdigest()[:24]


def vocabulary():
    C.sources()
    source = HERE / "collect/interface_contracts/Relation_Schema_v3.md.source"
    text = source.read_text(encoding="utf-8")
    out = {}
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cols = [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", line)[1:-1]]
        if len(cols) >= 4 and cols[0].isdigit() and 1 <= int(cols[0]) <= 16:
            name, template = cols[1:3]
        elif len(cols) >= 2 and cols[0] == "17 contained_in":
            name, template = "contained_in", cols[1]
        else:
            continue
        role = None
        # owned_by has three paired alternatives, not the Cartesian product.
        if name == "owned_by":
            cases = [dict(source=["Endpoint", "Automation", "Credential"], target=["Integration", "Tenant"]),
                     dict(source=["Resource"], target=["Principal"]), dict(source=["Principal"], target=["Integration"])]
        else:
            lhs, rhs = template.split("-->")
            if "--[" in lhs:
                lhs, role = lhs.split("--[", 1)
                role = role.rstrip("]")
            cases = [dict(source=[s.strip() for s in lhs.split("|")], target=[s.strip() for s in rhs.split("|")])]
        out[name] = dict(template=template, cases=cases, role=role)
    if len(out) != 17:
        raise ValueError("closed relation vocabulary did not parse as 17 entries")
    return out


def check_template(name, source, target, role=None, scope_evidence=False):
    rule = vocabulary().get(name)
    if rule is None:
        return "relation_type_outside_closed_vocabulary"
    if name == "contained_in":
        return "compatible" if scope_evidence else "needs_scope_or_parent_evidence"
    if not source or not target:
        return "endpoint_interface_unresolved"
    compatible = lambda actual, wanted: bool(set(actual) & set(wanted))
    if not any(compatible(source, c["source"]) and compatible(target, c["target"]) for c in rule["cases"]):
        return "interface_template_conflict"
    if rule["role"] and not compatible(role or [], [rule["role"]]):
        return "role_interface_unresolved"
    return "compatible"


def interface_dossier(judgement, thresholds):
    scores = judgement["jev"]
    ranked = sorted(((i, scores.get(i, 0)) for i in C.ROW), key=lambda x: (-x[1], x[0]))
    top = [dict(interface=i, probability=p, threshold=thresholds[i]["threshold"],
                margin=round(p-thresholds[i]["threshold"], 4)) for i,p in ranked[:3]]
    negatives = {n:scores.get(n,0) for n in ("N1_event", "N4_vendor_global", "N5_derived", "S_settings")}
    reasons = []
    if judgement["model_status"] != "ready":
        reasons.append("current_request_response_missing")
    if all(r["margin"] < 0 for r in top):
        reasons.append("leading_interfaces_below_calibrated_threshold")
    if scores.get("primary") == "none":
        reasons.append("primary_choice_none")
    if max(negatives.values()) >= .5:
        reasons.append("possible_event_global_derived_or_settings")
    if not reasons:
        reasons.append("primary_choice_or_multi_interface_gate_unresolved")
    return dict(leading_interfaces=top, exclusion_scores=negatives,
                primary_choice=scores.get("primary"), reasons=reasons,
                required_evidence="persistent identity, tenant scope and the selected interface's stated criterion")


def reference_targets(item):
    target = item.get("target")
    targets = target if isinstance(target,list) else [target] if isinstance(target,str) else []
    return sorted(set(targets) | {c["target"] for c in item.get("cases") or []}) or [None]


def credential_groups(provider):
    path=OUT/provider/"map/credential_rows.json"
    return [row for row in read(path) if row["key_parts"]] if path.exists() else []


def type_canon(provider):
    """Apply the prior human credential-row decision without changing map spaces.

    A rotation/refresh response is a state view of install x credential kind.
    An unkeyed independent token is still subject to the N2 identity constraint.
    """
    canon=R.canon_of(provider)
    remap={}
    for row in credential_groups(provider):
        for name in row["members"]+row["state"]:
            old=canon.get(name,name)
            target="credential-row:"+row["row"]
            if old in remap and remap[old]!=target:
                raise ValueError("credential family conflicts with same-entity grouping")
            remap[old]=target
    info=read(OUT/provider/"map/info_map.json")
    return {space:remap.get(canon.get(space,space),canon.get(space,space)) for space in info["spaces"]}


def v2_overrides():
    """Machine-applied v2 user decisions (v2/research_overrides_v2.json). Empty when absent."""
    return read(V2_OVERRIDES) if V2_OVERRIDES.exists() else {}


def candidate_decisions():
    """User interface decisions keyed by (provider, space); hold leaves the model verdict.
    v2 interface decisions are applied after the v1 ledger and win for the same view."""
    out = {}
    for d in human_decisions().values():
        if d["category"] in ("existing_reference_disagreement", "undecided_interface") and d["effect"]["kind"] != "hold":
            out[d["provider"], d["space"]] = d
    for e in v2_overrides().get("interfaces", []):
        out[e["provider"], e["space"]] = dict(code=e["code"], review_id=None, category="v2_interface", provider=e["provider"], space=e["space"],
                                              effect=dict(kind="set_interfaces", interfaces=e["interfaces"]), choice=e["why"])
    return out


def catalog(providers=None):
    types, candidates, index, decisions = [], [], {}, {}
    thresholds = read(OUT/"iface_calibration.json")["by_interface"]
    decided_views = candidate_decisions()
    target_providers = list(providers) if providers is not None else list(C.PROVIDERS)
    for provider in target_providers:
        info = read(OUT/provider/"map/info_map.json")
        judgements = read(OUT/provider/"iface/judgement.json")
        canon = type_canon(provider)
        credential_by_group={"credential-row:"+r["row"]:r for r in credential_groups(provider)}
        state_views={name for r in credential_by_group.values() for name in r["state"]}
        groups = collections.defaultdict(list)
        # An interface decision on one view applies to every view of the same
        # entity. Excluding one view (a reference or promoted key) never drops
        # the entity that other views still define.
        decided_groups = {canon.get(sp, sp): d for (p, sp), d in decided_views.items()
                          if p == provider and d["effect"]["kind"] == "set_interfaces"}
        for space, judgement in sorted(judgements.items()):
            group = canon.get(space, space)
            cid = stable_id("candidate", provider, space)
            row = dict(id=cid, provider=provider, space=space, canonical_space=group,
                       verdict=judgement["verdict"], interfaces=sorted(judgement["interfaces"]),
                       model_status=judgement["model_status"], request_key=judgement["jev"].get("request_key"),
                       decision_basis=judgement["interfaces"], not_object=judgement["not_object"],
                       signals=judgement["signals"], form=info["spaces"][space]["form"],
                       gold=judgement["gold"], credential_state_view=space in state_views,
                       review_evidence=interface_dossier(judgement, thresholds) if judgement["verdict"]=="undecided" else None)
            d = decided_views.get((provider, space)) or decided_groups.get(group)
            if d:
                # Keep the model verdict for the review trail; the user decision sets the view.
                row.update(model_verdict=row["verdict"], model_interfaces=row["interfaces"],
                           human_decision=dict(code=d["code"], review_id=d["review_id"], effect=d["effect"]))
                row["interfaces"] = sorted(d["effect"].get("interfaces") or [])
                row["verdict"] = "object" if row["interfaces"] else "not_object"
            candidates.append(row)
            groups[group].append(row)
        for group, members in sorted(groups.items()):
            # A promoted target key is a reference to the entity, not another
            # Assignment object merely because its parent was an assignment.
            # Prefer directly readable entity definitions; preserve all view
            # judgements below so no earlier evidence is silently discarded.
            entity_members=[r for r in members if not r["credential_state_view"]] or members
            readable = [r for r in entity_members if r["form"] not in ("promoted_key", "write_addressed")
                        and "GET" in (r["signals"].get("methods") or [])]
            entity_views = readable or [r for r in entity_members if r["form"] != "promoted_key"] or entity_members
            positive = [r for r in entity_views if r["verdict"] == "object"]
            negative = [r for r in entity_views if r["verdict"] == "not_object"]
            if positive:
                common = set(positive[0]["interfaces"]).intersection(*(set(r["interfaces"]) for r in positive[1:]))
                proposals = sorted(set().union(*(set(r["interfaces"]) for r in positive)))
                status = "review_conflicting_views" if negative or not common else "object_type_candidate"
                oid = stable_id("object-type", provider, group)
                types.append(dict(id=oid, provider=provider, canonical_space=group,
                                  members=[r["space"] for r in members], interfaces=sorted(common),
                                  proposed_interfaces=proposals, status=status,
                                  selected_entity_views=[r["space"] for r in entity_views],
                                  view_selection="readable_entity_definition_before_promoted_reference",
                                  credential_grouping=credential_by_group.get(group),
                                  source_shapes=sorted({s for r in members for s in
                                                        [*info["spaces"][r["space"]].get("shapes",[]),
                                                         *([info["spaces"][r["space"]]["material"]["shape"]] if info["spaces"][r["space"]].get("material") else [])]}),
                                  identity_evidence=[dict(space=r["space"], form=r["form"],
                                                         item_positions=info["spaces"][r["space"]].get("item_positions",[]),
                                                         parent_positions=info["spaces"][r["space"]].get("parent_positions",[]),
                                                         key_parts=info["spaces"][r["space"]].get("key_parts",[]),
                                                         source_evidence={k:v for k,v in info["spaces"][r["space"]].items()
                                                                          if k in ("positions","key_fields","id_formats","referenced_by","sources","material","promoted_from","candidate_why")}) for r in members],
                                  source_requests=sorted({r["request_key"] for r in members if r["request_key"]}),
                                  contract_status="requires_projected_row", grade="mixed_per_view_provenance"))
                for space in info["spaces"]:
                    if canon.get(space, space) == group:
                        index[provider, space] = oid
                decisions[provider, group] = status
            else:
                decisions[provider, group] = "not_object" if negative else "retained_undecided_candidate"
    return types, candidates, index, decisions


def human_decisions():
    """Stage-4 user decisions keyed by review ID. Every decision must hit an item."""
    return {d["review_id"]: d for d in read(DECISIONS)["decisions"]} if DECISIONS.exists() else {}


def apply_interface_decisions(types, decided):
    """Remove only the interfaces a user decision named; keep proposals as evidence."""
    for d in decided.values():
        remove = set(d["effect"].get("remove_interfaces") or [])
        if d["category"] != "assignment_permission_semantics" or not remove:
            continue
        hits = [t for t in types if t["provider"] == d["provider"] and d["space"] in t["members"]]
        if len(hits) != 1:
            raise ValueError("interface decision does not resolve to one type: "+d["code"])
        row = hits[0]
        row["interfaces"] = sorted(set(row["interfaces"]) - remove)
        row["human_decision"] = dict(code=d["code"], review_id=d["review_id"], removed_interfaces=sorted(remove), effect=d["effect"]["kind"])
        if not row["interfaces"]:
            row["status"] = "demoted_by_user_decision"


def profile_applications():
    docs = R.profiles()
    by_type = {(d["provider"], d["object_type"]): d for d in docs}
    out = []
    for d in docs:
        provider = R.PROF_PROV.get(d["provider"])
        if not provider:
            continue
        for field, ref in sorted((d.get("references") or {}).items()):
            if not isinstance(ref, dict):
                continue
            present = "relation_type" in ref
            rel = ref.get("relation_type")
            if field == "tenant" and not present:
                status = "scope_reference"
            elif not present:
                status = "semantic_mapping_not_declared"
            elif rel is None:
                status = "reviewed_vocabulary_gap"
            elif rel == "no_relation":
                status = "no_relation"
            else:
                target = by_type.get((d["provider"], ref.get("object_type"))) or {}
                src_if, dst_if = d.get("interfaces") or [], target.get("interfaces") or []
                if ref.get("reverse"):
                    src_if, dst_if = dst_if, src_if
                role = ["Policy"] if (ref.get("policy") or {}).get("const") else []
                status = check_template(rel, src_if, dst_if, role,
                                        scope_evidence=field in ("parent", "tenant"))
            out.append(dict(id=stable_id("profile-reference", provider, d["object_type"], field),
                            provider=provider, object_type=d["object_type"], field=field,
                            path=ref.get("path"), request_context=ref.get("from"),
                            target_type=ref.get("object_type"), relation_type=rel,
                            declaration_present=present, reverse=bool(ref.get("reverse")), status=status,
                            source=dict(document=d["_doc"], locator=d["object_type"]+".references."+field)))
        assignment = d.get("assignment") or {}
        if assignment.get("relation_type"):
            slots = {r["slot"]: dict(field=n, object_type=r.get("object_type"), path=r.get("path"), request_context=r.get("from"))
                     for n,r in (d.get("references") or {}).items() if isinstance(r,dict) and r.get("slot")}
            # Preserve ternary source/role/target bindings; do not turn the
            # Assignment record itself into a Principal or flatten the role.
            out.append(dict(id=stable_id("assignment-template", provider, d["object_type"]),
                            provider=provider, object_type=d["object_type"], relation_type=assignment["relation_type"],
                            slots=slots, status="typed_assignment_slots" if {"source","target","role"} <= set(slots) else "assignment_slots_incomplete",
                            source=dict(document=d["_doc"], locator=d["object_type"]+".assignment")))
    return sorted(out, key=lambda r:r["id"])


def baseline_directions():
    result = {}
    nodes = read(HERE/"collect/carto/carto_nodes.json")
    for node in nodes:
        for row in [*node["rels"], node.get("sub_resource") or {}]:
            if row.get("class") and row.get("dir"):
                result[row["class"]] = row["dir"]
    for row in read(HERE/"collect/carto/carto_loose_rels.json"):
        if row.get("dir"):
            result[row["class"]] = row["dir"]
    return result


def baseline_semantic(row, direction):
    """Bounded normalizations, checked by the closed interface templates.

    Membership and inclusion/exclusion use their declared graph direction.
    Credential attribution follows Relation_Schema_v3's explicit reverse rule.
    Other baseline names stay null; similar spelling is not enough evidence.
    """
    if row["class"] in ("GitHubPersonalAccessTokenToOwnerUserOwnedByRel", "GitHubPersonalAccessTokenToOwnerUserRel", "OktaApiTokenOwnedByUserRel"):
        return "authenticates_with", True, "Relation_Schema_v3 credential attribution is authenticates_with + reverse"
    labels = {"MEMBER_OF":"member_of", "MEMBER_OF_TEAM":"member_of", "MEMBER_OF_OKTA_GROUP":"member_of",
              "INHERITED_MEMBER_OF":"member_of", "APPLIES_TO":"applies_to", "EXCLUDES":"excludes"}
    if row["label"] in labels and direction in ("INWARD", "OUTWARD"):
        return labels[row["label"]], direction=="INWARD", "baseline declared direction; interface template still required"
    if row["class"] == "GitHubPersonalAccessTokenToRepositoryRel":
        return "permits", False, "token selected-repository access; permission detail remains source evidence"
    return None, False, "closed vocabulary has no declared mapping for this baseline relation"


def build(providers=None):
    scoped = providers is not None
    target_providers = list(providers) if scoped else list(C.PROVIDERS)
    target_set = set(target_providers)
    skipped_inputs = []
    vocab = vocabulary()
    types, candidates, index, decisions = catalog(target_providers)
    if scoped and not DECISIONS.exists():
        skipped_inputs.append("relation_decisions_step4.json")
    decided = human_decisions()
    if scoped:
        decided = {k: d for k, d in decided.items() if d.get("provider") in target_set}
    apply_interface_decisions(types, decided)
    if scoped and not V2_OVERRIDES.exists():
        skipped_inputs.append("v2/research_overrides_v2.json")
    v2 = v2_overrides()
    v2_carto = {(e["provider"], e["class"]): e for e in v2.get("cartography", []) if not scoped or e.get("provider") in target_set}
    v2_hit = set()
    for e in v2.get("interfaces", []):
        if scoped and e.get("provider") not in target_set:
            continue
        if not any(c["provider"] == e["provider"] and c["space"] == e["space"] and c.get("human_decision", {}).get("code") == e["code"] for c in candidates):
            raise ValueError("v2 interface decision does not match a candidate: "+e["code"])
    type_by_id = {r["id"]: r for r in types}
    references, containment = [], []
    for provider in target_providers:
        info = read(OUT/provider/"map/info_map.json")
        canon = type_canon(provider)
        def endpoint(space):
            ident = index.get((provider,space))
            return dict(space=space, object_type_id=ident,
                        status=type_by_id[ident]["status"] if ident else decisions.get((provider,canon.get(space,space)), "not_an_object_candidate"))
        for item in info["items"]:
            if not item["det"].startswith("space:") or item["kind"] not in ("ref", "ref_url", "embedded_ref"):
                continue
            source_space = item["det"][6:]
            # A field with multiple guarded targets remains multiple cases.
            for target_space in reference_targets(item):
                row = dict(provider=provider, field=item["rel"], source=endpoint(source_space),
                           target=endpoint(target_space) if target_space else dict(space=None,object_type_id=None,status="target_unknown"),
                           relation_type=None, semantic_status="reference_without_relation_mapping",
                           cases=[case for case in item.get("cases") or [] if case["target"] == target_space],
                           origin_slots=item.get("slots") or [], guard_context="source_record",
                           source_evidence=item.get("source_evidence") or [],
                           key_kind="conditional" if item.get("cases") else "source_reference")
                row["id"] = stable_id("typed-reference",provider,source_space,item["rel"],target_space)
                references.append(row)
        owner = {}
        for name, sp in info["spaces"].items():
            for pos in sp.get("positions") or []:
                owner.setdefault(pos,name)
            for pos in sp.get("item_positions") or []:
                owner[pos] = name
        for name, sp in sorted(info["spaces"].items()):
            for pos in sorted(sp.get("parent_positions") or []):
                parent = owner.get(pos)
                if parent and parent != name:
                    containment.append(dict(id=stable_id("containment",provider,name,parent,pos),provider=provider,
                                            source=endpoint(name),target=endpoint(parent), relation_type="contained_in",
                                            scope_evidence=dict(parent_position=pos),
                                            runtime_guard="target must occur in Object.scope or references.parent",
                                            status="type_parent_proven_runtime_values_uncollected"))
    rel_audit_path = OUT / "rel_audit.json"
    rel_res_path = OUT / "relation_resolution.json"
    if scoped and not rel_audit_path.exists():
        skipped_inputs.append("out2/rel_audit.json")
        baseline = {}
    else:
        baseline = read(rel_audit_path)
        if scoped:
            baseline = {p: rows for p, rows in baseline.items() if p in target_set}
    if scoped and not rel_res_path.exists():
        skipped_inputs.append("out2/relation_resolution.json")
        contracts = {}
    else:
        contracts = {r["class"]:r for r in read(rel_res_path)["recipes"]}
    cartography = []
    directions = baseline_directions() if baseline else {}
    for provider, rows in baseline.items():
        for row in rows:
            if row.get("kind") == "tenant":
                continue
            contract = contracts.get(row["class"])
            category = contract["category"] if contract else None
            direction = (contract or {}).get("direction") or directions.get(row["class"])
            source_ids = sorted({index[provider,s] for s in row["source_spaces"] if (provider,s) in index})
            target_ids = sorted({index[provider,s] for s in row["target_spaces"] if (provider,s) in index})
            rel_type, reverse, why = baseline_semantic(row,direction)
            override = v2_carto.get((provider, row["class"]))
            if override:
                # v2 decision: the baseline label does not map to a stored relation
                rel_type, why = None, f"v2 {override['code']}: {override['why']}"
                v2_hit.add((provider, row["class"]))
                rid = stable_id("baseline-review",provider,row["class"],row["source"],row["target"])
                decided[rid] = dict(code=override["code"], review_id=rid, category="semantic_mapping_not_declared", provider=provider,
                                    effect=dict(kind=override["effect"]), choice=override["why"],
                                    decided_by=v2["decided_by"], decided_on=v2["decided_on"])
            sem_src, sem_dst = (target_ids,source_ids) if reverse else (source_ids,target_ids)
            validations = [dict(source_type_id=a,target_type_id=b,
                                status=check_template(rel_type,type_by_id[a]["interfaces"],type_by_id[b]["interfaces"]))
                           for a in sem_src for b in sem_dst] if rel_type else []
            semantic_status = ("compatible_type_application" if any(v["status"]=="compatible" for v in validations)
                               else "template_or_endpoint_review") if rel_type else "semantic_mapping_not_declared"
            cartography.append(dict(provider=provider, source=row["source"], target=row["target"],
                                     label=row["label"], **{"class":row["class"]}, pair_status=row["status"],
                                     relation_type=rel_type, semantic_status=semantic_status, semantic_reverse=reverse,
                                     semantic_basis=why, template_checks=validations,
                                     v1_scope="deferred_external_collection" if category=="E" else "type_candidate",
                                     derivation_class=category, alias_group=(contract or {}).get("alias_group"),
                                     direction=direction, source_type_ids=source_ids, target_type_ids=target_ids))
            review_id = stable_id("baseline-review",provider,row["class"],row["source"],row["target"])
            if review_id in decided:
                cartography[-1]["human_decision"] = dict(code=decided[review_id]["code"], effect=decided[review_id]["effect"])
    if set(v2_carto) - v2_hit:
        raise ValueError("v2 cartography decisions without a baseline row: "+", ".join(sorted(e["code"] for k,e in v2_carto.items() if k not in v2_hit)))
    review = []
    for row in candidates:
        if row.get("model_verdict", row["verdict"]) == "undecided":
            review.append(dict(id=row["id"],provider=row["provider"],space=row["space"],
                               category="undecided_interface",recommendation="retain_candidate_without_forcing_an_interface",
                               request_key=row["request_key"], evidence=row["review_evidence"]))
        if row["gold"] and set(row["gold"]) != set(row.get("model_interfaces", row["interfaces"])):
            review.append(dict(id=stable_id("gold-disagreement",row["provider"],row["space"]),provider=row["provider"],space=row["space"],
                               category="existing_reference_disagreement",expected=row["gold"],proposed=row.get("model_interfaces", row["interfaces"]),
                               recommendation="compare_existing_reference_with_pinned_interface_criterion; neither is automatic ground truth"))
        assignment = row["decision_basis"].get("Assignment",{})
        if assignment.get("by")=="rule":
            review.append(dict(id=stable_id("assignment-review",row["provider"],row["space"]),provider=row["provider"],space=row["space"],
                               category="assignment_permission_semantics",recommendation="prove that deleting this record revokes permission while its principal and target remain",
                               evidence=assignment))
    for obj in types:
        if obj["status"] == "review_conflicting_views":
            review.append(dict(id=obj["id"],provider=obj["provider"],space=obj["canonical_space"],
                               category="same_entity_interface_conflict",recommendation="review_member_views_before_type_acceptance"))
    profiles = profile_applications()
    if scoped:
        profiles = [r for r in profiles if r["provider"] in target_set]
    for row in profiles:
        if row["id"] in decided:
            row["human_decision"] = dict(code=decided[row["id"]]["code"], effect=decided[row["id"]]["effect"])
    for row in profiles:
        if row["status"] not in ("compatible", "scope_reference", "no_relation", "typed_assignment_slots"):
            review.append(dict(id=row["id"],provider=row["provider"],space=row["object_type"],category="profile_"+row["status"],
                               recommendation="declare a source-backed mapping or preserve the explicit vocabulary gap",evidence=row))
    for row in cartography:
        if row["semantic_status"] != "compatible_type_application":
            review.append(dict(id=stable_id("baseline-review",row["provider"],row["class"],row["source"],row["target"]),provider=row["provider"],space=row["source"],
                               category=row["semantic_status"],relation_class=row["class"],
                               recommendation="review the baseline meaning against the 17 closed relation types; null here is an unapproved proposal, not a reviewed Profile declaration",
                               evidence=dict(label=row["label"],direction=row["direction"],target=row["target"],checks=row["template_checks"])))
    review_ids = {r["id"] for r in review}
    # A later interface decision can make a baseline row template-compatible;
    # that decision stays attached to the row and is reported, not dropped.
    now_compatible = {stable_id("baseline-review",r["provider"],r["class"],r["source"],r["target"])
                      for r in cartography if r["semantic_status"] == "compatible_type_application"}
    superseded = sorted(d["code"] for k,d in decided.items() if k not in review_ids and k in now_compatible)
    missing = sorted(d["code"] for k,d in decided.items() if k not in review_ids and k not in now_compatible)
    if missing:
        raise ValueError("stage-4 decisions without a review item: "+", ".join(missing))
    by_candidate = {c["id"]: c for c in candidates}
    v2_by_code = {e["code"]: e for e in v2.get("interfaces", [])}
    for r in review:
        d = decided.get(r["id"])
        hd = by_candidate[r["id"]].get("human_decision") if r["category"] == "undecided_interface" else None
        if not d and hd:
            rid = hd.get("review_id")
            if rid is not None:
                d = decided[rid]
            elif hd.get("code") in v2_by_code:
                e = v2_by_code[hd["code"]]
                d = dict(code=e["code"], choice=e["why"], effect=hd["effect"],
                         decided_by=v2.get("decided_by", "user"), decided_on=v2.get("decided_on"))
        r["status"] = "decided" if d else "open"
        if d:
            decided_by = d.get("decided_by")
            decided_on = d.get("decided_on")
            if decided_by is None or decided_on is None:
                dec_meta = read(DECISIONS)
                decided_by = decided_by if decided_by is not None else dec_meta["decided_by"]
                decided_on = decided_on if decided_on is not None else dec_meta["decided_on"]
            r["decision"] = dict(code=d["code"], choice=d["choice"], effect=d["effect"], decided_by=decided_by, decided_on=decided_on)
    open_review = [r for r in review if r["status"] == "open"]
    summary = dict(candidate_spaces=len(candidates), candidate_verdicts=dict(collections.Counter(r["verdict"] for r in candidates)),
                   canonical_object_type_candidates=len(types), review_items=len(review),
                   object_type_status=dict(collections.Counter(t["status"] for t in types)),
                   object_type_interfaces=dict(collections.Counter(i for t in types for i in t["interfaces"])),
                   credential_kind_groups=sum(bool(row["credential_grouping"]) for row in types),
                   undecided_interfaces=sum(r["verdict"]=="undecided" for r in candidates),
                   review_categories=dict(collections.Counter(r["category"] for r in open_review)),
                   open_review_items=len(open_review), decided_review_items=len(review)-len(open_review),
                   decided_categories=dict(collections.Counter(r["category"] for r in review if r["status"]=="decided")),
                   decisions_now_template_compatible=superseded,
                   schema_proposals=sorted(d["code"] for d in decided.values() if d["effect"]["kind"]=="schema_proposal"),
                   demoted_by_user_decision=sum(t["status"]=="demoted_by_user_decision" for t in types),
                   model_pending=sum(r["model_status"]!="ready" for r in candidates),
                   typed_references=len(references), containment_rules=len(containment),
                   profile_applications=len(profiles), profile_status=dict(collections.Counter(r["status"] for r in profiles)),
                   cartography_baseline=len(cartography), deferred_external=sum(r["v1_scope"]=="deferred_external_collection" for r in cartography),
                   cartography_semantics=dict(collections.Counter(r["semantic_status"] for r in cartography)),
                   vocabulary_size=len(vocab), object_instances_collected=0,
                   status="research_draft_with_explicit_open_items")
    if scoped:
        cartography_nodes = []
        for provider in target_providers:
            ca_path = OUT / f"carto_audit_{provider}.json"
            if not ca_path.exists():
                continue
            ca_doc = read(ca_path)
            for row in ca_doc.get(provider, []):
                spaces = [s["name"] for s in row.get("spaces", []) if s.get("name")]
                object_type_ids = sorted({index[provider, sp] for sp in spaces if (provider, sp) in index})
                interfaces = sorted({i for oid in object_type_ids for i in type_by_id[oid]["interfaces"]})
                cartography_nodes.append(dict(
                    provider=provider,
                    node=row["node"],
                    status=row.get("status"),
                    spaces=spaces,
                    object_type_id=object_type_ids[0] if len(object_type_ids) == 1 else None,
                    object_type_ids=object_type_ids,
                    interfaces=interfaces,
                    derived=row.get("derived"),
                ))
        summary["providers"] = target_providers
        summary["skipped_inputs"] = skipped_inputs
        summary["cartography_nodes"] = cartography_nodes
        out_dir = OUT / (target_providers[0] if len(target_providers) == 1 else "_".join(target_providers)) / "objects"
        out_dir.mkdir(parents=True, exist_ok=True)
        jsonl = lambda rows: "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows)
        (out_dir / "object-types.jsonl").write_text(jsonl(sorted(types, key=lambda r: r["id"])), encoding="utf-8")
        (out_dir / "typed-references.jsonl").write_text(jsonl(sorted(references, key=lambda r: r["id"])), encoding="utf-8")
        (out_dir / "containment.jsonl").write_text(jsonl(sorted(containment, key=lambda r: r["id"])), encoding="utf-8")
        (out_dir / "candidates.jsonl").write_text(jsonl(candidates), encoding="utf-8")
        (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    else:
        V1.mkdir(exist_ok=True)
        payloads = {"object_types.json":types, "candidate_inventory.json":candidates,
                    "relation_types.json":dict(vocabulary=vocab, references=sorted(references,key=lambda r:r["id"]),
                                               containment=sorted(containment,key=lambda r:r["id"]), profiles=profiles, cartography=cartography),
                    "review_queue.json":sorted(review,key=lambda r:r["id"]), "summary.json":summary}
        for name,payload in payloads.items():
            (V1/name).write_text(json.dumps(payload,ensure_ascii=False,indent=1,sort_keys=True)+"\n",encoding="utf-8")
    return summary


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if args and args[0] == "build":
        providers = args[1:] or None
    else:
        providers = args or None
    print(json.dumps(build(providers), ensure_ascii=False, sort_keys=True))
