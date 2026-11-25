import { ASSET_ACCESS_QUESTION } from '../assistant/workspace'
import type { ProviderId } from '../providerOverviewData'

/**
 * 공개 데모 체험(use case) 설정. 대상 객체 키와 단계 문구는 이 파일 한 곳에만 둔다.
 * 데모 선택 칸(LANDING_SLOTS) 가운데 여기 설정이 있는 것만 켜지고, 없는 칸은 「준비 중」으로 보인다.
 * 새 체험은 같은 모양의 설정을 USE_CASES 에 더하면 된다. 판정(tutorialSteps.ts)은 설정의 키, 질문, 단계 판정 종류만 읽는다.
 *
 * 키는 공개 데모가 읽는 고정 스냅샷의 객체 키와 같아야 단계 판정이 맞는다.
 * UC1: 스냅샷 20261104T172000Z-9a242342-a3a44c (engine 합성, 가상 이름과 가상 도메인). 공개 데모는 여기에 UC2, UC4 합성을 얹은 20261104T172000Z-7597023b-b84695 를 읽는다
 * UC2, UC4: aegi-adapter-engine scripts/demo/publicDemoScenarios.ts 합성(가상 인물 aegidemo.example). Event Board 이벤트는
 *   scripts/stream/splunk/demo/scenarioEvents.ts 가 만들어 운영 Splunk 색인에 source=aegi-demo:uc 로 넣은 이벤트다. 위협 id 는 엔진 genericFindingId 값
 */

export interface UseCaseTargets {
  /** 체험의 중심 객체. 첫 키를 그래프로 열고 추천 질문의 대상으로 넘긴다 */
  assetKeys: string[]
  /** 중심 객체에서 피해 자원까지 연동 경로의 객체 */
  pathKeys: string[]
  /** 차집합 사람(직접 권한 없이 닿는 사람)의 계정들. 비어 있으면 화면이 읽은 Access Gap 의 차집합 사람을 쓴다 */
  outsidePersonKeys: string[]
  /** 끝 단계에서 찾는 이벤트. 이벤트 이름과 설명에서 찾는다 */
  leakEventPatterns: RegExp[]
}

export interface TutorialPrompt {
  label: string
  question: string
  /** 질문과 함께 AI 에게 넘길 대상 */
  select?: 'asset' | 'outside'
}

/** 단계에 들어갈 때 여는 화면. threat 는 체험의 위협 상세, graph 는 중심 객체의 그래프, board 는 Event Board */
export type StepScreen = 'threat' | 'graph' | 'board'

/**
 * 단계를 마쳤다고 보는 조건(tutorialSteps.ts stepDone).
 * threat 위협 상세를 연 때, graph 중심 객체나 경로로 그래프를 연 때, gap 답에 중심 객체를 지나는 Access Gap 이 붙은 때,
 * outside 차집합 사람을 골라 물은 때, answer 답을 받은 때, log 앞 단계부터 받은 답에 로그 근거가 있고 Event Board 인 때,
 * leak Event Board 결과에 끝 이벤트가 있는 때, read 읽기만 하는 단계
 */
export type StepCheck = 'threat' | 'graph' | 'gap' | 'outside' | 'answer' | 'log' | 'leak' | 'read'

export interface TutorialStep {
  title: string
  guide: string
  prompts: TutorialPrompt[]
  /** 이 단계에 들어갈 때 여는 화면. 없으면 앞 단계 화면에 그대로 있다 */
  open?: StepScreen
  check: StepCheck
  /** 시연(「다음」을 누르면 시연이 질문을 보내는 흐름)에서 쓰는 안내. 없으면 guide */
  auto?: string
  /** false 면 시연에서 이 단계의 추천 질문을 보내지 않는다(앞 단계 답을 그대로 본다) */
  ask?: boolean
}

