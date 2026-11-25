# -*- coding: utf-8 -*-
"""③~⑥ 공통 형식 -> 후보 카탈로그. provider 와 무관한 규칙이다.

    python extract.py slack         # out/<provider>/ir/ 를 읽어 out/<provider>/ 에 쓴다

입력은 ir/*.jsonl 과 lexicons/ 뿐이다. description 은 읽지 않는다.
"""
import collections
import hashlib
import io
import json
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))


def load_jsonl(path):
    with io.open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def camel_split(tok):
    return re.findall(r"[a-z]+|[A-Z][a-z0-9]*", tok)


def singular(name):
    if name.endswith(("ss", "us", "is")):            # status, access, analysis 는 이미 단수
        return name
    for a, b in (("ies", "y"), ("uses", "us"), ("sses", "ss"), ("xes", "x"), ("s", "")):
        if name.endswith(a) and len(name) > len(a) + 2:
            return name[: -len(a)] + b
    return name


class Extractor:
    def __init__(self, provider):
        self.p = provider
        self.ir = os.path.join(HERE, "out", provider, "ir")
        self.lex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", "common.yaml"), encoding="utf-8"))
        self.plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))
        self.ops = {o["op_id"]: o for o in load_jsonl(os.path.join(self.ir, "operations.jsonl"))}
        self.fields = load_jsonl(os.path.join(self.ir, "fields.jsonl"))
        self.defs = load_jsonl(os.path.join(self.ir, "id_defs.jsonl"))
        self.events = load_jsonl(os.path.join(self.ir, "events.jsonl"))
        self.vocab = load_jsonl(os.path.join(self.ir, "grant_vocab.jsonl"))
        self.holes = load_jsonl(os.path.join(self.ir, "holes.jsonl"))
        self.cands = collections.OrderedDict()
        self.queue = []
        verbs = {}
        for cls, words in self.lex["verb_class"].items():
            for w in words:
                verbs[w] = cls
        self.verbs = verbs

    # ------------------------------------------------------------ ID 공간
    def build_spaces(self):
        """defs_*_id 패턴에서 공간을 만든다. 접두사 집합이 같으면 한 공간, 다른 공간들의 합이면 다형."""
        by_set = collections.defaultdict(list)
        for d in self.defs:
            if d["prefixes"]:
                by_set[tuple(d["prefixes"])].append(d["def_id"][len("defs_"):])
        merge = {}
        for m in self.plex.get("space_merge", []):
            for x in m["members"]:
                merge[x] = m["into"]
        space_of_def, prefix_space = {}, {}
        groups = {}
        for pset, names in sorted(by_set.items()):
            target = None
            for n in names:
                if n in merge:
                    target = merge[n]
            name = target or sorted(names, key=lambda n: (len(n), n))[0]
            name = re.sub(r"_id$", "", name)
            groups[pset] = name
        # 다형: 집합이 다른 집합들의 합이면서 merge 로 묶이지 않은 것
        poly = {}
        for pset, name in groups.items():
            others = [s for s in groups if s != pset and set(s) < set(pset)]
            covered = set().union(*[set(s) for s in others]) if others else set()
            members = {groups[s] for s in others}
            if covered == set(pset) and name not in members and len(members) > 1:
                poly[pset] = sorted(members)
        for pset, names in by_set.items():
            for n in names:
                space_of_def["defs_" + n] = ("@poly", poly[pset]) if pset in poly else groups[pset]
            if pset not in poly:
                for pre in pset:
                    prefix_space[pre] = groups[pset]
        for pre, sp in self.plex.get("extra_prefixes", {}).items():
            prefix_space[pre] = sp
        self.local_key_defs = {d["def_id"] for d in self.defs if not d["prefixes"]}   # defs_ts: 부모 안 키
        self.space_of_def, self.prefix_space = space_of_def, prefix_space
        self.spaces = sorted(set(prefix_space.values()))

    # ------------------------------------------------------------ REST 경로의 ID 공간 (설계 3.0)
    @staticmethod
    def snake(name):
        return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name).replace("-", "_").lower()

    @staticmethod
    def canon(name):
        """공간 키: 밑줄을 뗀 소문자 단수 (issue_type 와 issuetype 를 같은 공간으로)"""
        return singular(name.replace("_", "").replace("-", "").lower()) if name else name

    def rest_param_space(self, name, prev, enum=False):
        """경로 파라미터 이름 -> 공간. 꼬리(IdOrKey, Id, -id ...)를 떼고, id 처럼 일반 이름이면 앞 경로 단어를 쓴다.
        enum 값을 받는 파라미터와 사전 non_id_params 는 ID 가 아니다."""
        if enum or name in self.lex.get("non_id_params", []) + self.plex.get("non_id_params", []):
            return None
        v = self.plex.get("param_space", {}).get(name)
        if v == "@resolve":
            return ("@poly", [])
        if v:
            return v
        base = name
        for suf in sorted(self.lex.get("param_suffixes", []) + self.plex.get("param_suffixes", []), key=len, reverse=True):
            if base.endswith(suf) and len(base) > len(suf):
                base = base[: -len(suf)]
                break
        base = self.snake(base).strip("_")
        if base in ("id", "key", "name", "number", "", "id_or_name", "id_or_key", "key_or_id", "id_or"):
            return self.canon(self.snake(prev)) if prev and not prev.startswith("{") else None
        # 파라미터 이름이 앞 경로 단어의 꼬리면 경로 단어가 더 구체적이다 (/permissionscheme/{schemeId} -> permissionscheme)
        if prev and not prev.startswith("{"):
            pw = self.canon(self.snake(prev))
            if pw != self.canon(base) and pw.endswith(self.canon(base)):
                return pw
        return self.canon(base)

    def build_rest_spaces(self):
        """REST 동작마다 경로를 [단어 | 공간] 으로 나누고, 컬렉션 경로 -> 공간 표를 만든다."""
        self.coll_space = {}
        found = set()
        for op in self.ops.values():
            if op["surface"] != "rest":
                continue
            segs, norm, prev = [s for s in op["path"].strip("/").split("/") if s], [], None
            op["path_spaces"] = []
            for s in segs:
                if s.startswith("{"):
                    pn = s.strip("{}+")
                    pinfo = next((x for x in op["params"] if x["name"] == pn and x.get("in") == "path"), {})
                    sp = self.rest_param_space(pn, prev, enum=bool(pinfo.get("enum")))
                    norm.append(("{%s}" % sp) if isinstance(sp, str) else "{?}")
                    if isinstance(sp, str):
                        found.add(sp)
                    op["path_spaces"].append((s.strip("{}+"), sp))
                else:
                    norm.append(s)
                prev = s
            op["norm"] = norm
            if norm and norm[-1].startswith("{") and isinstance(op["path_spaces"][-1][1], str):
                self.coll_space.setdefault("/".join(norm[:-1]), op["path_spaces"][-1][1])
        self.rest_spaces = found
        self.spaces = sorted(set(self.spaces) | found)
        if self.plex.get("space_from_schema"):
            self.schema_spaces()

    def schema_spaces(self):
        """스키마 계열 우선 공간 (사전 space_from_schema, 2026-10-14).

        1. 응답 레코드 스키마(자기 키 record_key_fields 가 있는 객체)를 접사(schema_affixes)를 떼어 계열로 묶는다
           (full-repository, minimal-repository -> repository). 사전 schema_space 는 계열 이름에도 쓴다 (repository -> repo)
        2. 경로가 계열을 확정한다: 단건 조회 경로(…/{p})가 돌려주는 계열이 그 경로의 공간이다
        3. 한 경로 공간 p 에 계열이 여럿이면
           - 바탕 계열(p 와 같은 이름, 또는 p 를 이름에 담은 가장 짧은 계열)과 바탕 이름으로 끝나는 계열
             (team-repository: 맥락이 붙은 표현)은 p 그대로
           - 그 밖의 계열은 다른 대상이다. 그 경로(와 그 아래 경로)의 p 를 계열 공간으로 나눈다 (comment -> issuecomment, gistcomment ...)
        4. 계열이 다른 경로 공간의 바탕이면 그 공간으로 합친다 (assignee, targetuser -> user)
        5. 경로와 안 이어진 계열은 레코드로 두 번 이상 나올 때 새 공간이 된다. 계열과 안 이어진 경로 공간은 남기되 「경로 단독」으로 표시한다
        결과는 self.space_report (out/<provider>/space_rebuild.json)
        """
        aff = set(self.plex.get("schema_affixes", []))
        fixed = dict(self.plex.get("schema_space", {}))
        subs = self.plex.get("schema_subtype_suffixes", [])
        keys = self.plex.get("record_key_fields", ["id"])

        def raw_family(name):
            for suf in subs:                                  # 하위 유형 스키마 (labeled-issue-event -> issue-event)
                if name.endswith("-" + suf) and name != suf:
                    name = suf
                    break
            if "-" not in name and re.search(r"[a-z][A-Z]", name):   # 낙타 표기 (IssueTypeDetails -> issue-type-details)
                name = "-".join(w.lower() for w in camel_split(name))
            for cut in self.plex.get("schema_cut_words", ["with"]):  # 덧붙인 정보 꼬리 (secret-scanning-alert-with-metadata)
                name = name.split("-%s-" % cut)[0]
            toks = [t for t in name.split("-") if t not in aff]
            return self.canon("_".join(toks)) if toks else None

        ignore = set(self.plex.get("schema_ignore", []))

        def family(name):
            if name in ignore:
                return None
            if name in fixed:
                return fixed[name]
            fm = raw_family(name)
            return fixed.get(fm, fm)

        def is_record(paths, p):
            if any(p + "." + k in paths for k in keys):
                return True
            if not self.plex.get("record_key_named_id"):
                return False
            # 「대상 이름 + Id」 키 (Google Role.roleId, RoleAssignment.roleAssignmentId): 그 자리 스키마 계열 이름과 맞을 때만
            fms = {family(r["schema"]) for r in paths.get(p, []) if r.get("schema")} - {None}
            return any(p + "." + n in paths for fm in fms for n in (fm + "Id", fm + "_id")) or any(
                q.startswith(p + ".") and q.count(".") == p.count(".") + 1 and q.rsplit(".", 1)[1].lower() in {fm + "id" for fm in fms}
                for q in paths)

        resp = collections.defaultdict(dict)
        for f in self.fields:
            if f["side"] == "response":
                resp[f["op_id"]].setdefault(f["path"], []).append(f)
        rec_fam, fam_names, raw_of = collections.Counter(), collections.defaultdict(set), collections.defaultdict(set)
        item_fams = collections.defaultdict(set)              # 단건 경로(정규화) -> 계열
        item_get, item_list, item_poly = collections.defaultdict(set), collections.defaultdict(set), set()
        item_space = {}                                       # 단건 경로 -> 경로 공간
        for op_id, paths in sorted(resp.items()):
            op = self.ops.get(op_id, {})
            for p, rows in paths.items():
                if not (p in ("$", "$[*]") or re.match(r"^\$\.[^.\[]+(\[\*\])?$", p)) or not is_record(paths, p):
                    continue
                for r in rows:
                    if r["type"] == "object" and r.get("schema"):
                        fm = family(r["schema"])
                        if fm:
                            rec_fam[fm] += 1
                            fam_names[fm].add(r["schema"])
                            raw_of[fm].add(raw_family(r["schema"]))
            norm = op.get("norm") or []
            if op.get("surface") != "rest" or op.get("http_method") != "GET" or not norm:
                continue
            if norm[-1].startswith("{"):                      # 단건 조회
                sp, rec = op["path_spaces"][-1][1], "$"
                key = "/".join(norm)
            else:                                             # 목록 조회: 같은 컬렉션의 단건 경로에 표를 더한다
                sp, rec = self.coll_space.get("/".join(norm)), "$[*]"
                key = "/".join(norm) + "/{%s}" % sp
                if rec not in paths:
                    rec = next((p for p in sorted(paths) if re.match(r"^\$\.[^.\[]+\[\*\]$", p) and is_record(paths, p)), rec)
            if not isinstance(sp, str) or not is_record(paths, rec):
                continue
            item_space[key] = sp
            got = {family(r["schema"]) for r in paths.get(rec, []) if r["type"] == "object" and r.get("schema")} - {None}
            if len(got) > 1:
                item_poly.add(key)                            # 한 동작이 계열 여럿 중 하나를 돌려준다 (다형)
            (item_get if rec == "$" else item_list)[key] |= got
        for key in set(item_get) | set(item_list):            # 단건 응답의 계열이 목록 응답(…-item 요약)보다 먼저다
            item_fams[key] = item_get.get(key) or item_list.get(key) or set()
        # 경로 공간마다 바탕 계열
        sp_fams = collections.defaultdict(set)
        for key, fms in item_fams.items():
            sp_fams[item_space[key]] |= fms
        base = {}
        for sp, fms in sp_fams.items():
            if sp in fms:
                base[sp] = sp
            elif len(fms) == 1:
                base[sp] = next(iter(fms))
            else:
                base[sp] = None                               # 이름이 같은 계열이 없고 여럿이면 모두 다른 대상이다 (alert, comment)
        home = {}                                             # 계열 -> 그 계열이 바탕인 경로 공간
        # 계열 이름과 같은 공간 > 계열 이름에 든 공간(workflowrun 의 run) > 이름 순
        npaths = collections.Counter(item_space.values())
        # 계열 이름과 같은 공간 > 계열 이름에 든 공간(workflowrun 의 run) > 단건 경로가 많은 공간 > 이름 순
        for sp in sorted(base, key=lambda s: (base[s] != s, not (base[s] and s in base[s]), -npaths[s], s)):
            if base[sp] and base[sp] not in home:
                home[base[sp]] = sp

        def same(fm, b):                                      # fm 이 바탕 b 의 표현인가 (team-repository 는 repository 의 표현)
            if fm == b:
                return True
            bs = raw_of.get(b, set()) | {b}
            return any(r and r != x and r.endswith(x) for r in raw_of.get(fm, ()) for x in bs)

        # 단건 경로마다 최종 공간
        rename, decisions = {}, collections.defaultdict(dict)
        for key, sp in sorted(item_space.items()):
            fms = item_fams.get(key) or set()
            b = base.get(sp)
            if not fms or (b and all(same(f, b) for f in fms)):
                name = home.get(b, sp) if b else sp
            elif b == sp or key in item_poly:
                # 이름이 같은 바탕 계열이 있으면 나누지 않는다. 부모 아래 경로가 다른 계열을 돌려주면 그것은 관계 레코드다
                # (GET /apps/{appId}/groups/{groupId} -> ApplicationGroupAssignment: 가리키는 대상은 여전히 group)
                # 한 경로가 계열 여럿 중 하나를 돌려주면(StandardRole 또는 CustomRole) 다형 표현이지 다른 대상이 아니다
                name = home.get(b, sp) if b else sp
            else:
                f = sorted(fms)[0]
                name = home.get(f, f)
            decisions[sp][key] = name
            if name != sp:
                rename[key] = name
        # 적용: 단건 경로를 앞머리로 가진 모든 경로의 그 자리 이름을 바꾼다
        for op in self.ops.values():
            norm = op.get("norm")
            if not norm or not op.get("path_spaces"):
                continue
            idx = [i for i, x in enumerate(norm) if x.startswith("{")]
            new_norm, ps = list(norm), list(op["path_spaces"])
            for n, i in enumerate(idx):
                pre = "/".join(norm[: i + 1])
                if pre in rename and n < len(ps):
                    new_norm[i] = "{%s}" % rename[pre]
                    ps[n] = (ps[n][0], rename[pre])
            op["norm"], op["path_spaces"] = new_norm, ps
        self.coll_space = {}
        for op in self.ops.values():
            norm = op.get("norm") or []
            if norm and norm[-1].startswith("{") and op.get("path_spaces") and isinstance(op["path_spaces"][-1][1], str):
                self.coll_space.setdefault("/".join(norm[:-1]), op["path_spaces"][-1][1])
        used = {s for op in self.ops.values() for _, s in op.get("path_spaces") or [] if isinstance(s, str)}
        # 5. 경로와 안 이어진 계열
        attached = set(home) | {f for fs in item_fams.values() for f in fs}
        named = {}                                            # 계열 -> 공간 이름 (경로와 이어진 것)
        for key, sp in item_space.items():
            for f in item_fams.get(key, ()):
                named.setdefault(f, rename.get(key, sp) if not (base.get(sp) and same(f, base[sp])) else home.get(base[sp], sp))
        # 경로와 안 이어진 계열이 이어진 계열 이름(8자 이상)으로 끝나면 그 공간의 표현이다
        # (organization-secret-scanning-alert -> secretscanningalert. 짧은 이름 key, label 은 다른 대상과 겹쳐 쓰지 않는다)
        for fm in list(rec_fam):
            if fm in attached:
                continue
            hit = sorted((a for a in named if len(a) >= 8 and fm != a and fm.endswith(a)), key=lambda a: -len(a))
            if hit:
                named[fm] = named[hit[0]]
                attached.add(fm)
                home.setdefault(fm, named[hit[0]])
        new = sorted(fm for fm, n in rec_fam.items() if fm not in attached and n >= 2 and fm not in used)
        for fm, names in fam_names.items():
            sp = home.get(fm) or (fm if fm in used or fm in new else None)
            if sp is None:
                for key, nm in sorted(rename.items()):
                    if fm in item_fams.get(key, ()):
                        sp = nm
                        break
            if sp:
                for sch in names:
                    self.plex.setdefault("schema_space", {}).setdefault(sch, sp)
        before = set(self.rest_spaces)
        # 다른 경로에서 이미 이 계열로 나뉜 이름이 있으면 그 이름이 쓰인다 (rename 값). 같은 계열이 두 이름이 되지 않게 맞춘다
        self.rest_spaces = used | set(new)
        self.spaces = sorted((set(self.spaces) - before) | self.rest_spaces)
        self.space_report = dict(
            before=sorted(before), after=sorted(self.rest_spaces),
            removed=sorted(before - self.rest_spaces), added=sorted(self.rest_spaces - before),
            split={sp: d for sp, d in sorted(decisions.items()) if set(d.values()) != {sp}},
            path_families={sp: sorted(f) for sp, f in sorted(sp_fams.items())},
            new_from_schema={fm: sorted(fam_names[fm]) for fm in new},
            path_only=sorted(s for s in self.rest_spaces if s not in sp_fams and s not in new and s not in set(rename.values())),
            families={fm: sorted(n) for fm, n in sorted(fam_names.items())})
        p = os.path.join(HERE, "out", self.p, "space_rebuild.json")
        with io.open(p, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(self.space_report, fh, ensure_ascii=False, indent=1, sort_keys=True)

    def space_of_value(self, v):
        if not isinstance(v, str) or not re.match(r"^[A-Z][A-Za-z0-9]{2,}$", v):
            return None
        best = None
        for pre, sp in self.prefix_space.items():
            if v.startswith(pre) and (best is None or len(pre) > len(best[0])):
                rest = v[len(pre):]
                if rest and (rest[0].isdigit() or rest[0].isupper()):
                    best = (pre, sp)
        return best[1] if best else None

    def values_space(self, vals):
        """예시 값 여럿의 공간. 접두사가 가리키는 공간이 둘 이상이면 다형 참조다 (entity_id: T, C, E)"""
        sps = sorted({x for x in (self.space_of_value(v) for v in vals) if x})
        if len(sps) > 1:
            return ("@poly", sps)
        return sps[0] if sps else None

    def space_of_name(self, name):
        v = self.plex.get("field_space", {}).get(name)
        if v == "@resolve":
            return ("@poly", [])
        if v:
            return v
        if getattr(self, "rest_spaces", None):
            # camelCase 참조 (projectId, issueIds): 꼬리를 떼서 알려진 REST 공간이면 그 공간
            m = re.match(r"^(.+?)(IdOrKey|Ids|Id|_ids|_id)$", name)
            if m:
                base = self.canon(self.snake(m.group(1)))
                if base in self.rest_spaces:
                    return base
        return None

    # ------------------------------------------------------------ ③ 필드 분류
    def classify(self):
        fn = self.lex["field_names"]
        for f in self.fields:
            name = re.sub(r"\[\*\]", "", f["path"].split(".")[-1])
            f["name"] = name
            sp = None
            if f.get("ref_def"):
                sp = self.space_of_def.get(f["ref_def"])
            if sp is None and f.get("ref_targets"):        # 스키마가 참조 대상 타입을 직접 준다 (Salesforce Refers To)
                tg = sorted({self.canon(x) for x in f["ref_targets"]})
                sp = tg[0] if len(tg) == 1 else ("@poly", tg)
            if sp is None and f.get("example"):
                sp = self.values_space(f.get("examples") or [f["example"]])
            if sp is None and (name.endswith(("_id", "_ids", "Id", "Ids", "IdOrKey")) or name in ("id",)
                               or name in self.plex.get("field_space", {})):
                sp = self.space_of_name(name)
            f["space"] = sp
            cls = "other"
            if name in fn["meta"] or f["path"] == "$":
                cls = "meta"
            elif f.get("ref_def") in self.local_key_defs and name in ("ts", "id"):
                cls = "local_key"
            elif sp is not None:
                cls = "id" if name == "id" else "ref"
            elif name in fn["secret"] or f.get("format") == "password":
                cls = "secret"                   # writeOnly 는 "응답에 없다"는 뜻이지 비밀이라는 뜻이 아니다
            elif f["type"] in ("string", "array", "unknown") and any(name.endswith(s) for s in fn["url_suffix"]):
                ex = f.get("example") or ""
                cls = "link" if "slack.com/api" in ex else "url"
            elif name in fn["scope"]:
                cls = "scope"
            elif name in fn["flag"] and f["type"] == "boolean":
                cls = "flag"
            elif any(name.endswith(s) for s in fn["time_suffix"]):
                cls = "time"
            elif any(name.endswith(s) for s in fn["ref_suffix"]):
                cls = "ref"          # 공간을 못 정한 참조 -> C1
            elif f["type"] == "boolean":
                cls = "state"
            f["cls"] = cls
        self.by_op = collections.defaultdict(list)
        for f in self.fields:
            if f["side"] == "response":
                self.by_op[f["op_id"]].append(f)
        # 필드 이름 -> 공간 (defs 로 정해진 필드에서 다수결). 파라미터에 쓴다
        votes = collections.defaultdict(collections.Counter)
        for f in self.fields:
            if isinstance(f["space"], str) and f["name"] != "id":
                votes[f["name"]][f["space"]] += 1
        self.name_space = {}
        for n, c in votes.items():
            top = c.most_common(2)
            if len(top) == 1 or top[0][1] > top[1][1]:
                self.name_space[n] = top[0][0]

    def param_space(self, p):
        if p.get("example"):                         # 메서드마다 문서 예시 접두사가 가장 구체적이다
            vals = [x.strip("\"' []") for x in p["example"].split(",")]   # 배열 예시 ['T12345', 'C12345'] 는 원소마다 본다
            sp = self.values_space(vals)
            if sp:
                return sp
        if p["name"] in self.plex.get("param_space", {}):
            v = self.plex["param_space"][p["name"]]
            return ("@poly", []) if v == "@resolve" else v
        sp = self.space_of_name(p["name"])
        if sp is not None:
            return sp
        n = p["name"]
        for cand in (n, re.sub(r"s$", "", n), n + "_id"):
            if cand in self.name_space:
                return self.name_space[cand]
        return None

    # ------------------------------------------------------------ 동작 해석
    def parse_op(self, op):
        if op["surface"] == "rpc":
            toks = op["method"].split(".")
            words = camel_split(toks[-1])
            if len(words) > 1 and words[0].lower() in self.lex.get("verb_prefixes", []):
                words = words[1:]                          # bulkGet -> Get
            first = words[0].lower() if words else ""
            if first in self.verbs:
                ns, verb, stem = ".".join(toks[:-1]), first, "".join(words[1:]).lower()
                vcls = self.verbs[first]
            else:
                ns, verb, stem, vcls = ".".join(toks), None, "", None
        else:
            norm = op.get("norm") or [s for s in op["path"].strip("/").split("/") if s]
            item = bool(norm) and norm[-1].startswith("{")
            ns = "/".join(norm[:-1]) if item else "/".join(norm)
            verb, stem = op["http_method"].lower(), ""
            vcls = {"get": "get" if item else None, "post": "create", "put": "update", "patch": "update",
                    "delete": "delete"}[verb]
        op.update(ns=ns, verb=verb, stem=stem, verb_class=vcls)
        op["records"] = self.records(op)
        if vcls is None:
            op["verb_class"] = "list" if any(r["kind"] in ("list", "id_list") for r in op["records"]) else "get"
        pspace = dict(op.get("path_spaces", []))
        for p in op["params"]:
            if p.get("in") == "path" and p["name"] in pspace:
                p["space"] = pspace[p["name"]]
            else:
                p["space"] = self.param_space(p)

    def records(self, op):
        fs = self.by_op.get(op["op_id"], [])
        paths = {f["path"]: f for f in fs}
        out = []
        idnames = {"id", "Id"} | {p["name"] for p in op["params"] if p.get("in") in ("path", "query")
                            and (p.get("in") == "path" or isinstance(self.param_space(p), str))}
        root_id = next((n for n in sorted(idnames) if "$." + n in paths), None)
        if paths.get("$", {}).get("type") == "array" and paths.get("$[*]", {}).get("type") == "object":
            tops = []
            out.append(dict(kind="list", path="$[*]", name=op["ns"].split("/")[-1].split(".")[-1] or "item"))
        elif root_id:                           # 응답 자체가 레코드 (SCIM 단건, REST 단건)
            tops = []
        else:
            tops = [f for f in fs if f["path"].count(".") == 1 and "[*]" not in f["path"] and f["cls"] != "meta"]
        for f in tops:
            item = paths.get(f["path"] + "[*]")
            if f["type"] == "array" and item and item["type"] == "object":
                out.append(dict(kind="list", path=f["path"] + "[*]", name=f["name"]))
            elif f["type"] == "array" and item and item.get("space"):
                out.append(dict(kind="id_list", path=f["path"] + "[*]", name=f["name"], space=item["space"]))
            elif f["type"] == "object":
                out.append(dict(kind="single", path=f["path"], name=f["name"]))
        if root_id and not out:
            out = [dict(kind="single", path="$", name=op["ns"].split("/")[-1].split(".")[-1])]
        if not out and op.get("verb_class") in ("get", None) and any(
                f["path"].count(".") == 1 and f["cls"] != "meta" for f in fs):
            # 맨 위가 스칼라 값뿐인 응답 (getCustomRetention): 응답 자체가 하나짜리 레코드
            out = [dict(kind="single", path="$", name=op["stem"] or op["method"].split(".")[-1])]
        singles = [r for r in out if r["kind"] == "single" and paths.get(r["path"] + ".id")]
        if len({str(paths[r["path"] + ".id"].get("space")) for r in singles}) >= 2:
            # 서로 다른 공간의 객체가 맨 위에 여럿이면 그것들은 참조이고 응답 자체가 레코드다 (oauth.v2.access)
            out = [r for r in out if r not in singles] + [dict(kind="single", path="$", name=op["method"].split(".")[-1])]
        for r in out:
            lk = [f for f in fs if f["path"].startswith(r["path"] + ".") and f["cls"] == "local_key"
                  and f["path"].count(".") == r["path"].count(".") + 1]
            r["local_key"] = lk[0]["name"] if lk else None
            idf = paths.get(r["path"] + ".id")
            if idf is None:                      # REST: 동작이 받는 ID 파라미터와 같은 이름의 필드 (accountId)
                idf = next((paths[r["path"] + "." + n] for n in sorted(idnames) if r["path"] + "." + n in paths), None)
            r["schema"] = (paths.get(r["path"]) or {}).get("schema")
            r["has_id"] = idf is not None
            r["id_example"] = idf.get("example") if idf else None
            r["id_space"] = idf["space"] if idf and isinstance(idf["space"], str) else None
            r["id_poly"] = idf["space"][1] if idf and isinstance(idf["space"], tuple) and idf["name"] not in ("id", "Id") else None
            if idf is not None and idf["name"] in ("id", "Id") and isinstance(idf["space"], tuple):
                r["id_space"] = None                 # 레코드 자기 id 가 다형 참조로 잘못 분류되지 않게
            if op["surface"] == "rest" and idf is not None and not r["id_space"] and not r["id_poly"]:
                # REST 레코드의 공간: ID 쿼리 파라미터의 공간, 단건이면 마지막 경로 파라미터, 목록이면 컬렉션 경로의 공간
                qp = next((x for x in op["params"] if x["name"] == idf["path"].split(".")[-1] and x.get("in") == "query"), None)
                qsp = self.param_space(qp) if qp else None
                if isinstance(qsp, str):
                    r["id_space"] = qsp
                elif r["path"] == "$" and op.get("path_spaces") and (op.get("norm") or [""])[-1].startswith("{"):
                    sp = op["path_spaces"][-1][1]
                    r["id_space"] = sp if isinstance(sp, str) else None
                elif r["kind"] == "list":
                    r["id_space"] = self.coll_space.get(op["ns"])
        return out

    # ------------------------------------------------------------ 후보
    def cand(self, key, kind, name, rule, record, **extra):
        cid = "cand_" + hashlib.sha256(json.dumps([self.p, key]).encode()).hexdigest()[:12]
        c = self.cands.get(cid)
        if c is None:
            c = dict(candidate_id=cid, provider=self.p, key=list(key), kind=kind, names=collections.Counter(),
                     evidence=[], parent=None, ops=set(), audited_actions=set(), emits=set(), read_by=set(), write_by=set(),
                     field_classes=collections.Counter(), refs_out=set())
            self.cands[cid] = c
        if kind != c["kind"] and c["kind"] in ("ref_only", "event_only", "namespace_only"):
            c["kind"] = kind                    # 더 강한 근거가 오면 승격
        if name:
            c["names"][name] += 1
        c["evidence"].append((rule, record))
        for k, v in extra.items():
            if k == "op":
                c["ops"].add(v)
            elif k == "parent" and v:
                c["parent"] = v
        return c

    def q(self, kind, what, **detail):
        self.queue.append(dict(kind=kind, what=what, **detail))

    def run(self):
        self.build_spaces()
        self.build_rest_spaces()
        self.classify()
        for op in self.ops.values():
            self.parse_op(op)
        # 다리 B1 (같은 스키마): 공간을 아는 레코드의 스키마로, 공간을 모르는 레코드를 잇는다
        schema_space = collections.defaultdict(set)
        for op in self.ops.values():
            for r in op["records"]:
                if r.get("schema") and r["id_space"]:
                    schema_space[r["schema"]].add(r["id_space"])
        for op in self.ops.values():
            for r in op["records"]:
                if r.get("schema") and not r["id_space"] and not r["id_poly"]:
                    # 같은 스키마면 같은 대상이다. 이 동작에 ID 파라미터가 없어 id 필드를 못 정했어도 마찬가지
                    sps = schema_space.get(r["schema"], set())
                    if len(sps) == 1:
                        r["id_space"] = next(iter(sps))
                        r["has_id"] = True
                        r["by_schema"] = True
        self.param_names = {p["name"] for o in self.ops.values() for p in o["params"]}     # 쓰기 가능한 필드 이름
        space_cid = {}

        # E1 + 소유: 자기 id 를 가진 레코드가 공간의 주인이다
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            for r in op["records"]:
                if r["id_space"] and r["kind"] in ("list", "single"):
                    c = self.cand(("space", r["id_space"]), "entity", self.rec_name(op, r), "E1", op["op_id"], op=op["op_id"])
                    space_cid[r["id_space"]] = c["candidate_id"]
                elif r["id_poly"]:
                    self.q("poly_record_id", op["op_id"], record=r["path"], spaces=r["id_poly"])
        ns_space = collections.defaultdict(set)
        for op in self.ops.values():
            for r in op["records"]:
                if r["id_space"] and r["kind"] in ("list", "single"):
                    ns_space[op["ns"]].add(r["id_space"])
        # 이름공간의 모든 동작을 그 공간 후보에 붙인다 (이름공간이 공간 하나로 정해질 때만)
        for op in self.ops.values():
            sps = ns_space.get(op["ns"], set())
            if len(sps) == 1:
                cid = space_cid[next(iter(sps))]
                self.cands[cid]["ops"].add(op["op_id"])
                op["cand"] = cid

        # E3d, 하나짜리, E2, E7 (레코드 안쪽)
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            pspaces = sorted({p["space"] for p in op["params"] if isinstance(p["space"], str)})
            for r in op["records"]:
                c = None                                 # 이 레코드로 만든 후보. 응답 안 레코드가 여럿이면 각자 자기 후보에 붙는다
                if r["kind"] == "id_list" and isinstance(r["space"], str):
                    others = [s for s in pspaces if s != r["space"]]
                    if len(others) == 1:
                        key = ("assoc",) + tuple(sorted([others[0], r["space"]])) + ("",)
                        c = self.cand(key, "association", op["method"], "E3d", op["op_id"], op=op["op_id"])
                        op.setdefault("cand", c["candidate_id"])
                no_id = r["kind"] in ("list", "single") and not r["id_space"] and not r["id_poly"]
                if no_id and r["has_id"]:
                    # 자기 id 는 있는데 접두사를 모른다: 독립 대상으로 두고 공간은 대기열에서 정한다
                    noun = self.rec_name(op, r)
                    c = self.cand(("unknown_space", op["ns"], noun), "entity", noun, "E1u", op["op_id"], op=op["op_id"])
                    op.setdefault("cand", c["candidate_id"])
                    self.q("unknown_id_prefix", op["op_id"], record=r["path"], example=r["id_example"])
                elif no_id and r["local_key"] and len(pspaces) == 1:
                    # 부모 안에서만 유일한 키 (Slack 메시지 ts): 키는 [부모 공간, 로컬 키]
                    noun = singular(r["name"])
                    c = self.cand(("local", pspaces[0], noun), "entity", noun, "E1l", op["op_id"],
                                  op=op["op_id"], parent=space_cid.get(pspaces[0]))
                    c["local_key"] = [pspaces[0], r["local_key"]]
                    op.setdefault("cand", c["candidate_id"])
                elif no_id and r["kind"] == "list" and self.about(op, r):
                    # E3e: 자기 id 없이 다른 공간 하나를 가리키는 레코드 (앱 승인 목록)
                    key = ("assoc",) + tuple(sorted(self.about(op, r))) + (op["ns"].split(".")[-1],)
                    c = self.cand(key, "association", op["method"], "E3e", op["op_id"], op=op["op_id"])
                    op.setdefault("cand", c["candidate_id"])
                elif r["kind"] == "single" and no_id:
                    noun = op["stem"] or r["name"]
                    if len(pspaces) == 1:
                        c = self.cand(("singleton", pspaces[0], noun), "singleton", noun, "E1s", op["op_id"],
                                      op=op["op_id"], parent=space_cid.get(pspaces[0]))
                        op.setdefault("cand", c["candidate_id"])
                owner = c["candidate_id"] if c is not None and c["kind"] != "association" else op.get("cand")
                if not owner:
                    continue
                self.inner(op, r, owner)

        # 하나짜리 후보에는 같은 이름공간에서 줄기가 같은 동작을 붙인다 (getConversationPrefs -> setConversationPrefs)
        for c in list(self.cands.values()):
            if c["kind"] != "singleton":
                continue
            nss = {self.ops[o]["ns"] for o in c["ops"] if o in self.ops}
            noun = c["key"][-1]
            for op in self.ops.values():
                if op["ns"] in nss and op["stem"] == noun and op["op_id"] not in c["ops"]:
                    c["ops"].add(op["op_id"])
                    op["cand"] = c["candidate_id"]

        # 같은 이름공간의 남은 동작을 그 이름공간의 레코드 후보에 붙인다 (후보가 하나일 때만)
        ns_cands = collections.defaultdict(set)
        for op in self.ops.values():
            if op.get("cand"):
                ns_cands[op["ns"]].add(op["cand"])
        for op in self.ops.values():
            if not op.get("cand") and len(ns_cands.get(op["ns"], ())) == 1:
                op["cand"] = next(iter(ns_cands[op["ns"]]))
                self.cands[op["cand"]]["ops"].add(op["op_id"])

        # E3a REST 중첩 경로: 마지막 공간의 주인이 다른 (더 짧은) 컬렉션이면 이 경로는 관계다
        owner = {}
        for coll, sp in sorted(self.coll_space.items(), key=lambda kv: (kv[0].count("/"), kv[0])):
            owner.setdefault(sp, coll)
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            ps = [sp for _, sp in op.get("path_spaces", []) if isinstance(sp, str)]
            if op["surface"] != "rest" or len(set(ps)) < 2 or not (op.get("norm") or [""])[-1].startswith("{"):
                continue
            last = ps[-1]
            if owner.get(last) and "{" in owner[last]:
                # 주인이 최상위 컬렉션이 아니다: 부모 안에서만 유일한 키 (issue/{issue}/properties/{propertyKey})
                key = ("local", ps[-2], last)
                c = self.cand(key, "entity", last, "E1l", op["op_id"], op=op["op_id"],
                              parent=space_cid.get(ps[-2]))
                c["local_key"] = [ps[-2], last]
                op.setdefault("cand", c["candidate_id"])
            elif owner.get(last) and owner[last] != op["ns"]:
                key = ("assoc",) + tuple(sorted(set(ps))) + ("",)
                c = self.cand(key, "association", op["ns"], "E3a", op["op_id"], op=op["op_id"])
                op.setdefault("cand", c["candidate_id"])

        # E3b REST: 같은 경로에 생성(또는 수정)과 삭제가 있으면 짝이다
        by_path = collections.defaultdict(dict)
        for op in self.ops.values():
            if op["surface"] == "rest":
                by_path["/".join(op.get("norm") or [])][op["verb_class"]] = op
        for path, vs in sorted(by_path.items()):
            grant = vs.get("create") or vs.get("update")
            if not grant or "delete" not in vs:
                continue
            if path.split("/")[-1].startswith("{"):
                continue                         # 자기 id 로 끝나는 경로의 수정과 삭제는 그 대상 자신의 일이다
            sps = sorted({p["space"] for p in grant["params"] if isinstance(p["space"], str)})
            req = sorted({p["space"] for p in grant["params"] if isinstance(p["space"], str) and p["required"]})
            if len(sps) > 2 and len(req) == 2:
                sps = req
            if len(sps) == 2:
                key = ("assoc",) + tuple(sps) + ("",)
                c = self.cand(key, "association", path, "E3b", grant["op_id"], op=grant["op_id"])
                c["ops"].add(vs["delete"]["op_id"])
            elif len(sps) > 2:
                self.q("assoc_more_than_two", grant["op_id"], spaces=sps)

        # E3b 동사 짝
        pairs = [(a, b, None) for a, b in self.lex["verb_pairs"]] + [tuple(x) for x in self.lex["special_pairs"]]
        by_ns = collections.defaultdict(dict)
        for op in self.ops.values():
            if op["surface"] == "rpc":
                by_ns[op["ns"]][op["method"].split(".")[-1]] = op
        special_last = {x[0] for x in self.lex["special_pairs"]}
        for ns, members in sorted(by_ns.items()):
            for last, op in sorted(members.items()):
                for a, b, special in pairs:
                    if not special and last in special_last:
                        continue                    # 특수 짝이 있는 동작은 일반 짝을 다시 적용하지 않는다
                    if special:
                        if last != a or b not in members:
                            continue
                        stem = special
                    else:
                        if op["verb"] != a:
                            continue
                        rev = b + last[len(a):]
                        if rev not in members:
                            continue
                        stem = op["stem"]
                    bad = [p["name"] for p in op["params"] if p["required"] and not isinstance(p["space"], str)
                           and (p["space"] is not None or p["name"].endswith(("_id", "_ids")))]
                    if bad:
                        self.q("assoc_param_unresolved", op["op_id"], params=bad)
                        continue
                    sps = sorted({p["space"] for p in op["params"] if isinstance(p["space"], str)})
                    req = sorted({p["space"] for p in op["params"] if isinstance(p["space"], str) and p["required"]})
                    if len(sps) > 2 and len(req) == 2:
                        sps = req                       # 공간이 셋 이상이면 필수 파라미터의 둘만 쓴다
                    if len(sps) == 2:
                        key = ("assoc",) + tuple(sps) + (stem,)
                        c = self.cand(key, "association", op["method"], "E3b", op["op_id"], op=op["op_id"])
                        rev_op = members[b] if special else members[b + last[len(a):]]
                        c["ops"].add(rev_op["op_id"])
                    elif len(sps) > 2 and len(req) == 1:
                        # 필수 공간 하나 + 선택 공간 여럿: 선택 쪽은 대상의 대안이다 (canvases.access.set 의 channel_ids, user_ids)
                        key = ("assoc", req[0], "@resolve", stem)
                        c = self.cand(key, "association", op["method"], "E3b", op["op_id"], op=op["op_id"])
                        c["ops"].add((members[b] if special else members[b + last[len(a):]])["op_id"])
                        self.q("assoc_optional_alternatives", op["op_id"], spaces=sps)
                    elif len(sps) > 2:
                        self.q("assoc_more_than_two", op["op_id"], spaces=sps)
                    elif not op["params"]:
                        self.q("pair_without_params", op["op_id"], note="짝 동사는 있으나 파라미터 자료가 없음")

        # E3c 플래그
        stems = self.lex["flag_stem"]
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            for r in op["records"]:
                if not r["id_space"]:
                    continue
                fs = [f for f in self.by_op[op["op_id"]] if f["path"].startswith(r["path"] + ".")
                      and f["path"].count(".") == r["path"].count(".") + 1]
                scope_spaces = set(self.plex.get("scope_spaces", []))      # 플래그 관계의 범위 공간 (사전)
                tenant = sorted({f["space"] for f in fs if f["cls"] == "ref" and isinstance(f["space"], str) and f["space"] in scope_spaces}
                                | {p["space"] for p in op["params"] if isinstance(p["space"], str) and p["space"] in scope_spaces})
                for f in fs:
                    if f["cls"] == "flag":
                        if tenant:
                            key = ("assoc",) + tuple(sorted([r["id_space"], tenant[0]])) + (stems[f["name"]],)
                            self.cand(key, "association", f["name"], "E3c", op["op_id"] + ":" + f["path"])
                        else:
                            self.q("flag_without_tenant", op["op_id"], field=f["path"])

        # 이름공간만 있는 동작 (공간 미정)
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            if op.get("cand"):
                continue
            used = any(op["op_id"] in c["ops"] for c in self.cands.values())
            if used:
                continue
            c = self.cand(("ns", op["ns"]), "namespace_only", op["ns"].split(".")[-1].split("/")[-1], "E1n",
                          op["op_id"], op=op["op_id"])
            op["cand"] = c["candidate_id"]
            for r in op["records"]:
                self.inner(op, r, c["candidate_id"])

        # E6 참조 대상: 주인 없는 공간 -> ref_only
        for f in self.fields:
            if f["cls"] != "ref" or f["side"] != "response":
                continue
            sp = f["space"]
            if isinstance(sp, str):
                if sp not in space_cid:
                    c = self.cand(("space", sp), "ref_only", sp, "E6", f["op_id"] + ":" + f["path"])
                    space_cid[sp] = c["candidate_id"]
            elif isinstance(sp, tuple):
                self.q("poly_ref", f["op_id"], field=f["path"], spaces=sp[1])
            else:
                self.q("unresolved_ref", f["op_id"], field=f["path"])
        for op in self.ops.values():
            for p in op["params"]:
                sp = p["space"]
                if isinstance(sp, str) and sp not in space_cid:
                    c = self.cand(("space", sp), "ref_only", sp, "E6p", op["op_id"] + ":" + p["name"])
                    space_cid[sp] = c["candidate_id"]

        # E4 감사 로그와 이벤트 카탈로그 (다리 B3 접두사, B4 별칭)
        alias = self.plex.get("audit_alias", {})
        tokmap = {s: s for s in self.spaces}                  # 공간 이름 자체 (다리 B4 의 기본값)
        tokmap.update(self.plex.get("namespace_token_space", {}))
        tokmap.update(alias)
        lpairs = {}
        for a, b in self.lex["audit_lifecycle_pairs"]:
            lpairs[a], lpairs[b] = b, a
        names = collections.defaultdict(set)
        for e in self.events:
            names[e["catalog"]].add(e["name"])
        payload = collections.defaultdict(list)
        for f in self.fields:
            if f["side"] == "payload":
                payload[f["op_id"][len("event:"):]].append(f)
        for e in sorted(self.events, key=lambda e: e["event_id"]):
            if e["catalog"] == "audit_entity":
                sp = alias.get(e["name"])
                if sp and sp in space_cid:
                    self.cands[space_cid[sp]]["evidence"].append(("E4", e["event_id"]))
                    self.cands[space_cid[sp]]["names"][e["name"]] += 1
                else:
                    self.cand(("event", e["name"]), "event_only", e["name"], "E4", e["event_id"])
                continue
            # provider 사전의 action_stop_extra 는 표시 이름 감사 활동의 제품 이름이다 (added_confluence_page -> page)
            ign = set(self.lex.get("event_ignore_tokens", [])) | set(self.plex.get("action_stop_extra", []))
            toks = [x for x in re.split(r"[_:]", e["name"]) if x not in ign]
            vi = next((i for i in range(len(toks) - 1, -1, -1) if toks[i] in lpairs), None)
            noun = [x for i, x in enumerate(toks) if i != vi]
            sps = [tokmap[x] for x in noun if x in tokmap]
            rest = [x for x in noun if x not in tokmap]
            paired = vi is not None and "_".join(toks[:vi] + [lpairs[toks[vi]]] + toks[vi + 1:]) in names[e["catalog"]]
            rec = "audited_actions" if e["catalog"] == "audit" else "emits"
            # 이벤트 payload 맨 위의 ID 필드가 가리키는 공간 (다리 B3)
            pspaces = sorted({f["space"] for f in payload.get(e["name"], [])
                              if isinstance(f["space"], str) and f["path"].count(".") == 1})
            for sp in pspaces:
                if sp in space_cid and e["catalog"] == "event_api":
                    self.cands[space_cid[sp]]["emits"].add(e["name"])
            if paired and len(set(sps)) >= 2 and not rest:
                key = ("assoc",) + tuple(sorted(set(sps))[:2]) + ("",)
                c = self.cand(key, "association", e["name"], "E4b", e["event_id"])
                c[rec].add(e["name"])
            elif paired and rest:
                parent = space_cid.get(sps[0]) if sps else None
                noun_name = "_".join(noun)
                c = self.cand(("event", noun_name), "event_only", noun_name, "E4c", e["event_id"], parent=parent)
                c[rec].add(e["name"])
            else:
                cat = alias.get(e.get("category", ""))
                hit = False
                for sp in sorted(set(sps)) or ([cat] if cat else []) or pspaces:
                    if sp in space_cid:
                        self.cands[space_cid[sp]][rec].add(e["name"])
                        hit = True
                if not hit:
                    self.q("audit_unmapped" if e["catalog"] == "audit" else "event_unmapped", e["event_id"],
                           category=e.get("category"))

        # E5 권한 어휘 (다리 B2)
        for v in self.vocab:
            hit = False
            for oid in v["op_ids"]:
                op = self.ops.get(oid)
                cids = [c for c in self.cands.values() if oid in c["ops"]]
                for c in cids:
                    hit = True
                    (c["read_by"] if op["verb_class"] in ("list", "get") else c["write_by"]).add(v["name"])
            if not hit:
                self.cand(("vocab", v["name"]), "vocab_only", v["name"], "E5", v["grant_id"])

        # C5 쓰기 대상 미정, C6 구멍
        for op in self.ops.values():
            if op["verb_class"] in ("create", "update", "delete") and not op["params"]:
                self.q("write_target_unknown", op["op_id"], note="파라미터 자료 없음")
        for h in self.holes:
            self.q("hole_" + h["hole"], h["op_id"], field=h["path"])
        # 이름만 비슷한 후보 (자동으로 합치지 않는다)
        norm = collections.defaultdict(list)
        for c in self.cands.values():
            top = c["names"].most_common(1)[0][0] if c["names"] else c["key"][-1]
            norm[singular(re.sub(r"[^a-z]", "", str(top).lower()))].append(c["candidate_id"])
        for n, ids in norm.items():
            if len(ids) > 1:
                self.q("same_name_hint", n, candidates=sorted(ids))
        return self

    def rec_name(self, op, r):
        """레코드 이름: 래퍼 이름(values, results)이면 스키마 이름, 없으면 경로의 마지막 단어"""
        n = r["name"]
        if n in self.lex.get("generic_record_names", []) or n in ("$", ""):
            if r.get("schema"):
                return self.snake(r["schema"])
            words = [w for w in re.split(r"[/.]", op["ns"]) if w and not w.startswith("{")]
            n = words[-1] if words else n
        return singular(self.snake(n))

    def about(self, op, r):
        """id 없는 레코드가 가리키는 다른 공간이 하나면 (그 공간, 범위 공간). 범위는 파라미터 공간 하나, 없으면 @tenant."""
        d = r["path"].count(".")
        fs = [f for f in self.by_op[op["op_id"]] if f["path"].startswith(r["path"] + ".")]
        near = [f for f in fs if f["space"] is not None and (
            (f["cls"] == "ref" and f["path"].count(".") == d + 1) or (f["name"] == "id" and f["path"].count(".") == d + 2))]
        refs = sorted({f["space"] if isinstance(f["space"], str) else "@resolve" for f in near})
        if not refs:
            return None
        ps = sorted({p["space"] for p in op["params"] if isinstance(p["space"], str) and p["required"]} - set(refs))
        if len(ps) > 1:
            return None
        if len(refs) == 1:
            return refs + [ps[0] if ps else "@tenant"]
        return refs                              # 다자 관계 (역할 배정: role, user, 대상)

    def inner(self, op, r, owner):
        """레코드 안쪽: E2 내장 객체, E7 필드 분리, 필드 class 집계."""
        c = self.cands[owner]
        base = r["path"]
        fs = [f for f in self.by_op[op["op_id"]] if f["path"].startswith(base + ".")]
        objs = {f["path"] for f in fs if f["type"] == "object"}
        d0 = base.count(".") + 1
        rnames = set(self.lex.get("recipient_names", []))
        # 권한 플래그 묶음 (Salesforce PermissionSet, Profile 의 PermissionsXxx boolean)
        pf = {f["name"] for f in fs if f["type"] == "boolean" and f["path"].count(".") == d0
              and f["name"].startswith(tuple(self.lex.get("permission_field_prefixes", [])))}
        if any(f["name"] in self.plex.get("permission_family_fields", []) and f["path"].count(".") == d0 for f in fs):
            pf.add("@family")                    # 권한 필드 묶음을 한 줄로 적은 자리 (Salesforce PermissionsPermissionName)
            pf |= {"@family%d" % i for i in range(self.lex.get("policy_min_permission_flags", 5))}
        c["perm_flags"] = max(c.get("perm_flags", 0), len(pf))
        for f in fs:
            depth = f["path"].replace("[*]", "").count(".") - base.replace("[*]", "").count(".")
            c.setdefault("child_names", set()).add(f["name"]) if depth == 1 else c.setdefault("desc_names", set()).add(f["name"])
            # 받는 쪽 참조 필드 (AssigneeId, UserOrGroupId, memberId): 이름 줄기가 사전 recipient_names 에 있다
            stem = re.sub(r"(_ids|_id|Ids|Id)$", "", f["name"])
            if f["cls"] == "ref" and f["space"] and self.snake(stem).replace("_", "") in rnames:
                sp = f["space"] if isinstance(f["space"], str) else "@poly:" + "|".join(f["space"][1])
                if sp != "@poly:":
                    c.setdefault("recipients", collections.Counter())[(sp, "direct" if depth == 1 else "nested")] += 1
            # 받는 쪽 객체 (holder: {type, parameter}, principal: {type, id}): type 값을 공간으로
            if f["name"] == "type" and depth >= 2:
                oname = f["path"].split(".")[-2].replace("[*]", "")
                if oname in self.lex.get("recipient_objects", []):
                    vals = f.get("enum") or self.plex.get("recipient_types", {}).get(oname, [])
                    tmap = self.plex.get("recipient_type_space", {})
                    sps = sorted({tmap.get(v, self.canon(self.snake(v))) for v in vals} - {None, ""})
                    if sps:
                        # 공간 목록이 아직 다 모이지 않았다. 출력 때 실제 공간만 남긴다 (write)
                        sp = "@rcpt:" + "|".join(sps)
                        c["refs_out"].add(sp)
                        c.setdefault("recipients", collections.Counter())[(sp, "direct" if depth == 2 else "nested")] += 1
        for f in fs:
            c["field_classes"][f["cls"]] += 1
            if f["cls"] == "ref" and isinstance(f["space"], str):
                c["refs_out"].add(f["space"])
            elif f["cls"] == "ref" and isinstance(f["space"], tuple) and f["space"][1]:
                c["refs_out"].add("@poly:" + "|".join(f["space"][1]))     # 다형 참조 (UserOrGroupId -> group|user)
            rel = f["path"][len(base):]
            if f["cls"] in ("url", "secret", "scope") and not (
                    f["path"].endswith("[*]") and any(g["path"] == f["path"][:-3] and g["cls"] == f["cls"] for g in fs)):
                d = self.cand(("field", owner, rel), "field_derived", f["name"], "E7", op["op_id"] + ":" + f["path"],
                              parent=owner)
                info = d.setdefault("field", dict(cls=f["cls"], examples=set(), config=False, writable=False,
                                                  tail=".".join(f["path"].replace("[*]", "").split(".")[-2:])))
                if f.get("example"):
                    info["examples"].add(f["example"])
                info["config"] = info["config"] or bool(f.get("from_manifest_schema"))     # 앱 설정 스키마의 필드
                # 같은 후보에 붙은 동작이 이 이름의 파라미터를 받으면 쓰기 가능 (전역 이름 대조는 너무 넓다)
                info["writable"] = info["writable"] or any(
                    f["name"] in {p["name"] for p in self.ops[o]["params"]} for o in self.cands[owner]["ops"] if o in self.ops)
        for o in sorted(objs):
            idf = next((f for f in fs if f["path"] == o + ".id"), None)
            if idf and not idf["space"]:
                rel = o[len(base):]
                self.cand(("embedded", owner, rel), "embedded", o.split(".")[-1].replace("[*]", ""), "E2",
                          op["op_id"] + ":" + o, parent=owner)

    # ------------------------------------------------------------ 출력
    def write(self):
        out = os.path.join(HERE, "out", self.p)
        rows = []
        known = {c["key"][1] for c in self.cands.values() if c["key"][0] == "space"}

        def rcpt(x):
            if not x.startswith("@rcpt:"):
                return x
            sps = [s for s in x[6:].split("|") if s in known]
            return None if not sps else sps[0] if len(sps) == 1 else "@poly:" + "|".join(sps)
        for c in self.cands.values():
            c["refs_out"] = {y for y in map(rcpt, c["refs_out"]) if y}
            if c.get("recipients"):
                rc = collections.Counter()
                for (sp, d), n in c["recipients"].items():
                    if rcpt(sp):
                        rc[(rcpt(sp), d)] += n
                c["recipients"] = rc
            names = c["names"].most_common()
            if c["key"][0] == "space":
                # 공간 키와 같은 이름이 있으면 그것을 대표 이름으로 (Jira user 공간이 "search" 로 불리던 문제)
                same = [n for n in names if self.canon(self.snake(str(n[0]))) == c["key"][1]]
                names = same[:1] + [n for n in names if n not in same[:1]]
            rows.append(dict(
                candidate_id=c["candidate_id"], provider=self.p, kind=c["kind"], key=c["key"],
                name=names[0][0] if names else str(c["key"][-1]), aliases=sorted(n for n, _ in names[1:]),
                parent=c["parent"], local_key=c.get("local_key"),
                evidence=sorted({"%s %s" % e for e in c["evidence"]}),
                features=dict(ops=sorted(c["ops"]),
                              verb_classes=dict(sorted(collections.Counter(
                                  self.ops[o]["verb_class"] for o in c["ops"] if o in self.ops).items())),
                              rules=sorted({e[0] for e in c["evidence"]}),
                              op_verbs=sorted({"%s:%s" % (self.ops[o]["verb_class"], self.ops[o]["stem"])
                                               for o in c["ops"] if o in self.ops}),
                              scim=any(o.split(".")[1] == "scim" for o in c["ops"]),     # 정규화 규칙: <provider>.scim.*
                              field=dict(c["field"], examples=sorted(c["field"]["examples"])[:3]) if c.get("field") else None,
                              audited_actions=sorted(c["audited_actions"]),
                              emits_events=sorted(c["emits"]),
                              read_by=sorted(c["read_by"]), write_by=sorted(c["write_by"]),
                              refs_out=sorted(c["refs_out"]),
                              recipients=sorted("%s %s" % k for k in c.get("recipients", {})),
                              perm_flags=c.get("perm_flags", 0),
                              child_names=sorted(c.get("child_names", ())),
                              desc_names=sorted(c.get("desc_names", ())),
                              # 다른 공간의 경로 아래에서 이 대상의 목록을 읽는 동작 (GET /spaces/{id}/pages)
                              listed_under=sorted({sp for o in c["ops"] if o in self.ops
                                                   and self.ops[o]["verb_class"] == "list"
                                                   for _, sp in self.ops[o].get("path_spaces", [])
                                                   if isinstance(sp, str) and sp != c["key"][1]}),
                              # 생성 동작이 반드시 받는 주소 파라미터 (POST /webhook 의 url)
                              required_url_params=sorted({p["name"] for o in c["ops"] if o in self.ops
                                                          and self.ops[o]["verb_class"] == "create"
                                                          for p in self.ops[o]["params"]
                                                          if p.get("required") and p.get("in") == "body"
                                                          and any(p["name"].endswith(s) for s in self.lex["field_names"]["url_suffix"])}),
                              # 다른 공간의 경로 아래에서 이 대상을 쓰는 동작 (PUT /project/{project}/permissionscheme)
                              attached_under=sorted({sp for o in c["ops"] if o in self.ops
                                                     and self.ops[o]["verb_class"] in ("create", "update")
                                                     for _, sp in self.ops[o].get("path_spaces", [])
                                                     if isinstance(sp, str) and sp != c["key"][1]}) if c["key"][0] == "space" else [],
                              field_classes=dict(sorted(c["field_classes"].items())))))
        rows.sort(key=lambda r: (r["kind"], r["name"], r["candidate_id"]))
        with io.open(os.path.join(out, "candidates.jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        qs = sorted(self.queue, key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
        with io.open(os.path.join(out, "queue.jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for r in qs:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        meta = dict(ir_manifest=json.load(io.open(os.path.join(self.ir, "manifest.json"), encoding="utf-8")),
                    lexicons={n: hashlib.sha256(open(os.path.join(HERE, "lexicons", n), "rb").read()).hexdigest()[:12]
                              for n in ("common.yaml", self.p + ".yaml")},
                    spaces=dict(prefix=self.prefix_space,
                                poly={k: v[1] for k, v in self.space_of_def.items() if isinstance(v, tuple)}))
        with io.open(os.path.join(out, "run.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1, sort_keys=True)
        kinds = collections.Counter(r["kind"] for r in rows)
        qk = collections.Counter(q["kind"] for q in qs)
        print("후보", len(rows), dict(sorted(kinds.items())))
        print("대기열", len(qs), dict(sorted(qk.items())))
        return rows, qs


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    Extractor(sys.argv[1] if len(sys.argv) > 1 else "slack").run().write()
