# -*- coding: utf-8 -*-
"""Information Map (사전 없음, 2026-10-15). 설계: Information Map 설계.md

    python map3.py <provider>      # out2/<provider>/ir -> out2/<provider>/map/

단계
A 공간: 꼭짓점은 경로 위치(pos:)와 모양(sh:). 간선은 단건 왕복, 목록 왕복, 원문 판별자 하위 유형, 원문 바인딩, 원문 ID 형식,
  같은 모양(구조 지문). 약한 간선(대안이 서로 다를 수 있는 union)은 각자 단건 위치를 가진 두 동치류를 합치지 않는다.
B ID와 속성: 원문 키 선언, 원문 참조, 원문 ID 형식, 실측 왕복(경로 값 = 응답 필드 값), 실측 공출현, URL 값이 경로 틀에 맞음.
C 대상: 위 근거가 가리키는 공간. 없으면 「대상 모름」.
D 매핑: 공간 모양의 값 자리 -> 그 공간. 공간 없는 모양은 (1) 서로 다른 공간 둘 이상을 가리키면 relation, (2) 경로 맥락
  (그 응답을 고른 경로 끝 위치의 공간), (3) 아니면 고아.
이름은 판정에 쓰지 않는다. 이름 같음을 쓰는 규칙(같은 모양 지문, URL 경로 틀 글자 조각)은 verify 에 남겨 다른 근거와 대조한다.
"""
import collections
import io
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
FP_MIN = 6                                   # 같은 모양 지문: 속성 수 하한 (우연한 일치를 줄인다)
MAX_FOLD = 4                                 # 공간 없는 박힌 객체를 펼치는 깊이


def load(p, kind):
    f = os.path.join(HERE, "out2", p, "ir", kind + ".jsonl")
    return [json.loads(l) for l in io.open(f, encoding="utf-8")] if os.path.exists(f) else []


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if rb < ra:
                ra, rb = rb, ra
            self.p[rb] = ra


def segs(t):
    return [s for s in t.strip("/").split("/") if s != ""]


def pos_of(template, upto):
    """경로 틀에서 upto 번째 조각까지, 파라미터는 {} 로"""
    out = []
    for s in segs(template)[:upto + 1]:
        out.append("{}" if s.startswith("{") else s)
    return "/".join(out)


def decode_node_id(v):
    """GitHub 옛 형식 global node id: base64("<길이>:<타입 이름><번호>") -> 타입 이름. 아니면 None"""
    import base64
    try:
        d = base64.b64decode(v + "=" * (-len(v) % 4), validate=True).decode("ascii")
    except Exception:
        return None
    m = re.match(r"^(\d+):", d)
    if not m:
        return None
    n = int(m.group(1))
    t = d[m.end():m.end() + n]
    return t if len(t) == n and t.isalpha() else None


# aegi-schema Interface_Spec_v3 「항상 감추는 값」 (2026-10-18 R2a). 이름 규칙이라 값 규칙과 대조한다.
# 개인키 자재의 n, e, x5c 는 공개키 부분이 섞여 있어(JWK) 넣지 않았다. 웹훅은 원문 예시에 /services/ 가 빠진 것이 있어 호스트로 본다
MATERIAL_NAMES = {"client_secret", "signing_secret", "verification_token", "refresh_token", "access_token", "bot_access_token",
                  "app_token", "api_token", "sharedSecret", "privateKeyData"}
MATERIAL_VALUE = re.compile(r"^xox[a-z]?[-.]|^xoxe\.|^xapp-|//hooks\.slack\.com/")
TOKEN_PREFIX = re.compile(r"^(xoxe\.xox[a-z]|xox[a-z]?|xapp)[-.]")


def is_sentinel_value(v):
    """하이픈('-')을 뺀 뒤 비어 있지 않고 모든 문자가 '0' 인 센티넬 값(예: 00000000-0000-0000-0000-000000000000)."""
    if not isinstance(v, str):
        return False
    s = v.replace("-", "")
    return bool(s) and all(c == "0" for c in s)