export interface UseCase {
  id: string
  /** 고르기 칸과 안내 카드 머리에 쓰는 이름 */
  title: string
  /** 고르기 칸의 한 줄 */
  summary: string
  /** 1단계 첫 줄. 화면 밖에서 들어온 제보 */
  tip: string
  /** 완료 화면 문장 */
  done: string
  /** 체험이 다루는 위협(Threat 상세 주소의 finding) */
  findingId: string
  targets: UseCaseTargets
  /** 위협 확인부터 조치까지 일곱 단계 */
  steps: readonly TutorialStep[]
}

const UC1_STEP3_QUESTION = 'Access Gap에 있는 사람은 언제부터 원래 권한 없이 이 데이터를 받게 됐어? 관련 로그를 찾아 근거와 함께 알려줘.'

const UC1: UseCase = {
  id: 'uc1',
  title: '시나리오 1. 퇴사 예정자의 거래 정보 유출',
  summary: 'Salesforce 권한을 잃은 퇴사 예정자가 Slack 알림으로 계속 받은 거래 정보를 개인 Gmail로 내보낸 경로를 따라갑니다.',
  tip: '제보: 경쟁사가 우리 주요 고객의 재계약 견적을 정확히 알고 있었습니다.',
  done: 'Salesforce 권한이 회수된 뒤에도 Slack 알림 본문으로 거래 정보를 받던 직원이, 그 리포트를 스프레드시트로 올려 개인 Gmail에 공유한 이벤트까지 확인했습니다.',
  findingId: 'FND-CNF-BDF00756',
  targets: {
    // Salesforce 리포트 「3분기 대규모 계약 정리 리포트」와 그 기회 레코드 3개
    assetKeys: [
      'im:salesforce:Report:00ODEMO000000012DA',
      'im:salesforce:Opportunity:006DEMO00000001YDA',
      'im:salesforce:Opportunity:006DEMO00000002YDA',
      'im:salesforce:Opportunity:006DEMO00000003YDA',
    ],
    // Flow 「대규모 계약 단계 변경 알림」, Flow 의 Slack 동작, Salesforce for Slack 앱, #deal-alerts
    pathKeys: [
      'im:salesforce:FlowDefinitionView:300DEMO00000001YDA',
      'im:salesforce:FlowSlackActionEndpoint:301DEMO00000001YDA|Post_Deal_Alert',
      'im:slack:defs_app_id:A0DMSFSLK01',
      'im:slack:conversation:C0DMDEALAL1',
    ],
    // 퇴사 예정 영업 직원의 Okta, Salesforce, Slack, GWS 계정
    outsidePersonKeys: [
      'im:okta:User:00uDEMO00000000004698',
      'im:salesforce:User:005DEMO00000004YDA',
      'im:slack:200.members[*]:U0DMJIHO001',
      'im:gws:User:109900000000000000004',
    ],
    // 끝 이벤트: GWS drive change_user_access(개인 주소에 공유). 차집합 사람이 낀 이벤트만 센다
    leakEventPatterns: [/change_user_access/i, /공유 권한|권한 변경|외부 공유/],
  },
  steps: [
    {
      title: '위협 확인', open: 'threat', check: 'threat', ask: false,
      auto: 'AEGI가 탐지한 위협을 엽니다. Salesforce 리포트의 거래 정보가 Slack 채널로 복제되고 있다는 판정입니다.',
      guide: '위협 상세에서 어떤 데이터가 어디로 복제되는지 확인하세요.',
      prompts: [],
    },
    {
      title: '유출 의심 자산', open: 'graph', check: 'graph',
      auto: '제보에 나온 거래 정보가 어느 리포트에 담겨 있는지 AI에게 묻습니다. 그래프에서 리포트와 그 내용이 전달되는 경로를 함께 봅니다.',
      guide: '제보에 나온 거래 정보가 어디에 있는지 AI에게 질문하세요. 답변 아래 「Cross-SaaS Graph로 이동」으로 그래프에서 자산을 확인하세요.',
      prompts: [{ label: '자산 내용과 전달 경로', question: 'Salesforce의 「3분기 대규모 계약 정리 리포트」가 무엇이고 그 내용이 어디로 전달되는지 알려줘.', select: 'asset' }],
    },
    {
      title: '이 거래를 볼 수 있는 사람', check: 'gap',
      auto: '이 거래를 볼 수 있는 사람을 조회합니다. Salesforce 권한으로 보는 사람과, 연동을 거쳐 같은 내용을 받아 보는 사람을 함께 봅니다.',
      guide: '원래 권한자와 연동으로 이 데이터를 받는 사람을 함께 봅니다. 답변에 Access Gap이 붙으면 다음 단계로 넘어갑니다.',
      prompts: [{ label: '접근 가능한 사람', question: ASSET_ACCESS_QUESTION, select: 'asset' }],
    },
    {
      title: 'Access Gap', check: 'outside', ask: false,
      auto: '기회 레코드가 바뀔 때마다 Flow가 거래 내용을 Slack 메시지 본문에 담아 #deal-alerts 채널로 보냅니다. 그래서 Salesforce 권한이 없는 사람도 이 채널에서 거래 정보를 받습니다. AEGI는 이렇게 권한 없이 데이터를 받는 경우를 Access Gap으로 표시합니다.',
      guide: 'Flow가 거래 내용을 Slack 메시지 본문에 담아 #deal-alerts 채널로 보냅니다. Salesforce 권한 없이 이 채널에서 거래 정보를 받는 사람이 Access Gap에 해당합니다. 그 사람을 골라 질문하세요.',
      prompts: [{ label: '권한이 생긴 시점', question: UC1_STEP3_QUESTION, select: 'outside' }],
    },
    {
      title: '권한이 생긴 시점', check: 'answer',
      auto: '이 사람이 언제부터 권한 없이 거래 정보를 받기 시작했는지, AI가 로그에서 근거를 찾아 답합니다.',
      guide: 'AI가 로그를 찾아 근거와 함께 답합니다. 답변 아래 「Event Board에서 보기」로 이동하세요.',
      prompts: [{ label: '로그 근거 다시 찾기', question: UC1_STEP3_QUESTION, select: 'outside' }],
    },
    {
      title: '받은 리포트 처리', open: 'board', check: 'log',
      auto: 'Event Board에서 이 사람이 #deal-alerts에서 받은 리포트 파일을 어떻게 처리했는지 원본 이벤트로 확인합니다. 파일을 내려받아 Google Drive에 스프레드시트로 올린 기록이 남아 있습니다.',
      guide: '그 사람의 이벤트를 보드에 올려 받은 리포트 파일을 어떻게 처리했는지 찾으세요.',
      prompts: [{ label: '받은 리포트 처리 내역', question: '이 사람이 #deal-alerts 에서 받은 리포트 파일로 뭘 했어? 원본 이벤트 목록으로 찾아줘.' }],
    },
    {
      title: '개인 Gmail 공유', check: 'leak',
      auto: '올린 스프레드시트를 회사 밖 주소와 공유한 이벤트를 찾습니다. 개인 Gmail 주소에 편집 권한을 준 기록이 남아 있습니다.',
      guide: '그 사람이 회사 밖 주소로 공유한 이벤트를 보드에서 찾으세요.',
      prompts: [
        { label: '외부 공유', question: '이 사람이 최근 2주 동안 회사 밖 주소로 공유한 이벤트를 원본 이벤트 목록으로 찾아줘.' },
        { label: '최근 2주 행동', question: '이 사람의 최근 2주 행동을 원본 이벤트 목록으로 시간순으로 찾아줘.' },
      ],
    },
  ],
}

