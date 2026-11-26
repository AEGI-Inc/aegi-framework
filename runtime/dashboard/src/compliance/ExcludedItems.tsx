import { useEffect, useState } from 'react'
import { fallbackPipaLocation, PIPA_DOC_ORDER, pipaSortKey, sortKey, type FrameworkId } from './frameworkModel'

export type ExcludedStage = 'review_1111' | 'mentor_scope' | 'saas' | 'document'
export interface ExcludedItem { framework: FrameworkId; id: string; location?: string; title: string; stage: ExcludedStage; reason: string; paragraphs?: number }

// 제외 단계. 화면에는 단계 이름 대신 제외 이유의 갈래를 보인다
export const EXCLUDED_STAGES: { stage: ExcludedStage; label: string }[] = [
  { stage: 'review_1111', label: '연결 점검으로 판정할 수 없음' },
  { stage: 'mentor_scope', label: '검사 대상 영역 밖' },
  { stage: 'saas', label: 'SaaS 에서 확인할 대상 없음' },
  { stage: 'document', label: 'SaaS 와 관계없는 고시' },
]

function excludedSortKey(r: ExcludedItem): string {
  if (r.framework === 'pipa') {
    if (r.stage === 'document') return `000.${r.title}`
    const loc = r.location || fallbackPipaLocation(r.id)
    const docName = loc.replace(/\s*(제\d+조|별표).*$/, '').trim()
    const clauseId = loc.slice(docName.length).trim() || r.id
    const idx = PIPA_DOC_ORDER.indexOf(docName)
    const docRank = String(idx >= 0 ? idx : PIPA_DOC_ORDER.length).padStart(3, '0')
    return `${docRank}.${docName}.${pipaSortKey(clauseId)}`
  }
  return r.id.split('-').map(part => sortKey(part)).join('-')
}

export function groupExcluded(items: ExcludedItem[], framework: FrameworkId, query = '') {
  const q = query.trim().toLowerCase()
  const mine = items.filter(i => i.framework === framework)
    .filter(i => !q || `${i.id} ${i.location ?? ''} ${i.title} ${i.reason}`.toLowerCase().includes(q))
  return EXCLUDED_STAGES
    .map(s => ({
      ...s,
      rows: mine
        .filter(i => i.stage === s.stage)
        .sort((a, b) => excludedSortKey(a).localeCompare(excludedSortKey(b))),
    }))
    .filter(g => g.rows.length > 0)
}

export default function ExcludedItems({ framework }: { framework: FrameworkId }) {
  const [items, setItems] = useState<ExcludedItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    import('./scopeExcluded.snapshot.json')
      .then(m => { if (alive) setItems(m.default.items as ExcludedItem[]) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  // PIPA 는 내부 키 대신 「문서 제N조 제N항」 위치를 보인다
  const label = (r: ExcludedItem) => (r.framework === 'pipa' ? (r.location ? `${r.location} ` : '') : (r.id ? `${r.id} ` : ''))
  if (failed) return <p className="comp-list-empty" role="alert">제외 항목을 불러오지 못했습니다.</p>
  if (!items) return <p className="comp-list-empty" role="status">제외 항목을 불러오는 중</p>
  const groups = groupExcluded(items, framework, query)
  // 같은 사유가 모든 줄에 붙는 단계는 사유를 머리에 한 번만 쓴다
  const sharedReason = (rows: ExcludedItem[]) => (rows.every(r => r.reason === rows[0].reason) && rows.length > 1 ? rows[0].reason : '')

  return <div className="comp-excluded">
    <div className="comp-toolbar">
      <input type="search" className="comp-search" aria-label="제외 항목 검색" placeholder="번호, 이름, 제외 사유 검색" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    {groups.length === 0 ? <p className="comp-list-empty">조건에 맞는 항목이 없습니다.</p> : groups.map(g => {
      const shared = sharedReason(g.rows)
      return <section key={g.stage} className="comp-group" aria-label={g.label}>
        <h3 className="comp-group-head">{g.label}<em>{g.rows.length}</em></h3>
        {shared && <p className="comp-scope-type-note">{shared}</p>}
        <ul className="comp-excluded-list">
          {g.rows.map(r => <li key={`${r.stage}:${r.id}:${r.title}`}>
            <strong>{label(r)}{r.title}{r.paragraphs ? ` (${r.paragraphs}개 조항)` : ''}</strong>
            {!shared && <span>{r.reason}</span>}
          </li>)}
        </ul>
      </section>
    })}
  </div>
}
