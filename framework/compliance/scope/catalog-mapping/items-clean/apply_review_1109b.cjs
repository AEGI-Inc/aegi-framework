// 11-09 Claude 요약 대조(남긴 168개 전부)에서 원문과 어긋난 요약·판정을 고친다.
const fs = require('fs')
const path = require('path')
const EDITS = {
  'isms-p.items.jsonl': {
    '2.5.6-01': {
      summary_ko: '사용자 계정과 접근권한의 생성·부여·변경·말소 이력을 남기도록 요구한다.',
      targets: ['record', 'monitoring', 'access_grant'],
      reason: 'SaaS 의 관리자 감사 로그(계정·역할 부여와 회수 이벤트)와 그 보관 설정이 대상이다.',
    },
    '2.5.6-02': {
      summary_ko: '계정과 접근권한의 적정성 검토 기준·주체·방법·주기를 정하고 정기적으로 검토하도록 요구한다.',
      targets: ['access_grant', 'privileged_role', 'account'],
      reason: '검토 기준·주기 수립은 절차지만, 검토 대상인 SaaS 계정·역할 배정·관리자 권한 현황은 그래프로 바로 나온다.',
    },
  },
  'pipa.items.jsonl': {
    'admin-73464:article-8:p2': {
      summary_ko: '개인정보를 목적 외 용도로 제3자에게 제공할 때 제공받는 자와 안전성 확보 조치의 책임관계를 명확히 해야 한다.',
    },
    'admin-73464:article-10:p1': {
      summary_ko: '보유기간 경과·처리 목적 달성·서비스 폐지 등으로 불필요해진 개인정보는 정당한 사유가 없으면 5일 이내에 파기해야 한다.',
    },
    'admin-73464:article-10:p2': {
      decision: 'exclude', targets: [], company_input: [],
      summary_ko: '시행령의 「복원이 불가능한 방법」이 현재 기술 수준에서 적정한 비용으로 복원할 수 없게 하는 방법임을 정의한다.',
      reason: '용어 정의 항이다. 파기 방법 의무는 시행령 제16조①과 안전성 확보조치 기준 제13조에서 다룬다.',
    },
  },
}
for (const [file, edits] of Object.entries(EDITS)) {
  const p = path.join(__dirname, file)
  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  const seen = new Set()
  for (const r of rows) {
    const e = edits[r.item_id]
    if (!e) continue
    Object.assign(r, e, { reviewed_by: 'claude 2026-11-09 summary check' })
    const prevKeep = r.previous === 'yes' || r.previous === 'maybe'
    r.changed = r.previous !== 'none' && (r.decision === 'exclude') === prevKeep
    seen.add(r.item_id)
  }
  const missing = Object.keys(edits).filter(k => !seen.has(k))
  if (missing.length) throw new Error(`${file}: 없는 항목 ${missing}`)
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(file, 'edited', seen.size)
}
