import { nodeStandardFindings, type NodeFinding } from './nodeFindingsIndex'
import { useStandardResults } from './standardResultsStore'
import './configFindings.css'

/** 개별 객체 상세에 「이 노드에 걸린 기준별 설정 finding」. standard_results 문서가 없으면 아무것도 렌더링하지 않는다 */
const STATUS_LABEL: Record<string, string> = { fail: '위반', pass: '충족', unknown: '판정 불가', not_collected: '미수집', org_policy: '조직 정책 필요', manual: '사람 검토' }

export default function NodeStandardFindings({ nodeKey, Block }: { nodeKey: string; Block: React.ComponentType<{ title: React.ReactNode; children: React.ReactNode }> }) {
  if (!useStandardResults()) return null
  const items = nodeStandardFindings(nodeKey)
  if (items.length === 0) return null
  const failCount = items.filter(i => i.status === 'fail').length

  return (
    <Block title={<>설정 기준 위반 {failCount > 0 && <b className="szi-nsf-count">{failCount}</b>}</>}>
      <ul className="szi-nsf-list">
        {items.map((i: NodeFinding) => (
          <li key={`${i.findingId}:${i.standard}:${i.item_id}`}>
            <span className={`cfg-status is-${i.status}`}>{STATUS_LABEL[i.status] ?? i.status}</span>
            <span className="szi-nsf-text">{i.text}</span>
            <span className="szi-nsf-std">{i.standard} {i.item_id}</span>
          </li>
        ))}
      </ul>
    </Block>
  )
}
