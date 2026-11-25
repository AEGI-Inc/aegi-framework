"""11-12 점검 연결 추가(item-findings-add-1112.jsonl)를 item-findings.jsonl 에 반영한다.
항목마다 finding_ids 에 새 점검을 추가하고 정렬과 중복을 유지한다. 다시 돌려도 결과가 같다.
사용: python3 checks/apply_link_add_1112.py  (뒤에 items-clean/apply_scope_1111.py 를 돌린다)
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = os.path.join(HERE, "item-findings.jsonl")
ADD = os.path.join(HERE, "item-findings-add-1112.jsonl")

rd = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]

adds = {}
for r in rd(ADD):
    if r.get("decision") != "add":
        raise SystemExit(f"알 수 없는 decision: {r.get('decision')}")
    adds.setdefault(r["item_key"], set()).add(r["finding_id"])

rows = rd(LINKS)
keys = {r["item_key"] for r in rows}
missing = set(adds) - keys
if missing:
    raise SystemExit(f"연결 파일에 없는 항목: {sorted(missing)}")

added_count = 0
for r in rows:
    new_fids = adds.get(r["item_key"], set())
    if new_fids:
        before = set(r["finding_ids"])
        combined = sorted(before | new_fids)
        added_count += len(set(combined) - before)
        r["finding_ids"] = combined

with open(LINKS, "w", encoding="utf-8", newline="\n") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")

print({"added": added_count, "links": sum(len(v) for v in adds.values()), "items": len(rows)})
