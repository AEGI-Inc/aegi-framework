// 위협 판정 V2 위협에서 조직 밖 목적지를 모은다. 예외 범위 「목적지 전체」가 쓴다
//
// 목적지는 위협 사람(threatSubjects) 가운데 조직 밖인 것이다.
// - outside:주소 → 그 주소. 경로가 메일함에서 그 주소로 가는 데이터 흐름이면 「메일 자동 전달」
// - @everyone → 누구나. 위협의 point 객체(누구나 부를 수 있는 웹앱, 링크 공유 등)마다 따로 센다
// - outside 가 켜진 계정 → 그 계정
// 지어내지 않는다. 위협에 없는 목적지는 만들지 않는다.
import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import type { Provider } from '../model/object'
import { kindNoun, objectName, objectPhrase } from '../utils/objectPhrase'

export type DestinationKind = 'address' | 'everyone' | 'account'

export interface OutsideDestination {
  /** 'outside:주소', '@everyone|point 키', 계정 키 */
  key: string
  kind: DestinationKind
  name: string
  /** 이름 아래 줄. 메일 자동 전달, point 객체, 조직 밖 계정 */
  kindLabel: string
  /** 주소 목적지의 주소(소문자) */
  address?: string
  /** 누구나 목적지의 point, 계정 목적지의 계정 키 */
  objectKey?: string
  providers: Provider[]
  /** 이 목적지에 닿는 위협 ID */
  findingIds: string[]
  /** 나가는 데이터 객체 키(mail:계정 포함) */
  targets: string[]
  /** 「메일함 1개, 파일 2개」 */
  data: string
}

const EVERYONE = '@everyone'

/** 위협 대상 키 → 화면 객체 키. mail:계정은 계정, 가상 키는 없음 */
function dataObjectKey(key: string): string | undefined {
  if (key.startsWith('mail:')) return key.slice('mail:'.length)
  if (key.startsWith('outside') || key.startsWith('attr:') || key === EVERYONE) return undefined
  return key
}

/** 이 위협이 닿는 조직 밖 목적지의 키. 위협에 조직 밖 사람이 없으면 빈 배열 */
// 목적지 예외는 조직 밖으로 나가는 읽기(데이터 반출)만 가린다. 조직 밖 사람이 얻는 비인가 접근, 권한 상승은 남는다
// (엔진 docs/spec/AEGI_THREAT_JUDGMENT_V2.md 규칙 5, 사례 N20). 그래서 목적지는 데이터 반출을 얻는 조직 밖 사람만 센다
type Subject = NonNullable<FindingV2['threatSubjects']>[number]
const EXFIL = '데이터 반출'

/** 주소는 대소문자, 앞의 http(s)://, 끝의 / 를 가리지 않는다 */
const normalizeAddress = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')

function subjectKey(finding: FindingV2, subject: Subject): string | undefined {
  if (subject.person.startsWith('outside:')) return `outside:${normalizeAddress(subject.person.slice('outside:'.length))}`
  if (subject.person === EVERYONE) return `${EVERYONE}|${finding.threatPath?.point ?? ''}`
  if (subject.outside) return subject.person
  return undefined
}

export function destinationKeysOf(finding: FindingV2): string[] {
  const keys = new Set<string>()
  for (const subject of finding.threatSubjects ?? []) {
    if (!subject.types.includes(EXFIL)) continue
    const key = subjectKey(finding, subject)
    if (key) keys.add(key)
  }
  return [...keys]
}

/** 메일함에서 이 주소로 가는 데이터 흐름이 경로에 있으면 메일 자동 전달 */
function isMailForward(finding: FindingV2, address: string): boolean {
  return (finding.threatPath?.hops ?? []).some(hop =>
    hop.kind === '데이터 흐름' && hop.from.startsWith('mail:') && hop.to.startsWith('outside') && hop.to.toLowerCase().endsWith(address))
}

