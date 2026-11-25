import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import ProviderLogo from '../ProviderLogo'
import { providerLogoId } from '../findings/providers'
import type { Provider } from '../model/object'
import type { PersonAccessRow } from './personAccess'
import { personAccessCsv } from './personAccess'
import './personAccess.css'

/* 사람 한 명의 접근 가능 리소스를 SaaS별 표로 보이는 창. 검색 결과의 사람 줄에서 연다 */
export default function PersonAccessDialog({ name, rows, onClose }: {
  name: string
  rows: PersonAccessRow[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const bySaas = useMemo(() => {
    const groups = new Map<string, PersonAccessRow[]>()
    for (const row of rows) groups.set(row.providerLabel, [...(groups.get(row.providerLabel) ?? []), row])
    return [...groups.entries()]
  }, [rows])

  useEffect(() => { closeRef.current?.focus() }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(personAccessCsv(rows))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 클립보드를 막아 둔 브라우저는 아무 일도 없던 것처럼 둔다
    }
  }

  return (
    <div className="ex-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section
        className="ex-dialog pa-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pa-dialog-title"
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.preventDefault()
          onClose()
        }}
      >
        <header className="pa-head">
          <h2 id="pa-dialog-title">{name} 접근 가능 리소스 <b>{rows.length}</b></h2>
          <button type="button" className="pa-copy" onClick={copy} disabled={!rows.length}>{copied ? '복사됨' : 'CSV로 복사'}</button>
          <button type="button" ref={closeRef} className="pa-close" aria-label="닫기" title="닫기, Esc" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="pa-body">
          {!rows.length && <p className="pa-empty">수집한 권한 관계와 계산한 접근이 없습니다.</p>}
          {bySaas.map(([saas, group]) => (
            <section key={saas} className="pa-saas">
              <h3>
                {group[0].provider && <ProviderLogo provider={providerLogoId(group[0].provider as Provider)} />}
                {saas || '알 수 없는 SaaS'} <b>{group.length}</b>
              </h3>
              <table className="pa-table">
                <thead>
                  <tr><th scope="col">리소스</th><th scope="col">유효 권한</th><th scope="col">경유</th><th scope="col">근거</th><th scope="col">계정</th></tr>
                </thead>
                <tbody>
                  {group.map((row, index) => (
                    <tr key={`${row.resourceKey}|${row.grant}|${row.account}|${index}`}>
                      <td><b>{row.resource}</b>{row.resourceType && <span>{row.resourceType}</span>}</td>
                      <td>{row.grant}</td>
                      <td>{row.via}</td>
                      <td>{row.basis}</td>
                      <td>{row.account}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
