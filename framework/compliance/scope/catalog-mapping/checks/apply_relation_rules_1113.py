"""11-13 관계 점검(relation-rules.yaml 패턴 R1~R7, 사람 확인 958)과 11-14 설정 규칙(setting_rules S1~S9, 961~969)을
항목에 잇고, GWS 정책 중 보안 의미가 약한 설정 종류를 값 → 태그 표에서 비운다. 다시 돌려도 결과가 같다.
사용: python3 checks/apply_relation_rules_1113.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
rd = lambda p: [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def rewrite(path, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")  # 원본과 같은 모양


# relation-rules.yaml 에서 패턴 번호와 항목 목록만 읽는다(표준 라이브러리만 쓰려고 단순 파싱)
def load_rules(path):
    providers, groups, cur = [], {}, None
    for line in open(path, encoding="utf-8"):
        s = line.rstrip("\n")
        m = re.match(r"^  providers: \[(.*)\]", s)
        if m:
            providers = [p.strip() for p in m.group(1).split(",")]
        m = re.match(r"^  (R\d):$", s) or re.match(r"^(manual_items):$", s)
        if m:
            cur = {"number": None, "items": []}
            groups[m.group(1)] = cur
            continue
        if re.match(r"^\S", s) and not s.startswith("manual_items"):
            if not s.startswith("patterns"):
                cur = None
        if cur is None:
            continue
        m = re.match(r"^\s+number: (\d+)", s)
        if m:
            cur["number"] = int(m.group(1))
        m = re.match(r"^\s+- ((?:ISMS-P|ISO27001|PIPA):\S+)", s)
        if m:
            cur["items"].append(m.group(1))
    return providers, groups


# setting_rules: 규칙마다 number 와 provider 별 items(한 줄 목록 「      okta: [a, b]」)
def load_setting_rules(path):
    out, cur, inside, in_items = {}, None, False, False
    for line in open(path, encoding="utf-8"):
        s = line.rstrip("\n")
        if re.match(r"^\S", s):
            inside = s.startswith("setting_rules:")
            continue
        if not inside:
            continue
        m = re.match(r"^  - id: (S\d+)$", s)
        if m:
            cur = out.setdefault(m.group(1), {"number": None, "items": {}})
            in_items = False
            continue
        m = re.match(r"^    number: (\d+)$", s)
        if m and cur is not None:
            cur["number"] = int(m.group(1))
        if re.match(r"^    \S", s):
            in_items = s.strip() == "items:"
            continue
        m = re.match(r"^      ([a-z]+): \[(.*)\]$", s)
        if m and in_items and cur is not None:
            cur["items"][m.group(1)] = [x.strip() for x in m.group(2).split(",") if x.strip()]
    return out


providers, groups = load_rules(os.path.join(HERE, "relation-rules.yaml"))
settings = load_setting_rules(os.path.join(HERE, "relation-rules.yaml"))
assert len(settings) == 9 and all(v["number"] and v["items"] for v in settings.values()), settings
assert providers and len(groups) == 8, (providers, list(groups))
links = {}
for name, g in groups.items():
    assert g["number"] and g["items"], name
    for item in g["items"]:
        links.setdefault(item, [])
        links[item] += [f"{p}-{g['number']}" for p in providers]
for sid, g in settings.items():
    for p, items in g["items"].items():
        assert p in providers, (sid, p)
        for item in items:
            links.setdefault(item, []).append(f"{p}-{g['number']}")

# 1. 점검 연결
path = os.path.join(HERE, "item-findings.jsonl")
rows = rd(path)
by_key = {r["item_key"]: r for r in rows}
scope = {r["item_key"] for r in rd(os.path.join(ROOT, "items-clean", "saas-items.jsonl"))}
missing = sorted(k for k in links if k not in scope)
assert not missing, f"범위 밖 항목: {missing}"
added = 0
for key, fids in sorted(links.items()):
    r = by_key.get(key)
    if r is None:
        r = {"item_key": key, "finding_ids": [], "note": ""}
        rows.append(r)
        by_key[key] = r
    before = set(r["finding_ids"])
    r["finding_ids"] = sorted(before | set(fids))
    added += len(set(r["finding_ids"]) - before)
rewrite(path, rows)  # 원본 줄 순서를 지킨다(새 항목만 끝에)
print(f"항목 {len(links)}개에 관계 점검, 설정 규칙 연결 {added}개(설정 규칙 {len(settings)}개)")

# 2. GWS 정책 값 → 태그: 보안 의미가 약한 설정 종류를 비운다(2026-11-13 사용자 결정, 규칙은 만들지 않는다)
WEAK = {
    "settings/api_controls.custom_user_message": "앱 차단 안내 문구",
    "settings/classroom.guardian_access": "Classroom 보호자 접근",
    "settings/devices.ios_apple_intelligence": "iOS Apple Intelligence 사용",
    "settings/devices.ios_date_time": "iOS 날짜, 시간 설정",
    "settings/directory.workspace_resource_type_visibility": "디렉터리 자원 종류 표시",
    "settings/gemini_app.unlicensed_user_access": "라이선스 없는 사용자의 Gemini 앱 사용",
    "settings/sites.sites_creation_and_modification": "Sites 만들기, 고치기",
}
vpath = os.path.join(ROOT, "value-tags", "value-tags.jsonl")
vrows = rd(vpath)
hit = 0
for r in vrows:
    if r["type_key"] == "gws:Policy" and r["value"] in WEAK:
        if r["tags"] or r.get("extra"):
            hit += 1
        r["tags"], r["extra"] = [], []
        r["note"] = f"2026-11-13 보안 의미 약함({WEAK[r['value']]}), 항목 대상에서 뺌"
found = {r["value"] for r in vrows if r["type_key"] == "gws:Policy"}
assert set(WEAK) <= found, set(WEAK) - found
rewrite(vpath, vrows)
print(f"GWS 정책 설정 종류 {len(WEAK)}개 비움(바뀐 줄 {hit})")
