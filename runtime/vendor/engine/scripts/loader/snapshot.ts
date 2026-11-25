/**
 * 스냅샷 적재, 검증, 현재 포인터, 되돌리기, 정리 (docs/spec/AEGI_D1_SNAPSHOT_STORE_V1.md).
 * 실행기(SqlExecutor)만 받으므로 D1 과 node:sqlite 테스트가 같은 코드를 탄다.
 */
import crypto from 'node:crypto'
import { splitDocument } from '../standards/history.ts'
import { DOCUMENT_FILES, OPTIONAL_FILES, REQUIRED_FILES, type ComputedSnapshot } from './engine.ts'
import { insertStatements, type SqlExecutor, type Statement } from './sql.ts'

export const SNAPSHOT_TABLES = [
  'snap_objects', 'snap_relations', 'snap_links', 'snap_observations', 'snap_evidence_links', 'snap_findings',
  'snap_expected_findings', 'snap_effective_access', 'snap_blast_radius', 'snap_aggregates', 'snap_documents',
] as const
export type SnapshotTable = typeof SNAPSHOT_TABLES[number]

/** 환경마다 남기는 ready 스냅샷 수 (current 포함) */
export const KEEP_READY = 3

export interface TableRows {
  columns: string[]
  rows: unknown[][]
}

export interface SnapshotRow {
  id: string
  dataset_sha256: string
  dataset_created_at: string | null
  dataset_name: string | null
  status: 'loading' | 'verifying' | 'ready' | 'failed'
  counts: string
  engine_version: string | null
  knowledge_version: string | null
  note: string | null
  created_at: string
  loaded_at: string | null
}

export interface HeadRow {
  snapshot_id: string
  previous_snapshot_id: string | null
  updated_at: string
  reason: string | null
}

/** 20261021T065627Z-c9199bd0-1a2b3c. 마지막 칸은 판정 코드 지문이라 데이터셋이 같아도 판정 코드가 바뀌면 ID 가 달라진다 */
export function snapshotIdOf(createdAt: string | null | undefined, sha256: string, engineSha?: string, inputsSha?: string): string {
  const stamp = createdAt && !Number.isNaN(Date.parse(createdAt))
    ? new Date(createdAt).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
    : 'undated'
  return `${stamp}-${sha256.slice(0, 8)}${engineSha ? `-${engineSha.slice(0, 6)}` : ''}${inputsSha ? `-${inputsSha.slice(0, 6)}` : ''}`
}

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
const str = (v: unknown) => (v === undefined || v === null ? null : String(v))
/** 증거 연결 끝점 { kind, id } 의 id. kind 는 detail 에 남는다 */
const endpointKey = (v: unknown) => str(v !== null && typeof v === 'object' ? (v as { id?: unknown }).id : v)