const UC2: UseCase = {
  id: 'uc2',
  title: '시나리오 2. 공용 토큰을 쓰는 Slack 봇의 저장소 무단 변경',
  summary: '저장소 권한이 없는 직원들이 누구나 부를 수 있는 /opsbot 명령으로 결제 서비스 설정을 바꾼 경로를 따라갑니다.',
  tip: '제보: 결제 서비스 설정이 검토 없이 세 번 바뀌었는데, 커밋 작성자는 모두 같은 개발자입니다.',
  done: '저장소 권한이 없는 직원 3명이 Slack /opsbot 명령으로 payments-service에 커밋했고, GitHub에는 토큰 주인 이름만 남았다는 것을 요청 기록과 push 기록으로 확인했습니다.',
  findingId: 'FND-INT-4420570F',
  targets: {
    // payments-service 저장소와 /opsbot 이 만든 커밋 3개
    assetKeys: [
      'im:github:Repository:990000101',
      'im:github:commit:5a1d2c3b4e5f60718293a4b5c6d7e8f901a2b3c4',
      'im:github:commit:6b2e3d4c5f60718293a4b5c6d7e8f901a2b3c4d5',
      'im:github:commit:7c3f4e5d60718293a4b5c6d7e8f901a2b3c4d5e6',
    ],
    // /opsbot 명령, OpsBot 앱, 봇이 쓰는 개인 토큰, #release-ops
    pathKeys: [
      'im:slack:Slash Command Request Endpoint:A0DMOPSBOT1|opsbot',
      'im:slack:defs_app_id:A0DMOPSBOT1',
      'im:github:personal-access-tokens:990000201',
      'im:slack:conversation:C0DMRELOPS1',
    ],
    // 저장소 권한 없이 /opsbot 을 부른 세 사람의 Slack, Okta 계정
    outsidePersonKeys: [
      'im:slack:200.members[*]:U0DMHAEUN01', 'im:okta:User:00uDEMO00000000013698',
      'im:slack:200.members[*]:U0DMJIMIN01', 'im:okta:User:00uDEMO00000000014698',
      'im:slack:200.members[*]:U0DMTAEYAN1', 'im:okta:User:00uDEMO00000000015698',
    ],
    leakEventPatterns: [/git\.push/i],
  },
  steps: [
    {
      title: '위협 확인', open: 'threat', check: 'threat', ask: false,
      auto: 'AEGI가 탐지한 위협을 엽니다. 저장소 쓰기 권한이 없는 사람도 /opsbot 명령을 거쳐 payments-service 코드를 바꿀 수 있다는 판정입니다.',
      guide: '위협 상세에서 누가 어떤 경로로 저장소를 바꿀 수 있는지 확인하세요.',
      prompts: [],
    },
    {
      title: '명령에서 저장소까지', open: 'graph', check: 'graph',
      auto: 'Slack /opsbot 명령에서 OpsBot 앱, 개발자의 GitHub 토큰, payments-service 저장소로 이어지는 경로를 그래프에서 봅니다. AI에게는 이 저장소를 바꾸는 경로를 묻습니다.',
      guide: '그래프에서 /opsbot 명령이 어떤 토큰으로 저장소에 닿는지 확인하세요.',
      prompts: [{ label: '저장소를 바꾸는 경로', question: 'payments-service 저장소를 바꿀 수 있는 경로를 알려줘. Slack 명령을 거치는 경로도 포함해줘.', select: 'asset' }],
    },
    {
      title: '부를 수 있는 사람과 저장소 권한자', check: 'gap',
      auto: '저장소에 쓰기 권한이 있는 사람과, /opsbot 명령으로 저장소를 바꿀 수 있는 사람을 함께 조회합니다. 슬래시 명령은 워크스페이스 누구나 부를 수 있어 두 집합의 차이가 큽니다.',
      guide: '원래 권한자와 명령으로 저장소를 바꿀 수 있는 사람을 함께 봅니다.',
      prompts: [{ label: '저장소를 바꿀 수 있는 사람', question: ASSET_ACCESS_QUESTION, select: 'asset' }],
    },
    {
      title: '권한 없는 사람의 실제 요청', check: 'outside',
      auto: '저장소 권한이 없는데 실제로 /opsbot을 불러 저장소를 바꾼 사람이 있는지, 봇의 요청 기록을 근거로 AI가 답합니다.',
      guide: '저장소 권한 없이 /opsbot을 부른 사람을 골라 질문하세요.',
      prompts: [{ label: '권한 없는 요청', question: '저장소 권한이 없는데 /opsbot으로 payments-service를 바꾼 사람이 있어? 요청 기록을 근거로 알려줘.', select: 'outside' }],
    },
    {
      title: '요청과 커밋 시각', open: 'board', check: 'log',
      auto: 'Event Board에서 payments-service push 원본 이벤트를 봅니다. push 세 건은 봇에 남은 /opsbot 요청 기록마다 1분 안에 이어집니다.',
      guide: 'push 이벤트를 보드에 올려 봇의 요청 기록 시각과 비교하세요.',
      prompts: [{ label: '요청과 push', question: 'payments-service git.push 원본 이벤트를 보여주고, 봇의 /opsbot 요청 기록 시각과 비교해줘.' }],
    },
    {
      title: '커밋 작성자', check: 'answer',
      auto: 'push한 계정은 세 번 모두 토큰 주인인 개발자입니다. GitHub 기록만 보면 정상 작업처럼 보이고, 실제로 요청한 사람은 봇의 요청 기록과 이어 봐야 드러납니다.',
      guide: 'push한 계정과 실제 요청한 사람을 비교하세요.',
      prompts: [{ label: 'push한 계정', question: 'payments-service에 push한 계정이 누구야? 실제로 요청한 사람과 같은지 원본 이벤트로 알려줘.' }],
    },
    {
      title: '조치', open: 'threat', check: 'threat', ask: false,
      auto: '위협 상세로 돌아가 권장 조치를 확인합니다. 명령을 부를 수 있는 사람을 줄이거나 봇이 쓰는 토큰의 권한을 줄이면 이 경로가 끊깁니다.',
      guide: '위협 상세의 조치 단계를 확인하세요.',
      prompts: [],
    },
  ],
}

