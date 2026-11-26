/**
 * 게시 접근 표(aegi-adapter-engine src/detection/threat/accessTable.ts, 계산 문서 access_table). 대상마다 사람별 직접 권한,
 * 파생 접근, 새로 생긴 권한과 확실성. 화면은 접근을 계산하지 않고 이 표만 읽는다(knowledge 규칙 R-judge-in-engine).
 * 배포본은 스냅샷 번들의 derived.access_table, 로컬 개발은 데이터셋 폴더 derived.json 의 access_table 이다.
 * Explorer 와 AI access 도구처럼 데이터셋을 직접 받지 않는 곳도 읽도록 모듈 저장소에 둔다.
 */

export type AccessLevel = '읽기' | '쓰기' | '관리'
/** 수준 [읽기(1), 쓰기(2) 또는 관리(3)] */
export type AccessPair = [number, number]

export interface AccessGain {
  certainty: '확정' | '미확정'
  /** 미확정 이유(경로 모름 사유, 직접 수준 모름, 같은 사람 연결 약함과 없음, 조직 경계 모름) */
  reasons?: string[]
  /** 조직 밖 직접 공유로 선 수준(엔진 share) */
  share?: true
}

/**
 * 사람 한 줄. person 은 같은 사람 계정 묶음의 대표 계정 키(위협 person 과 같음), 누구나 공유는 @everyone.
 * direct: 권한 간선이 닿는 수준(모름 근거 포함, 수준 모르는 권한은 읽기). directSure: 확정 근거만.
 * derived, derivedSure: 파생 접근과 확정 경로 수준. points: 그 수준을 준 연동 지점. gained: 새로 생긴 권한(위협 판정과 같은 셈)
 */
export interface AccessTableRow {
  person: string
  direct?: AccessPair
  directSure?: AccessPair
  derived?: AccessPair
  derivedSure?: AccessPair
  points?: { r?: string; w?: string; rs?: string; ws?: string }
  gained?: Partial<Record<AccessLevel, AccessGain>>
}

export interface AccessTable {
  version: 1
  targets: Record<string, AccessTableRow[]>
  /** 계정이 둘 이상인 사람의 계정(대표 포함). 같은 사람 묶음은 엔진 판정이 정한다. 화면은 같은 사람을 다시 가리지 않는다 */
  accounts?: Record<string, string[]>
}

export const isAccessTable = (raw: unknown): raw is AccessTable => {
  if (!raw || typeof raw !== 'object') return false
  const t = raw as Partial<AccessTable>
  return t.version === 1 && !!t.targets && typeof t.targets === 'object' && !Array.isArray(t.targets)
}

let current: AccessTable | undefined
let byPerson: Map<string, Array<{ target: string; row: AccessTableRow }>> | undefined
let personByAccount: Map<string, string> | undefined

/** 데이터셋을 읽을 때 부른다. 모양이 맞지 않거나 없으면 표 없음 */
export function setAccessTable(raw: unknown): void {
  current = isAccessTable(raw) ? raw : undefined
  byPerson = undefined
  personByAccount = undefined
}

/** 사람(대표 계정 키)의 계정. 표에 묶음이 없으면 그 키 하나 */
export const accountsOf = (person: string): readonly string[] => current?.accounts?.[person] ?? [person]

/** 계정이 속한 사람(대표 계정 키). 묶음에 없으면 그 계정 자신 */
export function personOf(account: string): string {
  if (!personByAccount) {
    personByAccount = new Map()
    for (const [person, list] of Object.entries(current?.accounts ?? {})) for (const k of list) personByAccount.set(k, person)
  }
  return personByAccount.get(account) ?? account
}

export const hasAccessTable = (): boolean => !!current

/** 대상의 사람 줄(사람 키 순). 표가 없거나 아무도 닿지 않으면 빈 목록 */
export function accessRows(target: string): readonly AccessTableRow[] {
  return current?.targets[target] ?? []
}

/** 사람(대표 계정 키)이 닿는 대상 줄. 대상 키 순 */
export function rowsOfPerson(person: string): ReadonlyArray<{ target: string; row: AccessTableRow }> {
  if (!current) return []
  if (!byPerson) {
    byPerson = new Map()
    for (const target of Object.keys(current.targets).sort()) for (const row of current.targets[target]) {
      const list = byPerson.get(row.person)
      if (list) list.push({ target, row })
      else byPerson.set(row.person, [{ target, row }])
    }
  }
  return byPerson.get(person) ?? []
}

export type Need = 'read' | 'write' | 'admin'
export const NEED_LEVEL: Record<Need, AccessLevel> = { read: '읽기', write: '쓰기', admin: '관리' }

/** 수준이 need 이상인가 */
export const reaches = (l: AccessPair | undefined, need: Need): boolean => !!l && (need === 'read' ? l[0] >= 1 : l[1] >= (need === 'write' ? 2 : 3))

/** 가장 높은 수준 이름. 없으면 null */
export const levelName = (l: AccessPair | undefined): AccessLevel | null => (!l ? null : l[1] >= 3 ? '관리' : l[1] >= 2 ? '쓰기' : l[0] >= 1 ? '읽기' : null)

/** need 수준을 준 연동 지점. 새 권한이 확정이면 확정 경로 지점 */
export function pointOf(row: AccessTableRow, need: Need): string | undefined {
  const sure = row.gained?.[NEED_LEVEL[need]]?.certainty === '확정'
  return need === 'read' ? (sure ? row.points?.rs : undefined) ?? row.points?.r : (sure ? row.points?.ws : undefined) ?? row.points?.w
}
