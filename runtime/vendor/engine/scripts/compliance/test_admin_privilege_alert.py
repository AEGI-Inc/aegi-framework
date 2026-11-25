import unittest
from admin_privilege_alert import evaluate

def obj(value):
    return {"fixture_key":"test-policy", "canonical":{"provider":"gws", "object_type":"Policy", "properties":{"setting_type":"settings/rule.system_defined_alerts", "setting_value":{"displayName":"User granted Admin privilege", **value}}}}

class AlertTests(unittest.TestCase):
    def test_active_and_correct_config(self):
        v={"state":"ACTIVE", "action":{"alertCenterAction":{"alertCenterConfig":{"severity":"MEDIUM"},"recipients":[{"allSuperAdmins":True}]}}}
        self.assertEqual(evaluate([obj(v)])["gws"][0]["status"],"pass")
    def test_inactive_is_fail_but_missing_fields_are_not_collected(self):
        row=evaluate([obj({"state":"INACTIVE"})])["gws"][0]
        self.assertEqual(row["status"],"fail")
        self.assertEqual([c["status"] for c in row["conditions"]],["fail","not_collected","not_collected"])
    def test_scuba_uses_any_recipient_not_cis_super_admin_or_severity(self):
        v={"state":"ACTIVE", "action":{"alertCenterAction":{"alertCenterConfig":{"severity":"HIGH"},"recipients":[{"email":"example.invalid"}]}}}
        row=evaluate([obj(v)])["gws"][0]
        self.assertEqual(row["status"],"fail")
        self.assertEqual(row["references"][0]["status"],"pass")
        self.assertEqual(row["common_status"], "pass")
        self.assertIn("부분 결과", row["references"][0]["scope"])
    def test_common_status_keeps_confirmed_failure_with_missing_recipient(self):
        row=evaluate([obj({"state":"INACTIVE"})])["gws"][0]
        self.assertEqual(row["common_status"], "fail")
        self.assertEqual([c["status"] for c in row["common_conditions"]], ["fail", "not_collected"])
    def test_other_providers_are_not_claimed_as_uncollected(self):
        result=evaluate([])
        self.assertEqual(len(result["other_providers"]),5)
        self.assertTrue(all(x["status"]=="not_supported" for x in result["other_providers"]))
    def test_missing_is_not_collected(self):
        self.assertEqual(evaluate([])["gws"][0]["status"],"not_collected")
    def test_partial_active_is_not_pass(self):
        self.assertEqual(evaluate([obj({"state":"ACTIVE"})])["gws"][0]["status"],"not_collected")
    def test_other_policy_rejected(self):
        with self.assertRaises(ValueError): evaluate([], {"require_mfa":True})

if __name__ == '__main__': unittest.main()
