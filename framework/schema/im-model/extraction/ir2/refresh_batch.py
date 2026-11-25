"""Frozen refresh requests, separate from the completed original stage-3 batch.

Only public schema metadata is serialized. No examples, instances or values.
"""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
from unittest.mock import patch

import dup_audit as D
import iface_batch as B
import iface_judge as I
from iface_contracts import PROVIDERS
import jev_judge as J

HERE = Path(__file__).resolve().parent
PLAN = HERE / "out2/final_refresh_payloads.json"
REVIEW = HERE / "out2/final_refresh_send_review.json"


def prepare():
    plan = dict(interface={p: B.pending(p) for p in PROVIDERS})
    plan["duplicates"] = {}
    for p in PROVIDERS:
        report = json.loads((HERE / "out2" / p / "map/same_entity.json").read_text(encoding="utf-8"))
        pending = {tuple(sorted(r["pair"])) for r in report["pairs"] if r["decision"] == "pending"}
        bodies = {}
        def collect(body, key):
            state = body["state"]
            if "group_a" in state:
                pair = tuple(sorted([state["group_a"]["name"], state["group_b"]["name"]]))
                if pair in pending:
                    if set(state) != {"api", "group_a", "group_b", "fields_with_equal_example_values"}:
                        raise ValueError("unexpected state")
                    allowed = {"name", "schemas", "endpoints", "fields", "form", "key_fields", "parents"}
                    if any(set(state[g]) - allowed for g in ("group_a", "group_b")):
                        raise ValueError("unexpected schema metadata")
                    bodies[J.ckey(body)] = body
            return None
        with patch.object(J, "api_key", return_value="prepare-only"), patch.object(J, "send", side_effect=collect), contextlib.redirect_stdout(io.StringIO()):
            D.judge(p, True)
        plan["duplicates"][p] = bodies
    PLAN.write_text(json.dumps(plan, ensure_ascii=False, sort_keys=True, indent=1)+"\n", encoding="utf-8")
    review = dict(destination=J.URL, sha256=hashlib.sha256(PLAN.read_bytes()).hexdigest(),
                  counts={k: {p:len(v) for p,v in b.items()} for k,b in plan.items()},
                  data="public schema/field names, endpoint templates, structural counts and questions; no examples, instance values or credential material",
                  status="prepared", runs=[])
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, sort_keys=True, indent=1)+"\n", encoding="utf-8")
    print(json.dumps(review, ensure_ascii=False))


def send(digest):
    raw = PLAN.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError("frozen payload changed")
    plan = json.loads(raw)
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    if review["sha256"] != digest:
        raise ValueError("review hash changed")
    original = J.send
    for kind, providers in plan.items():
        for provider, bodies in providers.items():
            approved = {J.ckey(b) for b in bodies.values()}
            if not approved:
                continue
            failures = 0
            def reviewed(body, key):
                nonlocal failures
                if J.ckey(body) not in approved:
                    if kind == "duplicates":
                        return None  # stated decisions supersede these raw candidates
                    raise ValueError("request outside prepared public batch")
                if failures >= 1:
                    return None
                try:
                    return original(body, key)
                except Exception:
                    failures += 1
                    return None
            with patch.object(J, "send", side_effect=reviewed):
                result = I.run_jev(provider, True) if kind == "interface" else D.judge(provider, True)
            review["runs"].append(dict(kind=kind,provider=provider,failures=failures,
                                       result=result if kind=="interface" else result["counts"]))
            review["status"] = "running"
            REVIEW.write_text(json.dumps(review, ensure_ascii=False, sort_keys=True, indent=1)+"\n", encoding="utf-8")
            if failures:
                raise RuntimeError("request failed; stopped without printing sensitive error details")
    review["status"] = "complete"
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, sort_keys=True, indent=1)+"\n", encoding="utf-8")
    print(json.dumps(review, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    # Keep each completed batch immutable when another refresh is necessary.
    label = sys.argv[2] if sys.argv[1] == "prepare" and len(sys.argv)>2 else sys.argv[3] if len(sys.argv)>3 else "final_refresh"
    if not label.replace("_", "").isalnum():
        raise ValueError("simple batch label required")
    PLAN = HERE / ("out2/"+label+"_payloads.json")
    REVIEW = HERE / ("out2/"+label+"_send_review.json")
    prepare() if sys.argv[1] == "prepare" else send(sys.argv[2])
