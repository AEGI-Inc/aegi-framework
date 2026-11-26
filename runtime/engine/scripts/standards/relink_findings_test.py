"""standard_results.json 의 finding id 재연결(relink_findings.py) 단위 시험.
합성 시험값만 사용한다(실제 테넌트 이름 금지).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "relink_findings.py")


class RelinkFindingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_relink_salesforce_healthcheck(self):
        results_path = os.path.join(self.work, "standard_results.json")
        init_data = {
            "generated_at": "2026-11-12",
            "standards": [
                {
                    "id": "Salesforce Health Check",
                    "name": "Salesforce Health Check 기본 기준선 (SecurityHealthCheckRisks StandardValue)",
                    "tier": 2,
                    "provider": "salesforce",
                    "raw_run": "synth-run",
                }
            ],
            "compliance": {"note": "do not touch this"},
            "findings": [
                {
                    "id": "Salesforce Health Check:Identity.mfaForAllEnforced",
                    "provider": "salesforce",
                    "text": "모든 직접 UI 로그인에 MFA 요구",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {
                            "standard": "Salesforce Health Check",
                            "item_id": "Identity.mfaForAllEnforced",
                            "title": "모든 직접 UI 로그인에 MFA 요구",
                            "status": "fail",
                            "threshold": "적용됨",
                            "rule": {"condition": "MEETS_STANDARD"},
                            "targets": [],
                            "note": "",
                        }
                    ],
                }
            ],
        }
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(init_data, f, ensure_ascii=False, indent=1)

        r = subprocess.run(
            [sys.executable, SCRIPT, "--results", results_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        self.assertIn("Salesforce Health Check:Identity.mfaForAllEnforced -> salesforce-063", r.stdout)

        with open(results_path, "r", encoding="utf-8") as f:
            updated = json.load(f)

        self.assertEqual(updated.get("compliance"), {"note": "do not touch this"})
        self.assertEqual(len(updated["findings"]), 1)
        f0 = updated["findings"][0]
        self.assertEqual(f0["id"], "salesforce-063")
        self.assertEqual(f0["text"], "모든 직접 UI 로그인 MFA 요구 미적용")
        self.assertEqual(f0["layer"], "조직 설정")
        self.assertEqual(f0["kind"], "S1 인증·세션 정책")
        self.assertEqual(len(f0["items"]), 1)
        self.assertEqual(f0["items"][0]["item_id"], "Identity.mfaForAllEnforced")

    def test_unmapped_id_stays_unchanged(self):
        results_path = os.path.join(self.work, "standard_results.json")
        init_data = {
            "generated_at": "2026-11-12",
            "findings": [
                {
                    "id": "Custom Standard:Unknown.Item",
                    "provider": "custom",
                    "text": "알 수 없는 항목",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "Custom Standard", "item_id": "Unknown.Item", "status": "pass"}
                    ],
                }
            ],
        }
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(init_data, f, ensure_ascii=False, indent=1)

        r = subprocess.run(
            [sys.executable, SCRIPT, "--results", results_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        with open(results_path, "r", encoding="utf-8") as f:
            updated = json.load(f)

        self.assertEqual(len(updated["findings"]), 1)
        f0 = updated["findings"][0]
        self.assertEqual(f0["id"], "Custom Standard:Unknown.Item")
        self.assertEqual(f0["text"], "알 수 없는 항목")

    def test_merge_when_target_already_exists(self):
        results_path = os.path.join(self.work, "standard_results.json")
        init_data = {
            "generated_at": "2026-11-12",
            "findings": [
                {
                    "id": "salesforce-063",
                    "provider": "salesforce",
                    "text": "모든 직접 UI 로그인 MFA 요구 미적용",
                    "layer": "조직 설정",
                    "group": "",
                    "kind": "S1 인증·세션 정책",
                    "items": [
                        {"standard": "Other Standard", "item_id": "other.1", "status": "pass"}
                    ],
                },
                {
                    "id": "Salesforce Health Check:Identity.mfaForAllEnforced",
                    "provider": "salesforce",
                    "text": "모든 직접 UI 로그인에 MFA 요구",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {
                            "standard": "Salesforce Health Check",
                            "item_id": "Identity.mfaForAllEnforced",
                            "status": "fail",
                        }
                    ],
                },
            ],
        }
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(init_data, f, ensure_ascii=False, indent=1)

        subprocess.run(
            [sys.executable, SCRIPT, "--results", results_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        with open(results_path, "r", encoding="utf-8") as f:
            updated = json.load(f)

        self.assertEqual(len(updated["findings"]), 1)
        f0 = updated["findings"][0]
        self.assertEqual(f0["id"], "salesforce-063")
        self.assertEqual(len(f0["items"]), 2)
        item_ids = [it["item_id"] for it in f0["items"]]
        self.assertIn("other.1", item_ids)
        self.assertIn("Identity.mfaForAllEnforced", item_ids)

    def test_running_twice_gives_same_file(self):
        results_path = os.path.join(self.work, "standard_results.json")
        init_data = {
            "generated_at": "2026-11-12",
            "findings": [
                {
                    "id": "Salesforce Health Check:Identity.mfaForAllEnforced",
                    "provider": "salesforce",
                    "text": "모든 직접 UI 로그인에 MFA 요구",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {
                            "standard": "Salesforce Health Check",
                            "item_id": "Identity.mfaForAllEnforced",
                            "status": "fail",
                        }
                    ],
                }
            ],
        }
        with open(results_path, "w", encoding="utf-8") as f:
            json.dump(init_data, f, ensure_ascii=False, indent=1)

        subprocess.run(
            [sys.executable, SCRIPT, "--results", results_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        with open(results_path, "r", encoding="utf-8") as f:
            content_after_first = f.read()

        subprocess.run(
            [sys.executable, SCRIPT, "--results", results_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        with open(results_path, "r", encoding="utf-8") as f:
            content_after_second = f.read()

        self.assertEqual(content_after_first, content_after_second)


if __name__ == "__main__":
    unittest.main()