/** 스냅샷 한 개의 표별 행. snapshot_id 열은 적재할 때 앞에 붙인다 */
export function snapshotRows(c: ComputedSnapshot): Record<SnapshotTable, TableRows> {
  const f = c.files
  const relKey = (r: any) => r.fixture_key ?? r.id
  return {
    snap_objects: {
      columns: ['id', 'ord', 'provider', 'display_name', 'interfaces', 'context', 'detail'],
      rows: f.objects.map((o: any, i) => [o.fixture_key ?? o.id, i, o.canonical?.provider ?? o.provider ?? 'unknown', o.canonical?.displayName ?? o.display_name ?? o.fixture_key ?? o.id,
        Array.isArray(o.canonical?.interfaces) ? o.canonical.interfaces.join(',') : '', json(o.context), JSON.stringify(o)]),
    },
    snap_relations: {
      columns: ['id', 'ord', 'type', 'from_key', 'to_key', 'reverse_type', 'confidence', 'evidence_refs', 'detail'],
      rows: f.relations.map((r: any, i) => [relKey(r), i, r.canonical?.relation_type ?? r.type ?? 'related_to',
        String(r.canonical?.references?.source?.value ?? r.from_key ?? r.from ?? ''), String(r.canonical?.references?.target?.value ?? r.to_key ?? r.to ?? ''),
        str(r.reverse_type), r.confidence ? String(r.confidence) : str(r.canonical?.properties?.basis), json(r.evidence_refs ?? r.canonical?.source), JSON.stringify(r)]),
    },
    snap_links: {
      columns: ['id', 'ord', 'from_key', 'to_key', 'detail'],
      rows: f.links.map((l: any, i) => [String(l.link_id ?? l.id), i, str(l.set?.[0]?.object_key), str(l.set?.[1]?.object_key), JSON.stringify(l)]),
    },
    snap_observations: {
      columns: ['id', 'ord', 'kind', 'detail'],
      rows: f.observations.map((o: any, i) => [String(o.id), i, str(o.kind), JSON.stringify(o)]),
    },
    snap_evidence_links: {
      columns: ['id', 'ord', 'from_key', 'to_key', 'detail'],
      rows: f.evidence_links.map((l: any, i) => [String(l.id), i, endpointKey(l.from), endpointKey(l.to), JSON.stringify(l)]),
    },
    snap_findings: {
      // 위협 판정 V2 위협만 싣는다(rule_id threat-v2). 옛 판정 행은 싣지 않는다
      columns: ['id', 'ord', 'rule_id', 'category', 'severity', 'status', 'target_keys', 'path_json', 'detail', 'primary_type', 'types', 'occurrence', 'certainty'],
      rows: c.threatsV2.map((t, i) => [t.id, i, 'threat-v2', t.primaryType, t.severity, 'open', JSON.stringify([t.target, t.point]),
        null, JSON.stringify(t), t.primaryType, JSON.stringify(t.types), t.occurrence, t.certainty]),
    },
    snap_expected_findings: {
      // 옛 정답지 표. 표와 마이그레이션은 두고 행은 싣지 않는다
      columns: ['id', 'ord', 'rule_id', 'severity', 'detail'],
      rows: [],
    },
    snap_effective_access: {
      columns: ['id', 'ord', 'subject_key', 'target_key', 'level', 'paths_json', 'detail'],
      rows: (f.effective_access?.rows ?? []).map((r, i) => [r.id, i, r.references.source, r.references.target, str(r.level), JSON.stringify(r.via ?? []), JSON.stringify(r)]),
    },
    snap_blast_radius: {
      columns: ['id', 'ord', 'provider', 'token_level', 'account_level', 'detail'],
      rows: c.blast.map((b, i) => [b.key, i, b.provider, str(b.token.highest?.level), str(b.account.highest?.level), JSON.stringify(b)]),
    },
    snap_aggregates: {
      columns: ['id', 'ord', 'kind', 'detail'],
      rows: c.aggregates.map((a, i) => [a.id, i, a.kind, JSON.stringify(a.detail)]),
    },
    snap_documents: {
      columns: ['id', 'ord', 'detail'],
      rows: (() => {
        const baseRows: Array<[string, number, string]> = []
        let nextOrd = DOCUMENT_FILES.length + 3

        const items: Array<{ id: string; ord: number; detail: string }> = []
        DOCUMENT_FILES.filter(name => f[name] !== undefined).forEach((name, i) => {
          let val = f[name]
          if (name === 'effective_access' && val && typeof val === 'object' && Array.isArray((val as any).rows)) {
            val = { ...val, rows: { $rows_table: 'snap_effective_access' } }
          }
          items.push({ id: name, ord: i, detail: JSON.stringify(val) })
        })
        items.push({ id: '_files', ord: DOCUMENT_FILES.length, detail: JSON.stringify(Object.keys(f)) })
        if (c.displayText) {
          items.push({ id: 'display_text', ord: DOCUMENT_FILES.length + 1, detail: JSON.stringify(c.displayText) })
        }
        // 대상마다 접근 표(계산 문서, 데이터셋 파일이 아니라 _files 에 없다). 대시보드는 derived.access_table 로 받는다
        if (c.accessTable) {
          items.push({ id: 'access_table', ord: DOCUMENT_FILES.length + 2, detail: JSON.stringify(c.accessTable) })
        }

        const chunkRows: Array<[string, number, string]> = []
        for (const item of items) {
          if (Buffer.byteLength(item.detail) > 1_000_000) {
            const parts = splitDocument(item.detail)
            const sha256 = crypto.createHash('sha256').update(item.detail).digest('hex')
            baseRows.push([item.id, item.ord, JSON.stringify({ $parts: parts.length, sha256 })])
            for (let seq = 0; seq < parts.length; seq++) {
              chunkRows.push([`${item.id}#${seq}`, nextOrd++, parts[seq]])
            }
          } else {
            baseRows.push([item.id, item.ord, item.detail])
          }
        }
        return [...baseRows, ...chunkRows]
      })(),
    },
  }
}

export function countsOf(rows: Record<SnapshotTable, TableRows>): Record<SnapshotTable, number> {
  return Object.fromEntries(SNAPSHOT_TABLES.map(t => [t, rows[t].rows.length])) as Record<SnapshotTable, number>
}

