"""Prepare/replay a frozen batch of public interface questions.

    python iface_batch.py prepare jira confluence salesforce atlassian
    python iface_batch.py send <printed SHA256>

No instance/example values enter the body. Authentication is handled opaquely by
jev_judge; never print a key. A changed body cannot slip into a prepared batch.
"""
import hashlib
import json
from pathlib import Path
import sys

import iface_judge as I

HERE = Path(__file__).resolve().parent
PLAN = HERE / "out2/stage3_interface_payloads.json"
REVIEW = HERE / "out2/stage3_interface_send_review.json"


def pending(provider):
    scores, bodies = I.current_scores(I.Sig(provider))
    result = {n: b for n, b in bodies.items() if scores[n]["model_status"] == "pending"}
    keys = {"product", "object_group", "schemas", "endpoints", "fields", "parent_group", "child_groups"}
    for body in result.values():
        if set(body) != {"state", "model", "questions"} or set(body["state"]) != keys:
            raise ValueError("unexpected public-state field")
        if any(k in body["state"] for k in ("instances", "examples", "values", "credentials")):
            raise ValueError("instance data is not permitted")
    return result


def prepare(providers):
    if not providers or any(p not in ("github", "okta", "slack", "gws", "jira", "confluence", "salesforce", "atlassian") for p in providers):
        raise ValueError("explicit known providers required")
    plan = {p: pending(p) for p in providers}
    PLAN.write_text(json.dumps(plan, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    result = dict(destination="https://api.typesafe.ai/v1/systemone",
                  sha256=hashlib.sha256(PLAN.read_bytes()).hexdigest(),
                  counts={p: len(b) for p, b in plan.items()},
                  data="public schema names, field names, API templates, structural counts, classification questions; no credential or instance values",
                  status="prepared", runs=[])
    REVIEW.write_text(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


def send(expected_hash):
    raw = PLAN.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError("payload file hash changed")
    plan = json.loads(raw)
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    if review["sha256"] != expected_hash:
        raise ValueError("review hash changed")
    original = I.JJ.send
    for provider, bodies in plan.items():
        approved = {I.ckey(body) for body in bodies.values()}
        current = {I.ckey(body) for body in pending(provider).values()}
        if not current <= approved:
            raise ValueError(f"new/changed request outside prepared batch: {provider}")
        def reviewed(body, key):
            if I.ckey(body) not in approved:
                raise ValueError("body outside reviewed public-schema batch")
            return original(body, key)
        I.JJ.send = reviewed
        result = I.run_jev(provider, True)
        review["runs"].append(result)
        review["status"] = "running"
        REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
        if result["stopped"]:
            review["status"] = "stopped_with_pending"
            break
    else:
        review["status"] = "complete" if all(not r["missing"] for r in review["runs"]) else "partial"
    I.JJ.send = original
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=1, sort_keys=True)+"\n", encoding="utf-8")
    print(json.dumps({k: review[k] for k in ("status", "runs")}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "prepare":
        prepare(sys.argv[2:])
    elif sys.argv[1] == "send":
        send(sys.argv[2])
    else:
        raise SystemExit(__doc__)
