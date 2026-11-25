"""11-11 애매한 쌍 검토(ambiguous-review-1111.jsonl)를 item-type-scope.jsonl 에 반영한다.
confirm 은 status 를 confirmed 로 바꾸고 review 칸을 붙인다. drop 은 매핑에서 뺀다(판정 기록은 검토 파일에 남는다).
다시 돌려도 결과가 같다.
사용: python3 items-clean/apply_review_1111.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
SCOPE = os.path.join(HERE, 'item-type-scope.jsonl')
REVIEW = os.path.join(HERE, 'ambiguous-review-1111.jsonl')

rd = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
review = {(r['item_key'], r['type_key']): r for r in rd(REVIEW)}
rows, seen, confirmed, dropped = [], set(), 0, 0
for s in rd(SCOPE):
    r = review.get((s['item_key'], s['type_key']))
    if r:
        seen.add((s['item_key'], s['type_key']))
        if r['decision'] == 'drop':
            dropped += 1
            continue
        if r['decision'] != 'confirm':
            raise SystemExit(f"알 수 없는 decision: {r['decision']}")
        s = {**s, 'status': 'confirmed', 'review': 'claude-1111'}
        confirmed += 1
    rows.append(s)
# drop 쌍은 이미 빠졌으면 괜찮다. confirm 쌍이 없으면 멈춘다
missing = [k for k in set(review) - seen if review[k]['decision'] == 'confirm']
if missing:
    raise SystemExit(f'매핑에 없는 확정 쌍 {len(missing)}개: {sorted(missing)[:3]}')
with open(SCOPE, 'w', encoding='utf-8') as f:
    for s in rows:
        f.write(json.dumps(s, ensure_ascii=False, separators=(',', ':')) + '\n')
print({'confirmed': confirmed, 'dropped': dropped, 'rows': len(rows)})
