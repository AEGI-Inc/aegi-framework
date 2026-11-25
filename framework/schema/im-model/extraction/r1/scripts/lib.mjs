// 공통 도구: 경로, 해시, 비식별 토큰, IR 읽기. Node 내장 모듈만 쓴다.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/bridge-config.json'), 'utf8'))
export const OUT = path.join(ROOT, CONFIG.revision)
export const PRIVATE = path.join(ROOT, 'private')

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')
export const fileSha = p => sha256(fs.readFileSync(p))
export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
export const readJsonl = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []

export function writeJsonl(p, rows) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
}
export function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n')
}

// 실제 ID·이메일을 산출물에 쓰지 않는다. 같은 값은 같은 토큰이 되도록 로컬 비밀 키로 HMAC 한다.
// 키는 private/ 에만 있고 공개 산출물에서 원래 값을 복원할 수 없다.
let key
export function token(kind, value) {
  if (value === undefined || value === null || value === '') return null
  if (!key) {
    const kp = path.join(PRIVATE, 'token-key')
    if (!fs.existsSync(kp)) { fs.mkdirSync(PRIVATE, { recursive: true }); fs.writeFileSync(kp, crypto.randomBytes(32).toString('hex')) }
    key = fs.readFileSync(kp, 'utf8').trim()
  }
  return `${kind}:${crypto.createHmac('sha256', key).update(String(value)).digest('hex').slice(0, 16)}`
}

export const cohortDir = () => path.join(CONFIG.cohort.root, 'raw', CONFIG.cohort.run)

// 한 run 의 envelope 를 모두 읽는다. 파일 해시와 run 기준 상대 경로를 함께 둔다.
export function loadEnvelopes() {
  const dir = cohortDir(), out = []
  for (const prov of fs.readdirSync(dir).sort()) {
    for (const f of fs.readdirSync(path.join(dir, prov)).sort()) {
      const p = path.join(dir, prov, f), buf = fs.readFileSync(p)
      out.push({ rel: `${prov}/${f}`, file_sha256: sha256(buf), env: JSON.parse(buf.toString('utf8')) })
    }
  }
  return out
}

// 연구 provider 별 IR 을 필요할 때만 읽는다.
const irCache = new Map()
export function ir(provider, table) {
  const k = `${provider}/${table}`
  if (!irCache.has(k)) irCache.set(k, readJsonl(path.join(CONFIG.ir_root, provider, 'ir', `${table}.jsonl`)))
  return irCache.get(k)
}
const shapeIdx = new Map()
export function shape(provider, id) {
  if (!shapeIdx.has(provider)) shapeIdx.set(provider, new Map(ir(provider, 'shape').map(s => [s.id, s])))
  return shapeIdx.get(provider).get(id)
}
