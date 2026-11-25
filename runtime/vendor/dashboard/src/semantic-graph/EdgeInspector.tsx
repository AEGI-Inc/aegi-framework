import React, { useMemo, useState } from 'react'
import { ArrowRight, ChevronRight, Link2, TriangleAlert, X, Zap } from 'lucide-react'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { EA_RULE_LABEL, explainEaRow } from '../findings/eaExplain'
import { EaBrief, groupEa } from '../findings/EaPath'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { SemanticEdge, SemanticLevel, SemanticNode } from './types'
import SeverityDot from '../findings/SeverityDot'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import { explainEdge, type ObjectRef, type RelationExplanation } from './edgeExplain'
import { providerName, PROVIDERS_WITH_LOGO } from '../findings/providers'
import AiAskButton from '../assistant/AiAskButton'

interface EdgeInspectorProps {
  edge: SemanticEdge
  sourceNode?: SemanticNode | null
  targetNode?: SemanticNode | null
  activeGraph: GraphStore | GraphStoreV2
  currentLevel: SemanticLevel
  v2Findings: FindingV2[]
  onClose: (event: React.MouseEvent<HTMLButtonElement>) => void
  onStop: (event: React.SyntheticEvent) => void
  onOpenThreat?: (findingId: string) => void
  /** 개별 객체(L4)에서 그 객체를 중심으로 보기 */
  onFocusObject?: (objectKey: string) => void
  /** 같은 두 칸 사이의 Effective Access 결론. 관계선과 겹쳐 그 선을 누를 수 없을 때 여기서 연다 */
  overlappingEa?: EffectiveAccessRow[]
  onOpenEa?: (rowIds: string[]) => void
  belowToolbar?: boolean
  onAskSelection?: () => void
}

const SEVERITY_ORDER: FindingV2['severity'][] = ['critical', 'high', 'medium', 'low', 'info']
/** 로고가 있는 SaaS만 이름 앞에 로고를 붙인다 */
const LOGO_IDS = PROVIDERS_WITH_LOGO
const toLogo = (p: string): ProviderId => (p === 'gws' ? 'google-workspace' : (p as ProviderId))

/** 동일인 연결 묶음 머리 코드에 커서를 올리면 뜨는 뜻 */
const IDENTITY_LINK_MEANING = '동일인 연결: SaaS 사이는 관계가 아니라 사람, 자동화, Group Push로 복제된 그룹처럼 같은 주체의 대응으로만 잇는다. 권한이나 활동을 뜻하지 않는다.'

/** 동일인 연결 수준 배지: 확정(파랑), 약한 근거(주황), 다름(무채색). Effective Access 판정 배지와 같은 모양 */
const LINK_STRONG = new Set(['resolved', 'disclosed_relation'])
function linkBadge(level: string): string {
  return LINK_STRONG.has(level) ? 'is-strong' : level === 'different' ? 'is-none' : 'is-weak'
}

function LinkMembers({ members, onFocus }: { members: ObjectRef[]; onFocus?: (key: string) => void }) {
  return (
    <dl className="sz-edge-members">
      {members.map(m => (
        <div key={m.key}>
          <dt>{LOGO_IDS.has(m.provider) && <ProviderLogo provider={toLogo(m.provider)} className="sz-edge-logo" />}{providerName(m.provider)}</dt>
          <dd><ObjectChip obj={m} onFocus={onFocus} /></dd>
        </div>
      ))}
    </dl>
  )
}

/** 탐지 경로에 든 항목. 칸 왼쪽 띠 대신 빨간 글씨 한 줄로 적는다 */
function EvidenceLine({ ids }: { ids: string[] }) {
  return (
    <p className="sz-edge-evidence">
      <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>탐지 경로 <b>{ids.join(', ')}</b></span>
    </p>
  )
}
const PREVIEW = 6


function ObjectChip({ obj, onFocus }: { obj: ObjectRef; onFocus?: (key: string) => void }) {
  const title = `${providerName(obj.provider)}${obj.type ? `, ${obj.type}` : ''}, ${obj.key}`
  return onFocus ? (
    <button type="button" className="sz-edge-obj" title={`${title}\n개별 객체에서 이 객체 중심으로 보기`} onClick={() => onFocus(obj.key)}>
      {obj.label}
    </button>
  ) : (
    <span className="sz-edge-obj" title={title}>{obj.label}</span>
  )
}

