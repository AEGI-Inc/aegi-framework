import rawSnapshot from './remediations.snapshot.json'

export interface FindingRemediationChange {
  setting: string
  recommended: string
}

export interface FindingRemediationReference {
  source: string
  item: string
  url: string
}

export type FindingRemediationReview = '검토 전' | '근거 부족'

export interface FindingRemediation {
  finding_id: string
  summary: string
  where: string
  api: string
  change: FindingRemediationChange
  steps: string[]
  impact: string
  verify: string
  references: FindingRemediationReference[]
  review: FindingRemediationReview
}

export interface RemediationsSnapshot {
  version: string
  source: {
    repo: string
    commit: string
  }
  items: Record<string, FindingRemediation>
}

const snapshot = rawSnapshot as unknown as RemediationsSnapshot

export function remediationFor(findingId: string): FindingRemediation | undefined {
  return snapshot.items[findingId]
}
