import fs from 'fs'
import path from 'path'
import { decrypt, encrypt } from './crypto.ts'
import { getVaultSecret, listVaultSecretKeys, putVaultSecret } from './kv.ts'
import { fingerprint, listLocal, loadLocal, LOCAL_DIR, masterKey, saveLocal } from './local.ts'

const HELP = `
[AEGI 로컬 암호화 저장소]  저장 위치: ${LOCAL_DIR}
  npm run secret:local -- list                          로컬에 있는 이름과 갱신 시각
  npm run secret:local -- pull <key>... | --all         KV 값을 암호문 그대로 로컬에 저장 (풀어서 지문만 확인)
  npm run secret:local -- push <key>... [--overwrite]   로컬 암호문을 그대로 KV 에 올린다 (KV 에 있으면 --overwrite 없이는 멈춘다)
  npm run secret:local -- set <key>                     표준입력 값을 암호화해 저장 (명령 기록에 값이 남지 않게)
  npm run secret:local -- set-file <key> <filePath>     파일 내용을 암호화해 저장
  npm run secret:local -- check <key>...                풀어서 지문(SHA-256 앞 12자)만 출력
  npm run secret:local -- export-file <key> <outPath>   풀어서 평문 파일로 내보낸다
`

const readStdin = async () => {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]
  const names = args.slice(1).filter(a => !a.startsWith('--'))

  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return }

  if (cmd === 'list') {
    const items = listLocal()
    if (!items.length) { console.log('로컬에 저장된 값이 없습니다.'); return }
    for (const i of items) console.log(`  - ${i.name}  ${i.updatedAt}`)
    console.log(`총 ${items.length}건`)
    return
  }

  if (cmd === 'pull') {
    const keys = args.includes('--all') ? (await listVaultSecretKeys()).filter(k => !k.startsWith('test/')) : names
    if (!keys.length) throw new Error('사용법: npm run secret:local -- pull <key>... | --all')
    let key: Buffer | null = null
    try { key = masterKey() } catch { console.warn('[경고] 마스터 키가 없어 풀어 보는 확인은 건너뛴다') }
    for (const k of keys) {
      const payload = await getVaultSecret(k)
      if (!payload) throw new Error(`KV 에 없는 키: ${k}`)
      const check = key ? `지문 ${fingerprint(decrypt(payload, key))}` : '확인 안 함'
      saveLocal(k, payload)
      console.log(`가져옴: ${k}  ${check}`)
    }
    console.log(`성공: ${keys.length}건을 암호문 그대로 ${LOCAL_DIR} 에 저장했습니다.`)
    return
  }

  if (cmd === 'push') {
    if (!names.length) throw new Error('사용법: npm run secret:local -- push <key>... [--overwrite]')
    const payloads = names.map(k => {
      const p = loadLocal(k)
      if (!p) throw new Error(`로컬에 없는 키: ${k}`)
      return [k, p] as const
    })
    if (!args.includes('--overwrite')) {
      const existing = new Set(await listVaultSecretKeys())
      const clash = names.filter(k => existing.has(k))
      if (clash.length) throw new Error(`KV 에 이미 있다: ${clash.join(', ')}. 덮어쓰려면 --overwrite. 아무것도 올리지 않았습니다`)
    }
    for (const [k, p] of payloads) { await putVaultSecret(k, p); console.log(`올림: ${k}`) }
    return
  }

  const key = masterKey()

  if (cmd === 'set' || cmd === 'set-file') {
    const k = names[0]
    const value = cmd === 'set' ? await readStdin() : (names[1] && fs.existsSync(names[1]) ? fs.readFileSync(path.resolve(names[1]), 'utf8') : null)
    if (!k || value === null || value === '') throw new Error(`사용법: npm run secret:local -- ${cmd === 'set' ? 'set <key>  (값은 표준입력)' : 'set-file <key> <filePath>'}`)
    saveLocal(k, encrypt(value, key))
    console.log(`저장됨: ${k}  지문 ${fingerprint(value)}`)
    return
  }

  if (cmd === 'check') {
    if (!names.length) throw new Error('사용법: npm run secret:local -- check <key>...')
    for (const k of names) {
      const p = loadLocal(k)
      console.log(p ? `${k}  지문 ${fingerprint(decrypt(p, key))}` : `${k}  로컬에 없음`)
    }
    return
  }

  if (cmd === 'export-file') {
    const [k, out] = names
    const p = k ? loadLocal(k) : null
    if (!p || !out) throw new Error('사용법: npm run secret:local -- export-file <key> <outPath> (로컬에 있는 키)')
    const outPath = path.resolve(out)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, decrypt(p, key), 'utf8')
    console.log(`성공: [${k}] 를 풀어 ${outPath} 에 저장했습니다 (평문).`)
    return
  }

  throw new Error(`알 수 없는 명령어: ${cmd}`)
}

main().catch(err => {
  console.error(`[오류] ${err.message}`)
  process.exit(1)
})
