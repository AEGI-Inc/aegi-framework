"""11-11 점검 연결 검토(item-findings-review-1111.jsonl)를 item-findings.jsonl 에 반영한다.
drop 은 그 항목의 finding_ids 에서 뺀다(판정 기록은 검토 파일에 남는다). 다시 돌려도 결과가 같다.
사용: python3 checks/apply_link_review_1111.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = os.path.join(HERE, 'item-findings.jsonl')
REVIEW = os.path.join(HERE, 'item-findings-review-1111.jsonl')

rd = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
drops = {}
for r in rd(REVIEW):
    if r['decision'] != 'drop':
        raise SystemExit(f"알 수 없는 decision: {r['decision']}")
    drops.setdefault(r['item_key'], set()).add(r['finding_id'])
rows, removed = rd(LINKS), 0
keys = {r['item_key'] for r in rows}
missing = set(drops) - keys
if missing:
    raise SystemExit(f'연결 파일에 없는 항목: {sorted(missing)}')
for r in rows:
    gone = drops.get(r['item_key'], set())
    before = len(r['finding_ids'])
    r['finding_ids'] = [f for f in r['finding_ids'] if f not in gone]
    removed += before - len(r['finding_ids'])
with open(LINKS, 'w', encoding='utf-8', newline='\n') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
print({'removed': removed, 'items': len(rows)})
