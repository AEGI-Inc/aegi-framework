"""점검 조치 데이터(scripts/standards/defs/remediations_all.json) 단위 시험.
429개 점검 모두 정의되어 있고 스키마 규칙을 준수하는지 검증한다.
"""
from collections import Counter
import json
import os
import unittest
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DEFS_DIR = os.path.join(HERE, "defs")
REMEDIATIONS_PATH = os.path.join(DEFS_DIR, "remediations_all.json")
FINDINGS_UNIQUE_PATH = os.path.join(DEFS_DIR, "findings_unique_all.json")

REQUIRED_KEYS = (
    "finding_id",
    "summary",
    "where",
    "api",
    "change",
    "steps",
    "impact",
    "verify",
    "references",
    "review",
)

REQUIRED_CHANGE_KEYS = ("setting", "recommended")
REQUIRED_REF_KEYS = ("source", "item", "url")
ALLOWED_REVIEWS = {"검토 전", "근거 부족"}


class RemediationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(REMEDIATIONS_PATH, "r", encoding="utf-8") as f:
            cls.raw_text = f.read()
            cls.items = json.loads(cls.raw_text)

        with open(FINDINGS_UNIQUE_PATH, "r", encoding="utf-8") as f:
            cls.unique_fids = {x["finding_id"] for x in json.load(f)}

    def test_total_count_and_no_duplicates(self):
        self.assertEqual(len(self.items), 429)
        fids = [item["finding_id"] for item in self.items]
        self.assertEqual(len(fids), len(set(fids)), "중복된 finding_id 가 있습니다")
        self.assertEqual(fids, sorted(fids), "finding_id 순서대로 정렬되어야 합니다")

    def test_finding_ids_in_unique_all(self):
        for item in self.items:
            fid = item.get("finding_id")
            self.assertIn(fid, self.unique_fids, f"findings_unique_all 에 없는 finding_id: {fid}")

    def test_no_dot_character(self):
        self.assertNotIn("·", self.raw_text, "가운뎃점(·)이 포함되어 있습니다")
        self.assertNotIn("\u00b7", self.raw_text, "가운뎃점(U+00B7)이 포함되어 있습니다")

    def test_required_fields_and_types(self):
        for item in self.items:
            fid = item.get("finding_id", "unknown")
            for k in REQUIRED_KEYS:
                self.assertIn(k, item, f"필수 칸 누락 ({fid}): {k}")

            # change object check
            change = item["change"]
            self.assertIsInstance(change, dict, f"change 는 객체여야 합니다 ({fid})")
            for ck in REQUIRED_CHANGE_KEYS:
                self.assertIn(ck, change, f"change 필수 칸 누락 ({fid}): {ck}")
                self.assertIsInstance(change[ck], str, f"change.{ck} 는 문자열이어야 합니다 ({fid})")

            # steps check
            steps = item["steps"]
            self.assertIsInstance(steps, list, f"steps 는 배열이어야 합니다 ({fid})")
            self.assertGreaterEqual(len(steps), 1, f"steps 는 1개 이상이어야 합니다 ({fid})")
            for s in steps:
                self.assertIsInstance(s, str, f"step 은 문자열이어야 합니다 ({fid})")

            # references check
            refs = item["references"]
            self.assertIsInstance(refs, list, f"references 는 배열이어야 합니다 ({fid})")
            self.assertGreaterEqual(len(refs), 1, f"references 는 1개 이상이어야 합니다 ({fid})")
            for r in refs:
                self.assertIsInstance(r, dict, f"reference 는 객체여야 합니다 ({fid})")
                for rk in REQUIRED_REF_KEYS:
                    self.assertIn(rk, r, f"reference 필수 칸 누락 ({fid}): {rk}")
                    self.assertIsInstance(r[rk], str, f"reference.{rk} 는 문자열이어야 합니다 ({fid})")

            # review check
            review = item["review"]
            self.assertIn(review, ALLOWED_REVIEWS, f"유효하지 않은 review 값 ({fid}): {review}")

            if review == "근거 부족":
                self.assertEqual(item["where"], "", f"근거 부족 시 where 는 빈 문자열이어야 합니다 ({fid})")
                self.assertEqual(
                    item["steps"],
                    ["공식 문서에서 이 설정 위치 확인 필요"],
                    f"근거 부족 시 steps 확인 필요 ({fid})",
                )

    def test_no_template_steps(self):
        for item in self.items:
            fid = item.get("finding_id", "unknown")
            for step in item.get("steps", []):
                self.assertNotIn("권장값(", step, f"steps 에 '권장값(' 틀 문구가 있습니다 ({fid}): {step}")
                self.assertNotIn("설정을 찾아", step, f"steps 에 '설정을 찾아' 틀 문구가 있습니다 ({fid}): {step}")

    def test_impact_sentence_frequency(self):
        impact_counts = Counter(it.get("impact") for it in self.items)
        most_common_imp, count = impact_counts.most_common(1)[0]
        self.assertLessEqual(
            count,
            20,
            f"같은 impact 문장이 20개를 초과했습니다 ({count}건): {most_common_imp}",
        )

    def test_no_root_url_for_unreviewed(self):
        for item in self.items:
            fid = item.get("finding_id", "unknown")
            if item.get("review") == "검토 전":
                non_root_found = False
                for ref in item.get("references", []):
                    u = ref.get("url", "")
                    if u:
                        path = urlparse(u).path.rstrip("/")
                        if path not in ("", "/a"):
                            non_root_found = True
                            break
                self.assertTrue(
                    non_root_found,
                    f"review 가 '검토 전'인데 모든 url 이 도메인 첫 화면입니다 ({fid})",
                )

    def test_unreviewed_items_concrete_requirements(self):
        forbidden_steps = ("기준선 요", "요건에 맞게", "요구에 맞게", "확인 필요")
        forbidden_impact = ("위험이 완화", "보안이 강화", "기준 충족")
        for item in self.items:
            fid = item.get("finding_id", "unknown")
            if item.get("review") == "검토 전":
                steps = item.get("steps", [])
                self.assertGreaterEqual(
                    len(steps),
                    2,
                    f"검토 전 항목의 steps 는 2줄 이상이어야 합니다 ({fid}): {steps}",
                )
                for step in steps:
                    for fb in forbidden_steps:
                        self.assertNotIn(
                            fb,
                            step,
                            f"검토 전 steps 에 금지 문구 '{fb}' 포함 ({fid}): {step}",
                        )
                impact = item.get("impact", "")
                for fb in forbidden_impact:
                    self.assertNotIn(
                        fb,
                        impact,
                        f"검토 전 impact 에 금지 문구 '{fb}' 포함 ({fid}): {impact}",
                    )
                rec = item.get("change", {}).get("recommended", "")
                self.assertNotIn(
                    "확인 필요",
                    rec,
                    f"검토 전 change.recommended 에 '확인 필요' 포함 ({fid}): {rec}",
                )


if __name__ == "__main__":
    unittest.main()
