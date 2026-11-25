import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { EncryptedPayload } from './crypto.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? 'a5921c69fa5ebeb3a79c15ac2e4a38fd'
const VAULT_NAMESPACE_TITLE = 'aegi-secrets-vault'

export function getCfToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN
  // 작업 폴더를 먼저 본다(local.ts 의 .env.vault 와 같은 순서). worktree 에서 돌려도 원래 체크아웃의 파일을 쓸 수 있다
  const envFiles = [
    path.resolve('.env.setup'),
    path.join(ROOT, '.env.setup'),
    path.join(ROOT, '..', 'aegi-dashboard', '.env.setup')
  ]
  for (const file of envFiles) {
    if (fs.existsSync(file)) {
      const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(l => /^\s*CF_TOKEN\s*=/.test(l))
      const val = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
      if (val) return val
    }
  }
  throw new Error('Cloudflare API 토큰이 없습니다 (CLOUDFLARE_API_TOKEN 환경변수 또는 .env.setup의 CF_TOKEN 필요)')
}

async function cfApi<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${getCfToken()}`,
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${apiPath}`, init)
  const json = await res.json().catch(() => ({})) as { success: boolean; result: T; errors?: Array<{ code: number; message: string }> }
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map(e => `${e.code} ${e.message}`).join('; ')
    throw new Error(`Cloudflare API 오류 [${method} ${apiPath}] ${res.status}: ${msg}`)
  }
  return json.result
}

interface KvNamespace {
  id: string
  title: string
}

let cachedNamespaceId: string | null = null

export async function getOrCreateVaultNamespace(): Promise<string> {
  if (cachedNamespaceId) return cachedNamespaceId
  const list = await cfApi<KvNamespace[]>('GET', '/storage/kv/namespaces?per_page=100')
  const found = list.find(ns => ns.title === VAULT_NAMESPACE_TITLE)
  if (found) {
    cachedNamespaceId = found.id
    return found.id
  }
  const created = await cfApi<KvNamespace>('POST', '/storage/kv/namespaces', { title: VAULT_NAMESPACE_TITLE })
  cachedNamespaceId = created.id
  return created.id
}

/**
 * Vault 키 메타데이터 (KV metadata, 1KB 이하). 값은 넣지 않는다.
 * 정의는 aegi-knowledge environments/registry/credentials.yaml 이 정본이고, 이 칸은 그 정의와 지금 값을 잇는다.
 */
export interface VaultKeyMeta {
  credential_id: string
  tenant: string | null
  round: string | null
  /** 이 값을 마지막으로 넣은 시각 (회전 시각) */
  rotated_at: string | null
  expires_at: string | null
}

export interface VaultKeyEntry {
  name: string
  metadata: Partial<VaultKeyMeta> | null
}

const META_FIELDS: Array<keyof VaultKeyMeta> = ['credential_id', 'tenant', 'round', 'rotated_at', 'expires_at']

/** 알려진 칸만 남기고 1KB 를 넘지 않는지 본다 */
export function cleanMeta(meta: Partial<VaultKeyMeta>): Partial<VaultKeyMeta> {
  const out: Partial<VaultKeyMeta> = {}
  for (const k of META_FIELDS) if (meta[k] !== undefined) (out as Record<string, unknown>)[k] = meta[k]
  if (Buffer.byteLength(JSON.stringify(out)) > 1024) throw new Error('Vault 메타데이터가 1KB 를 넘습니다')
  return out
}

/** 값과 메타데이터를 함께 쓴다 (bulk API 는 JSON 으로 둘 다 받는다) */
async function writeWithMeta(key: string, value: string, metadata: Partial<VaultKeyMeta> | null): Promise<void> {
  const nsId = await getOrCreateVaultNamespace()
  const item: Record<string, unknown> = { key, value }
  if (metadata && Object.keys(metadata).length) item.metadata = cleanMeta(metadata)
  await cfApi('PUT', `/storage/kv/namespaces/${nsId}/bulk`, [item])
}

