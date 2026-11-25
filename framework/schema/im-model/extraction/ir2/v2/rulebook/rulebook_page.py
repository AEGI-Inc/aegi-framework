# -*- coding: utf-8 -*-
"""규칙집 페이지 (-> out2/rulebook/rulebook.html). rules.json 과 backtest.py 결과를 읽는다"""
import html
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
IR2 = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(IR2, "out2", "rulebook")
load = lambda p: json.load(io.open(p, encoding="utf-8"))
rules = load(os.path.join(HERE, "rules.json"))
bt = load(os.path.join(OUT, "backtest.json"))["summary"]
e = lambda s: html.escape(str(s), quote=False)

STAGE_ORDER = ["M", "O", "S", "I", "R", "L", "C"]
AUTO = {True: ("코드가 검사", "b-add"), "partial": ("일부 자동", "b-fix"), False: ("사람 답", "b-keep")}
src = bt["by_source"]
judg, expl = bt["judgments"], bt["explained"]
auto_rules = [r for r in rules["rules"] if r["auto"] is True]
partial_rules = [r for r in rules["rules"] if r["auto"] == "partial"]
pred = bt["auto_prediction_triage"]

body = []
for st in STAGE_ORDER:
    rs = [r for r in rules["rules"] if r["stage"] == st]
    if not rs:
        continue
    n = sum(bt["by_rule"].get(r["id"], 0) for r in rs)
    body.append(f'<h2 id="{st}">{st}. {e(rules["stages"][st])} <span class="cnt">규칙 {len(rs)}개, 지난 결정 {n}건</span></h2>')
    body.append('<div class="scroll"><table><thead><tr><th>규칙</th><th>묻는 것</th><th>결과</th><th>근거 결정</th><th class="n">지난 결정</th><th>판정 방식</th></tr></thead><tbody>')
    for r in rs:
        label, cls = AUTO[r["auto"]]
        how = f'<span class="badge {cls}">{label}</span>' + (f'<div class="sub mono">{e(r["enforced_by"])}</div>' if r.get("enforced_by") else "")
        then = e(r["then"]) + (f'<div class="sub">{e(r["note"])}</div>' if r.get("note") else "")
        body.append(f'<tr><td class="code">{r["id"]}</td><td>{e(r["question"])}</td><td>{then}</td><td>{e(", ".join(r["decisions"]))}</td><td class="n">{bt["by_rule"].get(r["id"], "-")}</td><td>{how}</td></tr>')
    body.append("</tbody></table></div>")

srows = "".join(f'<tr><td>{e(k)}</td><td class="n">{v.get("설명됨", 0)}</td><td class="n">{v.get("규칙 없음", 0)}</td><td class="n">{v.get("절차", 0)}</td></tr>' for k, v in src.items())
fam = "".join(f'<tr><td>{e(f["provider"])}</td><td>{e(f["family"])}</td><td class="mono">{e(", ".join(f["api_patterns"]))}</td></tr>' for f in rules["product_families"])

tpl = io.open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
vals = {
    "__JUDG__": judg, "__EXPL__": expl, "__RULES__": len(rules["rules"]), "__AUTO__": len(auto_rules), "__PARTIAL__": len(partial_rules),
    "__PROCESS__": bt["process"], "__E_OK__": pred.get("E 예측 맞음", 0), "__E_BAD__": pred.get("E 예측 틀림", 0),
    "__G_WAIT__": pred.get("원문 없음: S3 ~ S5 사람 답 뒤 G 후보", 0), "__HUMAN__": pred.get("규칙 없음(사람 답 필요)", 0),
    "__SOURCES__": srows, "__FAMILIES__": fam, "__BODY__": "".join(body),
    "__UNUSED__": e(", ".join(bt["unused_rules"])),
}
out = tpl
for k, v in vals.items():
    out = out.replace(k, str(v))
assert "__" not in out, [x for x in out.split("__") if x.isupper()][:5]
assert "·" not in out
io.open(os.path.join(OUT, "rulebook.html"), "w", encoding="utf-8").write(out)
print(len(out))
