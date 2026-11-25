# -*- coding: utf-8 -*-
"""3단계: interface 판정 (2026-10-18). 정보 지도를 읽기만 한다 (map3.py 는 고치지 않는다).

    python iface_judge.py jev <p> [--send]      # 진술 13개 + Choice 1개, 현재 요청 해시와 같은 캐시만 적용
    python iface_judge.py judge <p...>          # 규칙 신호 + Jev -> out2/<p>/iface/judgement.json
    python iface_judge.py calibrate             # 정답표(1단계 object_audit 의 포함 판정)로 interface 별 기준값

기준: aegi-schema Interface_Spec_v3 (판별 기준, 계약), Object_Schema_v4.1 (Object 가 아닌 것).
Jev 에는 공개 명세 값만 보낸다 (단건 위치, 스키마 이름, 속성 이름, 동작 메서드). criteria 예시는 병원 분야에서 골랐다.
캐시는 out2/<p>/iface/jev_cache.jsonl (2단계 세션의 out2/<p>/map/jev_cache.jsonl 과 따로).
"""
import collections
import concurrent.futures
import glob
import hashlib
import io
import json
import os
import sys
import threading
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from map3 import segs, pos_of        # noqa: E402  (함수만 쓴다)
import jev_judge as JJ               # noqa: E402  (api_key, send 만 쓴다)

MODEL = "jev-1.13.0"
IFACES = ["Tenant", "Principal", "Integration", "Credential", "Assignment", "Policy", "Endpoint", "Resource", "Automation"]
DISPLAY = {"slack": "Slack", "github": "GitHub", "okta": "Okta", "gws": "Google Workspace", "salesforce": "Salesforce",
           "jira": "Jira", "confluence": "Confluence", "atlassian": "Atlassian organization admin",
           "m365": "Microsoft 365"}


def noul(ins, t, f):
    return {"type": "noul", "instructions": ins, "criteria": {"true": t, "false": f}}


# Interface_Spec_v3 의 판별 기준을 진술문으로. 예시는 병원 분야 (평가 대상 SaaS 와 겹치지 않게)
QUESTIONS = {
    "Tenant": noul("This object group is an organization boundary: if one of these records disappeared, the identifiers of the "
                   "records that belong to it would lose their meaning.",
                   "For example a hospital network account under which all ward, staff and patient ids are scoped.",
                   "For example one ward inside the hospital, or a staff account."),
    "Principal": noul("A record of this group is an identity that can hold permissions: it fits the blank in "
                      "'___ has permission X'.",
                      "For example a staff account, a service bot account, or a staff group that can be granted access.",
                      "For example a patient chart, a room, or a role definition."),
    "Integration": noul("A record of this group is the fact that a vendor's software is registered or installed in this "
                        "customer's account.",
                        "For example a lab-results vendor app installed into one hospital's account.",
                        "For example the vendor's public app listing shared by all hospitals, or one permission granted to the app."),
    "Credential": noul("A record of this group is a credential record: a secret, token or key, or the registered half of a key "
                       "pair or certificate, that lets its holder authenticate as a user or an app.",
                       "For example an API key, a client secret, an access token, or a registered SSH public key of a key pair.",
                       "For example a user's email address, a password policy, or a list of allowed login methods."),
    "Assignment": noul("A record of this group is one individual assignment that connects an identity to a permission or a "
                       "target; deleting it removes only the permission and leaves the identity and the target.",
                       "For example a nurse's assignment to a ward with a role, or a user's membership in a staff group.",
                       "For example the nurse, the ward, or the role definition itself."),
    "Policy": noul("A record of this group defines access, security or behavior rules, including roles and permission "
                   "bundles, and such a rule is created, changed and deleted on its own.",
                   "For example a visiting-hours rule, a custom role definition, or a device compliance rule.",
                   "For example a single read-only setting value that only describes one ward, or a patient chart."),
    "Endpoint": noul("A record of this group is an address through which data leaves or enters the customer's account, "
                     "crossing the boundary.",
                     "For example a webhook URL, an outbound log stream target, or an inbound mail relay address.",
                     "For example a link to an internal page, or a user's profile picture URL."),
    "Resource": noul("A record of this group is a work object that people create, open and edit, and 'permission on X' "
                     "is a natural phrase for it.",
                     "For example a patient chart, a shared document, a project or a code repository.",
                     "For example a staff account, a role definition, or an access token."),
    "Automation": noul("A record of this group is a definition of logic that runs inside the customer's account and changes "
                       "other records.",
                       "For example a scheduled job definition or a workflow that updates other records.",
                       "For example one run log of that job, or a static report template."),
    "N1_event": noul("A record of this group is a record of something that happened (an event, a log entry, one run of a job), "
                     "rather than the current state of a thing.",
                     "For example an audit log entry, one job run, or a timeline event on a ticket.",
                     "For example the job definition, or the ticket itself."),
    "N4_vendor_global": noul("A record of this group is the vendor's own catalog item that is the same for every customer, "
                             "not something inside this customer's account.",
                             "For example a public app marketplace listing or a list of license plans the vendor sells.",
                             "For example an app installed in this customer's account."),
    "N5_derived": noul("A record of this group is a computed view, search result, statistic, report or metadata about other "
                       "records, rather than a record of its own.",
                       "For example a monthly usage report, a search hit list, or an API rate-limit status.",
                       "For example a patient chart or a staff account."),
}


