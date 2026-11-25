import unittest
from admin_auth_compliance import obj, evaluate, evaluate_gws, evaluate_okta_policy, compare_policy


class AdminAuthTests(unittest.TestCase):
    def test_policy_comparison_does_not_imply_missing_or_forbid_mfa(self):
        self.assertEqual(compare_policy(True, True, True), "compliant")
        self.assertEqual(compare_policy(False, True, True), "noncompliant")
        self.assertEqual(compare_policy(True, False, True), "not_required")
        self.assertEqual(compare_policy(False, None, True), "fail")
        self.assertEqual(compare_policy(None, True, True), "not_collected")
        self.assertEqual(compare_policy(False, True, False), "unknown")

    def test_gws_admin_mfa_and_missing(self):
        def u(key, **p):
            return obj("gws", "User", {"suspended": False, "isAdmin": True, **p}, key)
        rows = evaluate_gws([u("a", isEnforcedIn2Sv=True), u("b", isEnforcedIn2Sv=False), u("c"),
                             obj("gws", "User", {"suspended": True, "isAdmin": True}, "d"), u("e", isEnforcedIn2Sv="maybe")])
        self.assertEqual([x["status"] for x in rows], ["pass", "fail", "not_collected", "unknown"])

    def test_unknown_admin_and_no_objects(self):
        self.assertEqual(evaluate_gws([obj("gws", "User", {"suspended": False}, "x")])[0]["status"], "unknown")
        self.assertIn("확인할 수 없습니다", evaluate([])["gws_coverage"])

    def test_profile_object_input(self):
        data = [{"fixture_key": "user-a", "canonical": {"provider": "gws", "object_type": "User",
            "properties": {"isAdmin": True, "suspended": False, "isEnforcedIn2Sv": False},
            "source": {"observations": [{"collected_at": "2026-11-03T00:00:00Z"}]}}}]
        result = evaluate(data)["gws"][0]
        self.assertEqual((result["status"], result["observation_status"], result["observed_at"]), ("fail", "fail", "2026-11-03T00:00:00Z"))
        self.assertEqual(evaluate(data, {"require_mfa": True})["gws"][0]["status"], "noncompliant")
        self.assertEqual(evaluate(data, {"require_mfa": False})["gws"][0]["status"], "not_required")
        with self.assertRaises(ValueError):
            evaluate(data, {"require_mfa": "true"})

    def test_okta_priority_and_missing(self):
        def rule(key, priority, mode):
            return obj("okta", "PolicyRule", {"status": "ACTIVE", "priority": priority,
                "actions": {"appSignOn": {"verificationMethod": {"factorMode": mode}}}}, key)
        self.assertEqual(evaluate_okta_policy([rule("a", 2, "1FA"), rule("b", 1, "2FA")])["status"], "pass")
        self.assertEqual(evaluate_okta_policy([rule("a", 1, None)])["status"], "not_collected")
        self.assertEqual(evaluate_okta_policy([rule("a", 1, "2FA"), rule("b", 1, "1FA")])["status"], "unknown")

    def test_okta_normalized_policy_link_and_phishing(self):
        policy = {"fixture_key": "p", "canonical": {"provider": "okta", "object_type": "Policy",
            "properties": {"name": "Okta Admin Console", "type": "ACCESS_POLICY"}}}
        rule = {"fixture_key": "r", "canonical": {"provider": "okta", "object_type": "PolicyRule",
            "references": {"parent": {"targets": [{"identifier_type": "primary", "value": "p"}]}},
            "properties": {"status": "ACTIVE", "priority": 1, "actions": {"appSignOn": {
                "verificationMethod": {"factorMode": "2FA", "constraints": [{"possession": {"phishingResistant": "REQUIRED"}}]}}}}}}
        result = evaluate([policy, rule])
        self.assertEqual((result["okta"]["status"], result["okta"]["observation_status"], result["okta"]["phishing_resistant_status"]), ("pass", "pass", "pass"))
        self.assertEqual(result["slack"]["status"], "not_collected")
        rule["canonical"]["references"] = {}
        self.assertEqual(evaluate([policy, rule])["okta"]["status"], "unknown")

    def test_github_scope_is_not_admin_pass(self):
        org = {"fixture_key": "g", "canonical": {"provider": "github", "object_type": "organization-full",
            "properties": {"two_factor_requirement_enabled": True}}}
        self.assertEqual(evaluate([org])["github"][0]["status"], "pass")
        self.assertIn("관리자별 실제 사용", evaluate([org])["github"][0]["scope"])

    def test_six_providers_keep_missing_distinct_from_observation(self):
        slack = {"fixture_key": "s", "canonical": {"provider": "slack", "object_type": "200.members[*]",
            "properties": {"is_admin": True, "has_2fa": True}}}
        salesforce = {"fixture_key": "f", "canonical": {"provider": "salesforce", "object_type": "User",
            "properties": {"mfa_methods": ["HasTotp"]}}}
        result = evaluate([slack, salesforce])
        self.assertEqual(result["slack"]["status"], "unknown")
        self.assertEqual(len(result["slack"]["enrollment_observations"]), 1)
        self.assertEqual(result["salesforce"]["status"], "not_collected")
        self.assertEqual(len(result["salesforce"]["enrollment_observations"]), 1)
        self.assertEqual(result["atlassian"]["status"], "not_collected")
        self.assertEqual(result["github"][0]["status"], "not_collected")


if __name__ == "__main__":
    unittest.main()
