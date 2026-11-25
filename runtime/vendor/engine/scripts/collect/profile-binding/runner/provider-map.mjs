// 연구 provider(Profile 폴더 이름) → 대시보드 provider(객체 canonical.provider, 수집 envelope provider).
// 연구 provider jira/confluence 는 atlassian 의 service 다. 표에 없는 provider 는 원래 이름을 쓴다.
// 객체를 저장하는 곳과 찾는 곳이 같은 규칙을 써야 한다. 표만 보고 찾으면 새 provider 는 `undefined|종류` 를 찾아 참조·소속이 빈다
export const DASH_PROVIDER = Object.freeze({ jira: 'atlassian', confluence: 'atlassian', atlassian: 'atlassian', github: 'github', gws: 'gws', okta: 'okta', salesforce: 'salesforce', slack: 'slack', worker: 'worker', aws: 'aws' })

/** 연구 provider → 대시보드 provider. 표에 없으면 원래 이름 */
export const dashProvider = p => DASH_PROVIDER[p] ?? p

/** 대시보드 provider → 연구 provider 목록. 자기 이름이 먼저, 그다음 표 순서(atlassian → atlassian, jira, confluence) */
export const researchProvidersOf = dash => [dash, ...Object.keys(DASH_PROVIDER).filter(p => p !== dash && DASH_PROVIDER[p] === dash)]
