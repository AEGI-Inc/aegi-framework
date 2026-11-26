import { parseDocument } from 'yaml'
import { sha256Hex, urlRef } from './sanitize'

/** Metadata only: never retain YAML source, shell bodies, literal env values or variable values. */
export function summarizeWorkflowContent(body: any): any {
  if (body?.encoding !== 'base64' || typeof body.content !== 'string') {
    return { sha: body?.sha, workflow_definition: { status: 'content_unavailable' } }
  }
  const source = Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8')
  const result: any = { status: 'parsed', source_sha256: sha256Hex(source), secret_refs: [], variable_refs: [], actions: [], environments: [], url_refs: [] }
  try {
    const doc = parseDocument(source, { uniqueKeys: true })
    if (doc.errors.length) throw new Error('invalid_yaml')
    const value = doc.toJS({ maxAliasCount: 100 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_workflow')
    const secrets = new Set<string>(), variables = new Set<string>(), urls = new Map<string, unknown>()
    const walk = (v: unknown) => {
      if (typeof v === 'string') {
        for (const m of v.matchAll(/\b(secrets|vars)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g)) {
          ;(m[1] === 'secrets' ? secrets : variables).add(m[2] ?? m[3])
        }
        for (const m of v.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
          if (/\$\{|\{\{|%7B/i.test(m[0])) continue
          const ref = urlRef(m[0]); urls.set(ref.sha256, ref)
        }
      } else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(value)
    const actions = new Set<string>(), environments = new Set<string>()
    for (const job of Object.values(value.jobs ?? {}) as any[]) {
      if (!job || typeof job !== 'object') continue
      for (const uses of [job.uses, ...(Array.isArray(job.steps) ? job.steps.map((s: any) => s?.uses) : [])]) {
        if (typeof uses === 'string' && /^(?:\.\/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[A-Za-z0-9_./-]+|docker:\/\/[A-Za-z0-9_./:@-]+)$/.test(uses)) actions.add(uses)
      }
      const env = typeof job.environment === 'string' ? job.environment : job.environment?.name
      if (typeof env === 'string' && /^[A-Za-z0-9_. /-]{1,100}$/.test(env)) environments.add(env)
    }
    result.secret_refs = [...secrets].sort(); result.variable_refs = [...variables].sort()
    result.actions = [...actions].sort(); result.environments = [...environments].sort(); result.url_refs = [...urls.values()]
    result.trigger_events = typeof value.on === 'string' ? [value.on] : Array.isArray(value.on) ? value.on.filter((x: unknown) => typeof x === 'string') : Object.keys(value.on ?? {})
    result.job_count = Object.keys(value.jobs ?? {}).length
    // These are references in a definition, not proof of a request or a credential binding.
    result.reference_basis = 'definition_reference_only'
  } catch {
    result.status = 'parse_failed'
  }
  return { sha: body.sha, workflow_definition: result }
}

export function summarizeVariables(body: any): any {
  return { ...body, variables: (body?.variables ?? []).map((v: any) => {
    const { value, ...metadata } = v
    const text = String(value ?? '')
    const urls = [...text.matchAll(/https?:\/\/[^\s"'<>\\]+/g)].filter(m => !/\$\{|\{\{|%7B/i.test(m[0])).map(m => urlRef(m[0]))
    return { ...metadata, value_fingerprint: { sha256: sha256Hex(text), len: text.length }, url_refs: urls }
  }) }
}
