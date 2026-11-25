/** 관측 종류와 증거 관계 종류는 개념 사전(activities.yaml)에서 생성한 src/ontology/generated.ts 에서 온다 */
import * as onto from '../ontology/generated'

export type ObservationKind = onto.ObservationKind

export interface EvidenceObservation {
  id: string
  kind: ObservationKind
  title?: string
  occurredAt?: string
  objectKeys: string[]
  attributes: Record<string, unknown>
  provenance: {
    record: 'synthetic' | 'measured'
    sourceRef: string
  }
}

export type EvidenceLinkType = onto.EvidenceLinkType

export interface FindingEvidenceLink {
  id: string
  from: { kind: 'object' | 'observation'; id: string }
  to: { kind: 'object' | 'observation'; id: string }
  evidenceType: EvidenceLinkType
  label?: string
  attributes?: Record<string, unknown>
}

export interface EvidenceStore {
  observationsById: Map<string, EvidenceObservation>
  evidenceLinksById: Map<string, FindingEvidenceLink>
}
