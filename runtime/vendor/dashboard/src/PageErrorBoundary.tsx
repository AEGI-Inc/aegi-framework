import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 한 화면이 그리다 오류를 내면 앱 전체가 흰 화면이 된다. 그 화면 자리에만 오류를 보이고 메뉴는 남긴다.
 * 화면이 바뀌면(resetKey) 다시 그려 본다
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면 오류', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-loading" role="alert">
        <p>이 화면을 그리지 못했습니다. {this.state.error.message}</p>
        <button type="button" className="ex-btn" title="이 화면 다시 그리기" onClick={() => this.setState({ error: null })}>다시 그리기</button>
      </div>
    )
  }
}
