/**
 * total-collector(v0.1~v0.6 인계본)의 문서 operation 인벤토리에서 Profile 이 쓰는 operation 의 scope 근거만 가져온다.
 *
 *   npm run api-list:import-inventory -- <인벤토리 폴더: *_operations.jsonl>
 *
 * 인벤토리는 공식 문서(OpenAPI, Discovery, 문서 표)에서 뽑은 10,582 operation 이다. 여기 적힌 scope 는 문서의 주장이며
 * 테넌트에서 실제로 허용됐다는 근거가 아니다. 결과는 api-list/inventory-scopes.json 이고 api-list:build 가 읽는다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadProfiles } from './build'

const HERE = path.dirname(fileURLToPath(import.meta.url))

interface InventoryOp {
  op_id: string
  provider: string
  http_method?: string
  method?: string
  path?: string
  scopes?: string[]
  src?: { at?: string; source?: string }
}

/** GitHub 인벤토리는 출처 이름이 Profile 과 달라(ghec_openapi_… / gh_rest_ghec_next_…) 메서드와 경로로 맞춘다 */
const pathKey = (provider: string, method: string, p: string) => `${provider}|${method.toUpperCase()}|${p.replace(/\{[^}]+\}/g, '{}')}`

export function importInventory(dir: string): { scopes: Record<string, string[]>; matched: number; unmatched: number; inventory: number } {
  const byOp = new Map<string, InventoryOp>()
  const byPath = new Map<string, InventoryOp>()
  let inventory = 0
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('_operations.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      const x = JSON.parse(line) as InventoryOp
      inventory++
      const source = x.src?.source
      if (source && x.method) byOp.set(`op:${source}:${x.method}`, x)
      if (source && x.src?.at) byOp.set(`op:${source}:${x.src.at}`, x)
      const at = x.src?.at?.split(' ')
      if (at?.length === 2) byPath.set(pathKey(x.provider, at[0], at[1]), x)
      if (x.http_method && x.path) byPath.set(pathKey(x.provider, x.http_method, x.path), x)
    }
  }
  const scopes: Record<string, string[]> = {}
  let matched = 0, unmatched = 0
  const seen = new Set<string>()
  for (const { prof } of loadProfiles()) {
    const b = prof.binding ?? {}
    const op = b.operation_id
    if (!op || seen.has(op)) continue
    seen.add(op)
    const provider = String(op.split(':')[1]).startsWith('gh_') ? 'github' : ''
    const hit = byOp.get(op) ?? (provider && b.method && b.endpoint_template ? byPath.get(pathKey(provider, b.method, b.endpoint_template)) : undefined)
    if (hit) { matched++; if (hit.scopes?.length) scopes[op] = [...new Set(hit.scopes)].sort() }
    else unmatched++
  }
  return { scopes: Object.fromEntries(Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b))), matched, unmatched, inventory }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]
  if (!dir) { console.error('사용: npm run api-list:import-inventory -- <인벤토리 폴더>'); process.exit(2) }
  const r = importInventory(path.resolve(dir))
  const out = { format: 'aegi-inventory-scopes/v1', source: 'AEGI total-collector v0.6 inventory (공식 문서 기반, 테넌트 허용 근거 아님)', inventory_operations: r.inventory, profile_operations_matched: r.matched, profile_operations_unmatched: r.unmatched, scopes: r.scopes }
  fs.writeFileSync(path.join(HERE, 'inventory-scopes.json'), JSON.stringify(out, null, 1) + '\n')
  console.log(`인벤토리 ${r.inventory}개 중 Profile operation ${r.matched}개 연결, ${r.unmatched}개 못 찾음. scope 근거 ${Object.keys(r.scopes).length}개`)
}
