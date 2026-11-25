"""컴플라이언스 항목 판정 계산(build_compliance_verdicts.py) 단위 시험.
합성 시험값만 사용한다(실제 테넌트 이름 금지).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "build_compliance_verdicts.py")


class BuildComplianceVerdictsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = self.tmp.name

        self.k_dir = os.path.join(self.work, "catalog-mapping")
        os.makedirs(os.path.join(self.k_dir, "items-clean"))
        os.makedirs(os.path.join(self.k_dir, "checks"))

        # 1. item-tiers.jsonl
        tiers = [
            {"item_key": "SYNTH:1.0", "tier": "auto"},
            {"item_key": "SYNTH:1.1", "tier": "auto"},
            {"item_key": "SYNTH:1.2", "tier": "auto"},
            {"item_key": "SYNTH:1.3", "tier": "auto"},
            {"item_key": "SYNTH:1.4", "tier": "evidence"},
            {"item_key": "SYNTH:1.5", "tier": "auto"},
            {"item_key": "SYNTH:1.6", "tier": "exclude"},
            {"item_key": "SYNTH:2.1", "tier": "auto"},
            {"item_key": "SYNTH:2.2", "tier": "auto"},
            {"item_key": "SYNTH:2.3", "tier": "auto"},
            {"item_key": "SYNTH:2.4", "tier": "auto"},
            {"item_key": "SYNTH:2.5", "tier": "auto"},
            {"item_key": "SYNTH:2.6", "tier": "auto"},
        ]
        with open(os.path.join(self.k_dir, "items-clean", "item-tiers.jsonl"), "w", encoding="utf-8") as f:
            for t in tiers:
                f.write(json.dumps(t) + "\n")

        # 2. saas-items.jsonl
        saas_items = [
            {"item_key": "SYNTH:1.0", "framework": "SYNTH", "item_id": "1.0", "title": "Zero"},
            {"item_key": "SYNTH:1.1", "framework": "SYNTH", "item_id": "1.1", "title": "No Check Item"},
            {"item_key": "SYNTH:1.2", "framework": "SYNTH", "item_id": "1.2", "title": "Fail Item"},
            {"item_key": "SYNTH:1.3", "framework": "SYNTH", "item_id": "1.3", "title": "Pass Item"},
            {"item_key": "SYNTH:1.4", "framework": "SYNTH", "item_id": "1.4", "title": "Partial Item"},
            {"item_key": "SYNTH:1.5", "framework": "SYNTH", "item_id": "1.5", "title": "Unknown Item"},
            {"item_key": "SYNTH:1.6", "framework": "SYNTH", "item_id": "1.6", "title": "Exclude Item"},
            {"item_key": "SYNTH:2.1", "framework": "SYNTH", "item_id": "2.1", "title": "Manual Only Item"},
            {"item_key": "SYNTH:2.2", "framework": "SYNTH", "item_id": "2.2", "title": "Manual Notcol Item"},
            {"item_key": "SYNTH:2.3", "framework": "SYNTH", "item_id": "2.3", "title": "Manual Unknown Item"},
            {"item_key": "SYNTH:2.4", "framework": "SYNTH", "item_id": "2.4", "title": "Notcol Only Item"},
            {"item_key": "SYNTH:2.5", "framework": "SYNTH", "item_id": "2.5", "title": "Org Policy Only Item"},
            {"item_key": "SYNTH:2.6", "framework": "SYNTH", "item_id": "2.6", "title": "Pass Notcol Item"},
        ]
        with open(os.path.join(self.k_dir, "items-clean", "saas-items.jsonl"), "w", encoding="utf-8") as f:
            for s in saas_items:
                f.write(json.dumps(s) + "\n")

        # 3. item-findings.jsonl
        item_findings = [
            {"item_key": "SYNTH:1.0", "finding_ids": ["f-pass-1"]},
            {"item_key": "SYNTH:1.1", "finding_ids": ["f-missing-1", "f-missing-2"]},
            {"item_key": "SYNTH:1.2", "finding_ids": ["f-fail-1", "f-pass-1", "f-missing-1"]},
            {"item_key": "SYNTH:1.3", "finding_ids": ["f-pass-2", "f-pass-1"]},
            {"item_key": "SYNTH:1.4", "finding_ids": ["f-pass-1", "f-unknown-1"]},
            {"item_key": "SYNTH:1.5", "finding_ids": ["f-notcol-1", "f-unknown-1"]},
            {"item_key": "SYNTH:1.6", "finding_ids": ["f-fail-1"]},
            {"item_key": "SYNTH:2.1", "finding_ids": ["f-manual-1"]},
            {"item_key": "SYNTH:2.2", "finding_ids": ["f-manual-1", "f-notcol-1"]},
            {"item_key": "SYNTH:2.3", "finding_ids": ["f-manual-1", "f-unknown-1"]},
            {"item_key": "SYNTH:2.4", "finding_ids": ["f-notcol-1"]},
            {"item_key": "SYNTH:2.5", "finding_ids": ["f-orgpol-1"]},
            {"item_key": "SYNTH:2.6", "finding_ids": ["f-pass-1", "f-notcol-1"]},
        ]
        with open(os.path.join(self.k_dir, "checks", "item-findings.jsonl"), "w", encoding="utf-8") as f:
            for i in item_findings:
                f.write(json.dumps(i) + "\n")

        # 4. standard_results.json
        self.results_path = os.path.join(self.work, "standard_results.json")
        init_results = {
            "generated_at": "2026-11-11",
            "note": "synthetic",
            "standards": [],
            "findings": [
                {
                    "id": "f-fail-1",
                    "provider": "synth",
                    "text": "Fail finding",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "1", "status": "fail"}
                    ]
                },
                {
                    "id": "f-pass-1",
                    "provider": "synth",
                    "text": "Pass finding 1",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "2", "status": "pass"}
                    ]
                },
                {
                    "id": "f-pass-2",
                    "provider": "synth",
                    "text": "Pass finding 2",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "3", "status": "pass"}
                    ]
                },
                {
                    "id": "f-unknown-1",
                    "provider": "synth",
                    "text": "Unknown finding",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "4", "status": "unknown"}
                    ]
                },
                {
                    "id": "f-notcol-1",
                    "provider": "synth",
                    "text": "Not collected finding",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "5", "status": "not_collected"}
                    ]
                },
                {
                    "id": "f-manual-1",
                    "provider": "synth",
                    "text": "Manual finding",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "6", "status": "manual"}
                    ]
                },
                {
                    "id": "f-orgpol-1",
                    "provider": "synth",
                    "text": "Org policy finding",
                    "layer": "",
                    "group": "",
                    "kind": "",
                    "items": [
                        {"standard": "S1", "item_id": "7", "status": "org_policy"}
                    ]
                }
            ]
        }
        with open(self.results_path, "w", encoding="utf-8") as f:
            json.dump(init_results, f, ensure_ascii=False, indent=1)

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self):
        return subprocess.run(
            [sys.executable, SCRIPT, "--results", self.results_path, "--knowledge", self.k_dir],
            text=True,
            capture_output=True,
            encoding="utf-8",
            # 경고를 한글로 찍는다. Windows 기본 코드페이지(cp949)로 쓰면 깨져서 시험이 실패하므로 자식도 utf-8 로 쓴다
            env=dict(os.environ, PYTHONIOENCODING="utf-8"),
        )

    def test_verdict_rules_and_exclusions(self):
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)

        with open(self.results_path, "r", encoding="utf-8") as f:
            res = json.load(f)

        self.assertIn("compliance", res)
        # Top key check
        self.assertEqual(list(res.keys())[0], "compliance")

        comp = res["compliance"]
        self.assertIn("knowledge_commit", comp)
        self.assertIn("rule", comp)
        self.assertEqual(
            comp["rule"],
            "not_collected 제외; fail>0 → fail, 전부 pass → pass, pass 있음 → partial, unknown 0건 및 manual/org_policy 있음 → manual, 판정 건 없음 → no_check, 그 밖 → unknown"
        )

        items_by_key = {it["key"]: it for it in comp["items"]}
        for it in comp["items"]:
            self.assertNotIn("not_collected", it["counts"])

        # 1. Exclude item excluded
        self.assertNotIn("SYNTH:1.6", items_by_key)

        # 2. Key sorting
        keys = [it["key"] for it in comp["items"]]
        self.assertEqual(keys, sorted(keys))

        # 3. Rule 1: no_check (missing findings only -> 0 checks)
        it_1_1 = items_by_key["SYNTH:1.1"]
        self.assertEqual(it_1_1["status"], "no_check")
        self.assertEqual(it_1_1["findings"], [])
        self.assertEqual(it_1_1["fail_findings"], [])
        self.assertEqual(sum(it_1_1["counts"].values()), 0)

        # 4. Rule 2: fail (at least 1 fail)
        it_1_2 = items_by_key["SYNTH:1.2"]
        self.assertEqual(it_1_2["status"], "fail")
        self.assertEqual(it_1_2["counts"]["fail"], 1)
        self.assertEqual(it_1_2["counts"]["pass"], 1)
        self.assertEqual(it_1_2["findings"], ["f-fail-1", "f-pass-1"])
        self.assertEqual(it_1_2["fail_findings"], ["f-fail-1"])

        # 5. Rule 3: pass (all items pass)
        it_1_3 = items_by_key["SYNTH:1.3"]
        self.assertEqual(it_1_3["status"], "pass")
        self.assertEqual(it_1_3["counts"]["fail"], 0)
        self.assertEqual(it_1_3["counts"]["pass"], 2)
        self.assertEqual(it_1_3["findings"], ["f-pass-1", "f-pass-2"])
        self.assertEqual(it_1_3["fail_findings"], [])

        # 6. Rule 4: partial (pass > 0, not all pass, no fail)
        it_1_4 = items_by_key["SYNTH:1.4"]
        self.assertEqual(it_1_4["status"], "partial")
        self.assertEqual(it_1_4["tier"], "evidence")
        self.assertEqual(it_1_4["counts"]["pass"], 1)
        self.assertEqual(it_1_4["counts"]["unknown"], 1)
        self.assertEqual(it_1_4["counts"]["fail"], 0)
        self.assertEqual(it_1_4["findings"], ["f-pass-1", "f-unknown-1"])
        self.assertEqual(it_1_4["fail_findings"], [])

        # 7. Rule 5: unknown (no pass, no fail, checks exist; not_collected excluded)
        it_1_5 = items_by_key["SYNTH:1.5"]
        self.assertEqual(it_1_5["status"], "unknown")
        self.assertEqual(it_1_5["counts"]["unknown"], 1)
        self.assertEqual(it_1_5["counts"]["fail"], 0)
        self.assertEqual(it_1_5["counts"]["pass"], 0)
        self.assertEqual(it_1_5["findings"], ["f-unknown-1"])
        self.assertEqual(it_1_5["fail_findings"], [])

        # 8. Rule 5 (new): manual and related combinations
        # manual 만 있는 항목 -> manual
        it_2_1 = items_by_key["SYNTH:2.1"]
        self.assertEqual(it_2_1["status"], "manual")
        self.assertEqual(it_2_1["counts"]["manual"], 1)
        self.assertEqual(it_2_1["counts"]["unknown"], 0)
        self.assertEqual(it_2_1["findings"], ["f-manual-1"])

        # manual + not_collected -> manual (not_collected excluded)
        it_2_2 = items_by_key["SYNTH:2.2"]
        self.assertEqual(it_2_2["status"], "manual")
        self.assertEqual(it_2_2["counts"]["manual"], 1)
        self.assertEqual(it_2_2["counts"]["unknown"], 0)
        self.assertEqual(it_2_2["findings"], ["f-manual-1"])

        # manual + unknown -> unknown
        it_2_3 = items_by_key["SYNTH:2.3"]
        self.assertEqual(it_2_3["status"], "unknown")
        self.assertEqual(it_2_3["counts"]["manual"], 1)
        self.assertEqual(it_2_3["counts"]["unknown"], 1)
        self.assertEqual(it_2_3["findings"], ["f-manual-1", "f-unknown-1"])

        # not_collected 만 -> no_check (findings 비어 있음)
        it_2_4 = items_by_key["SYNTH:2.4"]
        self.assertEqual(it_2_4["status"], "no_check")
        self.assertEqual(sum(it_2_4["counts"].values()), 0)
        self.assertEqual(it_2_4["findings"], [])
        self.assertEqual(it_2_4["fail_findings"], [])

        # org_policy 만 -> manual
        it_2_5 = items_by_key["SYNTH:2.5"]
        self.assertEqual(it_2_5["status"], "manual")
        self.assertEqual(it_2_5["counts"]["org_policy"], 1)
        self.assertEqual(it_2_5["counts"]["unknown"], 0)
        self.assertEqual(it_2_5["findings"], ["f-orgpol-1"])

        # pass + not_collected -> pass
        it_2_6 = items_by_key["SYNTH:2.6"]
        self.assertEqual(it_2_6["status"], "pass")
        self.assertEqual(it_2_6["counts"]["pass"], 1)
        self.assertEqual(it_2_6["findings"], ["f-pass-1"])
        self.assertEqual(it_2_6["fail_findings"], [])

        # 9. Fixes check for f-fail-1
        self.assertIn("fixes", comp)
        self.assertEqual(len(comp["fixes"]), 1)
        fix_1 = comp["fixes"][0]
        self.assertEqual(fix_1["finding"], "f-fail-1")
        self.assertEqual(fix_1["items"], ["SYNTH:1.2"])
        self.assertEqual(fix_1["fail_targets"], 0)
        self.assertEqual(fix_1["score"], 1)

        # 10. Idempotency: running again produces identical file
        with open(self.results_path, "r", encoding="utf-8") as f:
            first_content = f.read()

        r2 = self.run_script()
        self.assertEqual(r2.returncode, 0, r2.stderr)

        with open(self.results_path, "r", encoding="utf-8") as f:
            second_content = f.read()

        self.assertEqual(first_content, second_content)

    def test_linked_finding_without_result_is_kept(self):
        # 연결됐지만 결과 묶음에 없는 finding(f-missing-*)은 판정 셈에는 안 들어가고, 항목과 맨 위 집계, 경고로 드러난다.
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(self.results_path, "r", encoding="utf-8") as f:
            comp = json.load(f)["compliance"]
        by_key = {it["key"]: it for it in comp["items"]}

        self.assertEqual(by_key["SYNTH:1.1"]["no_result_findings"], ["f-missing-1", "f-missing-2"])
        self.assertEqual(by_key["SYNTH:1.1"]["status"], "no_check")
        self.assertEqual(by_key["SYNTH:1.2"]["no_result_findings"], ["f-missing-1"])
        self.assertEqual(by_key["SYNTH:1.2"]["status"], "fail")
        self.assertEqual(by_key["SYNTH:1.2"]["findings"], ["f-fail-1", "f-pass-1"])
        # 결과가 있고 전부 not_collected 인 finding 은 여기에 넣지 않는다(기존 규칙).
        self.assertEqual(by_key["SYNTH:2.4"]["no_result_findings"], [])
        self.assertEqual(by_key["SYNTH:1.3"]["no_result_findings"], [])

        self.assertEqual(comp["no_result_count"], {"items": 2, "links": 3, "findings": 2})
        self.assertIn("f-missing-1", r.stderr)
        self.assertIn("finding 2개", r.stderr)

    def test_no_warning_when_every_link_has_result(self):
        with open(os.path.join(self.k_dir, "checks", "item-findings.jsonl"), "r", encoding="utf-8") as f:
            rows = [json.loads(l) for l in f if l.strip()]
        for row in rows:
            row["finding_ids"] = [fid for fid in row["finding_ids"] if not fid.startswith("f-missing")]
        with open(os.path.join(self.k_dir, "checks", "item-findings.jsonl"), "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row) + "\n")
        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(self.results_path, "r", encoding="utf-8") as f:
            comp = json.load(f)["compliance"]
        self.assertEqual(comp["no_result_count"], {"items": 0, "links": 0, "findings": 0})
        self.assertEqual(r.stderr.strip(), "")

    def test_fixes_order_and_score(self):
        # Add extra items and findings with targets to test fixes sorting
        with open(os.path.join(self.k_dir, "checks", "item-findings.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"item_key": "SYNTH:1.0", "finding_ids": ["f-high"]}) + "\n")
            f.write(json.dumps({"item_key": "SYNTH:1.1", "finding_ids": ["f-high"]}) + "\n")
            f.write(json.dumps({"item_key": "SYNTH:1.3", "finding_ids": ["f-low-b"]}) + "\n")
            f.write(json.dumps({"item_key": "SYNTH:1.4", "finding_ids": ["f-low-a"]}) + "\n")

        with open(self.results_path, "r", encoding="utf-8") as f:
            results = json.load(f)

        results["findings"].extend([
            {
                "id": "f-high",
                "provider": "synth",
                "text": "High priority fail",
                "layer": "", "group": "", "kind": "",
                "items": [
                    {
                        "standard": "S1", "item_id": "10", "status": "fail",
                        "targets": [
                            {"key": "t1", "status": "fail"},
                            {"key": "t2", "status": "fail"},
                            {"key": "t3", "status": "pass"},
                        ]
                    }
                ]
            },
            {
                "id": "f-low-b",
                "provider": "synth",
                "text": "Low priority fail B",
                "layer": "", "group": "", "kind": "",
                "items": [{"standard": "S1", "item_id": "11", "status": "fail"}]
            },
            {
                "id": "f-low-a",
                "provider": "synth",
                "text": "Low priority fail A",
                "layer": "", "group": "", "kind": "",
                "items": [{"standard": "S1", "item_id": "12", "status": "fail"}]
            }
        ])

        with open(self.results_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)

        r = self.run_script()
        self.assertEqual(r.returncode, 0, r.stderr)

        with open(self.results_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        fixes = data["compliance"]["fixes"]
        # f-high: items=["SYNTH:1.0", "SYNTH:1.1"] (2), fail_targets=2 (t1, t2) -> score = 2 * 2 = 4
        # f-fail-1: items=["SYNTH:1.2"] (1), fail_targets=0 -> score = 1 * 1 = 1
        # f-low-a: items=["SYNTH:1.4"] (1), fail_targets=0 -> score = 1 * 1 = 1
        # f-low-b: items=["SYNTH:1.3"] (1), fail_targets=0 -> score = 1 * 1 = 1
        # Equal scores are sorted by finding id asc: f-fail-1, f-low-a, f-low-b
        self.assertEqual(len(fixes), 4)
        self.assertEqual(fixes[0]["finding"], "f-high")
        self.assertEqual(fixes[0]["score"], 4)
        self.assertEqual(fixes[0]["fail_targets"], 2)
        self.assertEqual(fixes[0]["items"], ["SYNTH:1.0", "SYNTH:1.1"])

        self.assertEqual(fixes[1]["finding"], "f-fail-1")
        self.assertEqual(fixes[1]["score"], 1)

        self.assertEqual(fixes[2]["finding"], "f-low-a")
        self.assertEqual(fixes[2]["score"], 1)

        self.assertEqual(fixes[3]["finding"], "f-low-b")
        self.assertEqual(fixes[3]["score"], 1)


if __name__ == "__main__":
    unittest.main()
