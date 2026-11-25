"""11-11 AEGI 자체 점검(engine scripts/standards/aegi_*.py, finding <SaaS>-9xx)을 항목에 잇고,
그 점검으로 데이터 판정이 생긴 근거 제공 항목을 자동 판정으로 올린다. 다시 돌려도 결과가 같다.
사용: python3 checks/apply_aegi_checks_1111.py  (뒤에 items-clean/apply_scope_1111.py 를 돌린다)
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ITEMS = os.path.join(HERE, "..", "items-clean")
rd = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]

INACTIVE = ["gws-901", "okta-901", "salesforce-901"]
LEFTOVER = ["gws-902", "okta-902", "salesforce-902", "slack-901"]
LINKS = {
    "ISO27001:5.16": INACTIVE + LEFTOVER,
    "ISMS-P:2.5.1-01": INACTIVE,
    "ISMS-P:2.2.5-02": LEFTOVER,
    "PIPA:admin-73493:article-5:p2": LEFTOVER,
    "ISO27001:8.1": ["gws-903", "gws-904", "gws-905"],
    "PIPA:admin-73493:article-7:p5": ["gws-903"],
    "PIPA:admin-73493:article-6:p5": ["gws-904", "gws-905"],
}
PROMOTE = {  # 근거 제공 → 자동 판정. 사유는 판정하는 점검으로 바꾼다
    "ISO27001:5.16": "장기 미로그인 계정, IdP 에서 정지된 사용자의 남은 계정(AEGI 자체 점검)과 프로비저닝 점검이 계정 수명주기를 판정한다",
    "ISO27001:8.1": "기기 암호화, 화면 잠금 비밀번호, 관리 승인(AEGI 자체 점검)과 기기 정책 점검이 단말 보호를 판정한다",
    "ISMS-P:2.2.5-02": "IdP 에서 정지된 사용자의 남은 계정(AEGI 자체 점검)과 퇴사자 계정 점검이 권한 회수를 판정한다",
    "PIPA:admin-73493:article-5:p2": "IdP 에서 정지된 사용자의 남은 계정(AEGI 자체 점검)과 퇴사자 계정 점검이 권한 말소를 판정한다",
    "PIPA:admin-73493:article-6:p5": "기기 화면 잠금 비밀번호, 관리 승인(AEGI 자체 점검)과 모바일 정책 점검",
    "PIPA:admin-73493:article-7:p5": "기기 암호화 상태(AEGI 자체 점검)와 기기 암호화 정책 점검",
}


def rewrite(path, rows, **kw):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, **kw) + "\n")


# 1. 점검 연결
path = os.path.join(HERE, "item-findings.jsonl")
rows = rd(path)
by = {r["item_key"]: r for r in rows}
for key, fids in LINKS.items():
    if key not in by:
        raise SystemExit(f"연결 파일에 없는 항목: {key}")
    by[key]["finding_ids"] = sorted(set(by[key]["finding_ids"]) | set(fids))
rewrite(path, rows, separators=(",", ":"))

# 2. 등급. ISO 는 결정 기록과 item-tiers 를 함께, ISMS-P 와 PIPA 는 결정 기록만(apply_scope_1111.py 가 item-tiers 에 반영)
for name, iso in (("iso-scope-1111.jsonl", True), ("scope-review-1111.jsonl", False)):
    path = os.path.join(ITEMS, name)
    rows = rd(path)
    for r in rows:
        if r["item_key"] in PROMOTE:
            r["reason"] = PROMOTE[r["item_key"]]
            if not iso:
                r["tier"] = "auto"
    rewrite(path, rows)
path = os.path.join(ITEMS, "item-tiers.jsonl")
rows = rd(path)
for r in rows:
    if r["item_key"] in PROMOTE and r["item_key"].startswith("ISO27001:"):
        r["tier"], r["reason"] = "auto", PROMOTE[r["item_key"]]
rewrite(path, rows)
print({"linked": sum(len(v) for v in LINKS.values()), "promoted": len(PROMOTE)})
