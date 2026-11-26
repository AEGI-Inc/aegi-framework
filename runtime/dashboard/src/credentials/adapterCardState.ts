/** Adapters 카드에서 데모 데이터셋과 현재 연결 상태를 함께 보여 주는 규칙. */
export function adapterCardState(input: {
  demo: boolean
  datasetName: string | undefined
  connected: boolean
  hasPreviousCollection: boolean
}) {
  // 엔진이 sample 로 게시한 데이터셋만 표본으로 다룬다. 이름에 demo 같은 말을
  // 넣었다고 실측 수집 시각을 숨기지 않는다.
  const sample = input.demo && input.datasetName === 'sample'
  return {
    sample,
    showCollection: !sample,
    showPreviousCollectionDisconnected: !sample && input.demo && input.hasPreviousCollection && !input.connected,
  }
}
