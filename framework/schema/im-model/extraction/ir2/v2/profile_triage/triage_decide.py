# -*- coding: utf-8 -*-
"""판단표 3차 2/3: 분류 (-> out2/profile_triage/decisions.json). 결정은 v2 대장 V2-P1~P7 에 기록했다

기존 「포함」인데 IM 수집 Profile 이 없는 223개의 1차 분류 (판단표 3차).

A 수집 추가(우선): 권한을 주거나, 인증하거나, 테넌트 밖으로 나가는 경로에 걸린다
B 수집 추가(다음): 탐지에 쓰이지만 A 를 먼저 한다
C 기존 타입에 붙여 추가: 새 Profile 이 아니라 속성이나 관계로 더한다
D 이미 다른 형태로 다룸: 속성, 관측, 신원 Link, 관계로 이미 들어온다
E 조건부 보류: 특정 제품, 라이선스가 있는 테넌트에서만 생긴다. 연구 카탈로그에 두고 그때 수집
F 수집 안 함: 콘텐츠, 실행 기록, 표시 설정이라 권한 판단에 안 쓰인다
G 원문 확인 필요: 근거 API 가 연구 원문에 없다. 스펙을 받은 뒤 A~F 로 다시 나눈다
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "out2", "profile_triage")

# ---- 묶음 이유 (E, F 는 계열로 묶는다)
FAM = {
    "okta-opa": ("E", "Okta Privileged Access", "서버, 비밀값 금고, AD 연결을 다루는 별도 제품(/v1/teams/{team_name} API). 이 제품을 쓰는 테넌트에서만 생긴다. 쓰게 되면 Server, Secret, 프로젝트 권한이 접근 경로에 바로 걸리므로 그때 A로 올린다"),
    "okta-oig": ("E", "Okta Identity Governance", "권한 요청, 승인, 인증 검토용 거버넌스 제품(/governance API). 라이선스가 있는 테넌트에서만 생긴다. 쓰게 되면 entitlement가 앱 권한의 원천이 되므로 그때 A로 올린다"),
    "okta-ai": ("E", "Okta AI 에이전트, 리소스 서버", "AI 에이전트, MCP, A2A 서버 등록(/workload-principals, /resource-servers API). 새 기능이라 쓰는 테넌트에서만 생긴다"),
    "okta-pam": ("E", "Okta 권한 계정 관리(서비스 계정)", "/privileged-access API. Okta Privileged Access 계열 라이선스가 있어야 한다"),
    "okta-multiorg": ("E", "Okta 다중 org 계정 관리", "여러 Okta org를 묶는 계정 API(/{accountId}/api/v1). 단일 org 테넌트에는 없다"),
    "okta-realm": ("E", "Okta Realm", "사용자를 영역으로 나누는 기능. 켠 테넌트에서만 생긴다"),
    "okta-xaa": ("E", "Okta Cross App Access", "앱끼리 사용자 대신 접근하는 새 기능. 켠 테넌트에서만 생긴다"),
    "okta-device": ("E", "Okta 기기 보증, 기기 OS 계정", "기기 신뢰 기능(Okta Verify, Device Access)을 쓰는 테넌트에서만 생긴다"),
    "gws-cse": ("E", "Google 클라이언트 측 암호화", "Enterprise Plus 등 상위 판에서만 쓰는 기능"),
    "gws-vault": ("E", "Google Vault", "법무 보존 사건과 보존 대상. Vault를 쓰는 테넌트에서만 생기고 접근 권한은 관리자 역할로 이미 보인다"),
    "gws-chrome": ("E", "Chrome 관리 연결", "Chrome Enterprise 연결 설정. 쓰는 테넌트에서만 생긴다"),
    "gh-ent": ("E", "GitHub Enterprise 전용 실행 환경", "엔터프라이즈 호스팅 러너, 네트워크 구성. Enterprise Cloud 상위 기능을 쓰는 곳에서만 생긴다"),
    "gh-codespaces": ("E", "GitHub Codespaces", "Codespaces를 쓰는 조직에서만 생긴다. 쓰게 되면 Codespaces 비밀값과 함께 A로 올린다"),
    "slack-ekm": ("E", "Slack EKM", "고객 키 관리 추가 기능(Enterprise Key Management)"),
    "content": ("F", "콘텐츠", "메일, 일정, 문서 댓글, 이슈 같은 업무 내용이다. 권한 판단에 쓰지 않고 수집하면 개인정보 부담만 커진다. 수집기도 폼 응답은 받지 않는다"),
    "run": ("F", "실행 기록, 산출물", "실행할 때마다 생기는 기록이다. 필요하면 관측(observation)으로 둔다"),
    "display": ("F", "표시, 운영 설정", "표시, 분류, 운영용 설정이라 누가 무엇에 접근하는지를 바꾸지 않는다"),
    "repo-meta": ("F", "저장소 부속 기록", "저장소 안의 기록이다. 권한은 저장소 단위로 이미 수집한다"),
    "noreread": ("F", "다시 읽을 수 없는 토큰", "발급할 때 한 번만 값이 나오고 목록 API가 없다. 감사 로그 관측으로만 본다"),
}

# id -> (분류, 계열 또는 None, 확인한 사실, 권고)
D = {}


def put(ids, b, fact, rec, fam=None):
    for i in ids.split():
        D[i] = (b, fam, fact, rec)


# ---------------- GitHub
put("GH-v0.2-0078 GH-v0.2-0080", "A", "Cartography가 수집하고 GH-90 존재 확인 대상이다. 워크플로가 이 비밀값으로 외부 시스템에 인증한다", "Credential Profile 추가. 저장소, 조직, 환경 단위 비밀값 목록(값 없음)과 선택 저장소 범위")
put("GH-v0.2-0033", "A", "v1 관계 어휘의 permits 예시(배포 키 → 저장소)인데 수집하지 않는다. GH-90 존재 확인 대상이다", "Credential Profile 추가. read_only 여부를 permits 역할로")
put("GH-v0.2-0019", "A", "조직 역할은 저장소 역할보다 넓은 조직 권한을 준다. GH-90 존재 확인 대상이다", "Policy Profile 추가. 사용자, 팀 배정은 has_role_on")
put("GH-v0.2-0039", "A", "IdP 그룹을 GitHub 팀 회원으로 동기화한다. Okta 그룹에서 GitHub 팀으로 가는 SaaS 간 경로의 연결점이다", "Principal Profile 추가. 팀과의 연결과 Okta 그룹 신원 Link")
put("GH-v0.2-0053", "A", "Cartography가 수집하고 GH-90 존재 확인 대상이다. 배포 비밀값과 보호 규칙이 달린다", "Resource Profile 추가. 저장소 contained_in")
put("GH-v0.2-0054 GH-v0.2-0055", "B", "환경 배포를 막는 규칙이다. 환경을 수집해야 의미가 있다", "환경 다음에 Policy Profile 추가")
put("GH-v0.2-0132", "B", "엔터프라이즈 감사 로그를 외부로 보낸다. 엔터프라이즈 소유자 토큰이 있어야 읽는다", "Endpoint Profile 추가(엔터프라이즈 토큰이 있을 때)")
put("GH-v0.2-0022 GH-v0.2-0008", "B", "엔터프라이즈 단위 역할과 팀이다. 지금 테넌트에 엔터프라이즈가 있다", "엔터프라이즈 토큰이 있을 때 Policy, Principal Profile 추가")
put("GH-v0.2-0061", "B", "조직 IP 허용 목록이다. v1 규칙상 조건이지만 조직 단위로 따로 관리된다", "Policy Profile 추가, 관계 없이 조직 contained_in")
put("GH-v0.2-0041", "B", "조직 SAML IdP 설정이다. 외부 신원과 SSO 승인(GH-22)의 기준이다", "Integration Profile 추가")
put("GH-v0.2-0074 GH-v0.2-0072", "B", "자체 호스팅 러너는 내부 시스템에서 워크플로를 실행한다. 러너 그룹이 쓸 수 있는 저장소를 정한다. GH-90 존재 확인 대상이다", "Resource, Policy Profile 추가")
put("GH-v0.2-0062", "B", "Cartography가 수집한다. 검증 도메인 이메일(GH-21) 신원 연결의 근거다", "Policy Profile 추가")
put("GH-v0.2-0098", "B", "Cartography가 수집한다. 패키지는 저장소와 별도로 공개 범위와 권한을 가진다", "Resource Profile 추가")
put("GH-v0.2-0017", "B", "아직 수락하지 않은 조직 초대다. GH-90 존재 확인 대상이다", "Assignment Profile 추가")
put("GH-v0.2-0040", "D", "사용자 결정 GF1로 신원 Link 재료로만 쓴다", "변경 없음")
put("GH-v0.2-0037 GH-v0.2-0038", "D", "SCIM 사용자, 그룹은 외부 신원과 같은 신원 연결 재료다(GF1과 같은 근거). 그룹은 외부 그룹(A)으로 다룬다", "변경 없음. 필요하면 Link 근거에 SCIM 원본을 더한다")
put("GH-v0.2-0025", "D", "GH-14가 /apps/{slug}를 이미 읽어 App 설치 Integration 속성으로 둔다", "변경 없음")
put("GH-v0.2-0035 GH-v0.2-0034 GH-v0.2-0036", "D", "/user/... API라 조직 App 토큰으로 다른 사용자 키를 읽을 수 없다. SSO 승인된 키는 GH-22 Credential Authorization으로 이미 수집한다", "변경 없음")
put("GH-v0.2-0123", "D", "GH-12가 리뷰를 Pull Request 속성으로 이미 읽는다", "변경 없음")
put("GH-v0.2-0112", "F", "Cartography는 기본 브랜치만 노드로 만든다. IM은 브랜치를 보호 규칙, 룰셋의 대상 필드로 둔다", "수집 안 함. 브랜치 단위 탐지가 생기면 다시 본다", "repo-meta")
put("GH-v0.2-0114 GH-v0.2-0124 GH-v0.2-0125 GH-v0.2-0099 GH-v0.2-0119 GH-v0.2-0120 GH-v0.2-0100", "F", "", "수집 안 함", "repo-meta")
put("GH-v0.2-0069", "F", "", "수집 안 함", "run")
put("GH-v0.2-0129 GH-v0.2-0121 GH-v0.2-0126 GH-v0.2-0128 GH-v0.2-0130", "F", "", "수집 안 함", "content")
put("GH-v0.2-0057 GH-v0.2-0059", "F", "사용자 정의 속성 스키마다. 값은 룰셋 조건이 필드로 참조한다", "수집 안 함", "display")
put("GH-v0.2-0106", "F", "비밀값 탐지 패턴 설정이다", "수집 안 함", "display")
put("GH-v0.2-0097", "E", "", "보류", "gh-codespaces")
put("GH-v0.2-0075 GH-v0.2-0077", "E", "", "보류", "gh-ent")
put("GH-v0.2-0081", "G", "GH-90 존재 확인은 하지만 연구 원문 스펙에 없다", "스펙 확인 후 Actions 비밀값과 같이 처리(Codespaces를 쓸 때)")
put("GH-v0.2-0102", "G", "조직 비공개 레지스트리 자격증명이다. GH-90 존재 확인은 하지만 연구 원문 스펙에 없다", "스펙 확인 후 B 후보")

# ---------------- Google Workspace
put("GWS-v3-1521 GWS-v3-1520 GWS-v3-1522 GWS-v3-1519", "A", "Okta 같은 외부 IdP로 Google 로그인을 넘기는 SSO 설정, 서명 인증서, 조직 단위 배정이다. SaaS 간 신원 경로의 시작점이다. SAML 프로필과 배정은 GW-90 존재 확인 대상이다", "SSO 프로필은 Integration, 인증서는 Credential, 배정은 Assignment Profile 추가")
put("GWS-v3-0181", "A", "SSO 배정과 정책이 조직 단위(OU)를 대상으로 한다. GW-90 존재 확인 대상이다", "Resource Profile 추가. 사용자는 member_of")
put("GWS-v3-0148", "A", "앱 비밀번호는 SSO와 2단계 인증을 우회한다. GW-90 존재 확인 대상이다", "Credential Profile 추가(값 없음, 사용자 authenticates_with)")
put("GWS-v3-2165", "A", "공유 드라이브는 파일 권한의 상위 컨테이너다. 드라이브 회원 권한이 안의 파일 전체에 미친다", "Resource Profile 추가. 드라이브 권한은 Permission과 같은 꼴")
put("GWS-v3-1535", "B", "Cloud Identity 정책(2단계 인증 강제 등)이다. GW-90 존재 확인 대상이다", "Policy Profile 추가. OU, 그룹 applies_to")
put("GWS-v3-1510", "B", "공유를 허용한 외부 도메인 목록이다", "Policy 또는 Endpoint Profile 추가(interface는 연구 Endpoint와 다름, 결정 필요)")
put("GWS-v3-4006 GWS-v3-2446", "B", "Workspace 이벤트와 폼 변경을 외부 Pub/Sub로 보낸다", "Endpoint Profile 추가")
put("GWS-v3-0601", "B", "캘린더 공유 규칙이다. 외부 공유 경로가 된다", "Assignment Profile 추가(캘린더는 속성)")
put("GWS-v3-1482 GWS-v3-0179 GWS-v3-0160 GWS-v3-1588", "B", "Cartography가 Cloud Identity 기기를 수집한다. 기기 소유 사용자를 잇는다. 모바일, ChromeOS 기기는 GW-90 존재 확인 대상이다", "Resource Profile 추가(기기 신뢰 탐지를 할 때)")
put("GWS-v3-2598", "C", "그룹 설정(외부 회원 허용, 가입 방식)이다. 별도 대상이 아니라 그룹의 성질이다", "Group Profile에 속성으로 추가")
put("GWS-v3-1528", "D", "Directory 그룹 회원(GW-04)과 같은 회원 관계다", "변경 없음")
put("GWS-v3-0168", "D", "도메인 목록(GW-02)은 최소 권한으로 못 읽어서 고객 기본 도메인과 사용자 주소 도메인으로 대신한다", "변경 없음")
put("GWS-v3-2537 GWS-v3-2526", "D", "GW-15가 자동 전달과 전달 주소를 SC-G 관측으로 이미 수집한다", "변경 없음")
put("GWS-v3-2543", "F", "IMAP 설정은 사용자 메일 설정이다. 필요하면 GW-15 관측에 더한다", "수집 안 함", "display")
put("GWS-v3-2307 GWS-v3-2298 GWS-v3-2305", "F", "Drive 라벨과 라벨 권한, 잠금이다", "수집 안 함", "display")
put("GWS-v3-2557", "F", "S/MIME 서명 인증서다. 접근 권한을 주지 않는다", "수집 안 함", "display")
put("GWS-v3-0184 GWS-v3-0185 GWS-v3-1585", "F", "프린터와 기기 클라이언트 상태다", "수집 안 함", "display")
put("GWS-v3-2592 GWS-v3-2571", "F", "Postmaster Tools의 발송 도메인 통계다", "수집 안 함", "display")
put("GWS-v3-0602 GWS-v3-2132 GWS-v3-2926 GWS-v3-2951 GWS-v3-2853 GWS-v3-0617 GWS-v3-2459 GWS-v3-2549 GWS-v3-2559", "F", "", "수집 안 함", "content")
put("GWS-v3-2529 GWS-v3-2530", "E", "", "보류", "gws-cse")
put("GWS-v3-3945 GWS-v3-3954 GWS-v3-3957", "E", "", "보류", "gws-vault")
put("GWS-v3-1047", "E", "", "보류", "gws-chrome")
put("GWS-v3-1541", "G", "그룹 보안 설정(회원 제한) API가 연구 원문에 없다", "스펙 확인 후 C(그룹 속성) 후보")

# ---------------- Okta
put("OKTA-v1-1725", "A", "Cartography가 수집하고 OK-90 존재 확인 대상이다. API 토큰은 만든 관리자 권한을 그대로 갖는다", "Credential Profile 추가(값 없음). 만든 사용자 owned_by, 네트워크 조건은 속성")
put("OKTA-v1-2121", "A", "외부 IdP로 Okta 로그인을 받는 연동이다. 외부 신원이 Okta 사용자로 들어오는 경로다. OK-90 존재 확인 대상이다", "Integration Profile 추가")
put("OKTA-v1-1694 OKTA-v1-1695", "A", "API 서비스 연동은 Okta 관리 scope를 받은 외부 서비스와 그 클라이언트 비밀값이다. OK-90 존재 확인 대상이다", "Integration, Credential Profile 추가")
put("OKTA-v1-2005 OKTA-v1-2149 OKTA-v1-2223", "A", "이벤트 훅, 인라인 훅, 로그 스트림은 외부 주소로 데이터를 보내거나 외부 서비스가 토큰과 가입을 바꾸게 한다. 셋 다 OK-90 존재 확인 대상이고 로그 스트림은 Cartography도 수집한다", "Endpoint Profile 추가")
put("OKTA-v1-1824 OKTA-v1-1833 OKTA-v1-2277", "B", "커스텀 인가 서버가 하위 API용 토큰과 scope를 발급한다. 인가 서버는 OK-90 존재 확인 대상이다", "Resource, Policy Profile 추가(인가 서버를 쓰는 테넌트에서)")
put("OKTA-v1-2116", "B", "외부 IdP 서명 인증서다. IdP 연동의 신뢰 근거다", "IdentityProvider 다음에 Credential Profile 추가")
put("OKTA-v1-1773 OKTA-v1-1691 OKTA-v1-1615 OKTA-v1-2605", "B", "인증기, 네트워크 영역, 기기 보증, 신뢰 출처는 정책 조건과 허용 주소다. Cartography가 인증기, 영역, 신뢰 출처를 수집하고 넷 다 OK-90 존재 확인 대상이다. v1 규칙상 정책 조건은 필드 참조로 둔다", "Policy Profile 추가. 정책과는 관계 없이 필드 참조 유지")
put("OKTA-v1-1933", "B", "Cartography가 수집하고 OK-90 존재 확인 대상이다. 기기 사용자를 잇는다", "Resource Profile 추가(기기 신뢰 탐지를 할 때)")
put("OKTA-v1-1716", "B", "AD, LDAP 에이전트 풀이다. 온프레미스 디렉터리에서 사용자가 들어오는 경로다", "Integration Profile 추가(연구 interface와 맞춤)")
put("OKTA-v1-2547 OKTA-v1-1676", "B", "보안 이벤트 제공자와 SSF 스트림은 외부와 위험 신호를 주고받는다. 제공자는 OK-90 존재 확인 대상이다", "Endpoint Profile 추가")
put("OKTA-v1-1621", "B", "사용자 지정 SMTP 서버다. 알림 메일이 외부 서버로 나간다", "Endpoint Profile 추가")
put("OKTA-v1-1943", "B", "기기 신뢰 연동(EDR 등)이다", "Integration Profile 추가(기기 신뢰 탐지를 할 때)")
put("OKTA-v1-2443", "B", "앱과 Okta 사이 속성 매핑이다. OK-90 존재 확인 대상이다. 그룹이나 역할 속성이 매핑되면 권한 원천이 된다", "Automation Profile 추가")
put("OKTA-v1-2049", "D", "OK-13이 이미 수집해 Okta 그룹과 Slack 사용자 그룹의 신원 연결 근거로 쓴다", "변경 없음")
put("OKTA-v1-2155 OKTA-v1-1635", "D", "OK-08이 앱 공개 키를 읽어 OAuth 클라이언트의 jwks_kids 속성으로 둔다", "변경 없음")
put("OKTA-v1-1774 OKTA-v1-1301 OKTA-v1-2655", "D", "등록된 인증 수단은 UserFactor(OK-04)로 이미 수집한다", "변경 없음")
put("OKTA-v1-2394", "D", "역할 권한 목록이다. IamRole 속성으로 둔다(v1 Permission.permissionType 판정)", "변경 없음")
put("OKTA-v1-2122", "D", "외부 IdP에 연결된 사용자다. 외부 신원과 같은 신원 Link 재료다", "변경 없음. IdentityProvider(A) 수집 때 Link 근거로 쓴다")
put("OKTA-v1-2071", "F", "훅 요청 서명 키다. 훅 Endpoint 속성으로 충분하다", "수집 안 함", "display")
put("OKTA-v1-1829 OKTA-v1-2276 OKTA-v1-1912 OKTA-v1-1657", "F", "서명 키, 전화 발송, 푸시 제공자 자격증명이다. 사용자 접근 경로가 아니다", "수집 안 함", "display")
put("OKTA-v1-2261 OKTA-v1-1909 OKTA-v1-2435 OKTA-v1-2600 OKTA-v1-1594 OKTA-v1-1869 OKTA-v1-1987 OKTA-v1-1979", "F", "토큰 클레임, 인증기 모델 목록, 속도 제한, 위협 탐지와 봇 방지 설정, 행동 탐지 규칙, 메일과 사용자 지정 도메인이다. 위협 탐지와 봇 방지는 org 속성 후보다", "수집 안 함", "display")
put("OKTA-v1-1717", "F", "", "수집 안 함", "run")
for i in ("OKTA-v1-0394 OKTA-v1-0378 OKTA-v1-0380 OKTA-v1-3005 OKTA-v1-3037 OKTA-v1-3093 OKTA-v1-0402 OKTA-v1-2981 OKTA-v1-0396 "
          "OKTA-v1-3036 OKTA-v1-3121 OKTA-v1-2973 OKTA-v1-0388 OKTA-v1-0399 OKTA-v1-3045 OKTA-v1-3101 OKTA-v1-2997 OKTA-v1-3004 "
          "OKTA-v1-0395 OKTA-v1-3022 OKTA-v1-3027 OKTA-v1-3038 OKTA-v1-0401 OKTA-v1-3090 OKTA-v1-0403 OKTA-v1-2987 OKTA-v1-3020 "
          "OKTA-v1-3104 OKTA-v1-3124 OKTA-v1-1096").split():
    put(i, "E", "", "보류", "okta-opa")
put("OKTA-v1-1213 OKTA-v1-0711 OKTA-v1-0740 OKTA-v1-0767 OKTA-v1-0783 OKTA-v1-0814 OKTA-v1-1178 OKTA-v1-1185 OKTA-v1-0060 OKTA-v1-1075 OKTA-v1-0910 OKTA-v1-2032", "E", "", "보류", "okta-oig")
put("OKTA-v1-0096 OKTA-v1-0258 OKTA-v1-0304 OKTA-v1-0317 OKTA-v1-0236 OKTA-v1-0095 OKTA-v1-0222 OKTA-v1-0101 OKTA-v1-0122 OKTA-v1-0108 OKTA-v1-0216 OKTA-v1-0102 OKTA-v1-0123 OKTA-v1-0147", "E", "", "보류", "okta-ai")
put("OKTA-v1-1733 OKTA-v1-2316", "E", "", "보류", "okta-pam")
put("OKTA-v1-0031 OKTA-v1-0049", "E", "", "보류", "okta-multiorg")
put("OKTA-v1-2479 OKTA-v1-2480", "E", "", "보류", "okta-realm")
put("OKTA-v1-2348", "E", "", "보류", "okta-xaa")
put("OKTA-v1-1952 OKTA-v1-1650", "E", "", "보류", "okta-device")

# ---------------- Slack
put("SLK-v5.1-0049 SLK-v5.1-0050", "C", "admin.roles.listAssignments는 SL-90 존재 확인 대상이다. 지금 Slack 관리자 권한은 사용자 is_admin, is_owner 플래그로만 본다. 세부 관리 역할(채널 관리자, 사용자 관리자 등)은 빠진다", "새 Profile 없이 이름 역할 Policy(NamedRole)와 has_role_on 관계로 추가")
put("SLK-v5.1-0064 SLK-v5.1-0065 SLK-v5.1-0067 SLK-v5.1-0037", "B", "워크플로는 실행 주체 권한으로 다른 앱과 외부로 데이터를 보낸다. 워크플로는 SL-90 존재 확인 대상이다. 단계와 함수는 워크플로 속성으로 충분할 수 있다", "Automation Profile 추가(워크플로). 협업자는 Assignment, 단계와 함수는 속성")
put("SLK-v5.1-0012", "B", "정보 장벽은 사용자 그룹 사이 대화를 막는 정책이다. SL-90 존재 확인 대상이다", "Policy Profile 추가")
put("SLK-v5.1-0004", "D", "SL-08이 앱 승인, 제한 목록을 이미 읽어 앱 Integration의 approval 속성으로 둔다", "변경 없음")
put("SLK-v2-rev-0020", "D", "대시보드 v2 정규화가 만든 보강 ID다. IM은 채널 회원을 member_of 관계로 둔다", "변경 없음")
put("SLK-v5.1-0018 SLK-v5.1-0026", "F", "", "수집 안 함", "content")
put("SLK-v5.1-0005 SLK-v5.1-0007 SLK-v5.1-0061", "F", "", "수집 안 함. IM은 봇 토큰을 매니페스트 scope Policy로 둔다", "noreread")
put("SLK-v5.1-0059", "F", "Web API가 없다. 감사 로그(trigger_created 등)로만 보인다", "수집 안 함", "run")
put("SLK-v5.1-0028", "E", "", "보류", "slack-ekm")
put("SLK-v5.1-0047", "G", "레거시 연동이라 team.integrationLogs로만 보이고 연구 원문에 객체 API가 없다", "스펙 확인 후 결정(레거시면 F)")
put("SLK-v5.1-0048 SLK-v5.1-0066", "G", "앱 권한 요청(admin.apps.permissions), 워크플로 권한 조회 API가 연구 원문에 없다", "스펙 확인 후 결정. 워크플로 수집과 같이 본다")

items = json.load(io.open(os.path.join(OUT, "items.json"), encoding="utf-8"))
missing = [x["id"] for x in items if x["id"] not in D]
extra = [k for k in D if k not in {x["id"] for x in items}]
assert not missing and not extra, (missing, extra)
out = []
for x in items:
    b, fam, fact, rec = D[x["id"]]
    out.append(dict(x, bucket=b, family=fam, fact=fact, rec=rec))
json.dump({"items": out, "families": FAM}, io.open(os.path.join(OUT, "decisions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
import collections
print(collections.Counter(o["bucket"] for o in out))
print(collections.Counter((o["p"], o["bucket"]) for o in out))
