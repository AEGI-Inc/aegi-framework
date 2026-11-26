import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ProviderLogo from '../ProviderLogo'
import type { ProviderId } from '../providerOverviewData'
import { shouldCollapseCode } from './collapse'

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } }

/** 답변에 SaaS 이름이 나오면 앞에 로고를 붙인다. 대소문자까지 맞을 때만(okta-user-sync 같은 이름 속 글자는 건드리지 않는다), 같은 SaaS 는 처음 한 번만 */
const SAAS_NAMES: Record<string, ProviderId> = { GitHub: 'github', Okta: 'okta', Slack: 'slack', 'Google Workspace': 'google-workspace', Atlassian: 'atlassian', Salesforce: 'salesforce' }
const SAAS_PATTERN = /(?<![\w-])(Google Workspace|GitHub|Okta|Slack|Atlassian|Salesforce)(?![\w-])/g

function saasPlugin() {
  return (tree: MarkdownNode) => {
    // 같은 SaaS 는 한 덩어리에서 처음 나올 때만 로고를 붙인다. 이름마다 붙이면 아이콘이 글보다 많아진다
    const seen = new Set<string>()
    const walk = (node: MarkdownNode) => {
      if (!node.children || ['link', 'code', 'inlineCode', 'image', 'html'].includes(node.type)) return
      // 표 머리는 짙은 바탕이라 검은 로고가 보이지 않는다. 머리 줄은 건너뛴다
      if (node.type === 'table') { node.children.slice(1).forEach(walk); return }
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { walk(child); return [child] }
        const pieces: MarkdownNode[] = []; let offset = 0
        for (const match of child.value.matchAll(SAAS_PATTERN)) {
          if (seen.has(match[1])) continue
          seen.add(match[1])
          pieces.push({ type: 'text', value: child.value.slice(offset, match.index) })
          pieces.push({ type: 'saas', data: { hName: 'span', hProperties: { className: ['assistant-saas'], dataProvider: SAAS_NAMES[match[1]] } }, children: [{ type: 'text', value: match[1] }] })
          offset = match.index! + match[0].length
        }
        if (!offset) return [child]
        pieces.push({ type: 'text', value: child.value.slice(offset) }); return pieces
      })
    }
    walk(tree)
  }
}


function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node) && (node.props as { children?: React.ReactNode })?.children) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const rawText = extractText(children)
  const collapsible = shouldCollapseCode(rawText)
  const [expanded, setExpanded] = React.useState(false)

  if (!collapsible) {
    return <pre>{children}</pre>
  }

  return (
    <div className="assistant-code-block">
      <div className="assistant-code-block-head">
        <button
          type="button"
          className="assistant-code-toggle"
          title={expanded ? '코드 접기' : '코드 전체 보기'}
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? '코드 접기' : '코드 펼치기'}
        </button>
      </div>
      <pre className={expanded ? undefined : 'is-collapsed'}>{children}</pre>
    </div>
  )
}

/** Turn verified citations into links in text nodes only, never in code or existing links. */
function citationPlugin(ids: Set<string>, numbers?: ReadonlyMap<string, number>) {
  return () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (!node.children || ['link', 'code', 'inlineCode', 'image', 'html'].includes(node.type)) return
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value) { walk(child); return [child] }
        const pieces: MarkdownNode[] = []; let offset = 0
        // 쉼표는 같은 괄호 안 번호 사이와, 빈칸만 두고 붙은 괄호 사이에만 넣는다. 떨어진 인용 사이에는 넣지 않는다
        const separator = (): MarkdownNode => ({ type: 'citationSeparator', data: { hName: 'sup', hProperties: { className: ['assistant-citation-sep'] } }, children: [{ type: 'text', value: ',' }] })
        for (const match of child.value.matchAll(/\[[^\]\n]*T\d+-E\d+[^\]\n]*\]/g)) {
          const cited = match[0].match(/T\d+-E\d+/g) ?? []
          if (!cited.length || cited.some(id => !ids.has(id))) continue
          const gap = child.value.slice(offset, match.index)
          if (offset && !gap.trim()) pieces.push(separator())
          else pieces.push({ type: 'text', value: gap })
          cited.forEach((id, i) => {
            if (i) pieces.push(separator())
            pieces.push({ type: 'link', url: `#aegi-evidence-${id}`, children: [{ type: 'text', value: String(numbers?.get(id) ?? id) }] })
          })
          offset = match.index! + match[0].length
        }
        if (!offset) return [child]
        pieces.push({ type: 'text', value: child.value.slice(offset) }); return pieces
      })
    }
    walk(tree)
  }
}

export default function AssistantMarkdown({ text, evidenceIds = [], onCitation, disabled = false, numbers, lead = false }: {
  text: string; evidenceIds?: readonly string[]; onCitation?: (id: string) => void; disabled?: boolean
  /** 인용을 번호로 보일 때 번호표. 없으면 T1-E1 같은 번호 그대로 보인다 */
  numbers?: ReadonlyMap<string, number>
  /** 굵은 결론 한 줄. 본문보다 크게 보인다 */
  lead?: boolean
}) {
  const citations = React.useMemo(() => citationPlugin(new Set(evidenceIds), numbers), [evidenceIds, numbers])
  return <div className={`assistant-answer assistant-markdown${lead ? ' assistant-lead' : ''}`}><Markdown skipHtml remarkPlugins={[[remarkGfm, { singleTilde: false }], citations, saasPlugin]}
    components={{
      // 답변에는 취소선을 쓰지 않는다. 「10-23~11-02」 같은 기간의 물결표가 취소선으로 바뀌어 글이 깨졌다. ~~ 로 감싼 글도 그대로 보인다
      del: ({ children }) => <>{children}</>,
      a: ({ href, children }) => {
        const id = href?.match(/^#aegi-evidence-(T\d+-E\d+)$/)?.[1]
        if (id && evidenceIds.includes(id)) return <button type="button" className="assistant-citation" data-citation={id} disabled={disabled}
          title={`근거 ${numbers?.get(id) ?? id} 보기`} aria-label={`근거 ${numbers?.get(id) ?? id} 보기`} onClick={() => onCitation?.(id)}>{children}</button>
        if (!href || !/^(https?:\/\/|mailto:|#)/i.test(href)) return <span>{children}</span>
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      },
      span: ({ node: _node, children, ...props }) => {
        const provider = (props as Record<string, unknown>)['data-provider'] as ProviderId | undefined
        if (!provider) return <span {...props}>{children}</span>
        return <span className="assistant-saas"><ProviderLogo provider={provider} />{children}</span>
      },
      // 확인하지 못한 것은 맨 끝 한 줄로 모은다(프롬프트 규칙). 본문과 선으로 가른다
      p: ({ node: _node, children }) => <p className={/^\s*확인 못 함/.test(extractText(children)) ? 'assistant-limit' : undefined}>{children}</p>,
      img: () => null,
      table: ({ children }) => <div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="답변 표"><table>{children}</table></div>,
      pre: CodeBlock,
    }}>{text}</Markdown></div>
}