/** 「메일함 1개, 파일 2개」. 많은 종류부터 */
export function summarizeData(targets: string[], graph: GraphStoreV2): string {
  const counts = new Map<string, number>()
  for (const key of targets) {
    const noun = key.startsWith('mail:') ? '메일함' : (kindNoun(graph.objectsByKey.get(key)) || '객체')
    counts.set(noun, (counts.get(noun) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([noun, n]) => `${noun} ${n}개`).join(', ')
}

const providerOf = (key: string | undefined, graph: GraphStoreV2): Provider | undefined =>
  key ? (graph.objectsByKey.get(key)?.canonical.provider as Provider | undefined) : undefined

/** V2 위협에서 조직 밖 목적지를 모은다. 위협이 많이 닿는 목적지부터 */
export function outsideDestinations(findings: FindingV2[], graph: GraphStoreV2): OutsideDestination[] {
  const byKey = new Map<string, OutsideDestination & { targetSet: Set<string>; providerSet: Set<Provider>; forward: boolean }>()
  for (const finding of findings) {
    const path = finding.threatPath
    if (!path) continue
    const targets = (finding.threatTargets?.length ? finding.threatTargets : [path.target]).filter(k => !k.startsWith('outside') && k !== EVERYONE)
    for (const key of destinationKeysOf(finding)) {
      let dest = byKey.get(key)
      if (!dest) {
        if (key.startsWith('outside:')) {
          const address = key.slice('outside:'.length)
          dest = { key, kind: 'address', name: address, kindLabel: '조직 밖 주소', address, providers: [], findingIds: [], targets: [], data: '', targetSet: new Set(), providerSet: new Set(), forward: false }
        } else if (key.startsWith(`${EVERYONE}|`)) {
          const point = key.slice(EVERYONE.length + 1)
          dest = {
            key, kind: 'everyone', name: '누구나',
            kindLabel: graph.objectsByKey.has(point) ? objectPhrase(graph, point, false) : point,
            objectKey: point, providers: [], findingIds: [], targets: [], data: '', targetSet: new Set(), providerSet: new Set(), forward: false,
          }
        } else {
          const name = graph.objectsByKey.has(key) ? objectName(graph, key) : key
          dest = { key, kind: 'account', name, kindLabel: '조직 밖 계정', objectKey: key, providers: [], findingIds: [], targets: [], data: '', targetSet: new Set(), providerSet: new Set(), forward: false }
        }
        byKey.set(key, dest)
      }
      if (!dest.findingIds.includes(finding.id)) dest.findingIds.push(finding.id)
      if (dest.address && isMailForward(finding, dest.address)) dest.forward = true
      for (const t of targets) dest.targetSet.add(t)
      // SaaS 는 point 객체, 없으면(조직 밖 주소가 point) 나가는 데이터 객체
      const provider = providerOf(path.point, graph) ?? providerOf(dataObjectKey(path.target), graph)
      if (dest.kind === 'account') {
        const own = providerOf(key, graph)
        if (own) dest.providerSet.add(own)
      } else if (provider) dest.providerSet.add(provider)
    }
  }
  return [...byKey.values()]
    .map(({ targetSet, providerSet, forward, ...dest }) => ({
      ...dest,
      kindLabel: forward ? '메일 자동 전달' : dest.kindLabel,
      providers: [...providerSet],
      targets: [...targetSet],
      data: summarizeData([...targetSet], graph),
    }))
    .sort((a, b) => b.findingIds.length - a.findingIds.length || a.name.localeCompare(b.name))
}

/**
 * 목적지 예외만으로 이 위협 전체를 가릴 수 있을 때 그 목적지 키. 아니면 null.
 * 위협의 모든 사람이 데이터 반출만 얻고 모두 조직 밖 목적지여야 한다. 하나라도 다른 유형이 섞이면 목적지 예외로는 가리지 않는다
 */
export function exfilOnlyDestinationKeys(finding: FindingV2): string[] | null {
  const subjects = finding.threatSubjects ?? []
  if (subjects.length === 0) return null
  const keys = new Set<string>()
  for (const subject of subjects) {
    if (subject.types.length === 0 || subject.types.some(t => t !== EXFIL)) return null
    const key = subjectKey(finding, subject)
    if (!key) return null
    keys.add(key)
  }
  return [...keys]
}

/** 위협 ID 별 목적지. 예외 처리 창이 이 위협의 목적지를 고를 때 쓴다 */
export function destinationsByFinding(dests: OutsideDestination[]): Map<string, OutsideDestination[]> {
  const out = new Map<string, OutsideDestination[]>()
  for (const dest of dests) {
    for (const id of dest.findingIds) {
      const list = out.get(id)
      if (list) list.push(dest)
      else out.set(id, [dest])
    }
  }
  return out
}
