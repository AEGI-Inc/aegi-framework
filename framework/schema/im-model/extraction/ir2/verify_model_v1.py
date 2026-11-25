"""Offline, deterministic verification of the type-level review snapshot.

Never collects tenant data, sends model requests, or accepts unresolved meanings.
Stage 5 below is a review snapshot; the original fifth-stage specification was
not found and is not retroactively invented by this verifier.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import iface_contracts as C
import model_v1 as M

HERE=Path(__file__).resolve().parent
OUT=HERE/"out2"


def hashes(paths,root=HERE):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def run(args,seed):
    result=subprocess.run([sys.executable,"-W","ignore::ResourceWarning",*args],cwd=HERE,
                          env=dict(os.environ,PYTHONHASHSEED=str(seed),PYTHONIOENCODING="utf-8"),
                          capture_output=True,text=True,encoding="utf-8")
    if result.returncode:
        raise RuntimeError(result.stdout+result.stderr)
    return result.stdout+result.stderr


def integrity():
    types=M.read(M.V1/"object_types.json")
    inventory=M.read(M.V1/"candidate_inventory.json")
    relations=M.read(M.V1/"relation_types.json")
    review=M.read(M.V1/"review_queue.json")
    ids={row["id"]:row for row in types}
    assert len(ids)==len(types),"duplicate object type ID"
    assert len({r["id"] for r in inventory})==len(inventory),"duplicate candidate ID"
    assert len({r["id"] for r in review})==len(review),"duplicate review ID"
    assert all(r["model_status"]=="ready" and r["request_key"] for r in inventory),"uncached current request"
    for row in types:
        assert set(row["interfaces"])<=set(C.ROW)
        assert row["source_requests"] and row["identity_evidence"]
        assert row["source_shapes"] or any(r["source_evidence"] for r in row["identity_evidence"]),"type has no source identity evidence"
        assert row["contract_status"]=="requires_projected_row"
    for section in ("references","containment"):
        rows=relations[section]
        assert len({r["id"] for r in rows})==len(rows),"duplicate reference ID"
        for row in rows:
            for end in ("source","target"):
                oid=row[end]["object_type_id"]
                assert not oid or oid in ids,"dangling object type"
                assert not oid or ids[oid]["provider"]==row["provider"],"cross-provider relation"
            assert row["relation_type"] is None or row["relation_type"] in relations["vocabulary"]
            if section=="references":
                assert all(c["target"]==row["target"]["space"] for c in row["cases"]),"conditional target leaked to another case"
            else:
                assert row["scope_evidence"]["parent_position"] and row["runtime_guard"]
    for row in relations["cartography"]:
        assert all(x in ids for x in row["source_type_ids"]+row["target_type_ids"])
        if row["semantic_status"]=="compatible_type_application":
            assert row["relation_type"] in relations["vocabulary"]
            assert any(x["status"]=="compatible" for x in row["template_checks"])
        if row["semantic_status"]=="semantic_mapping_not_declared":
            assert row["relation_type"] is None
    assert len(relations["cartography"])==128
    assert len(relations["vocabulary"])==17
    credential_canon=M.type_canon("slack")
    credential_decision=(credential_canon["oauth.v2.access.access_token"]==credential_canon["oauth.v2.access.refresh_token"]
                         and credential_canon["oauth.v2.access.access_token"]!=credential_canon["oauth.v2.access.authed_user.access_token"]
                         and credential_canon["oauth.v2.access.authed_user.access_token"]!=credential_canon["tooling.tokens.rotate.token"])
    assert credential_decision,"human install x credential kind decision changed"
    return dict(object_type_ids_unique=True,candidate_ids_unique=True,review_ids_unique=True,
                dangling_type_references=0,conditional_cases_correlated=True,closed_vocabulary_checked=True,
                human_credential_kind_and_rotation_decision=credential_decision)


def main():
    C.sources()
    # Map/duplicate sources must already have passed the stage-2 verifier.
    stage2=M.read(OUT/"stage2_verification.json")
    assert stage2["tests_passed"] and all(stage2["human_decisions"].values())
    for relative,digest in stage2["determinism"]["sha256"].items():
        assert hashlib.sha256((OUT/relative).read_bytes()).hexdigest()==digest,"stage-2 inputs changed; rerun verify_stage2"
    cache_files=list(OUT.glob("*/map/*cache*.jsonl"))+list(OUT.glob("*/iface/*cache*.jsonl"))
    cache_before=hashes(cache_files)
    files=[OUT/p/"iface"/f for p in C.PROVIDERS for f in ("jev_scores.json","judgement.json")]
    files += [OUT/f for f in ("iface_calibration.json","iface_summary.json","iface_contract_audit.json","iface_contract_audit.md")]
    files += [M.V1/f for f in ("object_types.json","candidate_inventory.json","relation_types.json","review_queue.json","summary.json")]
    snapshots=[]
    script="""import iface_judge as I, iface_contracts as C, jev_judge as J, model_v1 as M
