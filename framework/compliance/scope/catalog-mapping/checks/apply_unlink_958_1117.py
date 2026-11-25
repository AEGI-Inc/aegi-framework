"""11-17 사람 확인(958) 연결을 item-findings.jsonl 에서 뺀다.

958 은 항목의 대상 종류 객체 전원을 사람 확인(manual)으로 냈다. 11-17 그래프에서 파일, 메시지 같은 객체가
수백 개 늘면서 로그·삭제 항목이 이 객체들을 직접 확인으로 칠했다. 사용자 결정(11-17)으로 연결을 끊고,
이 항목들은 자동 점검(로그 보관, 외부 전송 등)만으로 판정한다. relation-rules.yaml manual_items.items 도 비운다.
다시 돌려도 결과가 같다.
사용: python3 checks/apply_unlink_958_1117.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, 'item-findings.jsonl')

rows, removed = [], 0
for line in open(PATH, encoding='utf-8'):
    if not line.strip():
        continue
    r = json.loads(line)
    keep = [f for f in r['finding_ids'] if not f.endswith('-958')]
    removed += len(r['finding_ids']) - len(keep)
    rows.append({**r, 'finding_ids': keep})
with open(PATH, 'w', encoding='utf-8', newline='\r\n') as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
print({'removed': removed, 'rows': len(rows)})

# 기준 근거 카드(compliance/guidance/*.guidance.jsonl)의 saas_controls 에서도 958 을 뺀다.
# 958 만 있던 줄은 SaaS 점검이 아니라 사람이 하는 절차라 auditor_checks 끝으로 옮기고,
# 같은 항목의 추천 조치(*.recommendations.jsonl) 참조 번호를 맞춘다.
GUIDANCE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), 'guidance')


def read_jsonl(path):
    return [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]


def write_jsonl(path, rows):
    # 파일마다 원래 쓰던 구분자(빈칸 있음/없음)를 그대로 쓴다
    first = open(path, encoding='utf-8').readline()
    seps = (',', ':') if first.startswith('{"item_key":"') else (', ', ': ')
    with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=seps) + '\n')


for fw in ('iso27001', 'isms-p', 'pipa'):
    gpath = os.path.join(GUIDANCE, f'{fw}.guidance.jsonl')
    rpath = os.path.join(GUIDANCE, f'{fw}.recommendations.jsonl')
    cards, recs = read_jsonl(gpath), read_jsonl(rpath)
    remap = {}  # item_key -> {옛 ref: 새 ref}
    moved = 0
    for card in cards:
        kept, mapping = [], {}
        for i, entry in enumerate(card['saas_controls']):
            ids = [f for f in entry.get('finding_ids', []) if not f.endswith('-958')]
            if ids:
                mapping[f'guidance:saas_controls[{i}]'] = f'guidance:saas_controls[{len(kept)}]'
                kept.append({**entry, 'finding_ids': ids})
            else:
                rest = {k: v for k, v in entry.items() if k not in ('finding_ids', 'basis')}
                mapping[f'guidance:saas_controls[{i}]'] = f"guidance:auditor_checks[{len(card['auditor_checks'])}]"
                card['auditor_checks'].append(rest)
                moved += 1
        card['saas_controls'] = kept
        if any(k != v for k, v in mapping.items()):
            remap[card['item_key']] = mapping
    for rec in recs:
        m = remap.get(rec['item_key'])
        if not m:
            continue
        for field in ('overview', 'actions'):
            for entry in rec.get(field, []):
                entry['ref'] = [m.get(r, r) for r in entry.get('ref', [])]
    write_jsonl(gpath, cards)
    write_jsonl(rpath, recs)
    print({'guidance': fw, 'moved_to_auditor_checks': moved, 'items_remapped': len(remap)})
