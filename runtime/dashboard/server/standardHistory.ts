import type { D1Like } from './exceptions'

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' }
const FIELDS = 'r.id, r.generated_at, r.published_at, r.source_snapshot_id, r.standards_count, r.findings_count'

/** Called only after measured session authentication. No writes, no snapshot or bundle fallback. */
export async function standardHistory(request: Request, db: D1Like): Promise<Response> {
  const url = new URL(request.url)
  try {
    if (url.pathname.replace(/\/$/, '').endsWith('/history')) {
      const [head, rows] = await Promise.all([
        db.prepare("SELECT run_id FROM standard_head WHERE name='current'").first<{ run_id: string }>(),
        db.prepare(`SELECT ${FIELDS} FROM standard_runs r ORDER BY r.published_at DESC, r.id DESC LIMIT 100`).all(),
      ])
      return new Response(JSON.stringify({ current_id: head?.run_id ?? null, items: rows.results }), { headers: HEADERS })
    }
    const id = url.searchParams.get('run')
    if (id !== null && !/^std-[a-f0-9]{64}$/.test(id)) return new Response('{"error":"invalid_run"}', { status: 400, headers: HEADERS })
    const statement = id
      ? db.prepare(`SELECT ${FIELDS}, r.sha256, r.detail FROM standard_runs r WHERE r.id=?`).bind(id)
      : db.prepare(`SELECT ${FIELDS}, r.sha256, r.detail FROM standard_head h JOIN standard_runs r ON r.id=h.run_id WHERE h.name='current'`)
    const row = await statement.first<Record<string, unknown> & { detail: string; sha256: string }>()
    if (!row) return new Response('{"error":"not_published"}', { status: 404, headers: HEADERS })
    const { detail, sha256, ...run } = row
    let results = detail
    if (detail === 'null') {
      const parts = await db.prepare('SELECT seq, body FROM standard_run_parts WHERE run_id=? ORDER BY seq').bind(run.id).all<{ seq: number; body: string }>()
      const list = parts.results
      if (!list || list.length === 0 || !list.every((p, idx) => p.seq === idx)) {
        return new Response('{"error":"assessment_unavailable"}', { status: 503, headers: HEADERS })
      }
      results = list.map(p => p.body).join('')
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(results))
      const hashHex = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
      if (hashHex !== sha256) {
        return new Response('{"error":"assessment_unavailable"}', { status: 503, headers: HEADERS })
      }
    }
    // Avoid parsing the assessment document under the Pages CPU limit.
    return new Response(`{"run":${JSON.stringify(run)},"results":${results}}`, { headers: HEADERS })
  } catch {
    return new Response('{"error":"assessment_unavailable"}', { status: 503, headers: HEADERS })
  }
}
