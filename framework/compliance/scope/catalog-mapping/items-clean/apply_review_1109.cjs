// 11-09 사용자 결정(⚠ 6개)을 판정 파일에 반영한다. 고친 줄에 reviewed_by 를 남긴다.
const fs = require('fs')
const path = require('path')
const EDITS = {
  'isms-p.items.jsonl': {
    '2.5.4-03': { summary_ko: '개인정보취급자와 정보주체가 쓰는 인증수단(다중인증, 인증기 등)을 안전하게 적용하고 관리하도록 요구한다.' },
  },
  'pipa.items.jsonl': {
    'admin-73493:article-7:p1': {
      decision: 'exclude', targets: [], company_input: [],
      reason: '인증정보 암호화와 비밀번호 일방향 저장은 SaaS 제공자 내부 구현이라 고객 설정이나 수집 API 로 확인할 수 없다.',
    },
    'admin-73493:article-12:p1': {
      decision: 'conditional', targets: ['access_grant', 'privileged_role'], company_input: ['개인정보가 있는 SaaS 와 필드'],
      reason: '용도 특정과 항목 최소화는 화면·보고서 설계 몫이고, SaaS 로 보이는 부분은 개인정보 내보내기 권한(Salesforce 보고서 내보내기, GWS 데이터 내보내기, Slack 워크스페이스 내보내기)을 가진 사람이다.',
    },
    'law-011357:article-59:p0': {
      decision: 'exclude', targets: [], company_input: [],
      reason: '개인의 행위를 금지하고 벌칙으로 이어지는 조항이다. 처리자의 통제는 안전성 확보조치 기준 제5·6조로 다루고, 실제 누설 여부는 이벤트로 본다.',
    },
  },
  'iso27001.items.jsonl': {
    '8.7': { targets: ['malware', 'tenant_policy'], reason: 'Gmail·Drive 첨부파일 악성코드 검사 같은 SaaS 테넌트의 악성코드 대응 설정이 대상이다. 코드 보안 검사는 8.8, 8.28 에서 다룬다.' },
  },
}
for (const [file, edits] of Object.entries(EDITS)) {
  const p = path.join(__dirname, file)
  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  const seen = new Set()
  for (const r of rows) {
    const e = edits[r.item_id]
    if (!e) continue
    Object.assign(r, e, { reviewed_by: 'user 2026-11-09' })
    const prevKeep = r.previous === 'yes' || r.previous === 'maybe'
    r.changed = r.previous !== 'none' && (r.decision === 'exclude') === prevKeep
    seen.add(r.item_id)
  }
  const missing = Object.keys(edits).filter(k => !seen.has(k))
  if (missing.length) throw new Error(`${file}: 없는 항목 ${missing}`)
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(file, 'edited', seen.size)
}
