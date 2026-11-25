import fs from 'node:fs'
import path from 'node:path'

const ENGINE = path.resolve(import.meta.dirname, '../../../..')
export function parseOptions(args) {
  if (args.includes('--help')) {
    console.log('npm run normalize -- --raw <collection> --run <collection-run> --out <dataset> [--model <IM-v3.2>] [--overlays <directory>] [--without <provider[:call],...>] [--check] [--strict]')
    console.log('  --without 그 SaaS(또는 그 호출)의 원본을 읽지 않는다. 그 SaaS 가 없는 회사를 재 보는 시험용(예: okta). 원본은 그대로 둔다')
    console.log('  --strict  Profile 하나의 식별 실패가 많으면 멈춘다(개발, 시험용). 환경 변수 AEGI_NORMALIZE_STRICT=1 도 같다. 없으면 경고로 남기고 계속한다')
    return null
  }
  const values = {}, flags = new Set(['--check', '--strict'])
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (!['--raw', '--run', '--out', '--model', '--overlays', '--without', ...flags].includes(name)) throw new Error(`Unknown option: ${name}. Use --help`)
    if (name in values) throw new Error(`Duplicate option: ${name}`)
    if (flags.has(name)) values[name] = true
    else {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value: ${name}`)
      values[name] = args[++i]
    }
  }
  for (const name of ['--raw', '--run', '--out']) if (!values[name]) throw new Error(`Required option: ${name}. Use --help`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values['--run'])) throw new Error('Invalid collection run ID')
  const options = {
    raw: path.resolve(values['--raw']), run: values['--run'], out: path.resolve(values['--out']),
    model: path.resolve(values['--model'] ?? process.env.IM_MODEL_DIR ?? path.join(ENGINE, '../aegi-knowledge/schema/im-model/model/v3.2')),
    overlays: path.resolve(values['--overlays'] ?? path.join(import.meta.dirname, '../overlays')),
    without: String(values['--without'] ?? '').split(',').map(x => x.trim()).filter(Boolean),
    check: Boolean(values['--check']),
    strict: Boolean(values['--strict']) || process.env.AEGI_NORMALIZE_STRICT === '1',
  }
  const within = (a, b) => { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) }
  // Resolve existing parents too, so a junction cannot redirect writes into inputs.
  const real = p => fs.existsSync(p) ? fs.realpathSync(p) : path.join(real(path.dirname(p)), path.basename(p))
  const out = real(options.out)
  for (const input of [options.raw, options.model, options.overlays, path.resolve(import.meta.dirname, '../profiles')]) {
    const source = real(input)
    if (within(source, out) || within(out, source)) throw new Error('Output must be separate from collection, model and Profiles')
  }
  if (fs.existsSync(options.out) && fs.readdirSync(options.out).length) {
    const manifest = path.join(options.out, 'manifest.json')
    if (!fs.existsSync(manifest) || JSON.parse(fs.readFileSync(manifest, 'utf8')).adapter !== 'im-profile-runner') throw new Error('Output must be empty or an existing IM Profile dataset; use a new --out directory')
  }
  return options
}
