"""부분 SaaS 수집에서 기준 판정 묶음이 계속 만들어지는지 확인한다."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OKTA_FIXTURE = os.path.join(ROOT, "adapter-auto-setup", "local", "experiment", "raw", "20261002T162805Z-687d", "okta")


class RunAllTest(unittest.TestCase):
    def run_all(self, raw, dataset, out):
        return subprocess.run(
            [sys.executable, os.path.join(HERE, "run_all.py"), "--raw", raw, "--dataset", dataset, "--out", out],
            cwd=ROOT, text=True, capture_output=True, encoding="utf-8",
        )

    def test_okta_only_run_skips_other_saas_and_writes_bundle(self):
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "raw", "okta-only")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            os.makedirs(raw)
            os.makedirs(dataset)
            shutil.copytree(OKTA_FIXTURE, os.path.join(raw, "okta"))
            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            result = self.run_all(raw, dataset, out)
            self.assertEqual(result.returncode, 0, result.stderr)
            with open(os.path.join(out, "standard_results.json"), encoding="utf-8") as f:
                bundle = json.load(f)
            self.assertEqual({s["provider"] for s in bundle["standards"]}, {"okta"})
            self.assertEqual(bundle["failed_detectors"], [])
            with open(os.path.join(out, "cis_github.json"), encoding="utf-8") as f:
                skipped = json.load(f)
            self.assertTrue(skipped["not_applicable"])
            self.assertEqual(skipped["items"], [])

    def test_failed_detector_is_listed_but_does_not_prevent_bundle(self):
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "raw", "broken-okta")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            os.makedirs(os.path.join(raw, "okta"))
            os.makedirs(dataset)
            with open(os.path.join(raw, "okta", "OK-10-0001.json"), "w", encoding="utf-8") as f:
                json.dump({}, f)
            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            result = self.run_all(raw, dataset, out)
            self.assertNotEqual(result.returncode, 0)
            with open(os.path.join(out, "standard_results.json"), encoding="utf-8") as f:
                bundle = json.load(f)
            # AEGI 자체 점검(aegi_okta)은 사용자 원본(OK-02)이 없으면 실패하지 않고 미수집으로 남긴다
            self.assertEqual([s["id"] for s in bundle["standards"]], ["AEGI 점검 (Okta)"])
            self.assertEqual(bundle["failed_detectors"], ["okta_healthinsight", "okta_stig"])


    def test_gws_checklist_without_optional_policies_does_not_fail(self):
        # 최상위 조직 정책이 없는 GWS 수집(권한 부족 등)에서도 체크리스트 판정기는 멈추지 않고 수집 없음으로 남긴다
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "raw", "gws-no-policies")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            gw = os.path.join(raw, "gws")
            os.makedirs(gw)
            os.makedirs(dataset)
            def put(name, payload):
                with open(os.path.join(gw, name), "w", encoding="utf-8") as f:
                    json.dump({"collected_at": "2026-01-01T00:00:00Z", "request_params": {}, "payload": payload}, f)
            put("GW-03-0001.json", {"users": [{"id": "100000000000000000001", "primaryEmail": "synthetic.user@example.com", "isAdmin": True,
                                               "suspended": False, "isEnforcedIn2Sv": True, "lastLoginTime": "2025-12-31T00:00:00Z"}]})
            put("GW-20-0001.json", {"organizationUnits": [{"orgUnitPath": "/sub", "parentOrgUnitPath": "/", "parentOrgUnitId": "id:root000"}]})
            put("GW-24-0001.json", {"policies": []})
            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            result = self.run_all(raw, dataset, out)
            with open(os.path.join(out, "standard_results.json"), encoding="utf-8") as f:
                bundle = json.load(f)
            self.assertNotIn("gws_checklist_medium_large", bundle["failed_detectors"], result.stderr)
            self.assertNotIn("gws_checklist_small", bundle["failed_detectors"], result.stderr)
            with open(os.path.join(out, "gws_checklist_medium_large.json"), encoding="utf-8") as f:
                items = {i["item_id"]: i for i in json.load(f)["items"]}
            for iid in ("Apps: Allowlist of approved third-party apps", "Google Chat: Limit external chat and rooms", "Drive: Shared drive creation and settings"):
                self.assertEqual(items[iid]["status"], "not_collected", iid)

    def test_gws_mobile_devices_and_groups_settings_and_github_2fa_packages(self):
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "raw", "synth-run")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            gw = os.path.join(raw, "gws")
            gh = os.path.join(raw, "github")
            os.makedirs(gw)
            os.makedirs(gh)
            os.makedirs(dataset)

            def put(dirpath, name, payload, params=None):
                with open(os.path.join(dirpath, name), "w", encoding="utf-8") as f:
                    json.dump({"collected_at": "2026-01-01T00:00:00Z", "request_params": params or {}, "payload": payload}, f)

            put(gw, "GW-03-0001.json", {"users": [{"id": "100000000000000000001", "primaryEmail": "admin@example.com", "isAdmin": True, "suspended": False, "isEnforcedIn2Sv": True, "lastLoginTime": "2025-12-31T00:00:00Z"}]})
            put(gw, "GW-04-0001.json", {"groups": [{"id": "g1", "email": "team@example.com", "name": "Team"}]})
            put(gw, "GW-20-0001.json", {"organizationUnits": [{"orgUnitPath": "/sub", "parentOrgUnitPath": "/", "parentOrgUnitId": "id:root000"}]})
            put(gw, "GW-24-0001.json", {"policies": []})
            put(gw, "RG-GW-directory.mobiledevices.list-0001.json", {"kind": "directory#mobiledevices", "etag": "e1"})
            put(gw, "RG-GW-groupsSettings.groups.get-0001.json", {
                "kind": "groupsSettings#groups",
                "email": "team@example.com",
                "whoCanJoin": "ANYONE_CAN_JOIN",
                "whoCanViewGroup": "ANYONE_CAN_VIEW",
                "whoCanViewMembership": "ALL_MEMBERS_CAN_VIEW",
                "whoCanPostMessage": "ANYONE_CAN_POST",
                "whoCanDiscoverGroup": "ANYONE_CAN_DISCOVER",
                "allowExternalMembers": "true",
                "spamModerationLevel": "ALLOW",
            }, {"groupUniqueId": "team@example.com"})

            put(gh, "GH-01-0001.json", {"id": 1, "login": "acme", "two_factor_requirement_enabled": True, "members_can_create_repositories": False, "members_can_fork_private_repositories": False, "default_repository_permission": "read", "is_verified": True})
            put(gh, "GH-02-0001.json", [])
            put(gh, "GH-05-0001.json", [])
            put(gh, "GHS-01-0001.json", {"enabled_repositories": "selected", "allowed_actions": "selected"})
            put(gh, "GHS-02-0001.json", {"default_workflow_permissions": "read", "can_approve_pull_request_reviews": False})
            put(gh, "GH-33-0001.json", [], {"package_type": "npm"})
            put(gh, "GH-35-0001.json", [{"id": 901, "login": "ext-no-2fa"}], {"filter": "2fa_disabled"})

            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            result = self.run_all(raw, dataset, out)
            self.assertEqual(result.returncode, 0, result.stderr)

            with open(os.path.join(out, "gws_security_health.json"), encoding="utf-8") as f:
                sh = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(sh["Device management: Mobile inactivity reports"]["status"], "pass")

            with open(os.path.join(out, "gws_checklist_medium_large.json"), encoding="utf-8") as f:
                ml = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(ml["Google Groups: Set groups to Private"]["status"], "fail")
            self.assertEqual(ml["Google Groups: Internal groups no public access"]["status"], "fail")
            self.assertEqual(ml["Google Groups: Access settings"]["status"], "org_policy")
            self.assertEqual(ml["Google Groups: Spam moderation"]["status"], "fail")

            with open(os.path.join(out, "cis_github.json"), encoding="utf-8") as f:
                cg = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(cg["4.2.2"]["status"], "pass")
            self.assertEqual(cg["1.3.4"]["status"], "fail")

            with open(os.path.join(out, "github_docs_data_leaks.json"), encoding="utf-8") as f:
                gd = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(gd["Secure accounts / 2FA members and collaborators"]["status"], "fail")

            # 통과 / org_policy 분기 확인
            put(gw, "RG-GW-directory.mobiledevices.list-0001.json", {"mobiledevices": [{"resourceId": "m1", "model": "Pixel", "lastSync": "2025-01-01T00:00:00Z"}]})
            put(gw, "RG-GW-groupsSettings.groups.get-0001.json", {
                "kind": "groupsSettings#groups",
                "email": "team@example.com",
                "whoCanJoin": "INVITED_CAN_JOIN",
                "whoCanViewGroup": "ALL_MEMBERS_CAN_VIEW",
                "whoCanViewMembership": "ALL_MEMBERS_CAN_VIEW",
                "whoCanPostMessage": "ALL_MEMBERS_CAN_POST",
                "whoCanDiscoverGroup": "ALL_MEMBERS_CAN_DISCOVER",
                "allowExternalMembers": "false",
                "spamModerationLevel": "MODERATE",
            }, {"groupUniqueId": "team@example.com"})
            put(gh, "GH-33-0001.json", [{"id": 10, "name": "pkg-a", "package_type": "npm", "visibility": "private"}], {"package_type": "npm"})
            put(gh, "GH-35-0001.json", [], {"filter": "2fa_disabled"})

            result2 = self.run_all(raw, dataset, out)
            self.assertEqual(result2.returncode, 0, result2.stderr)
            with open(os.path.join(out, "gws_security_health.json"), encoding="utf-8") as f:
                sh2 = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(sh2["Device management: Mobile inactivity reports"]["status"], "org_policy")
            with open(os.path.join(out, "gws_checklist_medium_large.json"), encoding="utf-8") as f:
                ml2 = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(ml2["Google Groups: Set groups to Private"]["status"], "pass")
            self.assertEqual(ml2["Google Groups: Internal groups no public access"]["status"], "pass")
            self.assertEqual(ml2["Google Groups: Spam moderation"]["status"], "pass")
            with open(os.path.join(out, "cis_github.json"), encoding="utf-8") as f:
                cg2 = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(cg2["4.2.2"]["status"], "org_policy")
            self.assertEqual(cg2["1.3.4"]["status"], "pass")
            with open(os.path.join(out, "github_docs_data_leaks.json"), encoding="utf-8") as f:
                gd2 = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(gd2["Secure accounts / 2FA members and collaborators"]["status"], "pass")

    def test_github_hooks_admins_code_scanning_and_gws_recovery_phone(self):
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "raw", "gaps-run")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            gw = os.path.join(raw, "gws")
            gh = os.path.join(raw, "github")
            os.makedirs(gw)
            os.makedirs(gh)
            os.makedirs(dataset)

            def put(dirpath, name, payload, params=None, endpoint=None):
                env = {"collected_at": "2026-01-01T00:00:00Z", "request_params": params or {}, "payload": payload}
                if endpoint:
                    env["endpoint"] = endpoint
                with open(os.path.join(dirpath, name), "w", encoding="utf-8") as f:
                    json.dump(env, f)

            put(gw, "GW-03-0001.json", {"users": [
                {"id": "u1", "primaryEmail": "a1@example.test", "isAdmin": True, "suspended": False, "recoveryEmail": "r@example.test"},
                {"id": "u2", "primaryEmail": "a2@example.test", "isAdmin": True, "suspended": False, "recoveryEmail": "r2@example.test", "recoveryPhone": "+10000000000"},
            ]}, endpoint="https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&projection=full&maxResults=500")
            put(gw, "GW-04-0001.json", {"groups": []})
            put(gw, "GW-20-0001.json", {"organizationUnits": [{"orgUnitPath": "/sub", "parentOrgUnitPath": "/", "parentOrgUnitId": "id:root000"}]})
            put(gw, "GW-24-0001.json", {"policies": []})

            put(gh, "GH-01-0001.json", {"id": 1, "login": "acme"})
            put(gh, "GH-02-0001.json", [], {"role": "admin"})
            put(gh, "GH-05-0001.json", [
                {"id": 101, "name": "repo-a", "default_branch": "main", "visibility": "private", "pushed_at": "2026-01-01T00:00:00Z", "security_and_analysis": {"code_security": {"status": "disabled"}}},
                {"id": 102, "name": "repo-b", "default_branch": "main", "visibility": "private", "pushed_at": "2026-01-01T00:00:00Z", "security_and_analysis": {"code_security": {"status": "disabled"}}},
            ])
            put(gh, "GHS-01-0001.json", {"enabled_repositories": "selected"})
            put(gh, "GHS-02-0001.json", {"default_workflow_permissions": "read"})
            put(gh, "GH-15-0001.json", [
                {"id": 1, "config": {"url": {"host": "hooks.example.test", "scheme": "https", "sha256": "aa"}, "insecure_ssl": "0"}},
                {"id": 2, "config": {"url": {"host": "hooks.example.test", "scheme": "http", "sha256": "bb"}, "insecure_ssl": "0"}},
            ])
            put(gh, "GHS-04-0001.json", [
                {"id": 10, "login": "admin1", "permissions": {"admin": True}},
                {"id": 11, "login": "admin2", "permissions": {"admin": True}},
            ], {"repo": "repo-a", "affiliation": "all"})
            put(gh, "GHS-04-0002.json", [
                {"id": 10, "login": "admin1", "permissions": {"admin": True}},
            ], {"repo": "repo-b", "affiliation": "all"})
            put(gh, "GHS-05-0001.json", {"state": "configured"}, {"repo": "repo-a"})
            put(gh, "GHS-05-0002.json", {"state": "not-configured"}, {"repo": "repo-b"})

            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            result = self.run_all(raw, dataset, out)
            self.assertEqual(result.returncode, 0, result.stderr)

            with open(os.path.join(out, "gws_checklist_small.json"), encoding="utf-8") as f:
                sm = {i["item_id"]: i for i in json.load(f)["items"]}
            rec_item = next(i for k, i in sm.items() if k.startswith("3."))
            self.assertEqual(rec_item["status"], "fail")
            self.assertEqual([t["status"] for t in rec_item["targets"]], ["fail", "pass"])
            self.assertEqual(rec_item["targets"][0]["value"]["recoveryPhone"], "없음")

            with open(os.path.join(out, "cis_github.json"), encoding="utf-8") as f:
                cg = {i["item_id"]: i for i in json.load(f)["items"]}
            self.assertEqual(cg["1.4.4"]["status"], "fail")
            self.assertEqual([t["status"] for t in cg["1.4.4"]["targets"]], ["pass", "fail"])
            self.assertEqual(cg["1.3.7"]["status"], "fail")
            self.assertEqual([t["status"] for t in cg["1.3.7"]["targets"]], ["pass", "fail"])
            self.assertEqual(cg["1.5.4"]["status"], "fail")
            self.assertEqual([t["status"] for t in cg["1.5.4"]["targets"]], ["pass", "fail"])
            self.assertEqual(cg["1.5.4"]["targets"][1]["value"]["code_security"], "disabled")

    def test_zero_packages_is_pass_only_when_gh33_run_record_is_full(self):
        # GH-33 은 package_type 마다 부르고 한 종류가 400 이면 partial 이다(11-04 실측: container http_400).
        # 받은 쪽이 모두 빈 목록이면 cis_github 4.2.2 는 pass 를 내지만, 묶음(standard_results)에서는 실행 기록이 full 일 때만 pass 로 둔다
        with tempfile.TemporaryDirectory() as work:
            raw = os.path.join(work, "collected", "raw", "pkg-run")
            runs = os.path.join(work, "collected", "runs")
            dataset = os.path.join(work, "dataset")
            out = os.path.join(work, "out")
            gh = os.path.join(raw, "github")
            os.makedirs(gh)
            os.makedirs(runs)
            os.makedirs(dataset)

            def put(name, payload, params=None):
                with open(os.path.join(gh, name), "w", encoding="utf-8") as f:
                    json.dump({"collected_at": "2026-01-01T00:00:00Z", "request_params": params or {}, "payload": payload}, f)

            put("GH-01-0001.json", {"id": 1, "login": "acme", "two_factor_requirement_enabled": True})
            put("GH-02-0001.json", [])
            put("GH-05-0001.json", [])
            put("GHS-01-0001.json", {"enabled_repositories": "selected", "allowed_actions": "selected"})
            put("GHS-02-0001.json", {"default_workflow_permissions": "read", "can_approve_pull_request_reviews": False})
            put("GH-33-0001.json", [], {"package_type": "npm"})
            with open(os.path.join(dataset, "objects.json"), "w", encoding="utf-8") as f:
                json.dump([], f)

            def run_with(gh33):
                calls = [{"call_id": c, "provider": "github", "completeness": "full", "reasons": []} for c in ("GH-01", "GH-02", "GH-05", "GHS-01", "GHS-02")]
                calls.append({"call_id": "GH-33", "provider": "github", "completeness": gh33, "reasons": [] if gh33 == "full" else ["packages:container:http_400"]})
                with open(os.path.join(runs, "pkg-run.json"), "w", encoding="utf-8") as f:
                    json.dump({"run_id": "pkg-run", "calls": calls}, f)
                result = self.run_all(raw, dataset, out)
                self.assertEqual(result.returncode, 0, result.stderr)
                with open(os.path.join(out, "cis_github.json"), encoding="utf-8") as f:
                    raw_item = {i["item_id"]: i for i in json.load(f)["items"]}["4.2.2"]
                with open(os.path.join(out, "standard_results.json"), encoding="utf-8") as f:
                    bundle = json.load(f)
                item = next(i for fd in bundle["findings"] for i in fd["items"] if i["standard"] == "CIS GitHub 1.2.0" and i["item_id"] == "4.2.2")
                return raw_item, item

            raw_item, item = run_with("partial")
            self.assertEqual(raw_item["status"], "pass", "판정기는 그대로 패키지 0개를 pass 로 낸다")
            self.assertEqual(item["status"], "not_collected", "GH-33 partial + 패키지 0개 → 미수집")
            self.assertIn("GH-33 partial", item["note"])
            _, item = run_with("failed")
            self.assertEqual(item["status"], "not_collected")
            _, item = run_with("full")
            self.assertEqual(item["status"], "pass", "GH-33 full + 패키지 0개 → 기존대로 pass")
            os.remove(os.path.join(runs, "pkg-run.json"))
            self.assertEqual(self.run_all(raw, dataset, out).returncode, 0)
            with open(os.path.join(out, "standard_results.json"), encoding="utf-8") as f:
                bundle = json.load(f)
            item = next(i for fd in bundle["findings"] for i in fd["items"] if i["standard"] == "CIS GitHub 1.2.0" and i["item_id"] == "4.2.2")
            self.assertEqual(item["status"], "not_collected", "실행 기록이 없으면 정말 없는지 몰라 미수집")


if __name__ == "__main__":
    unittest.main()
