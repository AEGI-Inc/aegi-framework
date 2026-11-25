"""Offline stage-2 verification. Rebuild twice with different hash seeds.

Requires the existing normalized IR and model caches. Never passes --send.
Keeps prior verification as stage2_verification_before_de.json on first run.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
OUT = HERE / "out2"
PROVIDERS = ["github", "gws", "jira", "okta", "salesforce", "slack", "confluence", "atlassian"]


def run(args, seed):
    env = dict(os.environ, PYTHONHASHSEED=str(seed), PYTHONIOENCODING="utf-8")
    result = subprocess.run([sys.executable, "-W", "ignore::ResourceWarning", *args],
                            cwd=HERE, env=env, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"{' '.join(args)} failed\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def digests(paths):
    return {str(p.relative_to(OUT)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def main():
    previous = OUT / "stage2_verification_before_de.json"
    latest = OUT / "stage2_verification.json"
    if latest.exists() and not previous.exists():
        previous.write_bytes(latest.read_bytes())
    files = [OUT / p / "map" / n for p in PROVIDERS for n in ("info_map.json", "metrics.json", "issues.jsonl")]
    files += [OUT / p / "map/same_entity.json" for p in PROVIDERS]
    credential_providers=[p for p in PROVIDERS if any(s["form"]=="composite_key" for s in
                         json.loads((OUT/p/"map/info_map.json").read_text(encoding="utf-8"))["spaces"].values())]
    files += [OUT / p / "map/credential_rows.json" for p in credential_providers]
    files += [OUT / n for n in ("carto_audit.json", "rel_audit.json", "rel_audit_profiles.json", "relation_resolution.json", "relation_resolution.md")]
    cache_files = sorted(OUT.glob("*/map/*cache*"))
    cached = digests([p for p in cache_files if p.is_file()])
    snapshots = []
    for seed in (1, 2):
        run(["map3.py", *PROVIDERS], seed)
        run(["dup_audit.py", *PROVIDERS], seed)
        run(["dup_audit.py", "--credentials", *credential_providers], seed)
        run(["carto_audit.py"], seed)
        run(["rel_audit.py"], seed)
        run(["rel_audit.py", "profiles"], seed)
        run(["relation_contracts.py"], seed)
        snapshots.append(digests(files))
        print(f"hash seed {seed}: rebuilt {len(files)} files", flush=True)
    different = [k for k in snapshots[0] if snapshots[0][k] != snapshots[1][k]]
    if different:
        raise ValueError(f"nondeterministic files: {different}")
    if cached != digests([p for p in cache_files if p.is_file()]):
        raise ValueError("model cache changed during offline verification")
    tests = run(["-m", "unittest", "test_map3", "test_relation_contracts"], 2)
    match = re.search(r"Ran (\d+) tests", tests)
    if not match or "skipped=" in tests:
        raise ValueError("tests were skipped or did not complete")
    run(["validate.py", "all"], 2)
    validations = {p: json.loads((OUT / p / "validation.json").read_text(encoding="utf-8")) for p in PROVIDERS}
    if not all(v.get("pass") is True for v in validations.values()):
        raise ValueError("provider IR validation failed")
    from rel_audit import canon_of
    canon = {p: canon_of(p) for p in ("github", "jira", "gws")}
    def eq(p, a, b):
        return canon[p].get(a, a) == canon[p].get(b, b)
    decisions = dict(
        Q1=eq("github", "Team", "team-full") and not eq("github", "Team", "enterprise-team-with-member-count"),
        Q2=all(eq("jira", "Group", n) for n in ("GroupDetails", "GroupName", "FoundGroup")),
        Q3=eq("gws", "Group", "Group_2"))
    if not all(decisions.values()):
        raise ValueError("human Q1-Q3 decision changed")
    audit = json.loads((OUT / "rel_audit.json").read_text(encoding="utf-8"))
    counts = {p: dict(collections.Counter(r["status"] for r in rows if r.get("kind") != "tenant")) for p, rows in audit.items()}
    plan = json.loads((OUT / "relation_resolution.json").read_text(encoding="utf-8"))
    same = json.loads((OUT / "okta/map/same_entity.json").read_text(encoding="utf-8"))
    duplicates = {p: json.loads((OUT / p / "map/same_entity.json").read_text(encoding="utf-8"))["counts"] for p in PROVIDERS}
    result = dict(scope="stage2_remaining_de_and_duplicate_corrections", tests=int(match[1]),
                  tests_passed=True, validations=validations, human_decisions=decisions,
                  counts=counts, resolution=plan["summary"], okta_duplicates=same["counts"],
                  duplicates=duplicates,
                  okta_groups=len(same["groups"]), determinism=dict(hash_seeds=[1, 2], files=len(files),
                  different=different, sha256=snapshots[-1]), additional_jev_requests=0,
                  tenant_data_collected=False, production_graph_changed=False)
    latest.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("tests", "resolution", "okta_duplicates", "okta_groups")}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
