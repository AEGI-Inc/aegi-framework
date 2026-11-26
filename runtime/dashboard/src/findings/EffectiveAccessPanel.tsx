import { DetailCrumb } from '../ui/DetailBar'
import { useMemo } from 'react'
import { ChevronRight, Scissors, TriangleAlert } from 'lucide-react'
import { EA_AFFECTS_LABEL, EA_LEVEL_HINT, EA_RULE_LABEL, explainEaRow, type EaExplanation, type EaPathItem } from './eaExplain'
import EaPath, { EaBrief } from './EaPath'
import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import { formatKst, utcTitle } from '../utils/time'
import type { EaLevel, EffectiveAccessFile, EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'

/**
 * Finding 상세 「Effective Access」 (docs/spec/AEGI_EFFECTIVE_ACCESS_DASHBOARD_PLAN_V1.md §6).
 *
 * Finding 상세에는 결론마다 요약 한 칸(판정, 물은 질문, 경로 한 줄)만 두고, 누르면
 * 상세 화면(EffectiveAccessDetail)에서 경로 그림, 차단 지점을 보인다.
 * 그래프의 Effective Access 선 상세와 같은 틀(판정, 질문과 답, 경로 그림)을 쓴다.
 * 이 Finding 에 결론이 하나도 없으면 패널 자체를 그리지 않는다.
 * - 저장 관계(벤더가 준 사실)와 섞지 않는다. 판정 근거(룰이 확인한 조건)와도 다른 자리에 둔다
 * - 판정 보류(indeterminate)는 맨 위에 둔다. 아무것도 안 보이는 것이 정상처럼 보이는 모름이다
 * - 물어본 쌍만 있다. 여기서 계산해 채우지 않는다
 */

export interface EffectiveAccessPanelProps {
  finding: FindingV2
  graph: GraphStoreV2
  effectiveAccess?: EffectiveAccessFile
  /** 요약 한 칸을 누르면 상세 화면을 연다 */
  onOpenDetail: (rowId: string) => void
}

export interface EffectiveAccessDetailProps {
  finding: FindingV2
  graph: GraphStoreV2
  effectiveAccess?: EffectiveAccessFile
  rowId: string
  onSelectRow: (rowId: string) => void
  onBack: () => void
}

/** 판정 보류를 맨 위에 둔다. 가장 놓치기 쉬운 것 */
const LEVEL_ORDER: Record<EaLevel, number> = { indeterminate: 0, computed_cross: 1, computed: 2, denied: 3 }

/** 이 Finding 의 룰이 물은 결론 (없음 제외, 판정 보류 먼저) */
export function eaRowsForFinding(effectiveAccess: EffectiveAccessFile | undefined, finding: FindingV2): EffectiveAccessRow[] {
  return (effectiveAccess?.rows ?? [])
    .filter(r => r.x_asked_by.rule_id === finding.ruleId && r.level !== 'denied')
    .slice()
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
}

function Level({ row, label }: { row: EffectiveAccessRow; label: string }) {
  return <span className={`ea-level ${row.level}`} title={EA_LEVEL_HINT[row.level]}>{label}</span>
}

/** 결론 요약 한 칸. Finding 상세 목록과 상세 화면의 「다른 결론」이 같이 쓴다 */
function SummaryButton({ x, onClick }: { x: EaExplanation; onClick: () => void }) {
  const unknowns = x.unknownSteps
  const cuts = x.row.cut.length
  return (
    <button type="button" className={`ea-summary level-${x.row.level}`} onClick={onClick}>
      <span className="ea-card-top">
        <Level row={x.row} label={x.levelLabel} />
        <span>{EA_RULE_LABEL[x.row.source.rule]}</span>
      </span>
      <span className="ea-summary-q">{x.question}</span>
      <EaBrief chain={x.chain} />
      {(unknowns > 0 || cuts > 0) && (
        <span className="ea-summary-marks">
          {unknowns > 0 && <span className="is-warn"><TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" /> 확인하지 못한 곳 {unknowns}</span>}
          {cuts > 0 && <span className="is-cut"><Scissors size={13} strokeWidth={2.2} aria-hidden="true" /> 차단 지점 {cuts}</span>}
        </span>
      )}
      <ChevronRight className="ea-summary-chev" size={16} aria-hidden="true" />
    </button>
  )
}

/** Finding 상세의 요약 목록. 결론이 없으면 아무것도 그리지 않는다 */
export default function EffectiveAccessPanel({ finding, graph, effectiveAccess, onOpenDetail }: EffectiveAccessPanelProps) {
  const rows = useMemo(() => eaRowsForFinding(effectiveAccess, finding), [effectiveAccess, finding])
  const explained = useMemo(() => rows.map(row => explainEaRow(graph, row)), [rows, graph])
  if (!rows.length) return null

  return (
    <article className="fd-section-block ea-panel" aria-label="Effective Access">
      <div className="ea-head">
        <h3>Effective Access</h3>
        <span className="ea-counts">{rows.length}건</span>
      </div>
      <p className="ea-lead">이 위협이 판정에 쓴 접근을 관계와 동일인 연결로 계산한 결과. 누르면 경로와 차단 지점 상세</p>
      <ul className="ea-summary-list">
        {explained.map(x => (
          <li key={x.row.id}><SummaryButton x={x} onClick={() => onOpenDetail(x.row.id)} /></li>
        ))}
      </ul>
    </article>
  )
}

/** 차단 지점 목록에 쓰는 이음 이름 (경로 그림의 ✂ 자리와 같은 이름) */
function cutLabel(path: EaPathItem[], via: number): string {
  const link = path.find(item => item.kind === 'link' && item.via === via)
  return link && link.kind === 'link' ? link.label : `${via + 1}번째 단계`
}

/** 경로 하나의 상세: 경로 그림, 차단 지점, 계산 정보 */
function RowCard({ row, graph }: { row: EffectiveAccessRow; graph: GraphStoreV2 }) {
  const x = explainEaRow(graph, row)

  return (
    <article className={`ea-card ea-row level-${row.level}`} aria-label={`${x.levelLabel}: ${x.question}`}>
      <div className="ea-card-sec">
        <b>경로 <small>{x.saasTrail.length > 1 ? x.saasTrail.join(' → ') : `${x.saasTrail[0] ?? ''} 안`}</small></b>
        <EaPath path={x.path} detailed />
      </div>

      <div className="ea-card-sec">
        <b>차단 지점</b>
        {row.cut.length > 0 ? (
          <ul className="ea-cut-list">
            {row.cut.map(c => (
              <li key={c.via}>
                <Scissors size={13} strokeWidth={2.2} aria-hidden="true" />
                <span>
                  <b>{cutLabel(x.path, c.via)}</b> 끊기 <em className={`ea-affects ${c.x_scope.affects}`}>{EA_AFFECTS_LABEL[c.x_scope.affects]}</em>
                  <span className="ea-cut-note">{c.x_scope.note}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ea-note">{row.level === 'denied' ? '회수할 권한 없음' : '회수 지점 없음. 경로의 주황 표시 지점이 원인'}</p>
        )}
        {row.cut.length > 1 && <p className="ea-note">이 중 하나만 끊어도 경로 차단. 범위가 좁은 순서</p>}
      </div>

      <footer className="ea-row-foot" title={row.id}>
        계산 정보: {EA_RULE_LABEL[row.source.rule]} ({row.source.rule}), 규칙 판 {row.source.view_version}, 입력 <span title={utcTitle(row.source.computed_at)}>{formatKst(row.source.computed_at)}</span>
      </footer>
    </article>
  )
}

/** 결론 하나의 상세 화면 (Finding 상세 안에서 화면 전체를 쓴다) */
export function EffectiveAccessDetail({ finding, graph, effectiveAccess, rowId, onSelectRow, onBack }: EffectiveAccessDetailProps) {
  const rows = useMemo(() => eaRowsForFinding(effectiveAccess, finding), [effectiveAccess, finding])
  const row = rows.find(r => r.id === rowId) ?? rows[0]
  if (!row) return null
  const x = explainEaRow(graph, row)
  // 같은 주체, 대상, 질문의 다른 경로. 완전 회수는 경로마다 하나씩
  const siblings = rows.filter(r => r.id !== row.id && r.references.source === row.references.source && r.references.target === row.references.target && r.effect_query === row.effect_query)
  const others = rows.filter(r => r.id !== row.id && !siblings.includes(r))

  return (
    <main className="finding-detail-workbench ea-detail-page">
      <div className="page-title-bar page-title-bar-inset">
        <DetailCrumb back="위협 상세" onBack={onBack} title="Effective Access 상세" meta={finding.id} />
      </div>

      <div className="ea-detail-grid">
        <div className="ea-rows">
          <header className="ea-card">
            <div className="ea-card-top">
              <Level row={row} label={x.levelLabel} />
              <span>{EA_RULE_LABEL[row.source.rule]}</span>
            </div>
            <p className="ea-card-q">{x.question}</p>
            <p className="ea-card-a">{x.how}.</p>
            {x.verdict && <p className={`ea-card-verdict ${row.level}`}>{x.verdict}</p>}
            <p className="ea-card-a">이 접근을 판정한 위협: <b>{finding.title}</b></p>
          </header>
          {siblings.length > 0 && <p className="ea-multi">같은 접근에 경로 {siblings.length + 1}개. 완전히 회수하려면 경로마다 차단 지점 하나씩 차단 필요</p>}
          {[row, ...siblings].map(r => <RowCard key={r.id} row={r} graph={graph} />)}
        </div>
        {others.length > 0 && (
          <aside className="ea-detail-others" aria-label="이 위협의 다른 Effective Access">
            <h3>이 위협의 다른 Effective Access</h3>
            <ul className="ea-summary-list">
              {others.map(r => (
                <li key={r.id}><SummaryButton x={explainEaRow(graph, r)} onClick={() => onSelectRow(r.id)} /></li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </main>
  )
}
