# -*- coding: utf-8 -*-
"""Object 판정 v0: 후보에 Interface 를 붙인다. Interface_Spec_v3 의 판별 기준을 후보 features 로 평가한다.

    python judge.py slack        # out/<provider>/judgments.jsonl, judge_report.md

입력: out/<provider>/candidates.jsonl, lexicons/. 원본 자료와 IR 은 다시 읽지 않는다.
규칙으로 못 정하는 것은 판정하지 않고 decisions(사람이 정할 것)에 이유 코드로 남긴다.
"""
import collections
import io
import json
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REVOKE_TOKENS = ("removed", "left", "revoked", "unassigned", "deleted", "uninstalled", "kick", "remove")


def load(provider):
    out = os.path.join(HERE, "out", provider)
    cands = [json.loads(l) for l in io.open(os.path.join(out, "candidates.jsonl"), encoding="utf-8")]
    lex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", "common.yaml"), encoding="utf-8"))
    plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))
    return out, cands, lex, plex


class Judge:
    def __init__(self, provider):
        self.p = provider
        self.out, self.cands, self.lex, self.plex = load(provider)
        self.by_id = {c["candidate_id"]: c for c in self.cands}
        self.space_c = {c["key"][1]: c for c in self.cands if c["key"][0] == "space"}
        self.res = {c["candidate_id"]: dict(interfaces={}, decisions=[], outcome=None) for c in self.cands}
        self.children = collections.defaultdict(list)
        for c in self.cands:
            if c.get("parent"):
                self.children[c["parent"]].append(c)

    def give(self, c, iface, rule, why):
        self.res[c["candidate_id"]]["interfaces"].setdefault(iface, dict(rule=rule, why=why))

    def ask(self, c, code, why):
        self.res[c["candidate_id"]]["decisions"].append(dict(code=code, why=why))

    @staticmethod
    def assoc_spaces(c):
        return [s for s in c["key"][1:-1]]

    # ------------------------------------------------------------ 규칙
    def run(self):
        assocs = [c for c in self.cands if c["kind"] == "association"]
        policy_stems = set(self.lex.get("policy_stems", []))

        # Tenant: 판별 기준("사라지면 소속 Object 의 식별자가 의미를 잃는가")을 features 로 잴 방법이 아직 없다.
        # 임시로 사전 scope_spaces (플래그 관계의 범위 공간)를 쓰고, 사람이 정할 것으로 남긴다
        tenants = set()
        for s in self.plex.get("scope_spaces", []):
            if s in self.space_c:
                tenants.add(s)
                self.give(self.space_c[s], "Tenant", "T-provisional", "사전 scope_spaces (임시)")
                self.ask(self.space_c[s], "tenant_rule", "Tenant 를 정하는 규칙이 없다. 지금은 사전 목록을 그대로 씀")
        self.tenants = tenants

        # Principal: SCIM(벤더가 선언한 신원 자원) 또는 역할 플래그(is_admin)를 가진 레코드의 공간
        principals = self.principal_spaces()
        for s in sorted(principals):
            if s in self.space_c:
                c = self.space_c[s]
                if s in self.plex.get("principal_spaces", []):
                    self.give(c, "Principal", "P-provisional", "사전 principal_spaces (임시)")
                    continue
                if c["features"]["scim"]:
                    self.give(c, "Principal", "P-scim", "SCIM 자원")
                elif s in self.flag_spaces:
                    self.give(c, "Principal", "P-flag", "역할 플래그를 가진 레코드")
                else:
                    self.give(c, "Principal", "P-recipient", "받는 쪽 자리 %d곳에 온다 (%s)" % (
                        len(self.recipient_by[s]), ",".join(sorted(self.by_id[x]["name"] for x in self.recipient_by[s])[:5])))

        # Policy (규칙 묶음): 권한 플래그 묶음이거나, 안에 권한 부여(받는 쪽)를 담고 다른 대상에 붙는 대상
        self.policies = set()
        pmin = self.lex.get("policy_min_permission_flags", 5)
        role_stems = tuple(self.lex.get("role_stems", []))
        for c in self.cands:
            if c["key"][0] != "space" or c["key"][1] in principals:
                continue
            f = c["features"]
            if f["perm_flags"] >= pmin:
                self.give(c, "Policy", "PO-permission-flags", "권한 플래그 %d개 이상을 가진 규칙 묶음" % pmin)
            elif any(r.endswith(" nested") for r in f["recipients"]) and f["attached_under"]:
                self.give(c, "Policy", "PO-grant-bundle", "안에 권한 부여를 담고 %s 에 붙는다" % ",".join(f["attached_under"]))
            elif c["key"][1].endswith(role_stems) and c["key"][1] in self.recipient_alts:
                self.give(c, "Policy", "PO-role-slot", "받는 쪽 자리에 오는 역할")
            else:
                continue
            self.policies.add(c["key"][1])

        # 벤더 동작 예외: 구조상 회수할 수 있어 보여도 접근 관계가 아닌 것 (사전 not_access)
        not_access = {}
        for x in self.plex.get("not_access", []):
            for o in x["ops"]:
                not_access[o] = x
        # Assignment / Policy / Resource: 관계 후보
        for c in assocs:
            hit = next((not_access[o] for o in c["features"]["ops"] if o in not_access), None)
            if hit:
                self.res[c["candidate_id"]]["outcome"] = "not_access"
                self.res[c["candidate_id"]]["note"] = "%s (%s)" % (hit["why"], hit["source"])
                continue
            sp = self.assoc_spaces(c)
            stem = c["key"][-1]
            last = c["name"].split(".")[-1]
            acts = c["features"]["audited_actions"] + c["features"]["emits_events"]
            revocable = (c["features"]["verb_classes"].get("delete", 0) > 0 or "E3b" in c["features"]["rules"]
                         or any(a.endswith(REVOKE_TOKENS) for a in acts))
            if stem in policy_stems or last in policy_stems:
                self.give(c, "Policy", "PO-approval", "승인과 제한 목록은 Policy (Interface_Spec_v3 Integration 절)")
                continue
            if not revocable:
                self.res[c["candidate_id"]]["outcome"] = "relation_only"
                self.ask(c, "no_revoke", "회수 근거가 없다. Object 없이 관계로만 둘지")
                continue
            has_principal = any(s in principals or s == "@resolve" for s in sp)
            if not has_principal:
                # Assignment 는 "주체와 권한을 잇는 배정"이다. 주체 쪽 끝이 없으면 붙이지 않는다
                self.ask(c, "assignment_without_principal",
                         "회수는 되지만 양 끝에 Principal 이 없다(%s). 권한 부여인지 사람이 정할 것" % ",".join(sp))
                continue
            self.give(c, "Assignment", "A-revocable", "회수 근거: " + (",".join(
                sorted(set(c["features"]["rules"]) & {"E3b", "E4b"})) or "delete 동작"))
            if "role" in sp:
                self.give(self.space_c["role"], "Policy", "PO-role-slot", "역할 배정 관계의 역할 자리")
            for s in sp:
                if s.startswith("@") or s in principals or s in tenants or s == "role" or s not in self.space_c or s in self.policies:
                    continue
                self.give(self.space_c[s], "Resource", "R-target", "Assignment %s 의 대상 끝" % c["name"])

        # Assignment (관계 객체): 자기 id 가 있어도 받는 쪽 필드로 Principal 을, 다른 필드나 경로로 대상을 가리키고,
        # 따로 지울 수 있고, 다른 대상이 가리키지 않는 끝 레코드면 배정이다
        # (Interface_Spec_v3: 판정 기준은 자체 id 유무가 아니라 독립적으로 회수 가능한가)
        referenced = collections.Counter()
        for c in self.cands:
            for x in c["features"]["refs_out"]:
                for s in (x[6:].split("|") if x.startswith("@poly:") else [x]):
                    if s != c["key"][1]:
                        referenced[s] += 1
        for c in self.cands:
            if c["kind"] != "entity" or c["key"][1] in principals or self.res[c["candidate_id"]]["interfaces"]:
                continue
            own = c["key"][1] if c["key"][0] == "space" else None
            rcp = [r.split(" ")[0] for r in c["features"]["recipients"] if r.endswith(" direct")]
            pr = set()
            for r in rcp:
                alts = set(r[6:].split("|")) if r.startswith("@poly:") else {r}
                pr |= alts & principals
            if not pr or not c["features"]["verb_classes"].get("delete", 0):
                continue
            # 대상 끝: 경로의 부모 공간, 붙는 공간, 부모 후보 (구조), 또는 자기 공간 이름이 그 공간 이름으로 시작하는 참조
            # (AccountShare -> account, PermissionSetAssignment -> permissionset, CaseTeamMember -> case)
            others = set()
            if c["key"][0] == "unknown_space":
                others |= {s.strip("{}") for s in c["key"][1].split("/") if s.startswith("{")}
            others |= set(c["features"].get("attached_under", []))
            if c.get("parent") in self.by_id and self.by_id[c["parent"]]["key"][0] == "space":
                others.add(self.by_id[c["parent"]]["key"][1])
            refs = set()
            for x in c["features"]["refs_out"]:
                if x in rcp or x == own:
                    continue
                refs |= set(x[6:].split("|")) if x.startswith("@poly:") else {x}
            named = {s for s in refs - principals if own and own.startswith(s)}
            if named:
                others |= {max(named, key=len)}             # 가장 긴 이름 하나 (casetag 의 case 보다 caseteam... 이 우선)
            if not others and refs & principals and own and any(own.startswith(s) for s in refs & principals):
                others = {"@member"}                     # GroupMember -> group: 대상 끝이 Principal (멤버십)
            others -= {own}
            if own and referenced[own]:
                self.ask(c, "junction_referenced",
                         "Principal 과 대상을 잇지만 다른 대상 %d곳이 이것을 가리킨다. 독립 대상으로 봄" % referenced[own])
                continue
            if not others:
                self.give(c, "Assignment", "A-junction", "받는 쪽 Principal(%s)을 잇고 따로 삭제되며 다른 대상이 가리키지 않는다" % ",".join(sorted(pr)))
                self.ask(c, "junction_target", "대상 끝을 구조나 이름으로 못 정함. 참조: %s" % ",".join(sorted(refs - principals))[:120])
                continue
            ends = (others - principals) or {"@member"}        # 대상 끝이 Principal 뿐이면 멤버십 (GroupMember)
            self.give(c, "Assignment", "A-junction", "받는 쪽 Principal(%s)과 대상(%s)을 잇고 따로 삭제되며 다른 대상이 가리키지 않는다" % (
                ",".join(sorted(pr)), ",".join(sorted(ends))[:80]))
            for s in sorted(ends):
                if s in self.space_c and s not in principals | tenants | self.policies:
                    self.give(self.space_c[s], "Resource", "R-target", "Assignment %s 의 대상 끝" % c["name"])

        # Resource (Policy 가 붙는 대상): 권한 묶음이 붙어 효력이 미치는 대상 (permissionscheme -> project)
        for c in self.cands:
            if "Policy" in self.res[c["candidate_id"]]["interfaces"] and c["key"][0] == "space":
                for s in c["features"]["attached_under"]:
                    if s in self.space_c and s not in principals | tenants | self.policies:
                        self.give(self.space_c[s], "Resource", "R-policy-target", "Policy %s 이 붙는 대상" % c["name"])
        # Resource (담긴 대상): Resource 의 경로 아래에서 만들거나 읽는 대상, 부모 후보가 Resource 인 대상.
        # 담는 쪽의 권한을 물려받는 데이터다 (project 의 issue 아래 comment, space 의 page). 새로 붙은 것이 없을 때까지 반복
        changed = True
        while changed:
            changed = False
            res_spaces = {c["key"][1] for c in self.cands if c["key"][0] == "space"
                          and "Resource" in self.res[c["candidate_id"]]["interfaces"]}
            for c in self.cands:
                r = self.res[c["candidate_id"]]
                # 자기 ID 공간이 있는 대상만 (경로로만 보이는 뷰 labels, ancestors, settings 는 담는 쪽의 속성이다)
                if c["kind"] != "entity" or c["key"][0] not in ("space", "local") or r["interfaces"]                         or c["key"][1] in principals | tenants | self.policies:
                    continue
                f = c["features"]
                cont = set(f["attached_under"]) | set(f["listed_under"])
                if c.get("parent") in self.by_id and self.by_id[c["parent"]]["key"][0] == "space":
                    cont.add(self.by_id[c["parent"]]["key"][1])
                hit = sorted(cont & res_spaces - {c["key"][1]})
                if hit:
                    self.give(c, "Resource", "R-contained", "Resource %s 안에 담긴다" % ",".join(hit))
                    changed = True

        # Policy: 자체 쓰기 동작이 있는 하나짜리 설정
        for c in self.cands:
            if c["kind"] == "singleton":
                noun = c["key"][-1].lower()
                writes = [v for v in c["features"]["op_verbs"]
                          if v.split(":")[0] in ("update", "delete") and v.split(":")[1] == noun]   # 생성은 설정 변경이 아니다
                if writes:
                    self.give(c, "Policy", "PO-setting", "같은 줄기의 쓰기 동작이 있는 설정 (%s)" % ",".join(writes))
                else:
                    self.ask(c, "singleton_readonly", "같은 줄기의 쓰기 동작이 없는 하나짜리. 설정인지 보기용인지")

        # Automation: 단계(steps)를 가진 대상, 그 단계가 부르는 함수
        units = set(self.lex.get("automation_units", []))
        actions = set(self.lex.get("automation_actions", []))
        for c in self.cands:
            kids = {k["name"] for k in self.children.get(c["candidate_id"], [])}
            if "steps" in kids:
                self.give(c, "Automation", "AU-steps", "실행 단계(steps)를 가진다")
            elif c["kind"] == "entity" and units & set(c["features"]["child_names"]) and actions & set(c["features"]["desc_names"]):
                self.give(c, "Automation", "AU-units", "실행 단위(%s) 아래에 동작(%s)을 가진다" % (
                    ",".join(sorted(units & set(c["features"]["child_names"]))),
                    ",".join(sorted(actions & set(c["features"]["desc_names"])))))
        for c in assocs:
            if c["key"][-1] == "steps" and "function" in self.assoc_spaces(c):
                for s in ("function",):
                    if s in self.space_c:
                        self.give(self.space_c[s], "Automation", "AU-step-function", "워크플로 단계가 부르는 함수")

        for c in self.cands:
            f = c["features"]
            if c["kind"] == "entity" and f["required_url_params"] and f["verb_classes"].get("delete", 0):
                self.give(c, "Endpoint", "E-subscription", "생성할 때 주소(%s)를 반드시 받고 따로 지울 수 있다" % ",".join(f["required_url_params"]))

        # Credential / Endpoint: 필드에서 떼어 낸 후보
        vendor_hosts = tuple(self.plex.get("vendor_hosts", []))
        # 같은 비밀값 필드(경로 끝 두 단계)가 부모 여러 곳에 반복되면 공용 응답 표현의 일부다 (Confluence mediaToken.token)
        tails = collections.Counter(c["features"]["field"]["tail"] for c in self.cands
                                    if c["kind"] == "field_derived" and c["features"].get("field")
                                    and c["features"]["field"]["cls"] == "secret")
        for c in self.cands:
            f = c["features"].get("field")
            if c["kind"] != "field_derived" or not f:
                continue
            if f["cls"] == "secret" and not f["tail"].startswith("$") and tails[f["tail"]] > 3:   # 중첩된 비밀값만
                self.res[c["candidate_id"]]["outcome"] = "property"
                self.ask(c, "shared_secret_field", "같은 비밀값 필드가 %d곳에 반복된다. 응답 표현의 일부로 보고 속성으로 둠" % tails[f["tail"]])
                continue
            if f["cls"] == "secret":
                self.give(c, "Credential", "C-secret-field", "비밀값 필드 (%s)" % c["name"])
            elif f["cls"] == "url":
                hosts = [e for e in f["examples"] if any(h in e for h in vendor_hosts)]
                if f["config"] or f["writable"]:
                    self.give(c, "Endpoint", "E-config-url", "고객이 설정하는 주소 (앱 설정 스키마 또는 쓰기 파라미터)")
                elif hosts:
                    self.res[c["candidate_id"]]["outcome"] = "property"
                else:
                    self.ask(c, "url_origin", "응답에만 있는 주소이고 예시 호스트로도 못 가름 (%s)" % f["examples"][:1])
            elif f["cls"] == "scope":
                self.res[c["candidate_id"]]["outcome"] = "property"   # 연동의 권한 목록: 관계(has_role_on)의 재료

        # 정해진 규칙이 없는 종류
        for c in self.cands:
            r = self.res[c["candidate_id"]]
            if r["interfaces"] or r["outcome"]:
                continue
            if c["kind"] == "vocab_only":
                self.ask(c, "capability_scope", "API 동작 없는 권한(능력). 무엇의 근거로 쓸지")
            elif c["kind"] == "event_only":
                self.ask(c, "event_only", "감사 로그나 이벤트에만 나온다. 키가 없다")
            elif c["kind"] == "ref_only" and c["key"][1] not in principals | tenants:
                self.ask(c, "ref_only", "목록 API 없이 참조로만 나온다")
            elif c["kind"] == "entity":
                # Interface 신호가 없는 대상은 Object 가 아니다 (업무 데이터). 다른 Object 의 속성이나 관계로만 남는다
                r["outcome"] = "no_interface"

        # Integration: 규칙 미정 (설치 관계 후보가 따로 없다)
        if "app" in self.space_c:
            self.ask(self.space_c["app"], "integration_rule",
                     "앱 설치(테넌트 등록)를 나타내는 후보를 고르는 규칙이 없다")

        for c in self.cands:
            r = self.res[c["candidate_id"]]
            if r["outcome"] is None:
                r["outcome"] = "object" if r["interfaces"] else ("undecided" if r["decisions"] else "out_of_scope")
        # 수집 등급: 읽기 동작의 scope 로 정한다. 필드에서 떼어 낸 후보는 부모를 따른다
        tiers = self.plex.get("collect_tiers", [])
        for c in self.cands:
            src = c
            while src["kind"] in ("field_derived", "embedded") and src.get("parent") in self.by_id:
                src = self.by_id[src["parent"]]
            reads = src["features"]["read_by"]
            if not reads:
                tier = "no_read_scope"
            else:
                def tier_of(s):
                    return next((x["tier"] for x in tiers if s.startswith(x["scope_prefix"])), self.plex.get("default_tier", "standard_token"))
                ts = {tier_of(s) for s in reads}
                tier = self.plex.get("default_tier", "standard_token") if self.plex.get("default_tier") in ts else sorted(ts)[0]
            self.res[c["candidate_id"]]["collect_tier"] = tier
        return self

    def principal_spaces(self):
        if hasattr(self, "_principals"):
            return self._principals
        ps = set()
        self.flag_spaces = set()
        for s in self.plex.get("principal_spaces", []):        # 임시 사전 (구조 신호가 없는 provider)
            if s in self.space_c:
                ps.add(s)
                self.ask(self.space_c[s], "principal_rule", "Principal 신호가 없어 사전 principal_spaces 를 임시로 씀")
        for c in self.cands:
            if c["key"][0] == "space" and c["features"]["scim"]:
                ps.add(c["key"][1])
        # 받는 쪽 필드나 객체가 가리키는 공간 (AssigneeId, UserOrGroupId, holder.type). 역할 공간은 Policy 자리라 뺀다
        role_stems = tuple(self.lex.get("role_stems", []))
        self.recipient_alts = set()
        self.recipient_by = collections.defaultdict(set)
        single = set()
        for c in self.cands:
            for r in c["features"]["recipients"]:
                sp = r.split(" ")[0]
                if not sp.startswith("@poly:"):
                    single.add(sp)
                for s in (sp[6:].split("|") if sp.startswith("@poly:") else [sp]):
                    self.recipient_alts.add(s)
                    self.recipient_by[s].add(c["candidate_id"])
        # 단일 공간을 가리키는 받는 쪽은 그대로, 다형 받는 쪽의 후보 하나는 받는 쪽 자리 2곳 이상에 나와야 Principal
        # (CaseTeamMember.MemberId 의 Contact 처럼 한 곳에서만 받는 쪽 후보로 나오는 공간을 거른다)
        for s in sorted(self.recipient_alts):
            if s in self.space_c and not s.endswith(role_stems) and s not in self.plex.get("scope_spaces", []) \
                    and (s in single or len(self.recipient_by[s]) >= 2):
                ps.add(s)
        for c in self.cands:
            if c["kind"] == "association" and "E3c" in c["features"]["rules"]:
                # 플래그는 레코드 쪽에 있다: 관계의 공간 중 Tenant 후보가 아닌 쪽
                scope_spaces = set(self.plex.get("scope_spaces", []))
                for s in self.assoc_spaces(c):
                    if s not in scope_spaces and not s.startswith("@"):
                        ps.add(s)
                        self.flag_spaces.add(s)
        self._principals = ps
        return ps

    # ------------------------------------------------------------ 출력
    def write(self):
        rows = []
        for c in self.cands:
            r = self.res[c["candidate_id"]]
            rows.append(dict(candidate_id=c["candidate_id"], name=c["name"], kind=c["kind"], key=c["key"],
                             outcome=r["outcome"], interfaces=sorted(r["interfaces"]),
                             rules={k: v["rule"] for k, v in sorted(r["interfaces"].items())},
                             why={k: v["why"] for k, v in sorted(r["interfaces"].items())},
                             decisions=r["decisions"], collect_tier=r.get("collect_tier"), note=r.get("note")))
        rows.sort(key=lambda x: (x["outcome"], x["kind"], x["name"], x["candidate_id"]))
        with io.open(os.path.join(self.out, "judgments.jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for x in rows:
                f.write(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n")
        oc = collections.Counter(x["outcome"] for x in rows)
        ic = collections.Counter(i for x in rows for i in x["interfaces"])
        dc = collections.Counter(d["code"] for x in rows for d in x["decisions"])
        print("결과", dict(sorted(oc.items())))
        print("Interface", dict(sorted(ic.items())))
        print("사람이 정할 것", dict(sorted(dc.items())))
        tc = collections.Counter(x["collect_tier"] for x in rows if x["outcome"] == "object")
        print("Object 수집 등급", dict(sorted(tc.items())))
        return rows


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    Judge(sys.argv[1] if len(sys.argv) > 1 else "slack").run().write()
