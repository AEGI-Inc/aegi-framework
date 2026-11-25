"""PIPA 원문(aegi-compliance docs/pipa/2026-10-24/*.md, 로컬 사본)을 항 단위 항목으로 나눈다.
출력: pipa.paragraphs.jsonl  (doc_id, document, article_id, number, title, para, text)
"""
import html, json, re, sys
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

rows = []
for md in sorted(SRC.glob('*.md')):
    t = md.read_text(encoding='utf-8-sig')
    m = re.search(r'^#\s+(.+)$', t, re.M)
    document = m.group(1).strip() if m else md.stem
    anchors = list(re.finditer(r'<a id="PIPA-2026-10-24-([^"]+?)-(article-[\w-]+|annex-[\w-]+)"></a>', t))
    for i, a in enumerate(anchors):
        doc_id, art = a.group(1), a.group(2)
        sec = t[a.end(): anchors[i + 1].start() if i + 1 < len(anchors) else len(t)]
        h = re.search(r'^##\s+(.+)$', sec, re.M)
        heading = h.group(1).strip() if h else art
        sec = re.sub(r'<details>.*?</details>', '', sec, flags=re.S)   # 종전 판 대조 블록은 뺀다
        pres = re.findall(r'<pre>(.*?)</pre>', sec, flags=re.S)
        body = html.unescape('\n'.join(pres)).strip()
        if not body:
            continue
        hm = re.match(r'(제\d+조(?:의\d+)?|별표\s*\d+)\s*(.*)', heading)
        number = hm.group(1) if hm else heading
        title = (hm.group(2) if hm else '').strip()
        # 항 나누기: 줄 첫머리의 ①②…
        # 조문 머리(「제5조(접근 권한의 관리)」)를 지우고, ①②… 가 줄 첫머리나 머리 바로 뒤에 오는 곳에서 나눈다
        body = re.sub(r'^\s*' + re.escape(number) + r'\([^)]*\)\s*', '', body)
        parts = re.split(r'(?m)(?:^|(?<=^))\s*(?=[' + CIRCLED + '])', body)
        parts = [p.strip() for p in parts if p.strip()]
        base = dict(doc_id=doc_id, document=document, article_id=art, number=number, title=title)
        paras = [p for p in parts if p[0] in CIRCLED]
        if not paras:
            rows.append({**base, 'para': '', 'text': body.strip()})
        else:
            lead = [p for p in parts if p[0] not in CIRCLED]
            for p in paras:
                if re.fullmatch(r'.\s*삭제(\s*<[^>]*>)?', p):
                    continue
                rows.append({**base, 'para': p[0], 'text': p})
            if lead:
                rows.append({**base, 'para': '', 'text': '\n'.join(lead)})

OUT.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8', newline='\n')
docs = {}
for r in rows:
    docs[r['document']] = docs.get(r['document'], 0) + 1
print(len(rows), 'paragraphs', len(docs), 'documents')
