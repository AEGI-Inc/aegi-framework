import type { RemediationAction, ConfigurationTarget } from '../domain/remediation'

/**
 * 화면 설명 문구 문서(display_text). aegi-adapter-engine 이 게시 때 만든다.
 * 정본은 engine display-text/ 의 검토된 YAML 이고, 비어 있는 것만 AI 생성 캐시에서 채운다(scripts/displayText).
 * 화면은 이 문서를 읽기만 한다. 문서에 없는 것은 화면이 객체 종류 이름 같은 기계적 대체 문구를 쓴다.
 */
export const DISPLAY_TEXT_FORMAT = 'aegi-display-text/v1'

/** reviewed: 사람이 검토한 정본. generated: AI 가 만들고 윤문을 거친 캐시. 검토 전이다 */
export type DisplayTextSource = 'reviewed' | 'generated'

export interface GeneratedMark {
  source: DisplayTextSource
  /** generated 만: 만든 모델, 프롬프트 판, 시각 */
  model?: string
  prompt_version?: string
  generated_at?: string
}

export interface ProviderText extends GeneratedMark {
  name?: string
  role?: string
  points?: string[]
}

export interface TypeText extends GeneratedMark {
  /** 명사형 한 줄. 「종류 — 꾸밈말」 꼴은 화면이 「꾸밈말 종류」로 붙인다 */
  meaning: string
}

/** 템플릿이 위협에 붙는 조건 */
export interface TemplateMatch {
  /** 있으면 그 판정 정책의 위협에만 붙는다 */
  policy?: string
  /** 위협 객체에 있어야 하는 SaaS 와 종류(정규식, 대소문자 무시) */
  requires?: Array<{ provider: string; type: string }>
}

export type TemplateTarget = Omit<ConfigurationTarget, 'objectKey'> & {
  /** 이 설정 대상과 맞는 위협 객체의 종류(정규식, 대소문자 무시). 없으면 SaaS 만 맞으면 된다 */
  objectKind?: string
}

/**
 * 조치 틀. 고유명사 대신 자리 표시를 쓴다. 쓸 수 있는 자리 표시는 SLOT_NAMES 다.
 * 위협에 붙일 때 그 위협의 객체로 채워 RemediationAction(guide)이 된다.
 */
export type RemediationTemplate = Omit<RemediationAction,
  'findingId' | 'targetObjectKeys' | 'relatedEvidenceIds' | 'relatedRelationKeys' | 'relatedLinkIds' | 'status' | 'configurationTargets'> & GeneratedMark & {
  match: TemplateMatch
  configurationTargets: TemplateTarget[]
}

export interface DisplayTextDocument {
  format: typeof DISPLAY_TEXT_FORMAT
  /** provider id → 이름, 역할, 특징 */
  providers: Record<string, ProviderText>
  /** `provider:object_type`(소문자) → 뜻. 이 데이터셋에 나온 종류만 싣는다 */
  types: Record<string, TypeText>
  remediations: RemediationTemplate[]
  /** 문서를 만들 때 설명이 없던 것. 화면은 기계적 대체 문구를 쓴다 */
  missing: { providers: string[]; types: string[] }
}

/** 조치 틀에서 쓸 수 있는 자리 표시와 값이 없을 때 쓰는 말 */
export const SLOT_FALLBACK = {
  tenant: '해당 조직',
  actor: '해당 사용자',
  credential: '해당 자격증명',
  automation: '해당 자동화',
  resource: '해당 리소스',
  target: '해당 대상',
} as const

export type SlotName = keyof typeof SLOT_FALLBACK
export const SLOT_NAMES = Object.keys(SLOT_FALLBACK) as SlotName[]

export const isDisplayTextDocument = (v: unknown): v is DisplayTextDocument =>
  !!v && typeof v === 'object' && (v as DisplayTextDocument).format === DISPLAY_TEXT_FORMAT &&
  typeof (v as DisplayTextDocument).types === 'object' && Array.isArray((v as DisplayTextDocument).remediations)