# 설정 묶음 (2026-10-18 3차): 조직 설정 단일 자원(Okta OrgCAPTCHASettings)이 Tenant 로 골라졌다. 판단표 D2 와 같은 종류
QUESTIONS["S_settings"] = noul("A record of this group is a settings block that only configures its parent record or the "
                               "whole account, and has no identity of its own apart from that parent.",
                               "For example the hospital-wide visiting-hours setting, or the notification preferences of one ward.",
                               "For example the hospital account itself, a ward, or a custom role definition.")

# 가장 맞는 하나 (2026-10-18 2차): 진술을 따로 물으면 Integration 처럼 낮은 확률로 넓게 걸린다. 상대 판단을 함께 묻는다
QUESTIONS["primary"] = {
    "type": "choice",
    "instructions": "Which one kind best describes a record of this group?",
    "criteria": {
        "Tenant": "An organization boundary that other records belong to.",
        "Principal": "An identity or group that can hold permissions.",
        "Integration": "The registration or installation of vendor software in this customer's account.",
        "Credential": "A secret, token, key or certificate used to authenticate.",
        "Assignment": "One assignment that connects an identity to a permission or target.",
        "Policy": "A rule, role or permission bundle defining access, security or behavior.",
        "Endpoint": "An address where data crosses the account boundary.",
        "Resource": "A work object people create, open and edit.",
        "Automation": "A definition of logic that runs and changes other records.",
        "none": "A record of something that happened, a computed view or report, a vendor-wide catalog item, or a settings "
                "fragment that is not a thing of its own.",
    },
}


def load_ops(p):
    ops = []
    for f in glob.glob(os.path.join(HERE, "out2", p, "ir", "operation*.jsonl")):
        ops += [json.loads(l) for l in io.open(f, encoding="utf-8")]
    return ops


def load_shapes(p):
    sh = {}
    for f in glob.glob(os.path.join(HERE, "out2", p, "ir", "shape*.jsonl")):
        for l in io.open(f, encoding="utf-8"):
            s = json.loads(l)
            sh[s["id"]] = s
    return sh


