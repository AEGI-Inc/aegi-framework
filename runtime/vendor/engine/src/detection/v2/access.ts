import * as onto from '../../ontology/generated'

/**
 * 기본 제공 역할 이름의 순위 (D-20, 2026-09-24 개정).
 *
 * Policy 객체가 없는 역할은 `has_role_on`의 역할 자리에 이름만 있다(`roleName`, name_key).
 * GitHub 저장소 역할(read < triage < write < maintain < admin)과
 * 저장소 권한 API의 옛 이름(pull/push)을 같은 순위로 읽는다.
 * none 은 권한 없음(GitHub 앱 설치 권한 none 등)이다. Google Drive 권한 배정의 role(reader, commenter, writer,
 * fileorganizer, organizer, owner)도 있다. Okta 표준 역할은 읽기 전용(read_only_admin)만 이름으로 순위를 안다.
 * 나머지 관리자 역할은 모르므로 권한 있음으로 본다.
 * 값은 개념 사전(capabilities.yaml 의 role_rank)에서 생성한 src/ontology/generated.ts 에서 온다.
 */
const ROLE_RANK = onto.ROLE_RANK

export function roleRank(roleName: string): number | undefined {
  return ROLE_RANK[roleName.trim().toLowerCase()]
}
