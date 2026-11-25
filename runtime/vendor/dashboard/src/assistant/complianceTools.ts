import { catalog } from '../compliance/catalog'
import mapping from '../config-findings/ismsMapping.snapshot.json'
import checkLinks from '../compliance/checkLinks.snapshot.json'
import { getStandardResults } from '../config-findings/standardResultsStore'
import { STATUS_LABEL } from '../config-findings/standardItem'
import { CHECK_STATUS_LABEL, checkFieldName, checkTargets, criteriaFor, describeBasis, describeCombine, describeReplaced, type CriterionCheck, describeCondition, describeSource, evaluateCheck, hasValue, parseCondition, upsertDraft } from '../compliance/customCriteria'
import { emptyKgResult, finishKgExecution, type KgContext, type KgExecution } from './kgTools'
import { parseToolArgs, type KgCall, type KgFact } from './chatProtocol'
import { objectLabel } from './lookup'
import { registeredGuidelines } from '../compliance/demoTour'
import { modelProperties, propertyAt } from './propertyRules'
import { remediationFor } from '../compliance/remediations'
import { formatSourceLabel, guidanceFor } from '../compliance/guidance'
import { buildFramework, type FrameworkId } from '../compliance/frameworkModel'
import { verdictFor, VERDICT_LABEL } from '../compliance/verdicts'

type Fact = Omit<KgFact, 'id'>
const show = (v: unknown) => v === null || v === undefined ? '없음' : typeof v === 'object' ? JSON.stringify(v) : String(v)
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 바꾸는 기존 점검의 지금 판정(선택한 판정 결과에서). 결과가 없으면 「결과 없음」 */
export function replacedStatus(r: NonNullable<CriterionCheck['replaces']>): string {
  const item = getStandardResults()?.findings.find(f => f.id === r.finding)?.items.find(i => i.standard === r.standard && i.item_id === r.item)
  return item ? STATUS_LABEL[item.status] : '결과 없음'
}

/** 기준 또는 확인사항 번호 정규화: 공백 무시, '제'/'조제' 처리, 'A.' 접두어 제거 */
export function normalizeComplianceId(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^제/, '')
    .replace(/조제?/g, '조')
    .replace(/^a\./, '')
}

/** 이 인증기준에 연결된 기존 공개 기준 점검 */
const linkedTo = (criterion: string) => mapping.links.filter(l => mapping.requirements.some(r => r.criterion === criterion && r.id === l.requirement))

