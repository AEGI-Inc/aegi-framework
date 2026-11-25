# -*- coding: utf-8 -*-
"""판단표 4차: 관계 없는 객체와 객체 참조를 관계로 올릴지 (-> out2/reference_triage/triage.html, data.json)

입력은 v1 실측 데이터셋 src/data/aegi_inc_measured_model_v1 의 objects.json, relations.json 이다.
고아는 relations.json 의 source, target, role 어느 칸에도 나오지 않는 객체로 센다.
"""
import collections
import html
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IR2 = os.path.dirname(os.path.dirname(HERE))
ROOT = os.path.dirname(os.path.dirname(IR2))
DATA = os.path.join(ROOT, "src", "data", "aegi_inc_measured_model_v1")
OUT = os.path.join(IR2, "out2", "reference_triage")
os.makedirs(OUT, exist_ok=True)


def load(name, key):
    j = json.load(io.open(os.path.join(DATA, name), encoding="utf-8"))
    return j if isinstance(j, list) else j[key]


O = load("objects.json", "objects")
R = load("relations.json", "relations")
obj = {o["fixture_key"]: o for o in O}
ot = lambda k: obj[k]["canonical"]["object_type"]
pv = lambda k: obj[k]["canonical"]["provider"]

st_used, role_used, prop_used = set(), set(), set()
for r in R:
    c = r["canonical"]
    for slot, x in c["references"].items():
        (role_used if slot == "role" else st_used).add(x["value"])
    for v in (c.get("properties") or {}).values():
        for y in v if isinstance(v, list) else [v]:
            if isinstance(y, str) and y in obj:
                prop_used.add(y)

no_st = [k for k in obj if k not in st_used]
orph = [k for k in no_st if k not in role_used]
by_role = [k for k in no_st if k in role_used]
cnt = collections.Counter((pv(k), ot(k)) for k in orph)
roles = collections.Counter((pv(k), ot(k)) for k in by_role)


def n(p, t):
    return cnt[(p, t)]


# 관계 없는 tenant 소속: SaaS별 사용자 중 member_of → Tenant 관계가 없는 수
tenant_member = collections.Counter()
users = collections.Counter()
for r in R:
    c = r["canonical"]
    t = c["references"]["target"]["value"]
    if c["relation_type"] == "member_of" and t in obj and "Tenant" in obj[t]["canonical"]["interfaces"]:
        tenant_member[c["references"]["source"]["value"]] += 1
for k, o in obj.items():
    c = o["canonical"]
    if "Principal" in c["interfaces"] and c["object_type"].lower() in ("user", "user account"):
        users[(c["provider"], k in tenant_member)] += 1

# 참조 칸 집계 (tenant 제외), 관계로 이미 올라간 것
pairs = collections.defaultdict(set)
for r in R:
    c = r["canonical"]["references"]
    pairs[frozenset((c["source"]["value"], c["target"]["value"]))].add(r["canonical"]["relation_type"])
refs = collections.Counter()
lifted = collections.Counter()
for k, o in obj.items():
    for slot, rv in (o["canonical"].get("references") or {}).items():
        if slot == "tenant":
            continue
        for t in rv.get("targets", []):
            refs[slot] += 1
            if pairs.get(frozenset((k, t["value"]))):
                lifted[slot] += 1

rs_used = {r["canonical"]["properties"].get("resource_set") for r in R} - {None}
rs_objs = [k for k in obj if ot(k) == "ResourceSet"]
rs_pointed = sum(1 for k in rs_objs if obj[k]["canonical"]["identifiers"]["id"]["value"] in rs_used)
assignment_orph = [k for k in orph if k in prop_used]
gh_org_parent = sum(1 for k in obj if ot(k) == "Organization" and pv(k) == "github" and (obj[k]["canonical"].get("references") or {}).get("parent") and not any(pairs.get(frozenset((k, t["value"]))) for t in obj[k]["canonical"]["references"]["parent"]["targets"]))
author_n = refs["author"]

S = {
    "objects": len(O), "relations": len(R), "no_st": len(no_st), "by_role": len(by_role), "orph": len(orph),
    "assign": len(assignment_orph), "ca": n("github", "Credential Authorization"), "tok": n("gws", "Token"),
    "grule": n("okta", "GroupRule"), "rs": n("okta", "ResourceSet"), "rs_pointed": rs_pointed, "hook": n("github", "Webhook"),
    "gws_user": n("gws", "User"), "gws_role": n("gws", "Role"), "iam": n("okta", "IamRole"), "okgrp": n("okta", "Group"),
    "repo": n("github", "Repository"), "form": n("gws", "Form"), "author": author_n, "org_parent": gh_org_parent,
    "parent_refs": refs["parent"] + refs["parent_file"], "parent_lifted": lifted["parent"] + lifted["parent_file"],
    "roles": {f"{p} {t}": v for (p, t), v in roles.items()},
    "users": {f"{p} {'있음' if m else '없음'}": v for (p, m), v in users.items()},
    "orphans": {f"{p} {t}": v for (p, t), v in cnt.most_common()},
}
tenant_gap = sum(v for (p, m), v in users.items() if not m)
S["tenant_gap"] = tenant_gap
S["tenant_gap_by"] = {p: v for (p, m), v in users.items() if not m}