const UC4: UseCase = {
  id: 'uc4',
  title: '시나리오 3. CI 비밀값에 든 Okta 최고 관리자 토큰',
  summary: '저장소 쓰기 권한만 있는 계정이 CI 비밀값의 토큰으로 Okta 최고 관리자 권한을 얻는 경로를 따라갑니다.',
  tip: '제보: 자리를 비운 IT 관리자 명의로 Okta 최고 관리자 권한이 새로 부여됐습니다.',
  done: '저장소 쓰기 권한자 계정으로 워크플로를 고친 push, 워크플로 실행, 그 토큰으로 한 Okta 최고 관리자 권한 부여까지 GitHub와 Okta 기록으로 확인했습니다.',
  findingId: 'FND-INT-FAF56FE2',
  targets: {
    // 워크플로 okta-user-sync, Okta 조직
    assetKeys: [
      'im:github:workflow:990000301',
      'im:okta:OrgSetting:00o18urbojxjOnmEx698',
    ],
    // identity-sync 저장소, 비밀값 OKTA_API_TOKEN, 토큰을 만든 Okta 최고 관리자
    pathKeys: [
      'im:github:Repository:990000102',
      'im:github:actions-secret:actions|990000102|OKTA_API_TOKEN',
      'im:okta:User:00uDEMO00000000016698',
    ],
    // 워크플로를 고친 저장소 쓰기 권한자의 GitHub, Okta 계정
    outsidePersonKeys: [
      'im:github:simple-user:990000013',
      'im:okta:User:00uDEMO00000000013698',
    ],
    leakEventPatterns: [/privilege\.grant|권한 부여/i],
  },
  steps: [
    {
      title: '위협 확인', open: 'threat', check: 'threat', ask: false,
      auto: 'AEGI가 탐지한 위협을 엽니다. Okta 관리 권한이 없는 저장소 쓰기 권한자도 워크플로를 고쳐 Okta 관리 작업을 할 수 있다는 판정입니다.',
      guide: '위협 상세에서 누가 어떤 경로로 Okta 관리 작업을 할 수 있는지 확인하세요.',
      prompts: [],
    },
    {
      title: '저장소에서 Okta 최고 관리자까지', open: 'graph', check: 'graph',
      auto: 'identity-sync 저장소, 워크플로 okta-user-sync, 비밀값 OKTA_API_TOKEN, 토큰을 만든 Okta 최고 관리자로 이어지는 경로를 그래프에서 봅니다.',
      guide: '그래프에서 워크플로가 어떤 신원으로 Okta에 닿는지 확인하세요.',
      prompts: [{ label: '워크플로의 실행 신원', question: '이 워크플로는 어떤 비밀값으로 무엇을 할 수 있어?', select: 'asset' }],
    },
    {
      title: '워크플로를 고칠 수 있는 사람', check: 'answer',
      auto: '워크플로 코드를 고칠 수 있는 사람과 Okta 관리 권한이 있는 사람을 비교합니다. 워크플로 파일은 저장소 안에 있어 저장소 쓰기 권한자가 고칠 수 있습니다.',
      guide: '워크플로를 고칠 수 있는 사람과 Okta 관리자를 비교하세요.',
      prompts: [{ label: '고칠 수 있는 사람', question: '이 워크플로 코드를 고칠 수 있는 사람과 Okta 관리 권한이 있는 사람을 비교해줘.', select: 'asset' }],
    },
    {
      title: '토큰이 닿는 범위', check: 'answer',
      auto: 'OKTA_API_TOKEN이 새면 Okta에서 무엇을 할 수 있는지, Okta로 로그인하는 다른 SaaS까지 어디에 닿는지 AI에게 묻습니다.',
      guide: '토큰이 새면 어디까지 닿는지 확인하세요.',
      prompts: [{ label: '토큰의 피해 범위', question: 'OKTA_API_TOKEN이 새면 Okta에서 무엇을 할 수 있고, Okta로 로그인하는 다른 SaaS까지 어디에 닿는지 알려줘.' }],
    },
    {
      title: 'push, 실행, Okta 관리 작업', open: 'board', check: 'leak',
      auto: 'Event Board에서 identity-sync 저장소 push, 워크플로 실행, 그 뒤 Okta 최고 관리자 권한 부여를 원본 이벤트로 시간순으로 봅니다. 권한 부여는 사람이 아니라 토큰 주인인 IT 관리자 이름으로 남았습니다.',
      guide: '저장소 push와 Okta 관리 작업을 보드에 올려 순서를 확인하세요.',
      prompts: [{ label: 'push와 Okta 관리 작업', question: '최근 identity-sync 저장소 push, 워크플로 실행, 그 뒤 Okta 관리자 권한 부여를 원본 이벤트로 시간순으로 보여줘.' }],
    },
    {
      title: '같은 방식의 사고와 탐지 신호', check: 'read', ask: false,
      auto: '탈취한 GitHub 계정으로 워크플로를 넣어 비밀값을 빼낸 공격은 실제로 있었습니다. 2025년 GhostAction은 저장소 817개에서 비밀값 3,325개를 빼냈고, Shai-Hulud 2.0은 저장소 2만 5천여 개에 퍼졌습니다. 2023년 Okta 지원 시스템 침해 뒤 Cloudflare는 교체하지 않은 토큰과 서비스 계정으로 침입을 당했습니다. 이 경로의 탐지 신호는 워크플로 파일을 바꾼 push 바로 뒤에 이어지는 Okta 관리 작업입니다.',
      guide: '같은 방식의 사고와 이 경로의 탐지 신호를 확인하세요.',
      prompts: [],
    },
    {
      title: '조치', open: 'threat', check: 'threat', ask: false,
      auto: '위협 상세로 돌아가 권장 조치를 확인합니다. 워크플로가 쓰는 Okta 토큰을 필요한 권한만 가진 서비스 앱으로 바꾸고, 워크플로 파일 변경에 검토를 거치게 하면 이 경로가 끊깁니다.',
      guide: '위협 상세의 조치 단계를 확인하세요.',
      prompts: [],
    },
  ],
}

