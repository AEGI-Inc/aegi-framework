# 새 SaaS 추가 플레이북 (Adding a New SaaS)

AEGI Framework의 핵심 강점은 지원 SaaS 외에 **Workday나 기업 내부 SaaS**를 동일한 방법론과 규격으로 확장할 수 있다는 점이다. 아래 6단계 절차를 따르면 엔진 코어를 수정하지 않고 새 SaaS를 Cross-SaaS 그래프와 위협 판정에 편입할 수 있다.

---

## 전체 확장 흐름

```mermaid
flowchart LR
  A["Step 1<br/>벤더 공식 명세 수집"] --> B["Step 2<br/>명세 구조화 &<br/>Information Map"]
  B --> C["Step 3<br/>IM Object · Interface ·<br/>Relation 매핑"]
  C --> D["Step 4<br/>IM Profile &<br/>수집기 등록"]
  D --> E["Step 5<br/>연결 규칙 &<br/>위협 매핑 추가"]
  E --> F["Step 6<br/>정규화 · 검증 ·<br/>대시보드 확인"]
```

---

## Step 1. 벤더 공식 API 및 로그 명세 확보

대상 SaaS의 공식 문서를 확보한다.
- OpenAPI(YAML/JSON), GraphQL SDL, Discovery 문서 또는 공식 REST API 명세
- 감사 로그(Audit Log) 이벤트 유형 목록
- 권한(OAuth Scope / RBAC Role) 문서

참고: `framework/schema/im-model/extraction/ir2/norm_m365.py`가 Microsoft 365(Microsoft Graph)를 대상으로 작성된 최신 확장 예제다.

---

## Step 2. 명세 구조화 및 Information Map 도출

1. `framework/schema/im-model/extraction/ir2/`에 `norm_<provider>.py`를 작성해 벤더 명세를 공통 형식(`operation`, `param`, `response shape`)으로 변환한다.
2. `ir2/map3.py` 또는 `extract.py` + `info_map.py`를 실행해 후보 오브젝트와 ID 공간, 정보 지도를 생성한다.
3. 구조만으로 모호한 항목은 `lexicons/<provider>.yaml`에 판단 이유와 함께 명시한다.

상세 설명: [02. Information Map 도출](../02-methodology/02-ir-and-information-map.md)

---

## Step 3. IM Object · Interface · Relation 매핑

도출된 후보를 AEGI의 닫힌 어휘에 매핑한다.
1. **Interface 9종** 부여 (`framework/schema/ontology/interfaces.yaml`): `Tenant`, `Principal`, `Credential`, `Resource`, `Policy`, `Assignment`, `Integration`, `Endpoint`, `Automation`
2. **Relation 17종** 연결 (`framework/schema/ontology/relation_types.yaml`): 소속(`member_of`), 권한 부여(`has_role_on`), 실행 신원(`runs_as`) 등
3. **Cross-SaaS 신원 매핑** (`framework/schema/ontology/crosswalk.yaml`): 이메일, 외부 ID, 연합 신원 키 정의

참고 규격: [Object_Schema_v4.1.md](../../framework/schema/specs/Object_Schema_v4.1.md), [Relation_Schema_v3.md](../../framework/schema/specs/Relation_Schema_v3.md), [Link_Schema_v3.md](../../framework/schema/specs/Link_Schema_v3.md)

---

## Step 4. IM Profile 작성 및 읽기 전용 수집기 연결

1. [Profile_Schema_v4.2.md](../../framework/schema/specs/Profile_Schema_v4.2.md) 형식에 따라 `runtime/engine/scripts/collect/profile-binding/overlays/<provider>/`에 Profile/Overlay를 추가한다.
2. 읽기 전용 API 호출 정의를 수집기(`runtime/engine/scripts/collect/`)에 등록한다.
3. 완료된 수집 run에 대해 정규화 검증을 실행한다.
   ```bash
   # 먼저 런타임 패키지를 설치한다: npm run runtime:install
   # 정규화 결과 및 형식/EA/OpenLineage 스키마 무결성 검사 (파일 미생성 dry-run)
   node runtime/engine/scripts/collect/profile-binding/runner/normalize.mjs --raw <수집폴더> --run <run-id> --out <출력폴더> --check
   ```

---

## Step 5. Cross-SaaS 연결 규칙 및 위협 매핑 추가

1. **연결 확인 규칙**: `framework/connection-rules/rules/<provider>-<other>.yaml` 형식으로 타 SaaS 및 외부 서버와의 연동 확인 규칙(`identify`, `points_to`, `tier`, `activity`, `sources`)을 추가한다. ([규칙 형식 안내](../../framework/connection-rules/docs/how-to-read.md))
2. **위협 매핑**: `framework/threat-mapping/<provider>/` 폴더에 `README.md`, `threats.csv`, `objects.csv`를 표준 열 규격에 맞춰 작성한다. ([작성 규격](../../framework/threat-mapping/README.md))

---

## Step 6. 통합 검증

1. `npm run verify`로 안전성 검사, 문서 링크 검사, IM 모델 무결성을 확인한다.
2. `runtime/`에서 새 SaaS의 읽기 전용 자격증명으로 수집 → 정규화 → 판정을 실행하고, 대시보드 **Cross-SaaS Graph**, **Threat**, **Compliance**에서 객체·연결·위협이 정상 표시되는지 확인한다.