class Sig:
    """공간마다 규칙 신호: 동작 메서드, 부모(단건 위치로 직접 계산), 자식 수"""

    def __init__(self, p):
        self.p = p
        self.m = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))
        self.spaces = self.m["spaces"]
        self.ops = load_ops(p)
        self.shapes = load_shapes(p)
        self.item_space = {P: n for n, s in self.spaces.items() for P in s.get("item_positions") or []}
        self.pos_space = dict(self.item_space)
        for n, s in self.spaces.items():
            for P in s.get("positions") or []:
                self.pos_space.setdefault(P, n)
        self.methods = collections.defaultdict(set)        # 공간 -> 단건 위치에 걸린 메서드
        self.create = collections.defaultdict(set)
        self.endpoints = collections.defaultdict(list)
        for o in self.ops:
            t = (o.get("path") or {}).get("template")
            if not t:
                continue
            ss = segs(t)
            if ss and ss[-1].startswith("{"):
                P = pos_of(t, len(ss) - 1)
                n = self.item_space.get(P)
                if n:
                    self.methods[n].add(o.get("method"))
                    if len(self.endpoints[n]) < 8:
                        self.endpoints[n].append("%s /%s" % (o.get("method"), t))
            elif o.get("method") == "POST" and ss:
                n = self.item_space.get(pos_of(t + "/{x}", len(ss)))
                if n:
                    self.create[n].add("POST /" + t)
                    if len(self.endpoints[n]) < 8:
                        self.endpoints[n].append("POST /" + t)
        self.parent = {}
        for n, s in self.spaces.items():
            for P in s.get("item_positions") or []:
                q = segs(P.lstrip("!"))
                idx = [i for i, x in enumerate(q) if x == "{}"]
                cut = idx[-2] if (len(idx) >= 2 and not P.startswith("!")) else (idx[-1] if P.startswith("!") and idx else None)
                if cut is not None:
                    pp = "/".join(q[:cut + 1])
                    ps = self.pos_space.get(pp)
                    if ps and ps != n:
                        self.parent[n] = ps
                        break
        self.children = collections.Counter(self.parent.values())
        # 다른 공간의 레코드가 이 공간을 가리키는 수 (서로 다른 공간 수). 테넌트는 많은 레코드가 소속으로 가리킨다
        self.ref_in = collections.Counter()
        for a_, b_, n_ in self.m.get("refs") or []:
            if a_ != b_:
                self.ref_in[b_] += 1

    def root(self, n, depth=0):
        return n if n not in self.parent or depth > 8 else self.root(self.parent[n], depth + 1)

    def signals(self, n):
        s = self.spaces[n]
        meth = self.methods.get(n, set())
        out = {"form": s["form"], "methods": sorted(x for x in meth if x), "create": bool(self.create.get(n)),
               "parent": self.parent.get(n), "children": self.children.get(n, 0)}
        rules = {}
        if s["form"] == "composite_key":
            rules["Credential"] = "R2a 복합키 (자격증명 값 자리)"
            if not s.get("key_fields"):
                rules["N2"] = "키 재료가 없다 (식별자를 만들 수 없다)"
        if s.get("credential_material"):
            out["credential_holder"] = True                # 자격증명 보유 대상 (Credential 부여 아님)
        if s.get("relation_of") or s.get("independent_key") or s.get("link_record"):
            rules["Assignment"] = "D5 연결 레코드"
        if s["form"] == "catalog_key":
            rules["Policy"] = "원문 역할 목록"
        if (out["create"] or "POST" in meth) and ({"PUT", "PATCH"} & meth or "DELETE" in meth):
            out["crud"] = True                             # Policy 판별 기준의 재료 (그것만으로 Policy 아님)
        out["ref_in"] = self.ref_in.get(n, 0)
        # 테넌트 구조 신호: 부모 사슬 맨 위이면서 자식 공간 3개 이상, 또는 서로 다른 공간 10개 이상이 가리킴,
        # 또는 참조로만 쓰이는 형식, 부모 위치 공간. 단일 자원이라는 것만으로는 아니다 (조직 설정, 호출 한도가 걸렸다)
        if (not out["parent"] and out["children"] >= 3) or out["ref_in"] >= 10 or s["form"] in ("ref_only", "parent_only"):
            out["tenant_like"] = True
        out["rules"] = rules
        return out

    def view(self, n):
        s = self.spaces[n]
        names = sorted({(self.shapes.get(x) or {}).get("name") or "" for x in s.get("shapes") or []} - {""})[:4]
        fields = []
        for x in s.get("shapes") or []:
            for pr in (self.shapes.get(x) or {}).get("props") or []:
                if pr["name"] not in fields:
                    fields.append(pr["name"])
        if not fields and s.get("key_fields"):
            fields = [z["field"] for z in s["key_fields"]] + [s["material"]["path"]]
        par = self.parent.get(n)
        return {"product": DISPLAY.get(self.p, self.p), "object_group": n.split("@")[0][:80], "schemas": names,
                "endpoints": self.endpoints.get(n, [])[:8] or ["/" + P for P in (s.get("item_positions") or s.get("positions") or [])[:4]],
                "fields": fields[:30], "parent_group": par.split("@")[0][:60] if par else None,
                "child_groups": self.children.get(n, 0)}