/** 컴플라이언스 기준 또는 확인사항 하나: 원문, 판정 결과, 위반 설정 점검(대상/조치 요약), 이동 안내 */
export function complianceItem(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  const fw = ((args.framework as string) || 'isms-p').toLowerCase() as FrameworkId
  const itemQuery = String(args.item ?? args.criterion ?? '').trim()
  const objectKey = typeof args.object === 'string' ? args.object.trim() : ''
  const facts: Fact[] = []

  let fwObj
  try {
    fwObj = buildFramework(fw)
  } catch {
    facts.push({
      kind: 'reference',
      ref: `compliance:${fw}:${itemQuery}`,
      label: `${fw} ${itemQuery}`,
      state: 'unknown',
      detail: '유효한 컴플라이언스 프레임워크(isms-p, iso27001, pipa)를 지정하세요.',
    })
    return finishKgExecution(context, call.function.name, args, index, emptyKgResult(`${fw} 프레임워크를 찾을 수 없습니다.`), facts, false)
  }

  const normQuery = normalizeComplianceId(itemQuery)

  let control = fwObj.controls.find(c => normalizeComplianceId(c.id) === normQuery)
  let req = fwObj.controls.flatMap(c => c.requirements).find(r =>
    normalizeComplianceId(r.id) === normQuery ||
    normalizeComplianceId(r.key) === normQuery ||
    normalizeComplianceId(r.key).endsWith(`:${normQuery}`)
  )

  if (!control && req) {
    control = fwObj.controls.find(c => c.requirements.some(r => r.key === req!.key))
  }

  if (!control && !req) {
    facts.push({
      kind: 'reference',
      ref: `compliance:${fw}:${itemQuery}`,
      label: `${fwObj.label} ${itemQuery}`,
      state: 'unknown',
      detail: 'AEGI 분석 범위 밖이거나 없는 번호입니다. 번호를 확인하세요.',
    })
    return finishKgExecution(context, call.function.name, args, index, emptyKgResult(`${fwObj.label} ${itemQuery}를 찾지 못했습니다.`), facts, false)
  }

  const targetReqs = req ? [req] : (control?.requirements ?? [])
  const primaryReq = targetReqs[0]
  const controlId = control?.id ?? primaryReq.id
  const title = control?.title ?? primaryReq.text

  facts.push({
    kind: 'reference',
    ref: `compliance:${fw}:${controlId}`,
    label: `${fwObj.label} ${controlId} ${title}`,
    detail: `기준: ${control?.title ?? ''}\n확인사항: ${targetReqs.map(r => r.text).join('\n')}`,
    data: { framework: fw, id: controlId },
  })

  const results = getStandardResults()

  // 1. 연결된 기존 설정 점검(필드, 요구값) 사실
  if (fw === 'isms-p') {
    const linked = linkedTo(controlId)
    const seen = new Set(linked.map(l => l.finding))
    const lines = linked.map(l => `${l.finding} [${l.standard} ${l.item}] 필드 ${l.field} / 요구 ${l.condition || '없음'}`)
    facts.push({
      kind: 'reference',
      ref: `compliance:${controlId}:linked`,
      label: `${controlId}에 연결된 기존 설정 점검 ${seen.size}건`,
      detail: lines.length ? lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n외 ${lines.length - 40}건` : '') : '없음',
    })
  } else {
    const seenFids = new Set<string>()
    const lines: string[] = []
    const reqKeys = targetReqs.map(r => r.key)
    for (const rk of reqKeys) {
      const fids = (checkLinks.items as Record<string, string[]>)[rk] ?? []
      for (const fid of fids) {
        seenFids.add(fid)
        const fObj = results?.findings.find(f => f.id === fid)
        if (fObj && fObj.items.length > 0) {
          for (const item of fObj.items) {
            const field = item.rule?.field || '없음'
            const condition = item.rule?.condition || item.threshold || '없음'
            lines.push(`${fid} [${item.standard} ${item.item_id}] 필드 ${field} / 요구 ${condition}`)
          }
        } else {
          const checkInfo = (checkLinks.findings as Record<string, { saas: string; name: string }>)[fid]
          lines.push(`${fid} [${fw.toUpperCase()} ${controlId}] 필드 없음 / 요구 ${checkInfo?.name || '없음'}`)
        }
      }
    }
    facts.push({
      kind: 'reference',
      ref: `compliance:${controlId}:linked`,
      label: `${controlId}에 연결된 기존 설정 점검 ${seenFids.size}건`,
      detail: lines.length ? lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n외 ${lines.length - 40}건` : '') : '없음',
    })
  }

  // 2. 확인사항마다 판정과 위반 점검
  let totalFailFindings = 0
  let primaryVerdict: ReturnType<typeof verdictFor> | undefined
  for (const r of targetReqs) {
    const verdict = verdictFor(results, r.key)
    if (verdict) {
      if (!primaryVerdict) primaryVerdict = verdict
      const total = verdict.counts.pass + verdict.counts.fail + verdict.counts.unknown + verdict.counts.org_policy + verdict.counts.manual
      const person = verdict.counts.org_policy + verdict.counts.manual
      facts.push({
        kind: 'reference',
        ref: `compliance:${r.key}:verdict`,
        label: `${r.id} 판정 결과: ${VERDICT_LABEL[verdict.status]}`,
        state: verdict.status === 'fail' ? 'confirmed' : 'unknown',
        detail: `판정 ${total}건 중 위반 ${verdict.counts.fail}, 충족 ${verdict.counts.pass}, 판정 불가 ${verdict.counts.unknown}, 직접 확인 필요 ${person}`,
        data: { status: verdict.status, counts: verdict.counts },
      })

      totalFailFindings += verdict.fail_findings.length

      for (const fId of verdict.fail_findings) {
        const fObj = results?.findings.find(f => f.id === fId)
        const rem = remediationFor(fId)
        const failTargetsList: string[] = []
        if (fObj) {
          for (const item of fObj.items) {
            for (const t of item.targets) {
              if (t.status === 'fail' && (!objectKey || t.key === objectKey) && failTargetsList.length < 10) {
                failTargetsList.push(`${t.name}: 현재 값=${show(t.value)}, 기준값=${item.threshold}`)
              }
            }
          }
        }
        if (objectKey && failTargetsList.length === 0) continue

        const remLines = objectKey
          ? (rem
              ? [
                  `조치 상태: ${rem.review}`,
                  rem.summary ? `조치 요약: ${rem.summary}` : '',
                  rem.where ? `설정 위치: ${rem.where}` : '',
                  rem.change ? `변경 설정: ${rem.change.setting} -> 권장: ${rem.change.recommended}` : '',
                  rem.steps.length > 0 ? `조치 절차:\n${rem.steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}` : '',
                  rem.impact ? `영향 검토: ${rem.impact}` : '',
                  rem.verify ? `확인 방법: ${rem.verify}` : '',
                  rem.references?.length > 0
                    ? `참고 자료:\n${rem.references.map(ref => `- ${[ref.source, ref.item].filter(Boolean).join(' ')}${ref.url ? ` (${ref.url})` : ''}`).join('\n')}`
                    : '',
                ]
              : ['조치 카드: 없음'])
          : [
              rem?.summary ? `조치 요약: ${rem.summary}` : '',
              rem?.where ? `설정 위치: ${rem.where}` : '',
              rem?.change ? `변경 설정: ${rem.change.setting} -> 권장: ${rem.change.recommended}` : '',
            ]

        facts.push({
          kind: 'finding',
          ref: `finding:${fId}`,
          label: `위반 점검: ${fObj ? fObj.text : fId} (${fObj?.provider ?? ''})`,
          state: 'confirmed',
          detail: [
            `SaaS: ${fObj?.provider ?? ''}`,
            `위반 대상: ${failTargetsList.length ? failTargetsList.join('\n') : '없음'}`,
            ...remLines,
          ].filter(Boolean).join('\n'),
          data: { findingId: fId, provider: fObj?.provider, review: rem?.review },
        })
      }
    }

    const card = guidanceFor(r.key)
    if (card) {
      const reqSummary = card.requirement[0]?.text ? `요구사항 요약: ${card.requirement[0].text}` : ''
      const sourceLines = card.sources.length > 0
        ? `출처:\n${card.sources.map(s => `- ${formatSourceLabel(s)}`).join('\n')}`
        : ''
      facts.push({
        kind: 'reference',
        ref: `compliance:${r.key}:guidance`,
        label: `${r.id} 기준 근거`,
        detail: [reqSummary, sourceLines].filter(Boolean).join('\n'),
        data: {
          itemKey: r.key,
          sources: card.sources.map(s => ({ title: s.title, version: s.version, locator: s.locator })),
        },
      })
    }
  }

  if (fw === 'isms-p') {
    const ismsItem = catalog.find(i => i.standard === 'ISMS-P' && i.number === controlId)
    if (ismsItem) {
      for (const q of ismsItem.questions) {
        facts.push({
          kind: 'reference',
          ref: `compliance:${controlId}:${q.location}`,
          label: `${controlId} ${q.location}`,
          detail: `원문: ${q.sourceText}\nAEGI가 확인하는 범위: ${q.scope}\n범위 밖: ${q.outside}`,
        })
      }
    }
    const registered = registeredGuidelines().filter(g => g.criterion === controlId)
    if (registered.length > 0) {
      facts.push({
        kind: 'reference',
        ref: `compliance:${controlId}:guidelines`,
        label: `${controlId}에 등록된 가이드라인`,
        detail: registered.map(g => `${g.id}: ${g.title}\n${g.text}`).join('\n\n') + '\n받은 기준 문장이 이 문서면 guideline_criterion 을 부른다',
      })
    }
    const added = criteriaFor(controlId)
    if (added.length > 0) {
      facts.push({
        kind: 'reference',
        ref: `compliance:${controlId}:custom`,
        label: `${controlId}에 회사가 더한 기준`,
        detail: added.map(c => `${c.name} (${c.status === 'saved' ? '저장됨' : 'AI 초안'}, 검사 ${c.checks.length}개)`).join('\n'),
      })
    }
  }

  const result = emptyKgResult(`${fwObj.label} ${controlId} ${title}: 판정 ${primaryVerdict ? VERDICT_LABEL[primaryVerdict.status] : '없음'}, 위반 점검 ${totalFailFindings}건, 확인사항 ${targetReqs.length}개`)
  result.navigation = [{
    page: 'Compliance',
    label: `Compliance ${fwObj.label} ${controlId} 보기`,
    criterion: controlId,
  }]

  return finishKgExecution(context, call.function.name, args, index, result, facts, false)
}

