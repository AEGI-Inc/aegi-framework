"""기준 판정을 묶을 때 대상 상태가 항목 상태와 어긋나지 않는지 본다."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_standard_results import fill_empty_fail_targets, guard_empty_pass, item_targets, load_call_states, load_tenant_targets  # noqa: E402


def t(status):
    return {"key": "k", "in_graph": True, "name": "대상", "value": "값", "status": status}


class ItemTargetsTest(unittest.TestCase):
    def test_org_policy_item_turns_unknown_targets_into_org_policy(self):
        out = item_targets("org_policy", [t("unknown"), t("pass"), t("fail")])
        self.assertEqual([x["status"] for x in out], ["org_policy", "pass", "fail"])

    def test_manual_item_turns_unknown_targets_into_manual(self):
        self.assertEqual(item_targets("manual", [t("unknown")])[0]["status"], "manual")

    def test_other_items_keep_unknown_targets(self):
        for status in ("unknown", "fail", "pass", "not_collected"):
            self.assertEqual(item_targets(status, [t("unknown")])[0]["status"], "unknown")

    def test_input_targets_are_not_changed(self):
        src = [t("unknown")]
        item_targets("org_policy", src)
        self.assertEqual(src[0]["status"], "unknown")


class EmptyFailTargetsTest(unittest.TestCase):
    def test_fail_with_empty_targets_attaches_tenant_target(self):
        tenants = {"gws": {"key": "im:gws:Customer:cust1", "in_graph": True, "name": "Tenant Org"}}
        out = fill_empty_fail_targets(
            {"status": "fail", "threshold": "규칙 1개 이상", "note": "", "targets": []},
            "gws",
            tenants,
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["key"], "im:gws:Customer:cust1")
        self.assertEqual(out[0]["status"], "fail")
        self.assertEqual(out[0]["value"], "규칙 1개 이상")
        self.assertEqual(out[0]["note"], "설정이 없어 조직 객체에 붙임")
        self.assertTrue(out[0]["in_graph"])

    def test_fail_with_empty_threshold_uses_note_as_value(self):
        tenants = {"okta": {"key": "im:okta:OrgSetting:org1", "in_graph": True, "name": "Okta Org"}}
        out = fill_empty_fail_targets(
            {"status": "fail", "threshold": "", "note": "IdP 목록이 비어 있음", "targets": []},
            "okta",
            tenants,
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["value"], "IdP 목록이 비어 있음")

    def test_pass_with_empty_targets_stays_empty(self):
        tenants = {"gws": {"key": "im:gws:Customer:cust1", "in_graph": True, "name": "Tenant Org"}}
        out = fill_empty_fail_targets(
            {"status": "pass", "threshold": "규칙 1개 이상", "note": "", "targets": []},
            "gws",
            tenants,
        )
        self.assertEqual(out, [])

    def test_load_tenant_targets_from_objects_json(self):
        import json, tempfile
        objs = [
            {"fixture_key": "im:gws:Customer:c1", "canonical": {"provider": "gws", "object_type": "Customer", "display_name": "GWS Org", "interfaces": ["Tenant"]}},
            {"fixture_key": "im:okta:OrgSetting:o1", "canonical": {"provider": "okta", "object_type": "OrgSetting", "name": "Okta Org", "interfaces": ["Tenant"]}},
            {"fixture_key": "im:slack:200.team:t1", "canonical": {"provider": "slack", "object_type": "200.team", "name": "Team 1", "interfaces": ["Tenant"]}},
            {"fixture_key": "im:slack:200.team:t2", "canonical": {"provider": "slack", "object_type": "200.team", "name": "Team 2", "interfaces": ["Tenant"]}},
        ]
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "objects.json"), "w", encoding="utf-8") as f:
                json.dump(objs, f)
            tenants = load_tenant_targets(d)
        self.assertEqual(tenants["gws"]["key"], "im:gws:Customer:c1")
        self.assertEqual(tenants["okta"]["key"], "im:okta:OrgSetting:o1")
        self.assertNotIn("slack", tenants)


def gh33_pass():
    # cis_github.py 4.2.2: GH-33 의 패키지가 0개면 pass 로 낸다(대상 0개)
    return {"item_id": "4.2.2", "status": "pass", "targets": [], "note": "GH-33 packages 수집 결과 조직 패키지가 0개다",
            "rule": {"source": "GH-33 /orgs/{org}/packages", "field": "패키지 목록", "condition": "", "combine": ""}}


class EmptyPassRunRecordTest(unittest.TestCase):
    """대상 0개라 pass 인 항목은 기대는 호출이 full 일 때만 pass 로 둔다(수집 실행 기록 collected/runs/<run>.json)"""

    def test_partial_call_with_zero_targets_is_not_collected(self):
        out = guard_empty_pass(gh33_pass(), {"GH-33": "partial"})
        self.assertEqual(out["status"], "not_collected")
        self.assertIn("GH-33 partial", out["note"])

    def test_failed_skipped_and_missing_calls_are_not_collected(self):
        for states in ({"GH-33": "failed"}, {"GH-33": "skipped"}, {}):
            self.assertEqual(guard_empty_pass(gh33_pass(), states)["status"], "not_collected", states)

    def test_full_call_keeps_pass(self):
        self.assertEqual(guard_empty_pass(gh33_pass(), {"GH-33": "full"}), gh33_pass())

    def test_every_cited_call_must_be_full(self):
        it = {**gh33_pass(), "rule": {"source": "SL-02 users.list, SL-04 conversations.members"}}
        self.assertEqual(guard_empty_pass(it, {"SL-02": "full", "SL-04": "full"})["status"], "pass")
        out = guard_empty_pass(it, {"SL-02": "full", "SL-04": "partial"})
        self.assertEqual(out["status"], "not_collected")
        self.assertIn("SL-04 partial", out["note"])

    def test_items_with_targets_or_no_record_are_unchanged(self):
        with_target = {**gh33_pass(), "targets": [t("pass")]}
        self.assertEqual(guard_empty_pass(with_target, {"GH-33": "partial"}), with_target)
        self.assertEqual(guard_empty_pass(gh33_pass(), None), gh33_pass(), "실행 기록을 받지 않으면(직접 실행) 그대로")
        no_call = {**gh33_pass(), "rule": {"source": "(없음)"}}
        self.assertEqual(guard_empty_pass(no_call, {}), no_call)
        fail = {**gh33_pass(), "status": "fail"}
        self.assertEqual(guard_empty_pass(fail, {"GH-33": "partial"}), fail)

    def test_settings_run_record_replaces_only_non_full_calls(self):
        import json, tempfile
        with tempfile.TemporaryDirectory() as d:
            main_rec, settings_rec = os.path.join(d, "main.json"), os.path.join(d, "settings.json")
            with open(main_rec, "w", encoding="utf-8") as f:
                json.dump({"calls": [{"call_id": "GH-05", "completeness": "full"}, {"call_id": "GHS-01", "completeness": "skipped"}]}, f)
            with open(settings_rec, "w", encoding="utf-8") as f:
                json.dump({"calls": [{"call_id": "GH-05", "completeness": "partial"}, {"call_id": "GHS-01", "completeness": "full"}]}, f)
            states = load_call_states([main_rec, settings_rec, os.path.join(d, "none.json")])
        self.assertEqual(states, {"GH-05": "full", "GHS-01": "full"})


if __name__ == "__main__":
    unittest.main()
