/**
 * 데이터셋 폴더를 읽어 화면이 쓰는 판정 결과를 미리 계산한다.
 * 위협 판정 V2(src/detection/threat, docs/spec/AEGI_THREAT_JUDGMENT_V2.md. 위협마다 Access Gap 벤 accessGap 포함),
 * 자격증명별 피해 범위(두 가정, EA 행과 판정 그래프의 위임 쓰기 포함).
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEvidenceStore, buildGraphStoreV2 } from '../../src/data/datasetStore.ts'
import { runAccessEngine } from '../../src/detection/v2/engine/index.ts'
import { attachEdgeUsage, collectLogUsage, effectiveAccessUsage, type ActivityLike, type DerivedQuery, type EaExercise, type LogUsage, type RelationProvenance, type RelationUsage, type Window } from '../../src/detection/v2/engine/usage.ts'
import { computeBlastRadius, delegatedWrites, listCredentials, type BlastRadius } from '../../src/detection/v2/blastRadius.ts'
import { linkViaExists } from '../../src/detection/v2/effectiveAccess/common.ts'
import { apartPairs } from '../../src/events/eventLinks.ts'
import type { EffectiveAccessFile, EffectiveAccessRow } from '../../src/detection/v2/effectiveAccess/types.ts'
import type { CoverageFile } from '../../src/detection/v2/engine/types.ts'
import type { DisplayTextDocument } from '../../src/model/displayText.ts'
import type { EvidenceObservation, FindingEvidenceLink } from '../../src/model/evidence.ts'
import type { IdentityLink } from '../../src/model/link.ts'
import type { FixtureObject } from '../../src/model/object.ts'
import type { FixtureRelation } from '../../src/model/relation.ts'
import { assemble, blastExtent, hopEdges, usedKey } from '../../src/detection/threat/assemble.ts'
import type { ThreatV2 } from '../../src/detection/threat/contract.ts'
import { judgeGraphFromIndex } from '../../src/detection/threat/fromIndex.ts'
import { outsideAccounts } from '../../src/detection/threat/boundary.ts'
import { addCuts } from '../../src/detection/threat/cuts.ts'
import { applyApprovals, type ApprovalRow } from '../../src/detection/threat/approvals.ts'
import { judge, type JudgeGraph, type JudgeResult } from '../../src/detection/threat/judge.ts'
import { gapSummary } from '../../src/detection/threat/threatGap.ts'
import { accessTable } from '../../src/detection/threat/accessTable.ts'
import type { AccessTable } from '../../src/detection/threat/contract.ts'
import { composeDisplayText } from '../displayText/compose.ts'
import { CACHE_FILE, loadCanonical, readCache } from '../displayText/files.ts'

/** 번들과 스냅샷에 들어가는 필수 파일 (파일 번들과 D1 스냅샷 번들이 같은 목록을 쓴다) */
export const REQUIRED_FILES = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links'] as const
/** 있으면 싣는 파일 */
/** SaaS 감사 로그 수집 호출(scripts/collect/coverage/auditKinds.ts 와 같은 목록). 노드 provider 이름으로 */
const AUDIT_CALLS: Record<string, string> = { 'OK-12': 'okta', 'GH-17': 'github', 'GH-19': 'github', 'SL-11': 'slack', 'GW-10': 'gws' }
export function auditLogged(coverage: CoverageFile | undefined): Set<string> {
  const out = new Set<string>()
  for (const c of coverage?.calls ?? []) { const v = AUDIT_CALLS[c.call_id]; if (v && (c.completeness === 'full' || c.completeness === 'partial')) out.add(v) }
  return out
}

export const OPTIONAL_FILES = ['effective_access', 'coverage', 'lineage_events', 'standard_results'] as const
/** 표가 아닌 한 덩어리로 두는 파일 */
export const DOCUMENT_FILES = ['manifest', 'coverage', 'lineage_events', 'effective_access', 'standard_results'] as const