function RelationRow({ item, onFocus, hideSentence }: { item: RelationExplanation; onFocus?: (key: string) => void; hideSentence?: boolean }) {
  const evidence = item.findingIds.length > 0
  return (
    <li className="sz-edge-item">
      <div className="sz-edge-triple">
        <ObjectChip obj={item.source} onFocus={onFocus} />
        <span className="sz-edge-arrow"><ArrowRight size={12} strokeWidth={2.2} aria-hidden="true" /></span>
        <ObjectChip obj={item.target} onFocus={onFocus} />
      </div>
      {!hideSentence && <p className="sz-edge-sentence">{item.sentence}</p>}
      {evidence && <EvidenceLine ids={item.findingIds} />}
    </li>
  )
}

/**
 * 엣지를 누르면 "왜 이 두 대상이 이어져 있는가"를 보여 준다. 어느 표시 수준에서든 엣지는 SaaS 안의 관계와
 * 동일인 연결(Identity Link)의 묶음이다 — 묶음 안의 항목을 문장·근거(API·수집 호출)와 함께 풀어 준다.
 */
export default function EdgeInspector({ edge, sourceNode, targetNode, activeGraph, currentLevel, v2Findings, onClose, onStop, onOpenThreat, onFocusObject, overlappingEa = [], onOpenEa, belowToolbar, onAskSelection }: EdgeInspectorProps) {
  const explanation = useMemo(
    () => explainEdge(activeGraph, edge, { source: sourceNode ?? undefined, target: targetNode ?? undefined }, v2Findings),
    [activeGraph, edge, sourceNode, targetNode, v2Findings],
  )
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const edgeFindings = v2Findings.filter(f => edge.findingIds.includes(f.id))
  const directed = edge.kind !== 'resolution_bundle'
  const sourceName = sourceNode?.label ?? edge.sourceSemanticNodeId
  const targetName = targetNode?.label ?? edge.targetSemanticNodeId
  // 관계 하나뿐이면 요약 문장이 곧 그 관계 문장이다
  const singleRelation = !explanation.links.length && explanation.relationGroups.length === 1 && explanation.relationGroups[0].items.length === 1

  return (
    <div className={`sz-inspector-float sz-edge-inspector ${belowToolbar ? 'below-toolbar' : ''}`} onClick={onStop} onPointerDown={onStop} onWheel={onStop}>
      <div className="sz-inspector-header">
        <div className="sz-inspector-title">
          <div>
            <h3>{explanation.title}</h3>
            <small>{sourceName} {directed ? '→' : '↔'} {targetName}</small>
          </div>
        </div>
        <div className="szi-head-actions">
          {onAskSelection && <AiAskButton subject="연결" onClick={onAskSelection} />}
          <button type="button" onClick={onClose} className="sz-close-btn" aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      <p className="sz-edge-summary">{explanation.summary}</p>
      {edge.servicePaths?.map(p=>(
        <section key={p.id} className="sz-edge-group">
          <header><strong>Worker 경유</strong></header>
          <p>{p.operation==='contents.update'?'GitHub 파일 변경':p.operation==='users.reset_factors'?'Okta 사용자 MFA 초기화':p.operation}</p>
          <p>요청 경로: <code>{p.via.route}</code></p>
          <p>배포된 코드와 설정에서 확인한 경로입니다. 실행 성공이나 사용자 권한을 뜻하지 않습니다.</p>
          <details><summary>근거 보기</summary>
            <p>경유 실행기: {String(activeGraph.objectsByKey.get(p.via.object_key)?.fixture_meta?.display_name??p.via.object_key)}</p>
            <p>API 메서드: {p.method}</p>
            <p>코드 지문: <code>{p.via.source_sha256}</code></p>
          </details>
        </section>
      ))}

      {overlappingEa.length > 0 && (
        <section className="szi-sec szi-sec-ea">
          <div className="szi-sec-title"><Zap size={14} strokeWidth={2} aria-hidden="true" /> 두 항목 사이의 Effective Access {overlappingEa.length}건</div>
          {/* 같은 판정, 같은 대상은 한 칸으로 묶고, 경로는 출발 → 도착과 거쳐 가는 곳만 적는다 */}
          {groupEa(overlappingEa.map(row => ({ row, x: explainEaRow(activeGraph, row), level: row.level, rule: row.source.rule, targetKey: row.references.target }))).map(group => {
            const { row, x } = group[0]
            return (
              <button key={row.id} type="button" className="szi-sec-row is-ea" onClick={() => onOpenEa?.(group.map(item => item.row.id))}>
                <Zap size={13} strokeWidth={2} aria-hidden="true" />
                <span className="szi-ea-row">
                  <span className="ea-card-top"><em className={`ea-level ${row.level}`}>{x.levelLabel}</em><span>{EA_RULE_LABEL[row.source.rule]}</span></span>
                  <EaBrief chain={x.chain} sources={[...new Set(group.map(item => item.x.source.name))]} paths={group.length} />
                </span>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            )
          })}
        </section>
      )}

      {edgeFindings.length > 0 && (
        <section className="sz-edge-group">
          <header>
            <strong>이 연결이 쓰인 탐지 결과</strong>
            <span className="sz-edge-count">{edgeFindings.length}</span>
          </header>
          <ul className="sz-edge-findings">
            {[...edgeFindings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)).map(f => (
              <li key={f.id}>
                <button type="button" className="sz-edge-finding" title={f.id} onClick={() => onOpenThreat?.(f.id)}>
                  <SeverityDot severity={f.severity} />
                  <span className="sz-edge-finding-title">{f.title}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {explanation.relationGroups.map(group => {
        const open = expanded[group.type] ?? false
        const shown = open ? group.items : group.items.slice(0, PREVIEW)
        return (
          <section key={group.type} className="sz-edge-group">
            {/* 관계 종류는 영어 코드만 보이고, 커서를 올리면 이름과 뜻이 뜬다 */}
            <header>
              <code className="sz-edge-code" title={group.meaning ? `${group.label}: ${group.meaning}` : group.label}>{group.type}</code>
              <span className="sz-edge-count">{group.items.length}</span>
            </header>
            <ul>
              {shown.map(item => <RelationRow key={item.key} item={item} onFocus={onFocusObject} hideSentence={singleRelation} />)}
            </ul>
            {group.items.length > PREVIEW && (
              <button type="button" className="sz-edge-more" onClick={() => setExpanded(prev => ({ ...prev, [group.type]: !open }))}>
                {open ? '접기' : `${group.items.length - PREVIEW}개 더 보기`}
              </button>
            )}
          </section>
        )
      })}

      {explanation.links.length > 0 && (
        <section className="sz-edge-group">
          <header>
            <code className="sz-edge-code" title={IDENTITY_LINK_MEANING}>identity_link</code>
            <span className="sz-edge-count">{explanation.links.length}</span>
          </header>
          {/* 연결 근거(이메일, 로그 같은 원문)는 적지 않고 확정, 추정 같은 수준 배지만 보인다 */}
          <ul className="sz-edge-links">
            {explanation.links.map(link => (
              <li key={link.id} className="sz-edge-item sz-edge-link">
                <div className="sz-edge-link-head">
                  <Link2 size={14} strokeWidth={2.2} aria-hidden="true" />
                  <b>{link.person ?? link.id}</b>
                  {link.kind !== 'person' && <span className="sz-edge-kind">{link.kind === 'group' ? '그룹' : '자동화'}</span>}
                  <span className={`sz-edge-level ${linkBadge(link.level)}`}>{link.levelLabel}</span>
                </div>
                {/* 이 선의 두 SaaS 계정을 먼저, 같은 주체의 다른 SaaS 계정은 따로 제목을 달아 아래에 */}
                <LinkMembers members={link.members.filter(m => m.onEdge)} onFocus={onFocusObject} />
                {link.members.some(m => !m.onEdge) && (
                  <>
                    <p className="sz-edge-sub">같은 주체의 다른 SaaS 계정</p>
                    <LinkMembers members={link.members.filter(m => !m.onEdge)} onFocus={onFocusObject} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
