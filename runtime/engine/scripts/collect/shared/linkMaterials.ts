/**
 * Link 재료 — Object 가 아니지만 같은 사람을 잇는 근거가 되는 원본 (crosswalk.yaml 칸 표시 link_material).
 *
 * IM 모델 V3.2 는 GitHub ExternalIdentity 를 non_object(신원 Link 재료, 결정 GF1)로 정했다. 그래서 데이터셋 objects 에 넣지 않고,
 * join.ts runJoin 의 materials 로만 넘긴다. crosswalk.yaml federated_subject 의 b 쪽 칸
 * (github ExternalIdentity properties.name_id, end references.user)이 이 재료에서 값을 읽고, Link 끝은 그 신원이 가리키는 GitHub 사용자다.
 *
 * 옛 정규화(지운 normalize/github.ts GH-20)가 만들던 모양과 같다. 키는 GH-EXTID-<guid>.
 */
import type { NormalizeContext } from './context'
import type { DatasetV2 } from './dataset'
import { ghKey } from './dataset'
import type { MatchObject } from './match'
import { type RawSet } from './raw'

/** 엔터프라이즈 SAML 외부 신원 (GH-20). 사용자는 databaseId 로, 없으면 login 으로 찾는다. 데이터셋에 없는 사용자는 참조하지 않는다 */
function githubExternalIdentities(raw: RawSet, ds: DatasetV2, ctx: NormalizeContext): MatchObject[] {
  const out: MatchObject[] = []
  for (const env of raw.pages('github', 'GH-20')) {
    const idp = (env.payload as any)?.data?.enterprise?.ownerInfo?.samlIdentityProvider
    for (const n of idp?.externalIdentities?.nodes ?? []) {
      if (!n?.guid) continue
      const byId = n.user?.databaseId !== undefined ? ghKey.user(n.user.databaseId) : undefined
      const user = byId && ds.has(byId) ? byId : n.user?.login ? ctx.github?.byLogin.get(n.user.login) : undefined
      out.push({
        k: ghKey.externalIdentity(n.guid),
        p: 'github',
        t: 'ExternalIdentity',
        i: [],
        props: { name_id: n.samlIdentity?.nameId, username: n.samlIdentity?.username, user_login: n.user?.login ?? null },
        ids: { id: { value: n.guid } },
        refs: user ? { user: [user] } : {},
      })
    }
  }
  return out
}

export function buildLinkMaterials(raw: RawSet, ds: DatasetV2, ctx: NormalizeContext): Record<string, MatchObject> {
  return Object.fromEntries(githubExternalIdentities(raw, ds, ctx).map(m => [m.k, m]))
}
