"""Common compliance checks. Add checks here without changing the transport."""
import json
import sys
from admin_auth_compliance import evaluate as evaluate_admin_auth
from admin_privilege_alert import evaluate as evaluate_admin_privilege_alert

CHECKS = {"admin_auth": {"version": "1", "evaluate": evaluate_admin_auth}, "admin_privilege_alert": {"version": "1", "evaluate": evaluate_admin_privilege_alert}}

def run_check(check_id, objects, policy):
    if check_id not in CHECKS or not isinstance(objects, list) or not isinstance(policy, dict):
        raise ValueError("invalid_check_input")
    return CHECKS[check_id]["evaluate"](objects, policy)

if __name__ == "__main__":
    request = json.load(sys.stdin)
    json.dump({"check_version": CHECKS[request["check"]]["version"], "result": run_check(request["check"], request["objects"], request["policy"])}, sys.stdout, ensure_ascii=False)