/**
 * 값을 쓴다. 이미 있는 메타데이터는 지우지 않고 rotated_at 만 새 값의 시각으로 바꾼다.
 * (KV 는 값을 덮으면 메타데이터도 사라지므로 먼저 읽어 둔다)
 */
export async function putVaultSecret(key: string, payload: EncryptedPayload, meta?: Partial<VaultKeyMeta>): Promise<void> {
  const current = meta ? null : await getVaultMeta(key)
  const next = { ...(current ?? {}), ...(meta ?? {}), rotated_at: payload.updatedAt ?? new Date().toISOString() }
  await writeWithMeta(key, JSON.stringify(payload), current || meta ? next : null)
}

/** 값은 그대로 두고 메타데이터만 바꾼다. 저장된 문자열을 그대로 다시 쓴다. meta 를 함수로 주면 저장된 암호문(복호화하지 않음)을 보고 정한다 */
export async function setVaultMeta(key: string, meta: Partial<VaultKeyMeta> | ((stored: Partial<EncryptedPayload>) => Partial<VaultKeyMeta>)): Promise<void> {
  const raw = await getVaultRaw(key)
  if (raw === null) throw new Error(`Vault 에 없는 키: ${key}`)
  let stored: Partial<EncryptedPayload> = {}
  try { stored = JSON.parse(raw) } catch { /* 암호문 JSON 이 아니면 updatedAt 을 모른다 */ }
  await writeWithMeta(key, raw, typeof meta === 'function' ? meta(stored) : meta)
}

export async function getVaultMeta(key: string): Promise<Partial<VaultKeyMeta> | null> {
  const entries = await listVaultSecretEntries(key)
  return entries.find(e => e.name === key)?.metadata ?? null
}

/** 저장된 문자열 그대로(암호문 JSON). 복호화하지 않는다 */
export async function getVaultRaw(key: string): Promise<string | null> {
  const nsId = await getOrCreateVaultNamespace()
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${getCfToken()}` }
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`KV 조회 실패: HTTP ${res.status}`)
  return res.text()
}

/** 키 이름과 메타데이터 (값은 읽지 않는다). prefix 를 주면 그 앞부분으로 시작하는 키만 */
export async function listVaultSecretEntries(prefix?: string): Promise<VaultKeyEntry[]> {
  const nsId = await getOrCreateVaultNamespace()
  const out: VaultKeyEntry[] = []
  let cursor = ''
  do {
    const qs = new URLSearchParams({ limit: '1000' })
    if (prefix) qs.set('prefix', prefix)
    if (cursor) qs.set('cursor', cursor)
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${nsId}/keys?${qs}`, {
      headers: { Authorization: `Bearer ${getCfToken()}` }
    })
    const json = await res.json() as { success: boolean; result: Array<{ name: string; metadata?: Partial<VaultKeyMeta> }>; result_info?: { cursor?: string }; errors?: Array<{ message: string }> }
    if (!res.ok || !json.success) throw new Error(`KV 키 목록 조회 실패: HTTP ${res.status} ${(json.errors ?? []).map(e => e.message).join('; ')}`)
    out.push(...json.result.map(k => ({ name: k.name, metadata: k.metadata ?? null })))
    cursor = json.result_info?.cursor ?? ''
  } while (cursor)
  return out
}

export async function getVaultSecret(key: string): Promise<EncryptedPayload | null> {
  const nsId = await getOrCreateVaultNamespace()
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${getCfToken()}` }
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`KV 조회 실패: HTTP ${res.status}`)
    const text = await res.text()
    return JSON.parse(text) as EncryptedPayload
  } catch (err: any) {
    if (err?.message?.includes('404')) return null
    throw err
  }
}

export async function deleteVaultSecret(key: string): Promise<void> {
  const nsId = await getOrCreateVaultNamespace()
  await cfApi('DELETE', `/storage/kv/namespaces/${nsId}/values/${encodeURIComponent(key)}`)
}

export async function listVaultSecretKeys(): Promise<string[]> {
  const nsId = await getOrCreateVaultNamespace()
  const res = await cfApi<Array<{ name: string }>>('GET', `/storage/kv/namespaces/${nsId}/keys?limit=1000`)
  return res.map(k => k.name)
}
