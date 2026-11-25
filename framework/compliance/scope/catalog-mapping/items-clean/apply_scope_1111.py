"""11-11 범위 확정을 item-tiers.jsonl 에 반영하고, 모든 항목의 제외 단계와 사유를 scope-final.jsonl 하나로 모은다.

단계(stage)
  document      PIPA 문서 단위 제외(pipa.documents.json 의 drop). 조항을 나누지 않았다
  saas          SaaS 적용 판정(11-09 S1R, {iso27001,isms-p,pipa}.items.jsonl 의 exclude)
  mentor_scope  멘토 범위(11-10): ISMS-P 는 2번 보호대책만, PIPA 는 안전성 확보조치 기준만
  review_1111   본뜻 판정(11-11): 점검이 통제의 본뜻을 판정하는가. ISO 는 iso-scope-1111.jsonl, ISMS-P 와 PIPA 는 scope-review-1111.jsonl
  in_scope      범위 안. tier 는 auto(자동 판정) 또는 evidence(근거 제공)

다시 돌려도 결과가 같다.
사용: python3 items-clean/apply_scope_1111.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda name: os.path.join(HERE, name)
rd = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]

SAFETY_DOC = '개인정보의 안전성 확보조치 기준'
MENTOR_REASON = {
    'ISMS-P': 'ISMS-P 는 2번 보호대책만 검사한다. 1번 관리체계 수립과 3번 개인정보 처리 단계는 조직 절차라 검사하지 않는다',
    'PIPA': 'PIPA 는 개인정보의 안전성 확보조치 기준만 검사한다. 법, 시행령, 표준지침 조항은 그 기준의 근거 법령이다',
}


def in_mentor_scope(item):
    if item['framework'] == 'ISMS-P':
        return item['item_id'].startswith('2.')
    if item['framework'] == 'PIPA':
        return item['document'] == SAFETY_DOC
    return True


saas = rd(P('saas-items.jsonl'))
saas_by_key = {s['item_key']: s for s in saas}
review = {r['item_key']: r for r in rd(P('scope-review-1111.jsonl'))}
iso_review = {r['item_key']: r for r in rd(P('iso-scope-1111.jsonl'))}

for key, r in review.items():
    if key not in saas_by_key:
        raise SystemExit(f'saas-items 에 없는 판정: {key}')
    if not in_mentor_scope(saas_by_key[key]):
        raise SystemExit(f'멘토 범위 밖 항목을 판정했다: {key}')
    if (r['decision'] == 'include') != (r['tier'] in ('auto', 'evidence')) or r['tier'] not in ('auto', 'evidence', 'exclude'):
        raise SystemExit(f'decision 과 tier 가 맞지 않는다: {key}')
for s in saas:
    if s['framework'] != 'ISO27001' and in_mentor_scope(s) and s['item_key'] not in review:
        raise SystemExit(f'판정이 빠졌다: {s["item_key"]}')
    if s['framework'] == 'ISO27001' and s['item_key'] not in iso_review:
        raise SystemExit(f'ISO 판정이 빠졌다: {s["item_key"]}')

# 1. 등급 표. ISO 행은 11-11 확정 그대로 둔다
tiers = rd(P('item-tiers.jsonl'))
for t in tiers:
    s = saas_by_key[t['item_key']]
    if s['framework'] == 'ISO27001':
        continue
    if not in_mentor_scope(s):
        t['tier'], t['reason'] = 'exclude', MENTOR_REASON[s['framework']]
    else:
        r = review[t['item_key']]
        t['tier'], t['reason'] = r['tier'], r['reason']
with open(P('item-tiers.jsonl'), 'w', encoding='utf-8', newline='\n') as f:
    for t in tiers:
        f.write(json.dumps(t, ensure_ascii=False) + '\n')
tier_by_key = {t['item_key']: t for t in tiers}

# 2. 모든 항목의 단계와 사유
rows = []
for doc in json.load(open(P('pipa.documents.json'), encoding='utf-8-sig')):
    if doc['decision'] == 'drop':
        rows.append({'item_key': f"PIPA-DOC:{doc['document']}", 'framework': 'PIPA', 'item_id': '', 'title': doc['document'],
                     'paragraphs': doc['paragraphs'], 'in_scope': False, 'stage': 'document', 'reason': doc['reason']})
for name in ('iso27001', 'isms-p', 'pipa'):
    for it in rd(P(f'{name}.items.jsonl')):
        key = f"{it['framework']}:{it['item_id']}"
        base = {'item_key': key, 'framework': it['framework'], 'item_id': it['item_id'], 'location': it.get('location', ''), 'title': it['title']}
        if it['decision'] == 'exclude':
            if key in saas_by_key:
                raise SystemExit(f'S1R 제외인데 saas-items 에 있다: {key}')
            rows.append({**base, 'in_scope': False, 'stage': 'saas', 'reason': it['reason']})
            continue
        t = tier_by_key[key]
        if not in_mentor_scope(it):
            rows.append({**base, 'in_scope': False, 'stage': 'mentor_scope', 'reason': t['reason']})
        elif t['tier'] == 'exclude':
            rows.append({**base, 'in_scope': False, 'stage': 'review_1111', 'reason': t['reason']})
        else:
            rows.append({**base, 'in_scope': True, 'stage': 'in_scope', 'tier': t['tier'], 'reason': t['reason']})
with open(P('scope-final.jsonl'), 'w', encoding='utf-8', newline='\n') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

summary = {}
for r in rows:
    k = summary.setdefault(r['framework'], {})
    label = r['stage'] if r['stage'] != 'in_scope' else f"in_scope:{r['tier']}"
    k[label] = k.get(label, 0) + 1
print(json.dumps(summary, ensure_ascii=False))

# 3. 사람이 읽는 문서. 범위 안, 멘토 범위와 본뜻 판정 제외는 항목마다, S1R 과 문서 단위 제외는 수만 쓴다
FW = [('ISO27001', 'ISO 27001', '통제'), ('ISMS-P', 'ISMS-P', '확인사항'), ('PIPA', 'PIPA', '조항')]
STAGES = [('document', 'PIPA 문서 단위 제외'), ('saas', 'SaaS 적용 판정(11-09)'), ('mentor_scope', '멘토 범위(11-10)'),
          ('review_1111', '본뜻 판정(11-11)'), ('in_scope', '범위 안')]
TIER = {'auto': '자동 판정', 'evidence': '근거 제공'}
out = ['# 컴플라이언스 범위 확정 (2026-11-11)', '',
       '`items-clean/apply_scope_1111.py` 가 만든다. 원본 기록은 `items-clean/scope-final.jsonl`(모든 항목의 단계와 사유).', '',
       '판단 기준: 데이터로 판정할 수 있는 기술 조치만 남기고, 애매하면 뺀다. 점검이 통제의 본뜻을 판정하는가, 우리가 볼 수 있는 조각에 맞춰 좁게 해석했는가를 본다.', '',
       '## 단계별 수', '', '| 기준 | ' + ' | '.join(s[1] for s in STAGES) + ' |', '|---|' + '---|' * len(STAGES)]
for fw, label, unit in FW:
    cells = []
    for st, _ in STAGES:
        n = sum(1 for r in rows if r['framework'] == fw and r['stage'] == st)
        if st == 'document':
            n = f"{n} 문서({sum(r['paragraphs'] for r in rows if r['framework'] == fw and r['stage'] == st)} 조항)" if n else '-'
        cells.append(str(n))
    out.append(f'| {label} ({unit}) | ' + ' | '.join(cells) + ' |')
out += ['', '- SaaS 적용 판정: 정책, 절차, 인사, 물리 보안, 계약, 법 절차처럼 SaaS 객체로 가리킬 대상이 없는 항목. 항목별 사유는 `scope-final.jsonl`.',
        '- PIPA 는 35개 문서 가운데 SaaS 를 쓰는 처리자에 해당하는 8개 문서만 조항으로 나눴다. 나머지 27개 문서(마이데이터 전송, 소송, 고발 기준 등)는 문서 단위로 뺐다.']
for fw, label, unit in FW:
    out += ['', f'## {label}', '', '### 범위 안', '']
    for r in rows:
        if r['framework'] == fw and r['stage'] == 'in_scope':
            out.append(f"- {r['item_id']} {r['title']} ({TIER[r['tier']]}): {r['reason']}")
    for st, st_label in (('review_1111', '본뜻 판정으로 제외'), ('mentor_scope', '멘토 범위로 제외')):
        sel = [r for r in rows if r['framework'] == fw and r['stage'] == st]
        if not sel:
            continue
        out += ['', f'### {st_label} {len(sel)}', '']
        if st == 'mentor_scope':
            out += [f'사유: {sel[0]["reason"]}', '']
            out += [f"- {r['item_id']} {r['title']}" for r in sel]
        else:
            out += [f"- {r['item_id']} {r['title']}: {r['reason']}" for r in sel]
with open(os.path.join(HERE, '..', 'docs', 'compliance-scope-final-20261111.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(out) + '\n')
