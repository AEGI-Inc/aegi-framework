/**
 * 스펙 → 표면 추출 (순수 함수).
 * OpenAPI 3.0/3.1, Swagger 2.0, Google API Discovery, GraphQL SDL 에서
 * 우리가 호출하는 operation 의 인자·응답 필드·deprecated 만 뽑아낸다.
 */

export interface OpSurface {
  op: string
  method: string
  path: string
  deprecated: boolean
  params: Record<string, { in: string; required: boolean }>
  response: Record<string, { type: string; deprecated?: boolean }>
  errors?: string[]
  notes?: string[]
}

export interface SourceSurface {
  source: string
  format: string
  version?: string
  revision?: string
  ops: Record<string, OpSurface>
}

export interface ApiListOp {
  operation_id: string
  method: string
  path_template: string
}

const MAX_SCHEMA_DEPTH = 4
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

function opNameFromId(operationId: string): string {
  const parts = operationId.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : operationId
}

function sourceFromOps(ops: ApiListOp[]): string {
  for (const o of ops) {
    const parts = o.operation_id.split(':')
    if (parts.length >= 2 && parts[1]) return parts[1]
  }
  return ''
}

function normalizePathTemplate(p: string): string {
  const cleaned = p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '')
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`
}

function resolveJsonPointer(root: any, ref: string): any {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref
    .slice(2)
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let cur = root
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function schemaType(schema: any): string {
  if (!schema || typeof schema !== 'object') return 'unknown'
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t: unknown) => t !== 'null' && typeof t === 'string')
    return nonNull.length > 0 ? nonNull.join('|') : 'unknown'
  }
  if (schema.items) return 'array'
  if (schema.properties || schema.additionalProperties) return 'object'
  return 'unknown'
}

function walkSchema(
  schema: any,
  prefix: string,
  depth: number,
  resolveRef: (ref: string) => any,
  seenRefs: Set<string>,
  out: Record<string, { type: string; deprecated?: boolean }>,
): void {
  if (!schema || typeof schema !== 'object') return

  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) return
    const target = resolveRef(schema.$ref)
    if (!target || typeof target !== 'object') return
    const nextSeen = new Set(seenRefs)
    nextSeen.add(schema.$ref)
    walkSchema(target, prefix, depth, resolveRef, nextSeen, out)
    return
  }

  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key]) {
        walkSchema(sub, prefix, depth, resolveRef, seenRefs, out)
      }
    }
  }

  const t = schemaType(schema)
  if (prefix) {
    const entry: { type: string; deprecated?: boolean } = { type: t }
    if (schema.deprecated === true) entry.deprecated = true
    const prev = out[prefix]
    if (!prev || prev.type === 'unknown') {
      out[prefix] = entry
    } else if (entry.deprecated) {
      prev.deprecated = true
    }
  }

  if (depth >= MAX_SCHEMA_DEPTH) return

  if (t === 'array' || schema.items) {
    const elemPrefix = prefix ? `${prefix}[]` : '[]'
    if (schema.items && typeof schema.items === 'object') {
      walkSchema(schema.items, elemPrefix, depth + 1, resolveRef, seenRefs, out)
    }
    return
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [k, prop] of Object.entries(schema.properties)) {
      const childPath = prefix ? `${prefix}.${k}` : k
      walkSchema(prop, childPath, depth + 1, resolveRef, seenRefs, out)
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    const childPath = prefix ? `${prefix}.<key>` : '<key>'
    walkSchema(schema.additionalProperties, childPath, depth + 1, resolveRef, seenRefs, out)
  }
}

function extractOpenApiServerBases(spec: any): string[] {
  const bases = new Set<string>([''])
  if (typeof spec?.basePath === 'string' && spec.basePath !== '/') {
    bases.add(spec.basePath.replace(/\/+$/, ''))
  }
  if (Array.isArray(spec?.servers)) {
    for (const srv of spec.servers) {
      if (typeof srv?.url !== 'string') continue
      try {
        const u = new URL(srv.url, 'https://example.invalid')
        const p = u.pathname.replace(/\/+$/, '')
        if (p && p !== '/') bases.add(p)
      } catch {
        // ignore unparseable server url templates
      }
    }
  }
  return [...bases]
}

function extractOpenApiSurface(
  specObj: any,
  ops: ApiListOp[],
): { surface: SourceSurface; unmatched: string[] } {
  const resolveRef = (ref: string) => resolveJsonPointer(specObj, ref)
  const pathsObj = specObj?.paths && typeof specObj.paths === 'object' ? specObj.paths : {}
  const serverBases = extractOpenApiServerBases(specObj)

  interface SpecOpEntry {
    method: string
    path: string
    normPath: string
    pathItem: any
    opObj: any
    operationId?: string
  }

  const specOps: SpecOpEntry[] = []
  const byOpId = new Map<string, SpecOpEntry>()

  for (const [rawPath, rawPathItem] of Object.entries(pathsObj)) {
    if (!rawPathItem || typeof rawPathItem !== 'object') continue
    const pathItem = rawPathItem as Record<string, any>
    for (const [rawMethod, rawOp] of Object.entries(pathItem)) {
      const m = rawMethod.toLowerCase()
      if (!HTTP_METHODS.has(m) || !rawOp || typeof rawOp !== 'object') continue
      const entry: SpecOpEntry = {
        method: m.toUpperCase(),
        path: rawPath,
        normPath: normalizePathTemplate(rawPath),
        pathItem,
        opObj: rawOp,
        operationId: typeof rawOp.operationId === 'string' ? rawOp.operationId : undefined,
      }
      specOps.push(entry)
      if (entry.operationId && !byOpId.has(entry.operationId)) {
        byOpId.set(entry.operationId, entry)
      }
    }
  }

  const findMatch = (apiOp: ApiListOp): SpecOpEntry | undefined => {
    const name = opNameFromId(apiOp.operation_id)
    const byId = byOpId.get(name)
    if (byId) return byId

    const targetMethod = apiOp.method.toUpperCase()
    const targetNorm = normalizePathTemplate(apiOp.path_template)
    for (const s of specOps) {
      if (s.method !== targetMethod) continue
      for (const base of serverBases) {
        const fullSpec = normalizePathTemplate(base + s.path)
        if (fullSpec === targetNorm) return s
      }
      if (s.normPath === targetNorm) return s
      if (s.normPath.length > targetNorm.length && s.normPath.endsWith(targetNorm)) return s
      if (targetNorm.length > s.normPath.length && targetNorm.endsWith(s.normPath)) return s
    }
    return undefined
  }

  const resultOps: Record<string, OpSurface> = {}
  const unmatched: string[] = []

  for (const apiOp of ops) {
    const matched = findMatch(apiOp)
    if (!matched) {
      unmatched.push(apiOp.operation_id)
      continue
    }

    const params: Record<string, { in: string; required: boolean }> = {}
    const rawParams = [
      ...(Array.isArray(matched.pathItem.parameters) ? matched.pathItem.parameters : []),
      ...(Array.isArray(matched.opObj.parameters) ? matched.opObj.parameters : []),
    ]
    for (const rawP of rawParams) {
      const p = typeof rawP?.$ref === 'string' ? resolveRef(rawP.$ref) : rawP
      if (!p || typeof p.name !== 'string' || typeof p.in !== 'string') continue
      params[p.name] = {
        in: p.in,
        required: Boolean(p.required || p.in === 'path'),
      }
    }
    if (matched.opObj.requestBody) {
      const rb = typeof matched.opObj.requestBody.$ref === 'string'
        ? resolveRef(matched.opObj.requestBody.$ref)
        : matched.opObj.requestBody
      if (rb && typeof rb === 'object') {
        params.body = { in: 'body', required: Boolean(rb.required) }
      }
    }

    const response: Record<string, { type: string; deprecated?: boolean }> = {}
    const responsesObj = matched.opObj.responses && typeof matched.opObj.responses === 'object' ? matched.opObj.responses : {}
    const twoXxKey = Object.keys(responsesObj).sort().find(k => /^2\d\d$|^2XX$/i.test(k))
    if (twoXxKey) {
      const rawResp = responsesObj[twoXxKey]
      const resp = typeof rawResp?.$ref === 'string' ? resolveRef(rawResp.$ref) : rawResp
      if (resp && typeof resp === 'object') {
        let respSchema: any
        if (resp.content && typeof resp.content === 'object') {
          respSchema = resp.content['application/json']?.schema
            ?? Object.values(resp.content).find((c: any) => c && typeof c === 'object' && c.schema)?.['schema' as never]
        } else if (resp.schema) {
          respSchema = resp.schema
        }
        if (respSchema) {
          walkSchema(respSchema, '', 0, resolveRef, new Set(), response)
        }
      }
    }

    resultOps[apiOp.operation_id] = {
      op: apiOp.operation_id,
      method: matched.method,
      path: matched.path,
      deprecated: Boolean(matched.opObj.deprecated),
      params,
      response,
    }
  }

  return {
    surface: {
      source: sourceFromOps(ops),
      format: 'openapi',
      ...(typeof specObj?.info?.version === 'string' ? { version: specObj.info.version } : {}),
      ops: resultOps,
    },
    unmatched,
  }
}

function collectDiscoveryMethods(resources: any, out: Map<string, any>): void {
  if (!resources || typeof resources !== 'object') return
  for (const res of Object.values(resources)) {
    if (!res || typeof res !== 'object') continue
    const r = res as Record<string, any>
    if (r.methods && typeof r.methods === 'object') {
      for (const m of Object.values(r.methods)) {
        if (m && typeof m === 'object' && typeof (m as any).id === 'string') {
          out.set((m as any).id, m)
        }
      }
    }
    if (r.resources) {
      collectDiscoveryMethods(r.resources, out)
    }
  }
}

function extractDiscoverySurface(
  specObj: any,
  ops: ApiListOp[],
): { surface: SourceSurface; unmatched: string[] } {
  const methodsById = new Map<string, any>()
  collectDiscoveryMethods(specObj?.resources, methodsById)
  const schemas = specObj?.schemas && typeof specObj.schemas === 'object' ? specObj.schemas : {}
  const resolveRef = (ref: string) => (ref.startsWith('#/') ? resolveJsonPointer(specObj, ref) : schemas[ref])

  const resultOps: Record<string, OpSurface> = {}
  const unmatched: string[] = []

  for (const apiOp of ops) {
    const name = opNameFromId(apiOp.operation_id)
    const m = methodsById.get(name)
    if (!m) {
      unmatched.push(apiOp.operation_id)
      continue
    }

    const params: Record<string, { in: string; required: boolean }> = {}
    if (m.parameters && typeof m.parameters === 'object') {
      for (const [pName, rawP] of Object.entries(m.parameters)) {
        const p = rawP as Record<string, any>
        params[pName] = {
          in: typeof p?.location === 'string' ? p.location : 'query',
          required: Boolean(p?.required),
        }
      }
    }

    const response: Record<string, { type: string; deprecated?: boolean }> = {}
    if (typeof m.response?.$ref === 'string') {
      const target = resolveRef(m.response.$ref)
      if (target) {
        walkSchema(target, '', 0, resolveRef, new Set([m.response.$ref]), response)
      }
    }

    resultOps[apiOp.operation_id] = {
      op: apiOp.operation_id,
      method: typeof m.httpMethod === 'string' ? m.httpMethod.toUpperCase() : apiOp.method.toUpperCase(),
      path: typeof m.flatPath === 'string' ? m.flatPath : typeof m.path === 'string' ? m.path : apiOp.path_template,
      deprecated: Boolean(m.deprecated),
      params,
      response,
    }
  }

  return {
    surface: {
      source: sourceFromOps(ops),
      format: 'discovery',
      ...(typeof specObj?.version === 'string' ? { version: specObj.version } : {}),
      ...(typeof specObj?.revision === 'string' ? { revision: specObj.revision } : {}),
      ops: resultOps,
    },
    unmatched,
  }
}

export function extractGraphqlSurface(sdl: string, usedFieldNames: Set<string>): SourceSurface {
  // Strip """...""" block strings and # comments
  const cleaned = sdl
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/#[^\n]*/g, '')

  // Join multi-line parentheses / @deprecated directives onto the field line
  const rawLines = cleaned.split(/\r?\n/)
  const joinedLines: string[] = []
  let parenDepth = 0
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    if (joinedLines.length > 0 && (parenDepth > 0 || trimmed.startsWith('@deprecated'))) {
      joinedLines[joinedLines.length - 1] += ' ' + trimmed
    } else {
      joinedLines.push(trimmed)
    }
    for (const ch of trimmed) {
      if (ch === '(') parenDepth++
      else if (ch === ')' && parenDepth > 0) parenDepth--
    }
  }

  const ops: Record<string, OpSurface> = {}
  let currentType: string | null = null

  for (const line of joinedLines) {
    const typeMatch = line.match(/^(?:extend\s+)?(?:type|interface|input)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{]*\{/)
    if (typeMatch) {
      currentType = typeMatch[1]
      if (line.includes('}')) currentType = null
      continue
    }
    if (currentType && line.startsWith('}')) {
      currentType = null
      continue
    }
    if (!currentType) continue

    const fieldMatch = line.match(/^([a-zA-Z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:\s*([^\s@]+)/)
    if (!fieldMatch) continue
    const [, fieldName, rawArgs, returnType] = fieldMatch
    if (!usedFieldNames.has(fieldName)) continue

    const params: Record<string, { in: string; required: boolean }> = {}
    if (rawArgs) {
      for (const argPart of rawArgs.split(',')) {
        const argMatch = argPart.trim().match(/^([a-zA-Z_][A-Za-z0-9_]*)\s*:\s*(.+)$/)
        if (argMatch) {
          params[argMatch[1]] = {
            in: 'query',
            required: argMatch[2].trim().endsWith('!'),
          }
        }
      }
    }

    const opKey = `${currentType}.${fieldName}`
    ops[opKey] = {
      op: opKey,
      method: 'QUERY',
      path: opKey,
      deprecated: /@deprecated\b/.test(line),
      params,
      response: { '': { type: returnType } },
    }
  }

  return {
    source: '',
    format: 'graphql',
    ops,
  }
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function scopeSlackDocHtml(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  const main = !article ? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) : null
  const scoped = article ? article[1] : main ? main[1] : html
  return scoped
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
}

function parseSlackArgRows(
  sectionHtml: string,
  defaultRequired: boolean | null,
  params: Record<string, { in: string; required: boolean }>,
): number {
  let count = 0
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  for (const rowMatch of sectionHtml.matchAll(rowRe)) {
    const rowHtml = rowMatch[1]
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1])
    if (cells.length === 0) continue
    // Skip pure header rows
    if (/<th\b/i.test(rowHtml) && !/<td\b/i.test(rowHtml)) continue

    const firstCell = cells[0]
    const codeMatch = firstCell.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)
    const rawName = stripHtmlTags(codeMatch ? codeMatch[1] : firstCell).split(/\s+/)[0] ?? ''
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawName)) continue

    const restText = stripHtmlTags(rowHtml)
    let required: boolean | null = defaultRequired
    if (/\bRequired\b/i.test(restText)) required = true
    else if (/\bOptional\b/i.test(restText)) required = false
    if (required === null) continue

    params[rawName] = { in: 'query', required }
    count++
  }

  if (count === 0 && defaultRequired !== null) {
    for (const itemMatch of sectionHtml.matchAll(/<(?:li|dt)\b[^>]*>([\s\S]*?)<\/(?:li|dt)>/gi)) {
      const codeMatch = itemMatch[1].match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)
      if (!codeMatch) continue
      const rawName = stripHtmlTags(codeMatch[1]).split(/\s+/)[0] ?? ''
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawName)) continue
      const text = stripHtmlTags(itemMatch[1])
      let required = defaultRequired
      if (/\bRequired\b/i.test(text)) required = true
      else if (/\bOptional\b/i.test(text)) required = false
      params[rawName] = { in: 'query', required }
      count++
    }
  }
  return count
}

function extractElementsByClass(html: string, className: string): Array<{ full: string; inner: string; start: number; end: number }> {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openRe = new RegExp(
    `<(div|span)\\b[^>]*\\bclass=(?:"[^"]*\\b${escaped}\\b[^"]*"|'[^']*\\b${escaped}\\b[^']*'|[^\\s>]*\\b${escaped}\\b[^\\s>]*)[^>]*>`,
    'gi',
  )
  const out: Array<{ full: string; inner: string; start: number; end: number }> = []
  let pos = 0
  while (pos < html.length) {
    openRe.lastIndex = pos
    const m = openRe.exec(html)
    if (!m) break
    const tag = m[1].toLowerCase()
    const contentStart = m.index + m[0].length
    const tagRe = new RegExp(`<(\\/)?${tag}\\b[^>]*>`, 'gi')
    tagRe.lastIndex = contentStart
    let depth = 1
    let endIdx = -1
    let innerEnd = -1
    let tm: RegExpExecArray | null
    while ((tm = tagRe.exec(html)) !== null) {
      if (tm[1]) {
        depth--
        if (depth === 0) {
          innerEnd = tm.index
          endIdx = tm.index + tm[0].length
          break
        }
      } else {
        depth++
      }
    }
    if (endIdx === -1) {
      pos = contentStart
      continue
    }
    out.push({
      full: html.slice(m.index, endIdx),
      inner: html.slice(contentStart, innerEnd),
      start: m.index,
      end: endIdx,
    })
    pos = endIdx
  }
  return out
}

const SLACK_NOTICE_RE = /deprecat|retire|sunset|no longer|will be removed|end of life|rate limit|Tier \d/i

export function extractSlackDocOp(opId: string, methodName: string, html: string): OpSurface {
  const scoped = scopeSlackDocHtml(html)
  const params: Record<string, { in: string; required: boolean }> = {}

  for (const row of extractElementsByClass(scoped, 'param-top-row')) {
    const nameEl = extractElementsByClass(row.inner, 'reference-name')[0]
    if (!nameEl) continue
    const codeMatch = nameEl.inner.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)
    const rawName = stripHtmlTags(codeMatch ? codeMatch[1] : nameEl.inner).split(/\s+/)[0] ?? ''
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawName)) continue

    const reqEl = extractElementsByClass(row.inner, 'required')[0]
    const reqText = reqEl ? stripHtmlTags(reqEl.inner) : stripHtmlTags(row.inner)
    let required: boolean | null = null
    if (/\bRequired\b/i.test(reqText)) required = true
    else if (/\bOptional\b/i.test(reqText)) required = false
    if (required === null) continue

    params[rawName] = { in: 'query', required }
  }

  const headings = [...scoped.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({
    level: Number(m[1]),
    title: stripHtmlTags(m[2]),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))

  const sectionSlice = (idx: number): string => {
    const h = headings[idx]
    for (let j = idx + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        return scoped.slice(h.end, headings[j].start)
      }
    }
    return scoped.slice(h.end)
  }

  if (Object.keys(params).length === 0) {
    let foundArgSection = false
    for (let i = 0; i < headings.length; i++) {
      const t = headings[i].title.toLowerCase()
      if (/^required\s+arguments?$/.test(t)) {
        foundArgSection = true
        parseSlackArgRows(sectionSlice(i), true, params)
      } else if (/^optional\s+arguments?$/.test(t)) {
        foundArgSection = true
        parseSlackArgRows(sectionSlice(i), false, params)
      } else if (/^arguments?$/.test(t)) {
        foundArgSection = true
        // Parse sub-sections if present, or rows with Required/Optional labels
        parseSlackArgRows(sectionSlice(i), null, params)
      }
    }

    if (!foundArgSection) {
      // Fallback: parse any table rows that explicitly label Required / Optional
      parseSlackArgRows(scoped, null, params)
    }
  }

  const errorSet = new Set<string>()
  const errorSections = extractElementsByClass(scoped, 'errors-section')
  const errorsIdx = headings.findIndex(h => /^errors?$/i.test(h.title))

  if (errorSections.length > 0) {
    for (const sec of errorSections) {
      for (const item of extractElementsByClass(sec.inner, 'reference-facts-item')) {
        const nameEl = extractElementsByClass(item.inner, 'reference-name')[0]
        if (!nameEl) continue
        const codeMatch = nameEl.inner.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)
        const code = stripHtmlTags(codeMatch ? codeMatch[1] : nameEl.inner).split(/\s+/)[0] ?? ''
        if (/^(?:error|description)$/i.test(code)) continue
        if (/^[a-z][a-z0-9_]+$/.test(code)) errorSet.add(code)
      }
    }
  } else if (errorsIdx !== -1) {
    const errHtml = sectionSlice(errorsIdx)
    for (const rowMatch of errHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1])
      if (cells.length === 0 || (/<th\b/i.test(rowMatch[1]) && !/<td\b/i.test(rowMatch[1]))) continue
      const codeMatch = cells[0].match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)
      const code = stripHtmlTags(codeMatch ? codeMatch[1] : cells[0]).split(/\s+/)[0] ?? ''
      if (/^[a-z][a-z0-9_]+$/.test(code)) errorSet.add(code)
    }
    if (errorSet.size === 0) {
      for (const m of errHtml.matchAll(/<code\b[^>]*>([a-z][a-z0-9_]+)<\/code>/gi)) {
        errorSet.add(m[1])
      }
    }
  }

  const extraNotes: string[] = []
  let notesHtml = scoped
  for (const sec of errorSections.slice().reverse()) {
    notesHtml = notesHtml.slice(0, sec.start) + ' ' + notesHtml.slice(sec.end)
  }
  if (errorSections.length === 0 && errorsIdx !== -1) {
    const h = headings[errorsIdx]
    const errSlice = sectionSlice(errorsIdx)
    const tableEnd = errSlice.match(/<\/table>/i)
    const endPos = tableEnd && tableEnd.index !== undefined ? h.end + tableEnd.index + tableEnd[0].length : h.end
    notesHtml = notesHtml.slice(0, h.start) + ' ' + notesHtml.slice(endPos)
  }

  for (const row of extractElementsByClass(notesHtml, 'info-row').slice().reverse()) {
    const keyMatch = row.inner.match(/<strong\b[^>]*class=(?:"[^"]*\binfo-key\b[^"]*"|'[^']*\binfo-key\b[^']*'|[^\s>]*\binfo-key\b[^\s>]*)[^>]*>([\s\S]*?)<\/strong>/i)
    if (keyMatch && /^rate\s+limits?$/i.test(stripHtmlTags(keyMatch[1]))) {
      const restHtml = row.inner.slice((keyMatch.index ?? 0) + keyMatch[0].length)
      const val = stripHtmlTags(restHtml)
      if (val) extraNotes.push(`rate_limit: ${val}`)
      notesHtml = notesHtml.slice(0, row.start) + ' ' + notesHtml.slice(row.end)
    }
  }

  const textLines = decodeHtmlEntities(
    notesHtml
      .replace(/<\/(?:p|li|div|h[1-6]|tr|td|th|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split(/\r?\n/)
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 0 && SLACK_NOTICE_RE.test(s))

  const errors = [...errorSet].sort()
  const notes = [...new Set([...extraNotes, ...textLines])].sort()

  return {
    op: opId,
    method: 'RPC',
    path: methodName,
    deprecated: false,
    params,
    response: {},
    ...(errors.length > 0 ? { errors } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  }
}

export function extractSlackDocSurface(
  pages: Map<string, string>,
  ops: ApiListOp[],
): { surface: SourceSurface; unmatched: string[] } {
  const resultOps: Record<string, OpSurface> = {}
  const unmatched: string[] = []
  for (const apiOp of ops) {
    const methodName = opNameFromId(apiOp.operation_id)
    const html = pages.get(methodName)
    if (html === undefined) {
      unmatched.push(apiOp.operation_id)
      continue
    }
    resultOps[apiOp.operation_id] = extractSlackDocOp(apiOp.operation_id, methodName, html)
  }
  return {
    surface: {
      source: sourceFromOps(ops),
      format: 'slack_doc',
      ops: resultOps,
    },
    unmatched,
  }
}

export function extractSurface(
  format: 'openapi' | 'discovery' | 'graphql',
  spec: unknown | string,
  ops: ApiListOp[],
): { surface: SourceSurface; unmatched: string[] } {
  if (format === 'graphql') {
    const sdl = typeof spec === 'string' ? spec : String(spec ?? '')
    return { surface: extractGraphqlSurface(sdl, new Set()), unmatched: [] }
  }
  const specObj = typeof spec === 'string' ? JSON.parse(spec) : spec
  if (format === 'discovery') {
    return extractDiscoverySurface(specObj, ops)
  }
  return extractOpenApiSurface(specObj, ops)
}
