/**
 * 시험용 D1 스냅샷. node:sqlite 메모리 DB 에 aegi-adapter-engine migrations/graph/0003_snapshot_store.sql 과 같은 표를 만들고
 * 커밋된 데이터셋을 adapter-engine scripts/loader/snapshot.ts 와 같은 열로 넣는다.
 * 판정 결과(피해 범위)는 엔진(scripts/loader/engine.ts)과 같은 함수로 계산해 넣는다. 위협은 넣지 않아 위협 Access Gap 벤 집계는 0 이다.
 * 옛 다리 단위 snap_access_gaps 표는 만들지 않는다(운영 D1 은 엔진 migrations/graph/0009_drop_snap_access_gaps.sql 로 지움).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { D1Like, D1Statement } from './exceptions'
import { buildEvidenceStore, buildGraphStoreV2 } from '../src/data/datasetStore'
import { computeBlastRadius, listCredentials } from '../src/detection/v2/blastRadius'
import type { FixtureObject } from '../src/model/object'
import type { FixtureRelation } from '../src/model/relation'
import type { IdentityLink } from '../src/model/link'
import type { EvidenceObservation, FindingEvidenceLink } from '../src/model/evidence'
import type { EffectiveAccessFile } from '../src/detection/v2/effectiveAccess/types'

const DDL = `
CREATE TABLE graph_snapshots (id TEXT PRIMARY KEY, dataset_sha256 TEXT NOT NULL, dataset_created_at TEXT, dataset_name TEXT, status TEXT NOT NULL,
  counts TEXT NOT NULL, engine_version TEXT, knowledge_version TEXT, note TEXT, created_at TEXT NOT NULL, loaded_at TEXT);
CREATE TABLE graph_head (name TEXT PRIMARY KEY CHECK (name = 'current'), snapshot_id TEXT NOT NULL, previous_snapshot_id TEXT, updated_at TEXT NOT NULL, reason TEXT);
CREATE TABLE snap_objects (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, provider TEXT NOT NULL, display_name TEXT NOT NULL,
  interfaces TEXT NOT NULL, context TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_relations (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, type TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL,
  reverse_type TEXT, confidence TEXT, evidence_refs TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_links (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, from_key TEXT, to_key TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_observations (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_evidence_links (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, from_key TEXT, to_key TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_findings (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, rule_id TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
  status TEXT NOT NULL, target_keys TEXT NOT NULL, path_json TEXT, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_effective_access (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, subject_key TEXT NOT NULL, target_key TEXT NOT NULL, level TEXT,
  paths_json TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_blast_radius (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, provider TEXT NOT NULL, token_level TEXT, account_level TEXT,
  detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_aggregates (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
CREATE TABLE snap_documents (snapshot_id TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, detail TEXT NOT NULL, PRIMARY KEY (snapshot_id, id));
`

export function fakeD1(): { d1: D1Like; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:')
  db.exec(DDL)
  /** Node 22 의 node:sqlite 는 ?1 같은 번호 매개변수에 값을 묶지 못한다(#160). D1 처럼 ?N 을 N 번째 값으로 풀어 ? 로 넘긴다 */
  const stmt = (sql: string, values: unknown[] = []): D1Statement => {
    const numbered: unknown[] = []
    const plain = sql.replace(/\?(\d+)/g, (_, n: string) => { numbered.push(values[Number(n) - 1]); return '?' })
    const params = (plain === sql ? values : numbered) as never[]
    // 쓰지 않는 값이 묶이면 SQLite 처럼 거절한다. 번호를 풀며 남는 값을 버리면 실제 실행에서만 깨진다
    const highest = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map(m => Number(m[1])))
    const checked = () => { if (plain !== sql && values.length > highest) throw new Error(`column index out of range: ${values.length} values for ?${highest}`) }
    return {
      bind: (...next: unknown[]) => stmt(sql, next),
      first: async <T>() => { checked(); return (db.prepare(plain).get(...params) as T) ?? null },
      all: async <T>() => { checked(); return { results: db.prepare(plain).all(...params) as T[] } },
      run: async () => { checked(); return { meta: { changes: Number(db.prepare(plain).run(...params).changes) } } },
    }
  }
  return { d1: { prepare: (sql: string) => stmt(sql), batch: async (s: D1Statement[]) => Promise.all(s.map(x => x.run())) }, db }
}

export interface Dataset {
  objects: FixtureObject[]
  relations: FixtureRelation[]
  links: IdentityLink[]
  observations: EvidenceObservation[]
  evidenceLinks: FindingEvidenceLink[]
  effectiveAccess?: EffectiveAccessFile
  manifest: unknown
}

