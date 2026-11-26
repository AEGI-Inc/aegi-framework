/**
 * 조치 동사 사전(cut_actions.yaml verbs)을 엔진이 읽는 모양으로 옮긴다. 생성 표 CUT_ACTIONS(scripts/ontology/generate.ts)와
 * 다른 판 사전으로 미리 재는 그림자(scripts/cutActions/shadow.ts loadCutActions)가 같은 함수를 쓴다.
 */
export function cutActionVerbs(verbs: any[]) {
  return verbs.map(v => ({
    id: v.id, name: v.name, status: v.status,
    saas: (v.saas ?? []).map((r: any) => ({ provider: r.provider, ...r.cut, ...(r.ui ? { ui: r.ui } : {}), checked: r.checked, ...(r.follow_with?.length ? { follow_with: r.follow_with } : {}) })),
  }))
}