/** 컴플라이언스 위반 점검 조치 계획 추천: 영향도(해결 확인사항 수와 위반 대상 수) 순서로 정렬 */
export function complianceRemediationPlan(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments)) ?? {}
  const fw = args.framework ? String(args.framework).toLowerCase() : undefined
  const item = args.item ? String(args.item).trim() : undefined
  const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10

  const results = getStandardResults()
  const fixes = results?.compliance?.fixes ?? []

  if (!fixes.length) {
    const facts: Fact[] = [{
      kind: 'reference',
      ref: 'remediation:none',
      label: '판정 결과 없음',
      state: 'unknown',
      detail: '해당 조건의 위반 설정 점검이 없거나 판정 결과가 없습니다.',
    }]
    return finishKgExecution(context, call.function.name, args, index, emptyKgResult('해당 조건의 위반 설정 점검이 없거나 판정 결과가 없습니다.'), facts, false)
  }

  const prefix = fw === 'isms-p' ? 'ISMS-P:' : fw === 'iso27001' ? 'ISO27001:' : fw === 'pipa' ? 'PIPA:' : undefined

  let filtered = fixes
  if (prefix) {
    filtered = filtered.filter(f => f.items.some(k => k.startsWith(prefix)))
  }

  if (item) {
    // 번호를 범위 안 기준 목록에서 확인사항 키로 바꾼다(PIPA 「제5조 제2항」 → PIPA:admin-...:article-5:p2)
    const normItem = normalizeComplianceId(item)
    const frameworks: FrameworkId[] = fw ? [fw as FrameworkId] : ['isms-p', 'iso27001', 'pipa']
    const keys = new Set<string>()
    for (const id of frameworks) {
      let model
      try { model = buildFramework(id) } catch { continue }
      for (const c of model.controls) {
        const whole = normalizeComplianceId(c.id) === normItem
        for (const r of c.requirements) if (whole || normalizeComplianceId(r.id) === normItem) keys.add(r.key)
      }
    }
    filtered = filtered.filter(f => f.items.some(k => keys.has(k)))
  }

  if (!filtered.length) {
    const facts: Fact[] = [{
      kind: 'reference',
      ref: 'remediation:none',
      label: '위반 점검 없음',
      state: 'unknown',
      detail: '해당 조건의 위반 설정 점검이 없거나 판정 결과가 없습니다.',
    }]
    return finishKgExecution(context, call.function.name, args, index, emptyKgResult('해당 조건의 위반 설정 점검이 없거나 판정 결과가 없습니다.'), facts, false)
  }

  const selected = filtered.slice(0, limit)
  const facts: Fact[] = []

  for (const fix of selected) {
    const fObj = results?.findings.find(f => f.id === fix.finding)
    const rem = remediationFor(fix.finding)
    const title = fObj ? fObj.text : fix.finding

    const failTargetNames: string[] = []
    if (fObj) {
      for (const it of fObj.items) {
        for (const t of it.targets) {
          if (t.status === 'fail' && !failTargetNames.includes(t.name) && failTargetNames.length < 5) {
            failTargetNames.push(t.name)
          }
        }
      }
    }

    const stepsText = rem?.steps?.length ? `조치 단계:\n${rem.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''
    const lackOfBasisNotice = rem?.review === '근거 부족' ? '조치 데이터 근거 부족: 공식 문서 확인 필요' : ''

    facts.push({
      kind: 'reference',
      ref: `remediation:${fix.finding}`,
      label: `${title} (점수: ${fix.score})`,
      state: 'confirmed',
      detail: [
        `점검 문장: ${title}`,
        rem?.summary ? `조치 요약: ${rem.summary}` : '',
        rem?.where ? `설정 위치: ${rem.where}` : '',
        rem?.change ? `권장값: ${rem.change.recommended}` : '',
        failTargetNames.length ? `위반 대상(최대 5개): ${failTargetNames.join(', ')}` : '',
        `해당 확인사항: ${fix.items.join(', ')}`,
        stepsText,
        rem?.verify ? `확인 방법: ${rem.verify}` : '',
        `검토 상태: ${rem?.review ?? '검토 전'}`,
        lackOfBasisNotice,
      ].filter(Boolean).join('\n'),
      data: { finding: fix.finding, score: fix.score, items: fix.items, fail_targets: fix.fail_targets },
    })
  }

  facts.push({
    kind: 'reference',
    ref: 'remediation:draft_notice',
    label: '조치 진행 기록 초안',
    state: 'inferred',
    detail: '조치 진행 기록 초안: 담당자, 기한은 사람이 정해 저장',
  })

  const summary = `${filtered.length}건의 위반 설정 점검 중 영향도 상위 ${selected.length}건의 조치 계획을 추천합니다.`
  const result = emptyKgResult(summary)
  if (fw) {
    result.navigation = [{
      page: 'Compliance',
      label: `Compliance ${fw.toUpperCase()} 보기`,
      criterion: item,
    }]
  }

  return finishKgExecution(context, call.function.name, args, index, result, facts, false)
}

type Added = { ok: true; summary: string; facts: Fact[]; keys: string[]; criterion: string } | { ok: false; summary: string; detail: string }
const no = (summary: string, detail: string): Added => ({ ok: false, summary, detail })
const refusedFact = (detail: string): Fact => ({ kind: 'reference', ref: 'custom_criterion:refused', label: '추가 기준 검사를 만들지 않음', state: 'unknown', detail })

/**
 * 새 기준 문장에 대한 설정 검사 하나를 만들고 현재 수집 설정으로 판정해 이 브라우저에 초안으로 둔다.
 * 검사 데이터와 필드는 실제 수집 객체에 있는 것만 받는다. 요구값은 기준 문장에 그 구절이 있을 때만 받는다.
 * custom_criterion(AI 가 인자를 짠다)과 guideline_criterion(등록된 가이드라인의 정해 둔 인자)이 같이 쓴다
 */
function addCheck(context: KgContext, args: Record<string, unknown>): Added {
  const criterion = String(args.criterion).trim(), provider = String(args.provider), type = String(args.type).trim()
  const sourceText = String(args.source_text).trim()
  const filter = (args.filter as string[] | undefined) ?? [], fields = args.fields as string[], condition = (args.condition as string[] | undefined) ?? []
  const quote = String(args.condition_quote ?? '').trim()
  if (!catalog.some(i => i.standard === 'ISMS-P' && i.number === criterion)) return no(`ISMS-P ${criterion}를 찾지 못했습니다.`, '분석 범위에 있는 인증기준 번호를 compliance_item 으로 먼저 확인하세요.')
  const ofType = [...context.graph.objectsByKey.values()].filter(o => o.canonical.provider === provider && o.canonical.object_type === type)
  if (!ofType.length) {
    const counts = new Map<string, number>()
    for (const o of context.graph.objectsByKey.values()) if (o.canonical.provider === provider) counts.set(o.canonical.object_type, (counts.get(o.canonical.object_type) ?? 0) + 1)
    return no(`${provider} ${type} 객체가 수집되지 않았습니다.`, `수집된 ${provider} 객체 종류: ${[...counts].map(([t, n]) => `${t} ${n}`).join(', ') || '없음'}. 이 중에 기준을 볼 데이터가 없으면 미수집으로 답하세요.`)
  }
  const targets = checkTargets(context.graph, { provider, type, filter })
  if (!targets.length) return no(`${provider} ${type} 중 filter 에 맞는 객체가 없습니다.`, `${type} ${ofType.length}개 중 [${filter.join(', ')}]에 맞는 것이 없습니다. filter 를 고치거나 빼세요.`)
  const names = new Set<string>()
  for (const o of targets.slice(0, 50)) for (const k of Object.keys(modelProperties(o.canonical.properties, 200).properties)) names.add(k)
  const absent = fields.filter(f => !checkFieldName(f) || !targets.some(o => hasValue(propertyAt(o.canonical.properties, f)) || names.has(f)))
  if (absent.length) return no(`수집 값이 없는 필드: ${absent.join(', ')}`, `대상 ${type}에 이 필드 값이 없습니다. 있는 필드: ${[...names].slice(0, 80).join(', ')}. 기준을 볼 필드가 여기에 없으면 미수집으로 답하세요.`)
  const outside = condition.map(parseCondition).filter(c => c && !fields.includes(c.path)).map(c => c!.path)
  if (outside.length) return no('요구값이 fields 밖의 필드를 봅니다.', `condition 의 필드(${outside.join(', ')})를 fields 에도 넣으세요.`)
  if (condition.length && !squash(sourceText).includes(squash(quote))) return no('요구값의 근거 구절이 기준 문장에 없습니다.',
    'condition_quote 는 source_text 에 그대로 있는 구절이어야 합니다. 기준 문장에 요구값이 없으면 condition 을 빼고 관측값만 보이세요.')
  let replaces: CriterionCheck['replaces']
  const replacedId = String(args.replaces_check ?? '').trim()
  if (replacedId) {
    const link = linkedTo(criterion).find(l => l.finding === replacedId && l.provider === provider)
    if (!link) return no(`${replacedId}는 ${criterion}에 연결된 ${provider} 점검이 아닙니다.`, `compliance_item 이 보여 준 ${criterion} 연결 점검 중 ${provider} 것을 고르거나 replaces_check 를 빼세요.`)
    replaces = { finding: link.finding, standard: link.standard, item: link.item, field: link.field, condition: link.condition }
  }

  const { criterion: draft, check } = upsertDraft({ standard: 'ISMS-P', criterion, name: String(args.name).trim(), sourceText, sourceTitle: String(args.source_title).trim() },
    { question: String(args.question).trim(), provider, type, filter, fields, condition, conditionJoin: args.condition_join === 'all' ? 'all' : 'any', conditionQuote: condition.length ? quote : '', ...(replaces ? { replaces } : {}),
      combine: args.combine === 'any_object' ? 'any_object' : 'every_object' })
  const r = evaluateCheck(context.graph, check)
  const facts: Fact[] = [{ kind: 'reference', ref: `criterion:${check.id}`, label: `${draft.name}: ${check.question}`, state: r.status === 'pass' || r.status === 'fail' ? 'confirmed' : 'unknown',
    detail: [`결과: ${CHECK_STATUS_LABEL[r.status]}`, `검사 데이터: ${describeSource(check)} (${r.targets.length}개)`, `필드: ${check.fields.join(', ')}`,
      ...(check.replaces ? [`바꾸는 기존 점검: ${describeReplaced(check.replaces)}, 현재 결과 ${replacedStatus(check.replaces)}`] : []),
      `요구값: ${describeCondition(check)}${describeBasis(check) ? `\n요구값 근거: ${describeBasis(check)}` : ''}`, `결합 방식: ${describeCombine(check)}`,
      `상태: AI 초안. 사람이 Compliance ${criterion} 화면에서 확인하고 저장해야 회사 기준이 됩니다.`].join('\n'),
    data: { status: r.status, targets: r.targets.length, passed: r.targets.filter(t => t.passed).length } }]
  const shown = [...r.targets].sort((a, b) => Number(a.passed) - Number(b.passed)).slice(0, 8)
  for (const t of shown) facts.push({ kind: 'object', ref: t.key, label: objectLabel(context.graph, t.key),
    detail: `${t.passed === null ? '관측' : t.passed ? '요구 충족' : '요구 위반'}\n${Object.entries(t.values).map(([k, v]) => `${k}: ${show(v)}`).join('\n')}` })
  return { ok: true, summary: `${draft.name} 검사 「${check.question}」: ${CHECK_STATUS_LABEL[r.status]} (대상 ${r.targets.length}개)`, facts, keys: shown.map(t => t.key), criterion }
}

function finishAdded(context: KgContext, call: KgCall, args: ReturnType<typeof parseToolArgs>, index: number, added: Added[]): KgExecution {
  const ok = added.filter((a): a is Extract<Added, { ok: true }> => a.ok), refused = added.filter((a): a is Extract<Added, { ok: false }> => !a.ok)
  const summary = [...ok.map(a => a.summary), ...refused.map(a => `만들지 않음: ${a.summary}`)].join('\n') + (ok.length ? '\nAI 초안으로 두었고 저장은 사람이 합니다.' : '')
  const result = emptyKgResult(summary)
  result.graph.objectKeys = [...new Set(ok.flatMap(a => a.keys))]
  if (ok.length) result.navigation = [{ page: 'Compliance', label: `Compliance ${ok[0].criterion}에서 확인하고 저장`, criterion: ok[0].criterion }]
  return finishKgExecution(context, call.function.name, args!, index, result, [...ok.flatMap(a => a.facts), ...refused.map(a => refusedFact(a.detail))], false)
}

/** AI 가 인자를 짠 검사 하나 */
export function customCriterion(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))!
  return finishAdded(context, call, args, index, [addCheck(context, args)])
}

/**
 * 등록된 가이드라인(src/compliance/demoTour.ts GUIDELINES)의 검사를 정해 둔 인자 그대로 붙인다.
 * AI 는 가이드라인 id 하나만 고르므로 언제 물어도 같은 검사가 나온다. 검증은 custom_criterion 과 같다
 */
export function guidelineCriterion(context: KgContext, call: KgCall, index: number): KgExecution {
  const args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments))
  if (!args) return finishAdded(context, call, args, index,
    [no('가이드라인 인자가 올바르지 않습니다.', 'criterion 과 등록된 guideline id를 확인해 다시 부르세요.')])
  const guideline = registeredGuidelines().find(g => g.id === args.guideline)
  if (!guideline) return finishAdded(context, call, args, index,
    [no('등록된 가이드라인이 없습니다.', '이 환경에는 등록된 가이드라인 문서가 없습니다. custom_criterion 으로 기준 문장을 검사하세요.')])
  if (String(args.criterion).trim() !== guideline.criterion) return finishAdded(context, call, args, index,
    [no(`${guideline.title}은 ISMS-P ${guideline.criterion}의 가이드라인입니다.`, `criterion 을 ${guideline.criterion}로 다시 부르세요.`)])
  return finishAdded(context, call, args, index, guideline.checks.map(check => addCheck(context, check)))
}
