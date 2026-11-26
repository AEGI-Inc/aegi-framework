import { useState, useEffect } from 'react'
import { ThinkingOrb, type OrbState, type OrbSize, type OrbTheme } from 'thinking-orbs'

export interface OrbOption {
  id: OrbState
  name: string
  nameKo: string
  desc: string
  details: string
}

export const ORB_OPTIONS: OrbOption[] = [
  {
    id: 'working',
    name: 'Working',
    nameKo: '궤도 입자 회전',
    desc: '기울어진 궤도를 도는 입자',
    details: '일반 궤도형 로딩 모션'
  },
  {
    id: 'searching',
    name: 'Searching',
    nameKo: '구체 자오선 스캔',
    desc: '점선 구체를 따라 일정한 속도로 도는 자오선',
    details: '지식 그래프, 보안 탐지, 검색, 조회 상태용'
  },
  {
    id: 'solving',
    name: 'Solving',
    nameKo: '격자 직각 회전',
    desc: '격자 밴드가 90도씩 비틀리며 분리 후 다시 맞춰지는 모션',
    details: '추론, 문제 해결 상태용'
  },
  {
    id: 'listening',
    name: 'Listening',
    nameKo: '위도 링 파동',
    desc: '위도 링을 따라 출렁이는 파동',
    details: '음성 인식, 입력 대기 상태용'
  },
  {
    id: 'connecting',
    name: 'Connecting',
    nameKo: '노드 연결, 패킷 이동',
    desc: '노드 연결선을 따라 패킷 이동',
    details: 'Cross-SaaS 연결, 지식 그래프 상태용'
  },
  {
    id: 'weaving',
    name: 'Weaving',
    nameKo: '세 가닥 땋기',
    desc: '구체 표면에서 점선 세 가닥이 교차하는 모션',
    details: '여러 데이터 조합 상태용'
  },
  {
    id: 'composing',
    name: 'Composing',
    nameKo: '물결치는 다중 밴드',
    desc: '여러 겹의 밴드가 출렁이며 회전',
    details: '답변 생성 상태용'
  },
  {
    id: 'breathing',
    name: 'Breathing',
    nameKo: '정면 링 모핑',
    desc: '정면을 향한 원형 링이 수축과 팽창을 반복',
    details: '움직임 최소 형태'
  },
  {
    id: 'shaping',
    name: 'Shaping',
    nameKo: '도형 변환',
    desc: '점선 윤곽선이 원, 삼각형, 사각형 순서로 변형',
    details: '정리, 구조화 상태용'
  }
]

