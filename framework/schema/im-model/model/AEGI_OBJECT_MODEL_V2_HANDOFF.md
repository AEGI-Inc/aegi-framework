# 오브젝트 모델 v2 세션 인계 (2026-10-19)

## 지금 상태

- 브랜치 `feat/object-model-v2`, origin/main 최신판 위로 rebase 완료.
- 결정 정본은 `candidate-extraction/ir2/v2/relation_decisions_v2.json`이다. 결정 48건(판단표 1~4차 및 V2-P1~P7, Q01~Q11 결정 확정), 검토 항목 27개(열린 것 V2-OPEN-19, 20, 21, 24, 25, 26, 27).
- 규칙집 v2(7단계 50개 규칙, `rules.json`)를 공식 판단 기준으로 채택(adopted)했다. 다음 SaaS부터는 예외 항목만 선별해 검토한다.
- 1~6단계와 판단표 1~4차는 모두 사용자가 「권고대로」 정했다. GitHub A01 ~ A05(2026-10-19), Okta A06 ~ A09(2026-10-20), Google Workspace A10 ~ A13(2026-10-20)은 구현 완료했고, V2-P1 20개 구현을 마쳤다. V2-P3 3개(Slack 관리 역할 배정 SL-16, Google 그룹 설정 GW-21)도 2026-10-20에 새 Profile 없이 구현했다. V2-P2 조건 없는 29개 중 GitHub 9개(GH-29 ~ GH-33), Okta 10개(OK-19 ~ OK-23), Google Workspace 3개(GW-22 ~ GW-24), Slack 5개(SL-17, SL-18)를 구현해 실행 Profile은 122개다.
- 작업 경과 전체는 [AEGI_OBJECT_MODEL_V2_PROGRESS.md](AEGI_OBJECT_MODEL_V2_PROGRESS.md)에 있다. 이 문서는 새 세션이 바로 이어 받는 데 필요한 것만 적는다.

## 다음 할 일 (권하는 순서)

1. **V2-P1 수집 추가 20개 구현 완료.** GitHub A01 ~ A05(GH-24 ~ GH-28), Okta A06 ~ A09(OK-15 ~ OK-18), Google Workspace A10 ~ A13(GW-17 ~ GW-20)을 2026-10-20까지 모두 구현했다(Profile 97개, 가짜 SaaS 시험만). 실측 환경이 없으므로 가짜 SaaS 시험까지만 확인하고, 문서에 실측 미확인으로 적었다.

   | 표 코드 | SaaS | 타입 | 상태 |
   | --- | --- | --- | --- |
   | A01 ~ A05 | GitHub | Actions, Dependabot 비밀값, 배포 키, 조직 역할, 외부 그룹, 환경 | 구현 완료 (GH-24 ~ GH-28) |
   | A06 ~ A09 | Okta | API 서비스 연동과 비밀값, API 토큰, 이벤트 훅, 인라인 훅, 로그 스트림, 외부 IdP | 구현 완료 (OK-15 ~ OK-18) |
   | A10 ~ A13 | Google Workspace | SSO 프로필(SAML, OIDC), IdP 인증서, SSO 배정, 앱 비밀번호, 공유 드라이브, 조직 단위 | 구현 완료 (GW-17 ~ GW-20) |
2. **V2-P3 구현 완료(2026-10-20).** Slack 관리 역할 배정은 SL-16(`admin.roles.listAssignments`, SL-90 존재 확인에서 옮김)으로 받아 사용자 has_role_on[role_id] 조직, 워크스페이스, 채널로 편다. 역할 이름 API가 없어 role_id가 이름 역할 키다. Google 그룹 설정은 GW-21(Groups Settings API)로 받아 Group 속성 `settings`에 둔다. 읽기 전용 범위가 없어 `apps.groups.settings`를 GW-15와 같은 예외로 두고 `gws.grantedScopes`에 있을 때만 부른다. 이 예외를 허용할지는 열린 검토 항목 **V2-OPEN-26**으로 남겼다(2026-10-20, 기록만 하고 넘어감). 가짜 SaaS 시험만.
3. **V2-P2** 41개 중 조건 없는 29개 중 27개 구현 완료. GitHub 9개(B01, B03, B05 ~ B09, GH-29 ~ GH-33), Okta 10개(B10 ~ B13, B15, B17, OK-19 ~ OK-23), Google Workspace 3개(B21, B24, B25, GW-22 ~ GW-24), Slack 5개(B19, B20, SL-17, SL-18)는 2026-10-20에 구현했다. Google B23(구독, Forms watch)은 목록 API가 호출한 프로젝트 것만 줘서 **V2-OPEN-27**로 보류했다. 조건부(엔터프라이즈 토큰, 기기 신뢰 탐지, 인가 서버)는 조건이 생길 때.
4. 연구 후속 **V2-OPEN-19 ~ 21**, 원문 보강 **V2-OPEN-24**(6개 스펙을 수집 원문에 더하고 연구 재실행).
5. **7단계 실측**(Salesforce, Jira, Confluence)은 사용자가 환경을 준비한다고 할 때까지 시작하지 않는다.
6. aegi-schema 이슈 #20(D2, E11, crosswalk 2건)의 반영 여부를 본다.

## 작업 환경

