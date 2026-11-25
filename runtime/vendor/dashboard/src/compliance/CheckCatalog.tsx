import { useMemo, useState } from 'react'
import type { StandardResults } from '../config-findings/standardResultsStore'
import rawLinks from './checkLinks.snapshot.json'
import { countOf, findingMatches, ResultBar, SAAS, type Match } from './complianceOverviewShared'
import { linkedFindings } from './controlStatus'
import { buildFramework, type Control, type FrameworkId } from './frameworkModel'

type CheckLinksSnapshot = {
  findings: Record<string, { saas: string; name: string }>
  items: Record<string, string[]>
}

const snapshot = rawLinks as CheckLinksSnapshot

type LinkedControl = {
  frameworkId: FrameworkId
  frameworkLabel: string
  control: Control
}

type CatalogFilter = 'all' | 'fail' | 'pass'

const FILTER_OPTIONS: { key: CatalogFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'fail', label: '위반' },
  { key: 'pass', label: '충족' },
]

const FRAMEWORK_ORDER: { id: FrameworkId; label: string }[] = [
  { id: 'isms-p', label: 'ISMS-P' },
  { id: 'iso27001', label: 'ISO 27001' },
  { id: 'pipa', label: 'PIPA' },
]

function buildFindingControlIndex(): Map<string, Record<FrameworkId, LinkedControl[]>> {
  const index = new Map<string, Record<FrameworkId, LinkedControl[]>>()
  for (const id of Object.keys(snapshot.findings)) {
    index.set(id, { 'isms-p': [], iso27001: [], pipa: [] })
  }
  for (const fwMeta of FRAMEWORK_ORDER) {
    const fw = buildFramework(fwMeta.id)
    for (const c of fw.controls) {
      const fids = new Set<string>()
      for (const r of c.requirements) {
        for (const fid of linkedFindings(r.key)) fids.add(fid)
      }
      for (const fid of fids) {
        let bucket = index.get(fid)
        if (!bucket) {
          bucket = { 'isms-p': [], iso27001: [], pipa: [] }
          index.set(fid, bucket)
        }
        bucket[fwMeta.id].push({ frameworkId: fwMeta.id, frameworkLabel: fwMeta.label, control: c })
      }
    }
  }
  return index
}

let cachedIndex: Map<string, Record<FrameworkId, LinkedControl[]>> | null = null
function findingControlIndex() {
  if (!cachedIndex) cachedIndex = buildFindingControlIndex()
  return cachedIndex
}

export function CheckCatalog({ results }: { results: StandardResults | undefined }) {
  const [query, setQuery] = useState('')
  const [saasFilter, setSaasFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<CatalogFilter>('all')

  const entries = useMemo(() => {
    const byId = new Map((results?.findings ?? []).map(f => [f.id, f]))
    const idx = findingControlIndex()
    return Object.entries(snapshot.findings).map(([id, def]) => {
      const f = byId.get(id)
      const ms: Match[] = f ? findingMatches(f) : []
      const counts = countOf(ms)
      const byFw = idx.get(id) ?? { 'isms-p': [], iso27001: [], pipa: [] }
      const links = [...byFw['isms-p'], ...byFw.iso27001, ...byFw.pipa]
      return {
        id,
        saas: def.saas,
        saasLabel: SAAS[def.saas] ?? def.saas,
        name: f?.text ?? def.name,
        inResults: Boolean(f && ms.length > 0),
        ms,
        counts,
        byFw,
        links,
      }
    }).filter(e => e.inResults)
  }, [results])

  const saasList = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) set.add(e.saas)
    return [...set]
  }, [entries])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return entries
      .filter(e => {
        if (saasFilter !== 'all' && e.saas !== saasFilter) return false
        if (statusFilter === 'fail' && e.counts.fail === 0) return false
        if (statusFilter === 'pass' && (!e.inResults || e.counts.fail > 0 || e.counts.pass === 0)) return false
        if (!q) return true
        const hay = [
          e.id,
          e.name,
          e.saasLabel,
          ...e.links.map(l => `${l.frameworkLabel} ${l.control.id} ${l.control.title}`),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => b.counts.fail - a.counts.fail || b.links.length - a.links.length || a.id.localeCompare(b.id))
  }, [entries, saasFilter, statusFilter, q])

  const groupedBySaas = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const e of filtered) {
      map.set(e.saas, [...(map.get(e.saas) ?? []), e])
    }
    return [...map.entries()].sort((a, b) => {
      const failA = a[1].reduce((s, x) => s + x.counts.fail, 0)
      const failB = b[1].reduce((s, x) => s + x.counts.fail, 0)
      return failB - failA || b[1].length - a[1].length
    })
  }, [filtered])

  return (
    <section className="comp-isms comp-catalog" aria-label="자동 검사 목록">
      <div className="comp-isms-head"><h2>자동 검사 목록</h2></div>
      <div className="comp-toolbar" role="search">
        <input
          type="search"
          className="comp-search"
          aria-label="자동 검사 검색"
          placeholder="검사 이름, ID, 연결 항목 검색"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select
          className="comp-select"
          aria-label="SaaS 선택"
          value={saasFilter}
          onChange={e => setSaasFilter(e.target.value)}
        >
          <option value="all">전체 SaaS</option>
          {saasList.map(s => (
            <option key={s} value={s}>{SAAS[s] ?? s}</option>
          ))}
        </select>
        <div className="comp-filter-group" role="group" aria-label="검사 상태 필터">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              className={`comp-filter-btn${statusFilter === opt.key ? ' is-selected' : ''}`}
              aria-pressed={statusFilter === opt.key}
              onClick={() => setStatusFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {groupedBySaas.length === 0 ? (
        <p className="comp-list-empty">조건에 맞는 자동 검사가 없습니다.</p>
      ) : (
        <div className="comp-list">
          {groupedBySaas.map(([saas, list]) => (
            <section key={saas}>
              <h4 className="comp-group-head">
                <span>{SAAS[saas] ?? saas}</span>
                <em>{list.length}개 검사</em>
              </h4>
              {list.map(e => (
                <details key={e.id} className="comp-saas">
                  <summary className="comp-catalog-row">
                    <span>
                      <strong>{e.name}</strong>
                      <small>{e.id}</small>
                    </span>
                    <span>{e.saasLabel}</span>
                    <span className="comp-row-result">
                      {e.inResults && e.counts.fail > 0 && <b className="is-fail">위반 {e.counts.fail}</b>}
                      <ResultBar ms={e.ms} size="sm" />
                    </span>
                    <span>
                      ISMS-P {e.byFw['isms-p'].length}, ISO 27001 {e.byFw.iso27001.length}, PIPA {e.byFw.pipa.length}
                    </span>
                  </summary>
                  <ul>
                    {e.links.map(l => {
                      const label =
                        l.control.id === l.control.title
                          ? `${l.frameworkLabel} ${l.control.title}`
                          : `${l.frameworkLabel} ${l.control.id} ${l.control.title}`
                      return (
                        <li key={`${l.frameworkId}:${l.control.group}:${l.control.id}`}>
                          <button
                            type="button"
                            className="cfg-link"
                            onClick={() => {
                              window.location.hash = `#compliance?framework=${l.frameworkId}&criterion=${l.control.id}`
                            }}
                          >
                            {label}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
