import type { Provider } from '../model/object'

/** 조치 틀이 SaaS 마다 늘어나므로 수집 객체의 provider 와 같은 범위다 */
export type RemediationProvider = Provider

export type RemediationCategory =
  | 'access'
  | 'policy'
  | 'credential'
  | 'automation'
  | 'configuration'
  | 'monitoring'

export type RemediationPriority = 'critical' | 'high' | 'medium' | 'low'

export type RemediationExecutionMode = 'manual' | 'guided' | 'automatable'

export type RemediationStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'verified'

export type ConfigurationSource =
  | 'provider_field'
  | 'provider_ui'
  | 'aegi_recommendation'

export interface ConfigurationTarget {
  id: string
  provider: RemediationProvider
  objectKey: string
  objectType: string
  displayName: string
  settingName: string
  configurationSource: ConfigurationSource
  configurationPath?: string
  currentValue?: unknown
  recommendedValue?: unknown
  rationale: string
  changeInstructions: string[]
  permissionsRequired?: string[]
  impact?: string
  rollback?: string
  documentationUrl?: string
}

export interface VerificationStep {
  id: string
  title: string
  description?: string
  type: 'manual_check' | 'configuration_check' | 'detection_rerun'
  status?: 'pending' | 'passed' | 'failed'
}

export interface RemediationAction {
  id: string
  findingId: string
  title: string
  summary: string
  provider: RemediationProvider
  category: RemediationCategory
  priority: RemediationPriority
  targetObjectKeys: string[]
  reason: {
    findingFact: string
    risk: string
    whyThisRemediation?: string
  }
  configurationTargets: ConfigurationTarget[]
  verification: VerificationStep[]
  relatedEvidenceIds: string[]
  relatedRelationKeys: string[]
  relatedLinkIds: string[]
  executionMode: RemediationExecutionMode
  status: RemediationStatus
}

export interface RemediationProgress {
  remediationId: string
  status: RemediationStatus
  completedVerificationStepIds: string[]
  updatedAt: string
}
