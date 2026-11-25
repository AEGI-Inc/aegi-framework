"""11-15 항목 대상 좁히기 검토(scope-review-1115.jsonl)를 item-type-scope.jsonl 에 반영한다.
drop 은 매핑에서 빼고, narrow 는 via 를 바꾼 뒤 review 칸("claude-1115")을 붙인다.
다시 돌려도 결과가 같다.
사용: python3 items-clean/apply_review_1115.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE = os.path.join(HERE, 'item-type-scope.jsonl')
REVIEW = os.path.join(HERE, 'scope-review-1115.jsonl')

rd = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
review = {(r['item_key'], r['type_key']): r for r in rd(REVIEW)}
rows, seen, narrowed, dropped = [], set(), 0, 0
for s in rd(SCOPE):
    r = review.get((s['item_key'], s['type_key']))
    if r:
        seen.add((s['item_key'], s['type_key']))
        if r['decision'] == 'drop':
            dropped += 1
            continue
        if r['decision'] != 'narrow':
            raise SystemExit(f"알 수 없는 decision: {r['decision']}")
        s = {**s, 'via': r['via'], 'review': 'claude-1115'}
        narrowed += 1
    rows.append(s)
# drop 쌍은 이미 빠졌으면 괜찮다. narrow 쌍이 없으면 멈춘다
missing = [k for k in set(review) - seen if review[k]['decision'] == 'narrow']
if missing:
    raise SystemExit(f'매핑에 없는 좁히기 쌍 {len(missing)}개: {sorted(missing)[:3]}')
with open(SCOPE, 'w', encoding='utf-8', newline='\r\n') as f:
    for s in rows:
        f.write(json.dumps(s, ensure_ascii=False, separators=(',', ':')) + '\n')
print({'narrowed': narrowed, 'dropped': dropped, 'rows': len(rows)})
