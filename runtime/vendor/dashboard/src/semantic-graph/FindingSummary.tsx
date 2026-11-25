import { ArrowRight, Check, X } from 'lucide-react'
import type { FindingV2 } from '../model/findingV2'
import SeverityDot from '../findings/SeverityDot'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import { findingTagKey, scenarioTag, tagClass } from '../findings/scenarioTags'
import { sortByPriority } from '../findings/remediationMeta'
import { Block } from './SemanticInspector'

/**
 * 탐지 결과 탭에서 위협 줄을 누르면 상세 탭에 뜨는 위협 요약.
 * 그래프에서는 그 위협 경로만 강조하고, 화면을 옮기지 않은 채 무엇이 걸렸고
 * 무엇부터 할지를 본다. 판정 근거 표시는 Threat Analysis 상세와 같은 모양이다.
 * 전체 내용(탐지 경로 그래프, 증적, 예외)은 아래 단추로 Threat Analysis에서 연다.
 */
export default function FindingSummary({ finding, onClose, onOpenThreat }: {
  finding: FindingV2
  onClose: () => void
  onOpenThreat?: (findingId: string) => void
}) {
  const tag = scenarioTag(findingTagKey(finding))
  const checks = finding.checks ?? []
  const confirmed = checks.filter(check => check.state === 'confirmed').length
  const first = sortByPriority(finding.remediation)[0]

  return (
    <div className="sz-inspector-float szi-panel szi-finding">
      <div className="sz-inspector-header">
        <div className="sz-inspector-title">
          <div className="szi-title-text">
            <h3 title={finding.title}>{finding.title}</h3>
            <small>위협</small>
          </div>
        </div>
        <div className="szi-head-actions">
          <button type="button" onClick={onClose} className="sz-close-btn" aria-label="닫기"><X size={16} strokeWidth={2} /></button>
        </div>
      </div>

      {/* 심각도는 맨 앞, 그다음 분류와 위협이 지나는 SaaS. 탐지 결과 줄과 같은 순서 */}
      <div className="szi-identity-line">
        <SeverityDot severity={finding.severity} />
        <span className={`scenario-tag-badge ${tagClass(findingTagKey(finding))}`} title={tag.description}>{tag.label}</span>
        <span className="szi-finding-path" aria-label={finding.providerSet.map(providerName).join(' → ')}>
          {finding.providerSet.map((p, i) => (
            <span key={p} className="szi-identity-saas">
              {i > 0 && <ArrowRight size={12} strokeWidth={2} className="szi-iface-icon" aria-hidden="true" />}
              <ProviderLogo provider={providerLogoId(p)} />{providerName(p)}
            </span>
          ))}
        </span>
      </div>

      <Block title="설명">
        <p className="szi-block-text">{finding.summary}</p>
      </Block>

      {checks.length > 0 && (
        <Block title="판정 근거" aside={<span className="szi-block-count">확인 {confirmed}/{checks.length}</span>}>
          <ul className="fd-check-list szi-check-list">
            {checks.map(check => (
              <li key={check.id} className={`fd-check-row ${check.state}`}>
                <span className="fd-check-mark" aria-hidden="true">
                  {check.state === 'confirmed' ? <Check size={12} strokeWidth={3} /> : check.state === 'inferred' ? '≈' : '?'}
                </span>
                <span className="fd-check-text">
                  <b>
                    {check.label}
                    {check.state === 'inferred' && <em className="fd-check-state">추정</em>}
                    {check.state === 'unknown' && <em className="fd-check-state">미확인</em>}
                  </b>
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {first && (
        <Block title="우선 조치">
          <p className="szi-block-lead">{first.title}</p>
          {first.description && <p className="szi-block-text">{first.description}</p>}
        </Block>
      )}

      {onOpenThreat && (
        <div className="szi-actions">
          <button type="button" className="szi-action szi-action-wide"
            onClick={() => onOpenThreat(finding.id)}>
            Threat에서 열기<ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