export const USE_CASES: readonly UseCase[] = [UC1, UC2, UC4]

/**
 * 화면을 움직이며 강조하는 시연(src/ui/DemoTour.tsx)으로 하는 체험. 고르면 그 화면으로 옮겨 시연을 시작한다.
 * id 는 그 화면 DemoTour 의 id 와 같다(UC2-2 src/compliance/ComplianceDemoTour.tsx)
 */
export interface TourUseCase { id: string; title: string; summary: string; hash: string }
export const TOUR_USE_CASES: readonly TourUseCase[] = [
  { id: 'uc2-2', title: '시나리오 4. 개정 인증기준 사전 점검', summary: '세부 기준이 나오기 전에 강화 인증기준의 예상 기준으로 AI가 새 검사를 만들어 현행 결과와 비교합니다.', hash: '#compliance?framework=isms-p' },
]

/**
 * 데모 선택(첫 화면)의 시나리오 한 줄. 설정이 없는 줄은 「준비 중」.
 * badge 는 시나리오가 다루는 위협이나 점검의 분류(시연 경보 창 제목줄에도 쓴다), tone 은 배지 색(threat 빨강, caution 주황, neutral 남색).
 * scope 는 배지 옆에 두는 범위: 시나리오가 지나는 SaaS 로고, 또는 점검하는 인증기준 번호
 */
