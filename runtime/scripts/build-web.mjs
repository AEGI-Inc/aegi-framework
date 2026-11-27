// runtime/dashboard 소스로 미리 빌드한 화면(runtime/web)을 다시 만든다. 화면을 고쳤으면 같은 커밋에 web/ 도 넣는다.
//
//   npm run web:build
//
// 로컬 설치판 빌드다: VITE_AEGI_LOCAL=on(로컬 서버가 있어야 하는 기능: Splunk, AI 설정 카드, 위협 다시 확인, 빈 데이터셋, 샘플, 수집 실행)과
// VITE_AEGI_COLLECTOR_STATUS=on(Adapters 수집 자격증명 상태)을 켠다. 공개 데모용 VITE_AEGI_DEMO, VITE_AEGI_PUBLIC_DEMO 는 켜지 않는다.
// 이 값 없이 빌드하면 화면이 팀 비밀번호 로그인 화면으로 막힌다. 같은 소스와 같은 lockfile 이면 같은 파일이 나온다.
import path from 'node:path'
import { build } from 'vite'

const ROOT = path.resolve(import.meta.dirname, '..')
process.env.VITE_AEGI_LOCAL = 'on'
process.env.VITE_AEGI_COLLECTOR_STATUS = 'on'
for (const k of ['VITE_AEGI_DEMO', 'VITE_AEGI_PUBLIC_DEMO']) delete process.env[k]

await build({
  root: path.join(ROOT, 'dashboard'),
  configFile: path.join(ROOT, 'dashboard', 'vite.config.ts'),
  build: { outDir: path.join(ROOT, 'web'), emptyOutDir: true },
  logLevel: 'warn',
})
console.log(`web 빌드 완료: ${path.join(ROOT, 'web')}`)
