/**
 * 기능 C 데이터 계보. 형식은 OpenLineage 2-0-2(RunEvent, JobEvent), 관계 뜻은 W3C PROV-O 를 따른다.
 * 설계: docs/spec/AEGI_LINEAGE_V1.md
 *
 * 기능 C 는 사실만 만든다. 위반 판단, 민감도 기준은 기능 D 가 정한다.
 */

export const OPENLINEAGE_SCHEMA = 'https://openlineage.io/spec/2-0-2/OpenLineage.json'
export const LINEAGE_PRODUCER = 'https://github.com/AEGI-Inc/aegi-adapter-engine/tree/main/src/lineage'
export const LINEAGE_FORMAT = 'aegi-lineage/v1'

/**
 * 근거 수준. 경로의 수준은 간선 중 가장 약한 것을 따른다.
 * - run_record 확정: 로그나 관찰이 이동을 직접 남김
 * - content_match 내용 일치: 실행 기록은 없고 내용이 겹침 (4단계)
 * - correlation 정황: 시각 대조나 추정으로 이음
 * - structural 구조상 가능: 설정으로는 흐를 수 있지만 실행 기록이 없음
 * - unverified 미확인 구간: 경로 중간이 비어 있음
 */
export type EvidenceLevel = 'run_record' | 'content_match' | 'correlation' | 'structural' | 'unverified'

export const EVIDENCE_RANK: Record<EvidenceLevel, number> = { run_record: 5, content_match: 4, correlation: 3, structural: 2, unverified: 1 }

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  run_record: '확인',
  content_match: '내용 일치',
  correlation: '정황',
  structural: '구조상 가능',
  unverified: '미확인 구간',
}

/** 가장 약한 근거. 근거가 하나도 없으면 미확인 구간이다 (근거 없이 확정이 되지 않게) */
export const weakest = (levels: EvidenceLevel[]): EvidenceLevel =>
  levels.length ? levels.reduce((a, b) => (EVIDENCE_RANK[b] < EVIDENCE_RANK[a] ? b : a)) : 'unverified'

interface BaseFacet {
  _producer: string
  _schemaURL: string
}

export interface InputField {
  namespace: string
  name: string
  field: string
  transformations?: Array<{ type: 'DIRECT' | 'INDIRECT'; subtype?: string; description?: string; masking?: boolean }>
}

export interface ColumnLineageFacet extends BaseFacet {
  fields: Record<string, { inputFields: InputField[] }>
}

export interface SymlinksFacet extends BaseFacet {
  identifiers: Array<{ namespace: string; name: string; type: string }>
}

/** 필드 대응이 어디서 왔나. confirmed 관찰이 필드 목록을 남김, inferred 구조로 추정, unknown 알 수 없음 */
export type FieldBasis = 'confirmed' | 'inferred' | 'unknown'

/** AEGI 전용 Run, Job facet. 근거 수준과 원본 기록 */
export interface AegiEvidenceFacet extends BaseFacet {
  level: EvidenceLevel
  /** 근거가 된 관찰 id */
  observations: string[]
  /** 엔진 간선의 불확실 사유 코드 */
  reasons: string[]
  fields: FieldBasis
  /** 비어 있어 확인이 필요한 구간 */
  gaps: string[]
}

/** AEGI 전용 Run facet. 실행한 계정 */
export interface AegiActorFacet extends BaseFacet {
  account?: string
  initiatedBy?: string
}

/** AEGI 전용 Job facet. 하나로 묶은 자동화 단계 (Apps Script 와 webhook 처럼 이어진 것) */
export interface AegiJobStepsFacet extends BaseFacet {
  steps: Array<{ key: string; type: string; name: string }>
}

export interface LineageDataset {
  namespace: string
  name: string
  facets?: { symlinks?: SymlinksFacet; columnLineage?: ColumnLineageFacet }
}

export interface LineageJob {
  namespace: string
  name: string
  facets?: { aegi_jobSteps?: AegiJobStepsFacet; aegi_evidence?: AegiEvidenceFacet }
}

export interface LineageRunEvent {
  eventType: 'COMPLETE'
  eventTime: string
  producer: string
  schemaURL: string
  run: { runId: string; facets: { aegi_evidence: AegiEvidenceFacet; aegi_actor?: AegiActorFacet } }
  job: LineageJob
  inputs: LineageDataset[]
  outputs: LineageDataset[]
}

/** 정적 계보. 설정으로는 흐를 수 있지만 실행 기록이 없는 것 */
export interface LineageJobEvent {
  eventTime: string
  producer: string
  schemaURL: string
  job: LineageJob
  inputs: LineageDataset[]
  outputs: LineageDataset[]
}

export type LineageEvent = LineageRunEvent | LineageJobEvent

export const isRunEvent = (e: LineageEvent): e is LineageRunEvent => 'run' in e

/** 데이터셋 폴더의 lineage_events.json */
export interface LineageFile {
  format: typeof LINEAGE_FORMAT
  spec: typeof OPENLINEAGE_SCHEMA
  /** 원본 데이터셋의 정규화 시각. 같은 입력이면 같은 파일이 나온다 */
  created_at: string | null
  /** 계보를 만든 데이터 파일의 sha256 (scripts/lineage/run.ts sourceDigest). 게시할 때 지금 데이터와 맞춘다 */
  source_sha256?: string
  counts: { runs: number; jobs: number; datasets: number; byLevel: Partial<Record<EvidenceLevel, number>> }
  events: LineageEvent[]
}

/**
 * 기능 D 에 넘기는 사실 하나 (임시 형식, 기능 D 와 합의 전).
 * 무엇이, 어느 데이터에서, 어떤 경로로, 어떤 필드가, 얼마나 확실하게.
 */
export interface LineageFact {
  kind: 'transfer' | 'field_retention' | 'external_exposure' | 'test_location' | 'retention_after_delete' | 'classification_drop'
  dataset: { namespace: string; name: string }
  path: string[]
  fields: Array<{ field: string; transformation?: string; masking?: boolean }>
  evidence: EvidenceLevel
}