class Map3:
    def __init__(self, p):
        self.p = p
        self.shapes = {s["id"]: s for s in load(p, "shape")}
        self.ops = {o["id"]: o for o in load(p, "operation")}
        self.keys = load(p, "key_decl")
        self.refs_decl = load(p, "ref_decl")
        self.idfs = load(p, "id_format")
        self.binds = load(p, "binding")
        self.cats = load(p, "catalog")
        self.insts = load(p, "instance")
        self.grants = load(p, "grant")
        # Jev 판정(근거 등급 model, 2026-10-18): 「자기 식별자를 가진 대상 레코드」와 그 식별자 필드. 기준 미만은 쓰지 않는다
        jp = os.path.join(HERE, "out2", p, "map", "jev_records.json")
        self.model_keys = []
        self.model_relations = {}                          # 모양 -> 다른 대상을 가리키는 부분 필드 (Jev, 루프 19)
        if os.path.exists(jp):
            for r in json.load(io.open(jp, encoding="utf-8")):
                parts = sorted(f for f, v in (r.get("parts") or {}).items() if (v or 0) >= 0.7 and f != r.get("key"))
                entity = (r.get("is_entity") or 0) >= 0.7 and r.get("key") not in (None, "none") and (r.get("key_p") or 0) >= 0.6
                if not entity and len(parts) >= 2:
                    self.model_relations[r["shape"]] = parts
                if entity:
                    self.model_keys.append({"shape": r["shape"], "props": [r["key"]], "grade": "model",
                                            "evidence": "Jev %s: 대상 %.2f, 식별자 %s %.2f" % (r.get("model"), r["is_entity"],
                                                                                          r["key"], r["key_p"])})
        self.uf = UF()
        self.edges, self.issues = [], []
        self.hset = collections.defaultdict(set)          # 동치류 -> 단건 위치
        self.verify = collections.defaultdict(lambda: collections.Counter())
        self.source_facts = self.load_source_facts()
        self.source_projections = []
        self.applied_source_refs = []

    def load_source_facts(self):
        """출처 스냅샷에 고정된 명시적 참조의 전사. 제공자 이름에 따른 추론 규칙은 없다."""
        path = os.path.join(HERE, "source_reference_facts.json")
        if not os.path.exists(path):
            return {"references": [], "distinct_entities": []}
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        with io.open(os.path.join(HERE, "collect", "registry.json"), encoding="utf-8") as f:
            registry = {s["id"]: s for s in json.load(f)["sources"]}
        out = {}
        for kind in ("references", "distinct_entities", "same_entities", "promotion_rules"):
            out[kind] = []
            for r in data.get(kind) or []:
                if r["provider"] != self.p:
                    continue
                for src in [r["evidence"]["source"], *r["evidence"].get("corroborating_sources", [])]:
                    if (data.get("sources", {}).get(src, {}).get("sha256") != registry.get(src, {}).get("sha256")
                            or not r["evidence"].get("locator")):
                        raise ValueError("원문 참조 전사의 출처 스냅샷이 다르다: " + src)
                out[kind].append(r)
        return out

    def path_slots(self, sid, path):
        current = {sid}
        parts = path.replace("[*]", "").replace("[]", "").split(".")
        for i, name in enumerate(parts):
            slots = {(obj, name) for s in sorted(current) for obj in self.obj(s)
                     if any(pr["name"] == name for pr in self.shapes[obj].get("props") or [])}
            if i == len(parts) - 1:
                return sorted(slots)
            current = {pr["shape"] for obj, prop in slots for pr in self.shapes[obj].get("props") or []
                       if pr["name"] == prop and pr.get("shape")}
        return []

    def apply_source_refs(self):
        self.source_projections, self.applied_source_refs = [], []
        grouped = collections.defaultdict(list)
        for r in self.source_facts["references"]:
            target = self.shape_space.get(r["target_shape"])
            if not target:
                raise ValueError("원문 참조 대상 공간이 없다: " + r["target_shape"])
            roots = {r["shape"]}
            if r.get("include_allof"):
                while True:
                    expanded = roots | {sid for sid, s in self.shapes.items()
                                        if roots & set((s.get("ext") or {}).get("allOf") or [])}
                    if expanded == roots:
                        break
                    roots = expanded
            for root in sorted(roots):
                slots = self.path_slots(root, r["path"])
                if not slots:
                    raise ValueError("원문 참조 자리가 없다: %s.%s" % (root, r["path"]))
                applied = dict(r, shape=root, target=target, slots=slots)
                self.applied_source_refs.append(applied)
                if r.get("project"):
                    self.source_projections.append(applied)
                else:
                    for slot in slots:
                        grouped[tuple(slot)].append(applied)
        for slot, rules in sorted(grouped.items()):
            old = self.id_role.get(slot)
            if old and old["role"] == "self_key":
                raise ValueError("원문 참조가 자기 키와 충돌한다: %s" % (slot,))
            targets = sorted({r["target"] for r in rules})
            cases = [{"when": r["when"], "target": r["target"],
                      **({"key_kind": r["key_kind"]} if r.get("key_kind") else {})} for r in rules if r.get("when")]
            self.id_role[slot] = {"role": "ref", "target": targets[0] if len(targets) == 1 else targets,
                                  "grade": "stated", "poly": bool(cases) or len(targets) > 1,
                                  "cases": cases, "allow_self_reference": not cases,
                                  "source_evidence": [dict(source=r["evidence"]["source"], locator=r["evidence"]["locator"])
                                                      for r in rules],
                                  "why": "원문 명시 참조: " + "; ".join(sorted({r["evidence"]["locator"] for r in rules}))}
            self.verify["source_references"]["slots"] += 1

    def reference_values(self, shape, path, record):
        """실제 레코드의 판별값으로 대상을 고른다. 알 수 없는 종류와 다른 배열 원소의 조건은 적용하지 않는다."""
        def values(value, tokens, prefix="", frames=None):
            frames = {"": record} if frames is None else frames
            if not tokens:
                yield value, frames
                return
            part, *rest = tokens
            name = part.replace("[*]", "")
            if not isinstance(value, dict) or name not in value:
                return
            full = prefix + part
            if part.endswith("[*]"):
                if isinstance(value[name], list):
                    for item in value[name]:
                        yield from values(item, rest, full + ".", dict(frames, **{full: item}))
            else:
                yield from values(value[name], rest, full + ".", frames)
        out = []
        for r in self.applied_source_refs:
            if r["shape"] != shape or r["path"] != path:
                continue
            for value, frames in values(record, path.split(".")):
                guard = r.get("when")
                if guard:
                    gp = guard["path"]
                    scope = gp[:gp.rfind("[*]") + 3] if "[*]" in gp else ""
                    tail = gp[len(scope):].lstrip(".")
                    if not any(v == guard["equals"] for v, _ in values(frames.get(scope), tail.split("."))):
                        continue
                for leaf in value if isinstance(value, list) else [value]:
                    if isinstance(leaf, (str, int)) and not isinstance(leaf, bool):
                        out.append((str(leaf), r["target"]))
        return sorted(set(out))

    def source_distinct_pairs(self):
        out = []
        for r in self.source_facts["distinct_entities"]:
            source, target = self.shape_space.get(r["shape"]), self.shape_space.get(r["target_shape"])
            if not source or not target:
                raise ValueError("원문 다름 근거의 공간이 없다")
            names = {source} | {s["name"] for s in self.space.values() if s.get("promoted_from") == source}
            out.extend((name, target, r["evidence"]) for name in sorted(names) if name != target)
        return out

    def source_same_pairs(self):
        out = []
        for row in self.source_facts.get("same_entities", []):
            a, b = self.shape_space.get(row["shape"]), self.shape_space.get(row["target_shape"])
            if not a or not b:
                raise ValueError("원문 같음 근거의 공간이 없다")
            if a != b:
                out.append((a, b, row["evidence"]))
        return out

    # ------------------------------------------------------------------ 공통
    def issue(self, kind, subject, needs_stage, fact, detail, evidence=None):
        self.issues.append({"stage": "map", "kind": kind, "subject": subject,
                            "needs": {"stage": needs_stage, "fact": fact, "detail": detail}, "evidence": evidence or {}})

    def obj(self, sid, depth=0):
        """모양 id -> 객체 모양 목록 (배열 원소, union 대안을 따라간다)"""
        s = self.shapes.get(sid)
        if not s or depth > 6:
            return []
        if s["kind"] == "object":
            return [sid]
        if s["kind"] == "array":
            it = (s.get("items") or {}).get("shape")
            return self.obj(it, depth + 1) if it else []
        if s["kind"] == "union":
            return [x for a in s.get("alts") or [] for x in self.obj(a, depth + 1)]
        return []

    def fp_kind(self, sid):
        """지문의 속성 종류. 배열은 원소 모양까지 넣는다 (2026-10-18 D7: 원소만 다른 Jira PageBean 64개가 지문으로 합쳐졌다)"""
        sh = self.shapes.get(sid) or {}
        if sh.get("kind") == "array":
            return "array:" + str((sh.get("items") or {}).get("shape") or (sh.get("items") or {}).get("scalar"))
        return sh.get("kind", "?")

    def element(self, sid):
        """목록 응답의 원소 객체 모양: 배열이면 원소, 객체 원소 배열 속성이 하나뿐인 객체면 그 원소"""
        s = self.shapes.get(sid)
        if not s:
            return []
        if s["kind"] == "array":
            return self.obj(sid)
        if s["kind"] == "object":
            arr = [pr for pr in s.get("props") or [] if pr.get("shape") and (self.shapes.get(pr["shape"]) or {}).get("kind") == "array"]
            if len(arr) == 1:
                return self.obj(arr[0]["shape"])
        return []

    def resp(self, o):
        for r in o.get("responses") or []:
            if str(r.get("status", "")).startswith("2") and r.get("shape"):
                return r["shape"]
        return None

    def discriminator_subtypes(self, sid):
        """상속된 판별자 표로 형제를 재탐색하지 않고, 원문 allOf의 직접 하위 모양만 고른다."""
        s = self.shapes.get(sid) or {}
        return sorted(sub for sub in set(((s.get("discriminator") or {}).get("map") or {}).values())
                      if sub != sid and sid in (((self.shapes.get(sub) or {}).get("ext") or {}).get("allOf") or []))

    # ------------------------------------------------------------------ A. 공간
    def edge(self, a, b, grade, why, weak=False):
        self.edges.append({"a": a, "b": b, "grade": grade, "why": why, "weak": weak})

    def build_edges(self):
        self.item_pos = {}                                 # 단건 위치 -> read_one 동작들
        lists = {}                                         # 목록 경로 틀 -> 원소 모양들 (동작 여럿 합)
        positions = set()
        for o in self.ops.values():
            if o.get("path"):
                for x in o["path"]["positions"]:
                    positions.add(pos_of(o["path"]["template"], x["index"]))
        self.positions = positions
        # 원문 enum 이 붙은 경로 파라미터는 종류를 고르는 값이다. 그 위치로 끝나는 동작은 대상을 고르지 않는다 (루프 9)
        self.enum_pos = set()
        for o in self.ops.values():
            if o.get("path"):
                en = {p["name"] for p in o.get("params") or [] if p.get("in") == "path" and p.get("enum")}
                for x in o["path"]["positions"]:
                    if x["param"] in en:
                        self.enum_pos.add(pos_of(o["path"]["template"], x["index"]))
        self.verify["enum_positions"]["excluded"] = len(self.enum_pos)
        # 하나를 고르는 위치: 어떤 동작의 경로 끝 위치 (GET 이 없어도 PUT, DELETE 가 고르는 대상)
        self.addressable = set()
        for o in self.ops.values():
            if o.get("path") and o["path"]["positions"]:
                t = o["path"]["template"]
                if segs(t)[-1].startswith("{") and pos_of(t, len(segs(t)) - 1) not in self.enum_pos:
                    self.addressable.add(pos_of(t, len(segs(t)) - 1))
        # 생성, 수정 왕복 (루프 9): 수정(PUT, PATCH)이 고른 위치의 응답 객체, 생성(POST 컬렉션)이 돌려준 객체 -> 그 위치.
        # 응답이 작업 상태 같은 다른 것일 수 있어 약한 간선
        for oid, o in sorted(self.ops.items()):
            if not o.get("path") or o.get("method") not in ("PUT", "PATCH", "POST"):
                continue
            t, r = o["path"]["template"], self.resp(o)
            if not r or (self.shapes.get(r) or {}).get("kind") != "object":
                continue
            ss = segs(t)
            if o["method"] in ("PUT", "PATCH") and ss and ss[-1].startswith("{") and pos_of(t, len(ss) - 1) not in self.enum_pos:
                self.edge("pos:" + pos_of(t, len(ss) - 1), "sh:" + r, "transform", "수정 왕복 %s /%s" % (o["method"], t), weak=True)
            elif o["method"] == "POST" and ss and not ss[-1].startswith("{"):
                P = pos_of(t + "/{x}", len(ss))
                if P in self.addressable:
                    self.edge("pos:" + P, "sh:" + r, "transform", "생성 왕복 POST /%s" % t, weak=True)
        writes_by_tmpl = collections.defaultdict(set)
        for o in self.ops.values():
            if o.get("path") and o.get("method") in ("PUT", "PATCH", "POST", "DELETE"):
                writes_by_tmpl[o["path"]["template"]].add(o["method"])
        # 단건 위치로 돌려받는 모양 (뿌리 단일 자원 판정용, D1)
        pos_resp = set()
        for o in self.ops.values():
            ss_ = segs(o["path"]["template"]) if o.get("path") else []
            if o.get("method") == "GET" and o["kind"] == "read_one" and ss_ and ss_[-1].startswith("{") and self.resp(o):
                pos_resp |= set(self.obj(self.resp(o))) | {self.resp(o)}
        for oid, o in sorted(self.ops.items()):
            # 루프 17: 위치가 있는 경로도 (부모 아래 단일 하위 자원: GitHub branches/{b}/protection, pages)
            if (o.get("path") and o.get("method") == "GET" and o["kind"] == "read_one"
                    and segs(o["path"]["template"]) and not segs(o["path"]["template"])[-1].startswith("{")
                    and not any(p.get("in") == "query" and not p.get("enum") for p in o.get("params") or [])
                    # 쓰기 동작이 있거나, 뿌리 경로이고 단건 위치로 돌려받는 모양이 아닐 때 (2026-10-18 D1: Jira serverInfo,
                    # Okta SSF stream 은 GET 뿐이라 빠졌다. 부모가 없어 속성으로도 붙지 못한다. /myself 처럼 다른 대상의 보기는 제외)
                    and ((writes_by_tmpl.get(o["path"]["template"]) or set()) - {"DELETE"}
                         or (not o["path"]["positions"] and not ({self.resp(o)} | set(self.obj(self.resp(o) or ""))) & pos_resp))
                    and self.resp(o)
                    # 부모 아래 단일 자원은 만들거나 지울 수 있을 때만 대상이다 (POST, DELETE). GET, PUT 뿐이면 늘 있는 설정이라
                    # 부모 공간의 속성이다 (경로 맥락으로 붙는다)
                    and (not o["path"]["positions"] or writes_by_tmpl[o["path"]["template"]] & {"POST", "DELETE"})
                    and (self.shapes.get(self.resp(o)) or {}).get("kind") == "object"):
                P = "!" + "/".join("{}" if x.startswith("{") else x for x in segs(o["path"]["template"]))   # 단일 자원 위치
                self.item_pos.setdefault(P, []).append(oid)
                self.positions.add(P)
                self.edge("pos:" + P, "sh:" + self.resp(o), "transform", "단일 자원 GET, %s /%s" % (
                    "+".join(sorted(writes_by_tmpl[o["path"]["template"]])), o["path"]["template"]), weak=True)
                self.verify["singleton_positions"]["ops"] += 1
        for oid, o in sorted(self.ops.items()):
            if not o.get("path") or o.get("method") not in ("GET", None):
                continue
            t = o["path"]["template"]
            r = self.resp(o)
            if not r:
                continue
            ss = segs(t)
            if o["kind"] == "read_one" and ss and ss[-1].startswith("{") and pos_of(t, len(ss) - 1) not in self.enum_pos:
                P = pos_of(t, len(ss) - 1)
                self.item_pos.setdefault(P, []).append(oid)
                rs = self.shapes.get(r) or {}
                alts = self.obj(r)
                weak = rs.get("kind") == "union" and not rs.get("discriminator")
                for a in alts:
                    self.edge("pos:" + P, "sh:" + a, "transform", "단건 왕복 GET /%s" % t, weak=weak or len(alts) > 1)
            elif (o["kind"] == "read_one" and ss and not ss[-1].startswith("{")
                  and (self.shapes.get(r) or {}).get("kind") == "object"
                  and len([p for p in o.get("params") or [] if p.get("in") == "query" and p.get("required") and not p.get("enum")]) == 1):
                # 질의 위치 (루프 13): 필수 질의 인자 하나로 객체 하나를 돌려주는 GET (Jira GET /user?accountId=)
                q = next(p["name"] for p in o["params"] if p.get("in") == "query" and p.get("required") and not p.get("enum"))
                P = pos_of(t, len(ss) - 1) + "?" + q
                self.item_pos.setdefault(P, []).append(oid)
                self.positions.add(P)
                for a in self.obj(r):
                    self.edge("pos:" + P, "sh:" + a, "transform", "질의 왕복 GET /%s?%s" % (t, q))
                self.verify["query_positions"]["ops"] += 1
            elif o["kind"] == "read_one" and ss and not ss[-1].startswith("{") and self.obj(r):
                # 선택 질의 인자로 고르는 자원 (2026-10-18, 1단계 누락 Okta GET /ssf/stream?stream_id=): 질의 인자가 하나이고,
                # 같은 경로의 DELETE 가 같은 이름의 질의 인자로 지울 대상을 고르면 그 인자가 위치다
                qs = [p for p in o.get("params") or [] if p.get("in") == "query" and not p.get("enum")]
                dq = {p["name"] for d in self.ops.values() if d.get("method") == "DELETE" and d.get("path")
                      and d["path"]["template"] == t for p in d.get("params") or [] if p.get("in") == "query"}
                if len(qs) == 1 and qs[0]["name"] in dq:
                    P = pos_of(t, len(ss) - 1) + "?" + qs[0]["name"]
                    self.item_pos.setdefault(P, []).append(oid)
                    self.positions.add(P)
                    alts = self.obj(r)
                    for a in alts:
                        self.edge("pos:" + P, "sh:" + a, "transform", "질의 왕복 GET, DELETE /%s?%s" % (t, qs[0]["name"]),
                                  weak=len(alts) > 1)
                    self.verify["query_positions"]["optional_with_delete"] += 1
            elif o["kind"] == "read_many" and ss and not ss[-1].startswith("{"):
                P = pos_of(t + "/{x}", len(ss))
                if P not in positions:
                    continue
                els = self.element(r)
                lists.setdefault(t, set()).update(els)
                for a in els:
                    self.edge("pos:" + P, "sh:" + a, "transform", "목록 왕복 GET /%s" % t, weak=len(els) > 1)
        for e in self.edges:
            if e["why"].startswith("목록 왕복 GET /"):
                t = e["why"][len("목록 왕복 GET /"):]
                if len(lists.get(t, ())) > 1:
                    e["weak"] = True
                    e["why"] += " (같은 경로가 원소 모양 %d개를 돌려준다)" % len(lists[t])
        # 원문 allOf 구성 (루프 9): 이름 있는 객체 모양을 감싼 모양은 같은 대상. 여러 모양이 함께 쓰는 공통 기반(3개 이상)은 빼고, 약한 간선
        base_use = collections.Counter()
        for s_ in self.shapes.values():
            for c in (s_.get("ext") or {}).get("allOf") or []:
                base_use[c] += 1
        for s_ in sorted(self.shapes.values(), key=lambda x: x["id"]):
            if s_["kind"] != "object":
                continue
            for c in (s_.get("ext") or {}).get("allOf") or []:
                if (self.shapes.get(c) or {}).get("kind") == "object" and base_use[c] <= 2:
                    self.edge("sh:" + s_["id"], "sh:" + c, "stated", "원문 allOf 구성", weak=True)
                elif base_use[c] > 2:
                    self.verify["allof_common_base"]["skipped"] += 1
        # 원문 판별자 (2026-10-18 2단계): 기반 모양의 discriminator 표가 고르는 하위 모양이 그 기반을 allOf 로 가지면 같은 대상의
        # 하위 유형이다 (Okta PolicyRule -> AccessPolicyRule 등 12개). 공통 기반이라 위 allOf 규칙에서 빠진 것을 원문 표로 잇는다.
        # 단, 동작이 한 번도 돌려주지 않는 추상/공통 기반(예: Graph entity)은 건너뛴다.
        returned_shapes = set()
        for o in self.ops.values():
            r = self.resp(o)
            if r:
                returned_shapes.update(self.obj(r))
                returned_shapes.update(self.element(r))
        changed = True
        while changed:
            changed = False
            for x in sorted(returned_shapes):
                for sub in self.discriminator_subtypes(x):
                    if sub not in returned_shapes:
                        returned_shapes.add(sub)
                        changed = True
        disc_skipped_bases = set()
        for s_ in sorted(self.shapes.values(), key=lambda x: x["id"]):
            subs = self.discriminator_subtypes(s_["id"])
            if not subs:
                continue
            if s_["id"] not in returned_shapes:
                disc_skipped_bases.add(s_["id"])
                self.verify["discriminator_common_base"]["skipped"] += len(subs)
                continue
            for sub in subs:
                self.edge("sh:" + s_["id"], "sh:" + sub, "stated", "원문 판별자 하위 모양", weak=True)
                self.verify["discriminator_subtype"]["edges"] += 1
        if disc_skipped_bases:
            self.verify["discriminator_common_base"]["bases"] = sorted(disc_skipped_bases)
        # 원문 판별자 하위 유형 (union 에 discriminator 가 있을 때만 같은 대상)
        for s in self.shapes.values():
            if s["kind"] == "union" and s.get("discriminator"):
                alts = [a for a in self.obj(s["id"])]
                for a, b in zip(alts, alts[1:]):
                    self.edge("sh:" + a, "sh:" + b, "stated", "판별자 하위 유형 %s" % s["id"])
        # 원문 바인딩: 파라미터 위치 -> 키 선언 모양
        kd = {k["id"]: k for k in self.keys}
        for b in self.binds:
            o = self.ops.get(b["operation"])
            k = kd.get((b.get("to") or {}).get("key_decl"))
            if not o or not k or not o.get("path"):
                continue
            for x in o["path"]["positions"]:
                if x["param"] == b["param"]:
                    self.edge("pos:" + pos_of(o["path"]["template"], x["index"]), "sh:" + k["shape"], "stated", "원문 바인딩 %s" % b["id"])
        # 원문 ID 형식이 붙은 키 자리: 형식 꼭짓점과 그 모양
        keyprops = {(k["shape"], p) for k in self.keys for p in k["props"]}
        self.idf_props = collections.defaultdict(set)
        for f in self.idfs:
            for a in f.get("applies") or []:
                if a.get("shape"):
                    self.idf_props[(a["shape"], a.get("prop"))].add(f["id"])
                    if (a["shape"], a.get("prop")) in keyprops:
                        self.edge("idf:" + f["id"], "sh:" + a["shape"], "stated", "원문 ID 형식이 붙은 키")
        # Jev 키의 예시 값이 모두 원문 ID 형식 하나(가장 좁은 것)에 맞으면 그 형식의 키와 같은 값 집합이다 (2026-10-18, 1단계 누락:
        # Slack canvases.create 의 canvas_id "F1234ABCD" 는 defs_file_id ^[F][A-Z0-9]{8,}$ 에 맞는다. 캔버스는 파일 id 를 쓴다)
        self.format_twins = []
        if self.model_keys:
            rx = {}
            for f in self.idfs:
                pat = (f.get("match") or {}).get("pattern")
                if pat and (f.get("match") or {}).get("prefixes"):
                    try:
                        rx[f["id"]] = re.compile(pat)
                    except re.error:
                        pass
            mk = {(k["shape"], k["props"][0]) for k in self.model_keys}
            vals = collections.defaultdict(set)
            for ins in self.insts:
                o = self.ops.get((ins.get("of") or {}).get("operation", ""))
                if o and self.resp(o):
                    for s_, n_, v, _ in self.walk(ins["value"], self.resp(o)):
                        if (s_, n_) in mk and not is_sentinel_value(v):
                            vals[(s_, n_)].add(v)
            for (sh_, pr_), vs in sorted(vals.items()):
                fits = [self.narrowest({fid for fid, r in rx.items() if r.match(v)}) for v in sorted(vs)]
                if fits and all(len(x) == 1 for x in fits) and len(set().union(*fits)) == 1:
                    fid = next(iter(fits[0]))
                    # 합치지 않고 2단계 중복 후보로 남긴다. 문서 예시 값은 자리 표시(T1234567890)라 view_id 가 팀 형식에 맞는 식으로 틀린다
                    self.format_twins.append({"shape": sh_, "prop": pr_, "id_format": fid, "values": sorted(vs)[:3], "grade": "example"})
        # 원문 ID 형식끼리: 접두사 집합이 같으면 같은 값 집합이다 (Slack defs_user_id 와 defs_enterprise_user_id 는 둘 다 U, W)
        by_pre = collections.defaultdict(list)
        for f in self.idfs:
            pre = (f.get("match") or {}).get("prefixes")
            if pre:
                by_pre[frozenset(pre)].append(f["id"])
        for pre, fids in sorted(by_pre.items(), key=lambda x: sorted(x[1])):
            fids = sorted(fids)
            for a, b in zip(fids, fids[1:]):
                self.edge("idf:" + a, "idf:" + b, "stated", "원문 ID 형식의 접두사 집합이 같다 %s" % sorted(pre))
        # 같은 모양 지문 (이름 같음을 쓰는 규칙: verify 대상)
        fp = collections.defaultdict(list)
        for s in self.shapes.values():
            if s["kind"] != "object" or s["origin"] == "example_derived":
                continue
            props = s.get("props") or []
            if len(props) < FP_MIN:
                continue
            key = (s["src"]["source"], frozenset((pr["name"], pr.get("scalar") if isinstance(pr.get("scalar"), str) else
                                                  self.fp_kind(pr.get("shape"))) for pr in props))
            fp[key].append(s["id"])
        for k, ids in sorted(fp.items(), key=lambda x: sorted(x[1])):
            ids = sorted(ids)
            for a, b in zip(ids, ids[1:]):
                self.edge("sh:" + a, "sh:" + b, "structural", "같은 모양 지문 (속성 %d개)" % len(k[1]), weak=True)

    def join(self, a, b, weak):
        ra, rb = self.uf.find(a), self.uf.find(b)
        if ra == rb:
            return True
        ha, hb = self.hset.get(ra, set()), self.hset.get(rb, set())
        if weak and ha and hb and ha != hb:
            return False
        ka, kb = self.kset.get(ra, set()), self.kset.get(rb, set())
        if weak and ka and kb and ka != kb:
            return False                                   # 원문이 각자 키를 선언한 다른 타입
        self.uf.union(ra, rb)
        r = self.uf.find(ra)
        self.hset[r] = ha | hb
        self.kset[r] = ka | kb
        return True

    def non_identifying(self, sid, name):
        """원문이 대상을 식별하지 않는 값이라고 말하는 속성: enum, 날짜와 시각 형식, boolean (루프 13)"""
        pr = next((p for p in self.shapes[sid].get("props") or [] if p["name"] == name), None) or {}
        sc = pr.get("scalar")
        sub = (self.shapes.get(pr.get("shape") or "") or {}).get("scalar") or {}
        fmt = pr.get("format") or sub.get("format")
        return bool(pr.get("enum") or sub.get("enum") or sc == "boolean" or sub.get("scalar") in ("boolean", "enum")
                    or fmt in ("date-time", "date", "time", "datetime"))

    def example_twins(self):
        """같은 출처의 두 객체 모양이 인스턴스에서 같은 이름 속성에 같은 희귀 값을 둘 이상 공유하면 같은 대상 (루프 7).
        예: GitHub minimal-repository 와 full-repository 예시가 id 1296269, 같은 node_id, 같은 url 을 가진다.
        이름 같음과 값 같음을 함께 본다. 약한 간선이라 단건 위치나 원문 키가 다르면 합치지 않는다"""
        idx = collections.defaultdict(set)                 # (출처, 속성, 값) -> {모양}
        rprops = collections.defaultdict(set)              # 모양 -> 희귀 값이 나온 속성들
        grade = {}
        for ins in self.insts:
            if "operation" not in ins["of"] or ins["grade"] not in ("example", "observed"):
                continue
            o = self.ops.get(ins["of"]["operation"])
            if not o:
                continue
            for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                rare = (len(v) >= 6 and not v.isdigit()) or (v.isdigit() and int(v) >= 1000)
                if rare and v.lower() not in ("true", "false", "null") and not is_sentinel_value(v) and not self.non_identifying(sid, name):
                    k = (self.shapes[sid]["src"]["source"], name, v)
                    idx[k].add(sid)
                    rprops[sid].add(name)
                    grade[k] = "observed" if ins["grade"] == "observed" and grade.get(k, "observed") == "observed" else "example"
        pairs = collections.defaultdict(set)
        pgrade = collections.defaultdict(set)
        for k, shs in idx.items():
            if 2 <= len(shs) <= 30:                        # 아주 흔한 값(모든 모양에 나오는 예시 값)은 근거가 아니다
                shs = sorted(shs)
                for i, a in enumerate(shs):
                    for b in shs[i + 1:]:
                        pairs[(a, b)].add((k[1], k[2]))
                        pgrade[(a, b)].add(grade[k])
        for (a, b), kv in sorted(pairs.items()):
            shared = {p for p, _ in kv}
            # 루프 8: 다른 대상끼리도 예시 값을 재사용한다(아바타 URL). 공유 속성 3개 이상, 작은 쪽 희귀 값 속성의 60% 이상
            if len(shared) >= 3 and len(shared) >= 0.6 * min(len(rprops[a]), len(rprops[b])):
                g = "observed" if pgrade[(a, b)] == {"observed"} else "example"
                self.edge("sh:" + a, "sh:" + b, g, "인스턴스 값 쌍 일치 %s" % sorted(p for p, _ in kv)[:4], weak=True)
                self.verify["example_twin"]["edges"] += 1

    def spaces(self):
        for k in self.model_keys:
            self.uf.find("sh:" + k["shape"])               # Jev 키 모양: 간선이 없어도 동치류로 등록
        for P in self.item_pos:
            self.hset[self.uf.find("pos:" + P)].add(P)
        self.kset = collections.defaultdict(set)
        for k in self.keys:
            if k["grade"] == "stated":
                self.kset[self.uf.find("sh:" + k["shape"])].add(k["shape"])
        self.example_twins()
        order = {"stated": 0, "transform": 1, "structural": 2, "example": 3, "observed": 1}
        for e in sorted(self.edges, key=lambda e: (e["weak"], order.get(e["grade"], 9))):
            ok = self.join(e["a"], e["b"], e["weak"])
            e["joined"] = ok
            if not ok:
                self.issue("weak_merge_refused", {"a": e["a"], "b": e["b"]}, "collect", "instance",
                           "약한 간선이 단건 위치가 다른 두 동치류를 잇는다. 같은 대상인지 실측으로 확인", {"why": e["why"]})
        for x in list(self.positions):
            self.uf.find("pos:" + x)
        mem = collections.defaultdict(set)
        for x in list(self.uf.p):
            mem[self.uf.find(x)].add(x)
        stated_key_shapes = {k["shape"] for k in self.keys}
        model_key_shapes = {k["shape"] for k in self.model_keys}
        twin_roots = {self.uf.find(e["a"]) for e in self.edges if e["why"].startswith("인스턴스 값 쌍") and e.get("joined")}
        self.space = {}                                    # 동치류 -> 공간 정보
        names = set()
        for r, xs in sorted(mem.items()):
            items = sorted(x[4:] for x in xs if x.startswith("pos:") and x[4:] in self.item_pos)
            shs = sorted(x[3:] for x in xs if x.startswith("sh:"))
            keyed = [s for s in shs if s in stated_key_shapes]
            mkeyed = [s for s in shs if s in model_key_shapes]
            addr = sorted(x[4:] for x in xs if x.startswith("pos:") and x[4:] in self.addressable)
            vid = r in twin_roots and len(shs) >= 2
            if not items and not keyed and not mkeyed and not (addr and shs) and not vid:
                continue                                   # 공간이 아니다 (값 객체, 또는 근거 없는 모양)
            # 표시용 이름: 단건 응답 모양 이름(가장 짧은 것) > 경로 단어 > 키 선언 모양 이름. 판정에 쓰지 않는다
            ret = sorted({(self.shapes[s].get("name") or "") for s in shs if s in self.returned_by_item(items)} - {""}, key=lambda n: (len(n), n))
            if ret:
                name = ret[0]
            elif items:
                ws = [segs(P)[-2] if len(segs(P)) > 1 else P for P in items]
                name = sorted(ws, key=lambda w: (len(w), w))[0]
            elif keyed or mkeyed:
                name = sorted((self.shapes[s].get("name") or s.rsplit(":", 1)[-1]) for s in (keyed or mkeyed))[0]
            elif not addr:
                name = sorted((self.shapes[s].get("name") or s.rsplit(":", 1)[-1]) for s in shs)[0]
            else:
                ws = [segs(P)[-2] if len(segs(P)) > 1 else P for P in addr]
                name = sorted(ws, key=lambda w: (len(w), w))[0]
            if name.isdigit():                             # 응답 뿌리 모양 이름이 상태 코드뿐이면 동작 이름을 붙인다 (표시용, 2026-10-18)
                ops_ = sorted(sh_.split(":op:")[1].split(":resp:")[0] for sh_ in shs if ":op:" in sh_ and ":resp:" in sh_)
                if ops_:
                    name = ops_[0] + "." + name
            base, n = name, 2
            while name in names:
                name = "%s_%d" % (base, n)
                n += 1
            names.add(name)
            par = set()
            # 부모는 단건 위치에서만 읽는다. 주소 위치까지 넣었더니(2026-10-18) Okta Group 이 역할 할당의 대상 위치
            # groups/{}/roles/{}/targets/groups/{} 때문에 roles/{} 를 부모로 갖게 됐다. 되돌림. 두 부모 기록은 positions 로 본다
            for P in items:
                ss = segs(P.lstrip("!"))
                idx = [i for i, s in enumerate(ss) if s == "{}"]
                if P.startswith("!") and idx:
                    par.add("/".join(ss[:idx[-1] + 1]))    # 부모 아래 단일 자원: 마지막 위치가 부모
                elif len(idx) >= 2:
                    par.add("/".join(ss[:idx[-2] + 1]))
            self.space[r] = {"name": name, "item_positions": items, "shapes": shs, "stated_key_shapes": keyed,
                             "positions": sorted(x[4:] for x in xs if x.startswith("pos:")),
                             "form": ("local_singleton" if items and all(P.startswith("!") and "{}" in P for P in items) else
                                      "singleton" if items and all(P.startswith("!") for P in items) else
                                      "global" if any(P.count("{}") == 1 or "?" in P for P in items) else ("local" if items else
                                      ("key_only" if keyed else "model_key" if mkeyed else "write_addressed" if addr else "value_identity"))),
                             "parent_positions": sorted(par)}
        # 원문 역할 목록 (2026-10-18): 역할을 읽는 API 가 없어도 문서가 역할 id 를 나열하면(grant kind role) 그 목록이 ID 공간이다.
        # Slack admin.roles.addAssignments 의 역할 표가 그렇다. 값이 목록에 있는지로 대상을 정한다 (part_target)
        self.catalog_keys = {}
        roles = collections.defaultdict(set)
        for g in self.grants:
            if g["kind"] == "role":
                roles["roles"].add(g["name"])              # 출처가 여럿이어도 provider 의 역할 id 는 한 값 집합이다 (Okta 4개 출처)
        for nm, names in sorted(roles.items()):
            self.catalog_keys[nm] = names
            self.space["catalog:" + nm] = {"name": nm, "item_positions": [], "shapes": [], "stated_key_shapes": [], "positions": [],
                                           "form": "catalog_key", "parent_positions": [], "keys": len(names),
                                           "candidate_why": "원문 문서의 역할 목록 (grant kind role, stated)",
                                           "sources": sorted({g["src"]["source"] for g in self.grants if g["kind"] == "role"})}
        self.shape_space = {}
        for r, sp in self.space.items():
            if sp["form"] != "value_identity":
                for s in sp["shapes"]:
                    self.shape_space[s] = sp["name"]
        # 값 정체성 검증 (루프 14): 서로 다른 맥락(다른 공간의 레코드 안, 또는 동작 응답 뿌리) 2곳 이상에 나오는 묶음만 대상이다.
        # 한 대상 안에만 나오는 묶음(채널 topic, 아바타 URL 묶음)은 값 객체라 공간에서 뺀다
        holder = collections.defaultdict(set)              # 모양 -> 그것을 속성으로 가진 모양들
        for s_ in self.shapes.values():
            for pr in s_.get("props") or []:
                for o in self.obj(pr.get("shape") or ""):
                    holder[o].add(s_["id"])
        roots = {x for o in self.ops.values() if self.resp(o) for x in self.obj(self.resp(o))}
        for r, sp in list(self.space.items()):
            if sp["form"] != "value_identity":
                continue
            ctx = set()
            for sh in sp["shapes"]:
                if sh in roots:
                    ctx.add("@root")
                for h in holder.get(sh, ()):
                    ctx.add(self.shape_space.get(h) or "@" + h)
            ctx -= {sp["name"]}
            if len(ctx) >= 2:
                for sh in sp["shapes"]:
                    self.shape_space[sh] = sp["name"]
                self.verify["value_identity"]["kept"] += 1
            else:
                del self.space[r]
                self.verify["value_identity"]["value_object"] += 1
        self.pos_space = {}
        for r, sp in self.space.items():
            for P in sp["positions"]:
                self.pos_space[P] = sp["name"]
        # 부모로만 쓰이는 경로 위치 (고아 수정 3, 2026-10-18): 그 위치를 읽는 단건 GET 은 없지만 아래에 다른 글자 조각이 이어지는
        # 동작이 3개 이상이면 그 인자가 가리키는 대상이 있다 (GitHub enterprises/{enterprise}, Gmail users/{userId}, ASA teams/{team_name}).
        # 다음 조각이 또 인자인 위치(repos/{owner}/{repo} 의 owner)는 복합 주소의 앞부분이라 뺀다. 같은 대상의 다른 공간과의 같음은 2단계
        kids = collections.defaultdict(set)
        for oid, o in self.ops.items():
            t = (o.get("path") or {}).get("template")
            if not t:
                continue
            ss = segs(t)
            for x in o["path"]["positions"]:
                i = x["index"]
                if i + 1 < len(ss) and not ss[i + 1].startswith("{"):
                    kids[pos_of(t, i)].add(oid)
        for P, ops_ in sorted(kids.items()):
            if P in self.pos_space or len(ops_) < 3 or P in self.enum_pos:
                continue
            nm = "parent:" + P
            self.space["parent:" + P] = {"name": nm, "item_positions": [], "shapes": [], "stated_key_shapes": [], "positions": [P],
                                         "form": "parent_only", "parent_positions": [], "child_operations": len(ops_),
                                         "candidate_why": "아래 동작 %d개의 부모 위치. 이 위치를 읽는 동작은 없다" % len(ops_)}
            self.pos_space[P] = nm
            self.verify["parent_only_positions"]["spaces"] += 1

    def returned_by_item(self, items):
        out = set()
        for P in items:
            for oid in self.item_pos[P]:
                out.update(self.obj(self.resp(self.ops[oid]) or ""))
        return out

    # ------------------------------------------------------------------ B, C. ID 와 대상
    def walk(self, value, sid, path="$", depth=0):
        """인스턴스 값을 모양을 따라 걷는다 -> (객체 모양 id, 속성 이름, 값, 객체 경로)"""
        if depth > 8 or sid is None:
            return
        s = self.shapes.get(sid) or {}
        k = s.get("kind")
        if k == "array" and isinstance(value, list):
            it = (s.get("items") or {}).get("shape")
            for v in value:
                yield from self.walk(v, it, path + "[*]", depth + 1)
        elif k == "union":
            for a in s.get("alts") or []:
                yield from self.walk(value, a, path, depth + 1)
        elif k == "object" and isinstance(value, dict):
            dsc = s.get("discriminator") or {}
            sub = (dsc.get("map") or {}).get(str(value.get(dsc.get("prop")))) if dsc.get("prop") else None
            if sub and sub != sid and sub in self.shapes:
                # 원문 판별자: type 값이 고르는 하위 모양으로 걷는다 (Okta PolicyRule -> AccessPolicyRule, 2026-10-18).
                # 하위 모양은 allOf 로 기반 모양의 속성을 다 가진다
                yield from self.walk(value, sub, path, depth + 1)
                return
            props = {pr["name"]: pr for pr in s.get("props") or []}
            for name, v in value.items():
                pr = props.get(name)
                if not pr:
                    continue
                psh = self.shapes.get(pr.get("shape") or "") or {}
                if psh.get("kind") == "array" and isinstance(v, list) and not (psh.get("items") or {}).get("shape"):
                    # 문자열 id 배열 (Slack members, Okta groupIds): 원소마다 그 속성의 값으로 본다 (2026-10-18, 2단계)
                    for x in v[:20]:
                        if isinstance(x, (str, int)) and not isinstance(x, bool):
                            yield sid, name, str(x), path
                elif pr.get("shape") and psh.get("kind") in ("object", "array", "union", "map"):
                    yield from self.walk(v, pr["shape"], path + "." + name, depth + 1)
                elif isinstance(v, (str, int)) and not isinstance(v, bool):
                    yield sid, name, str(v), path

    def instance_fields(self, ins):
        """IR에 기록된 예시의 실제 자리로 걷는다. 요청과 스키마 예시를 응답 모양에 대입하지 않는다."""
        of = ins.get("of") or {}
        if of.get("shape"):
            sid = of["shape"]
            prop = of.get("prop")
            if prop:
                if prop != "[*]":
                    yield from self.walk({prop: ins["value"]}, sid)
            else:
                yield from self.walk(ins["value"], sid)
            return
        o = self.ops.get(of.get("operation"))
        if not o or of.get("param"):
            return
        status = of.get("status")
        if status == "request":
            sid = o.get("request")
        elif status is not None:
            sid = next((r.get("shape") for r in o.get("responses") or [] if str(r.get("status")) == str(status)), None)
        else:
            sid = self.resp(o)
        yield from self.walk(ins["value"], sid)

    def ids(self, include_model_refs=True):
        self.id_role = {}                                  # (모양, 속성) -> {role, target, grade, why}
        for k in self.model_keys:
            for pr in k["props"]:
                self.id_role[(k["shape"], pr)] = {"role": "self_key", "target": self.shape_space.get(k["shape"]),
                                                  "grade": "model", "why": k["evidence"]}
        for k in self.keys:
            for pr in k["props"]:
                self.id_role[(k["shape"], pr)] = {"role": "self_key", "target": self.shape_space.get(k["shape"]),
                                                  "grade": k["grade"], "why": k.get("evidence")}
        # 공간의 자기 키 필드 (Jev model, 2026-10-18 2단계): 위치로 선 공간인데 어느 필드가 자기 id 인지 원문이 말하지 않는 경우.
        # 판정한 모양과, 같은 공간의 다른 모양 중 같은 이름의 필드를 가진 것에 붙인다 (같은 공간 안 맞춤, verify.jev_space_key)
        jp = os.path.join(HERE, "out2", self.p, "map", "jev_spacekeys.json")
        if os.path.exists(jp):
            by_sp = collections.defaultdict(list)
            for x, n in self.shape_space.items():
                by_sp[n].append(x)
            for r in json.load(io.open(jp, encoding="utf-8")):
                if r.get("key") in (None, "none") or (r.get("key_p") or 0) < 0.7:
                    continue
                for x in by_sp.get(r["space"], []):
                    if any(pr["name"] == r["key"] for pr in (self.shapes.get(x) or {}).get("props") or []) and (x, r["key"]) not in self.id_role:
                        self.id_role[(x, r["key"])] = {"role": "self_key", "target": r["space"], "grade": "model",
                                                       "why": "Jev %s: 공간 %s 의 자기 식별자 %s %.2f" % (r.get("model"), r["space"], r["key"], r["key_p"])}
                        self.verify["jev_space_key"]["shapes" if x != r["shape"] else "judged"] += 1
        for r in self.refs_decl:
            fr, to = r["from"], r.get("to") or {}
            tg = sorted({self.shape_space.get(x) for t in (to.get("shapes") or []) for x in self.obj(t)} - {None})
            key = (fr["shape"], fr["prop"])
            if key not in self.id_role:
                self.id_role[key] = {"role": "ref", "target": tg[0] if len(tg) == 1 else (tg or None), "grade": r["grade"],
                                     "why": "원문 참조 %s" % r["id"], "poly": r.get("poly") or len(tg) > 1}
        idf_space = {}
        for (s, pr), fids in self.idf_props.items():
            if (s, pr) in self.id_role and self.id_role[(s, pr)]["role"] == "self_key" and self.shape_space.get(s):
                for f in fids:
                    idf_space[f] = self.shape_space[s]
        self.idf_space = idf_space
        self.align_by_key_format()
        # 참조로만 쓰이는 원문 ID 형식 (2026-10-18): 접두사가 있는 형식이 어느 레코드의 자기 키도 아니고 다른 레코드의 필드에만
        # 붙으면, 그 대상을 돌려주는 API 가 없을 뿐 값 집합은 원문이 정했다. 그 형식을 ID 공간으로 세운다.
        # Slack defs_enterprise_id(^[E]...)는 objs_team.enterprise_id 등에만 붙고 enterprise 를 읽는 메서드가 없다
        by_pre = collections.defaultdict(list)
        for f in self.idfs:
            pre = (f.get("match") or {}).get("prefixes")
            if pre and f["id"] not in idf_space and f.get("applies"):
                by_pre[frozenset(pre)].append(f)
        for pre, fs in sorted(by_pre.items(), key=lambda x: sorted(x[0])):
            if any(idf_space.get(g["id"]) for g in self.idfs if frozenset((g.get("match") or {}).get("prefixes") or ()) == pre):
                continue                                   # 접두사 집합이 같은 다른 형식이 이미 공간에 있다
            nm = sorted(f["name"] for f in fs)[0]
            self.space["ref_only:" + nm] = {"name": nm, "item_positions": [], "shapes": [], "stated_key_shapes": [], "positions": [],
                                            "form": "ref_only", "parent_positions": [], "id_formats": sorted(f["id"] for f in fs),
                                            "referenced_by": sorted({"%s.%s" % (a_["shape"], a_.get("prop")) for f in fs
                                                                     for a_ in f["applies"]})[:20],
                                            "candidate_why": "원문 ID 형식이 참조 필드에만 붙는다. 대상을 읽는 API 가 없다 (stated)"}
            for f in fs:
                idf_space[f["id"]] = nm
        self.verify["ref_only_formats"]["spaces"] = sum(1 for k in self.space if str(k).startswith("ref_only:"))
        for sid, fids in sorted(getattr(self, "align_deferred", {}).items()):
            sps = {idf_space.get(f) for f in fids} - {None}
            if len(sps) == 1 and not self.shape_space.get(sid):
                self.shape_space[sid] = next(iter(sps))
                self.verify["key_format_alignment"]["aligned_to_narrower"] += 1
            else:
                self.verify["key_format_alignment"]["narrower_unresolved"] += 1
        # 원문 참조가 ID 형식을 가리키면(to.id_format) 그 형식의 공간이 대상이다 (2026-10-18: Slack auth.test 의 team_id,
        # user_id 가 형식을 가리키는데 대상이 비어 있었다. 모양을 가리키는 참조만 풀고 있었다)
        for r in self.refs_decl:
            to = r.get("to") or {}
            f = to.get("id_format")
            key = (r["from"]["shape"], r["from"]["prop"])
            if f and idf_space.get(f) and key in self.id_role and self.id_role[key]["role"] == "ref" and not self.id_role[key]["target"]:
                self.id_role[key]["target"] = idf_space[f]
                self.id_role[key]["why"] += " -> 원문 ID 형식 %s" % f
                self.verify["ref_to_id_format"]["resolved"] += 1
        local_fmt = {f["id"] for f in self.idfs if not (f.get("match") or {}).get("prefixes") and f["id"] not in idf_space
                     and (f.get("match") or {}).get("pattern")}
        self.local_shapes = {}
        for (s_, pr), fids in sorted(self.idf_props.items()):
            hit = sorted(fids & local_fmt)
            if hit and s_ not in self.shape_space and (self.shapes.get(s_) or {}).get("kind") == "object":
                self.local_shapes.setdefault(s_, hit[0])
        self.verify["local_record_shapes"]["shapes"] = len(self.local_shapes)
        for (s, pr), fids in self.idf_props.items():
            if (s, pr) in self.id_role:
                continue
            tg = sorted({idf_space.get(f) for f in fids} - {None})
            self.id_role[(s, pr)] = {"role": "ref", "target": tg[0] if len(tg) == 1 else (tg or None), "grade": "stated",
                                     "why": "원문 ID 형식 %s" % sorted(fids)}
        # 실측 왕복: 요청 경로 값 = 어떤 실측 응답의 필드 값, 그 필드의 모양이 그 위치의 공간에 속함 -> 주소 키
        # 한 위치의 관측마다 같은 값을 가진 필드 집합을 모으고, 모든 관측에서 맞은 필드가 하나뿐일 때만 정한다
        vindex = collections.defaultdict(set)              # 값 -> {(모양, 속성)}
        for ins in self.insts:
            if ins["grade"] != "observed" or "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            if o:
                for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                    if not is_sentinel_value(v):
                        vindex[v].add((sid, name))
        obs = collections.defaultdict(list)                # 위치 -> [그 관측에서 맞은 (모양, 속성) 집합]
        for ins in self.insts:
            if ins["grade"] != "observed" or "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            params = ((ins.get("ext") or {}).get("request") or {}).get("params") or {}
            if not o or not params or not o.get("path"):
                continue
            for x in o["path"]["positions"]:
                pv = params.get(x["param"])
                P = pos_of(o["path"]["template"], x["index"])
                sp = self.pos_space.get(P)
                if pv is None or not sp:
                    continue
                own = {(s_, n_) for s_, n_ in vindex.get(pv, ()) if self.shape_space.get(s_) == sp}
                obs[P].append(own)
        for P, lst in sorted(obs.items()):
            seen_lst = [x for x in lst if x]
            if not seen_lst:
                self.issue("address_key_unobserved", {"position": P}, "collect", "instance",
                           "경로에 넣은 값이 그 공간 레코드의 실측 응답에 없다. 단건이나 목록 응답을 실측으로 받아야 한다", {"n": len(lst)})
                continue
            # 필드 이름이 아니라 (모양, 속성) 단위. 같은 공간의 여러 모양에서 같은 이름 속성은 함께 맞는다
            props = collections.Counter(n_ for x in seen_lst for n_ in {n_ for _, n_ in x})
            best = [n_ for n_, c in props.items() if c == len(seen_lst)]
            if len(best) == 1:
                for x in seen_lst:
                    for s_, n_ in x:
                        if n_ == best[0] and (s_, n_) not in self.id_role:
                            self.id_role[(s_, n_)] = {"role": "address_key", "target": self.shape_space.get(s_), "grade": "observed",
                                                      "why": "실측 왕복 %s (%d회)" % (P, len(seen_lst))}
                self.verify["observed_address_key"]["decided"] += 1
            else:
                self.issue("address_key_ambiguous", {"position": P}, "collect", "instance",
                           "모든 관측에서 경로 값과 같은 속성이 둘 이상이다. 두 값이 다른 레코드를 실측으로 받아야 갈린다",
                           {"fields": sorted(best), "n": len(seen_lst)})
                self.verify["observed_address_key"]["ambiguous"] += 1
        # 실측 값 공출현: 주소 키나 키 값과 같은 값을 가진 다른 필드 -> 참조 (희귀 값만: 한 공간에서만 키 값으로 나온 값)
        keyset = {k for k, v in self.id_role.items() if v["role"] in ("self_key", "address_key") and v.get("target")}
        key_vals = collections.defaultdict(set)            # 값 -> {공간}  키 자리 값
        key_grade = collections.defaultdict(set)           # 값 -> {그 키 값이 나온 인스턴스 등급}
        for ins in self.insts:
            if ins["grade"] not in ("observed", "example") or "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            if not o:
                continue
            for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                if (sid, name) in keyset and len(v) >= 6 and not is_sentinel_value(v):
                    key_vals[v].add(self.id_role[(sid, name)]["target"])
                    key_grade[v].add(ins["grade"])
        rare = {v: next(iter(t)) for v, t in key_vals.items() if len(t) == 1}
        co = collections.defaultdict(collections.Counter)
        cog = collections.defaultdict(set)
        for ins in self.insts:
            if ins["grade"] not in ("observed", "example") or "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            if not o:
                continue
            for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                if name in MATERIAL_NAMES or MATERIAL_VALUE.search(v) or is_sentinel_value(v):
                    continue                               # 자격증명 값은 참조가 아니다 (2026-10-18: Okta 비밀값 자리 표시가 겹쳤다)
                if v in rare and (sid, name) not in keyset:
                    co[(sid, name)][rare[v]] += 1
                    # 양쪽이 모두 실측일 때만 observed. 하나라도 문서 예시면 example (2026-10-15 루프 2)
                    cog[(sid, name)].add("observed" if ins["grade"] == "observed" and key_grade[v] == {"observed"} else "example")
        for k, c in co.items():
            if k in self.id_role:
                continue
            tg = sorted(c)
            self.id_role[k] = {"role": "ref", "target": tg[0] if len(tg) == 1 else tg,
                               "grade": "observed" if cog[k] == {"observed"} else "example", "why": "값 공출현 %s" % dict(c)}
            self.verify["value_cooccurrence"]["uses"] += 1
        # 예시 값이 원문 ID 형식(가장 좁은 것) 하나에 모두 맞는 필드 -> 그 형식 공간의 참조 (2026-10-18, 복합키 재료).
        # 지금까지는 조합 레코드의 부분 필드에서만 썼다. 값이 하나라도 다른 형식이나 형식 밖이면 정하지 않는다
        fx = []
        for f in self.idfs:
            pat = (f.get("match") or {}).get("pattern")
            if pat and (f.get("match") or {}).get("prefixes") and self.idf_space.get(f["id"]):
                try:
                    fx.append((f["id"], re.compile(pat)))
                except re.error:
                    pass
        # 원문에 ID 형식이 없는 provider (Okta): 공간의 자기 키 값에서 접두사를 배운다 (2026-10-18, 2단계). 키 값 3개 이상이
        # 모두 같은 3글자로 시작하고, 그 3글자가 다른 공간의 키 값에는 없을 때만. 등급은 값의 등급(observed, example)을 따른다.
        # 원문 형식이 아니라 값에서 배운 것이라 verify.learned_prefix 에 남긴다
        kvals = collections.defaultdict(set)
        kgr = collections.defaultdict(set)
        obs_vals = set()
        for ins in self.insts:
            if ins["grade"] not in ("observed", "example"):
                continue
            for sid, name, v, path in self.instance_fields(ins):
                r = self.id_role.get((sid, name))
                if (r and r["role"] in ("self_key", "address_key") and isinstance(r.get("target"), str) and len(v) >= 8
                        and "{" not in v and "/" not in v and ":" not in v and not is_sentinel_value(v)):
                    kvals[r["target"]].add(v)
                    kgr[r["target"]].add(ins["grade"])
                    if ins["grade"] == "observed":
                        obs_vals.add(v)
        pre_of = collections.defaultdict(collections.Counter)  # 접두사 -> 공간별 키 값 수
        for sp_, vs in kvals.items():
            for v in vs:
                pre_of[v[:3]][sp_] += 1
        self.learned_prefix = {}                           # 접두사 -> 대상 공간들 (전역 위치가 있는 공간만)
        self.prefix_shared = {}                            # 같은 접두사 키 값을 가진 공간들 (2단계 중복 후보)
        glob = {sp["name"] for sp in self.space.values() if any(P.count("{}") == 1 for P in sp.get("item_positions") or [])}
        has_fmt = {self.idf_space.get(f["id"]) for f in self.idfs}
        for pf, cnt in sorted(pre_of.items()):
            if sum(cnt.values()) < 3 or len(pf) < 3 or not pf.isalnum() or pf.isdigit():   # 숫자 id, URL 은 접두사가 종류를 말하지 않는다
                continue
            if len(cnt) > 1:
                self.prefix_shared[pf] = dict(cnt)
            # 그 접두사로 시작하는 키 값을 가진 공간 중 전역 단건 위치가 있는 것 (Okta 00u -> 사용자, 0oa -> 앱, IdP, 로그 스트림)
            tg = sorted(n for n in cnt if n in glob and n not in has_fmt)
            # 각 공간의 키 값이 모두 이 접두사여야 한다 (한 공간에 접두사가 섞이면 접두사가 종류를 말하지 않는다)
            tg = [n for n in tg if sum(1 for v in kvals[n] if v[:3] == pf) >= 0.8 * len(kvals[n])]
            # 문서 자리 표시(abc123...)를 배우지 않게: 실측 값이 하나 있거나 서로 다른 값이 5개 이상
            vals_pf = {v for n in cnt for v in kvals[n] if v[:3] == pf}
            if not (any(v in obs_vals for v in vals_pf) or len(vals_pf) >= 5):
                continue
            if tg:
                self.learned_prefix[pf] = tg
                fid = "learned:" + pf
                fx.append((fid, re.compile("^" + re.escape(pf) + r"[A-Za-z0-9]{8,}$")))
                self.idf_space[fid] = tg[0] if len(tg) == 1 else tg
        self.verify["learned_prefix"]["formats"] = len(self.learned_prefix)
        self.verify["learned_prefix"]["shared"] = len(self.prefix_shared)
        fvals = collections.defaultdict(set)
        fgr = collections.defaultdict(set)
        for ins in self.insts:
            if ins["grade"] not in ("observed", "example"):
                continue
            for sid, name, v, path in self.instance_fields(ins):
                if (sid, name) not in self.id_role and v and not (name in MATERIAL_NAMES or MATERIAL_VALUE.search(v) or is_sentinel_value(v)):
                    fvals[(sid, name)].add(v)
                    fgr[(sid, name)].add(ins["grade"])
        for k, vs in sorted(fvals.items()):
            # 대문자 상수(EVERYONE, ALL_CLIENTS)는 id 자리에 함께 쓰이는 예약어라 빼고 본다 (Okta 정책 조건 include, 2026-10-18).
            # 형식에 맞는 값이 하나도 없으면 정하지 않는다
            consts = {v for v in vs if re.fullmatch(r"[A-Z][A-Z0-9_]*", v) and not any(rx.match(v) for _, rx in fx)}
            if consts and consts != vs:
                vs = vs - consts
                self.verify["value_id_format"]["reserved_words_skipped"] += 1
            hits = [self.narrowest({fid for fid, rx in fx if rx.match(v)}) for v in sorted(vs)]
            if hits and all(len(h) == 1 for h in hits) and len(set().union(*hits)) == 1:
                fid = next(iter(hits[0]))
                self.id_role[k] = {"role": "ref", "target": self.idf_space[fid], "poly": isinstance(self.idf_space[fid], list),
                                   "grade": "observed" if fgr[k] == {"observed"} else "example",
                                   "why": "예시 값이 원문 ID 형식 %s 에 맞다 %s" % (fid, sorted(vs)[:2])}
                self.verify["value_id_format"]["refs"] += 1
        # URL 값이 동작 경로 틀에 맞음 (글자 조각 같음을 쓰는 규칙: verify 대상)
        tmpl = sorted({tuple(segs(o["path"]["template"])) for o in self.ops.values() if o.get("path") and o["kind"] == "read_one"})
        for ins in self.insts:
            if "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            if not o:
                continue
            for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                if (sid, name) in self.id_role or not v.startswith("http") or "{" in v:
                    continue                               # URI 템플릿({?...})은 값이 아니라 틀이다 (루프 12, GitHub API 루트)
                ps = segs(urllib.parse.urlsplit(v).path)
                for t in tmpl:
                    if len(t) <= len(ps) and all(a.startswith("{") or a == b for a, b in zip(t, ps[-len(t):])) and len(t) == len(ps[-len(t):]):
                        if ps[-len(t) - 1:-len(t)] and len(ps) > len(t) and not t[0].startswith("{"):
                            pass
                        P = pos_of("/".join(t), len(t) - 1)
                        sp = self.pos_space.get(P)
                        if sp:
                            self.id_role[(sid, name)] = {"role": "ref_url", "target": sp, "grade": ins["grade"],
                                                         "why": "URL 이 경로 틀 /%s 에 맞음" % "/".join(t)}
                            self.verify["url_template"]["uses"] += 1
                            break

        self.apply_source_refs()
        if include_model_refs:
            self.apply_model_refs()

    def apply_model_refs(self):
        """모든 값 규칙 뒤에 Jev 참조를 붙인다. 후보 수집에서는 빼서 이전 판정이 자기 입력을 바꾸지 않게 한다."""
        jr = os.path.join(HERE, "out2", self.p, "map", "jev_reffields.json")
        if not os.path.exists(jr):
            return
        names = {sp["name"] for sp in self.space.values()}
        for r in json.load(io.open(jr, encoding="utf-8")):
            k = (r["shape"], r["prop"])
            if ((r.get("part") or 0) < 0.7 or r.get("choice") in (None, "none")
                    or (r.get("p") or 0) < 0.7 or r["choice"] not in names):
                continue
            if k in self.id_role and (self.id_role[k]["role"] == "self_key" or self.id_role[k].get("target")):
                continue
            self.id_role[k] = {"role": "ref", "target": r["choice"], "grade": "model",
                               "why": "Jev %s: 다른 대상의 id %.2f, 대상 %s %.2f" % (r.get("model"), r["part"], r["choice"], r["p"])}
            self.verify["jev_ref_field"]["refs"] += 1

    def narrowest(self, fids):
        """값이 여러 원문 ID 형식에 맞으면 접두사 집합이 가장 좁은 것만 남긴다 (다른 맞은 형식의 진부분집합인 것)"""
        pre = {f["id"]: frozenset((f.get("match") or {}).get("prefixes") or ()) for f in self.idfs}
        fids = set(fids)
        return {f for f in fids if not any(pre.get(g) and pre.get(f) and pre[g] < pre[f] for g in fids)}

    def align_by_key_format(self):
        """다른 출처 모양을 공간에 맞춘다 (루프 6, Slack 문서 예시 모양 -> 구판 OpenAPI objs_user 공간).
        두 조건을 함께 본다: (1) 같은 명명 체계에서 원문 키 속성과 이름이 정확히 같은 속성 (2) 그 값이 그 키의 원문 ID 형식
        패턴에 맞는다. 이름 같음을 쓰므로 verify 에 표가 갈린 수와 맞춘 수를 남긴다"""
        reg_path = os.path.join(HERE, "collect", "registry.json")
        naming = {e["id"]: e.get("naming") for e in json.load(io.open(reg_path, encoding="utf-8"))["sources"]}
        rx = {}
        for f in self.idfs:
            pat = (f.get("match") or {}).get("pattern")
            if pat:
                try:
                    rx[f["id"]] = re.compile(pat)
                except re.error:
                    pass
        self.align_deferred = {}
        keyfmt = collections.defaultdict(set)              # (명명 체계, 키 속성 이름) -> {(형식, 공간)}
        for k in self.keys:
            if k["grade"] != "stated":
                continue
            sp = self.shape_space.get(k["shape"])
            for pr in k["props"]:
                for f in self.idf_props.get((k["shape"], pr), ()):
                    if sp and f in rx:
                        keyfmt[(naming.get(self.shapes[k["shape"]]["src"]["source"]), pr)].add((f, sp))
        if not keyfmt:
            return
        votes = collections.defaultdict(collections.Counter)
        for ins in self.insts:
            if "operation" not in ins["of"]:
                continue
            o = self.ops.get(ins["of"]["operation"])
            if not o:
                continue
            for sid, name, v, path in self.walk(ins["value"], self.resp(o)):
                if sid in self.shape_space or is_sentinel_value(v):
                    continue
                hit = {(f, sp) for f, sp in keyfmt.get((naming.get(self.shapes[sid]["src"]["source"]), name), ()) if rx[f].match(v)}
                if not hit:
                    continue
                # 키 형식보다 좁은 원문 형식이 값에 맞으면 그 형식의 대상이다 (2026-10-18 리뷰 반영: Slack objs_team.id 는
                # defs_workspace_id ^[TE] 라 enterprise 레코드 E12345678 이 팀 공간에 붙었다. defs_enterprise_id ^[E] 가 더 좁다)
                narrow_all = self.narrowest({f for f, r_ in rx.items() if r_.match(v)})
                if not narrow_all & {f for f, _ in hit}:
                    self.align_deferred.setdefault(sid, set()).update(narrow_all)
                    continue
                keep = self.narrowest({f for f, _ in hit})
                for f, sp in hit:
                    if f in keep:
                        votes[sid][sp] += 1
        for sid in self.align_deferred:
            votes.pop(sid, None)
        for sid, c in sorted(votes.items()):
            if len(c) == 1:
                sp = next(iter(c))
                self.shape_space[sid] = sp
                self.verify["key_format_alignment"]["aligned"] += 1
                for name, sp_ in [(pr["name"], sp) for pr in self.shapes[sid].get("props") or []]:
                    pass
            else:
                self.verify["key_format_alignment"]["split_vote"] += 1
                self.issue("key_format_vote_split", {"shape": sid}, "collect", "instance",
                           "키 이름과 형식이 맞는 공간이 둘 이상이다", {"votes": dict(c)})

    def part_target(self, sid, name):
        """조합 레코드 부분 필드의 대상 공간: 이미 정한 ID 역할, 아니면 인스턴스 값이 원문 ID 형식(가장 좁은 것)에 맞는 공간"""
        r = self.id_role.get((sid, name))
        if r and r.get("target") and not isinstance(r["target"], list):
            return r["target"], r["grade"]
        if not hasattr(self, "_vals"):
            self._vals = collections.defaultdict(list)
            for ins in self.insts:
                o = self.ops.get(ins["of"].get("operation", ""))
                if o:
                    for s_, n_, v, _ in self.walk(ins["value"], self.resp(o)):
                        if not is_sentinel_value(v) and len(self._vals[(s_, n_)]) < 5:
                            self._vals[(s_, n_)].append(v)
            self._rx = {}
            for f in self.idfs:
                pat = (f.get("match") or {}).get("pattern")
                if pat and self.idf_space.get(f["id"]):
                    try:
                        self._rx[f["id"]] = re.compile(pat)
                    except re.error:
                        pass
        vals = self._vals.get((sid, name), [])
        cat = [n for n, ks in self.catalog_keys.items() if vals and all(v in ks for v in vals)]
        if len(cat) == 1:
            return cat[0], "stated"                        # 값이 모두 원문 역할 목록에 있다
        sps = set()
        for v in vals:
            fids = self.narrowest({fid for fid, rx in self._rx.items() if rx.match(v)})
            sps |= {self.idf_space[f] for f in fids}
        return (next(iter(sps)), "stated") if len(sps) == 1 else (None, None)

    def rpc_context(self, oid, o):
        """경로가 없는 동작(RPC)의 맥락 공간: 필수 인자의 예시 값이 원문 ID 형식 패턴에 맞고, 맞은 형식들이 가리키는
        공간이 하나일 때 (루프 6). 값을 원문이 정한 형식에 대 보는 것이라 이름 비교가 아니다"""
        if not hasattr(self, "_idf_re"):
            self._idf_re = []
            for f in self.idfs:
                pat = (f.get("match") or {}).get("pattern")
                if pat:
                    try:
                        self._idf_re.append((f["id"], re.compile(pat)))
                    except re.error:
                        pass
            self._param_vals = collections.defaultdict(lambda: collections.defaultdict(list))
            for ins in self.insts:
                if "param" in ins["of"] and ins["of"].get("operation"):
                    on = (self.ops.get(ins["of"]["operation"]) or {}).get("name")
                    if on:
                        self._param_vals[on][ins["of"]["param"]].append(ins["value"])
        req = self.shapes.get(o.get("request") or "") or {}
        required = {pr["name"] for pr in req.get("props") or [] if pr.get("required")}
        required |= {p["name"] for p in o.get("params") or [] if p.get("required")}
        spaces = set()
        for prm, vals in self._param_vals.get(o.get("name"), {}).items():
            if prm not in required:
                continue
            for v in vals:
                if not isinstance(v, str) or not v:
                    continue
                fids = self.narrowest({fid for fid, rx in self._idf_re if rx.match(v) and self.idf_space.get(fid)})
                spaces |= {self.idf_space[f] for f in fids}
        if len(spaces) == 1:
            self.verify["rpc_context_by_id_format"]["decided"] += 1
            return next(iter(spaces))
        if len(spaces) > 1:
            self.verify["rpc_context_by_id_format"]["ambiguous"] += 1
        return None

    # ------------------------------------------------------------------ D. 매핑
    def props_of(self, sid, prefix="", depth=0, seen=()):
        """공간 없는 박힌 객체는 펼친다. 공간 있는 박힌 객체는 참조로 남긴다 -> [(상대 경로, 모양, 속성, 종류, 대상)]"""
        s = self.shapes.get(sid) or {}
        out = []
        for pr in s.get("props") or []:
            rel = prefix + pr["name"]
            sub = pr.get("shape")
            if pr.get("navigation"):
                objs = self.obj(sub) if sub else []
                targets = sorted({self.shape_space.get(o) for o in objs} - {None})
                if targets:
                    out.append((rel, sid, pr["name"], "ref", targets[0] if len(targets) == 1 else targets))
                else:
                    out.append((rel, sid, pr["name"], "navigation_unspaced", None))
                continue
            subs = self.shapes.get(sub) or {}
            scalar_array = subs.get("kind") == "array" and not (subs.get("items") or {}).get("shape")
            if sub and subs.get("kind") in ("object", "array", "union") and not scalar_array:
                objs = self.obj(sub)
                spaced = sorted({self.shape_space.get(o) for o in objs} - {None})
                local = sorted({self.local_shapes.get(o) for o in objs} - {None})
                if spaced:
                    out.append((rel, sid, pr["name"], "embedded_ref", spaced))
                elif local:
                    out.append((rel, sid, pr["name"], "embedded_local", local))
                elif objs and all(o in self.model_relations for o in objs):
                    out.append((rel, sid, pr["name"], "embedded_relation", objs))   # Jev 조합 레코드 (루프 19)
                elif depth < MAX_FOLD:
                    for o in objs:
                        if o not in seen:
                            out += self.props_of(o, rel + ".", depth + 1, seen + (o,))
                continue
            # 문자열 배열(Okta groupIds, Slack members)은 값 하나하나가 같은 역할이다. 지금까지 펼치지도 남기지도 않아 빠졌다 (2026-10-18)
            role = self.id_role.get((sid, pr["name"]))
            out.append((rel, sid, pr["name"], role["role"] if role else "property", role.get("target") if role else None))
        # 원문 판별자 하위 모양의 속성도 이 레코드의 속성이다 (Okta PolicyRule 의 conditions 는 AccessPolicyRule 등에만 있다)
        for sub in self.discriminator_subtypes(sid):
            if sub in seen:
                continue
            for x in self.props_of(sub, prefix, depth, seen + (sid, sub)):
                # 경로가 같아도 하위 모양에 따라 대상이 다를 수 있다. 슬롯과 역할까지 같을 때만 중복이다.
                if x not in out:
                    out.append(x)
        return out

    def mapping(self, use_props_cache=True):
        items = {}
        refs = collections.Counter()
        orphans = collections.Counter()
        orphan_items = collections.Counter()
        reach = collections.defaultdict(set)               # 모양 -> 그것을 돌려주는 동작들 (응답 뿌리와 박힌 것)
        props_cache = {}

        def get_props(sid):
            if not use_props_cache:
                return self.props_of(sid)
            if sid not in props_cache:
                props_cache[sid] = self.props_of(sid)
            return props_cache[sid]

        def add(det, rel, sid, name, kind, target, op, via):
            k = "%s|%s" % (det, rel)
            it = items.setdefault(k, {"det": det, "rel": rel, "kind": kind, "target": None, "read_by": set(), "via": set(),
                                      "slots": set()})
            if kind != "property":
                it["kind"] = kind
                targets = set(it["target"] if isinstance(it["target"], list) else [it["target"]])
                targets.update(target if isinstance(target, list) else [target])
                targets.discard(None)
                targets = sorted(targets)
                it["target"] = targets[0] if len(targets) == 1 else targets or None
            if op:
                it["read_by"].add(op)
            it["via"].add(via)
            it["slots"].add((sid, name))
            for case in (self.id_role.get((sid, name)) or {}).get("cases") or []:
                prefix = rel[:-len(name)] if name and rel.endswith(name) else ""
                mapped = dict(case, when=dict(case["when"], path=prefix + case["when"]["path"]))
                if mapped not in it.setdefault("cases", []):
                    it["cases"].append(mapped)
            for ev in (self.id_role.get((sid, name)) or {}).get("source_evidence") or []:
                if ev not in it.setdefault("source_evidence", []):
                    it["source_evidence"].append(ev)

        placed = set()
        cat_from = {r["from"]["shape"] for r in self.refs_decl if (r.get("ext") or {}).get("catalog")}
        self.catalog_shapes = {c["payload"] for c in self.cats if c.get("payload")} | cat_from
        for s_ in self.shapes.values():
            if any(pr.get("shape") in cat_from for pr in s_.get("props") or []):
                self.catalog_shapes.add(s_["id"])
        # 이벤트 기록 레코드 (고아 수정 4, 2026-10-18): 공간이 아닌 레코드의 한 자리 값이 모두 그 provider 의 이벤트, 감사 카탈로그
        # 키이면 그 레코드는 카탈로그의 기록이다 (GitHub audit-log-event 의 action, Slack audit.logs 의 entries.action).
        # 값이 둘 이상이고 서로 다른 카탈로그 키여야 한다 (값 하나만 맞는 우연을 줄인다)
        cat_keys = {c["key"] for c in self.cats if c.get("key")}
        rec_vals = collections.defaultdict(set)
        for ins in self.insts:
            o_ = self.ops.get((ins.get("of") or {}).get("operation", ""))
            if o_ and self.resp(o_):
                for s_, n_, v, _ in self.walk(ins["value"], self.resp(o_)):
                    if not self.shape_space.get(s_):
                        rec_vals[(s_, n_)].add(v)
        for (s_, n_), vs in sorted(rec_vals.items()):
            if len(vs) >= 2 and vs <= cat_keys and s_ not in self.catalog_shapes:
                self.catalog_shapes.add(s_)
                self.verify["catalog_record_by_key"][n_] += 1

        def place(sid, op, ctx_space, via, parent=None):
            sp = self.shape_space.get(sid)
            props = get_props(sid)
            if not sp and sid not in self.local_shapes and sid in self.model_relations:
                tg = []
                for f in self.model_relations[sid]:
                    t, g = self.part_target(sid, f)
                    tg.append(t or "?" + f)
                    if (sid, f) not in self.id_role:
                        self.id_role[(sid, f)] = {"role": "ref", "target": t, "grade": "model",
                                                  "why": "Jev: 다른 대상을 잇는 부분 필드" + ("" if t else " (대상 모름)")}
                det = "relation:" + "x".join(sorted(tg)) if all(not x.startswith("?") for x in tg) else                     "relation:" + "x".join(sorted(tg)) + "@" + sid.split(":")[-1]
                props_cache.pop(sid, None)
                props = get_props(sid)
                for rel, s_, name, kd, tgt in props:
                    add(det, rel, s_, name, kd, tgt, op, "relation_model")
                self.verify["model_relation"]["placed"] += 1
                return "relation_model"
            if not sp and sid in self.catalog_shapes and via in ("response", "list_element"):
                for rel, s_, name, kd, tgt in props:
                    add("catalog:record:" + self.shapes[sid]["src"]["source"], rel, s_, name, kd, tgt, op, "catalog_record")
                return "catalog_record"
            if sp:
                det = "space:" + sp
                kind_via = via
            elif sid in self.local_shapes:
                # 부모 안 레코드 (Slack 메시지 ts): 결정자는 (부모 공간, 형식). 부모는 바깥 레코드의 공간, 없으면 동작 맥락
                det, kind_via = "local:%s/%s" % (parent or ctx_space or "unknown", self.local_shapes[sid].split(":")[-1]), "local"
            else:
                # relation 근거는 레코드 바로 아래 자리만 (펼친 박힌 객체 안의 링크는 세지 않는다, 루프 2)
                # 루프 12: URL 참조는 빼고(자기 URL 일 수 있다), 대상이 하나로 정해진 자리만 센다(다형 참조 하나를 둘로 세지 않는다)
                tg = sorted({(t[0] if isinstance(t, list) else t) for rel, _, _, kd, t in props if "." not in rel
                             and kd in ("embedded_ref", "ref", "address_key") and t and (not isinstance(t, list) or len(t) == 1)})
                lctx = self._list_ctx if via in ("list_element", "response") else None
                if len(tg) >= 2:
                    det, kind_via = "relation:" + "x".join(tg[:3]), "relation"
                elif len(tg) == 1 and lctx and lctx not in tg:
                    # 부모 아래 목록의 원소가 다른 공간 하나를 가리키면 부모와 그 공간의 연결이다 (R1, 고아 수정 2, 2026-10-18:
                    # Okta /devices/{id}/users 의 원소는 장치 x 사용자, GitHub 설치 저장소 목록은 설치 x 저장소)
                    det, kind_via = "relation:" + "x".join(sorted([lctx] + tg)), "relation_list_parent"
                    self.verify["list_parent_relation"]["placed"] += 1
                elif ctx_space:
                    det, kind_via = "space:" + ctx_space, "path_context"
                else:
                    o = self.ops.get(op) if op else None
                    why = ("catalog" if via.startswith("catalog") else "rpc_no_position" if o and not o.get("path")
                           else "no_position" if o and not o["path"]["positions"] else "position_not_space")
                    det, kind_via = "orphan:" + sid, "orphan_" + why
            wrapper_like = any(pr.get("shape") and (self.shapes.get(pr["shape"]) or {}).get("kind") == "array"
                               and self.obj(pr["shape"]) for pr in self.shapes[sid].get("props") or [])
            # 레코드 하나를 싸는 봉투도 같다 (고아 수정 1, 2026-10-18: Slack team.info 의 {ok, team}, bots.info 의 {ok, bot})
            wrapper_like = wrapper_like or any(any(self.shape_space.get(x) for x in self.obj(pr.get("shape") or ""))
                                               for pr in self.shapes[sid].get("props") or [])
            const = self.env_const.get(self.shapes[sid]["src"]["source"], set()) if via == "response" and not sp else set()
            if const:
                keep = []
                for x in props:
                    if x[0] in const:
                        add("envelope:" + self.shapes[sid]["src"]["source"], x[0], x[1], x[2], x[3], x[4], op, "envelope")
                        self.verify["response_envelope"]["status_slots"] += 1
                    else:
                        keep.append(x)
                props = keep
            if via in ("response", "list_element") and not sp and sid not in self.local_shapes and wrapper_like:
                env = self.env_names.get(self.shapes[sid]["src"]["source"], set())
                keep = []
                for x in props:
                    if x[0].split(".")[0] in env:
                        add("envelope:" + self.shapes[sid]["src"]["source"], x[0], x[1], x[2], x[3], x[4], op, "envelope")
                        self.verify["response_envelope"]["slots"] += 1
                    else:
                        keep.append(x)
                props = keep
            for rel, s, name, kd, tgt in props:
                if kd == "navigation_unspaced":
                    self.verify["navigation_unspaced"]["slots"] += 1
                if kd == "embedded_ref":
                    for t in tgt:
                        if det.startswith("space:") and t != det[6:]:
                            refs[(det[6:], t)] += 1
                    # 박힌 레코드 자신의 속성은 그 공간에 놓는다 (같은 동작 안에서 한 번)
                    sub = next((pr.get("shape") for pr in self.shapes[s].get("props") or [] if pr["name"] == name), None)
                    for o2 in self.obj(sub):
                        if self.shape_space.get(o2) and (op, o2) not in placed:
                            placed.add((op, o2))
                            place(o2, op, None, "embedded")
                elif kd == "embedded_relation":
                    for o2 in tgt:
                        if (op, o2, "rel") not in placed:
                            placed.add((op, o2, "rel"))
                            place(o2, op, ctx_space, "embedded_relation")
                elif kd == "embedded_local":
                    sub = next((pr.get("shape") for pr in self.shapes[s].get("props") or [] if pr["name"] == name), None)
                    par = det[6:] if det.startswith("space:") else (det.split(":", 1)[1].split("/")[0] if det.startswith("local:") else ctx_space)
                    for o2 in self.obj(sub):
                        if o2 in self.local_shapes and (op, o2, par) not in placed:
                            placed.add((op, o2, par))
                            place(o2, op, ctx_space, "embedded_local", parent=par)
                add(det, rel, s, name, kd, tgt, op, kind_via)
            return kind_via

        seen = set()
        self._list_ctx = None
        # 응답 봉투 (루프 10): 원소가 공간 레코드로 확인된 래퍼 응답에서 배열 옆 자리 이름을 출처별로 배운다
        self.env_names = collections.defaultdict(set)
        env_ev = collections.defaultdict(set)
        for oid, o in sorted(self.ops.items()):
            r = self.resp(o)
            for root in self.obj(r) if r else []:
                if self.shape_space.get(root) or root in self.local_shapes:
                    continue
                props = self.shapes[root].get("props") or []
                arr_spaced = [pr for pr in props if pr.get("shape") and (self.shapes.get(pr["shape"]) or {}).get("kind") == "array"
                              and any(self.shape_space.get(x) for x in self.obj(pr["shape"]))]
                # 레코드 하나를 싸는 봉투: 공간 레코드인 객체 속성이 하나이고 배열 래퍼가 아닐 때 (고아 수정 1)
                obj_spaced = [pr for pr in props if pr.get("shape") and (self.shapes.get(pr["shape"]) or {}).get("kind") == "object"
                              and self.shape_space.get(pr["shape"])]
                if not arr_spaced and len(obj_spaced) == 1:
                    arr_spaced = obj_spaced
                if len(arr_spaced) == 1:
                    el_sp = tuple(sorted({self.shape_space.get(x) for x in self.obj(arr_spaced[0]["shape"])} - {None}))
                    for pr in props:
                        if pr is arr_spaced[0]:
                            continue
                        sub = self.shapes.get(pr.get("shape") or "") or {}
                        if pr.get("scalar") is not None or (sub.get("kind") == "object" and not self.shape_space.get(sub["id"])):
                            env_ev[(self.shapes[root]["src"]["source"], pr["name"])].add((root, el_sp))
        # 대상과 무관하게 되풀이되는 이름만: 래퍼 뿌리 3개 이상, 원소 공간 2개 이상 (루프 10)
        for (src, name), ev in sorted(env_ev.items()):
            if len({r for r, _ in ev}) >= 3 and len({e for _, e in ev}) >= 2:
                self.env_names[src].add(name)
        # 응답 상태 자리 (고아 수정 1, 2026-10-18): 같은 출처의 응답 뿌리 10개 이상에 나오는 불리언 뿌리 자리는 레코드의 정보가
        # 아니라 응답 상태다 (Slack ok). 이름이 아니라 「여러 동작의 응답 뿌리에 되풀이되는 불리언」으로 정한다. 래퍼가 아닌 응답
        # (쓰기 동작의 {ok})에도 쓴다. 문자열은 넣지 않는다: 문서 예시의 자리 표시(C123ABC456)가 값이 늘 같은 것처럼 보인다
        cv = collections.defaultdict(lambda: (set(), set()))
        for ins in self.insts:
            o_ = self.ops.get((ins.get("of") or {}).get("operation", ""))
            if not o_ or not self.resp(o_) or ins["grade"] not in ("observed", "example") or not isinstance(ins["value"], dict):
                continue
            for root in self.obj(self.resp(o_)):
                props_ = {pr["name"] for pr in self.shapes[root].get("props") or [] if pr.get("scalar") is not None}
                for k_, v_ in ins["value"].items():
                    if k_ in props_ and isinstance(v_, bool):
                        rs_, vs_ = cv[(self.shapes[root]["src"]["source"], k_)]
                        rs_.add(root)
                        vs_.add(json.dumps(v_))
        # 그 출처 응답 뿌리의 30% 이상에 나와야 한다 (GitHub enabled 는 설정 15곳에만 있어 상태가 아니라 정보다)
        roots_by_src = collections.defaultdict(set)
        for o_ in self.ops.values():
            for root in self.obj(self.resp(o_) or ""):
                roots_by_src[self.shapes[root]["src"]["source"]].add(root)
        self.env_const = collections.defaultdict(set)
        for (src, name), (rs_, vs_) in sorted(cv.items()):
            if len(rs_) >= 10 and len(rs_) * 10 >= 3 * len(roots_by_src[src]):
                self.env_const[src].add(name)
                self.verify["response_status_field"][src + "." + name] = len(rs_)
        for oid, o in sorted(self.ops.items()):
            r = self.resp(o)
            if not r:
                continue
            ctx = None
            if o.get("path") and o["path"]["positions"]:
                last = o["path"]["positions"][-1]
                ctx = self.pos_space.get(pos_of(o["path"]["template"], last["index"]))
            elif not o.get("path"):
                ctx = self.rpc_context(oid, o)
            roots = self.obj(r)
            els = self.element(r) if o["kind"] == "read_many" else []
            # 목록 래퍼로 볼 근거: 원소가 공간에 속하고 뿌리는 공간이 아니다. 아니면 뿌리를 그대로 놓는다 (루프 5, GET /user)
            if els and (not any(self.shape_space.get(e) for e in els) or any(self.shape_space.get(x) for x in roots)):
                els = []
            # 원소가 이벤트 기록 레코드인 래퍼도 목록이다 (고아 수정 4: Slack audit.logs 의 entries, 동작 종류와 무관)
            cel = [e for e in self.element(r) if e in self.catalog_shapes] if r else []
            if not els and cel and not any(self.shape_space.get(x) for x in roots):
                els = cel
            for sid in roots:
                if els and sid not in els:
                    # 목록 래퍼 뿌리: 배열 옆 값은 응답 메타
                    for pr in self.shapes[sid].get("props") or []:
                        if pr.get("scalar") is not None:
                            orphan_items["response_meta"] += 1
                    self._list_ctx = ctx                    # 목록의 부모 맥락 (relation 판정에만 쓴다)
                    for e in els:
                        v = place(e, oid, None, "list_element")
                        orphans[v] += 1
                    self._list_ctx = None
                    continue
                self._list_ctx = ctx if o["kind"] == "read_many" else None
                v = place(sid, oid, ctx if o["kind"] != "read_many" else None, "response")
                self._list_ctx = None
                orphans[v] += 1
                seen.add(sid)
        for c in self.cats:
            if c.get("payload"):
                det = "catalog:%s:%s" % (c["catalog"], c["src"]["source"])
                for rel, s_, name, kd, tgt in get_props(c["payload"]):
                    if kd == "navigation_unspaced":
                        self.verify["navigation_unspaced"]["slots"] += 1
                    add(det, rel, s_, name, kd, tgt, None, "catalog")
                    items["%s|%s" % (det, rel)].setdefault("entries", set()).add(c["key"] or c["display"] or c["id"])
                orphans["catalog_event_record"] += 1
        # 원문이 명시한 연결 레코드 경로를 부모 관계로 투영한다. 일반적인 경로 전이 추론은 하지 않는다.
        for rule in self.source_projections:
            source = self.shape_space.get(rule["shape"])
            if not source:
                continue
            for sid, name in rule["slots"]:
                add("space:" + source, rule["path"], sid, name, "ref", rule["target"], None, "source_projection")
            item = items["space:%s|%s" % (source, rule["path"])]
            ev = {k: rule["evidence"][k] for k in ("source", "locator")}
            if ev not in item.setdefault("source_evidence", []):
                item["source_evidence"].append(ev)
            if rule.get("when"):
                case = {"when": rule["when"], "target": rule["target"]}
                if case not in item.setdefault("cases", []):
                    item["cases"].append(case)
            self.verify["source_references"]["projections"] += 1
        # 참조 간선: 박힌 레코드 말고 ID 자리(원문 참조, URL, 공출현)도 센다
        for it in items.values():
            if it["kind"] in ("ref", "ref_url", "address_key") and it["det"].startswith("space:"):
                for t in (it["target"] if isinstance(it["target"], list) else [it["target"]]):
                    stated_self = any((self.id_role.get(slot) or {}).get("allow_self_reference") for slot in it["slots"])
                    if t and (t != it["det"][6:] or stated_self):
                        refs[(it["det"][6:], t)] += 1
        self.items, self.refs = items, refs
        # 오브젝트 후보 (루프 17): 원문 키만 있는 공간(GraphQL 타입, JWK 모양)은 REST/RPC 동작 응답에 나오거나
        # 다른 후보 공간이 참조할 때만 후보다. 그 밖의 공간은 위치나 값 근거가 있어 후보다
        nongql = {oid for oid, o in self.ops.items() if o.get("surface") != "graphql"}
        reached = {it["det"][6:] for it in items.values() if it["det"].startswith("space:") and it["read_by"] & nongql}
        cand = {s["name"] for s in self.space.values() if s["form"] != "key_only"} | {n for n in reached}
        for (a, b), n in refs.items():
            if a in cand and b not in cand and a not in {x["name"] for x in self.space.values() if x["form"] == "key_only"}:
                cand.add(b)
        self.composite_credentials(cand)
        # D4 (2026-10-18): GraphQL Node 타입(원문 키 ID! + Node)은 같은 대상의 REST 공간이 없으면 후보다.
        # 같은 대상의 근거는 REST 예시의 node_id 해독이다. 옛 형식 node_id 는 base64("<타입 이름 길이>:<타입 이름><번호>")라
        # 길이로 타입 이름을 자른다 (이름 비교가 아니라 원문 형식 해독). 새 형식(U_kgDO...)은 해독표가 없어 쓰지 않는다
        gql_space = {}
        for sid, sh in self.shapes.items():
            if sh["src"]["source"].startswith("gh_graphql") and sh.get("name") and self.shape_space.get(sid):
                gql_space[sh["name"]] = self.shape_space[sid]
        self.node_equiv = collections.defaultdict(set)     # GraphQL 공간 -> 같은 대상 REST 공간
        if gql_space:
            for ins in self.insts:
                o = self.ops.get((ins.get("of") or {}).get("operation"))
                if not o or o.get("surface") == "graphql" or not self.resp(o):
                    continue
                for sid, name, v, _ in self.walk(ins["value"], self.resp(o)):
                    if name != "node_id" or not self.shape_space.get(sid):
                        continue
                    t = decode_node_id(v)
                    if t in gql_space and gql_space[t] != self.shape_space[sid]:
                        self.node_equiv[gql_space[t]].add(self.shape_space[sid])
        gql_names = set(gql_space.values())
        for s in self.space.values():
            if s["form"] == "key_only" and s["name"] in gql_names and s["name"] not in cand and not self.node_equiv.get(s["name"]):
                cand.add(s["name"])
                s["candidate_why"] = "GraphQL Node 타입, 같은 대상의 REST 공간 근거 없음 (D4)"
        # D5 (2026-10-18): 부모 안 레코드가 부모와 마지막 키 대상의 연결이면 (Jev model is_link 0.8 이상) 부모 안 공간은
        # relation 이고 후보가 아니다. 마지막 키의 대상을 따로 세운다. 세운 대상과 기존 공간의 같음은 2단계에서 본다
        jl = os.path.join(HERE, "out2", self.p, "map", "jev_locals.json")
        by_name = {sp["name"]: sp for sp in self.space.values()}
        self.promoted = []
        jk = os.path.join(HERE, "out2", self.p, "map", "jev_localkey.json")
        keyrole = {r["space"]: r for r in json.load(io.open(jk, encoding="utf-8"))} if os.path.exists(jk) else {}
        if os.path.exists(jl):
            for r in json.load(io.open(jl, encoding="utf-8")):
                sp = by_name.get(r["space"])
                kr = keyrole.get(r["space"]) or {}
                if not sp or sp["form"] != "local" or (r.get("is_link") or 0) < 0.8:
                    continue
                stated = next((rule for rule in self.source_facts.get("promotion_rules", [])
                               if (rule["space"], rule["param"]) == (r["space"], r["key_param"])), None)
                if stated and stated["action"] in ("self_key", "enum"):
                    # A path alias of this record, or an enum dimension, does not
                    # become a new object merely because a model voted for D5.
                    sp["promotion_rejected"] = stated
                    continue
                # 연결 레코드의 마지막 키가 연결된 상대의 id 일 때만 (0.8 이상). 연결 레코드 자신의 id(membershipId,
                # roleAssignmentId)면 id 가 있는 연결 레코드라 부모 안 공간으로 둔다. 독립성 진술은 갈리지 않아 쓰지 않는다
                if (kr.get("p_entity") or 0) < 0.8:
                    sp["link_record"] = {"grade": "model", "evidence": "Jev %s: 연결 %.2f, 키가 상대 id %.2f" % (
                        r["model"], r["is_link"], kr.get("p_entity") or 0)}
                    continue
                sp["independent_key"] = {"param": r["key_param"], "grade": "model",
                                         "evidence": "Jev %s: 연결 %.2f, 키가 상대 id %.2f" % (r["model"], r["is_link"], kr["p_entity"])}
                if True:
                    pname = "%s.%s" % (sp["name"], r["key_param"])
                    sp["relation_of"] = sp["parent_positions"] + [pname]
                    cand.discard(sp["name"])
                    sp["not_candidate_why_d5"] = "부모와 %s 대상의 연결 레코드 (D5)" % r["key_param"]
                    self.space["promoted:" + pname] = {
                        "name": pname, "item_positions": [], "shapes": [], "stated_key_shapes": [], "positions": [],
                        "form": "promoted_key", "parent_positions": [], "promoted_from": sp["name"],
                        "candidate_why": "부모 안 키 %s 가 부모 밖에서도 같은 대상 (D5, Jev model)" % r["key_param"]}
                    if stated and stated["action"] == "same_entity":
                        target = self.shape_space.get(stated["target_shape"])
                        if not target:
                            raise ValueError("승격 참조의 원문 대상 공간이 없다")
                        self.space["promoted:" + pname]["stated_target"] = dict(
                            target=target, key_kind=stated["key_kind"], evidence=stated["evidence"])
                    if stated and stated["action"] == "external_locator":
                        self.space["promoted:" + pname]["external_locator"] = dict(
                            locator_kind=stated["locator_kind"], evidence=stated["evidence"])
                    cand.add(pname)
                    self.promoted.append(pname)
        for s in self.space.values():
            s["object_candidate"] = s["name"] in cand
            if self.node_equiv.get(s["name"]):
                s["same_as"] = sorted(self.node_equiv[s["name"]])
            if not s["object_candidate"]:
                s["not_candidate_why"] = s.pop("not_candidate_why_d5", None) or ("REST 공간 %s 와 같은 대상 (node_id 해독)" % ", ".join(s["same_as"]) if s.get("same_as") else
                                          "원문 키만 있고 REST/RPC 응답이나 후보 공간의 참조로 닿지 않는다")
        self.orphan_stats = {"roots_by_placement": dict(orphans), "response_meta_fields": orphan_items["response_meta"]}

    def composite_credentials(self, cand):
        """R2a (2026-10-18): 자격증명 값을 담은 자리는 키가 ID 조합이어도 복합키 오브젝트다.

        기준은 aegi-schema Interface_Spec_v3 「항상 감추는 값」: 필드 이름(MATERIAL_NAMES)과 값 모양(xox 토큰, Slack 웹훅 주소).
        이름 규칙과 값 규칙을 따로 세어 서로 대조한다 (verify.credential_material). 값을 담은 레코드가 자기 id 를 가진 공간의
        단건 응답이면(R0) 그 공간이 곧 자격증명이라 세우지 않는다 (Okta ApiToken). 아니면 자리마다 오브젝트 하나:
        키 = 위쪽 레코드들과 담은 레코드가 가리키는 공간들, 인증 대상(R2b) = 담은 레코드가 직접 가리키는 공간들.
        """
        vals = collections.defaultdict(set)
        for ins in self.insts:
            o = self.ops.get((ins.get("of") or {}).get("operation", ""))
            if o and self.resp(o):
                for s_, n_, v, _ in self.walk(ins["value"], self.resp(o)):
                    if len(vals[(s_, n_)]) < 5:
                        vals[(s_, n_)].add(v)
        own = {}
        for sp in self.space.values():
            for sh_ in self.returned_by_item(sp["item_positions"]):
                own[sh_] = sp["name"]
        # 원문(allOf, 키 선언)이나 변환 근거(왕복)로 단건 위치가 있는 공간에 합쳐진 모양도 그 오브젝트다. 예시 값 쌍, 지문만으로
        # 합쳐진 모양은 아니다 (GitHub 앱 매니페스트 변환 응답은 integration 의 allOf, Okta 통합 비밀값은 목록 왕복)
        positioned = {sp["name"] for sp in self.space.values() if sp.get("item_positions")}
        strong = {}
        for e in self.edges:
            if e.get("joined") and e["grade"] in ("stated", "transform"):
                for x in (e["a"], e["b"]):
                    if x.startswith("sh:") and self.shape_space.get(x[3:]) in positioned:
                        strong[x[3:]] = self.shape_space[x[3:]]

        # Jev 판정(model): 문서 예시 값이 없거나 자리 표시라 형식으로 못 정한 필드의 대상 공간 (jev_judge keyfields)
        jk = os.path.join(HERE, "out2", self.p, "map", "jev_keyfields.json")
        jev_t = {}
        if os.path.exists(jk):
            for r in json.load(io.open(jk, encoding="utf-8")):
                if r.get("choice") not in (None, "none") and (r.get("p") or 0) >= 0.7:
                    jev_t[(r["shape"], r["prop"])] = r["choice"]
        self.key_unresolved = []

        def holds_material(sid):
            return any(pr["name"] in MATERIAL_NAMES for x in self.obj(sid) for pr in (self.shapes.get(x) or {}).get("props") or [])

        def fields_of(sid, collect=False, where=""):
            """레코드가 가리키는 자리들 -> [(자리 경로, 대상 공간, 근거)]. 자격증명 값을 직접 담은 박힌 레코드는 다른 자격증명의
            자리라 넣지 않는다 (Slack oauth.v2.access 의 authed_user 는 사용자 토큰의 자리, 봇 토큰의 키가 아니다)"""
            out = []
            for pr in (self.shapes.get(sid) or {}).get("props") or []:
                r = self.id_role.get((sid, pr["name"]))
                f = (where + "." + pr["name"]).lstrip(".")
                if r and r["role"] in ("ref", "self_key") and isinstance(r.get("target"), str):
                    # 자기 키도 넣는다: 담은 레코드가 무엇의 레코드인지 (Slack apps.manifest.create 의 app_id)
                    out.append((f, r["target"], "%s, %s" % (r["grade"], r["why"][:70])))
                elif (sid, pr["name"]) in jev_t:
                    out.append((f, jev_t[(sid, pr["name"])], "model, Jev 필드 대상 판정"))
                elif collect and pr.get("scalar") == "string" and pr["name"] not in MATERIAL_NAMES:
                    self.key_unresolved.append((sid, pr["name"]))
                for x in self.obj(pr.get("shape") or ""):
                    if self.shape_space.get(x) and not holds_material(x):
                        out.append((f, self.shape_space[x], "박힌 레코드가 이 공간에 속한다"))
            return out

        found = {}
        self.material_in = {}

        def walk(sid, chain, path, op, depth=0):
            sh = self.shapes.get(sid) or {}
            if depth > 6 or not sh:
                return
            if sh["kind"] in ("array", "union"):
                for x in ([(sh.get("items") or {}).get("shape")] if sh["kind"] == "array" else sh.get("alts") or []):
                    walk(x, chain, path + ("[*]" if sh["kind"] == "array" else ""), op, depth + 1)
                return
            if sh["kind"] != "object":
                return
            for pr in sh.get("props") or []:
                n = pr["name"]
                if pr.get("shape") and (self.shapes.get(pr["shape"]) or {}).get("kind") in ("object", "array", "union"):
                    walk(pr["shape"], chain + [sid], path + "." + n, op, depth + 1)
                    continue
                by_name = n in MATERIAL_NAMES
                vs = vals.get((sid, n), set())
                by_value = any(MATERIAL_VALUE.search(v) for v in vs)
                if not (by_name or by_value):
                    continue
                self.verify["credential_material"]["name_and_value" if by_name and by_value else
                                                   "name_only" if by_name else "value_only"] += 1
                # 값을 담은 레코드나 그 위 레코드가 자기 id 공간이면(R0) 그 오브젝트의 자격증명 자재다. 새로 세우지 않고 표시만 한다
                # (Okta IdP 의 protocol.credentials.client.client_secret 은 IdP 오브젝트의 것. 3단계에서 Credential interface 후보)
                # 단건 위치가 돌려주는 모양만 본다. 공간에 속하기만 한 모양은 안 된다 (Slack authed_user 는 값 쌍으로 사용자 공간에
                # 들어갔지만 사용자 토큰은 사용자가 아니다)
                holder = next((own.get(c) or strong.get(c) for c in reversed(chain + [sid]) if own.get(c) or strong.get(c)), None)
                if holder:
                    self.verify["credential_material"]["in_own_space"] += 1
                    self.material_in.setdefault(holder, set()).add("%s%s.%s" % (op["name"], path, n))
                    continue
                kf = []
                for x in (op.get("path") or {}).get("positions") or []:
                    t_ = self.pos_space.get(pos_of(op["path"]["template"], x["index"]))
                    if t_:
                        kf.append(("경로 {%s}" % x["param"], t_, "동작 경로의 위치"))
                segs_ = path.strip(".").split(".") if path.strip(".") else []
                near = fields_of(sid, collect=True, where=path.strip("."))   # 값을 담은 레코드의 자리
                near_sp = {t_ for _, t_, _ in near}
                for i_, c in enumerate(chain):
                    # 위 레코드의 자리는 맥락이다. 같은 공간을 가리키는 자리가 담은 레코드에 있으면 가까운 쪽만 쓴다
                    # (사용자 토큰의 키는 authed_user.id 이고 위 레코드의 bot_user_id 가 아니다)
                    kf += [z for z in fields_of(c, collect=True, where=".".join(segs_[:i_])) if z[1] not in near_sp]
                kf += near
                kf = sorted(set(kf))
                key = sorted({t_ for _, t_, _ in kf})
                auth = sorted(near_sp)
                key_ev = [{"field": f_, "space": t_, "why": w_} for f_, t_, w_ in kf]
                nm = "%s%s.%s" % (op["name"], path, n)
                found.setdefault(nm, {"name": nm, "item_positions": [], "shapes": [], "stated_key_shapes": [], "positions": [],
                                      "form": "composite_key", "parent_positions": [], "key_parts": key, "key_fields": key_ev,
                                      "authenticates": auth, "material": {"shape": sid, "prop": n, "path": (path + "." + n).lstrip(".")},
                                      "token_prefixes": sorted({m_.group(1) for m_ in (TOKEN_PREFIX.match(v) for v in vs) if m_}),
                                      "grade": "stated" if by_name else "example", "rule": "name" if not by_value else
                                      ("name+value" if by_name else "value"), "operations": [],
                                      "candidate_why": "자격증명 값을 담은 자리 (R2a, aegi-schema 항상 감추는 값)"})
                if op["id"] not in found[nm]["operations"]:
                    found[nm]["operations"].append(op["id"])
        for oid, o in sorted(self.ops.items()):
            r = self.resp(o)
            if r:
                walk(r, [], "", o)
        for sp in self.space.values():
            if sp["name"] in self.material_in:
                sp["credential_material"] = sorted(self.material_in[sp["name"]])[:10]
        for nm, sp in sorted(found.items()):
            sp["operations"] = sorted(sp["operations"])[:6]
            self.space["composite:" + nm] = sp
            cand.add(nm)
        self.verify["credential_material"]["objects"] = len(found)
        self.key_unresolved = sorted(set(self.key_unresolved))

    # ------------------------------------------------------------------ 검증과 출력
    def check(self):
        # 같은 모양 지문 간선: 다른 근거(왕복)로도 같은 동치류인가, 약한 합치기로 막혔나
        for e in self.edges:
            if e["why"].startswith("같은 모양 지문"):
                self.verify["shape_fingerprint"]["uses"] += 1
                if not e.get("joined"):
                    self.verify["shape_fingerprint"]["refused_by_positions"] += 1
                else:
                    a_sp, b_sp = self.shape_space.get(e["a"][3:]), self.shape_space.get(e["b"][3:])
                    if a_sp and b_sp and a_sp == b_sp:
                        self.verify["shape_fingerprint"]["joined"] += 1
        for k, it in self.items.items():
            if it["det"].startswith("orphan:"):
                pass
        # 중복 후보 (루프 15): 약한 근거는 같은 대상이라는데 반대 근거(각자 단건 위치, 원문 키)에 막혀 두 공간으로 남은 쌍.
        # 판정하지 않고 모아 둔다. 실측 값 왕복(한 위치에 넣은 값이 다른 위치의 레코드 값과 같은지)으로 닫는다
        def sp_of(x):
            return self.shape_space.get(x[3:]) if x.startswith("sh:") else self.pos_space.get(x[4:])
        dup = collections.defaultdict(lambda: {"edges": 0, "why": collections.Counter()})
        for e in self.edges:
            # 정체성을 말하는 근거만 (생성, 수정 응답은 작업 상태일 수 있고, 원소가 여럿인 목록 경로는 이미 컬렉션이 아니다)
            if e.get("joined") is False and not e["why"].startswith(("수정 왕복", "생성 왕복")) and "원소 모양" not in e["why"]:
                a, b = sp_of(e["a"]), sp_of(e["b"])
                if a and b and a != b:
                    d = dup[tuple(sorted((a, b)))]
                    d["edges"] += 1
                    d["why"][e["why"][:80]] += 1
        by_name = {v["name"]: v for v in self.space.values()}
        self.duplicates = [{"spaces": list(k), "edges": v["edges"], "why": v["why"].most_common(3),
                            "positions": [by_name.get(x, {}).get("item_positions", [])[:3] for x in k]}
                           for k, v in sorted(dup.items(), key=lambda x: (-x[1]["edges"], x[0]))]
        for d in self.duplicates:
            self.issue("duplicate_space_candidate", {"spaces": d["spaces"]}, "collect", "instance",
                       "약한 근거는 같은 대상이라는데 반대 근거에 막혔다. 한 위치의 값이 다른 위치 레코드의 값과 같은지 실측으로 확인",
                       {"edges": d["edges"], "positions": d["positions"]})
        unknown = [k for k, v in self.id_role.items() if v["role"] != "property" and not v.get("target")]
        for k in unknown[:2000]:
            self.issue("id_target_unknown", {"shape": k[0], "prop": k[1]}, "collect", "instance",
                       "ID 근거는 있지만 가리키는 공간을 못 정했다", {"why": self.id_role[k]["why"]})

    def dump(self):
        out = os.path.join(HERE, "out2", self.p, "map")
        os.makedirs(out, exist_ok=True)
        dets = collections.Counter(it["det"].split(":", 1)[0] for it in self.items.values())
        kinds = collections.Counter(it["kind"] for it in self.items.values())
        roles = collections.Counter(v["role"] for v in self.id_role.values())
        role_grade = collections.Counter("%s/%s" % (v["role"], v["grade"]) for v in self.id_role.values())
        metrics = {
            "provider": self.p,
            "spaces": len(self.space), "space_forms": dict(collections.Counter(s["form"] for s in self.space.values())),
            "items": len(self.items), "items_by_determinant": dict(dets), "items_by_kind": dict(kinds),
            "id_roles": dict(roles), "id_role_grades": dict(role_grade),
            "refs": len(self.refs), "edges": dict(collections.Counter((e["grade"], e["weak"], e.get("joined")) .__str__() for e in self.edges)),
            "orphans": self.orphan_stats, "verify": {k: dict(v) for k, v in self.verify.items()},
            "duplicate_candidates": len(self.duplicates),
            "object_candidates": sum(1 for s in self.space.values() if s.get("object_candidate")),
            "issues": dict(collections.Counter(i["kind"] for i in self.issues)),
        }
        spaces = {s["name"]: s for s in self.space.values()}
        items = [{"key": k, "det": v["det"], "rel": v["rel"], "kind": v["kind"], "target": v["target"],
                  "read_by": sorted(v["read_by"])[:20], "n_read_by": len(v["read_by"]), "via": sorted(v["via"]),
                  "slots": sorted(v["slots"])[:10], "entries": sorted(v.get("entries", ()))[:20],
                  "n_entries": len(v.get("entries", ())),
                  **({"cases": sorted(v["cases"], key=lambda c: json.dumps(c, sort_keys=True))} if v.get("cases") else {}),
                  **({"source_evidence": sorted(v["source_evidence"], key=lambda e: (e["source"], e["locator"]))}
                     if v.get("source_evidence") else {})}
                 for k, v in sorted(self.items.items())]
        with io.open(os.path.join(out, "metrics.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(metrics, f, ensure_ascii=False, indent=1, sort_keys=True)
        with io.open(os.path.join(out, "info_map.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump({"spaces": spaces, "items": items, "refs": [[a, b, n] for (a, b), n in sorted(self.refs.items())],
                       "id_roles": [[k[0], k[1], v] for k, v in sorted(self.id_role.items())],
                       "duplicate_candidates": self.duplicates,
                       "format_twins": [dict(t, space=self.shape_space.get(t["shape"]),
                                             format_space=self.idf_space.get(t["id_format"])) for t in self.format_twins]},
                      f, ensure_ascii=False, indent=1,
                      sort_keys=True)
        with io.open(os.path.join(out, "issues.jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for i in self.issues:
                f.write(json.dumps(i, ensure_ascii=False, sort_keys=True) + "\n")
        return metrics

    def run(self):
        self.build_edges()
        self.spaces()
        self.ids()
        self.mapping()
        self.check()
        return self.dump()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for p in sys.argv[1:] or ["github"]:
        m = Map3(p).run()
        print(json.dumps(m, ensure_ascii=False))