export interface LandingSlot {
  id: string
  label: string
  name: string
  badge: string
  tone: 'threat' | 'caution' | 'neutral'
  scope: { providers?: readonly ProviderId[]; text?: string }
}
export const LANDING_SLOTS: readonly LandingSlot[] = [
  { id: 'uc1', label: '시나리오 1. 퇴사 예정자의 거래 정보 유출', name: '퇴사 예정자의 거래 정보 유출', badge: '내부자 비인가 접근', tone: 'threat',
    scope: { providers: ['salesforce', 'slack', 'google-workspace'] } },
  { id: 'uc2', label: '시나리오 2. 공용 토큰을 쓰는 Slack 봇의 저장소 무단 변경', name: '공용 토큰을 쓰는 Slack 봇의 저장소 무단 변경', badge: '권한 남용', tone: 'threat',
    scope: { providers: ['slack', 'github'] } },
  { id: 'uc4', label: '시나리오 3. CI 비밀값에 든 Okta 최고 관리자 토큰', name: 'CI 비밀값에 든 Okta 최고 관리자 토큰', badge: '자격증명 위험', tone: 'threat',
    scope: { providers: ['github', 'okta'] } },
  { id: 'uc2-2', label: '시나리오 4. 개정 인증기준 사전 점검', name: '개정 인증기준 사전 점검', badge: '인증기준 변경 대응', tone: 'neutral', scope: { text: 'ISMS-P 2.5.3' } },
]
/** 첫 화면 SaaS 연결 그림의 SaaS. 위부터 시계 방향으로 놓는다 */
export const LANDING_SAAS: readonly ProviderId[] = ['slack', 'google-workspace', 'okta', 'github', 'atlassian', 'salesforce']
export const landingSlotById = (id: string) => LANDING_SLOTS.find(s => s.id === id)
export const tourUseCaseById = (id: string) => TOUR_USE_CASES.find(u => u.id === id)

export const useCaseById = (id: string) => USE_CASES.find(u => u.id === id)
