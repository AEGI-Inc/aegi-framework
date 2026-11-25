// 원문 shape 그래프 도구: 부모 찾기, 응답 root, record 배열, 공간 조상.
import path from 'node:path'
import { CONFIG, ir, shape, readJson } from './lib.mjs'

const cache = new Map()
export function graph(p) {
  if (cache.has(p)) return cache.get(p)
  const parents = new Map()   // child shape -> [{ parent, via: 'prop'|'items'|'alt', name }]
  const add = (c, e) => { if (!c) return; if (!parents.has(c)) parents.set(c, []); parents.get(c).push(e) }
  for (const s of ir(p, 'shape')) {
    for (const x of s.props ?? []) { add(x.shape, { parent: s.id, via: 'prop', name: x.name }); add(x.items?.shape, { parent: s.id, via: 'prop[]', name: x.name }) }
    if (s.items?.shape) add(s.items.shape, { parent: s.id, via: 'items', name: '[*]' })
    for (const a of s.alts ?? []) add(a, { parent: s.id, via: 'alt', name: '' })
  }
  // 읽기 operation 의 응답만 수집 가능한 상태 정보의 root 다.
  // REST: GET. GraphQL: read_one/read_many. RPC: 원문이 종류를 말하지 않으므로 OAuth scope 로 본다(write 가 있으면 쓰기, 그 밖은 읽기로 두고 kind_unknown 표시)
  const responseOf = new Map(), writeResponseOf = new Map()
  const opKind = new Map(), opRead = new Map()
  const isRead = o => {
    if (o.surface === 'rpc' && o.kind === 'unknown') { const sc = (o.grants ?? []).map(g => g.split(':').pop()); return sc.some(x => x.includes('write')) ? false : 'kind_unknown' }
    if (o.surface === 'graphql') return o.kind === 'read_one' || o.kind === 'read_many'
    return o.method === 'GET'
  }
  for (const o of ir(p, 'operation')) {
    opKind.set(o.id, o.kind)
    const rd = isRead(o)
    opRead.set(o.id, rd)
    const target = rd ? responseOf : writeResponseOf
    for (const r of o.responses ?? []) if (r.shape && /^2/.test(r.status)) { if (!target.has(r.shape)) target.set(r.shape, []); target.get(r.shape).push(o.id) }
  }
  const map = readJson(path.join(CONFIG.ir_root, p, 'map', 'info_map.json'))
  const spaceOf = new Map()
  for (const [k, v] of Object.entries(map.spaces)) for (const s of v.shapes) if (!spaceOf.has(s)) spaceOf.set(s, k)
  const g = { p, parents, responseOf, writeResponseOf, opKind, opRead, spaceOf, spaces: map.spaces }
  cache.set(p, g)
  return g
}

// 객체 원소 배열 속성 (record 배열 후보)
export function recordArrays(p, sid) {
  const s = shape(p, sid), out = []
  for (const x of s?.props ?? []) {
    const items = x.items?.shape ?? (shape(p, x.shape)?.kind === 'array' ? shape(p, x.shape).items?.shape : null)
    const is = items && shape(p, items)
    if (is && is.kind !== 'array' && is.kind !== 'scalar') out.push({ name: x.name, items })
  }
  return out
}

// 공간 조상: 부모를 따라 올라가며 처음 만나는 공간들. 응답 root 에 닿으면 root 로 기록
export function ancestors(g, sid, limit = 8) {
  const found = new Map(), roots = new Set(), writeRoots = new Set(), seen = new Set()
  const up = (s, pathParts, d) => {
    if (seen.has(s) || d > limit) return
    seen.add(s)
    for (const e of g.parents.get(s) ?? []) {
      const parts = e.name && e.name !== '[*]' ? [e.name, ...pathParts] : pathParts
      if (g.spaceOf.has(e.parent)) { const sp = g.spaceOf.get(e.parent); if (!found.has(sp)) found.set(sp, parts.join('.')) }
      else { if (g.responseOf.has(e.parent)) roots.add(e.parent); if (g.writeResponseOf.has(e.parent)) writeRoots.add(e.parent); up(e.parent, parts, d + 1) }
    }
  }
  if (g.responseOf.has(sid)) roots.add(sid)
  if (g.writeResponseOf.has(sid)) writeRoots.add(sid)
  up(sid, [], 0)
  return { spaces: [...found].map(([space, rel]) => ({ space, rel })), roots: [...roots], writeRoots: [...writeRoots] }
}
