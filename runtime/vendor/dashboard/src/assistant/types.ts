import type { AssistantFocus, AssistantPlan } from './plan'
import type { InvestigationPath } from '../semantic-graph/investigationQuery'
import type { AssistantNavigation } from './workspace'
export interface IdentityEvidenceEdge { linkId: string; from: string; to: string; level: string }
export interface EvidenceGraphSelection {
  objectKeys: string[]
  relationKeys: string[]
  linkIds: string[]
  identityEdges: IdentityEvidenceEdge[]
}
export interface AssistantEvidence {
  id: string
  kind: 'object' | 'relation' | 'identity_link' | 'finding' | 'observation' | 'evidence_link' | 'access' | 'remediation' | 'reference' | 'credential' | 'event' | 'event_link'
  ref: string
  label: string
  detail: string
  state?: 'confirmed' | 'inferred' | 'unknown'; data?: Record<string, unknown>
}
export interface AssistantEventNode {
  key: string; label: string; provider: string; occurredAt: string | null; outcome: string; suspicious: boolean
  detail: string; evidenceIds: string[]
  participants: Array<{ objectKey: string; role: 'actor' | 'target' }>
  participantsTruncated: boolean
}
export interface AssistantEventEdge {
  key: string; from: string; to: string; label: string; basis: string; bases: string[]; strength: 'confirmed' | 'review'
  detail: string; missingEndpoints: string[]; evidenceIds: string[]
}
export interface AssistantEventScope {
  evidenceId: string; eventKey?: string; available: boolean; linksAvailable?: boolean; eventFound?: boolean
  total: number | null; nextOffset: number | null; detail: string; truncated: boolean
}
export interface AssistantEventGraph { nodes: AssistantEventNode[]; edges: AssistantEventEdge[]; scopes: AssistantEventScope[] }
export interface AssistantQueryOptions { focus?: AssistantFocus; targetKey?: string; pathIndex?: number; credentialKey?: string }
export interface AssistantAction { id: string; findingId: string; title: string; description: string; hasDetail: boolean }
export interface AssistantResult {
  answer: string; evidence: AssistantEvidence[]; graph: EvidenceGraphSelection
  eventGraph?: AssistantEventGraph
  focus?: AssistantFocus
  paths?: InvestigationPath[]
  pathsTruncated?: boolean
  actions?: AssistantAction[]
  credentials?: Array<{ key: string; label: string; summary: string }>
  credentialKey?: string
  navigation?: AssistantNavigation[]
}
export interface AssistantCandidates { keys: string[]; truncated: boolean }
export type PendingAssistantPlan = Extract<AssistantPlan, { entity: unknown }>
