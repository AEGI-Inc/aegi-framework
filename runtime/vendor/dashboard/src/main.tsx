import React from 'react'
import ReactDOM from 'react-dom/client'
import { bootstrapDataset } from './data/datasetBootstrap'
import MeasuredLogin from './data/MeasuredLogin'
import { isPublicDemo } from './publicDemo'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// 최신 실측 등록이 끝난 뒤 App을 불러온다. 실패하면 로그인 화면에 머무른다.
async function start(): Promise<void> {
  // 공개 데모는 첫 화면(데모 선택)을 데이터와 함께 미리 받아 둔다. App 이 그려진 뒤 안내를 기다리는 시간을 줄인다
  if (isPublicDemo()) void import('./tutorial/PublicDemoTutorial')
  const state = await bootstrapDataset().catch(() => 'password' as const)
  if (state === 'password') await new Promise<void>(resolve => root.render(<MeasuredLogin onDone={resolve} />))
  const { default: App } = await import('./App')
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void start()
