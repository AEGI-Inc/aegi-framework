# 관리자 인증 보호 공통 진단 실험

ISMS-P 2.10.2의 관리자 인증 보호를 Profile 기반 정규화 Object에서 확인한다. 독립 로컬 실행이며 기존 기준별 검사, 자동 수집, 이력 저장 또는 화면에 연결하지 않는다.

```sh
python scripts/compliance/admin_auth_compliance.py <objects.json> <output.json> [company-policy.json]
python -m unittest discover -s scripts/compliance -p 'test_*.py' -v
```

`objects.json`은 기존 Profile 정규화 형식을 입력한다. 출력에는 대상 키가 포함되므로 실측 출력을 Git에 넣지 않는다.

Google Workspace는 활성 슈퍼·위임 관리자별 2단계 인증 강제와 등록 값을 구분해 제공한다. 회사 기준이 없으면 기존 CIS·Google 체크리스트의 MFA 강제 조건을 사용하여 `pass`/`fail`을 반환한다. 값이 없으면 `not_collected`, 대상 또는 값의 의미가 불명확하면 `unknown`이다. 선택적인 회사 기준 파일은 `{"require_mfa": true}` 또는 `{"require_mfa": false}`이며 이 파일은 실행 입력일 뿐 저장·승인 기능이 아니다. 회사 기준에서 MFA를 요구할 때 명확한 값에 대해 `compliant`/`noncompliant`, 요구하지 않을 때 `not_required`를 반환한다. 범위·예외·테넌트별 기준은 지원하지 않는다. 유예, 인증 방식, 다른 핵심 사용자와 실제 로그인 성공은 판정하지 않는다.

Okta는 `Okta Admin Console` 접근 정책과 부모 참조로 연결된 PolicyRule 중 최우선 활성 규칙에서 MFA 요구와 피싱 방지 인증자 요구를 각각 관측한다. DISA STIG 및 HealthInsight 출처를 표시한다. 일부 규칙의 부모, 상태, 우선순위가 불명확하거나 정책이 유일하지 않으면 확인 불가다. `pass`/`fail`은 해당 규칙에 대한 공개 기준 판정이며 모든 관리자 적용 여부는 미확인이다.

GitHub는 조직의 2단계 인증 요구 설정을 공개 기준으로 판정하되 관리자별 적용 여부는 확인하지 않는다. Slack, Salesforce, Atlassian은 현재 연결된 관리자 MFA 강제 관측이 없으면 `not_collected`로 처리한다. Slack의 관리자 2FA 등록과 Salesforce의 MFA 수단이 제공되면 참고로 표시하며 강제 여부로 간주하지 않는다. Atlassian 관리자 인증 정책은 아직 Profile 연결이 없어서 새 데이터가 수집되더라도 어댑터 보완이 필요하다. 여섯 서비스가 모두 자동 판정된다는 뜻이 아니다. 여러 시점의 출처가 있으면 수집 시각을 단일 값으로 추측하지 않는다.

Profile overlay 변경은 하지 않았다. Google 사용자와 Okta 정책·규칙 overlay의 필드를 읽고, 수집된 데이터에 그 값과 연결이 있는지는 실행 시 별도로 확인한다. 기존 Google 코드는 누락 값을 false로 취급할 수 있어 본 실험에서는 누락을 확인 불가로 처리한다. 실제 데이터와 Profile 정규화 출력의 통합 검증은 아직 하지 않았다.

## 대시보드 로컬 실행 연동

로컬 개발에서는 `local_service.py --objects <기존 objects.json> --db <별도 sqlite 경로> --dashboard-origin <대시보드 origin>`으로 검사 서비스를 `127.0.0.1`에서 실행한다. 대시보드 Vite 개발 서버의 `AEGI_COMPLIANCE_LOCAL=1`은 `/api/compliance`를 이 서비스에 프록시한다. 기준 저장, 검사 실행 및 고정된 입력 Object 기반 이력 조회를 제공하며 SaaS 수집은 하지 않는다. 관리자 인증 한 항목만 등록돼 있다.

이 연결은 로컬 시연용이다. SQLite는 로컬 DB이고 기존 D1 검사 이력이 아니다. 운영 인증·테넌트 격리, 회사 기준 권한·버전, 생산 엔진 실행 경로와 D1 저장, 배포 설정은 아직 연결되지 않았다. 로컬 HTTP를 운영 네트워크에 노출하지 않는다.

## 운영 연결 구현 초안 (미배포)

`checks.py`가 공통 진단 등록부다. `worker.ts`는 대시보드의 D1 대기열에서 요청을 선점하고 요청에 고정된 스냅샷과 회사 기준으로 진단한다. 수집은 하지 않는다. 대시보드 마이그레이션 0008과 인증 API가 선행되어야 한다. 현재 회사 구분은 서버 설정 `AEGI_COMPLIANCE_WORKSPACE`에 고정된 단일 작업 공간이며, 공용 팀 로그인은 여러 회사 간 인증이나 격리를 제공하지 않는다. 서로 다른 회사에 공유 배포하면 안 된다.

서버와 엔진에 같은 `AEGI_COMPLIANCE_WORKSPACE`를 설정한다. 엔진 워커는 `npm run compliance:worker -- preview --watch`로 대기열을 감시한다. `--watch` 없이 실행하면 1건 처리 후 끝난다. 실제 배포 방식과 자격 증명, 프로세스 관리, 마이그레이션과 연결 검증은 별도 작업이며, 현재 로컬 시험만 마쳤다. 요청된 스냅샷이 실행 전 삭제되면 실패로 남으며 다른 스냅샷으로 대체하지 않는다. 실패한 요청은 새 검사 요청으로 재시도한다.

상시 서버 설치 초안: `npm run compliance:bundle`로 Node 실행 파일을 만들고 `worker.mjs`, `checks.py`, `admin_auth_compliance.py`를 `/opt/aegi-compliance/`에 설치한다. 전용 `aegi-compliance` 사용자와 `/etc/aegi-compliance/worker.env`에는 해당 D1 권한만 있는 Cloudflare 토큰과 `AEGI_COMPLIANCE_WORKSPACE`를 제공하고 `deploy/aegi-compliance.service`를 설치한다. 기존 Splunk 서비스나 설정을 변경하지 않는다. 시스템 서비스 설치·권한·로그 확인은 해당 서버에 접근해 실제 검증한 뒤 완료로 기록한다.

2026-11-04 운영 현황: 서버의 `aegi-compliance.service`가 D1 요청을 처리한다. 운영 D1에서 실제 스냅샷으로 1회 시험했고 시험 이력은 삭제했다. 페이지 배포 여부는 대시보드 배포 상태에서 확인한다.
