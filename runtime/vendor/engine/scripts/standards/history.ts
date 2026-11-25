import crypto from 'node:crypto'
import type { SqlExecutor } from '../loader/sql.ts'
import { titleProblems } from '../../src/detection/titleCheck.ts'

/** 판정 문장이 위협 제목 규칙(aegi-knowledge policies.yaml title_check)을 어겼다. finding id 만 담고 문장과 테넌트 값은 담지 않는다 */
export class TitleRuleError extends Error {
  constructor(readonly ids: string[]) { super(`판정 문장 ${ids.length}개가 위협 제목 규칙(명사형 끝, 금지 글자)에 맞지 않아 게시하지 않습니다: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ' 외' : ''}`) }
}

/** 위반이 하나라도 있으면 Threat 목록 제목이 되므로 모든 판정 문장을 본다 */
export function titleRuleViolations(findings: Array<{ id: string; text: string }>): string[] {
  return findings.filter(f => titleProblems(f.text).length > 0).map(f => f.id)
}

/** Documents up to the old one-row limit stay in standard_runs.detail so readers without part support still work */
export const SINGLE_ROW_BYTES = 1_000_000
export const PART_CHARS = 250_000
export const MAX_DOCUMENT_BYTES = 64_000_000

type Row = Record<string, unknown>
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const statuses = new Set(['pass', 'fail', 'unknown', 'not_collected', 'org_policy', 'manual'])

/** Validate every field consumed by the UI before persisting or changing the head. */
export function assessmentDocument(value: unknown): { detail: string; sha256: string; generatedAt: string; standards: number; findings: number } {
  const bad = () => { throw new Error('기준별 판정 파일 형식이 맞지 않습니다 (비밀값과 원본 내용은 출력하지 않음)') }
  if (!record(value) || !text(value.generated_at) || !Number.isFinite(Date.parse(value.generated_at)) || !text(value.note) || !Array.isArray(value.standards) || !Array.isArray(value.findings)) return bad()
  if ('failed_detectors' in value && (!Array.isArray(value.failed_detectors) || new Set(value.failed_detectors).size !== value.failed_detectors.length || !value.failed_detectors.every(d => text(d) && d))) return bad()
  const ids = new Set<string>()
  for (const s of value.standards) {
    if (!record(s) || !text(s.id) || !s.id || ids.has(s.id) || !text(s.name) || !text(s.provider) || !Number.isInteger(s.tier) || !text(s.raw_run)) return bad()
    ids.add(s.id)
  }
  const findings = new Set<string>()
  for (const f of value.findings) {
    if (!record(f) || !text(f.id) || !f.id || findings.has(f.id) || !['provider', 'text', 'layer', 'group', 'kind'].every(k => text(f[k])) || !Array.isArray(f.items)) return bad()
    findings.add(f.id)
    for (const i of f.items) {
      if (!record(i) || !text(i.standard) || !ids.has(i.standard) || !text(i.status) || !statuses.has(i.status) || !['item_id', 'title', 'threshold', 'note'].every(k => text(i[k])) || !record(i.rule) || !['source', 'field', 'condition', 'combine'].every(k => text((i.rule as Row)[k])) || !Array.isArray(i.targets)) return bad()
      for (const t of i.targets) if (!record(t) || !text(t.key) || !t.key || !text(t.name) || !text(t.status) || typeof t.in_graph !== 'boolean') return bad()
    }
  }
  const badTitles = titleRuleViolations(value.findings as Array<{ id: string; text: string }>)
  if (badTitles.length) throw new TitleRuleError(badTitles)
  const detail = JSON.stringify(value)
  if (Buffer.byteLength(detail) > MAX_DOCUMENT_BYTES) throw new Error('판정 문서가 저장 한도 64MB를 넘습니다')
  return { detail, sha256: crypto.createHash('sha256').update(detail).digest('hex'), generatedAt: value.generated_at, standards: value.standards.length, findings: value.findings.length }
}

