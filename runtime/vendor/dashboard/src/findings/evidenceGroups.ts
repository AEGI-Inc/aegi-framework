import type { EvidenceObservation } from '../model/evidence'
import { observationKindLabel } from './observationKind'
import { providerName } from './providers'

/** 증적 원문에는 있지만 내용이 아닌 표지. 표에는 쓰지 않고 원문에서만 본다 */
const HIDDEN_FIELDS = new Set(['matching', 'record', 'synthetic_by', 'contains_source_data_basis'])

/** 수집 원문의 칸 이름을 화면 이름으로. 여기 없는 칸은 원문 칸 이름을 그대로 쓴다 */
const FIELD_LABEL: Record<string, string> = {
  result: '결과',
  event_type: '이벤트',
  actor_id: '행위자 ID',
  actor_type: '행위자 종류',
  actor_object: '행위자',
  target_ids: '대상 ID',
  target_object: '대상',
  command: '명령',
  action: '동작',
  text: '내용',
  status: '상태',
  enabled: '사용 여부',
  author: '작성자',
  caller: '호출자',
  automation: '자동화',
  trigger: '계기',
  access: '접근 범위',
  executeAs: '실행 권한',
  duration: '실행 시간',
  processType: '실행 방식',
  userAccessLevel: '호출자 스크립트 권한',
  versionNumber: '버전',
  deny_reason: '거부 사유',
  workflow_name: '워크플로',
  api_app_id: '앱 ID',
  request_channel: '요청 채널',
  request_channel_id: '요청 채널 ID',
  request_channel_name: '요청 채널 이름',
  requester_object: '요청자',
  requester_slack_user: '요청자 Slack 사용자',
  requester_slack_user_id: '요청자 Slack ID',
  source_file: '원본 보고서',
  source_record: '원본 레코드',
  source_form: '원본 양식',
  destination_endpoint: '보낸 동작',
  destination_channel: '받은 채널',
  destination_message: '받은 메시지',
  contains_source_data: '원본 내용 포함',
  correlated_commit: '연관 커밋',
  correlated_commit_sha: '연관 커밋 SHA',
  credential_kind: '자격증명 종류',
  credential_owner_object: '자격증명 소유자',
  grant_object: '권한 부여',
  okta_actor: 'Okta 행위자',
  okta_event_type: 'Okta 이벤트',
  expression: '조건식',
  assign_groups: '배정 그룹',
  changed_attributes: '바뀐 속성',
}

export function evidenceFieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key
}

/** 객체 키(im:slack:conversation:C0…)는 「Slack conversation C0…」로 줄인다. 나머지 값은 그대로 */
export function evidenceFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '없음'
  if (typeof value === 'boolean') return value ? '예' : '아니오'
  if (Array.isArray(value)) return value.length ? value.map(evidenceFieldValue).join(', ') : '없음'
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value)
  const key = text.match(/^im:([^:]+):([^:]+):(.+)$/)
  if (!key) return text
  return `${providerName(key[1])} ${key[2]} ${key[3].split('|').pop()}`
}

export interface EvidenceGroup {
  key: string
  title: string
  kindLabel: string
  items: EvidenceObservation[]
  /** 묶음 안 모든 증적에서 값이 같은 칸. 묶음 머리에 한 번만 쓴다 */
  common: string[]
  /** 증적마다 값이 다른 칸. 줄마다 쓴다 */
  varying: string[]
}

/** 제목 끝 괄호(「(대형 딜 단계 변경 1)」)를 뗀 앞부분. 같은 앞부분이면 같은 종류의 기록으로 묶는다 */
function titleBase(observation: EvidenceObservation): string {
  const title = observation.title?.trim()
  if (!title) return observationKindLabel(observation.kind)
  return title.replace(/\s*\([^()]*\)\s*$/, '') || title
}

/**
 * 같은 종류, 같은 제목 앞부분의 증적을 한 묶음으로 모은다.
 * 묶음 안에서 값이 같은 칸은 공통으로, 다른 칸은 줄마다 보이게 나눈다. 순서는 처음 나온 순서를 지킨다.
 */
export function groupEvidence(observations: EvidenceObservation[]): EvidenceGroup[] {
  const byKey = new Map<string, EvidenceObservation[]>()
  for (const observation of observations) {
    const key = `${observation.kind}|${titleBase(observation)}`
    byKey.set(key, [...(byKey.get(key) ?? []), observation])
  }
  return [...byKey.entries()].map(([key, items]) => {
    const fields: string[] = []
    for (const item of items) for (const field of Object.keys(item.attributes)) {
      if (!HIDDEN_FIELDS.has(field) && !fields.includes(field)) fields.push(field)
    }
    const same = (field: string) => {
      const first = JSON.stringify(items[0].attributes[field])
      return items.every(item => field in item.attributes && JSON.stringify(item.attributes[field]) === first)
    }
    const common = items.length === 1 ? fields : fields.filter(same)
    const varying = items.length === 1 ? [] : fields.filter(field => !common.includes(field))
    const single = items.length === 1
    return {
      key,
      title: single ? items[0].title || observationKindLabel(items[0].kind) : `${titleBase(items[0])} ${items.length}건`,
      kindLabel: observationKindLabel(items[0].kind),
      items,
      common,
      varying,
    }
  })
}
