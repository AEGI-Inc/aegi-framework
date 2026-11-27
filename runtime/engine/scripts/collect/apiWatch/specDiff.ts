/**
 * 기준선 표면과 최신 표면 비교 (순수 함수).
 */
import type { Impact } from './impact'
import type { SourceSurface } from './surface'

export type SpecSeverity = 'break' | 'soon' | 'added' | 'info'

export interface SpecDiffItem {
  severity: SpecSeverity
  kind: string
  source: string
  op: string
  field?: string
  previous?: string
  current?: string
  note?: string
  impact?: Impact
}

const SEVERITY_ORDER: Record<SpecSeverity, number> = { break: 0, soon: 1, added: 2, info: 3 }

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function diffSurface(baseline: SourceSurface, latest: SourceSurface): SpecDiffItem[] {
  const items: SpecDiffItem[] = []
  const source = baseline.source || latest.source

  if (baseline.version && latest.version && baseline.version !== latest.version) {
    items.push({
      severity: 'info',
      kind: 'version_changed',
      source,
      op: '',
      previous: baseline.version,
      current: latest.version,
    })
  }
  if (baseline.revision && latest.revision && baseline.revision !== latest.revision) {
    items.push({
      severity: 'info',
      kind: 'revision_changed',
      source,
      op: '',
      previous: baseline.revision,
      current: latest.revision,
    })
  }

  for (const [opId, bOp] of Object.entries(baseline.ops)) {
    const lOp = latest.ops[opId]
    if (!lOp) {
      items.push({ severity: 'break', kind: 'operation_removed', source, op: opId })
      continue
    }

    if (bOp.method !== lOp.method || bOp.path !== lOp.path) {
      items.push({
        severity: 'break',
        kind: 'method_or_path_changed',
        source,
        op: opId,
        previous: `${bOp.method} ${bOp.path}`,
        current: `${lOp.method} ${lOp.path}`,
      })
    }

    if (!bOp.deprecated && lOp.deprecated) {
      items.push({ severity: 'soon', kind: 'operation_deprecated', source, op: opId })
    }

    for (const [pName, bParam] of Object.entries(bOp.params)) {
      const lParam = lOp.params[pName]
      if (!lParam) {
        items.push({ severity: 'break', kind: 'param_removed', source, op: opId, field: pName })
      } else if (!bParam.required && lParam.required) {
        items.push({ severity: 'break', kind: 'param_became_required', source, op: opId, field: pName })
      }
    }

    for (const [pName, lParam] of Object.entries(lOp.params)) {
      if (!(pName in bOp.params)) {
        items.push({
          severity: lParam.required ? 'break' : 'added',
          kind: lParam.required ? 'param_became_required' : 'param_added',
          source,
          op: opId,
          field: pName,
        })
      }
    }

    for (const [fPath, bField] of Object.entries(bOp.response)) {
      const lField = lOp.response[fPath]
      if (!lField) {
        items.push({ severity: 'break', kind: 'response_field_removed', source, op: opId, field: fPath })
        continue
      }
      if (bField.type !== lField.type) {
        items.push({
          severity: 'break',
          kind: 'response_field_type_changed',
          source,
          op: opId,
          field: fPath,
          previous: bField.type,
          current: lField.type,
        })
      }
      if (!bField.deprecated && lField.deprecated) {
        items.push({ severity: 'soon', kind: 'response_field_deprecated', source, op: opId, field: fPath })
      }
    }

    for (const fPath of Object.keys(lOp.response)) {
      if (!(fPath in bOp.response)) {
        items.push({ severity: 'added', kind: 'response_field_added', source, op: opId, field: fPath })
      }
    }

    const bErrors = new Set(bOp.errors ?? [])
    for (const errCode of lOp.errors ?? []) {
      if (!bErrors.has(errCode)) {
        items.push({ severity: 'info', kind: 'error_code_added', source, op: opId, field: errCode })
      }
    }

    const bNotes = new Set(bOp.notes ?? [])
    const lNotes = new Set(lOp.notes ?? [])
    for (const note of lNotes) {
      if (!bNotes.has(note)) {
        items.push({ severity: 'soon', kind: 'doc_notice_added', source, op: opId, current: note.slice(0, 200) })
      }
    }
    for (const note of bNotes) {
      if (!lNotes.has(note)) {
        items.push({ severity: 'soon', kind: 'doc_notice_removed', source, op: opId, previous: note.slice(0, 200) })
      }
    }
  }

  items.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
    compareText(a.source, b.source) ||
    compareText(a.op, b.op) ||
    compareText(a.kind, b.kind) ||
    compareText(a.field ?? '', b.field ?? '') ||
    compareText(a.current ?? '', b.current ?? '') ||
    compareText(a.previous ?? '', b.previous ?? ''),
  )

  return items
}
