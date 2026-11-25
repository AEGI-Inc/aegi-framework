import crypto from 'crypto'

export interface EncryptedPayload {
  iv: string
  authTag: string
  ciphertext: string
  updatedAt: string
}

/**
 * 마스터 패스프레이즈 또는 64자리 Hex 키로부터 32바이트(256비트) 암호화 키를 도출합니다.
 */
export function deriveKey(masterSecret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(masterSecret.trim())) {
    return Buffer.from(masterSecret.trim(), 'hex')
  }
  // 패스프레이즈인 경우 scrypt 를 이용해 고정 salt 로 32바이트 키 생성
  const salt = Buffer.from('aegi-vault-salt-2026', 'utf8')
  return crypto.scryptSync(masterSecret, salt, 32)
}

/**
 * 평문 문자열을 AES-256-GCM 으로 암호화합니다.
 */
export function encrypt(plaintext: string, keyBuffer: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12) // GCM 표준 12바이트 IV
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv)
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex')
  ciphertext += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return {
    iv: iv.toString('hex'),
    authTag,
    ciphertext,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 암호화된 페이로드를 복호화하여 평문 문자열을 반환합니다.
 */
export function decrypt(payload: EncryptedPayload, keyBuffer: Buffer): string {
  const iv = Buffer.from(payload.iv, 'hex')
  const authTag = Buffer.from(payload.authTag, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv)
  decipher.setAuthTag(authTag)

  let plaintext = decipher.update(payload.ciphertext, 'hex', 'utf8')
  plaintext += decipher.final('utf8')
  return plaintext
}
