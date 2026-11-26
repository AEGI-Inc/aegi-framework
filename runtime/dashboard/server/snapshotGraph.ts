/**
 * D1 current 스냅샷에서 필요한 행만 읽어 작은 그래프(GraphStoreV2)를 만든다.
 * 서버 도구(server/graphTools.ts)가 브라우저와 같은 도구 코드(src/assistant/kgTools.ts)를 이 그래프 위에서 돌린다.
 * Workers 무료 플랜(요청당 CPU 10ms)이라 전체 그래프를 읽지 않는다. 고르고 세는 일은 D1 질의가 한다.
 */
import type { D1Like } from './exceptions'
import { buildEvidenceStore, buildGraphStoreV2 } from '../src/data/datasetStore'
import type { GraphStoreV2 } from '../src/model/graph'
import type { EvidenceStore } from '../src/model/evidence'
import type { FixtureObject } from '../src/model/object'
import type { FixtureRelation } from '../src/model/relation'
import { isNameKeyRole } from '../src/model/relation'
import type { IdentityLink } from '../src/model/link'
import { withoutUnusedPlatformDefaults } from '../src/model/platformDefaults'

export const HEAD_SQL = "SELECT snapshot_id FROM graph_head WHERE name = 'current'"
/** D1 한 문장의 바인딩 한도는 100개다. snapshot_id 하나를 빼고 나눈다 */
const IN_CHUNK = 90

/**
 * 고정 스냅샷을 단 D1. 같은 D1 을 쓰는 배포 가운데 하나(공개 데모)만 current 가 아닌 스냅샷을 보게 한다.
 * 값은 Pages, Worker 환경 변수 AEGI_GRAPH_SNAPSHOT_ID 에서 온다(withSnapshotPin). 쓰기는 원래 D1 에 그대로 간다.
 */
interface PinnedD1 extends D1Like {
  readonly pinnedSnapshotId: string
}

export function withSnapshotPin<T extends D1Like | undefined>(db: T, snapshotId: string | undefined): T {
  const id = snapshotId?.trim()
  if (!db || !id) return db
  const pinned: PinnedD1 = { prepare: sql => db.prepare(sql), batch: statements => db.batch(statements), pinnedSnapshotId: id }
  return pinned as unknown as T
}

/** 고정 스냅샷 id. 고정이 없는 D1 이면 undefined */
export function pinnedSnapshotIdOf(db: D1Like): string | undefined {
  return (db as Partial<PinnedD1>).pinnedSnapshotId
}

/**
 * 읽을 그래프 스냅샷 id. 고정 스냅샷이 있으면 그것(ready 일 때만, 없으면 null), 아니면 graph_head current.
 * 그래프 읽기는 모두 이 함수로 스냅샷을 고른다. graph_head 를 SQL 에서 직접 읽지 않는다
 */
export async function currentSnapshotId(db: D1Like): Promise<string | null> {
  const pin = (db as Partial<PinnedD1>).pinnedSnapshotId
  if (pin) {
    const ready = await db.prepare("SELECT id FROM graph_snapshots WHERE id = ? AND status = 'ready'").bind(pin).first<{ id: string }>()
    if (!ready) console.error(`고정 스냅샷 ${pin} 이 D1 에 없거나 ready 가 아니다`)
    return ready?.id ?? null
  }
  return (await db.prepare(HEAD_SQL).first<{ snapshot_id: string }>())?.snapshot_id ?? null
}

interface DetailRow { id: string; ord: number; detail: string }

/** 값 목록을 IN 절 한도로 나눠 함께 질의한다. D1 이 멀리 있으면 왕복 하나가 수백 ms 라 나눈 조각을 차례로 기다리지 않는다 */
export async function inChunks<T>(values: string[], query: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < values.length; i += IN_CHUNK) chunks.push(values.slice(i, i + IN_CHUNK))
  return (await Promise.all(chunks.map(query))).flat()
}

/** 표에서 id 목록의 행을 원래 순서(ord)로 읽는다 */
export async function rowsById(db: D1Like, snapshotId: string, table: string, ids: Iterable<string>): Promise<DetailRow[]> {
  const unique = [...new Set(ids)].filter(Boolean)
  const rows = await inChunks(unique, async chunk => (await db.prepare(`SELECT id, ord, detail FROM ${table} WHERE snapshot_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`).bind(snapshotId, ...chunk).all<DetailRow>()).results)
  return rows.sort((a, b) => a.ord - b.ord)
}

export interface Subgraph {
  graph: GraphStoreV2
  evidence: EvidenceStore
}

/**
 * 아무도 쓰지 않는 플랫폼 기본 객체 (src/model/platformDefaults.ts isUnusedPlatformDefault 와 같은 조건).
 * 화면이 기본 보기에서 빼면(hideDefaults) 서버 질의도 같은 객체와 그 객체에 닿는 관계를 뺀다.
 * judged 가 없는 객체도 참/거짓이 나오게 IS 로 비교한다 (= 이면 NULL 이 되어 NOT 을 붙여도 빠진다).
 */
export const hiddenObject = (alias: string) =>
  `(json_extract(${alias}.detail, '$.canonical.judged.origin') IS 'platform_default' AND json_extract(${alias}.detail, '$.canonical.judged.assignment_count') IS 0)`