작업 트리는 `finding-nemo/aegi-dashboard-v2`(worktree, `feat/object-model-v2`)에 있다. 2026-10-19에 세션 임시 폴더에서 git 밖 자료까지 통째로 옮겼고, 옮긴 뒤 `verify_stage2.py`, `verify_model_v1.py`, `test:model-v1`(31개), `validate:model-v1`을 통과했다.

- **메인 체크아웃(`aegi-dashboard`)은 다른 세션이 `feat/graph-information-control`로 쓰고 있다.** 거기서 브랜치를 바꾸지 않는다. v2 작업은 `aegi-dashboard-v2`에서 한다. 그 폴더가 없을 때만 아래로 다시 만들고 git 밖 자료를 복사한다.

  ```bash
  git worktree add ../aegi-dashboard-v2 feat/object-model-v2
  ```

- **git 밖 자료(`aegi-dashboard-v2`에 있음):** `candidate-extraction/ir2/out2`, `candidate-extraction/ir2/cache`, `collected-g2`, `scripts/collect/collector.config.g2.json`, 수집 원본 스냅샷, `src/data/aegi_inc_measured_*` 실측 데이터셋. 실측 데이터와 `out2`는 git에 넣지 않는다. `node_modules`는 메인 체크아웃 것을 연결(junction)해 썼다.
- **연구 스크립트의 형제 폴더:** `core.py`의 NEMO 경로가 worktree 부모를 본다. 부모 폴더에 `aegi-schema`, `*_api_list`, `github-api-drive-upload`가 있어야 한다. worktree를 `finding-nemo` 아래에 두면 그대로 맞는다.
- **줄바꿈 함정:** 연구 고정 해시는 작업 사본 바이트(CRLF/LF)로 계산한다. 새 worktree에서 `verify_model_v1.py`가 해시 불일치로 실패하면, 바뀌지 않은 파일을 메인 체크아웃의 바이트로 덮어쓴다. 이 때문에 지금 worktree는 `git status`에 줄바꿈만 다른 파일 160여 개가 수정으로 보인다. 그 파일들은 커밋하지 않는다.
- **개발 서버:** 메인 체크아웃의 `.claude/launch.json`(git 밖)에 `v2-check`(5183, 기본 데이터셋), `v2-model`(5184, v1 모델 데이터셋), `map3way-preview`(8803, 대조 페이지 정적 서버)가 있다. `v2-check`, `v2-model`은 `aegi-dashboard-v2`를 가리키도록 고쳤다. `map3way-preview`는 아직 이전 세션 임시 폴더를 가리키며, 그 폴더가 지워지면 `profile_triage/` 도구로 다시 만든다.

## 검증 명령

```bash
npm run test:model-v1          # 31개
npx tsx --test scripts/ontology.test.ts   # 6개, v2 대장 코드도 확인
npm run validate:model-v1      # 객체 294, 관계 272, 보류 0
npm run build
npm run test:functional        # dev 서버가 떠 있어야 한다. 69/69
cd candidate-extraction/ir2 && python verify_stage2.py && python verify_model_v1.py
```

## 산출물

| 자료 | 위치 |
| --- | --- |
| 판단표 1차 (V2-D02 ~ D05) | https://claude.ai/artifact/RDB53hnW3KDUcDMqsJpyCx |
| 판단표 2차 (V2-R, S, M, T) | https://claude.ai/artifact/3qsLkTwJZsJVL5DkunKfTe |
| 판단표 3차 (V2-P1 ~ P7) | https://claude.ai/artifact/EcgCZfkbwtTtLdfGWGxXot |
| 세 모델 오브젝트 대조 | https://claude.ai/artifact/XUUNPH1ZL2hpDksLKvxSaL |
| 판단표 4차 (관계 없는 객체와 객체 참조, Q01 ~ Q11, 결정 확정) | https://claude.ai/artifact/Rd86ZwW6rnjRZzExsmShaP |
| 오브젝트 모델 규칙집 (규칙 50개, 공식 채택 adopted) | https://claude.ai/artifact/WieGMW7it7TqzvmXrVvJVG |
| 대조와 판단표 3차 재생성 도구 | `candidate-extraction/ir2/v2/profile_triage/` |
| v1 공부 자료, 감사 검토, 최신판 비교 | 메인 체크아웃의 `docs/study/model-v1/` (git 밖, 커밋 안 함) |

게시본은 모두 비공개다.

## 지킬 것 (이 작업에서 확인된 사용자 규칙)

- 요청 없이 커밋, push, PR, 머지하지 않는다. push는 먼저 묻는다. `main` 머지는 운영 배포다.
- v1 고정 파일(`model_v1_freeze.json`, `relation_decisions_step4.json`)은 새 결정 없이 바꾸지 않는다. v2 결정은 v2 대장에만 쓴다.
- 판단이 필요한 일은 판단표(코드, 대상, 확인한 사실, 권고)로 만들어 사용자 결정을 받은 뒤 대장에 기록하고 구현한다.
- 테넌트 실측 값(ID, 이메일, 응답 본문)을 외부(게시본, 이슈)에 넣지 않는다. 공개 스펙 값만 쓴다.
- `src/data/aegi_inc_environment_v2/*.json`은 직접 고치지 않고 `npm run data:generate`로 만든다.
- 가운뎃점을 쓰지 않는다. 보고는 최신 결론을 맨 위에 둔다.