export default function OrbsDemoPage({
  onSelectStates,
  initialSelected = ['solving', 'composing']
}: {
  onSelectStates?: (states: OrbState[]) => void
  initialSelected?: OrbState[]
}) {
  const [selected, setSelected] = useState<OrbState[]>(initialSelected)
  const [previewSize, setPreviewSize] = useState<OrbSize>(32)
  const [theme, setTheme] = useState<OrbTheme>('light')
  const [speed, setSpeed] = useState<number>(1)
  const [activeCycleIdx, setActiveCycleIdx] = useState(0)

  // Cycle preview of chosen states every 4 seconds
  useEffect(() => {
    if (selected.length <= 1) {
      setActiveCycleIdx(0)
      return
    }
    const timer = setInterval(() => {
      setActiveCycleIdx(prev => (prev + 1) % selected.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [selected])

  const toggleSelect = (id: OrbState) => {
    let next: OrbState[]
    if (selected.includes(id)) {
      if (selected.length === 1) return // Keep at least one
      next = selected.filter(s => s !== id)
    } else {
      if (selected.length >= 2) {
        // Keep max 2 (replace second)
        next = [selected[0], id]
      } else {
        next = [...selected, id]
      }
    }
    setSelected(next)
    onSelectStates?.(next)
  }

  return (
    <div style={{
      maxWidth: 1200,
      margin: '0 auto',
      padding: '32px 24px 64px',
      fontFamily: 'var(--font-family-base, sans-serif)',
      color: theme === 'dark' ? '#f1f5f9' : '#0f172a',
      background: theme === 'dark' ? '#0b0f19' : '#ffffff',
      minHeight: '100vh',
      boxSizing: 'border-box'
    }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--color-border, #e2e8f0)', paddingBottom: 20, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
                Thinking Orb 애니메이션 선택 데모
              </h1>
              <a
                href="#overview"
                style={{
                  fontSize: 13,
                  padding: '4px 10px',
                  border: '1px solid #cbd5e1',
                  background: theme === 'dark' ? '#1e293b' : '#f8fafc',
                  color: 'inherit',
                  textDecoration: 'none'
                }}
              >
                ← 대시보드로 돌아가기
              </a>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: theme === 'dark' ? '#cbd5e1' : '#0f172a' }}>
              AI 분석 중 표시 애니메이션 1~2개 선택
            </p>
          </div>
          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>테마:</span>
              <select
                value={theme}
                onChange={e => setTheme(e.target.value as OrbTheme)}
                style={{ padding: '4px 8px', border: '1px solid #cbd5e1', background: theme === 'dark' ? '#1e293b' : '#fff', color: 'inherit' }}
              >
                <option value="light">라이트</option>
                <option value="dark">다크</option>
              </select>
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>크기:</span>
              <select
                value={previewSize}
                onChange={e => setPreviewSize(Number(e.target.value) as OrbSize)}
                style={{ padding: '4px 8px', border: '1px solid #cbd5e1', background: theme === 'dark' ? '#1e293b' : '#fff', color: 'inherit' }}
              >
                <option value={20}>20px 최소</option>
                <option value={32}>32px 실제 크기</option>
                <option value={64}>64px 확대</option>
              </select>
            </label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>속도:</span>
              <select
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
                style={{ padding: '4px 8px', border: '1px solid #cbd5e1', background: theme === 'dark' ? '#1e293b' : '#fff', color: 'inherit' }}
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1.0x 기본</option>
                <option value={1.5}>1.5x</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      {/* Selected Recommendation Summary Banner */}
      <section style={{
        padding: '16px 20px',
        marginBottom: 32,
        background: theme === 'dark' ? '#1e293b' : '#f8fafc',
        border: '1px solid #cbd5e1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {selected.length > 0 && (
              <ThinkingOrb
                key={`${selected[activeCycleIdx]}-${theme}-${speed}`}
                state={selected[activeCycleIdx]}
                size={32}
                theme={theme}
                speed={speed}
              />
            )}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginBottom: 2 }}>
              선택한 애니메이션 ({selected.length}/2개 선택됨) {selected.length > 1 && `, 4초 간격 전환: ${selected[activeCycleIdx]}`}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
              {selected.map(id => {
                const opt = ORB_OPTIONS.find(o => o.id === id)
                return (
                  <span
                    key={id}
                    style={{
                      padding: '2px 8px',
                      background: theme === 'dark' ? '#334155' : '#e2e8f0',
                      fontSize: 13
                    }}
                  >
                    {opt?.nameKo} ({id})
                  </span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: theme === 'dark' ? '#0f172a' : '#ffffff',
            border: '1px solid #e2e8f0'
          }}>
            <span style={{ fontSize: 13, color: '#0f172a' }}>어시스턴트 화면 미리보기:</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ThinkingOrb state={selected[activeCycleIdx]} size={previewSize} theme={theme} speed={speed} />
              <span style={{ fontSize: 14, color: theme === 'dark' ? '#cbd5e1' : '#0f172a' }}>
                답변 생성 중 <em style={{ fontStyle: 'normal', color: 'inherit' }}>2초</em>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Grid of 9 Animation Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: 20
      }}>
        {ORB_OPTIONS.map(opt => {
          const isSelected = selected.includes(opt.id)
          return (
            <article
              key={opt.id}
              onClick={() => toggleSelect(opt.id)}
              style={{
                cursor: 'pointer',
                border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                background: isSelected
                  ? (theme === 'dark' ? '#172554' : '#f0f7ff')
                  : (theme === 'dark' ? '#1e293b' : '#ffffff'),
                padding: 16,
                display: 'grid',
                gap: 12,
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>
                    {opt.nameKo} <span style={{ fontSize: 13, fontWeight: 400, color: '#0f172a' }}>({opt.id})</span>
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: theme === 'dark' ? '#cbd5e1' : '#0f172a' }}>
                    {opt.desc}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(opt.id)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }}
                  aria-label={`${opt.nameKo} 선택`}
                />
              </div>

              {/* Visual Display */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                padding: '16px 8px',
                background: theme === 'dark' ? '#0f172a' : '#f8fafc',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ThinkingOrb state={opt.id} size={64} theme={theme} speed={speed} />
                  </div>
                  <span style={{ fontSize: 11, color: '#0f172a', marginTop: 4, display: 'block' }}>64px 확대</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: 32, height: 32, margin: '16px auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ThinkingOrb state={opt.id} size={32} theme={theme} speed={speed} />
                  </div>
                  <span style={{ fontSize: 11, color: '#0f172a', marginTop: 4, display: 'block' }}>32px 실제 크기</span>
                </div>
              </div>

              {/* Chat Row Context Preview */}
              <div style={{
                padding: '8px 12px',
                background: theme === 'dark' ? '#0f172a' : '#ffffff',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: 10
              }}>
                <ThinkingOrb state={opt.id} size={32} theme={theme} speed={speed} />
                <span style={{ fontSize: 13, color: theme === 'dark' ? '#cbd5e1' : '#0f172a' }}>
                  답변 생성 중 <em style={{ fontStyle: 'normal', color: 'inherit' }}>2초</em>
                </span>
              </div>

              <div style={{ fontSize: 12, color: theme === 'dark' ? '#cbd5e1' : '#0f172a', lineHeight: 1.4 }}>
                {opt.details}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