def cache_path(p):
    d = os.path.join(HERE, "out2", p, "iface")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "jev_cache.jsonl")


def ckey(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def request_body(sg, name):
    return {"state": sg.view(name), "model": MODEL, "questions": QUESTIONS}


def valid_response(response):
    """A partial/error response must not masquerade as a completed judgement."""
    answers = (response or {}).get("answers") or {}
    def probability(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1
    if not all(probability((answers.get(q) or {}).get("noul")) for q in QUESTIONS if q != "primary"):
        return False
    primary = answers.get("primary") or {}
    probs = primary.get("probabilities") or {}
    return (primary.get("choice") in QUESTIONS["primary"]["criteria"]
            and all(probability(probs.get(k)) for k in QUESTIONS["primary"]["criteria"]))


def current_scores(sg):
    cache = {}
    path = cache_path(sg.p)
    if os.path.exists(path):
        with io.open(path, encoding="utf-8") as f:
            for line in f:
                row = json.loads(line)
                if valid_response(row.get("response")):
                    cache[row["key"]] = row["response"]
    scores, bodies = {}, {}
    for name, space in sorted(sg.spaces.items()):
        if not space.get("object_candidate"):
            continue
        body = request_body(sg, name)
        key = ckey(body)
        bodies[name] = body
        answers = (cache.get(key) or {}).get("answers") or {}
        scores[name] = {q: (answers.get(q) or {}).get("noul") for q in QUESTIONS if q != "primary"}
        scores[name].update(primary=(answers.get("primary") or {}).get("choice"),
                            primary_p=(answers.get("primary") or {}).get("probabilities") or {},
                            request_key=key, model_status="ready" if key in cache else "pending")
    return scores, bodies


def run_jev(p, do_send, workers=6):
    sg = Sig(p)
    scores, bodies = current_scores(sg)
    names = sorted(bodies)
    todo = [n for n in names if scores[n]["model_status"] == "pending"]
    sent = 0
    if do_send and todo:
        key = JJ.api_key()
        if not key:
            raise ValueError("TYPESAFE_API_KEY가 없어 전송하지 않았다")
        stop = threading.Event()
        lock = threading.Lock()
        failures = [0]

        def one(n):
            if stop.is_set():
                return n, {"error": "batch_stopped"}
            try:
                response = JJ.send(bodies[n], key)
                with lock:
                    failures[0] = 0 if valid_response(response) else failures[0] + 1
                    if failures[0] >= 3:
                        stop.set()
                return n, response
            except urllib.error.HTTPError as e:
                with lock:
                    failures[0] += 1
                    if e.code in (401, 403, 429) or failures[0] >= 3:
                        stop.set()
                return n, {"error": e.code}
            except Exception as e:                         # 네트워크 끊김 등: 다음 실행에서 다시 보낸다
                with lock:
                    failures[0] += 1
                    if failures[0] >= 3:
                        stop.set()
                return n, {"error": type(e).__name__}
        with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf, \
                concurrent.futures.ThreadPoolExecutor(workers) as ex:
            for n, resp in ex.map(one, todo):
                if not valid_response(resp):
                    continue
                cf.write(json.dumps({"key": ckey(bodies[n]), "space": n, "response": resp}, ensure_ascii=False, sort_keys=True) + "\n")
                cf.flush()
                sent += 1
    out, _ = current_scores(sg)
    with io.open(os.path.join(HERE, "out2", p, "iface", "jev_scores.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    result = {"provider": p, "spaces": len(names), "sent": sent,
              "missing": sum(1 for v in out.values() if v["Tenant"] is None),
              "stopped": stop.is_set() if do_send and todo else False}
    print(json.dumps(result), flush=True)
    return result


def gold():
    """1단계 대조의 포함 판정 -> 공간별 interface 집합. 제외, 보류가 닿은 공간도 따로"""
    d = json.load(io.open(os.path.join(HERE, "out2", "object_audit.json"), encoding="utf-8"))
    pos, neg = collections.defaultdict(lambda: collections.defaultdict(set)), collections.defaultdict(set)
    labs = collections.defaultdict(lambda: collections.defaultdict(list))
    for p, v in d.items():
        for r in v["rows"]:
            if len(r["spaces"]) > 2:
                continue                                   # 한 행이 여러 공간에 닿으면 라벨이 번진다 (정답표 잡음)
            for s in r["spaces"]:
                if r["verdict"] == "포함":
                    labs[p][s].append(frozenset(i.strip() for i in (r["interface"] or "").replace(";", ",").split(",")
                                                if i.strip() in IFACES))
                else:
                    neg[p].add(s)
    for p, m in labs.items():
        for s, ls in m.items():
            if len(set(ls)) == 1 and ls[0]:                # 같은 공간에 닿은 포함 행들의 판정이 같을 때만
                pos[p][s] = set(ls[0])
    return pos, neg


def calibrate(ps=("github", "okta", "slack", "gws")):
    pos, neg = gold()
    rows = []
    for p in ps:
        sc, _ = current_scores(Sig(p))
        for s, labs in pos[p].items():
            if s in sc and sc[s]["Tenant"] is not None:
                rows.append((p, s, labs, sc[s]))
    res = {}
    for i in IFACES:
        best = None
        for t in [x / 100 for x in range(30, 96, 5)]:
            tp = sum(1 for _, _, l, sc in rows if i in l and sc[i] >= t)
            fp = sum(1 for _, _, l, sc in rows if i not in l and sc[i] >= t)
            fn = sum(1 for _, _, l, sc in rows if i in l and sc[i] < t)
            pr = tp / (tp + fp) if tp + fp else 0
            rc = tp / (tp + fn) if tp + fn else 0
            f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0
            if best is None or f1 > best["f1"]:
                best = {"threshold": t, "precision": round(pr, 2), "recall": round(rc, 2), "f1": round(f1, 2), "tp": tp, "fp": fp,
                        "fn": fn, "positives": tp + fn}
        res[i] = best
    ok = sum(1 for *_, l, sc in [(r[0], r[1], r[2], r[3]) for r in rows] if sc.get("primary") in l)
    res["primary"] = {"accuracy": round(ok / len(rows), 2) if rows else None, "n": len(rows),
                      "none": sum(1 for r in rows if r[3].get("primary") == "none")}
    # 오브젝트 불가 진술이 정답표 「포함」 공간에서 얼마나 높게 나오나 (높으면 잘못 거른다)
    for q in ("N1_event", "N4_vendor_global", "N5_derived"):
        res[q] = {"included_spaces_at_0.7": sum(1 for *_, sc in rows if (sc[q] or 0) >= 0.7), "included_spaces": len(rows)}
    with io.open(os.path.join(HERE, "out2", "iface_calibration.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"gold_spaces": len(rows), "by_interface": res}, f, ensure_ascii=False, indent=1, sort_keys=True)
    return len(rows), res


def judge(ps):
    cal = json.load(io.open(os.path.join(HERE, "out2", "iface_calibration.json"), encoding="utf-8"))["by_interface"]
    pos, neg = gold()
    sf = os.path.join(HERE, "out2", "iface_summary.json")
    summary = {}
    if os.path.exists(sf):
        with io.open(sf, encoding="utf-8") as f:
            summary = json.load(f)
    facts_path = os.path.join(HERE, "iface_source_facts.json")
    facts = {"overrides": []}
    if os.path.exists(facts_path):
        with io.open(facts_path, encoding="utf-8") as f:
            facts = json.load(f)
        ps_set = set(ps)
        if ps_set:
            relevant = {
                (r.get("evidence") or {}).get("source")
                for r in facts.get("overrides", [])
                if r.get("provider") in ps_set or r.get("provider") in (None, "*")
            }
            sources_to_check = {s: v for s, v in facts.get("sources", {}).items() if s in relevant}
        else:
            sources_to_check = facts.get("sources", {})
        if sources_to_check:
            from core import registry
            reg = registry()
            for source, expected in sources_to_check.items():
                if reg.get(source, {}).get("sha256") != expected["sha256"]:
                    raise ValueError("interface 원문 전사의 스냅샷이 다르다")
    for p in ps:
        sg = Sig(p)
        # Space names alone are not a cache key. A renamed parent or changed
        # schema/field list invalidates the earlier answer, even for the same name.
        sc, _ = current_scores(sg)
        out = {}
        for n, s in sorted(sg.spaces.items()):
            if not s.get("object_candidate"):
                continue
            sig = sg.signals(n)
            j = sc.get(n) or {}
            # 판정 규칙 (정답표 227 공간에서 고름, 완전 일치 0.70): 규칙 신호 + Choice 가 고른 하나(none 이면 진술 최고값)
            # + 진술 0.9 이상. 진술별 기준값만 쓰면 완전 일치 0.51 이었다
            ifs = {}
            for i in IFACES:
                if i in sig["rules"]:
                    ifs[i] = {"by": "rule", "why": sig["rules"][i]}
            pr = j.get("primary")
            if j.get("Tenant") is not None:
                # Choice 가 none 이면 진술 중 정답표 기준값을 넘은 것의 최고값. 넘은 게 없으면 붙이지 않는다
                # (기준값 아래 최고값을 쓰면 Okta OrgCAPTCHASettings 가 Tenant 0.39 로 붙었다)
                if pr in IFACES:
                    top = pr
                else:
                    over = [k for k in IFACES if (j[k] or 0) >= cal[k]["threshold"]]
                    top = max(over, key=lambda k: j[k]) if over else None
                if top:
                    ifs.setdefault(top, {"by": "model", "p": j[top], "how": "primary" if pr in IFACES else "max_statement",
                                         "primary_p": (j.get("primary_p") or {}).get(pr)})
                for i in IFACES:
                    if (j[i] or 0) >= 0.9:
                        ifs.setdefault(i, {"by": "model", "p": j[i], "how": "statement>=0.9"})
            no = []
            if "N2" in sig["rules"]:
                no.append({"rule": "N2", "why": sig["rules"]["N2"]})
            if pr == "none":
                for q in ("N1_event", "N4_vendor_global", "N5_derived"):
                    if (j.get(q) or 0) >= 0.7:
                        no.append({"rule": q.split("_")[0], "p": j[q]})
            # Tenant 는 구조 신호가 있을 때만 (부모 사슬 맨 위이고 자식 공간이 있음, 단일 자원, 참조로만 쓰이는 형식, 부모 위치 공간)
            # 설정 묶음 진술이 0.7 이상이면 Tenant 도 다른 interface 도 아니라 부모의 속성 후보다
            # 구조 신호가 없어도 Choice 와 진술이 함께 강하면 테넌트다 (Okta 조직 단일 자원, Google Customer, GitHub Enterprise)
            tenant_ok = sig.get("tenant_like") or ((j.get("Tenant") or 0) >= 0.7 and pr == "Tenant"
                                                    and ((j.get("primary_p") or {}).get("Tenant") or 0) >= 0.9)
            if "Tenant" in ifs and ifs["Tenant"]["by"] == "model" and not tenant_ok:
                ifs.pop("Tenant")
                ifs.setdefault("_dropped", {"by": "rule", "why": "Tenant 구조 신호 없음"})
            settings = (j.get("S_settings") or 0) >= 0.7
            if settings:
                for i in list(ifs):
                    if ifs[i].get("by") == "model":
                        ifs.pop(i)
                no.append({"rule": "S", "p": j.get("S_settings"), "why": "설정 묶음: 부모의 속성 후보"})
            ifs.pop("_dropped", None)
            stated = [r for r in facts["overrides"] if r["provider"] == p and r["shape"] in (s.get("shapes") or [])]
            if stated and "N2" not in sig["rules"]:
                ifs = {r["interface"]: dict(by="stated", why=r["evidence"]["reason"], evidence=r["evidence"]) for r in stated}
                no = []
            ruled = any(v["by"] == "rule" for v in ifs.values())
            proposed = {}
            if "N2" in sig["rules"]:
                # No identity is a hard Object constraint. A Credential rule may
                # not override it; keep the proposed interfaces for review.
                proposed, ifs = ifs, {}
                verdict = "not_object"
            else:
                verdict = "not_object" if no and not ruled else ("object" if ifs else "undecided")
            if s.get("external_locator"):
                proposed, ifs = ifs, {}
                no.append(dict(rule="N4_external_locator",why="stated external target locator has no tenant entity definition",
                               evidence=s["external_locator"]["evidence"]))
                verdict = "not_object"
            out[n] = {"verdict": verdict, "interfaces": ifs, "not_object": no, "signals": {k: v for k, v in sig.items() if k != "rules"},
                      "jev": j, "model_status": j.get("model_status", "pending"),
                      "proposed_interfaces": proposed,
                      "gold": sorted(pos[p].get(n, ())), "gold_excluded": n in neg[p] and n not in pos[p]}
        d = os.path.join(HERE, "out2", p, "iface")
        os.makedirs(d, exist_ok=True)
        with io.open(os.path.join(d, "judgement.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
        c = collections.Counter(v["verdict"] for v in out.values())
        ic = collections.Counter(i for v in out.values() if v["verdict"] == "object" for i in v["interfaces"])
        g = [(n, v) for n, v in out.items() if v["gold"]]
        summary[p] = {"candidates": len(out), "verdict": dict(c), "interfaces": dict(ic),
                      "model_pending": sum(v["model_status"] != "ready" for v in out.values()),
                      "undecided_scored": sum(v["verdict"] == "undecided" and v["model_status"] == "ready" for v in out.values()),
                      "gold": len(g), "gold_exact": sum(1 for n, v in g if set(v["interfaces"]) == set(v["gold"])),
                      "gold_not_object": sum(1 for n, v in g if v["verdict"] == "not_object"),
                      "gold_excluded_not_object": sum(1 for v in out.values() if v["gold_excluded"] and v["verdict"] == "not_object"),
                      "gold_excluded": sum(1 for v in out.values() if v["gold_excluded"])}
    with io.open(os.path.join(HERE, "out2", "iface_summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1, sort_keys=True)
    return summary


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    if a and a[0] == "jev":
        run_jev(a[1], "--send" in a)
    elif a and a[0] == "calibrate":
        n, r = calibrate()
        print("정답 공간", n)
        for k, v in r.items():
            print(" ", k, v)
    elif a and a[0] == "judge":
        print(json.dumps(judge(a[1:]), ensure_ascii=False, indent=1))
    else:
        sys.exit(__doc__)
