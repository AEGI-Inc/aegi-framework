import { ArrowRight, KeyRound } from 'lucide-react'
import type { GraphStoreV2 } from '../model/graph'
import type { BlastMode, BlastRadius } from '../detection/v2/blastRadius'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId, providerName } from '../findings/providers'
import { CERTAINTY_LABEL, MODE_LABEL, NO_REACH_LABEL, headline, providerRank, reachedNodes } from './blastLabels'
import { blastFor } from './useBlastRadii'

function Row({ mode, radius, graph }: { mode: BlastMode; radius: BlastRadius; graph: GraphStoreV2 }) {
  const reached = reachedNodes(radius)
  const providers = [...new Set(reached.map(n => n.provider))].sort((a, b) => providerRank(a) - providerRank(b))
  return (
    <div className="br-summary-row">
      <span>{MODE_LABEL[mode]}</span>
      {reached.length === 0 ? (
        <span>{NO_REACH_LABEL}</span>
      ) : (
        <span className="br-reach">
          <span className="br-reach-top">
            <b className={radius.highest?.level === 'admin' ? 'is-admin' : ''}>{headline(radius, graph)}</b>
            {radius.highest && radius.certainty === 'inferred' && <em className="br-certainty">{CERTAINTY_LABEL.inferred}</em>}
          </span>
          <span className="br-reach-sub">
            {providers.map(p => (
              <span key={p} className="lst-logo" title={providerName(p)}><ProviderLogo provider={providerLogoId(p)} /></span>
            ))}
            <span>{reached.length}개</span>
          </span>
        </span>
      )}
    </div>
  )
}

/** Cross-SaaS Graph 상세 패널: 자격증명을 고르면 두 시나리오의 피해범위를 짧게 보이고 Credentials 상세로 잇는다 */
export default function BlastSummary({ credentialKey, graph, eaRows, onOpen }: {
  credentialKey: string
  graph: GraphStoreV2
  eaRows?: readonly EffectiveAccessRow[]
  onOpen?: (credentialKey: string) => void
}) {
  const blast = blastFor(graph, credentialKey, eaRows)
  if (!blast) return null
  return (
    <div className="br-summary">
      <div className="br-summary-title"><KeyRound size={14} strokeWidth={2} aria-hidden="true" /> 탈취 시 피해범위</div>
      <Row mode="token" radius={blast.token} graph={graph} />
      <Row mode="account" radius={blast.account} graph={graph} />
      {onOpen && (
        <button type="button" className="ex-btn br-summary-open" onClick={() => onOpen(credentialKey)}>
          피해범위 상세 <ArrowRight size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
