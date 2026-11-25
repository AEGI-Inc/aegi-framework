/**
 * 로컬 암호화 저장소. KV 금고(kv.ts)와 같은 AES-256-GCM 페이로드를 값 하나당 파일 하나로 둔다.
 * KV 에서 가져온 값은 풀지 않고 암호문 그대로 저장하므로, 디스크에는 평문이 남지 않는다.
 * 마스터 키는 KV 금고와 같은 AEGI_VAULT_KEY 를 쓴다.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { decrypt, deriveKey, type EncryptedPayload } from './crypto.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LOCAL_DIR = path.join(ROOT, 'setup-output', 'secrets-enc')

/** cli.ts 와 같은 순서: 환경변수 AEGI_VAULT_KEY, 없으면 .env.vault (작업 폴더, 저장소 루트 순) */
export function masterKey(): Buffer {
  const fromEnv = process.env.AEGI_VAULT_KEY
  if (fromEnv) return deriveKey(fromEnv)
  for (const file of [path.resolve('.env.vault'), path.join(ROOT, '.env.vault')]) {
    if (!fs.existsSync(file)) continue
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(l => /^\s*AEGI_VAULT_KEY\s*=/.test(l))
    const val = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
    if (val) return deriveKey(val)
  }
  throw new Error('마스터 암호키가 없습니다 (환경변수 AEGI_VAULT_KEY 또는 .env.vault 파일 필요)')
}

/** KV 키에는 / 가 들어갈 수 있어 파일 이름은 인코딩한다 */
const fileFor = (name: string, dir: string) => path.join(dir, `${encodeURIComponent(name)}.json`)

function isPayload(v: unknown): v is EncryptedPayload {
  const p = v as EncryptedPayload
  return !!p && typeof p.iv === 'string' && typeof p.authTag === 'string' && typeof p.ciphertext === 'string'
}

export function saveLocal(name: string, payload: EncryptedPayload, dir = LOCAL_DIR): string {
  if (!isPayload(payload)) throw new Error(`${name}: 암호화 페이로드 형식이 아니다`)
  fs.mkdirSync(dir, { recursive: true })
  const file = fileFor(name, dir)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return file
}

export function loadLocal(name: string, dir = LOCAL_DIR): EncryptedPayload | null {
  const file = fileFor(name, dir)
  if (!fs.existsSync(file)) return null
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!isPayload(payload)) throw new Error(`${file}: 암호화 페이로드 형식이 아니다`)
  return payload
}

export function listLocal(dir = LOCAL_DIR): Array<{ name: string; updatedAt: string }> {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as EncryptedPayload
    return { name: decodeURIComponent(f.slice(0, -5)), updatedAt: payload.updatedAt ?? '' }
  })
}

/** 값 대신 보여 줄 지문 (SHA-256 앞 12자) */
export function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12)
}

/**
 * 코드에서 비밀값을 읽을 때 쓸 함수. 환경변수 → 로컬 암호화 파일 → 평문 파일(plainFile) 순으로 찾고, 없으면 null.
 * 지금은 부르는 곳이 없다. 평문 파일을 쓰는 코드를 옮길 때 이것으로 바꾼다.
 */
export function readSecret(name: string, opts: { dir?: string; key?: Buffer; plainFile?: string } = {}): string | null {
  const fromEnv = process.env[name]
  if (fromEnv) return fromEnv
  const payload = loadLocal(name, opts.dir)
  if (payload) return decrypt(payload, opts.key ?? masterKey())
  if (opts.plainFile && fs.existsSync(opts.plainFile)) return fs.readFileSync(opts.plainFile, 'utf8')
  return null
}
