"""PIPA 문서 단위 거르기. 회사(개인정보처리자)가 자기 SaaS 에서 지켜야 할 의무가 담긴 문서만 남긴다.
남긴 문서의 항은 항목별 판정(S1 다시 하기)으로 간다. 뺀 문서는 사유와 함께 기록한다.
"""
import json, sys
from pathlib import Path

SRC = Path(sys.argv[1])   # pipa.paragraphs.jsonl
OUT = Path(sys.argv[2])   # 폴더

KEEP = {
    '개인정보 보호법': '처리자 의무의 근거 법률',
    '개인정보 보호법 시행령': '처리자 의무의 세부(안전조치, 국외이전, 파기 등)',
    '개인정보의 안전성 확보조치 기준': '접근권한, 접근통제, 인증, 접속기록, 암호화 등 기술 조치 기준',
    '표준 개인정보 보호지침': '처리자의 처리 단계별 지침(수집, 이용, 제공, 위탁, 파기)',
    '개인정보 처리 방법에 관한 고시': '처리 방법(동의, 파기 방법 등) 세부',
    '개인정보 국외 이전 운영 등에 관한 규정': 'SaaS 데이터의 국외 저장·이전',
    '가명정보 관리 및 제공에 관한 규정': '처리자의 가명정보 처리·관리',
    '자동화된 결정에 대한 개인정보처리자의 조치 기준': '처리자의 자동화된 결정(AI 기능 포함) 조치',
}
DROP = {
    '정보보호 및 개인정보보호 관리체계 인증 등에 관한 고시': '인증 절차·심사원·인증기관 규정. 인증기준 자체는 ISMS-P 항목으로 따로 다룬다',
    '개인정보 보호위원회의 조사 및 처분에 관한 규정': '위원회 조사·처분 절차',
    '국경 간 개인정보 보호 규칙 인증제도의 운영에 관한 지침': 'CBPR 인증기관·심사 절차',
    '개인정보 보호위원회 운영규칙': '위원회 내부 운영',
    '개인정보 영향평가에 관한 고시': '공공기관 영향평가와 평가기관 지정 절차',
    '가명정보의 결합 및 반출 등에 관한 고시': '결합전문기관의 결합·반출 절차',
    '(개인정보보호위원회) 개인정보 보호 자율규제단체 지정 및 운영 등에 관한 규정': '자율규제단체 지정 절차',
    '개인정보 전송 및 개인정보관리 전문기관 지정 등에 관한 고시': '마이데이터 전송·전문기관(11-08 사용자 제외 결정과 같음)',
    '가스 분야 개인정보 전송에 관한 고시': '분야별 마이데이터 전송',
    '보건의료 분야 개인정보 전송에 관한 고시': '분야별 마이데이터 전송',
    '통신 분야 개인정보 전송에 관한 고시': '분야별 마이데이터 전송',
    '전기 분야 개인정보 전송에 관한 고시': '분야별 마이데이터 전송',
    '개인정보 보호법 위반에 대한 과징금 부과기준': '제재 산정 기준',
    '개인정보 보호법 위반에 대한 과태료 부과기준': '제재 산정 기준',
    '개인정보 보호법 위반에 대한 공표 및 공표명령 지침': '제재 공표 절차',
    '개인정보 보호 법규 위반에 대한 징계권고 기준': '공무원 징계권고 기준',
    '개인정보 보호 법규 위반에 대한 고발 기준': '위원회 고발 기준',
    '헌법재판소 개인정보 보호 규칙': '헌법재판소 내부 규칙',
    '법원 개인정보 보호에 관한 규칙': '법원 내부 규칙',
    '선거관리위원회 개인정보 보호에 관한 규칙': '선관위 내부 규칙',
    '개인정보 단체소송규칙': '소송 절차',
    '디지털 포렌식 지원 및 증거 보관·관리 규정': '위원회의 포렌식·증거 관리',
    '개인정보보호위원회 사전적정성 검토제 운영규정': '위원회 사전 검토 신청 절차',
    '개인정보 처리방침 평가에 관한 고시': '위원회의 처리방침 평가 절차',
    '개인정보 보호수준 평가에 관한 고시': '공공기관 보호수준 평가',
    '개인정보 보호책임자 지정 및 경력 인정에 관한 고시': 'CPO 자격·경력 인정(조직 인사)',
}
rows = [json.loads(l) for l in SRC.read_text(encoding='utf-8').splitlines() if l.strip()]
docs = sorted({r['document'] for r in rows})
unknown = [d for d in docs if d not in KEEP and d not in DROP]
if unknown:
    raise SystemExit(f'분류 안 된 문서: {unknown}')
keep = [r for r in rows if r['document'] in KEEP]
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'pipa.paragraphs.keep.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in keep), encoding='utf-8', newline='\n')
summary = []
for d in docs:
    n = sum(1 for r in rows if r['document'] == d)
    summary.append({'document': d, 'paragraphs': n, 'decision': 'keep' if d in KEEP else 'drop', 'reason': KEEP.get(d) or DROP.get(d)})
(OUT / 'pipa.documents.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8', newline='\n')
print('keep docs', len(KEEP), 'paragraphs', len(keep), '/ drop docs', len(DROP), 'paragraphs', len(rows) - len(keep))
