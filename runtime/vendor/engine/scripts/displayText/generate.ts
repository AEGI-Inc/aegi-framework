/**
 * 비어 있는 설명을 AI 로 만든다. 항목마다 두 번 부른다.
 *  1. 초안: prompts/<종류>.md 와 입력
 *  2. 윤문: prompts/polish.md 와 초안(같은 출력 형식). 검사에 걸리면 걸린 내용을 붙여 윤문을 한 번 더 한다
 * 검사(validate.ts)를 통과한 것만 캐시에 넣는다. 정본(display-text/)은 바꾸지 않는다.
 */
import { buildGraphStoreV2 } from '../../src/data/datasetStore.ts'
import type { DisplayTextDocument, ProviderText } from '../../src/model/displayText.ts'
import type { DatasetFiles } from '../loader/engine.ts'
import { cacheKey, loadFormat, loadPrompt, promptVersion, type Cache, type Canonical, type DraftKind } from './files.ts'
import { providerInput, typeInput, type ProviderInput, type TypeInput } from './inputs.ts'
import type { ModelClient } from './model.ts'
import { validateProvider, validateType } from './validate.ts'

export interface PlanItem<I> { kind: DraftKind; subject: string; input: I }

export interface Plan {
  types: PlanItem<TypeInput>[]
  providers: PlanItem<ProviderInput>[]
}

/** 데이터셋에서 비어 있는 것을 찾는다 */
export function planMissing(files: DatasetFiles, doc: DisplayTextDocument, canonical: Canonical): Plan {
  const graph = buildGraphStoreV2(files.objects, files.relations, files.links)
  const saas = (p: string) => canonical.providers[p]?.name ?? p
  const types = doc.missing.types.map(subject => ({ kind: 'type' as const, subject, input: typeInput(subject, saas(subject.slice(0, subject.indexOf(':'))), files.objects, graph) }))
  const providers = doc.missing.providers.map(subject => ({ kind: 'provider' as const, subject, input: providerInput(subject, saas(subject), files.objects) }))
  return { types, providers }
}

const block = (label: string, v: unknown) => `${label}\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``

async function draftAndPolish<T>(client: ModelClient, kind: DraftKind, input: unknown, check: (v: T) => string[], dir?: string): Promise<{ value: T; problems: string[] }> {
  const schema = loadFormat(kind, dir)
  const draft = await client.complete({ name: `${kind}-draft`, system: loadPrompt(kind, dir), user: `${block('입력', input)}\n출력 형식에 맞는 JSON 하나만 돌려준다.`, schema })
  const polish = (v: unknown, problems: string[]) => client.complete({
    name: `${kind}-polish`, system: loadPrompt('polish', dir), schema,
    user: [block('참고 입력(사실은 여기서만 가져온다)', input), block('초안', v),
      ...(problems.length ? [`이전 결과의 문제. 모두 고친다:\n${problems.map(p => `- ${p}`).join('\n')}`] : []),
      '같은 형식의 JSON 하나만 돌려준다.'].join('\n\n'),
  }) as Promise<T>
  let value = await polish(draft, [])
  let problems = check(value)
  if (problems.length) {
    value = await polish(value, problems)
    problems = check(value)
  }
  return { value, problems }
}

export interface GenerateResult {
  added: string[]
  failed: Array<{ subject: string; problems: string[] }>
  /** 한도를 넘어 이번에 부르지 않은 항목 */
  deferred: string[]
}

export async function generateMissing(plan: Plan, cache: Cache, client: ModelClient, opts: { limit: number; now?: () => string; dir?: string; log?: (line: string) => void }): Promise<GenerateResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const log = opts.log ?? (() => {})
  const items: PlanItem<unknown>[] = [...plan.providers, ...plan.types]
  const result: GenerateResult = { added: [], failed: [], deferred: items.slice(opts.limit).map(i => i.subject) }
  for (const item of items.slice(0, opts.limit)) {
    const version = promptVersion(item.kind, opts.dir)
    const key = cacheKey(item.kind, item.input, version)
    if (cache[key]) continue
    try {
      let value: unknown
      let problems: string[]
      if (item.kind === 'type') ({ value, problems } = await draftAndPolish<{ meaning: string }>(client, 'type', item.input, validateType, opts.dir))
      else ({ value, problems } = await draftAndPolish<ProviderText & { name: string; role: string; points: string[] }>(client, 'provider', item.input, v => validateProvider(v, item.input as ProviderInput), opts.dir))
      if (problems.length) {
        result.failed.push({ subject: item.subject, problems })
        log(`실패 ${item.subject}: ${problems.join('; ')}`)
        continue
      }
      cache[key] = { kind: item.kind, subject: item.subject, model: client.model, prompt_version: version, generated_at: now(), value: value as never }
      result.added.push(item.subject)
      log(`만듦 ${item.subject}`)
    } catch (err) {
      result.failed.push({ subject: item.subject, problems: [err instanceof Error ? err.message : String(err)] })
      log(`실패 ${item.subject}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return result
}
