# -*- coding: utf-8 -*-
"""정보 지도 v0. 「정보 지도 설계.md」의 ①~④를 타입 수준에서 돌린다. ⑤ 단위화는 하지 않는다.

    python info_map.py slack        # out/<provider>/ir/ 와 lexicons/ 를 읽어 out/<provider>/info_map.json 에 쓴다

extract.py 의 ID 공간과 필드 분류(③)를 그대로 쓴다. description 은 읽지 않는다.
구현한 규칙: I1~I8(한 응답 안), S4(결정자와 경로와 타입이 같으면 같은 항목), S2(쓰기 요청 본문 경로 = 같은 대상의 응답 경로),
사본, 변경(감사 category), 열람 권한, 쓰기 짝(structural), 필터(조회 인자 -> 그 동작 응답의 항목).
요청은 자리가 아니다. 우리가 보내는 값이지 SaaS 가 돌려주는 상태가 아니어서, 항목을 만들지 않고 항목 사이의 근거(쓰기, 필터)로만 쓴다.
아직 없는 규칙: S1(스키마 공유, Slack 명세에 스키마 참조가 없다), S3, S5.
"""
import collections
import io
import json
import os
import re
import sys

from extract import Extractor, HERE, singular

SKIP_NAMES = {"ok", "response_metadata", "next_cursor", "warning", "error", "needed", "provided", "cursor"}


def base_types(t):
    ts = t if isinstance(t, list) else [t]
    return tuple(sorted({x for x in ts if x not in ("null", None, "unknown")}))


def det_key(d):
    kind, val = d
    return kind + ":" + (val if isinstance(val, str) else "+".join(val))


