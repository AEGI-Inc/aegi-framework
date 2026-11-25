// 전체 파이프라인을 정해진 순서로 실행한다. 하나라도 실패하면 멈춘다.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { ROOT } from './lib.mjs'
const steps = ['bridge', 'regenerate-same-entity', 'identity-pilot', 'observed-ir', 'orphan-observation', 'orphan-triage', 'duplicate-dispositions', 'graph-orphans', 'object-decisions-full', 'relation-bindings-full', 'verify']
for (const s of steps) { process.stdout.write(`${s} ... `); execFileSync('node', [path.join(ROOT, 'scripts', `${s}.mjs`)], { stdio: ['ignore', 'ignore', 'inherit'] }); console.log('ok') }