# 92 = 배정 26 + 엔진 미독 40 + 관계 후보 8 + 참조 유지 1 + 연결 없음이 맞음 17
cand = S["grule"] + S["rs_pointed"] + S["hook"] + S["gws_user"]
right = S["gws_role"] + S["iam"] + (S["rs"] - S["rs_pointed"]) + S["okgrp"] + S["repo"]
parts = {"배정 객체": S["assign"], "엔진이 읽지 않음": S["ca"] + S["tok"], "관계로 올릴 후보": cand, "참조로 유지": S["form"], "연결 없음이 맞음": right}
assert sum(parts.values()) == S["orph"], (parts, S["orph"])
S["parts"] = parts

e = lambda s: html.escape(str(s), quote=False)
PN = {"github": "GitHub", "okta": "Okta", "slack": "Slack", "gws": "Google Workspace"}

ROWS = [
    ("A", "관계로 올림", "b-add", [
        ("Q01", "Okta", f"그룹 규칙 {S['grule']}개", "규칙의 assign_groups 값이 수집된 그룹(Manager → Finance-App 규칙의 대상 그룹)을 가리킨다. 관계가 없어 규칙이 누구를 그룹에 넣는지 그래프에 없다. 탐지 엔진도 읽지 않는다.",
         "GroupRule applies_to Group 관계를 만든다. 템플릿 Policy → Principal에 맞고, 근거는 stated."),
        ("Q02", "Okta", f"리소스 세트 {S['rs']}개 중 {S['rs_pointed']}개", "관리 역할 배정(has_role_on)이 resource_set 속성에 원래 ID 문자열만 담는다. 객체 키가 아니라서 리소스 세트 객체와 이어지지 않는다. 엔진은 이 속성으로 「범위 미전개」 불확실만 붙인다.",
         "관계 대상은 그대로 org로 둔다. resource_set을 관계의 범위 참조(객체 키)로 바꾼다. 관계 템플릿에 범위 칸이 없으므로 aegi-schema에 제안한다. 대안은 대상을 리소스 세트로 바꾸는 것인데 탐지 결과가 달라진다."),
        ("Q03", "GitHub", f"조직 {S['org_parent']}개", "배정 객체가 아닌 객체의 parent 참조 중 이 조직의 parent(엔터프라이즈)만 관계로 올라가지 않았다. 나머지는 contained_in 등으로 올라가 있다.",
         "Organization contained_in Enterprise 관계를 만든다. 템플릿 any → any."),
        ("Q04", "GitHub", f"조직 웹훅 {S['hook']}개", "조직 수준 웹훅이 tenant 참조만 갖는다. Slack 웹훅은 owned_by로 주인 앱과 이어져 있다.",
         "Webhook owned_by Organization 관계를 만든다. 템플릿 Endpoint → Tenant."),
        ("Q05", "Google Workspace, Okta", f"tenant 소속 관계 없는 사용자 {S['tenant_gap']}명 (그중 고아 {S['gws_user']}명)", "Slack, GitHub은 사용자 → 워크스페이스, 조직 member_of 관계를 만든다. Google과 Okta는 만들지 않고 tenant 참조로만 둔다. 그래서 그룹, 역할, 파일이 없는 Google 사용자 4명이 고아가 됐다. 엔진은 tenant 참조를 소속으로 읽어 탐지에는 영향이 없다.",
         "사용자 목록 호출로 받은 사용자는 SaaS 상관없이 member_of Tenant 관계를 만든다. 템플릿 Principal → Tenant."),
    ]),
    ("B", "관계 없이 탐지 엔진에서 다룸", "b-fix", [
        ("Q06", "GitHub", f"자격 증명 승인 {S['ca']}개", "SAML SSO 조직에 승인된 앱 토큰 23, OAuth 앱 토큰 2, 개인 토큰 2개다. Assignment인데 grantee만 있고 parent가 없어, 엔진의 권한 배정 규칙(parent와 grantee가 모두 있어야 함)이 건너뛴다. 결국 그래프에도 엔진에도 없다.",
         "관계는 만들지 않는다. 사용자의 권한을 새로 주는 것이 아니라 그 사용자의 토큰이 조직에 들어올 수 있게 한 기록이기 때문이다. 엔진에 「조직에 승인된 자격 증명」 규칙을 v2 과제로 둔다."),
        ("Q07", "Google Workspace", f"OAuth 토큰 {S['tok']}개", "v2 대장 open_items[10]에서 관계를 만들지 않기로 정했다. 객체는 남아 있다. 하지만 parent와 grantee가 같은 사용자이고 client는 수집되지 않은 외부 앱이라, 엔진 간선이 하나도 생기지 않는다. Team Directory 2개는 시나리오 H 웹앱인데 수집된 객체와 이어지지 않는다.",
         "결정은 유지한다. client를 수집된 Google 프로젝트나 연동과 잇는 규칙은 OAuth 앱 수집(V2-P1 Google 묶음) 때 정한다. 그 전에는 고아로 남는 것을 정상으로 기록한다."),
    ]),
    ("C", "참조로 유지", "b-keep", [
        ("Q08", "Okta, Google Workspace, GitHub", f"배정 객체 {S['assign']}개", "앱 배정 16, 파일 권한 3, 관리 역할 배정 3, 개인 토큰 승인 2, 그룹 앱 배정 2개다. 모두 has_role_on 관계가 via_assignment, via_grant 속성으로 가리킨다. 사실은 이미 그래프에 있다.",
         "2홉(주체 → 배정 → 자원)으로 바꾸지 않는다. Assignment는 관계 템플릿 어디에도 없어 바꾸려면 규격부터 바꿔야 한다. 같은 사실이 has_role_on 한 줄과 역할 칸으로 표현된다."),
        ("Q09", "GitHub, Slack", f"작성자 참조 {S['author']}건", "커밋, 메시지의 author. 맞는 관계 템플릿이 없다. 엔진이 「작성자」 쓰기 간선으로 읽는다.",
         "참조로 유지한다."),
        ("Q10", "Google Workspace", f"폼 {S['form']}개", "linked_sheet 참조로 응답 시트 파일을 가리킨다. 맞는 템플릿이 없고 엔진도 읽지 않는다.",
         "참조로 유지한다. 폼 응답이 시트로 흘러가는 경로가 탐지에 필요해지면 그때 템플릿을 제안한다."),
    ]),
    ("D", "연결 없음이 맞음", "b-keep", [
        ("Q11", "Google Workspace, Okta, GitHub", f"{right}개", f"아무에게도 배정되지 않은 Google 관리 역할 {S['gws_role']}, Okta 관리 역할 {S['iam']}, Okta 리소스 세트 {S['rs'] - S['rs_pointed']}, 구성원이 없는 Okta 그룹 {S['okgrp']}(Okta Administrators, Okta-Targets), 협업자가 없는 GitHub 저장소 {S['repo']}개다.",
         "그대로 둔다. 정의는 있지만 쓰이지 않는 것이라 연결이 없는 것이 사실이다."),
    ]),
]

