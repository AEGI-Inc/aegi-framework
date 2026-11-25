/**
 * 공개 데모 체험 안내가 같은 탭에서 보던 단계를 기억하는 자리. 안내(DemoTutorial)는 늦게 불러오므로,
 * App 은 안내가 오기 전에 이 값만 읽어 첫 화면(데모 선택)이 열릴 자리를 미리 덮는다.
 */
export const TUTORIAL_STORAGE_KEY = 'aegi:public-demo-tutorial'

/** 이 탭에서 데모 선택부터 시작하는지. 저장이 없거나 읽지 못하면 데모 선택부터 */
export function opensOnLanding(): boolean {
  try {
    const mode = (JSON.parse(window.sessionStorage.getItem(TUTORIAL_STORAGE_KEY) ?? 'null') as { mode?: string } | null)?.mode
    return !mode || !['free', 'run', 'done'].includes(mode)
  } catch { return true }
}
