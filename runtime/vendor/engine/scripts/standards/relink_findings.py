"""defs 추가 전 생성된 standard_results.json 의 미매핑 finding id("{sid}:{item_id}")를
새 defs 에 맞추어 재연결(re-key)하고, text, layer, group, kind 를 채운다.
이미 존재하는 finding id 로 재연결되는 경우 items 목록을 병합한다.
사용: python relink_findings.py --results <standard_results.json>
"""
import argparse
import json
import os
import sys

from build_standard_results import HERE, SHORT, UNIQ, KINDS, fill_finding


def build_source_map(uniq_defs):
    """표준 항목(sid, item_id) -> finding_id 매핑 생성"""
    m = {}
    for f in uniq_defs:
        fid = f["finding_id"]
        for s in f.get("sources", []):
            sid = SHORT.get(s["source"], s["source"])
            item_id = s.get("id")
            if sid and item_id:
                m[f"{sid}:{item_id}"] = fid
    return m


def relink_findings(results_data, uniq=None, kinds=None):
    if uniq is None:
        uniq = {f["finding_id"]: f for f in json.load(open(UNIQ, encoding="utf-8"))}
    if kinds is None:
        kinds = {k["finding_id"]: k for k in json.load(open(KINDS, encoding="utf-8"))}

    source_map = build_source_map(uniq.values())

    relinked = []
    new_findings_by_id = {}

    for f in results_data.get("findings", []):
        old_id = f["id"]
        if old_id in source_map:
            new_id = source_map[old_id]
            relinked.append(f"{old_id} -> {new_id}")
            f["id"] = new_id
            fill_finding(f, new_id, uniq, kinds, default_text=f.get("text", ""))

        fid = f["id"]
        if fid in new_findings_by_id:
            existing = new_findings_by_id[fid]
            existing["items"].extend(f.get("items", []))
            if fid in uniq or fid in kinds:
                fill_finding(existing, fid, uniq, kinds, default_text=existing.get("text", ""))
        else:
            new_findings_by_id[fid] = f

    results_data["findings"] = list(new_findings_by_id.values())
    return relinked


def main():
    parser = argparse.ArgumentParser(description="standard_results.json finding id 재연결")
    parser.add_argument("--results", required=True, help="standard_results.json 파일 경로")
    args = parser.parse_args()

    with open(args.results, "r", encoding="utf-8") as f:
        data = json.load(f)

    relinked = relink_findings(data)

    with open(args.results, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print(json.dumps({"relinked": sorted(relinked)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
