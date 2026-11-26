import fs from 'fs'
import path from 'path'
import { deriveKey, encrypt, decrypt } from './crypto.ts'
import { getOrCreateVaultNamespace, putVaultSecret, getVaultSecret, listVaultSecretKeys, deleteVaultSecret } from './kv.ts'

function getMasterKey(): Buffer {
  const secret = process.env.AEGI_VAULT_KEY
  if (!secret) {
    const envFile = path.resolve('.env.vault')
    if (fs.existsSync(envFile)) {
      const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find(l => /^\s*AEGI_VAULT_KEY\s*=/.test(l))
      const val = line?.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
      if (val) return deriveKey(val)
    }
    throw new Error('마스터 암호키가 없습니다 (환경변수 AEGI_VAULT_KEY 또는 .env.vault 파일 필요)')
  }
  return deriveKey(secret)
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === '--help' || cmd === 'help') {
    console.log(`
[AEGI Secret Vault CLI]
  npm run secret -- setup                          Cloudflare KV 네임스페이스 확인 및 생성
  npm run secret -- list                           저장된 Secret 키 목록 확인
  npm run secret -- set <key> <value>              비밀값을 AES-256-GCM 으로 암호화하여 저장
  npm run secret -- set-file <key> <filePath>      파일 내용 전체를 암호화하여 저장 (JSON 키 등)
  npm run secret -- get <key>                      저장된 비밀값 복호화하여 출력
  npm run secret -- export-file <key> <outPath>    암호화 저장된 파일 복호화하여 파일로 내보내기
  npm run secret -- push-env <envFilePath>         .env 파일 내의 모든 항목을 일괄 암호화 저장
  npm run secret -- pull-env [outFilePath]         저장된 모든 항목을 복호화하여 .env 파일로 생성
  npm run secret -- delete <key>...                Secret 을 지운다 (되돌릴 수 없다. 없는 키면 아무것도 지우지 않고 멈춘다)
`)
    return
  }

  if (cmd === 'setup') {
    console.log('Cloudflare KV Vault 네임스페이스를 확인합니다...')
    const nsId = await getOrCreateVaultNamespace()
    console.log(`성공: aegi-secrets-vault 네임스페이스 준비 완료 (ID: ${nsId})`)
    return
  }

  if (cmd === 'list') {
    console.log('저장된 Secret 목록을 조회합니다...')
    const keys = await listVaultSecretKeys()
    if (!keys.length) {
      console.log('등록된 Secret 이 없습니다.')
    } else {
      console.log(`등록된 Secret 총 ${keys.length}건:`)
      for (const k of keys) console.log(`  - ${k}`)
    }
    return
  }

  if (cmd === 'delete') {
    const targets = args.slice(1)
    if (!targets.length) throw new Error('사용법: npm run secret -- delete <key>...')
    // 오타로 다른 키를 지우지 않게, 하나라도 없으면 아무것도 지우지 않는다
    const existing = new Set(await listVaultSecretKeys())
    const missing = targets.filter(k => !existing.has(k))
    if (missing.length) throw new Error(`없는 키: ${missing.join(', ')}. 아무것도 지우지 않았습니다`)
    for (const k of targets) {
      await deleteVaultSecret(k)
      console.log(`삭제됨: ${k}`)
    }
    console.log(`성공: 총 ${targets.length}개 Secret 을 지웠습니다.`)
    return
  }

  const keyBuffer = getMasterKey()

  if (cmd === 'set') {
    const secretKey = args[1]
    const secretVal = args[2]
    if (!secretKey || !secretVal) throw new Error('사용법: npm run secret -- set <key> <value>')
    const payload = encrypt(secretVal, keyBuffer)
    await putVaultSecret(secretKey, payload)
    console.log(`성공: [${secretKey}] 비밀값이 암호화되어 KV 에 저장되었습니다.`)
    return
  }

  if (cmd === 'set-file') {
    const secretKey = args[1]
    const filePath = path.resolve(args[2])
    if (!secretKey || !filePath || !fs.existsSync(filePath)) {
      throw new Error('사용법: npm run secret -- set-file <key> <filePath> (존재하는 파일 필요)')
    }
    const content = fs.readFileSync(filePath, 'utf8')
    const payload = encrypt(content, keyBuffer)
    await putVaultSecret(secretKey, payload)
    console.log(`성공: [${secretKey}] 파일(${path.basename(filePath)}) 내용이 암호화되어 KV 에 저장되었습니다.`)
    return
  }

  if (cmd === 'get') {
    const secretKey = args[1]
    if (!secretKey) throw new Error('사용법: npm run secret -- get <key>')
    const payload = await getVaultSecret(secretKey)
    if (!payload) throw new Error(`Secret 을 찾을 수 없습니다: ${secretKey}`)
    const decrypted = decrypt(payload, keyBuffer)
    console.log(decrypted)
    return
  }

  if (cmd === 'export-file') {
    const secretKey = args[1]
    const outPath = path.resolve(args[2])
    if (!secretKey || !outPath) throw new Error('사용법: npm run secret -- export-file <key> <outPath>')
    const payload = await getVaultSecret(secretKey)
    if (!payload) throw new Error(`Secret 을 찾을 수 없습니다: ${secretKey}`)
    const decrypted = decrypt(payload, keyBuffer)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, decrypted, 'utf8')
    console.log(`성공: [${secretKey}] 복호화되어 ${outPath} 에 저장되었습니다.`)
    return
  }

  if (cmd === 'push-env') {
    const envFile = path.resolve(args[1])
    if (!envFile || !fs.existsSync(envFile)) throw new Error('사용법: npm run secret -- push-env <envFilePath>')
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    let count = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const k = trimmed.slice(0, eqIdx).trim()
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (k && v) {
        const payload = encrypt(v, keyBuffer)
        await putVaultSecret(k, payload)
        console.log(`저장됨: ${k}`)
        count++
      }
    }
    console.log(`성공: 총 ${count}개 환경변수가 암호화되어 저장되었습니다.`)
    return
  }

  if (cmd === 'pull-env') {
    const outPath = path.resolve(args[1] ?? '.env.collector.decrypted')
    const keys = await listVaultSecretKeys()
    const lines: string[] = ['# Auto-generated from Cloudflare KV Secret Vault', `# Generated at: ${new Date().toISOString()}`]
    let successCount = 0
    for (const k of keys) {
      if (k.startsWith('test/')) continue
      try {
        const payload = await getVaultSecret(k)
        if (payload) {
          const decrypted = decrypt(payload, keyBuffer)
          lines.push(`${k}="${decrypted}"`)
          successCount++
        }
      } catch (err: any) {
        console.warn(`[경고] ${k} 복호화 건너뜀: ${err.message}`)
      }
    }
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')
    console.log(`성공: 총 ${successCount}개 Secret 이 복호화되어 ${outPath} 에 저장되었습니다.`)
    return
  }

  throw new Error(`알 수 없는 명령어: ${cmd}`)
}

main().catch(err => {
  console.error(`[오류] ${err.message}`)
  process.exit(1)
})
