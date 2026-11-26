import { CircleHelp } from 'lucide-react'
import type { CredentialGuide } from './credentialGuides'

/** 입력 칸 제목 옆 안내 단추. SaaS 연결 창(SaasConnect)과 데모 Splunk, AI 카드(DemoSettingsCards)가 같이 쓴다 */
export function GuideHelpButton({ guide, label, open, onToggle }: { guide?: CredentialGuide; label: string; open: boolean; onToggle: () => void }) {
  if (!guide) return null
  return (
    <button
      type="button"
      className="sc-help"
      title={guide.summary}
      aria-label={`${label} 발급 방법`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <CircleHelp size={14} aria-hidden="true" />
    </button>
  )
}

/** 안내 단추를 누르면 칸 아래에 펼치는 안내 */
export function GuidePanel({ guide, label }: { guide?: CredentialGuide; label: string }) {
  if (!guide) return null
  return (
    <div className="sc-guide" role="region" aria-label={`${label} 발급 안내`}>
      <p>{guide.summary}</p>
      <ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      {guide.notes && <ul>{guide.notes.map(note => <li key={note}>{note}</li>)}</ul>}
      {guide.sources.length > 0 && (
        <p className="sc-guide-src">
          공식 문서:{' '}
          {guide.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && ', '}
              <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