def forbidden(*args,**kwargs): raise RuntimeError('offline verification attempted model request')
J.send=forbidden
for p in C.PROVIDERS: I.run_jev(p,False)
I.calibrate()
I.judge(C.PROVIDERS)
C.audit()
M.build()
"""
    for seed in (1,2):
        run(["-c",script],seed)
        snapshots.append(hashes(files))
        print(f"hash seed {seed}: {len(files)} interface/model files rebuilt",flush=True)
    assert snapshots[0]==snapshots[1],"nondeterministic stage-3/4 snapshot"
    assert cache_before==hashes(cache_files),"cache changed in offline run"
    checks=integrity()
    tests=run(["-m","unittest","test_map3","test_relation_contracts","test_iface_judge","test_iface_contracts","test_model_v1"],2)
    count=re.search(r"Ran (\d+) tests",tests)
    assert count and "skipped=" not in tests
    summary=M.read(M.V1/"summary.json")
    result=dict(status="v1_frozen_verified" if M.read(HERE/"model_v1_freeze.json")["version"]=="v1" and not summary["open_review_items"] else "research_snapshot_verified_with_open_items",tests=int(count[1]),tests_passed=True,
                integrity=checks,determinism=dict(hash_seeds=[1,2],files=len(files),different=[]),
                current_model_response_pending=summary["model_pending"],additional_model_requests=0,
                stage2_verified_files=stage2["determinism"]["files"],human_decisions=stage2["human_decisions"],
                tenant_instances_collected=0,semantic_freeze_approved=M.read(HERE/"model_v1_freeze.json")["version"]=="v1",freeze=M.read(HERE/"model_v1_freeze.json"),original_fifth_stage_definition="not_verified",
                open_reviews=summary["review_categories"],decided_reviews=summary["decided_categories"],schema_proposals=summary["schema_proposals"])
    code=list(HERE.glob("*.py"))+[HERE/f for f in ("source_reference_facts.json","same_entity_decisions.json","iface_source_facts.json","relation_decisions_step4.json","model_v1_freeze.json","v2/research_overrides_v2.json")]
    inputs=[OUT/"object_audit.json",OUT/"rel_audit.json",OUT/"relation_resolution.json"]
    inputs += [OUT/p/"ir/manifest.json" for p in C.PROVIDERS]
    inputs += list((HERE/"collect/interface_contracts").rglob("*.source"))
    inputs += [HERE/f for f in ("collect/registry.json","collect/carto/carto_nodes.json","collect/carto/carto_loose_rels.json","collect/carto/snapshot_manifest.json")]
    manifest=dict(kind="type_level_research_snapshot",outputs=snapshots[-1],code_and_facts=hashes(code),inputs=hashes(inputs),
                  cache=cache_before,contract_sources=C.sources())
    (M.V1/"verification.json").write_text(json.dumps(result,ensure_ascii=False,indent=1,sort_keys=True)+"\n",encoding="utf-8")
    (M.V1/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=1,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False))


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
