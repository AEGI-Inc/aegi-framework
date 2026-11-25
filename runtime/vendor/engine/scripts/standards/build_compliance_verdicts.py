"""컴플라이언스 항목 판정 계산.
standard_results.json 의 findings 와 knowledge catalog-mapping 의 연결을 대조해
tier 가 auto, evidence 인 항목의 판정(status, counts, fail_findings, findings)을 계산하고
standard_results.json 의 맨 위 compliance 칸에 싣는다.
"""
import argparse
import json
import os
import subprocess
import sys

RULE_TEXT = "not_collected 제외; fail>0 → fail, 전부 pass → pass, pass 있음 → partial, unknown 0건 및 manual/org_policy 있음 → manual, 판정 건 없음 → no_check, 그 밖 → unknown"
COUNT_KEYS = ("pass", "fail", "unknown", "org_policy", "manual")


def get_knowledge_commit(knowledge_dir):
    try:
        r = subprocess.run(
            ["git", "-C", knowledge_dir, "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        sha = r.stdout.strip()
        if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha):
            return sha
    except Exception:
        pass
    return "unknown"


def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def compute_compliance_verdicts(results_data, knowledge_dir):
    commit_sha = get_knowledge_commit(knowledge_dir)

    tiers_path = os.path.join(knowledge_dir, "items-clean", "item-tiers.jsonl")
    saas_items_path = os.path.join(knowledge_dir, "items-clean", "saas-items.jsonl")
    item_findings_path = os.path.join(knowledge_dir, "checks", "item-findings.jsonl")

    tiers_rows = load_jsonl(tiers_path)
    saas_items_rows = load_jsonl(saas_items_path)
    item_findings_rows = load_jsonl(item_findings_path)

    tiers = {row["item_key"]: row["tier"] for row in tiers_rows}
    saas_items = {row["item_key"]: row for row in saas_items_rows}
    item_findings = {row["item_key"]: row.get("finding_ids", []) for row in item_findings_rows}

    # Index findings from results_data
    results_findings = {f["id"]: f for f in results_data.get("findings", [])}

    items = []
    for item_key, tier in tiers.items():
        if tier not in ("auto", "evidence"):
            continue
        saas_item = saas_items.get(item_key)
        if not saas_item:
            continue

        raw_fids = item_findings.get(item_key, [])
        # Only findings present in results_findings
        matched_fids = sorted(fid for fid in raw_fids if fid in results_findings)
        # 연결됐지만 이 결과 묶음에 점검 결과가 없는 finding(판정기가 안 돌았거나 그 항목을 내지 않음).
        # 판정 셈에는 넣지 않고(미수집과 같은 취급) 따로 남긴다.
        no_result_fids = sorted(set(fid for fid in raw_fids if fid not in results_findings))

        counts = {k: 0 for k in COUNT_KEYS}
        fail_findings_set = set()
        kept_fids = []

        for fid in matched_fids:
            finding = results_findings[fid]
            collected_items = [it for it in finding.get("items", []) if it.get("status") != "not_collected"]
            if not collected_items:
                continue
            kept_fids.append(fid)
            for it in collected_items:
                st = it.get("status")
                if st in counts:
                    counts[st] += 1
                else:
                    counts["unknown"] += 1
                if st == "fail":
                    fail_findings_set.add(fid)

        total_checks = sum(counts.values())
        if total_checks == 0:
            status = "no_check"
        elif counts["fail"] > 0:
            status = "fail"
        elif counts["pass"] == total_checks:
            status = "pass"
        elif counts["pass"] > 0:
            status = "partial"
        elif counts["unknown"] == 0 and (counts["manual"] + counts["org_policy"]) > 0:
            status = "manual"
        else:
            status = "unknown"

        items.append({
            "key": item_key,
            "framework": saas_item["framework"],
            "id": saas_item["item_id"],
            "tier": tier,
            "status": status,
            "counts": counts,
            "fail_findings": sorted(fail_findings_set),
            "findings": kept_fids,
            "no_result_findings": no_result_fids,
        })

    items.sort(key=lambda x: x["key"])

    no_result_links = [(item["key"], fid) for item in items for fid in item["no_result_findings"]]
    no_result_count = {
        "items": len({k for k, _ in no_result_links}),
        "links": len(no_result_links),
        "findings": len({fid for _, fid in no_result_links}),
    }
    if no_result_links:
        sample = sorted({fid for _, fid in no_result_links})[:5]
        print(
            f"경고: 연결됐지만 점검 결과가 없는 finding {no_result_count['findings']}개"
            f"(연결 {no_result_count['links']}개, 항목 {no_result_count['items']}개). 판정 셈에서 빠짐. 예: {', '.join(sample)}",
            file=sys.stderr,
        )

    # Map finding_id to sorted list of in-scope item_keys
    finding_to_items = {}
    for item in items:
        for fid in item.get("findings", []):
            finding_to_items.setdefault(fid, []).append(item["key"])

    for fid in finding_to_items:
        finding_to_items[fid].sort()

    fixes = []
    for fid, finding in results_findings.items():
        has_fail = any(it.get("status") == "fail" for it in finding.get("items", []))
        if not has_fail:
            continue
        comp_item_keys = finding_to_items.get(fid, [])
        if not comp_item_keys:
            continue
        fail_targets_set = set()
        for it in finding.get("items", []):
            for tg in it.get("targets", []):
                if tg.get("status") == "fail":
                    key = tg.get("key")
                    if key:
                        fail_targets_set.add(key)
        fail_targets = len(fail_targets_set)
        score = len(comp_item_keys) * max(1, fail_targets)
        fixes.append({
            "finding": fid,
            "items": comp_item_keys,
            "fail_targets": fail_targets,
            "score": score,
        })

    fixes.sort(key=lambda x: (-x["score"], x["finding"]))

    compliance = {
        "knowledge_commit": commit_sha,
        "rule": RULE_TEXT,
        "items": items,
        "fixes": fixes,
        "no_result_count": no_result_count,
    }
    return compliance


def main():
    p = argparse.ArgumentParser(description="컴플라이언스 항목 판정 계산")
    p.add_argument("--results", required=True, help="standard_results.json 경로")
    p.add_argument("--knowledge", required=True, help="catalog-mapping 폴더 경로")
    args = p.parse_args()

    with open(args.results, "r", encoding="utf-8") as f:
        data = json.load(f)

    compliance = compute_compliance_verdicts(data, args.knowledge)

    # Place compliance at the top of the output dict
    new_data = {"compliance": compliance}
    for k, v in data.items():
        if k != "compliance":
            new_data[k] = v

    with open(args.results, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