export async function getHead(exec: SqlExecutor): Promise<HeadRow | null> {
  return (await exec.query<HeadRow>(`SELECT snapshot_id, previous_snapshot_id, updated_at, reason FROM graph_head WHERE name = 'current'`))[0] ?? null
}

export async function getSnapshot(exec: SqlExecutor, id: string): Promise<SnapshotRow | null> {
  return (await exec.query<SnapshotRow>('SELECT * FROM graph_snapshots WHERE id = ?', [id]))[0] ?? null
}

export async function listSnapshots(exec: SqlExecutor): Promise<SnapshotRow[]> {
  return exec.query<SnapshotRow>('SELECT * FROM graph_snapshots ORDER BY created_at DESC')
}

async function deleteSnapshotRows(exec: SqlExecutor, id: string): Promise<void> {
  const statements: Statement[] = SNAPSHOT_TABLES.map(t => ({ sql: `DELETE FROM ${t} WHERE snapshot_id = ?`, params: [id] }))
  const existing = await exec.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('compliance_scope', 'compliance_scope_runs')"
  )
  for (const row of existing) {
    statements.push({ sql: `DELETE FROM ${row.name} WHERE snapshot_id = ?`, params: [id] })
  }
  await exec.batch(statements)
}

export interface LoadOptions {
  datasetName?: string | null
  engineVersion?: string | null
  knowledgeVersion?: string | null
  note?: string | null
  now?: () => string
  log?: (line: string) => void
}

/**
 * 스냅샷을 적재하고 검증한다. 포인터는 바꾸지 않는다.
 * 같은 데이터셋의 ready 스냅샷이 이미 있으면 다시 넣지 않는다. loading, failed 로 남은 것은 지우고 다시 넣는다.
 */