body = []
for b, title, cls, rows in ROWS:
    body.append(f'<h2 id="{b}">{b}. {e(title)}</h2>')
    body.append('<div class="scroll"><table><thead><tr><th>코드</th><th>SaaS</th><th>대상</th><th>확인한 사실</th><th>권고</th></tr></thead><tbody>')
    for code, saas, tgt, fact, rec in rows:
        body.append(f'<tr><td class="code">{code}</td><td>{e(saas)}</td><td>{e(tgt)}</td><td>{e(fact)}</td><td class="rec"><span class="badge {cls}">{e(title)}</span> {e(rec)}</td></tr>')
    body.append("</tbody></table></div>")

mat = ['<div class="scroll"><table class="mat"><thead><tr><th>분류</th><th class="n">객체</th></tr></thead><tbody>']
for k, v in parts.items():
    mat.append(f'<tr><td>{e(k)}</td><td class="n">{v}</td></tr>')
mat.append(f'<tr><th>관계 없는 객체</th><th class="n">{S["orph"]}</th></tr></tbody></table></div>')

orows = "".join(f'<tr><td>{e(PN[k.split(" ", 1)[0]])}</td><td>{e(k.split(" ", 1)[1])}</td><td class="n">{v}</td></tr>' for k, v in S["orphans"].items())
rrows = "".join(f'<tr><td>{e(PN[k.split(" ", 1)[0]])}</td><td>{e(k.split(" ", 1)[1])}</td><td class="n">{v}</td></tr>' for k, v in sorted(S["roles"].items()))

tpl = io.open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
out = tpl
for k, v in {"__BODY__": "".join(body), "__MATRIX__": "".join(mat), "__ORPHANS__": orows, "__ROLES__": rrows}.items():
    out = out.replace(k, v)
for k, v in S.items():
    if not isinstance(v, dict):
        out = out.replace(f"__{k.upper()}__", str(v))
assert "__" not in out.replace("__init__", ""), [x for x in out.split("__") if x.isupper()][:5]
assert "·" not in out
io.open(os.path.join(OUT, "triage.html"), "w", encoding="utf-8").write(out)
json.dump(S, io.open(os.path.join(OUT, "data.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in S.items() if k in ("objects", "relations", "no_st", "by_role", "orph", "tenant_gap", "tenant_gap_by", "parts", "parent_refs", "parent_lifted")}, ensure_ascii=False))