/** name 은 src/data 아래 폴더 이름이거나, '/' 가 든 저장소 기준 경로(fixtures/ci_dataset_v2) */
export function readDataset(name: string): Dataset {
  const dir = name.includes('/') ? join(import.meta.dirname, '..', name) : join(import.meta.dirname, '..', 'src', 'data', name)
  const read = (file: string) => JSON.parse(readFileSync(join(dir, `${file}.json`), 'utf8'))
  return {
    objects: read('objects'), relations: read('relations'), links: read('links'), observations: read('observations'), evidenceLinks: read('evidence_links'),
    effectiveAccess: existsSync(join(dir, 'effective_access.json')) ? read('effective_access') : undefined, manifest: read('manifest'),
  }
}

export const SNAPSHOT_ID = '20261021T000000Z-test0001'
/** 위협이 없을 때 엔진이 내는 위협 Access Gap 벤 집계(aegi-adapter-engine threatGap.ts gapSummary) */
export const EMPTY_GAP_SUMMARY = { people: 0, peopleConfirmed: 0, peopleUnconfirmed: 0, threats: 0 }

/** 데이터셋을 current 스냅샷으로 넣는다. 반환값은 엔진과 같이 계산한 판정 결과 */
export function loadSnapshot(db: DatabaseSync, ds: Dataset, snapshotId = SNAPSHOT_ID) {
  const graph = buildGraphStoreV2(ds.objects, ds.relations, ds.links)
  const evidence = buildEvidenceStore(ds.observations, ds.evidenceLinks)
  const eaRows = ds.effectiveAccess?.rows.filter(r => r.level !== 'denied')
  const blast = listCredentials(graph).map(obj => ({
    key: obj.fixture_key, provider: obj.canonical.provider,
    token: computeBlastRadius(obj.fixture_key, 'token', { graph, eaRows }),
    account: computeBlastRadius(obj.fixture_key, 'account', { graph, eaRows }),
  }))
  const insert = (table: string, columns: string[], rows: unknown[][]) => {
    const s = db.prepare(`INSERT INTO ${table} (snapshot_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`)
    for (const row of rows) s.run(snapshotId, ...(row as never[]))
  }
  const json = (v: unknown) => v === undefined ? null : JSON.stringify(v)
  insert('snap_objects', ['id', 'ord', 'provider', 'display_name', 'interfaces', 'context', 'detail'], ds.objects.map((o, i) =>
    [o.fixture_key, i, o.canonical.provider, o.fixture_key, (o.canonical.interfaces ?? []).join(','), json((o as unknown as { context?: unknown }).context), JSON.stringify(o)]))
  insert('snap_relations', ['id', 'ord', 'type', 'from_key', 'to_key', 'detail'], ds.relations.map((r, i) =>
    [r.fixture_key, i, r.canonical.relation_type, String(r.canonical.references.source.value), String(r.canonical.references.target.value), JSON.stringify(r)]))
  insert('snap_links', ['id', 'ord', 'from_key', 'to_key', 'detail'], ds.links.map((l, i) => [l.link_id, i, l.set[0]?.object_key ?? null, l.set[1]?.object_key ?? null, JSON.stringify(l)]))
  insert('snap_observations', ['id', 'ord', 'kind', 'detail'], ds.observations.map((o, i) => [o.id, i, null, JSON.stringify(o)]))
  insert('snap_evidence_links', ['id', 'ord', 'detail'], ds.evidenceLinks.map((l, i) => [l.id, i, JSON.stringify(l)]))
  insert('snap_blast_radius', ['id', 'ord', 'provider', 'token_level', 'account_level', 'detail'], blast.map((b, i) =>
    [b.key, i, b.provider, b.token.highest?.level ?? null, b.account.highest?.level ?? null, JSON.stringify(b)]))
  insert('snap_aggregates', ['id', 'ord', 'kind', 'detail'], [['threat_access_gap', 0, 'summary', JSON.stringify(EMPTY_GAP_SUMMARY)]])
  const files = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links']
  insert('snap_documents', ['id', 'ord', 'detail'], [['manifest', 0, JSON.stringify(ds.manifest)], ['_files', 1, JSON.stringify(files)]])
  db.prepare("INSERT INTO graph_snapshots (id, dataset_sha256, dataset_name, status, counts, created_at, loaded_at) VALUES (?, 'sha', 'test', 'ready', ?, '2026-10-21T00:00:00Z', '2026-10-21T00:01:00Z')")
    .run(snapshotId, JSON.stringify({ objects: ds.objects.length, relations: ds.relations.length }))
  db.prepare("INSERT INTO graph_head (name, snapshot_id, updated_at) VALUES ('current', ?, '2026-10-21T00:01:00Z')").run(snapshotId)
  return { graph, evidence, blast }
}