export interface DatasetFiles {
  manifest: Record<string, any>
  objects: FixtureObject[]
  relations: FixtureRelation[]
  links: IdentityLink[]
  observations: EvidenceObservation[]
  evidence_links: FindingEvidenceLink[]
  effective_access?: EffectiveAccessFile
  coverage?: CoverageFile
  lineage_events?: Record<string, any>
  /** 기준별 설정 판정(scripts/standards). Config Findings 화면이 읽는다 */
  standard_results?: Record<string, any>
}

export interface CredentialBlast {
  key: string
  provider: string
  token: BlastRadius
  account: BlastRadius
}

export interface Aggregate {
  id: string
  kind: string
  detail: unknown
}

export interface ComputedSnapshot {
  datasetDir: string
  /** 데이터셋 파일 내용의 지문. 같은 데이터셋이면 같은 값 (미리보기와 운영을 잇는 열쇠) */
  datasetSha256: string
  /** 판정 코드의 지문(engineSha256). 데이터셋이 같아도 판정 코드나 제목 틀이 바뀌면 새 스냅샷이 된다 */
  engineSha256: string
  /** 판정 입력(대시보드 승인 목록)의 지문. 승인 행이 없으면 없음. 승인을 바꾸면 같은 데이터셋, 같은 코드라도 새 스냅샷이 된다 */
  inputsSha256?: string
  files: DatasetFiles
  /** 위협 판정 V2 결과. snap_findings 에는 이것만 싣는다(0008 migration 의 네 열 포함) */
  threatsV2: ThreatV2[]
  blast: CredentialBlast[]
  aggregates: Aggregate[]
  /** 화면 설명 문구(display-text/ 정본 + AI 생성 캐시). 스냅샷 문서 display_text 로 싣는다 */
  displayText: DisplayTextDocument
  /** 대상마다 사람별 직접 권한과 파생 접근(accessTable.ts). 스냅샷 문서 access_table 로 싣는다. Explorer, AI access 도구가 읽는다 */
  accessTable: AccessTable
  /**
   * 사건 기록(activities.json)으로 본 「실제로 쓰였나」(aegi-knowledge specs/Activity_Usage_v1.md). 사건이 없으면 없다.
   * 판정(위협, EA level)과 게시 내용(D1 적재 칸)은 바꾸지 않는다. EA 행 id 로 잇는 옆 표다
   */
  activityUsage?: ActivityUsageReport
  /** 위 표를 만든 사건별 판정(점수판 gt:logs, gt:board 가 읽는다). 게시하지 않는다 */
  logUsage?: LogUsage
}

export interface ActivityUsageReport {
  activities: number
  windows: Record<string, Window>
  edges: { with_usage: number; observed_with_usage: number }
  relations: Record<string, { usage?: RelationUsage; provenance?: RelationProvenance }>
  effective_access: Record<string, EaExercise>
}

/** 데이터셋 폴더의 사건 기록. 파일이 없으면 빈 목록(로그가 없는 환경) */
export function readActivities(dir: string): ActivityLike[] {
  const file = path.join(dir, 'activities.json')
  if (!fs.existsSync(file)) return []
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  return Array.isArray(rows) ? rows : []
}

/**
 * 수집기 자신의 그래프 객체 키. 환경 변수 AEGI_SELF_KEYS_FILE 이 가리키는 파일(JSON 배열 또는 줄마다 키 하나).
 * 사건 기록의 self(AEGI_GWS_SELF_CLIENT_IDS 등 registry 기준)에 더한다. 없으면 빈 집합
 */
export function selfKeysFromEnv(file = process.env.AEGI_SELF_KEYS_FILE): Set<string> {
  if (!file) return new Set()
  const text = fs.readFileSync(file, 'utf8').trim()
  const list: unknown = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/)
  return new Set((Array.isArray(list) ? list : []).map(String).map(s => s.trim()).filter(Boolean))
}

