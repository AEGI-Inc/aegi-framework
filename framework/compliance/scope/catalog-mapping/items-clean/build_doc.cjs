// S1R 결과로 「SaaS 적용 컴플라이언스 항목」 문서와 합친 목록을 만든다.
const fs = require('fs')
const path = require('path')
const O = __dirname
const rd = f => fs.readFileSync(path.join(O, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const docs = JSON.parse(fs.readFileSync(path.join(O, 'pipa.documents.json'), 'utf8'))

// Claude 검증에서 다시 볼 항목 (판정은 그대로 두고 표시만)
const QUESTION = {}

const fws = [
  ['ISO27001', 'iso27001.items.jsonl', 'ISO/IEC 27001:2022 부속서 A 통제'],
  ['ISMS-P', 'isms-p.items.jsonl', 'ISMS-P 인증기준(2023-11-23) 확인사항'],
  ['PIPA', 'pipa.items.jsonl', '개인정보 보호 법령(남긴 8개 문서) 항'],
]
const all = []
let md = `# SaaS 에 적용되는 컴플라이언스 항목 (2026-11-09 다시 판정)\n\n`
md += `세 기준의 항목을 원문으로 다시 판정해, 회사 SaaS 의 객체·관계·설정·기록으로 대상을 가리킬 수 있는 것만 남겼다. 다음 단계(카탈로그 객체 종류 ↔ 항목 매핑)의 기준 목록이다.\n\n`
md += `- apply: SaaS 객체·설정·기록으로 대상이 바로 정해진다\n- conditional: SaaS 객체로 가리킬 수 있으나 회사 입력이 있어야 정해진다\n- 제외 항목과 사유는 \`items-clean/<기준>.items.jsonl\` 에 모두 있다\n- 판정: Antigravity Gemini(원문 기준), 검증: Claude. 원문은 \`inputs-private/\`(로컬 전용, ISO 원문은 저장소에 넣지 않음)\n\n`
md += `## 요약\n\n| 기준 | 판정 대상 | apply | conditional | 제외 | 지난 판정(yes+maybe) |\n|---|---|---|---|---|---|\n`
const sections = []
for (const [fw, file, label] of fws) {
  const rows = rd(file)
  const c = { apply: 0, conditional: 0, exclude: 0 }
  let prevKeep = 0
  for (const r of rows) {
    c[r.decision]++
    if (r.previous === 'yes' || r.previous === 'maybe') prevKeep++
    if (r.decision !== 'exclude') all.push({ ...r, item_key: `${fw}:${r.item_id}` })
  }
  const prevNote = fw === 'PIPA' ? `조 단위 52개 (항으로 나누면 ${rows.filter(r => r.previous === 'yes' || r.previous === 'maybe').length}항)` : `${prevKeep}`
  md += `| ${label} | ${rows.length} | ${c.apply} | ${c.conditional} | ${c.exclude} | ${prevNote} |\n`
  let s = `## ${label}\n\n`
  let group = null
  for (const r of rows) {
    if (r.decision === 'exclude') continue
    const g = fw === 'PIPA' ? r.document : fw === 'ISMS-P' ? r.item_id.split('.').slice(0, 2).join('.') : r.item_id.split('.')[0]
    if (g !== group) { group = g; s += `\n### ${fw === 'PIPA' ? g : fw === 'ISMS-P' ? 'ISMS-P ' + g : 'ISO ' + g + '.x'}\n\n` }
    const key = `${fw}:${r.item_id}`
    const id = fw === 'PIPA' ? r.location.replace(r.document + ' ', '') : r.item_id
    s += `- **${id}** ${r.title} — ${r.decision === 'apply' ? 'apply' : 'conditional'}\n`
    s += `  - ${r.summary_ko}\n`
    s += `  - 대상: ${r.targets.join(', ')}\n`
    if (r.company_input?.length) s += `  - 회사 입력: ${r.company_input.join('; ')}\n`
    if (fw === 'ISO27001' && r.ismsp_links?.length) s += `  - 대응 ISMS-P: ${r.ismsp_links.join(', ')}\n`
    if (fw === 'ISMS-P' && r.related_law?.length) s += `  - 관련 법규: ${r.related_law.join('; ')}\n`
    if (QUESTION[key]) s += `  - ⚠ 검토: ${QUESTION[key]}\n`
  }
  sections.push(s)
}
md += `\n총 ${all.length}개 (apply ${all.filter(r => r.decision === 'apply').length}, conditional ${all.filter(r => r.decision === 'conditional').length}).${Object.keys(QUESTION).length ? ` ⚠ 표시 ${Object.keys(QUESTION).length}개는 Claude 검증에서 다시 볼 것으로 남긴 항목이다.` : ' 11-09 사용자 검토 6건 반영(PIPA 안전성 기준 제7조①·법 제59조 제외, 제12조① conditional, ISO 8.7 태그 정리, ISMS-P 2.5.4-03 요약 수정).'}\n\n`
md += `## 지난 판정(11-08)과 크게 달라진 점\n\n`
md += `- ISO: 제목만 보고 넓게 잡았던 공급자 관리(5.19~5.22), 사고 대응(5.25~5.28), 업무 연속성(5.30), 네트워크·인프라(8.6, 8.14, 8.18, 8.20, 8.21, 8.23), 위협 인텔리전스(5.7)를 뺐다. 백업(8.13)은 넣었다\n`
md += `- ISMS-P: maybe 37개를 확정. 계정 관리(2.5.1-01), 특수 권한(2.5.5-01), 암호화(2.7.1-02), 파기(3.4.1-02·03)를 넣고, 동의·수집 제한·개인정보파일 대장(3.1.x, 3.2.1)을 뺐다\n`
md += `- PIPA: 조 단위를 항 단위로 바꿨다. 동의 고지, 정보주체 권리 행사 절차, 위탁 문서·공개, 가명정보 결합 등은 뺐다. 안전성 확보조치 기준 제5~8조(권한, 접근통제, 암호화, 접속기록)와 파기, 국외 이전, 가명정보 안전조치가 남았다\n\n`
md += `## PIPA 문서 거르기\n\n남긴 문서 8개와 뺀 문서 27개. 「한국으로 이전된 개인정보 처리 보완규정」(EU 적정성)은 어떤 데이터가 EU 에서 왔는지 API 로 수집할 수 없어 뺐다(11-09 사용자 결정).\n\n| 문서 | 항 수 | 결정 | 사유 |\n|---|---|---|---|\n`
for (const d of docs) md += `| ${d.document} | ${d.paragraphs} | ${d.decision === 'keep' ? '남김' : '뺌'} | ${d.reason} |\n`
md += '\n' + sections.join('\n')
fs.writeFileSync(path.join(O, '..', 'docs', 'compliance-items-saas-20261109.md'), md)
fs.writeFileSync(path.join(O, 'saas-items.jsonl'), all.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log('items', all.length)
