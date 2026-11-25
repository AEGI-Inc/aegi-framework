import type { ItemStatus, StandardResults } from '../config-findings/standardResultsStore'
import rawSnapshot from './guidance.snapshot.json'
import { type FindingRemediation, remediationFor } from './remediations'
import { VERDICT_LABEL } from './verdicts'

export interface GuidanceSource {
  title: string
  publisher: string
  version: string
  url: string
  locator: string
}

export interface GuidanceSentence {
  text: string
  src: number[]
}

export interface GuidanceSaasControl extends GuidanceSentence {
  finding_ids: string[]
  basis: string
}

export type GuidanceField =
  | 'requirement'
  | 'auditor_checks'
  | 'evidence_examples'
  | 'common_gaps'
  | 'saas_controls'

export interface GuidanceCard {
  item_key: string
  framework: string
  location: string
  requirement: GuidanceSentence[]
  auditor_checks: GuidanceSentence[]
  evidence_examples: GuidanceSentence[]
  common_gaps: GuidanceSentence[]
  saas_controls: GuidanceSaasControl[]
  sources: GuidanceSource[]
  review: string
}

export interface RecommendationText {
  text: string
  ref: string[]
}

export interface RecommendationAction extends RecommendationText {
  finding_ids: string[]
}

export interface GuidanceRecommendation {
  item_key: string
  framework: string
  overview: RecommendationText[]
  actions: RecommendationAction[]
  human_checks: RecommendationText[]
  basis: string
  model: string
  generated_at: string
  review: string
}

export interface GuidanceItemEntry {
  guidance: GuidanceCard
  recommendation?: GuidanceRecommendation
}

export interface GuidanceSnapshot {
  version: string
  source: {
    repo: string
    commit: string
  }
  items: Record<string, GuidanceItemEntry>
}

export type ResolvedRef =
  | {
      kind: 'guidance'
      ref: string
      field: GuidanceField
      index: number
      text: string
      sources: GuidanceSource[]
    }
  | {
      kind: 'remediation'
      ref: string
      findingId: string
      summary: string
      remediation: FindingRemediation
    }

export type FindingChipStatus = ItemStatus | 'none'

export interface FindingStatusChip {
  status: FindingChipStatus
  failTargets: number
  label: string
}

const defaultSnapshot = rawSnapshot as unknown as GuidanceSnapshot

const GUIDANCE_REF_RE =
  /^guidance:(requirement|auditor_checks|evidence_examples|common_gaps|saas_controls)\[(\d+)\]$/

export function formatSourceLabel(src: Pick<GuidanceSource, 'title' | 'version' | 'locator'>): string {
  const meta = [src.version, src.locator].map(s => s.trim()).filter(Boolean).join(', ')
  return meta ? `${src.title} (${meta})` : src.title
}

export function guidanceFor(
  itemKey: string,
  snapshot: GuidanceSnapshot = defaultSnapshot,
): GuidanceCard | undefined {
  return snapshot.items[itemKey]?.guidance
}

export function recommendationFor(
  itemKey: string,
  snapshot: GuidanceSnapshot = defaultSnapshot,
): GuidanceRecommendation | undefined {
  return snapshot.items[itemKey]?.recommendation
}

export function resolveRef(
  itemKey: string,
  ref: string,
  snapshot: GuidanceSnapshot = defaultSnapshot,
): ResolvedRef | undefined {
  if (ref.startsWith('guidance:')) {
    const match = GUIDANCE_REF_RE.exec(ref)
    if (!match) return undefined
    const field = match[1] as GuidanceField
    const index = Number(match[2])
    const card = guidanceFor(itemKey, snapshot)
    const entry = card?.[field]?.[index]
    if (!card || !entry) return undefined
    const sources = entry.src
      .map(i => card.sources[i])
      .filter((s): s is GuidanceSource => Boolean(s))
    return {
      kind: 'guidance',
      ref,
      field,
      index,
      text: entry.text,
      sources,
    }
  }

  if (ref.startsWith('remediation:')) {
    const findingId = ref.slice('remediation:'.length)
    if (!findingId) return undefined
    const rem = remediationFor(findingId)
    if (!rem) return undefined
    return {
      kind: 'remediation',
      ref,
      findingId,
      summary: rem.summary,
      remediation: rem,
    }
  }

  return undefined
}

export function findingStatusChip(
  findingId: string,
  results: StandardResults | undefined,
): FindingStatusChip {
  const finding = results?.findings.find(f => f.id === findingId)
  if (!finding || finding.items.length === 0) {
    return { status: 'none', failTargets: 0, label: '판정 없음' }
  }

  const statuses = new Set<ItemStatus>()
  const failTargetKeys = new Set<string>()

  for (const item of finding.items) {
    statuses.add(item.status)
    for (const target of item.targets) {
      if (target.status === 'fail') {
        failTargetKeys.add(target.key || target.name)
      }
    }
  }

  if (statuses.has('fail') || failTargetKeys.size > 0) {
    const failTargets = failTargetKeys.size
    return {
      status: 'fail',
      failTargets,
      label: failTargets > 0 ? `${VERDICT_LABEL.fail} 대상 ${failTargets}` : VERDICT_LABEL.fail,
    }
  }
  if (statuses.has('unknown')) {
    return { status: 'unknown', failTargets: 0, label: VERDICT_LABEL.unknown }
  }
  if (statuses.has('not_collected')) {
    return { status: 'not_collected', failTargets: 0, label: '미수집' }
  }
  if (statuses.has('manual')) {
    return { status: 'manual', failTargets: 0, label: '직접 확인' }
  }
  if (statuses.has('org_policy')) {
    return { status: 'org_policy', failTargets: 0, label: '직접 확인' }
  }
  if (statuses.has('pass')) {
    return { status: 'pass', failTargets: 0, label: VERDICT_LABEL.pass }
  }

  return { status: 'none', failTargets: 0, label: '판정 없음' }
}

export function rankActions<T extends RecommendationAction>(
  actions: readonly T[],
  results: StandardResults | undefined,
): T[] {
  const hasFail = (action: T) =>
    action.finding_ids.some(fid => findingStatusChip(fid, results).status === 'fail')

  return actions
    .map((action, index) => ({ action, index, fail: hasFail(action) }))
    .sort((a, b) => {
      if (a.fail !== b.fail) return a.fail ? -1 : 1
      return a.index - b.index
    })
    .map(entry => entry.action)
}