export function readDatasetFiles(dir: string): DatasetFiles {
  const missing = REQUIRED_FILES.filter(f => !fs.existsSync(path.join(dir, `${f}.json`)))
  if (missing.length) throw new Error(`데이터셋 파일이 없다: ${missing.join(', ')} (${dir})`)
  const out: Record<string, unknown> = {}
  for (const f of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    const file = path.join(dir, `${f}.json`)
    if (fs.existsSync(file)) out[f] = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const files = out as unknown as DatasetFiles
  if (!Array.isArray(files.objects) || !files.objects.length) throw new Error('objects.json 이 비어 있다')
  return files
}

/** 필수, 선택 파일의 원문 바이트로 만든 지문 (파일 이름 순서 고정) */
export function datasetSha256(dir: string): string {
  const hash = crypto.createHash('sha256')
  for (const f of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    const file = path.join(dir, `${f}.json`)
    if (!fs.existsSync(file)) continue
    hash.update(`${f}\n`)
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let engineShaCache: string | undefined

/**
 * EA 를 만드는 코드와 규칙 파일. runs_as_inherits 는 규칙 파일(ontology/)을 읽는 실행기가 계산하고,
 * --from-current 는 EA 를 다시 계산한다(fromCurrent.ts refreshEffectiveAccess). 규칙만 바뀌어도 새 스냅샷이 되도록 지문에 넣는다
 */
export const EA_CODE_FILES = [
  'scripts/accessRules/production.ts', 'scripts/accessRules/executor.ts', 'scripts/collect/shared/match.ts', 'scripts/loader/fromCurrent.ts',
  'ontology/access_rules.yaml', 'ontology/relation_semantics.yaml',
] as const

/**
 * 판정 결과를 바꾸는 코드의 지문: src 의 코드(.ts, .tsx, src/data 밖의 .json), 이 파일, EA 를 만드는 코드와 규칙 파일(EA_CODE_FILES, 없는 것은 건너뜀).
 * src/ontology/generated.ts 에 aegi-knowledge 의 제목 틀이 들어 있어 틀이 바뀌어도 달라진다.
 * 줄바꿈을 LF 로 맞춰 Windows 와 Linux 체크아웃에서 같은 값이 나온다.
 */
export function engineSha256(root = ENGINE_ROOT): string {
  if (root === ENGINE_ROOT && engineShaCache) return engineShaCache
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      const rel = path.relative(root, full).replace(/\\/g, '/')
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(e.name) || (e.name.endsWith('.json') && !rel.startsWith('src/data/'))) files.push(rel)
    }
  }
  walk(path.join(root, 'src'))
  files.push('scripts/loader/engine.ts')
  // 화면 설명 문구의 정본과 AI 생성 캐시도 스냅샷 내용(display_text, 위협의 조치 상세)을 바꾼다
  const textDir = path.join(root, 'display-text')
  const walkText = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walkText(full)
      else if (/\.(yaml|md|json)$/.test(e.name)) files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walkText(textDir)
  for (const rel of EA_CODE_FILES) if (fs.existsSync(path.join(root, rel))) files.push(rel)
  const hash = crypto.createHash('sha256')
  for (const rel of files.sort()) {
    hash.update(`${rel}\n`)
    hash.update(fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'))
  }
  // AI 생성 캐시는 코드 폴더 밖에 있을 수 있다(AEGI_DISPLAY_TEXT_CACHE). 이 체크아웃의 지문에만 넣는다
  if (root === ENGINE_ROOT && fs.existsSync(CACHE_FILE)) {
    hash.update('display-text-cache\n')
    hash.update(fs.readFileSync(CACHE_FILE, 'utf8').replace(/\r\n/g, '\n'))
  }
  const sha = hash.digest('hex')
  if (root === ENGINE_ROOT) engineShaCache = sha
  return sha
}

/** EA 행의 끝점 객체, via 관계(끝점과 어휘까지), via 링크 간선이 이 그래프에 없으면 그 문제를 돌려준다 */
export function danglingEffectiveAccess(file: EffectiveAccessFile, graph: ReturnType<typeof buildGraphStoreV2>): string[] {
  const out: string[] = []
  for (const row of file.rows) {
    for (const end of [row.references.source, row.references.target]) if (!graph.objectsByKey.has(end)) out.push(`${row.id}: 없는 객체 ${end}`)
    row.via.forEach((v, i) => {
      if (v.kind === 'relation') {
        const rel = graph.relationsByKey.get(v.ref)
        if (!rel) out.push(`${row.id}: via[${i}] 관계 ${v.ref} 가 없다`)
        else if (rel.sourceKey !== v.source || rel.targetKey !== v.target || rel.relationType !== v.relation_type) out.push(`${row.id}: via[${i}] 가 관계 ${v.ref} 와 끝점, 어휘가 다르다`)
      } else if (v.kind === 'link' && !linkViaExists(v, graph)) out.push(`${row.id}: via[${i}] 링크 간선 ${v.ref} 가 없다`)
    })
  }
  return out
}

export interface SnapshotOptions {
  /** 대시보드 승인 목록(D1 destination_approvals, 취소 안 한 행). 게시 때 publish.ts 가 읽어 넘긴다 */
  approvals?: ApprovalRow[]
  /** 차단 지점마다 그 간선을 지운 그래프로 다시 판정해 확인한다. 느려서 게시 때만 켠다 */
  verifyCuts?: boolean
  selfIds?: ReadonlySet<string>
  /** 수집기 자신의 그래프 객체 키. AEGI_SELF_KEYS_FILE 의 키와 합친다 */
  selfKeys?: ReadonlySet<string>
}

/** 승인 행 지문. 읽은 순서와 상관없게 정렬한다 */
export function approvalsSha256(rows: ApprovalRow[]): string {
  const lines = rows.map(r => JSON.stringify([r.list, r.kind, r.target.trim().toLowerCase(), r.source])).sort()
  return crypto.createHash('sha256').update(lines.join(',')).digest('hex')
}

export function computeSnapshot(dir: string, opts: SnapshotOptions = {}): ComputedSnapshot {
  const files = readDatasetFiles(dir)
  const graph = buildGraphStoreV2(files.objects, files.relations, files.links)
  const evidence = buildEvidenceStore(files.observations, files.evidence_links)
  // 게시 전 검사: EA 행이 가리키는 관계, 연결, 객체가 같은 데이터셋에 있어야 한다.
  // 규칙 형식 검사(lintEffectiveAccess)는 EA 를 만드는 함수 하나(scripts/accessRules/production.ts datasetEffectiveAccess)가 한다.
  // 여기서 다시 하면 형식이 바뀐 뒤 옛 EA 가 든 데이터셋을 --dataset 으로 게시할 수 없다
  if (files.effective_access) {
    const problems = danglingEffectiveAccess(files.effective_access, graph)
    if (problems.length) throw new Error(`effective_access 검사 실패 ${problems.length}건: ${problems.slice(0, 5).join('; ')}`)
  }

  const displayText = composeDisplayText(files.objects, loadCanonical(), readCache())
  // 범용 접근 엔진의 간선 색인(access.engine.ix)을 위협 판정과 사건 기록 대조가 같이 쓴다
  const access = runAccessEngine({ graph, evidence, coverage: files.coverage })
  // 조직 경계: 벤더가 계정 속성으로 밝힌 게스트, 고객, 외부 워크스페이스 계정 (src/detection/threat/boundary.ts)
  const judgeGraph = judgeGraphFromIndex(access.engine.ix, { outside: new Set(outsideAccounts(graph).keys()) })
  if (opts.approvals?.length) applyApprovals(judgeGraph, opts.approvals, graph)
  // 침입 탐지: 감사 로그를 수집한 SaaS(수집 범위에 그 호출이 있고 비지 않음)
  judgeGraph.logged = auditLogged(files.coverage)
  // 판정 결과는 Access Gap 원천(holders, reach)과 사건 기록 대조의 파생 접근을 물을 때 쓰려고 파생 표를 붙잡는다.
  // 둘 다 여기서 끝내고 버려 차단 지점 확인의 다시 판정과 겹치지 않게 한다. 사건 기록 대조는 간선 사용(e.usage)만 남기고,
  // 차단 지점, 피해 범위는 e.usage 를 읽지 않는다. 위협은 사건 기록 대조의 판정(연동으로만 설명된 확실한 사건)으로 「발생」만 정한다
  const activities = readActivities(dir)
  // 피해 범위의 위임 쓰기는 판정 그래프(앱의 다른 SaaS 실행 신원)에서 읽는다
  const delegated = delegatedWrites(judgeGraph)
  const eaRows: EffectiveAccessRow[] = (files.effective_access?.rows ?? []).filter(r => r.level !== 'denied')
  const blast = listCredentials(graph).map(obj => ({
    key: obj.fixture_key,
    provider: obj.canonical.provider,
    token: computeBlastRadius(obj.fixture_key, 'token', { graph, eaRows, delegated }),
    account: computeBlastRadius(obj.fixture_key, 'account', { graph, eaRows, delegated }),
  }))
  // 대상이 자격증명인 위협의 심각도 범위는 그 자격증명 피해 범위(토큰 권한만 가정, 명세 「심각도」)
  const credentialExtent = new Map(blast.map(b => [b.key, blastExtent(b.token)]))
  const { threatsV2, callers, usage, table } = (() => {
    const judged = judge(judgeGraph)
    const usage = activities.length
      ? collectLogUsage(access.engine, activities, { selfKeys: new Set([...selfKeysFromEnv(), ...(opts.selfKeys ?? [])]), selfIds: opts.selfIds, derived: derivedQuery(judged, judgeGraph, access.engine.ix.edges) })
      : undefined
    return {
      threatsV2: assemble(judgeGraph, judged.threats, judged.trace, usage ? occurredOf(usage, judged) : undefined, judged, credentialExtent), callers: judged.callers,
      table: accessTable(judged.access(), judged.accountsOf),
      usage,
    }
  })()
  // 차단 지점마다 그 간선을 지운 그래프로 다시 판정해 위협이 닫히는지 확인한다
  addCuts(judgeGraph, threatsV2, { verify: !!opts.verifyCuts, callers })

  const inputsSha256 = opts.approvals?.length ? approvalsSha256(opts.approvals) : undefined
  const out: ComputedSnapshot = { datasetDir: dir, datasetSha256: datasetSha256(dir), engineSha256: engineSha256(), ...(inputsSha256 ? { inputsSha256 } : {}), files, threatsV2, blast, aggregates: aggregatesOf(files, threatsV2.map(t => ({ severity: t.severity, category: t.primaryType })), threatsV2), displayText, accessTable: table }
  // 사건 기록은 판정이 다 끝난 뒤 별도 단계로 붙인다. 사건이 0 건이면 아무것도 하지 않는다(결과가 지금과 같다)
  if (usage) {
    const withUsage = attachEdgeUsage(access.engine.ix.edges.values(), usage)
    const providerOf = (k: string) => graph.objectsByKey.get(k)?.canonical.provider
    out.logUsage = usage
    out.activityUsage = {
      activities: activities.length,
      windows: usage.windows,
      edges: { with_usage: withUsage, observed_with_usage: [...access.engine.ix.edges.values()].filter(e => e.usage && e.observed).length },
      relations: Object.fromEntries([...usage.relations].sort(([a], [b]) => a.localeCompare(b))),
      effective_access: effectiveAccessUsage(files.effective_access?.rows ?? [], usage, providerOf),
    }
  }
  return out
}

/**
 * 사건 기록 대조가 묻는 파생 접근(usage.ts DerivedQuery). 판정 경로 간선을 게시 근거 찾기와 같은 규칙(hopEdges)으로 판정 그래프 간선에 잇고,
 * 간선 색인(edgeIds)에 있는 간선 id 와, id 로 못 잇는 간선(실행 신원 사슬)의 관계로 옮긴다
 */
export function derivedQuery(judged: Pick<JudgeResult, 'derivedAt'>, g: JudgeGraph, edgeIds: { has(id: string): boolean }): DerivedQuery {
  const find = hopEdges(g)
  return {
    at(account, cap, t) {
      const r = judged.derivedAt(account, cap, t)
      if (!r) return undefined
      const edges = new Set<string>()
      const relations = new Set<string>()
      for (const h of r.hops) for (const e of find(h)) {
        if (e.id && edgeIds.has(e.id)) edges.add(e.id)
        else for (const ref of e.refs ?? []) if (ref.type === 'relation') relations.add(ref.id)
      }
      return { sure: r.sure, edges: [...edges].sort(), relations: [...relations].sort() }
    },
  }
}

/**
 * 위협 「발생」의 열쇠(assemble observed, 명세 5절 규칙 12 「발생(로그로 쓰인 것 확인)」).
 * 사건 기록 대조가 원래 권한으로는 설명 못 하고 파생 접근(연동)으로만, 확실하게(uncertain 아님) 설명한 사건만 본다.
 * 그 사건의 행위자, 수준, 대상으로 파생 접근을 다시 물어(이미 센 표를 찾기만 함) 확실한 답의 연동 지점과 사람으로 판정 행을 고른다.
 * 원래 권한으로 설명된 사건(실행 신원이 사람 계정인 자동화의 그 사람 행위 등)과 불확실한 사건은 쓰지 않는다
 */
export function occurredOf(usage: Pick<LogUsage, 'verdicts'>, judged: Pick<JudgeResult, 'derivedAt'>): Set<string> {
  const out = new Set<string>()
  const asked = new Set<string>()
  for (const v of usage.verdicts) {
    if (v.cls !== 'integration' || v.uncertain || !v.actor) continue
    if (v.capability !== 'read' && v.capability !== 'write' && v.capability !== 'admin') continue
    for (const t of v.asked) {
      // 같은 행위자, 수준, 대상의 사건이 많아도 한 번만 묻는다
      const k = JSON.stringify([v.actor, v.capability, t])
      if (asked.has(k)) continue
      asked.add(k)
      const r = judged.derivedAt(v.actor, v.capability, t)
      if (!r?.sure) continue
      out.add(r.person ? usedKey(r.point, r.person, t) : r.point)
    }
  }
  return out
}

/**
 * 화면이 첫 칸에 쓰는 숫자들. 화면이 전체 그래프를 받지 않아도 그릴 수 있게 미리 센다. findings 는 게시하는 위협(V2)의 심각도와 대표 유형.
 * threats: 게시하는 위협(V2). 위협 Access Gap 벤 집계 threat_access_gap 을 센다
 */
export function aggregatesOf(files: DatasetFiles, findings: Array<{ severity: string; category?: string }>, threats: ReadonlyArray<Pick<ThreatV2, 'accessGap'>> = []): Aggregate[] {
  const providerOf = new Map(files.objects.map(o => [o.fixture_key, o.canonical?.provider ?? 'unknown']))
  const countBy = <T>(items: T[], key: (x: T) => string) => items.reduce<Record<string, number>>((acc, x) => { const k = key(x); acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
  const relProvider = (r: FixtureRelation) => {
    const ref = (r as any).canonical?.references
    const from = providerOf.get(String(ref?.source?.value ?? (r as any).from_key ?? '')) ?? 'unknown'
    const to = providerOf.get(String(ref?.target?.value ?? (r as any).to_key ?? '')) ?? 'unknown'
    return `${from}>${to}`
  }
  return [
    { id: 'objects_by_provider', kind: 'count', detail: countBy(files.objects, o => o.canonical?.provider ?? 'unknown') },
    { id: 'relations_by_type', kind: 'count', detail: countBy(files.relations, r => (r as any).canonical?.relation_type ?? (r as any).type ?? 'unknown') },
    { id: 'relations_by_provider_pair', kind: 'count', detail: countBy(files.relations, relProvider) },
    { id: 'findings_by_severity', kind: 'count', detail: countBy(findings, f => f.severity) },
    { id: 'findings_by_category', kind: 'count', detail: countBy(findings, f => f.category ?? 'uncategorized') },
    // 위협마다 Access Gap 벤(threatGap.ts)의 사람 수
    { id: 'threat_access_gap', kind: 'summary', detail: gapSummary(threats) },
    { id: 'totals', kind: 'summary', detail: { objects: files.objects.length, relations: files.relations.length, links: files.links.length, findings: findings.length } },
    // 한 동일인 연결 안에 같이 들었지만 같은 사람으로 보지 않는 계정 쌍(이벤트 연결의 같은 사람 판단). 대시보드 행위 흐름이 따로 표시한다
    { id: 'identity_pairs_apart', kind: 'pairs', detail: apartPairs(files.links) },
  ]
}