export async function loadSnapshot(exec: SqlExecutor, c: ComputedSnapshot, opts: LoadOptions = {}): Promise<{ id: string; reused: boolean; statements: number }> {
  const now = opts.now ?? (() => new Date().toISOString())
  const log = opts.log ?? (() => {})
  const id = snapshotIdOf(c.files.manifest?.created_at, c.datasetSha256, c.engineSha256, c.inputsSha256)
  const rows = snapshotRows(c)
  const counts = countsOf(rows)
  // 문장은 loading 행을 넣기 전에 만든다. 행 한도로 던지면 loading 행이 남지 않는다
  const statements: Statement[] = []
  for (const table of SNAPSHOT_TABLES) {
    const { columns, rows: values } = rows[table]
    statements.push(...insertStatements(table, ['snapshot_id', ...columns], values.map(v => [id, ...v])))
  }

  const existing = await getSnapshot(exec, id)
  if (existing?.status === 'ready') {
    if (existing.dataset_sha256 !== c.datasetSha256) throw new Error(`스냅샷 ${id} 의 데이터셋 지문이 다르다`)
    log(`이미 적재된 스냅샷: ${id}`)
    return { id, reused: true, statements: 0 }
  }
  if (existing) {
    log(`남은 ${existing.status} 스냅샷을 지우고 다시 넣는다: ${id}`)
    await deleteSnapshotRows(exec, id)
    await exec.query('DELETE FROM graph_snapshots WHERE id = ?', [id])
  }

  await exec.query(
    `INSERT INTO graph_snapshots (id, dataset_sha256, dataset_created_at, dataset_name, status, counts, engine_version, knowledge_version, note, created_at)
     VALUES (?, ?, ?, ?, 'loading', ?, ?, ?, ?, ?)`,
    [id, c.datasetSha256, c.files.manifest?.created_at ?? null, opts.datasetName ?? null, JSON.stringify(counts), opts.engineVersion ?? null, opts.knowledgeVersion ?? null, opts.note ?? null, now()],
  )

  try {
    await exec.batch(statements)
    log(`적재: ${statements.length}문장 (${Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${t.replace('snap_', '')} ${n}`).join(', ')})`)
    await exec.query(`UPDATE graph_snapshots SET status = 'verifying' WHERE id = ?`, [id])
    const problems = await verifySnapshotRows(exec, id, rows)
    if (problems.length) throw new Error(`스냅샷 검증 실패: ${problems.slice(0, 5).join('; ')}`)
    await exec.query(`UPDATE graph_snapshots SET status = 'ready', loaded_at = ? WHERE id = ?`, [now(), id])
  } catch (err) {
    await exec.query(`UPDATE graph_snapshots SET status = 'failed', note = ? WHERE id = ?`, [String((err as Error).message).slice(0, 500), id]).catch(() => {})
    throw err
  }
  return { id, reused: false, statements: statements.length }
}

/** 표마다 건수와 id 집합이 계산한 행과 같은지 본다. 문제 목록을 돌려준다 */
export async function verifySnapshotRows(exec: SqlExecutor, id: string, rows: Record<SnapshotTable, TableRows>): Promise<string[]> {
  const problems: string[] = []
  for (const table of SNAPSHOT_TABLES) {
    const expected = rows[table].rows.map(r => String(r[0]))
    const actual = (await exec.query<{ id: string }>(`SELECT id FROM ${table} WHERE snapshot_id = ? ORDER BY ord`, [id])).map(r => r.id)
    if (actual.length !== expected.length) {
      problems.push(`${table} 건수 ${actual.length} (기대 ${expected.length})`)
      continue
    }
    const mismatch = expected.findIndex((key, i) => key !== actual[i])
    if (mismatch >= 0) problems.push(`${table} ${mismatch}번째 id ${actual[mismatch]} (기대 ${expected[mismatch]})`)
  }
  return problems
}

/** 현재 포인터를 ready 스냅샷으로 옮긴다. 이전 current 는 previous 로 남는다 */
export async function setHead(exec: SqlExecutor, id: string, reason: string, now = new Date().toISOString(), expectedCurrent?: string | null): Promise<HeadRow> {
  const snap = await getSnapshot(exec, id)
  if (!snap) throw new Error(`스냅샷이 없다: ${id}`)
  if (snap.status !== 'ready') throw new Error(`ready 가 아닌 스냅샷(${snap.status})으로는 옮기지 않는다: ${id}`)
  const head = await getHead(exec)
  const expected = expectedCurrent === undefined ? head?.snapshot_id ?? null : expectedCurrent
  if ((head?.snapshot_id ?? null) !== expected) throw new Error('current 가 다른 게시로 바뀌었다. 처음부터 다시 검증한다')
  if (head?.snapshot_id === id) return head
  const changed = await exec.query<HeadRow>(
    `INSERT INTO graph_head (name, snapshot_id, previous_snapshot_id, updated_at, reason)
     SELECT 'current', ?, ?, ?, ? WHERE (SELECT snapshot_id FROM graph_head WHERE name = 'current') IS ?
     ON CONFLICT(name) DO UPDATE SET previous_snapshot_id = graph_head.snapshot_id, snapshot_id = excluded.snapshot_id, updated_at = excluded.updated_at, reason = excluded.reason
     WHERE graph_head.snapshot_id IS ? RETURNING snapshot_id, previous_snapshot_id, updated_at, reason`,
    [id, expected, now, reason, expected, expected],
  )
  if (!changed.length) throw new Error('current 가 다른 게시로 바뀌었다. 처음부터 다시 검증한다')
  return changed[0]
}

/** 직전(또는 지정한) ready 스냅샷으로 포인터를 되돌린다 */
export async function rollbackHead(exec: SqlExecutor, to?: string, now = new Date().toISOString()): Promise<HeadRow> {
  const head = await getHead(exec)
  if (!head) throw new Error('현재 스냅샷이 없다')
  const target = to ?? head.previous_snapshot_id
  if (!target) throw new Error('되돌릴 이전 스냅샷이 없다. --to <스냅샷 id> 로 고른다')
  return setHead(exec, target, `rollback from ${head.snapshot_id}`, now)
}

/**
 * 고정 스냅샷 표시. graph_snapshots.note 가 이 글자로 시작하면 정리하지 않는다.
 * 같은 D1 을 쓰는 배포 하나가 current 대신 그 스냅샷을 읽을 때 쓴다(공개 데모: 대시보드 환경 변수 AEGI_GRAPH_SNAPSHOT_ID).
 * 스키마를 바꾸지 않으려고 기존 note 열을 쓴다
 */
export const PIN_NOTE_PREFIX = 'pinned:'

export const isPinned = (s: Pick<SnapshotRow, 'note'>) => !!s.note?.startsWith(PIN_NOTE_PREFIX)

/** ready 스냅샷에 고정 표시를 단다(reason 은 누가 읽는지). 고정을 풀면 note 를 비운다 */
export async function pinSnapshot(exec: SqlExecutor, id: string, reason: string | null): Promise<SnapshotRow> {
  const snap = await getSnapshot(exec, id)
  if (!snap) throw new Error(`스냅샷 ${id} 이 없다`)
  if (reason !== null && snap.status !== 'ready') throw new Error(`스냅샷 ${id} 은 ${snap.status} 다. ready 만 고정한다`)
  if (reason !== null && !reason.trim()) throw new Error('고정 이유(--reason, 읽는 곳)를 적는다')
  await exec.query('UPDATE graph_snapshots SET note = ? WHERE id = ?', [reason === null ? null : `${PIN_NOTE_PREFIX} ${reason.trim()}`, id])
  return (await getSnapshot(exec, id))!
}

/** 보존 개수를 넘는 ready 스냅샷과 실패, 미완료 스냅샷을 지운다. current, previous 와 고정 스냅샷(isPinned)은 지우지 않고 보존 개수에도 세지 않는다 */
export async function pruneSnapshots(exec: SqlExecutor, keep = KEEP_READY): Promise<string[]> {
  const head = await getHead(exec)
  const protectedIds = new Set([head?.snapshot_id, head?.previous_snapshot_id].filter(Boolean) as string[])
  const all = await listSnapshots(exec)
  const ready = all.filter(s => s.status === 'ready')
  const pinned = ready.filter(s => isPinned(s) && !protectedIds.has(s.id)).map(s => s.id)
  const rest = ready.filter(s => !protectedIds.has(s.id) && !isPinned(s))
  const keepIds = new Set([...protectedIds, ...pinned, ...rest.slice(0, Math.max(0, keep - protectedIds.size)).map(s => s.id)])
  const drop = all.filter(s => !keepIds.has(s.id) && s.status !== 'loading' && s.status !== 'verifying').map(s => s.id)
  for (const id of drop) {
    await deleteSnapshotRows(exec, id)
    await exec.query('DELETE FROM graph_snapshots WHERE id = ?', [id])
  }
  return drop
}

/**
 * D1 스냅샷만으로 대시보드 번들(aegi-measured-bundle/v1, D1 읽기 경로)을 다시 만든다.
 * 파일에서 만든 번들과 같아야 한다 (D1 이 화면에 필요한 자료를 다 가졌다는 증거).
 */
export async function bundleFromSnapshot(exec: SqlExecutor, id: string, publishedAt = new Date().toISOString()): Promise<Record<string, unknown>> {
  const read = async (table: SnapshotTable) =>
    (await exec.query<{ detail: string }>(`SELECT detail FROM ${table} WHERE snapshot_id = ? ORDER BY ord`, [id])).map(r => JSON.parse(r.detail))
  const rawRows = await exec.query<{ id: string; detail: string }>('SELECT id, detail FROM snap_documents WHERE snapshot_id = ? ORDER BY ord', [id])
  const rawMap = new Map(rawRows.map(r => [r.id, r.detail]))

  const unpackDoc = (name: string): string | undefined => {
    const raw = rawMap.get(name)
    if (raw === undefined) return undefined
    if (!raw.startsWith('{"$parts":')) return raw
    const marker = JSON.parse(raw) as { $parts: number; sha256: string }
    let full = ''
    for (let seq = 0; seq < marker.$parts; seq++) {
      const part = rawMap.get(`${name}#${seq}`)
      if (part === undefined) {
        throw new Error(`스냅샷 문서 ${name} 의 조각 #${seq} 이 누락되었습니다`)
      }
      full += part
    }
    const hash = crypto.createHash('sha256').update(full).digest('hex')
    if (hash !== marker.sha256) {
      throw new Error(`스냅샷 문서 ${name} 의 지문이 맞지 않습니다 (기대 ${marker.sha256}, 실제 ${hash})`)
    }
    return full
  }

  const filesText = unpackDoc('_files')
  const present = new Set<string>(filesText ? JSON.parse(filesText) : [])
  const tables: Record<string, SnapshotTable> = {
    objects: 'snap_objects', relations: 'snap_relations', links: 'snap_links', observations: 'snap_observations',
    evidence_links: 'snap_evidence_links',
  }
  // 키 순서는 파일 번들(bundleFromFiles)과 같다: 필수 파일, 그다음 선택 파일
  const bundle: Record<string, unknown> = { format: 'aegi-measured-bundle/v1', variant: 'v2', published_at: publishedAt }
  for (const name of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (!present.has(name)) continue
    if (tables[name]) {
      bundle[name] = await read(tables[name])
    } else {
      const text = unpackDoc(name)
      let val = text !== undefined ? JSON.parse(text) : undefined
      if (name === 'effective_access' && val && typeof val === 'object' && !Array.isArray(val)) {
        if (val.rows && typeof val.rows === 'object' && !Array.isArray(val.rows) && (val.rows as any).$rows_table === 'snap_effective_access') {
          const eaRows = (await exec.query<{ detail: string }>('SELECT detail FROM snap_effective_access WHERE snapshot_id = ? ORDER BY ord', [id])).map(r => JSON.parse(r.detail))
          val = { ...val, rows: eaRows }
        }
      }
      bundle[name] = val
    }
  }
  return bundle
}