export const visibleObject = (alias: string, hideDefaults: boolean) => hideDefaults ? `NOT ${hiddenObject(alias)}` : '1'
/** 관계의 양 끝이나 역할이 숨긴 객체면 보이지 않는다 */
export const visibleRelation = (alias: string, hideDefaults: boolean) => hideDefaults
  ? `NOT EXISTS (SELECT 1 FROM snap_objects h WHERE h.snapshot_id = ${alias}.snapshot_id AND h.id IN (${alias}.from_key, ${alias}.to_key, json_extract(${alias}.detail, '$.canonical.references.role.value')) AND ${hiddenObject('h')})`
  : '1'

/**
 * 고른 객체, 관계, 계정 연결과 그것이 가리키는 객체(관계 양 끝과 역할, 연결의 모든 구성원)를 읽어 그래프를 만든다.
 * 순서는 스냅샷의 원래 순서를 지켜 브라우저 그래프와 같은 순서로 돈다.
 * hideDefaults 면 화면과 같은 규칙(withoutUnusedPlatformDefaults)으로 거른다.
 */
export async function loadSubgraph(db: D1Like, snapshotId: string, seed: { objectKeys?: Iterable<string>; relationKeys?: Iterable<string>; linkIds?: Iterable<string> }, hideDefaults = false): Promise<Subgraph> {
  // 관계 줄(역할 권한 줄까지)과 계정 연결은 서로 기다리지 않는다
  const [relations, links] = await Promise.all([
    relationsWithGrants(db, snapshotId, [...(seed.relationKeys ?? [])]),
    rowsById(db, snapshotId, 'snap_links', seed.linkIds ?? []).then(rows => rows.map(r => JSON.parse(r.detail) as IdentityLink)),
  ])
  const objectKeys = new Set<string>([...(seed.objectKeys ?? [])].filter(Boolean))
  for (const rel of relations) {
    objectKeys.add(String(rel.canonical.references.source.value))
    objectKeys.add(String(rel.canonical.references.target.value))
    const role = rel.canonical.references.role
    if (role && !isNameKeyRole(role)) objectKeys.add(String(role.value))
  }
  for (const link of links) for (const member of link.set) objectKeys.add(member.object_key)
  const objects = (await rowsById(db, snapshotId, 'snap_objects', objectKeys)).map(r => JSON.parse(r.detail) as FixtureObject)
  const shown = hideDefaults ? withoutUnusedPlatformDefaults(objects, relations, links) : { objects, relations, links }
  return { graph: buildGraphStoreV2(shown.objects, shown.relations, shown.links), evidence: buildEvidenceStore([], []) }
}

/** 고른 관계 줄과 그 역할 관계의 권한 줄을 원래 순서로. 이미 읽은 줄은 다시 읽지 않는다 */
async function relationsWithGrants(db: D1Like, snapshotId: string, keys: string[]): Promise<FixtureRelation[]> {
  const seedRows = await rowsById(db, snapshotId, 'snap_relations', keys)
  const seen = new Set(seedRows.map(r => r.id))
  const grantKeys = (await roleGrantKeys(db, snapshotId, seedRows.map(r => JSON.parse(r.detail) as FixtureRelation))).filter(k => !seen.has(k))
  const rows = grantKeys.length ? [...seedRows, ...await rowsById(db, snapshotId, 'snap_relations', grantKeys)].sort((a, b) => a.ord - b.ord) : seedRows
  return rows.map(r => JSON.parse(r.detail) as FixtureRelation)
}

/**
 * 역할 관계(has_role_on)의 세기(roleRelationCapability)는 역할 객체가 같은 대상에 받은 권한 줄(Jira 프로젝트 역할 → 권한 스킴 줄)도 본다.
 * 브라우저 그래프와 같은 세기가 나오게 그 줄의 id 를 찾는다
 */
async function roleGrantKeys(db: D1Like, snapshotId: string, relations: FixtureRelation[]): Promise<string[]> {
  const pairs = new Set<string>()
  for (const r of relations) {
    const role = r.canonical.references.role
    if (r.canonical.relation_type === 'has_role_on' && role && !isNameKeyRole(role)) pairs.add(`${role.value}\u0000${r.canonical.references.target.value}`)
  }
  const roles = [...new Set([...pairs].map(p => p.split('\u0000')[0]))]
  const rows = await inChunks(roles, async chunk => (await db.prepare(`SELECT id, from_key, to_key FROM snap_relations WHERE snapshot_id = ? AND type = 'has_role_on' AND from_key IN (${chunk.map(() => '?').join(', ')})`)
    .bind(snapshotId, ...chunk).all<{ id: string; from_key: string; to_key: string }>()).results)
  return rows.filter(r => pairs.has(`${r.from_key}\u0000${r.to_key}`)).map(r => r.id)
}

/** 이 객체가 들어간 계정 연결 id (원래 순서) */
export async function linkIdsOf(db: D1Like, snapshotId: string, key: string): Promise<string[]> {
  const res = await db.prepare(`SELECT id FROM snap_links WHERE snapshot_id = ? AND EXISTS (
      SELECT 1 FROM json_each(detail, '$.set') m WHERE json_extract(m.value, '$.object_key') = ?) ORDER BY ord`).bind(snapshotId, key).all<{ id: string }>()
  return res.results.map(r => r.id)
}

export async function objectExists(db: D1Like, snapshotId: string, key: string, hideDefaults = false): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 AS ok FROM snap_objects o WHERE o.snapshot_id = ? AND o.id = ? AND ${visibleObject('o', hideDefaults)}`).bind(snapshotId, key).first<{ ok: number }>())
}