export function splitDocument(detail: string): string[] {
  if (!detail) return []
  const parts: string[] = []
  let start = 0
  while (start < detail.length) {
    let cut = Math.min(start + PART_CHARS, detail.length)
    if (cut < detail.length) {
      const code = detail.charCodeAt(cut - 1)
      if (code >= 0xd800 && code <= 0xdbff) {
        cut--
      }
    }
    parts.push(detail.slice(start, cut))
    start = cut
  }
  return parts
}

/** Immutable, content-addressed runs; only the assessment head moves. No graph writes or pruning. */
export async function publishAssessment(exec: SqlExecutor, value: unknown, sourceSnapshotId: string | null, now = new Date().toISOString()) {
  const doc = assessmentDocument(value)
  const id = `std-${doc.sha256}`
  const head = (await exec.query<{ run_id: string }>("SELECT run_id FROM standard_head WHERE name = 'current'"))[0]
  if (Buffer.byteLength(doc.detail) <= SINGLE_ROW_BYTES) {
    await exec.query('INSERT INTO standard_runs (id, sha256, generated_at, published_at, source_snapshot_id, standards_count, findings_count, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', [id, doc.sha256, doc.generatedAt, now, sourceSnapshotId, doc.standards, doc.findings, doc.detail])
  } else {
    const parts = splitDocument(doc.detail)
    for (let seq = 0; seq < parts.length; seq++) {
      await exec.query('INSERT INTO standard_run_parts (run_id, seq, body) VALUES (?, ?, ?) ON CONFLICT(run_id, seq) DO NOTHING', [id, seq, parts[seq]])
    }
    await exec.query('INSERT INTO standard_runs (id, sha256, generated_at, published_at, source_snapshot_id, standards_count, findings_count, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', [id, doc.sha256, doc.generatedAt, now, sourceSnapshotId, doc.standards, doc.findings, 'null'])
  }
  const stored = (await exec.query<{ detail: string; source_snapshot_id: string | null }>('SELECT detail, source_snapshot_id FROM standard_runs WHERE id = ?', [id]))[0]
  if (!stored || stored.source_snapshot_id !== sourceSnapshotId) throw new Error('기존 이력과 원본 또는 출처가 다릅니다. 현재 결과를 바꾸지 않았습니다')
  if (stored.detail === 'null') {
    const parts = await exec.query<{ seq: number; body: string }>('SELECT seq, body FROM standard_run_parts WHERE run_id = ? ORDER BY seq', [id])
    const valid = parts.length > 0 && parts.every((p, idx) => p.seq === idx) && parts.map(p => p.body).join('') === doc.detail
    if (!valid) throw new Error('기존 이력과 원본 또는 출처가 다릅니다. 현재 결과를 바꾸지 않았습니다')
  } else {
    if (stored.detail !== doc.detail) throw new Error('기존 이력과 원본 또는 출처가 다릅니다. 현재 결과를 바꾸지 않았습니다')
  }
  if (head?.run_id !== id) {
    const updated = await exec.query<{ run_id: string }>(`INSERT INTO standard_head (name, run_id, previous_run_id, updated_at) SELECT 'current', ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM standard_head WHERE name='current' AND run_id=?) ON CONFLICT(name) DO UPDATE SET run_id=excluded.run_id, previous_run_id=excluded.previous_run_id, updated_at=excluded.updated_at WHERE standard_head.run_id IS ? RETURNING run_id`, [id, head?.run_id ?? null, now, head?.run_id ?? null, head?.run_id ?? null, head?.run_id ?? null])
    if (updated[0]?.run_id !== id) throw new Error('동시에 현재 판정이 변경됐습니다. 이력은 보관했고 포인터는 바꾸지 않았습니다')
  }
  return { id, sha256: doc.sha256, standards: doc.standards, findings: doc.findings, sourceSnapshotId }
}
