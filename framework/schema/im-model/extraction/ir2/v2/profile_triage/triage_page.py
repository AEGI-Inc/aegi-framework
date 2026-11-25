# -*- coding: utf-8 -*-
"""판단표 3차 3/3: 페이지와 표 코드 (-> out2/profile_triage/triage.html, decisions.json 에 code)"""
import collections
import html
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "out2", "profile_triage")
d = json.load(io.open(os.path.join(OUT, "decisions.json"), encoding="utf-8"))
items, FAM = d["items"], d["families"]
PN = {"github": "GitHub", "okta": "Okta", "slack": "Slack", "gws": "Google Workspace"}
ORDER = ["github", "okta", "slack", "gws"]
e = lambda s: html.escape(str(s or ""), quote=False)

BUCKETS = [
    ("A", "수집 추가 (우선)", "b-add", "권한을 주거나, 인증하거나, 테넌트 밖으로 나가는 경로에 걸린다. 다음 수집 작업의 범위로 권합니다."),
    ("B", "수집 추가 (다음)", "b-add", "탐지에 쓰이지만 A 다음에 합니다. 일부는 조건(엔터프라이즈 토큰, 기기 신뢰 탐지)을 적었습니다."),
    ("C", "기존 타입에 붙여 추가", "b-fix", "새 Profile이 아니라 이미 있는 타입의 속성이나 관계로 더합니다."),
    ("D", "이미 다른 형태로 다룸", "b-keep", "속성, 관측, 신원 Link, 관계로 이미 들어옵니다. Profile을 만들지 않습니다."),
    ("E", "조건부 보류", "b-keep", "특정 제품, 라이선스를 쓰는 테넌트에서만 생깁니다. 연구 카탈로그에 그대로 두고, 그런 테넌트를 수집할 때 다시 엽니다."),
    ("F", "수집 안 함", "b-keep", "콘텐츠, 실행 기록, 표시 설정이라 접근 권한 판단에 쓰이지 않습니다. 이유를 기록하고 닫습니다."),
    ("G", "원문 확인 필요", "b-fix", "근거 API가 연구 원문 스펙에 없습니다. 스펙을 받아 연구를 다시 돌린 뒤 A~F로 나눕니다."),
]


def tgt(x):
    st = "IM 연구 타입 있음" if x["st"] == "research" else "IM 연구에 없음"
    rif = (" → 연구 " + ", ".join(x["rif"])) if x["rif"] and x["rif"] != [x["if"]] else ""
    return f'<span class="mono">{e(x["id"])}</span> {e(x["name"])} <span class="mono">[{e(x["if"])}{e(rif)}]</span> <span class="badge b-keep">{st}</span>'


groups = collections.OrderedDict()
for x in items:
    k = (x["bucket"], x["family"] or "", x["fact"], x["rec"]) if x["bucket"] in "EF" and x["family"] else (x["bucket"], x["p"], x["fact"], x["rec"])
    groups.setdefault(k, []).append(x)

cnt = collections.Counter(x["bucket"] for x in items)
pcnt = collections.Counter((x["p"], x["bucket"]) for x in items)

parts = []
code_no = collections.Counter()
for b, title, cls, desc in BUCKETS:
    gs = [(k, v) for k, v in groups.items() if k[0] == b]
    gs.sort(key=lambda kv: (ORDER.index(kv[1][0]["p"]), kv[0][1]))
    parts.append(f'<h2 id="{b}">{b}. {title} <span class="cnt">{cnt[b]}개</span></h2><p>{e(desc)}</p>')
    parts.append('<div class="scroll"><table><thead><tr><th>코드</th><th>SaaS</th><th>대상</th><th>확인한 사실</th><th>권고</th></tr></thead><tbody>')
    for k, v in gs:
        code_no[b] += 1
        code = f"{b}{code_no[b]:02d}"
        for x in v:
            x["code"] = code
        provs = sorted({x["p"] for x in v}, key=ORDER.index)
        fam = FAM.get(k[1]) if b in "EF" else None
        fact = v[0]["fact"]
        if fam:
            fact = (f"<b>{e(fam[1])}</b>: {e(fam[2])}" + (f" {e(fact)}" if fact else ""))
        else:
            fact = e(fact)
        carto = sorted({c for x in v for c in x["carto"]})
        if carto:
            fact += f'<div class="sub">Cartography: {e(", ".join(carto))}</div>'
        apis = [x["api"].split("\n")[0][:120] for x in v if x["api"]]
        if apis and b in "ABCG":
            fact += '<div class="sub mono">' + "<br>".join(e(a) for a in apis[:4]) + (f"<br>외 {len(apis)-4}개" if len(apis) > 4 else "") + "</div>"
        targets = "<br>".join(tgt(x) for x in v)
        rec = f'<span class="badge {cls}">{e(title)}</span> {e(v[0]["rec"])}'
        parts.append(f'<tr><td class="code">{code}</td><td>{e(", ".join(PN[p] for p in provs))}</td><td>{targets}</td><td>{fact}</td><td class="rec">{rec}</td></tr>')
    parts.append("</tbody></table></div>")

mat = ['<div class="scroll"><table class="mat"><thead><tr><th>SaaS</th>' + "".join(f'<th class="n">{b} {t}</th>' for b, t, _, _ in BUCKETS) + '<th class="n">합계</th></tr></thead><tbody>']
for p in ORDER:
    row = [pcnt[(p, b)] for b, *_ in BUCKETS]
    mat.append(f"<tr><td>{PN[p]}</td>" + "".join(f'<td class="n">{v or "-"}</td>' for v in row) + f'<td class="n">{sum(row)}</td></tr>')
mat.append("<tr><th>합계</th>" + "".join(f'<th class="n">{cnt[b]}</th>' for b, *_ in BUCKETS) + f'<th class="n">{len(items)}</th></tr></tbody></table></div>')

tpl = io.open(os.path.join(HERE, "triage_template.html"), encoding="utf-8").read()
out = tpl.replace("__MATRIX__", "".join(mat)).replace("__BODY__", "".join(parts))
for b, *_ in BUCKETS:
    out = out.replace(f"__N{b}__", str(cnt[b]))
assert "·" not in out
io.open(os.path.join(OUT, "triage.html"), "w", encoding="utf-8").write(out)
print(len(out), dict(cnt))
json.dump({"items": items, "families": FAM}, io.open(os.path.join(OUT, "decisions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
