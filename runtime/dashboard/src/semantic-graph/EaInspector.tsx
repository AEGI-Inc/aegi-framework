import React, { useMemo, useState } from 'react'
import { ChevronDown, CircleHelp, Zap, X } from 'lucide-react'
import type { GraphStore, GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { EA_RULE_LABEL, explainEaRow } from '../findings/eaExplain'
import { EaBrief } from '../findings/EaPath'
import EaCard from './EaCard'
import AiAskButton from '../assistant/AiAskButton'

interface EaInspectorProps {
  rows: EffectiveAccessRow[]
  activeGraph: GraphStore | GraphStoreV2
  findings: FindingV2[]
  onClose: (event: React.MouseEvent<HTMLButtonElement>) => void
  onStop: (event: React.SyntheticEvent) => void
  onOpenThreat?: (findingId: string) => void
  onFocusObject?: (objectKey: string) => void
  belowToolbar?: boolean
  onAskSelection?: () => void
}

const EA_MEANING = '여러 권한과 동일인 연결을 이어 계산한 실제 접근'

/**
 * Effective Access 선을 누르면 뜨는 상세. 판정과 물은 질문, 답 한 줄을 먼저 두고,
 * 경로 그림 안에 연동 · SaaS 가 바뀌는 자리 · 확인하지 못한 곳 · 차단 지점을 붙인다.
 * 선 하나에 결론이 여럿 묶였으면(같은 두 칸 사이) 결론마다 카드를 둔다.
 */
export default function EaInspector({ rows, activeGraph, findings, onClose, onStop, onOpenThreat, onFocusObject, belowToolbar, onAskSelection }: EaInspectorProps) {
  const explained = useMemo(() => rows.map(row => explainEaRow(activeGraph, row)), [rows, activeGraph])
  const [openId, setOpenId] = useState<string | null>(null)
  if (!explained.length) return null

  return (
    <div className={`sz-inspector-float sz-edge-inspector sz-ea-inspector ${belowToolbar ? 'below-toolbar' : ''}`} onClick={onStop} onPointerDown={onStop} onWheel={onStop}>
      <div className="sz-inspector-header">
        <div className="sz-inspector-title">
          <div className="szi-ea-icon" aria-hidden="true"><Zap size={16} strokeWidth={2.2} /></div>
          <div>
            <h3>
              Effective Access
              <span className="szi-ea-help" title={EA_MEANING} aria-label={EA_MEANING} role="img"><CircleHelp size={14} strokeWidth={2} /></span>
            </h3>
            {explained.length > 1 && <small>이 선에 묶인 Effective Access {explained.length}건</small>}
          </div>
        </div>
        <div className="szi-head-actions">
          {onAskSelection && <AiAskButton subject="접근" onClick={onAskSelection} />}
          <button type="button" onClick={onClose} className="sz-close-btn" aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      {explained.length === 1 ? (
        <EaCard x={explained[0]} label="Effective Access"
          finding={findings.find(f => f.ruleId === explained[0].row.x_asked_by.rule_id)} onOpenThreat={onOpenThreat} onFocusObject={onFocusObject} />
      ) : (
        /* 여러 건이면 한 줄 목록만 두고, 누른 줄만 카드를 펼친다 */
        <section className="szi-ea-sec" aria-label="Effective Access 목록">
          {explained.map((x, i) => {
            const open = openId === x.row.id
            return (
              <div key={x.row.id} className={`szi-ea-item ${open ? 'is-open' : ''}`}>
                <button type="button" className="szi-sec-row is-ea" aria-expanded={open} onClick={() => setOpenId(open ? null : x.row.id)}>
                  <Zap size={13} strokeWidth={2} aria-hidden="true" />
                  <span className="szi-ea-row">
                    <span className="ea-card-top"><em className={`ea-level ${x.row.level}`}>{x.levelLabel}</em><span>{EA_RULE_LABEL[x.row.source.rule]}</span></span>
                    <EaBrief chain={x.chain} sources={[x.source.name]} paths={1} />
                  </span>
                  <ChevronDown size={13} aria-hidden="true" className="szi-ea-chevron" />
                </button>
                {open && <EaCard x={x} label={`Effective Access ${i + 1}`}
                  finding={findings.find(f => f.ruleId === x.row.x_asked_by.rule_id)} onOpenThreat={onOpenThreat} onFocusObject={onFocusObject} />}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