class InfoMap:
    def __init__(self, provider):
        self.p = provider
        ex = Extractor(provider)
        ex.build_spaces()
        ex.build_rest_spaces()
        ex.classify()
        for op in ex.ops.values():
            try:
                ex.parse_op(op)
            except Exception:                   # 해석 못 한 동작은 쓰기 짝에서만 빠진다
                op.setdefault("verb_class", None)
        self.ex = ex
        self.tenant = set(ex.plex.get("scope_spaces", []))
        self.alias = ex.plex.get("audit_alias", {})
        self.queue = []

    # ---------------------------------------------------------------- ① 자리
    def slots(self):
        seen, out = set(), []
        wraps = self.ex.plex.get("response_wrappers", [])
        for f in self.ex.fields:
            for w in wraps:                                  # 응답 래퍼를 벗긴다 ($.data.id -> $.id)
                if f["side"] == "response" and (f["path"] == "$." + w or f["path"].startswith(("$.%s." % w, "$.%s[*]" % w))):
                    f = dict(f, path="$" + f["path"][len("$." + w):])
                    if f["path"] == "$" and f["type"] == "object":
                        f = None
                    break
            if f is None:
                continue
            k = (f["op_id"], f["side"], f["path"])
            if k in seen:
                continue
            seen.add(k)
            out.append(f)
        return out

    # ---------------------------------------------------------------- ② 한 응답 안
    def anchors(self, fields, root=None):
        """객체 경로 -> 그 객체의 id 가 속한 공간 (I1). 같은 객체의 id class 필드가 근거다."""
        a = {}
        for f in fields:
            if f["name"].lower() == "id" and isinstance(f.get("space"), str):   # Salesforce 는 Id
                a[f["path"][: -len(".id")]] = ("space", f["space"])
        # I1b: id 의 공간을 값으로 못 정하면 그 객체의 응답 스키마 이름으로 정한다 (다리 B1). GitHub 는 ID 에 접두사가 없다
        sch = {}
        for f in fields:
            if f["type"] == "object" and f.get("schema"):
                sch.setdefault(f["path"], f["schema"])
        osp = self.ex.plex.get("object_space", {})
        for f in fields:
            if f["name"].lower() == "id" and f.get("space") is None:
                obj = f["path"][: -len(".id")]
                sp = self.schema_space(sch.get(obj))
                if not sp:
                    # I1c: 스키마 이름이 없으면 객체를 담은 속성 이름으로 정한다 ($.repository -> repo). 사전 object_space
                    last = re.sub(r"\[\*\]$", "", obj.rsplit(".", 1)[-1])
                    sp = osp.get(last)
                    sp = sp if isinstance(sp, str) and not sp.startswith("@") else None
                if sp and obj not in a:
                    a[obj] = ("space", sp)
        # I7: 응답 최상위 배열의 원소가 자기 키(id, ts) 없이 둘 이상의 참조를 들면 그 참조들의 조합이 결정자다
        #     (admin.roles.listAssignments 의 role_assignments[*] = role_id, user_id, entity_id).
        #     레코드 안의 테넌트 참조는 조합에 넣는다. I6 의 테넌트 제외는 요청 맥락(파라미터, 토큰)에만 쓴다.
        #     역할 배정의 대상이 워크스페이스면 team 이 대상 자리다 (Relation_Schema_v3 has_role_on).
        #     공간이 여럿일 수 있는 참조(사전 "@resolve" 또는 다형 정의)는 "@<이름 줄기>" 한 자리로 넣는다.
        refs, keyed = collections.defaultdict(set), set()
        resolve = {n for n, v in self.ex.plex.get("field_space", {}).items() if v == "@resolve"}
        for f in fields:
            if f["cls"] in ("id", "local_key") or f["name"].lower() == "id":
                keyed.add(f["path"].rsplit(".", 1)[0])      # 자기 키(id, ts)가 있으면 조합이 아니다 (메시지 목록)
        # 배열 이름을 딴 키 필드(active_sessions[*].session_id, views[*].view_id)는 그 레코드의 자기 키다.
        # 공간이 정해진 키면 그 공간, 아니면 키 이름 줄기를 새 공간 이름으로 쓴다
        rka = self.ex.plex.get("record_key_alias", {})
        for f in fields:
            obj = f["path"].rsplit(".", 1)[0]
            if not (obj.endswith("[*]") and obj.count(".") == 1) or obj in a or not f["name"].endswith("_id"):
                continue
            if f["name"] in resolve or isinstance(f.get("space"), tuple):
                continue                                  # 다형 참조(entity_id)는 가리키는 값이지 자기 키가 아니다
            arr, stem = obj[2:-3], f["name"][:-3]
            sp = f.get("space") if isinstance(f.get("space"), str) else None
            if rka.get(arr) == f["name"]:
                a[obj] = ("space", sp or stem)            # 사전이 정한 키: 필드 공간을 따른다
            elif singular(arr).endswith(stem):
                # 이름이 정한 키: 이름 줄기가 공간이다. 예시 값 접두사가 다르면 이름을 따르고 대기열에 남긴다
                # (listViews 의 view_id 예시가 T1234567890 이다)
                if sp and sp != stem:
                    self.queue.append({"kind": "key_prefix_conflict", "path": f["path"], "name_space": stem, "example_space": sp})
                a[obj] = ("space", stem)
            else:
                continue
            keyed.add(obj)
        for f in fields:
            obj = f["path"].rsplit(".", 1)[0]
            if not (obj.endswith("[*]") and obj.count(".") == 1 and f["cls"] == "ref"):
                continue
            if not (re.search(r"(_ids?|Ids?)$", f["name"]) or f["name"] in self.ex.plex.get("field_space", {})):
                continue                                  # 이름이 참조가 아닌 필드는 뺀다 (entity_type 의 예시 값 USER 가 U 접두사로 읽힌다)
            sp = f.get("space")
            if f["name"] in resolve or isinstance(sp, tuple):
                refs[obj].add("@" + re.sub(r"(_ids?|Ids?)$", "", f["name"]))
            elif isinstance(sp, str):
                refs[obj].add(sp)
        for obj, sps in refs.items():
            if obj not in a and obj not in keyed and len(sps) >= 2:
                a[obj] = ("combo", tuple(sorted(sps)))
        # 자기 공간 id 가 없고 부모 안에서만 유일한 키(ts)를 가진 객체: (부모 결정자, 키 이름)이 결정자다
        for f in fields:
            if f["cls"] == "local_key":
                obj = f["path"].rsplit(".", 1)[0]
                if obj in a:
                    continue
                cur, par = obj, None
                while "." in cur:
                    cur = cur.rsplit(".", 1)[0]
                    if cur in a and a[cur][0] == "space":
                        par = a[cur][1]
                        break
                if par is None and root and root[0] == "space":
                    par = root[1]                          # 부모가 응답 밖(요청 파라미터)에 있다
                a[obj] = ("local", "%s/%s" % (par or "?", f["name"]))
        return a

    def schema_space(self, name):
        """응답 스키마 이름 -> 공간. 사전 schema_space, 아니면 접사(simple-, full- ...)를 뗀 이름이 이미 아는 공간일 때만"""
        if not name:
            return None
        ss = self.ex.plex.get("schema_space", {})
        if name in ss:
            return ss[name]
        aff = set(self.ex.plex.get("schema_affixes", []))
        toks = [t for t in name.split("-") if t not in aff]
        known = set(self.ex.spaces) | set(ss.values()) | {v for v in self.ex.plex.get("field_space", {}).values() if isinstance(v, str)}
        for c in ("_".join(toks), "-".join(toks)):
            if c in ss:
                return ss[c]
            if c in known:
                return c
        return None

    def root_det(self, op_id, side):
        """최상위에 id 가 없을 때의 결정자. 응답이면 요청 파라미터의 공간(I2), 이벤트면 사건 자체."""
        if side == "payload":
            return ("event", op_id)
        if side == "audit":
            return ("event", "audit")              # 감사 로그 필드 (action 공통 자리)
        op = self.ex.ops.get(op_id, {})
        if op.get("verb_class") == "list":
            return ("op", op_id)                   # 목록과 검색의 파라미터는 필터다. 결과를 결정하지 않는다
        ps_ = op.get("path_spaces") or []
        norm = op.get("norm") or []
        if ps_ and isinstance(ps_[-1][1], str) and norm and norm[-1].startswith("{") and ps_[-1][1] not in self.tenant:
            # I2c: REST 경로가 파라미터로 끝나면 마지막 파라미터의 공간이 대상이고 앞 파라미터는 범위다
            #      (/repos/{owner}/{repo}/issues/{issue_number} -> issue). 설계 3.0 「주인」과 같다
            return ("space", ps_[-1][1])
        if ps_ and norm and not norm[-1].startswith("{"):
            # I2d: 경로가 단어로 끝나면(/issues/{issue_number}/lock) 결과는 마지막 ID 공간의 것이다. 앞 파라미터는 범위다
            last = [sp for _, sp in ps_ if isinstance(sp, str) and sp not in self.tenant]
            if last:
                return ("space", last[-1])
        if ps_ and ps_[-1][1] is None:
            # 경로 끝 파라미터가 ID 가 아니면(branch, path, tag) 앞 공간 안의 이름 키다: /repos/{owner}/{repo}/branches/{branch}
            prev = next((sp for _, sp in reversed(ps_[:-1]) if isinstance(sp, str)), None)
            if prev:
                return ("local", "%s/%s" % (prev, ps_[-1][0]))
        # 요청 본문 값(OwnerId 같은 참조 필드)은 결과를 정하지 않는다. 경로와 질의 인자만 본다
        ps = [p for p in op.get("params", []) if isinstance(p.get("space"), str) and p.get("in") != "body"]
        sps = sorted({p["space"] for p in ps if p.get("required")}) or sorted({p["space"] for p in ps})  # I2b: 필수가 없으면 선택 파라미터
        main = [s for s in sps if s not in self.tenant]                # I6: 테넌트는 범위(포함)이지 결정자가 아니다
        if len(main) == 1:
            return ("space", main[0])
        if len(main) > 1:
            return ("combo", tuple(main))
        return ("op", op_id)

    def build(self):
        by_op = collections.defaultdict(list)
        for f in self.slots():
            by_op[(f["op_id"], f["side"])].append(f)
        items = collections.OrderedDict()
        refs = collections.defaultdict(lambda: {"n": 0, "fields": collections.Counter(), "via": collections.Counter()})
        self.by_op, self.slot_item = by_op, {}
        for (op_id, side), fs in sorted(by_op.items()):
            if side == "request":
                continue                                            # 요청 본문은 항목이 아니다. S2 에서 쓰기 근거로 쓴다
            anc = self.anchors(fs, self.root_det(op_id, side))
            paths = {f["path"] for f in fs}
            op = self.ex.ops.get(op_id, {})
            for f in fs:
                if f["name"] in SKIP_NAMES or f["cls"] == "meta" or "response_metadata" in f["path"]:
                    continue
                if f["path"] + "[*]" in paths:
                    continue                                        # 배열 그릇. 원소 자리가 정보를 담는다
                if f["type"] == "object" or (f["type"] == "array" and f["cls"] not in ("ref", "id")):
                    continue                                        # 그릇 자체는 정보가 아니다
                # 가장 가까운 id 있는 조상 (I1, I3)
                path, obj = f["path"], None
                cur = path.rsplit(".", 1)[0]
                while True:
                    if cur in anc:
                        obj = cur
                        break
                    if cur == "$" or "." not in cur:
                        break
                    cur = cur.rsplit(".", 1)[0]
                if obj is not None:
                    det = anc[obj]
                    rel = path[len(obj) + 1:]
                    nested = obj.count(".") > 1 or side in ("payload", "audit")   # 다른 대상 안에 박힌 사본 후보
                else:
                    det = self.root_det(op_id, side)
                    rel = re.sub(r"^\$(\[\*\])?\.?", "", path)   # $[*].state -> state (최상위가 배열인 응답)
                    nested = False
                rel = ".".join("{%s}" % self.ex.space_of_value(x) if self.ex.space_of_value(x) else x
                               for x in rel.replace("[*]", "").split("."))   # 예시 값이 키로 박힌 열린 맵
                src = {"payload": "event", "audit": "audit"}.get(side, "api")
                key = det_key(det) + "|" + rel
                it = items.get(key)
                bt = base_types(f["type"])
                if it is None:
                    it = items[key] = {"det": det_key(det), "rel": rel, "types": collections.Counter(), "cls": f["cls"],
                                       "slots": [], "src": collections.Counter(), "read_by": set(), "write_by": set(),
                                       "space": ("@resolve" if self.ex.plex.get("field_space", {}).get(f["name"]) == "@resolve"
                                                 else f.get("space") if isinstance(f.get("space"), str) else None)}
                it["types"][bt] += 1
                it["slots"].append({"op": op_id, "side": side, "path": path, "nested": nested})
                self.slot_item[(op_id, side, path)] = key
                it["src"][src + ("_copy" if nested and src in ("api", "audit") else "")] += 1
                if side == "response":
                    it["read_by"].update(op.get("scopes", []))
                # 참조 간선 (I5). 자기 id 는 참조가 아니다
                tgt = f.get("space")
                if isinstance(tgt, str) and det[0] == "space" and not (rel.lower() == "id"):
                    e = refs[(det[1], tgt)]
                    e["n"] += 1
                    e["fields"][rel] += 1
                    e["via"][src] += 1
                elif isinstance(tgt, tuple):
                    self.queue.append({"kind": "poly_ref", "op": op_id, "path": path})
        # I8: 부모 공간 경로 아래의 목록 동작이 다른 공간의 레코드를 돌려주면 부모 × 원소 관계다
        #     (/repos/{owner}/{repo}/collaborators -> repo 의 collaborators 항목, 원소 공간 user). 정보 항목은 부모 쪽에 둔다
        for (op_id, side), fs in sorted(by_op.items()):
            op = self.ex.ops.get(op_id, {})
            if side != "response" or op.get("verb_class") != "list" or op.get("surface") != "rest":
                continue
            ps = [sp for _, sp in op.get("path_spaces") or [] if isinstance(sp, str)]
            words = [w for w in (op.get("norm") or []) if not w.startswith("{")]
            if not ps or not words:
                continue
            parent, coll = ps[-1], words[-1]
            anc = self.anchors(fs, ("op", op_id))
            for obj, d in sorted(anc.items()):
                if d[0] != "space" or d[1] == parent or not re.match(r"^\$(\.[^.]+)?\[\*\]$", obj):
                    continue
                key = "space:%s|%s" % (parent, coll)
                it = items.get(key)
                if it is None:
                    it = items[key] = {"det": "space:" + parent, "rel": coll, "types": collections.Counter({("array",): 1}),
                                       "cls": "ref", "slots": [], "src": collections.Counter(), "read_by": set(),
                                       "write_by": set(), "space": d[1]}
                it["slots"].append({"op": op_id, "side": "response", "path": obj, "nested": False})
                it["src"]["api"] += 1
                it["read_by"].update(op.get("scopes", []))
                e = refs[(parent, d[1])]
                e["n"] += 1
                e["fields"][coll] += 1
                e["via"]["api"] += 1
        self.items, self.refs = items, refs
        # S4 충돌: 같은 결정자와 경로에 타입이 둘 이상
        for k, it in items.items():
            ts = [t for t in it["types"] if t]
            if len(ts) > 1:
                self.queue.append({"kind": "type_conflict", "item": k, "types": [list(t) for t in ts]})
            if it["det"].startswith("op:"):
                pass
        self.audit()
        self.writes()
        self.body_writes()
        self.filters()
        self.audit_links()

    # ---------------------------------------------------------------- ④ 감사 로그 사본과 변경
    def audit(self):
        self.audit_entities, self.changes, self.unmatched = {}, collections.defaultdict(list), collections.Counter()
        for e in self.ex.events:
            if e["catalog"] == "audit_entity":
                sp = self.alias.get(e["name"])
                self.audit_entities[e["name"]] = sp
                if not sp:
                    self.queue.append({"kind": "audit_entity_unmatched", "entity": e["name"]})
                    continue
                for fld in e.get("fields", []):
                    key = "space:%s|%s" % (sp, fld)
                    it = self.items.get(key)
                    if it is None:                              # 감사 로그에만 있는 정보
                        it = self.items[key] = {"det": "space:" + sp, "rel": fld, "types": collections.Counter(),
                                                "cls": "other", "slots": [], "src": collections.Counter(),
                                                "read_by": set(), "write_by": set(), "space": None}
                    it["slots"].append({"op": "audit_entity:" + e["name"], "side": "audit", "path": fld, "nested": True})
                    it["src"]["audit_copy"] += 1
            elif e["catalog"] == "audit":
                sp = self.audit_space(e)
                if sp:
                    self.changes[sp].append(e["name"])
                else:
                    self.unmatched[e.get("category")] += 1

    # ---------------------------------------------------------------- ④ 쓰기 짝 (structural)
    def writes(self):
        self.write_edges = []
        for op in self.ex.ops.values():
            if op.get("verb_class") not in ("create", "update", "delete"):
                continue
            sps = [p for p in op.get("params", []) if isinstance(p.get("space"), str)]
            main = sorted({p["space"] for p in sps if p["space"] not in self.tenant})
            if len(main) != 1:
                continue
            S = main[0]
            # 동작 이름공간이 그 공간을 가리킬 때만 짝으로 본다 (bookmarks.add 의 title 은 채널 것이 아니다)
            nts = self.ex.plex.get("namespace_token_space", {})
            fsp = self.ex.plex.get("field_space", {})
            toks = [t for t in re.split(r"[./]", op.get("ns") or "") if t and not t.startswith("{")]
            # 이름공간에서 공간을 가리키는 마지막 토큰이 그 공간이어야 한다
            # (conversations.canvases.create 의 title 은 canvas 것이다. files.remote.update 의 remote 는 공간이 아니라 file 까지 거슬러 간다)
            last = None
            for t in reversed(toks):
                last = nts.get(t) or fsp.get(self.ex.canon(t)) or (self.ex.canon(t) if self.ex.canon(t) in self.ex.spaces else None)
                if last:
                    break
            hit = last == S
            if not hit:
                continue
            for p in op.get("params", []):
                if p.get("in") == "body":
                    continue                              # 요청 본문은 S2(body_writes)가 대상 객체 기준으로 맞춘다
                if p.get("space") is not None or p["name"] in SKIP_NAMES or p["name"] == "id":   # ID 인자는 대상이지 값이 아니다
                    continue
                for rel in (p["name"], p["name"] + ".value"):
                    it = self.items.get("space:%s|%s" % (S, rel))
                    if it:
                        it["write_by"].add(op["op_id"])
                        self.write_edges.append({"op": op["op_id"], "param": p["name"], "item": "space:%s|%s" % (S, rel)})
                        break

    # ---------------------------------------------------------------- ④ S2 쓰기 요청 본문 -> 정보 항목 (structural)
    def body_writes(self):
        """쓰기 동작의 요청 본문 경로가 같은 대상의 응답 경로와 같으면 그 항목을 쓴다.

        대상은 그 동작의 응답 최상위 객체의 결정자다 (POST /repos/{o}/{r}/issues 의 응답은 issue 라 대상은 issue).
        응답 최상위에 id 가 없으면 경로로 정한 결정자(I2c, I2d)를 쓴다. 항목에 없는 본문 경로는 「쓰기만 되는 정보」로 남긴다.
        """
        self.body_edges, self.write_only = [], collections.defaultdict(set)
        for (op_id, side), fs in sorted(self.by_op.items()):
            op = self.ex.ops.get(op_id, {})
            if side != "request" or op.get("verb_class") not in ("create", "update"):
                continue
            resp = self.by_op.get((op_id, "response"), [])
            rd = self.root_det(op_id, "response")
            ranc = self.anchors(resp, rd) if resp else {}
            T = ranc.get("$") or (rd if rd[0] in ("space", "local", "combo") else None)
            if T is None:                                 # 응답이 없으면 요청 본문의 스키마 이름 (Salesforce create: 객체 이름)
                sch = next((f.get("schema") for f in fs if f["path"] == "$" and f.get("schema")), None)
                if sch and self.ex.canon(sch) in self.ex.spaces:
                    T = ("space", self.ex.canon(sch))
            if T is None:
                continue
            paths = {f["path"] for f in fs}
            for f in fs:
                if f["type"] == "object" or f["path"] == "$" or f["path"] + "[*]" in paths:
                    continue
                rel = re.sub(r"^\$(\[\*\])?\.?", "", f["path"]).replace("[*]", "")
                key = det_key(T) + "|" + rel
                it = self.items.get(key)
                top = rel.split(".")[0]
                own = next((ranc[c] for c in ("$.%s[*]" % top, "$." + top) if c in ranc and ranc[c][0] == "space"), None)
                if it is not None and any(sl["side"] == "response" for sl in it["slots"]):
                    it["write_by"].add(op_id)
                    self.body_edges.append({"op": op_id, "path": f["path"], "item": key})
                elif own and own != T:
                    # 응답의 같은 이름 자리가 다른 공간의 객체다: 본문 값은 그 대상을 가리키는 관계 쓰기다 (issues/create 의 assignees -> user)
                    self.body_edges.append({"op": op_id, "path": f["path"], "relation": [det_key(T), top, own[1]]})
                else:
                    self.write_only[key].add(op_id)

    # ---------------------------------------------------------------- ④ 필터: 조회 인자 -> 그 동작 응답의 항목 (structural)
    def filters(self):
        """조회 동작의 인자 이름이 그 동작 응답 필드 이름과 같으면, 그 인자로 그 항목을 골라 물을 수 있다.

        role_ids -> role_assignments[*].role_id, state -> $[*].state. 이름 비교는 그대로, s 뗀 것, _ids -> _id.
        인자가 객체 그릇(assignee, labels)과 맞으면 그 아래 값 필드(common.yaml filter_value_keys)의 항목이다.
        여러 깊이에서 맞으면 가장 얕은 것만 쓴다. 응답을 정하는 인자(I2)와 쪽 나누기, 정렬 인자(filter_skip)는 뺀다.
        인자와 필드의 공간이 둘 다 정해졌는데 다르면 대기열 filter_space_conflict.
        """
        skip = set(self.ex.lex.get("filter_skip", [])) | SKIP_NAMES
        vkeys = set(self.ex.lex.get("filter_value_keys", []))
        self.filter_edges = []
        for op_id, op in sorted(self.ex.ops.items()):
            if op.get("verb_class") not in ("list", "get"):
                continue
            if op.get("surface") == "rest" and op.get("http_method") != "GET":
                continue
            if op.get("surface") == "rpc" and not op.get("verb"):
                continue                                  # 동사를 모르는 메서드(acceptSharedInvite, api.test)는 조회인지 모른다
            resp = self.by_op.get((op_id, "response"), [])
            if not resp:
                continue
            rd = self.root_det(op_id, "response")
            anc = self.anchors(resp, rd)

            def rec_det(path):
                # 경로가 속한 레코드(최상위 배열 원소 또는 응답 자체)의 결정자
                m = re.match(r"^(\$(?:\.[^.\[]+)?(?:\[\*\])?)", path)
                rec = m.group(1) if m and m.group(1) in anc else "$"
                return det_key(anc[rec]) if rec in anc else det_key(rd)
            for p in sorted(op.get("params", []), key=lambda x: x["name"]):
                n = p["name"]
                if p.get("in") in ("path", "header", "body") or n in skip or n == "id":   # id 는 대상 지정이다
                    continue
                psp = p.get("space") if isinstance(p.get("space"), str) else None
                if rd[0] == "space" and psp == rd[1]:
                    continue                              # 응답의 주인을 정하는 인자 (conversations.info 의 channel)
                forms = {n}
                if n.endswith(("_ids", "Ids")) or (n.endswith("s") and len(n) > 3):
                    forms.add(n[:-1])
                hits = [f for f in resp if re.sub(r"\[\*\]", "", f["path"].rsplit(".", 1)[-1]) in forms]
                if not hits:
                    continue
                dmin = min(f["path"].count(".") for f in hits)
                hits = [f for f in hits if f["path"].count(".") == dmin]
                keys = set()
                for f in hits:
                    k = self.slot_item.get((op_id, "response", f["path"]))
                    if k:
                        # 레코드 자신의 항목만 (conversations.list 의 types 는 channels[*].latest.type 메시지 종류가 아니다)
                        if self.items[k]["det"] == rec_det(f["path"]):
                            keys.add((k, f["path"], f.get("space") if isinstance(f.get("space"), str) else None))
                        continue
                    base = f["path"] + ("[*]" if f["type"] == "array" else "")
                    for g in resp:                        # 객체 그릇이면 바로 아래 값 필드
                        if g["path"].startswith(base + ".") and g["path"].count(".") == base.count(".") + 1 and g["name"] in vkeys:
                            k = self.slot_item.get((op_id, "response", g["path"]))
                            if k:
                                keys.add((k, g["path"], None))
                for k, path, fsp in sorted(keys):
                    self.items[k].setdefault("filter_by", set()).add("%s?%s" % (op_id, n))
                    e = {"op": op_id, "param": n, "item": k, "path": path, "param_space": psp, "field_space": fsp}
                    self.filter_edges.append(e)
                    if psp and fsp and psp != fsp:
                        self.queue.append(dict(e, kind="filter_space_conflict"))

    # ---------------------------------------------------------------- ④ 감사 action -> 정보 항목
    def space_of_token(self, t):
        if t in self.ex.spaces:
            return t
        for m in (self.alias, self.ex.plex.get("namespace_token_space", {})):
            if m.get(t) in self.ex.spaces:
                return m[t]
        for v in self.ex.plex.get("action_token_alias", {}).get(t, []):
            if v in self.ex.spaces:
                return v
        return None

    def join_tokens(self, toks):
        """이웃 토큰을 한 대상 이름으로 붙인다. 사전 action_token_join 은 언제나,
        표시 이름 감사(audit_space_from_name)는 붙인 이름이 공간이면 자동으로 (field_scheme -> fieldscheme, 세 개까지)"""
        joins = set(self.ex.plex.get("action_token_join", []))
        auto = self.ex.plex.get("audit_space_from_name")
        out, i = [], 0
        while i < len(toks):
            for n in ((3, 2) if auto else (2,)):
                grp = toks[i:i + n]
                if len(grp) == n and ("_".join(grp) in joins and n == 2 or auto and "".join(grp) in self.ex.spaces):
                    out.append("".join(grp))
                    i += n
                    break
            else:
                out.append(toks[i])
                i += 1
        return out

    def audit_space(self, e):
        """감사 action 의 공간. category 별칭이 먼저다.
        사전 audit_space_from_name 이면(Atlassian: category 가 「User management」처럼 대상이 아니다) 이름의 명사로 정한다:
        to, from, in, on 뒤의 첫 공간 명사(「Added user to group」 -> group), 없으면 뒤에서부터 첫 공간 명사(「Created API token」 -> apitoken)
        """
        S = self.alias.get(e.get("category"))
        if S or not self.ex.plex.get("audit_space_from_name"):
            return S
        stop = set(self.ex.plex.get("action_stop_extra", []))
        toks = self.join_tokens([t for t in re.split(r"[._]", e["name"]) if t and t not in stop])
        preps = [i for i, t in enumerate(toks) if t in ("to", "from", "in", "on")]
        if preps:
            for t in toks[preps[-1] + 1:]:
                sp = self.space_of_token(t)
                if sp:
                    return sp
        for t in reversed(toks):
            sp = self.space_of_token(t)
            if sp:
                return sp
        return None

    def audit_links(self):
        """action 이름 토큰으로 바뀌는 정보 항목을 정한다. 근거는 이름(structural)과 쓰기 동작 짝(chain)뿐이다.

        - 효과는 이름의 첫 동사 토큰으로 정한다 (common.yaml action_effect)
        - relation: 이름에 다른 공간 토큰이 있으면 두 공간 사이의 다중값 참조 항목 (I4 배열)
        - property: 명사 토큰이 경로 토큰에 다 들어가는 항목. 명사가 경로의 그릇 이름과 같으면 그 그릇 전체
        - lifecycle: 상태 항목(deleted, is_archived)과 맞으면 그 항목, 아니면 대상 자체
        - chain: 같은 공간에 쓰는 동작 중 동사 원형이 같은 것. 흔한 동사(set, update ...)는 동작 줄기가 명사와 맞아야 한다
        """
        eff_of = {}
        for eff, words in self.ex.lex.get("action_effect", {}).items():
            for w in words:
                eff_of[w] = eff
        base_of = {w: eff for eff, words in self.ex.lex.get("action_effect_base", {}).items() for w in words}
        lemma = self.ex.lex.get("action_verb_lemma", {})
        stop = set(self.ex.lex.get("action_stop_tokens", [])) | set(self.ex.plex.get("action_stop_extra", []))
        talias = self.ex.plex.get("action_token_alias", {})
        joins = set(self.ex.plex.get("action_token_join", []))
        generic = {"set", "update", "create", "delete", "add", "remove", "edit", "clear"}
        split = lambda x: set(re.split(r"[._]", x)) - {"is", "value", ""}
        by_det = collections.defaultdict(dict)
        for k, it in self.items.items():
            by_det[it["det"]][it["rel"]] = k
        wo_by_det = collections.defaultdict(dict)          # 쓰기만 되는 정보: 결정자 -> 경로 -> 키
        for k in self.write_only:
            d, r = k.split("|", 1)
            wo_by_det[d][r] = k
        self.wo_changed = collections.defaultdict(list)
        # REST 쓰기 동작의 경로 끝 단어 -> 그 동작이 쓰는 항목 (인자 짝, S2 본문, 쓰기만 되는 정보)
        op_targets = collections.defaultdict(set)
        for w in self.write_edges + [b for b in self.body_edges if "item" in b]:
            op_targets[w["op"]].add(w["item"])
        for k, ops_ in self.write_only.items():
            for o in ops_:
                op_targets[o].add(k)
        ops_by_word = collections.defaultdict(list)
        for op_id in sorted(op_targets):
            op = self.ex.ops.get(op_id, {})
            words = [w for w in (op.get("norm") or []) if not w.startswith("{")]
            if op.get("surface") == "rest" and words and (op.get("norm") or [""])[-1] == words[-1]:
                ops_by_word[words[-1].replace("-", "_")].append(op_id)
        pair_generic = set(self.ex.lex.get("change_pair_generic", []))
        writes_by_op = collections.defaultdict(set)
        for w in self.write_edges:
            writes_by_op[w["op"]].add(w["item"])
        self.action_links = []
        # 감사 action 마다 필드 목록이 있으면(GitHub) 절반 이상의 action 에 나오는 필드는 공통 머리글로 보고 뺀다
        acts = [e for e in self.ex.events if e["catalog"] == "audit" and e.get("fields")]
        fc = collections.Counter(f for e in acts for f in e["fields"])
        common = {f for f, c in fc.items() if c * 2 >= len(acts)}
        # category 안에서 30% 이상 action 에 나오는 필드는 그 category 의 맥락 필드다 (repo.* 의 visibility)
        bycat = collections.defaultdict(list)
        for e in acts:
            bycat[e.get("category")].append(e)
        catcommon = {c: {f for f, n in collections.Counter(f for e in es for f in e["fields"]).items() if n * 10 >= len(es) * 3}
                     for c, es in bycat.items() if len(es) >= 4}
        for e in self.ex.events:
            if e["catalog"] != "audit":
                continue
            S = self.audit_space(e)
            if not S:
                continue
            if any(e["name"].startswith(x) for x in self.ex.plex.get("setting_action_prefixes", [])):
                # 조직 설정 변경. 설정 이름은 응답 경로와 대응하지 않아 이름 토큰으로 잇지 않는다
                self.action_links.append({"action": e["name"], "space": S, "verb": None, "effect": "setting", "others": [],
                                          "tokens": [], "kind": "setting", "items": [], "basis": None})
                continue
            toks = [t for t in re.split(r"[._]", e["name"]) if t]
            if "by" in toks[1:]:                          # by 뒤는 행위자다. 바뀐 대상이 아니다
                toks = toks[: toks.index("by", 1)]
            if "from" in toks[1:]:                        # from 뒤가 공간이 아니면 출처 표시다 (from_org_level)
                i = toks.index("from", 1)
                if not any(self.space_of_token(t) for t in toks[i + 1:]):
                    toks = toks[:i]
            toks = self.join_tokens(toks)                 # 이웃 토큰 붙이기 (runner_group -> runnergroup)
            vi = next((i for i, t in enumerate(toks) if t in eff_of), None)
            if vi is None:                                # 활용형 동사가 없으면 원형 동사
                vi = next((i for i, t in enumerate(toks) if t in base_of), None)
            verb = toks[vi] if vi is not None else None
            eff = eff_of.get(verb) or base_of.get(verb, "unknown")
            # category 이름의 토큰은 대상 자신이다 (gpg_key.create 의 gpg, oauth_application.create 의 oauth)
            ctoks = set(re.split(r"[._]", e.get("category") or "")) if "." in e["name"] else set()
            nouns = [t for i, t in enumerate(toks) if i != vi and t not in stop and t not in ctoks]
            # 이 공간 이름에 명사를 붙인 이름이 공간이면 그 하위 공간이다 (personal_access_token.request_created: pat + request -> patrequest)
            nouns = [S + t if self.space_of_token(t) is None and S + t in self.ex.spaces else t for t in nouns]
            others = sorted({self.space_of_token(t) for t in nouns} - {None, S})
            Tn = set()
            for t in nouns:
                if self.space_of_token(t) is None:
                    for x in talias.get(t, [t]):
                        Tn |= split(x)
            Tv = set()
            for x in talias.get(verb, []) if verb else []:
                Tv |= split(x)
            link = {"action": e["name"], "space": S, "verb": verb, "effect": eff, "others": others,
                    "tokens": sorted(Tn | Tv), "kind": None, "items": [], "basis": None}
            mine = by_det.get("space:" + S, {})
            if eff == "relation" and len(others) == 1 and vi is not None and vi == len(toks) - 1 and len(nouns) == 1 \
                    and self.space_of_token(nouns[0]) == others[0]:
                # 「X_removed」는 X 가 이 공간에서 빠진 것이 아니라 X 자체가 없어진 것이다 (org.runner_group_removed -> runnergroup)
                eff = link["effect"] = "lifecycle"
            if self.ex.plex.get("audit_space_from_name") and verb in ("added", "removed") and not others and not Tn and nouns                     and all(self.space_of_token(t) == S for t in nouns):
                # 표시 이름 감사(Atlassian)에서 「Removed domain」은 대상 자체가 없어진 것이다. 상대가 없고 명사가 이 대상뿐일 때만
                eff = link["effect"] = "lifecycle"
            if eff == "access":
                link["kind"] = "access"
            elif eff == "relation" and not others and not Tn and any(d.startswith("combo:") and S in d[6:].split("+") for d in by_det):
                # 관계 동사인데 상대 공간이 이름에 없다: 이 공간이 들어간 ID 조합 (role_assigned -> role × user)
                link["kind"] = "relation"
                combos = sorted(d for d in by_det if d.startswith("combo:") and S in d[6:].split("+"))
                link["group"] = combos[0] + "|*"
                link["items"] = sorted(by_det[combos[0]].values())
                # 조합 레코드를 낸 동작의 이름공간이 이 공간을 가리킬 때만 확정 (admin.roles.listAssignments -> role)
                nts, fsp = self.ex.plex.get("namespace_token_space", {}), self.ex.plex.get("field_space", {})
                own = any(any(nts.get(t) == S or fsp.get(self.ex.canon(t)) == S or self.ex.canon(t) == S
                              for t in re.split(r"[./]", self.ex.ops.get(sl["op"], {}).get("ns") or ""))
                          for k in link["items"] for sl in self.items[k]["slots"])
                link["basis"] = "structural" if len(combos) == 1 and own else "structural_partial"
            elif eff == "relation" and others:
                link["kind"] = "relation"
                sing = lambda w: w[:-1] if w.endswith("s") else w
                # 공간이 아닌 명사가 상대 공간 O 의 배열 항목 이름이면 O 의 그 목록이 바뀐다 (runner_group_runners_added -> runnergroup 의 runners)
                rawn = {sing(t) for t in nouns if self.space_of_token(t) is None}
                sub = sorted(k for O in others for r, k in by_det.get("space:" + O, {}).items()
                             if "." not in r and sing(r) in rawn and any(sl["path"].endswith("[*]") for sl in self.items[k]["slots"]))
                c = []
                for O in others if not sub else []:
                    c += [k for r, k in mine.items() if self.items[k]["space"] == O]
                    c += [k for r, k in by_det.get("space:" + O, {}).items() if self.items[k]["space"] == S]
                multi = [k for k in c if any(sl["path"].endswith("[*]") for sl in self.items[k]["slots"])]
                pool = sorted(set(multi or c))
                if pool:                                  # 가장 얕은 자리 (members 가 prefs.who_can_post.user 보다 먼저)
                    dmin = min(self.items[k]["rel"].count(".") for k in pool)
                    pool = [k for k in pool if self.items[k]["rel"].count(".") == dmin]
                    # 이름 토큰(별칭 포함)이 경로에 들어간 항목이 있으면 그것만 (repo.add_member -> collaborators)
                    mine_side = [k for k in pool if self.items[k]["det"] == "space:" + S]
                    pool = mine_side or pool              # 이 category 의 공간 쪽 항목을 먼저 (team.add_repository -> team 의 repos)
                    spaces_ = set(self.ex.spaces) | {S} | set(others)
                    raw = {t for t in nouns if t not in spaces_} | {x for t in nouns for x in talias.get(t, []) if x not in spaces_}
                    named = [k for k in pool if {sing(w) for w in re.split(r"[._-]", self.items[k]["rel"])} & {sing(w) for w in raw}]
                    pool = named or pool
                link["items"] = pool[:6]
                link["basis"] = ("structural" if multi else "structural_partial") if c else None
                if sub:
                    link["items"], link["basis"] = sub, "structural"
            else:
                link["kind"] = "lifecycle" if eff == "lifecycle" else "property"
                if link["kind"] == "lifecycle":
                    T = Tv                                # 생애 동사는 그 동사가 뒤집는 상태 항목만 본다 (archive -> is_archived)
                else:
                    T = Tn if Tn else Tv                  # 명사가 있으면 명사로, 없을 때만 동사가 가리키는 항목으로
                full = Tn | Tv if link["kind"] == "property" else T
                best, cands = None, []
                for r, k in mine.items():
                    rt = split(r)
                    sc = len(T & rt)
                    if not sc:
                        continue
                    if link["kind"] == "lifecycle" and rt != T:
                        continue                          # 상태 항목은 이름이 정확히 같을 때만 (is_user_deleted 는 deleted 가 아니다)
                    rank = (full <= rt or T <= rt, sc, -r.count("."), -len(r))
                    if best is None or rank > best:
                        best, cands = rank, [k]
                    elif rank == best:
                        cands.append(k)
                if cands:
                    heads = {self.items[k]["rel"].split(".")[0] for k in cands}
                    if len(Tn) == 1 and heads == Tn and all("." in self.items[k]["rel"] for k in cands):
                        head = next(iter(Tn))             # 명사가 그릇 이름이다: 그릇 아래 전부
                        cands = sorted(k for r, k in mine.items() if r.startswith(head + "."))
                        link["group"] = "space:%s|%s.*" % (S, head)
                    link["items"] = sorted(cands)[:3] if "group" not in link else cands
                    link["basis"] = "structural" if best[0] else "structural_partial"
                lm = lemma.get(verb)
                if lm and link["kind"] == "property":     # 쓰기 동작 짝
                    for op_id, its in sorted(writes_by_op.items()):
                        op = self.ex.ops.get(op_id, {})
                        stem = op.get("stem") or ""
                        if op.get("verb") != lm or not any(i.startswith("space:%s|" % S) for i in its):
                            continue
                        if (lm in generic or stem) and not (stem and stem in "".join(sorted(Tn))):
                            continue
                        new = sorted(i for i in its if i.startswith("space:%s|" % S) and i not in link["items"])
                        if new:
                            link["items"] += new
                            link["basis"] = (link["basis"] + "+chain") if link["basis"] else "chain"
            # 감사 필드 (문서가 action 마다 필드 이름을 준다. GitHub)
            # 1) 변경 전후 짝: previous_X, old_X, new_X, X_was 가 있으면 X 가 바뀐 항목이다 (repo.access: previous_visibility)
            # 2) 고유 필드: 전체 공통 머리글과 category 맥락 필드를 뺀 필드 이름이 항목 경로와 같다
            flds = e.get("fields") or []
            changed = set()
            for f in flds:
                m = re.match(r"^(?:previous|old|new)_(.+)$", f) or re.match(r"^(.+)_(?:was|were)$", f)
                if m and m.group(1) not in pair_generic:   # old_value, new_value 는 무엇의 값인지 말하지 않는다
                    changed.add(m.group(1))
            own = [f for f in flds if f not in common and f not in catcommon.get(e.get("category"), set())]
            hit_c = sorted({k for f in changed for r, k in mine.items() if r == f})
            hit_o = sorted({k for f in own for r, k in mine.items() if r == f})
            if link["kind"] in ("property", "relation") and hit_c:
                link["items"], link["basis"], link["fields_hit"] = hit_c, "fields_change", hit_c
            elif link["kind"] in ("property", "relation") and hit_o:
                link["fields_hit"] = hit_o
                if link["basis"] in ("structural", "chain") or (link["basis"] or "").startswith("structural+"):
                    link["basis"] += "+fields"
                else:
                    link["items"], link["basis"] = hit_o, "fields"
            elif hit_c or hit_o:
                link["fields_hit"] = hit_c or hit_o           # 생성과 삭제: 초기값 필드는 참고로만 남긴다
            # 쓰기만 되는 정보 (S2 에서 응답 항목이 없던 본문 경로). 감사 로그가 그 값의 유일한 관측 근거다
            #   1) 변경 전후 짝이 쓰기만 되는 정보와 맞으면 이름 일치보다 앞선다 (repo.update_member: old_permission -> permission)
            #   2) 응답 항목에서 아무것도 못 찾았을 때만 고유 필드, 이름 토큰(전부 들어감)으로 찾는다
            # 쓰기 동작 이름 일치: action 이름(category 뒤)이 REST 쓰기 동작의 경로 끝 단어와 같으면 그 동작이 쓰는 이 공간 항목이다
            #   (pull_request.merge -> PUT /repos/{o}/{r}/pulls/{pull_number}/merge 의 본문). 이름 토큰이 든 항목이 있으면 그것만
            #   감사 필드 근거(fields_change, fields)보다는 약하고 이름 토큰 일치보다는 강하다 (repo.transfer 는 감사 필드 owner 가 맞다)
            short = e["name"].split(".", 1)[1] if "." in e["name"] else None
            if short and link["kind"] == "property" and "fields" not in (link["basis"] or "") and short in ops_by_word:
                tg = sorted({k for o in ops_by_word[short] for k in op_targets[o] if k.startswith("space:%s|" % S)})
                if tg:
                    at = set(re.split(r"[._]", short))
                    named = [k for k in tg if at & split(k.split("|", 1)[1])]
                    link["items"], link["basis"] = (named or tg)[:6], "op_name"
                    link["op_match"] = ops_by_word[short]
                    if all(k in self.write_only for k in link["items"]):
                        link["write_only"] = True
            wo = wo_by_det.get("space:" + S, {})
            if wo and link["kind"] in ("property", "relation") and link["basis"] not in ("fields_change", "op_name"):
                w_c = sorted({k for f in changed for r, k in wo.items() if r == f})
                w_o = sorted({k for f in own for r, k in wo.items() if r == f})
                w_n = []
                if link["kind"] == "property" and Tn:
                    w_n = sorted(k for r, k in wo.items() if Tn <= split(r))
                    dmin = min((k.count(".") for k in w_n), default=0)
                    w_n = [k for k in w_n if k.count(".") == dmin][:3]
                if w_c:
                    link["items"], link["basis"], link["fields_hit"] = w_c, "fields_change", w_c
                elif not link["items"] and w_o:
                    link["items"], link["basis"], link["fields_hit"] = w_o, "fields", w_o
                elif not link["items"] and w_n:
                    link["items"], link["basis"] = w_n, "structural"
                else:
                    w_c = w_o = w_n = []
                if w_c or w_o or w_n:
                    link["write_only"] = True
            if link["kind"] == "property" and not link["items"] and verb and not nouns and base_of.get(verb) == "change":
                # 이름이 동사 하나뿐(external_identity.update): 이 대상이 바뀌었지만 어느 속성인지 이름과 필드가 말하지 않는다
                link["basis"], link["target_space"] = "object_update", S
            if link["kind"] == "lifecycle" and not link["items"]:
                # 명사가 없으면 그 공간의 대상 자체, 명사가 있는데 지도에 없으면 API에 없는 하위 대상
                # 명사가 그 공간의 항목에 이미 있으면 대상의 종류 표시다 (public_channel_deleted 의 public)
                known = set().union(*[split(r) for r in mine]) if mine else set()
                head = self.space_of_token(nouns[-1]) if nouns else None
                if head and head != S:
                    # 머리 명사(마지막 명사)가 다른 공간이면 그 공간의 대상이 생기거나 없어진다
                    # (org.create_actions_secret -> secret. channel_audit_export_deleted 의 머리는 export 라 해당 없음)
                    link["basis"], link["target_space"] = "object", head
                else:
                    link["basis"] = "object" if Tn <= known else "unmapped"
            for k in link["items"]:
                if k not in self.items:                   # 쓰기만 되는 정보
                    self.wo_changed[k].append(e["name"])
                else:
                    self.items[k].setdefault("changed_by", []).append(e["name"])
            self.action_links.append(link)

    # ---------------------------------------------------------------- 출력
    def dump(self):
        seen, q = set(), []                                 # anchors() 를 여러 번 불러 같은 대기열 항목이 겹친다
        for x in self.queue:
            k = json.dumps(x, sort_keys=True, ensure_ascii=False)
            if k not in seen:
                seen.add(k)
                q.append(x)
        self.queue = q
        spaces = collections.defaultdict(lambda: {"items": 0, "slots": 0, "src": collections.Counter()})
        out_items = []
        for k, it in self.items.items():
            d = it["det"]
            spaces[d]["items"] += 1
            spaces[d]["slots"] += len(it["slots"])
            spaces[d]["src"].update(it["src"])
            out_items.append({
                "key": k, "det": d, "rel": it["rel"], "cls": it["cls"], "ref_space": it["space"],
                "types": sorted({"/".join(t) or "?" for t in it["types"]}),
                "src": dict(it["src"]), "n_slots": len(it["slots"]),
                "slots": sorted({(s["op"], s["side"], s["path"]) for s in it["slots"]})[:40],
                "read_by": sorted(it["read_by"]), "write_by": sorted(it["write_by"]),
                "changed_by": sorted(it.get("changed_by", [])),
                "filter_by": sorted(it.get("filter_by", [])),
            })
        ref_list = [{"from": a, "to": b, "n": e["n"], "fields": e["fields"].most_common(8), "via": dict(e["via"])}
                    for (a, b), e in sorted(self.refs.items())]
        data = {
            "provider": self.p,
            "rules": "info_map v0: I1-I8, S4, S2 body write, filter, copy, change(audit category), read_by, write pair(structural)",
            "totals": {"slots": sum(len(it["slots"]) for it in self.items.values()), "items": len(self.items),
                       "determinants": len(spaces), "ref_edges": len(ref_list), "write_edges": len(self.write_edges),
                       "body_write_edges": sum(1 for e in self.body_edges if "item" in e),
                       "body_relation_edges": sum(1 for e in self.body_edges if "relation" in e), "write_only": len(self.write_only),
                       "filter_edges": len(self.filter_edges),
                       "audit_actions_matched": sum(len(v) for v in self.changes.values()),
                       "audit_actions_unmatched": sum(self.unmatched.values()), "queue": len(self.queue),
                       "action_kinds": dict(collections.Counter(l["kind"] for l in self.action_links)),
                       "action_linked": dict(collections.Counter((l["basis"] or "none").split("+")[0] for l in self.action_links if l["kind"] != "access"))},
            "determinants": {d: {"items": v["items"], "slots": v["slots"], "src": dict(v["src"])} for d, v in sorted(spaces.items())},
            "items": out_items,
            "refs": ref_list,
            "filter_edges": self.filter_edges,
            "body_write_edges": self.body_edges,
            "write_only": {k: {"write_by": sorted(v), "changed_by": sorted(self.wo_changed.get(k, []))}
                           for k, v in sorted(self.write_only.items())},
            "changes": {k: sorted(v) for k, v in sorted(self.changes.items())},
            "action_links": sorted(self.action_links, key=lambda x: (x["space"], x["action"])),
            "audit_unmatched": dict(self.unmatched.most_common()),
            "space_notes": self.ex.plex.get("space_notes", {}),
            "queue_by_kind": dict(collections.Counter(q["kind"] for q in self.queue)),
            "queue_sample": self.queue[:200],
        }
        path = os.path.join(HERE, "out", self.p, "info_map.json")
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        return data, path


if __name__ == "__main__":
    m = InfoMap(sys.argv[1] if len(sys.argv) > 1 else "slack")
    m.build()
    data, path = m.dump()
    print(json.dumps(data["totals"], ensure_ascii=False))
    print(json.dumps(data["queue_by_kind"], ensure_ascii=False))
    print(path)
    tpl = io.open(os.path.join(HERE, "info_map_view.html"), encoding="utf-8").read()
    tpl = tpl.replace("/*TITLE*/", {"slack": "Slack", "github": "GitHub", "jira": "Jira", "confluence": "Confluence", "atlassian": "Atlassian 조직", "salesforce": "Salesforce", "okta": "Okta", "gws": "Google Workspace"}.get(m.p, m.p))
    html = tpl.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, sort_keys=True).replace("</", "<\\/"))
    hp = os.path.join(HERE, "out", m.p, "info_map.html")
    with io.open(hp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    print(hp)
