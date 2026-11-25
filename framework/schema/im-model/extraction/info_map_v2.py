# -*- coding: utf-8 -*-
"""정보 지도 v2: 근거 간선과 동치류로 ID 공간을 만든다 (「ID 공간 설계.md」 1부, 2부의 일부. 2026-10-14).

    python info_map_v2.py okta      # out/<provider>/ir/ 를 읽어 out/<provider>/info_map_v2.json, info_map_v2.html

v1(info_map.py, extract.py)과 다른 점
- 공간은 이름으로 만들지 않는다. 꼭짓점은 「경로 위치」(정규화한 경로 틀의 n번째 파라미터까지)와 「스키마의 키 자리」다
- 간선은 근거가 있을 때만 긋고 등급을 단다
    명시: 같은 스키마(키 자리는 스키마마다 하나의 꼭짓점), 한 응답 자리의 다형 대안(oneOf)
    구조: 단건 조회 왕복(GET …/{p} 가 스키마 S 를 돌려준다 -> p = S 의 키), 목록 왕복(GET c 의 원소 S -> c/{p} = S 의 키),
          구조 지문 정확히 같음(이름 없는 인라인 객체 = 속성 집합이 같은 이름 있는 스키마)
    사전: lexicons/<provider>.yaml 의 param_space(경로 파라미터 이름 -> 공간 이름). 충돌 검사를 통과할 때만 합친다
    예시: 문자열 참조 필드의 예시 값이 한 스키마의 키 예시 값과 같다(희귀 값만). 공간을 합치지 않고 참조 후보로만 쓴다
- 이름 변형(단수화, 접사 떼기, 꼬리 일치)과 다른 명명 체계끼리의 이름 맞추기는 결정에 쓰지 않는다
  공간의 대표 이름을 고를 때만 경로 단어를 쓴다
- 키는 스키마의 `id` 필드다(관례, 사전 record_key_fields). 키가 없는 객체는 공간이 아니라 속성 묶음이다
- 감사 action 은 category 별칭(사전)으로 공간까지만 잇는다. 항목 연결은 문서 근거가 없어(설계 G6) 하지 않는다
- 필터(인자 이름 = 응답 필드 이름)는 이름 비교라 결정하지 않고 후보 수만 센다
"""
import base64
import collections
import io
import json
import os
import re
import sys

import yaml

from extract import Extractor

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"_links", "_embedded"}


def load(p, name):
    path = os.path.join(HERE, "out", p, "ir", name)
    return [json.loads(l) for l in io.open(path, encoding="utf-8")] if os.path.exists(path) else []


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
        return ra


def node_id_tag(v):
    """GitHub node_id 해독 (2부 V2). 값이 스스로 GraphQL 타입을 말한다. 이름 비교가 아니라 값의 형식만 본다.
    옛 형식: base64("<타입 이름 길이>:<타입 이름><DB id>") 예 MDQ6VXNlcjE= -> 04:User1 -> ("User", "1")
    새 형식: "<타입 접두사>_<base64url msgpack>" 예 U_kgDOAAAAAQ -> ("U_", None). 접두사가 무엇의 약자인지는 쓰지 않는다"""
    v = str(v)
    m = re.match(r"^([A-Z][A-Za-z]{0,7})_[A-Za-z0-9_-]{4,}$", v)
    if m:
        return m.group(1) + "_", None
    if not re.match(r"^[A-Za-z0-9+/]{8,}={0,2}$", v):
        return None
    try:
        d = base64.b64decode(v + "=" * (-len(v) % 4), validate=True).decode("ascii")
    except (ValueError, UnicodeDecodeError):
        return None
    m = re.match(r"^(\d{2,3}):(.*)$", d)
    if not m:
        return None
    n, rest = int(m.group(1)), m.group(2)
    t, dbid = rest[:n], rest[n:]
    if len(t) != n or not re.match(r"^[A-Z][A-Za-z]*$", t) or not re.match(r"^\d*$", dbid):
        return None
    return t, dbid or None


class Map2:
    def __init__(self, p):
        self.p = p
        self.lex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", "common.yaml"), encoding="utf-8"))
        self.plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", p + ".yaml"), encoding="utf-8"))
        self.ops = {o["op_id"]: o for o in load(p, "operations.jsonl")}
        self.fields = load(p, "fields.jsonl")
        self.events = load(p, "events.jsonl")
        self.keys = self.plex.get("record_key_fields", ["id"])
        self.nid_field = self.plex.get("node_id_field")              # GitHub: node_id (값이 GraphQL 타입을 말한다)
        self.nid_mismatch = collections.Counter()
        self.local_keys = self.plex.get("local_key_fields", [])      # 부모 안에서만 유일한 키 (Slack 메시지 ts)
        self.edges, self.queue = [], []
        self.uf = UF()
        # 2부 V2: 명세가 정한 ID 형식(Slack defs_* 패턴, 접두사). 이름이 아니라 값의 모양으로 공간을 정한다
        self.ex = Extractor(p)
        self.ex.build_spaces()

    # ------------------------------------------------------------------ ① 자리와 경로 위치
    def parse(self):
        self.resp = collections.defaultdict(lambda: collections.defaultdict(list))
        self.req = collections.defaultdict(lambda: collections.defaultdict(list))
        wraps = self.plex.get("response_wrappers", [])
        for f in self.fields:
            for w in wraps:                                # 응답 래퍼를 벗긴다 ($.data.id -> $.id, Atlassian 조직 API)
                if f["side"] == "response" and (f["path"] == "$." + w or f["path"].startswith(("$.%s." % w, "$.%s[*]" % w))):
                    f = dict(f, path="$" + f["path"][len("$." + w):])
                    break
            if f["path"] == "$" and f["type"] == "object" and any(f is not g for g in ()):
                pass
            (self.resp if f["side"] in ("response", "payload", "audit") else self.req)[(f["op_id"], f["side"])][f["path"]].append(f)
        self.op_pos = {}                                   # op -> [(파라미터 이름, 경로 위치)]
        self.item_ops = collections.defaultdict(list)      # 경로 위치 -> 단건 GET 동작
        self.pos_word = {}                                 # 경로 위치 -> 바로 앞 경로 단어 (대표 이름 후보)
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            segs = [s for s in op["path"].strip("/").split("/") if s]
            tmpl, out, prev = [], [], None
            for s in segs:
                if s.startswith("{"):
                    tmpl.append("{}")
                    pos = "/".join(tmpl)
                    out.append((s.strip("{}"), pos))
                    if prev and not prev.startswith("{"):
                        self.pos_word.setdefault(pos, prev)
                else:
                    tmpl.append(s)
                prev = s
            op["tmpl"] = "/".join(tmpl)
            self.op_pos[op["op_id"]] = out
            if op["http_method"] == "GET" and segs and segs[-1].startswith("{"):
                self.item_ops[out[-1][1]].append(op["op_id"])

    def key_path(self, paths, p, schs):
        """레코드 키 자리. 사전 record_key_fields 순서, 사전 record_key_named_id 이면 「스키마 이름 + Id」(Google roleId)"""
        for k in self.keys:
            if p + "." + k in paths:
                return p + "." + k
        if self.plex.get("record_key_named_id"):
            for sname in schs:
                n = sname[:1].lower() + sname[1:] + "Id"
                if p + "." + n in paths:
                    return p + "." + n
        return None

    def records(self, paths):
        """응답 자리 표에서 레코드 자리 -> (스키마 이름들, 키 자리). 부모 안 키(local_key_fields)만 있으면 키 자리는 None"""
        out = {}
        for p, rows in paths.items():
            if not any(r["type"] == "object" for r in rows):
                continue
            schs = sorted({r["schema"] for r in rows if r["type"] == "object" and r.get("schema")})
            kp = self.key_path(paths, p, schs)
            if kp:
                out[p] = (schs, kp)
            elif any(p + "." + k in paths for k in self.local_keys):
                out[p] = (schs, None)
        return out

    def id_space(self, rows):
        """키 자리 값의 ID 형식이 명세로 정한 공간 (V2). 정의 참조(defs_*)가 먼저, 다음은 예시 값의 접두사(명세 패턴에서 온 표)"""
        for r in rows:
            sp = self.ex.space_of_def.get(r.get("ref_def")) if r.get("ref_def") else None
            if isinstance(sp, str):
                return sp
        vals = []
        for r in rows:
            vals += r.get("examples") or ([r["example"]] if r.get("example") else [])
        sp = self.ex.values_space(vals) if vals else None
        return sp if isinstance(sp, str) else None

    def nid_tags(self, paths, p, samples=False):
        """레코드 자리 p 의 node_id 예시 값들이 말하는 타입 표지. 옛 형식은 "User", 새 형식은 "U_".
        samples=False 이면 스키마 속성 예시만 본다. 예시 응답 값(samples)은 인라인 레코드에만 쓴다"""
        tags, weak = collections.Counter(), collections.Counter()
        if not self.nid_field:
            return tags, weak

        def vals(q):
            out = []
            for r in paths.get(q, []):
                out += r.get("examples") or ([r["example"]] if r.get("example") else [])
                if samples:
                    out += r.get("samples") or []
            return out
        # 자기 일관성: 옛 형식 안의 DB id 는 같은 레코드 id 예시와 같아야 한다. 다르면 예시 복사 오류다
        # (GitHub enterprise.node_id 예시가 Repository1296269 인데 id 예시는 42)
        ids = {str(v) for k in self.keys for v in vals(p + "." + k)}
        for v in vals(p + "." + self.nid_field):
            t = node_id_tag(v)
            if not t:
                continue
            if t[1] and ids and t[1] not in ids:
                self.nid_mismatch[(p, v)] += 1
                weak[t[0]] += 1                            # 타입은 맞을 수도 있다: 합치기 근거로는 안 쓰고 반대 근거로만 쓴다
                continue
            tags[t[0]] += 1
        return tags, weak

    # ------------------------------------------------------------------ ② 구조 지문 (이름 없는 인라인 객체)
    def fingerprints(self):
        """스키마마다 (바로 아래 속성 이름, 타입) 집합. 같은 명세 안 정확한 같음만 쓴다"""
        fp = collections.defaultdict(set)
        for (op, side), paths in self.resp.items():
            for p, rows in paths.items():
                if len({r.get("schema") for r in rows if r["type"] == "object" and r.get("schema")}) > 1:
                    continue                               # 다형 자리: 대안들의 속성이 한 자리에 섞여 지문이 아니다
                for r in rows:
                    if r["type"] == "object" and r.get("schema"):
                        kids = frozenset((q.rsplit(".", 1)[1], str(paths[q][0]["type"])) for q in paths
                                         if q.startswith(p + ".") and q.count(".") == p.count(".") + 1)
                        fp[r["schema"]].add(kids)
        by_fp = collections.defaultdict(set)
        for s, fs in fp.items():
            for k in fs:
                by_fp[k].add(s)
        self.by_fp = by_fp
        # 같은 명세 안에서 지문이 정확히 같은 스키마는 같은 스키마의 다른 이름이다 (simple-user, nullable-simple-user).
        # 우연한 일치를 막으려고 키 필드를 포함해 속성이 6개 이상일 때만 (구조 근거)
        self.fp_edges = []
        for k, ss in sorted(by_fp.items(), key=lambda x: sorted(x[1])):
            names = {n for n, _ in k}
            if len(ss) > 1 and len(k) >= 6 and names & set(self.keys):
                ss = sorted(ss)
                for a, b in zip(ss, ss[1:]):
                    self.fp_edges.append((a, b))

    # ------------------------------------------------------------------ ③ 근거 간선
    def edge(self, a, b, grade, why):
        self.edges.append({"a": a, "b": b, "grade": grade, "why": why})

    def one_type(self, tags):
        """한 대상의 표지: 옛 형식 하나와 새 형식 하나까지 (같은 대상이 두 형식으로 나올 수 있다). 옛 형식 타입이 둘이면 다형이거나 예시 오류"""
        return sum(1 for t in tags if not t.endswith("_")) <= 1 and sum(1 for t in tags if t.endswith("_")) <= 1

    def build_edges(self):
        self.nid_links = []                                # (꼭짓점, node_id 표지, id 대조 실패 표지, 동작, 자리)
        self.rec_schemas = {}                              # (op, side, path) -> 스키마 이름들 (인라인은 지문으로 정한 것)
        self.rec_node = {}                                 # (op, side, path) -> 꼭짓점 (key:스키마, idsp:ID 형식 공간, @local)
        for (op, side), paths in sorted(self.resp.items()):
            for p, (schs, kp) in sorted(self.records(paths).items()):
                if kp is None:                             # 부모 안 키만 있는 레코드: 결정자는 매핑에서 부모로 정한다
                    self.rec_node[(op, side, p)] = "@local"
                    self.rec_schemas[(op, side, p)] = schs
                    continue
                vs = self.id_space(paths[kp])
                # 다형 자리는 대안의 예시가 섞여 표지를 달지 않는다
                tags, weak = self.nid_tags(paths, p) if len(schs) <= 1 else (collections.Counter(), collections.Counter())
                if not schs and not vs:                    # 인라인 레코드: 지문이 정확히 같은 이름 있는 스키마
                    tags, weak = self.nid_tags(paths, p, samples=True)
                    kids = frozenset((q.rsplit(".", 1)[1], str(paths[q][0]["type"])) for q in paths
                                     if q.startswith(p + ".") and q.count(".") == p.count(".") + 1)
                    cand = sorted(self.by_fp.get(kids, ()))
                    if len(cand) > 1 and len(kids) >= 6 and {n for n, _ in kids} & set(self.keys):
                        cand = cand[:1]                    # 지문이 같은 스키마들은 위에서 한 공간으로 묶인다
                    if len(cand) == 1:
                        schs = cand
                        self.edge("slot:%s:%s" % (op, p), "key:" + cand[0], "structural", "구조 지문 같음")
                    elif tags and self.one_type(tags):     # 인라인이지만 node_id 가 타입을 말한다
                        node = "gql:" + sorted(tags, key=lambda t: (t.endswith("_"), t))[0]
                        self.rec_node[(op, side, p)] = node
                        self.rec_schemas[(op, side, p)] = []
                        self.nid_links.append((node, tags, weak, op, p))
                        continue
                    else:
                        self.queue.append({"kind": "inline_record_unmatched" if not cand else "inline_record_ambiguous",
                                           "op": op, "path": p, "candidates": cand})
                        continue
                node = "key:" + schs[0] if schs else "idsp:" + vs
                for a, b in zip(schs, schs[1:]):           # 한 자리의 다형 대안은 같은 공간 (Application 의 signOnMode 하위 유형)
                    self.edge("key:" + a, "key:" + b, "stated", "같은 응답 자리의 다형 대안 (%s %s)" % (op, p))
                if vs and schs:
                    self.edge(node, "idsp:" + vs, "stated", "ID 형식 %s (%s %s)" % (vs, op, kp))
                self.rec_node[(op, side, p)] = node
                self.rec_schemas[(op, side, p)] = schs
                if tags or weak:
                    self.nid_links.append((node, tags, weak, op, p))
        for a, b in self.fp_edges:
            self.edge("key:" + a, "key:" + b, "structural", "구조 지문이 정확히 같은 스키마")
        # 단건 왕복
        for pos, ops in sorted(self.item_ops.items()):
            for op in ops:
                node = self.rec_node.get((op, "response", "$"))
                if node and node != "@local":
                    self.edge("pos:" + pos, node, "structural", "단건 조회 왕복 GET %s" % self.ops[op]["path"])
        # 목록 왕복: GET c 의 원소 스키마 -> 같은 컬렉션의 단건 위치 c/{}
        for op in sorted(self.ops.values(), key=lambda o: o["op_id"]):
            if op["http_method"] != "GET" or op["path"].rstrip("/").endswith("}"):
                continue
            pos = op["tmpl"] + "/{}"
            if pos not in self.item_ops and pos not in {x for v in self.op_pos.values() for _, x in v}:
                continue
            node = self.rec_node.get((op["op_id"], "response", "$[*]"))
            if node and node != "@local":
                self.edge("pos:" + pos, node, "structural", "목록 왕복 GET %s" % op["path"])
        self.node_ids()                                    # 먼저 node_id 표지를 단다. 아래 합치기의 반대 근거가 된다
        # 강한 근거부터 합친다 (왕복, 지문 > 다형 대안). 반대 근거로 막힐 때 약한 간선이 먼저 자리를 차지하지 않게 한다
        order = {"structural": 0, "stated": 1}
        for e in sorted(self.edges, key=lambda e: order.get(e["grade"], 9)):
            if e["grade"] in ("stated", "structural") and not e["a"].startswith("slot:"):
                ra, rb = self.uf.find(e["a"]), self.uf.find(e["b"])
                poly = e["grade"] == "stated" and e["a"].startswith("key:") and e["b"].startswith("key:")
                if not self.join(ra, rb, weak=poly):
                    u = self.tset.get(ra, set()) | self.tset.get(rb, set())
                    clash = not self.one_type(collections.Counter(u))
                    e["refused"] = "node_id 타입이 다르다" if clash else "각자 단건 조회 경로가 있다"
                    self.queue.append({"kind": "node_id_split" if clash else "poly_collections_split", "a": e["a"], "b": e["b"],
                                       "why": e["why"], "types": [sorted(self.tset.get(ra, ())), sorted(self.tset.get(rb, ()))],
                                       "item_positions": [sorted(self.hset.get(ra, ())), sorted(self.hset.get(rb, ()))]})
                    self.nid_stats["split" if clash else "poly_split"] += 1
        # 모든 경로 위치를 꼭짓점으로 등록
        for v in self.op_pos.values():
            for _, pos in v:
                self.uf.find("pos:" + pos)
        for node in self.rec_node.values():
            if node != "@local":
                self.uf.find(node)

    # ------------------------------------------------------------------ ③-2 node_id 해독 (예시 등급, 반대 근거)
    def join(self, ra, rb, weak=False):
        """두 동치류를 합친다. 한 공간은 한 대상 타입이다: 합친 뒤 옛 형식 타입이나 새 형식 접두사가 둘이 되면 합치지 않는다.
        weak=True (node_id 예시 간선, 다형 대안 간선): 단건 조회 경로를 각자 가진 두 동치류는 합치지 않는다.
        서로 다른 컬렉션을 예시 값 하나나 「이것 또는 저것」 자리 하나로 합치지 않는다
        (GitHub artifact 예시가 CheckSuite 값이다. 프로젝트 항목 content 는 issue 또는 pull-request 다)"""
        ra, rb = self.uf.find(ra), self.uf.find(rb)
        if ra == rb:
            return True
        u = self.tset.get(ra, set()) | self.tset.get(rb, set())
        if sum(1 for x in u if not x.endswith("_")) > 1 or sum(1 for x in u if x.endswith("_")) > 1:
            return False
        ha, hb = self.hset.get(ra, set()), self.hset.get(rb, set())
        if weak and ha and hb and ha != hb:
            return False
        self.uf.union(ra, rb)
        r = self.uf.find(ra)
        self.tset[r] = u
        self.hset[r] = ha | hb
        return True

    def node_ids(self):
        """꼭짓점마다 node_id 예시가 말하는 타입 표지를 모아 gql:<표지> 꼭짓점과 잇는다.
        값의 형식은 명시지만 값은 문서 예시라 등급은 「예시」다.
        - 한 꼭짓점의 옛 형식 타입이 둘 이상이면 잇지 않는다 (다형 자리 또는 예시 복사 오류)
        - 이은 표지는 뒤의 합치기(다형 대안, 왕복, 지문, 사전)에서 반대 근거로 쓴다 (join)
        - DB id 가 id 예시와 다른 표지(weak)는 잇지 않고 반대 근거로만 단다"""
        self.tset = {}
        self.hset = collections.defaultdict(set)           # 동치류 -> 단건 조회로 돌아오는 경로 위치들
        for pos, ops in self.item_ops.items():
            for op in ops:
                node = self.rec_node.get((op, "response", "$"))
                if node and node != "@local":
                    self.hset[self.uf.find(node)].add(pos)
        self.nid_stats = collections.Counter()
        per = collections.defaultdict(collections.Counter)
        perw = collections.defaultdict(collections.Counter)
        where = collections.defaultdict(list)
        for node, tags, weak, op, p in self.nid_links:
            per[node].update(tags)
            perw[node].update(weak)
            where[node].append("%s %s" % (op, p))
        for node in sorted(set(perw) - set(per)):
            per[node] = collections.Counter()
        # 근거가 많은 꼭짓점부터 (자주 쓰이는 스키마가 그 타입의 자리를 먼저 차지한다)
        for node, tags in sorted(per.items(), key=lambda x: (-sum(x[1].values()), x[0])):
            if not self.one_type(tags):
                self.queue.append({"kind": "node_id_multi_type", "node": node, "tags": dict(tags), "at": where[node][:5]})
                self.nid_stats["multi_type"] += 1
                continue
            for t in sorted(tags, key=lambda t: (t.endswith("_"), t)):
                g = "gql:" + t
                self.tset.setdefault(self.uf.find(g), {t})
                if node == g:
                    continue
                if not self.join(node, g, weak=True):
                    self.queue.append({"kind": "node_id_conflict", "node": node, "type": t,
                                       "has": sorted(self.tset.get(self.uf.find(node), ())), "at": where[node][:5]})
                    self.nid_stats["conflict"] += 1
                    continue
                self.edge(node, g, "example", "node_id 예시가 %s 타입 (%s)" % (t, where[node][0]))
                self.nid_stats["linked"] += 1
            w = perw.get(node)
            if w and not tags and self.one_type(w):
                r = self.uf.find(node)
                u = self.tset.get(r, set()) | set(w)
                if self.one_type(collections.Counter(u)):
                    self.tset[r] = u
                    self.nid_stats["negative_only"] += 1

    # ------------------------------------------------------------------ ④ 사전 간선 (충돌 검사)
    def curated(self):
        """사전 param_space: 경로 파라미터 이름 -> 공간 이름. 같은 이름의 위치들을 그 공간 이름 아래로 모은다.
        충돌: 합칠 두 동치류가 각각 최상위 단건 위치(…/{} 하나짜리)를 가지면 서로 다른 전역 컬렉션이라 합치지 않는다"""
        ps = self.plex.get("param_space", {})
        anchor = {}
        for op_id, lst in sorted(self.op_pos.items()):
            for name, pos in lst:
                sp = ps.get(name)
                if not isinstance(sp, str) or sp.startswith("@"):
                    continue
                anchor.setdefault(sp, []).append(pos)
        for sp, poss in sorted(anchor.items()):
            poss = sorted(set(poss))
            for pos in poss[1:]:
                ra, rb = self.uf.find("pos:" + poss[0]), self.uf.find("pos:" + pos)
                if ra == rb:
                    continue
                if self.top_level(ra) and self.top_level(rb):
                    self.queue.append({"kind": "curated_conflict", "space": sp, "a": poss[0], "b": pos})
                    continue
                if not self.join(ra, rb):
                    self.queue.append({"kind": "node_id_split", "a": "pos:" + poss[0], "b": "pos:" + pos, "why": "param_space: " + sp,
                                       "types": [sorted(self.tset.get(ra, ())), sorted(self.tset.get(rb, ()))]})
                    self.nid_stats["split"] += 1
                    continue
                self.edge("pos:" + poss[0], "pos:" + pos, "curated", "param_space: %s" % sp)
            self.curated_name = getattr(self, "curated_name", {})
            self.curated_name[self.uf.find("pos:" + poss[0])] = sp

    def members(self):
        m = collections.defaultdict(set)
        for x in list(self.uf.p):
            m[self.uf.find(x)].add(x)
        return m

    def top_level(self, root):
        return any(x.startswith("pos:") and x.count("{}") == 1 and x[4:] in self.item_ops for x in self.members().get(root, ()))

    # ------------------------------------------------------------------ ⑤ 공간, 키 꼴, 대표 이름
    def spaces(self):
        mem = self.members()
        self.cls = {}
        cn = getattr(self, "curated_name", {})
        names = {}
        for root, xs in sorted(mem.items()):
            keys = sorted(x[4:] for x in xs if x.startswith("key:"))
            idsps = sorted(x[5:] for x in xs if x.startswith("idsp:"))
            gqls = sorted(x[4:] for x in xs if x.startswith("gql:"))
            poss = sorted(x[4:] for x in xs if x.startswith("pos:"))
            items = [p for p in poss if p in self.item_ops]
            # 대표 이름: 사전 > 단건 조회가 돌려주는 키 스키마 이름(가장 짧은 것) > 경로 단어. 이름 고르기에만 쓴다
            name = None
            for r, n in cn.items():
                if self.uf.find(r) == root:
                    name = n
            if not name and idsps:
                name = idsps[0]                            # 명세 ID 정의가 정한 공간 이름 (Slack user, channel)
            ret = sorted({s for p in items for op in self.item_ops[p] for s in (self.rec_schemas.get((op, "response", "$")) or [])},
                         key=lambda s: (len(s), s))
            if not name and ret:
                name = re.sub(r"[^a-z0-9]", "", ret[0].lower())
            if not name and items:
                words = collections.Counter(self.pos_word.get(p) for p in items if self.pos_word.get(p))
                if words:
                    w = sorted(words.items(), key=lambda x: (-x[1], x[0]))[0][0]
                    name = re.sub(r"[^a-z0-9]", "", w.lower())
            if not name and keys:
                name = re.sub(r"[^a-z0-9]", "", keys[0].lower())
            if not name and gqls:                          # node_id 가 말한 GraphQL 타입 (옛 형식 이름이 먼저)
                name = re.sub(r"[^a-z0-9]", "", sorted(gqls, key=lambda t: (t.endswith("_"), t))[0].lower()) or None
            if not name and poss:
                name = "pos_" + re.sub(r"[^a-z0-9]", "_", poss[0].lower()).strip("_")
            base, n = name, 2
            while name in names:
                name = "%s_%d" % (base, n)
                n += 1
            names[name] = root
            top = any(p.count("{}") == 1 for p in items)
            if top:
                form = "global"
            elif items:
                form = "local"
            elif idsps:
                form = "global"                            # 명세 ID 형식 공간 (RPC: 경로가 없다)
            elif keys or gqls:
                form = "schema_only"                       # 키 있는 레코드지만 단건 경로가 없다 (박힌 객체로만 나온다)
            else:
                form = "path_only"
            self.cls[root] = dict(name=name, keys=keys + ["(ID 형식) " + x for x in idsps], positions=poss,
                                  item_positions=items, form=form, graphql_types=gqls)
        # 범위 안 공간의 부모: 단건 위치 앞 파라미터의 공간
        for root, c in self.cls.items():
            if c["form"] == "local":
                par = set()
                for p in c["item_positions"]:
                    parts = p.split("/")
                    idx = [i for i, x in enumerate(parts) if x == "{}"]
                    if len(idx) >= 2:
                        par.add(self.cls[self.uf.find("pos:" + "/".join(parts[: idx[-2] + 1]))]["name"])
                c["parent"] = sorted(par)

    def space_of_schema(self, s):
        r = self.uf.p.get("key:" + s) and self.uf.find("key:" + s)
        return self.cls[r]["name"] if r in self.cls else None

    def space_of_node(self, node):
        if not node or node == "@local" or node not in self.uf.p:
            return None
        return self.cls[self.uf.find(node)]["name"]

    def param_root(self, o):
        """경로가 없는 동작(RPC): 필수 인자 중 예시 값의 ID 형식(V2)이 한 공간을 가리키면 그 공간이 결과의 주인이다"""
        sps = set()
        for prm in o.get("params", []):
            if prm.get("required") and prm.get("example"):
                vals = [x.strip("\"' []") for x in str(prm["example"]).split(",")]
                sp = self.ex.values_space(vals)
                if isinstance(sp, str):
                    sps.add(sp)
        return sps.pop() if len(sps) == 1 else None

    def space_of_pos(self, pos):
        r = self.uf.find("pos:" + pos)
        return self.cls[r]["name"]

    # ------------------------------------------------------------------ ⑥ 정보 매핑
    def mapping(self):
        items = collections.OrderedDict()
        refs = collections.defaultdict(lambda: {"n": 0, "fields": collections.Counter(), "via": collections.Counter()})
        self.det_of_op = {}
        for (op, side), paths in sorted(self.resp.items()):
            recs = {p: self.rec_node[(op, side, p)] for p in paths if (op, side, p) in self.rec_node}
            o = self.ops.get(op, {})
            # 레코드가 없을 때의 결정자 (동작 맥락)
            if side == "payload":
                root = ("event", op)
            elif side == "audit":
                root = ("event", "audit")
            else:
                lst = self.op_pos.get(op, [])
                segs = [s for s in o.get("path", "").strip("/").split("/") if s]
                if o.get("http_method") == "GET" and segs and not segs[-1].startswith("{"):
                    root = ("op", op)                      # 목록과 검색: 질의 인자는 필터다
                elif lst:
                    root = ("space", self.space_of_pos(lst[-1][1]))
                elif not lst and self.param_root(o) in {c["name"] for c in self.cls.values()}:
                    root = ("space", self.param_root(o))
                else:
                    root = ("op", op)
            for p, rows in sorted(paths.items()):
                f = rows[0]
                name = re.sub(r"\[\*\]", "", p.rsplit(".", 1)[-1])
                if name in SKIP or any("." + s in p or "." + s + "[" in p for s in SKIP):
                    continue
                if any(r["type"] == "object" for r in rows) or p + "[*]" in paths:
                    continue                               # 그릇
                # 가장 가까운 레코드
                cur, rec = p, None
                while True:
                    cur = cur.rsplit(".", 1)[0] if "." in cur else None
                    if cur is None:
                        break
                    if cur in recs:
                        rec = cur
                        break
                if rec is not None and recs[rec] == "@local":
                    # 부모 안 키 레코드 (Slack 메시지): 결정자는 (바깥 레코드나 동작 맥락의 공간, 키 이름)
                    outer = rec.rsplit(".", 1)[0] if "." in rec else None
                    while outer and (outer not in recs or recs[outer] == "@local"):
                        outer = outer.rsplit(".", 1)[0] if "." in outer else None
                    par = self.space_of_node(recs[outer]) if outer else (root[1] if root[0] == "space" else "?")
                    lk = next(k for k in self.local_keys if any(q == rec + "." + k for q in paths))
                    det, rel = ("local", "%s/%s" % (par, lk)), p[len(rec) + 1:]
                    nested = False
                elif rec is not None:
                    sp = self.space_of_node(recs[rec])
                    det, rel = ("space", sp), p[len(rec) + 1:]
                    nested = rec.count(".") > 0 and rec not in ("$[*]",)
                else:
                    det, rel, nested = root, re.sub(r"^\$(\[\*\])?\.?", "", p), False
                rel = rel.replace("[*]", "")
                key = "%s:%s|%s" % (det[0], det[1], rel)
                it = items.get(key)
                if it is None:
                    it = items[key] = {"det": "%s:%s" % det, "rel": rel, "types": collections.Counter(), "slots": [],
                                       "src": collections.Counter(), "read_by": set(), "write_by": set(), "ref": None}
                it["types"][str(f["type"])] += 1
                # 명시 참조 (2부): 스키마가 대상을 말하는 필드. Salesforce Refers To, Slack 정의 참조(defs_user_id)
                tgt = None
                if f.get("ref_targets") and len(f["ref_targets"]) == 1:
                    tgt = self.space_of_schema(f["ref_targets"][0])
                elif f.get("ref_def") and not any(p.endswith("." + k) for k in self.keys):
                    sp_ = self.ex.space_of_def.get(f["ref_def"])
                    tgt = self.space_of_node("idsp:" + sp_) if isinstance(sp_, str) else None
                if tgt and det[0] == "space" and tgt != det[1]:
                    e = refs[(det[1], tgt)]
                    e["n"] += 1
                    e["fields"][rel] += 1
                    e["via"]["stated"] += 1
                    it["ref"] = tgt
                it["slots"].append((op, side, p))
                src = {"payload": "event", "audit": "audit"}.get(side, "api")
                it["src"][src + ("_copy" if nested and src != "event" else "")] += 1
                if side == "response":
                    it["read_by"].update(o.get("scopes", []))
            # 참조: 레코드 안에 박힌 다른 공간의 레코드 (명시: $ref 로 들어온 키 있는 스키마)
            for p, node in recs.items():
                outer = p.rsplit(".", 1)[0] if "." in p else None
                while outer and outer not in recs:
                    outer = outer.rsplit(".", 1)[0] if "." in outer else None
                if not outer:
                    continue
                a, b = self.space_of_node(recs[outer]), self.space_of_node(node)
                if a and b and a != b:
                    e = refs[(a, b)]
                    e["n"] += 1
                    e["fields"][re.sub(r"\[\*\]", "", p[len(outer) + 1:])] += 1
                    e["via"]["stated"] += 1
        self.items, self.refs = items, refs

    # ------------------------------------------------------------------ ⑥-2 GraphQL SDL (GitHub)
    def graphql(self):
        """SDL 타입 표(ir/graphql_types.jsonl)를 공간에 붙인다. 공간과 SDL 타입은 node_id 가 말한 타입 이름으로만 잇는다
        (같은 명명 체계 안 정확한 같음. REST 필드 이름과 GraphQL 필드 이름은 비교하지 않는다).
        - 타입 확인: node_id 표지가 SDL 의 Node 구현 타입인가 (아니면 옛 이름: Integration 은 SDL 에서 App)
        - 명시 참조: 타입 T 의 필드가 가리키는 타입 U 가 다른 공간의 타입이면 참조 간선 (via graphql).
          인터페이스와 union 은 구현 타입 모두 (다형 참조). Connection 은 nodes 원소 타입으로 한 번 따라간다 (Relay 규약)
        - GraphQL 로 읽히는 값 필드: 공간마다 스칼라와 enum 필드 목록 (REST 항목과 이름으로 맞추지 않는다)"""
        path = os.path.join(HERE, "out", self.p, "ir", "graphql_types.jsonl")
        self.gql_spaces, self.gql_stats = {}, collections.Counter()
        if not os.path.exists(path):
            return
        sdl = {r["name"]: r for r in load(self.p, "graphql_types.jsonl")}
        node_types = {n for n, r in sdl.items() if r["kind"] == "object" and "Node" in r.get("implements", [])}
        scalar = {n for n, r in sdl.items() if r["kind"] in ("scalar", "enum")} | {"String", "Int", "Float", "Boolean", "ID"}
        tag_space = {}
        for c in self.cls.values():
            for t in c.get("graphql_types", []):
                if not t.endswith("_"):
                    tag_space[t] = c["name"]

        def targets(u):
            r = sdl.get(u)
            if not r:
                return [], False
            if r["kind"] in ("interface", "union"):
                return [x for x in r.get("possible_types", []) if x in sdl], True
            if r["kind"] == "object" and u not in node_types:
                nodes = next((f for f in r.get("fields", []) if f["name"] == "nodes" and f.get("list")), None)
                if nodes:                                  # XxxConnection.nodes: [Xxx]
                    return targets(nodes["type"])
            return ([u], False) if r["kind"] == "object" else ([], False)

        for t, sp in sorted(tag_space.items()):
            r = sdl.get(t)
            info = self.gql_spaces.setdefault(sp, {"types": [], "unknown_types": [], "fields": [], "refs": []})
            if not r or t not in node_types:
                info["unknown_types"].append(t)
                self.gql_stats["tag_not_in_sdl"] += 1
                continue
            info["types"].append(t)
            self.gql_stats["tag_in_sdl"] += 1
            for f in r.get("fields", []):
                if f.get("type") in scalar:
                    info["fields"].append({"name": f["name"], "type": f["type"], "list": f.get("list", False)})
                    continue
                tg, poly = targets(f.get("type"))
                for v in tg:
                    sp2 = tag_space.get(v)
                    if not sp2 or sp2 == sp:
                        continue
                    e = self.refs[(sp, sp2)]
                    e["n"] += 1
                    e["fields"]["graphql:" + f["name"]] += 1
                    e["via"]["graphql_poly" if poly else "graphql"] += 1
                    info["refs"].append({"field": f["name"], "to": sp2, "type": v, "poly": poly})
                    self.gql_stats["ref"] += 1
            self.gql_stats["fields"] += len(info["fields"])

    def example_refs(self):
        """2부 V3: 문자열 참조 필드의 예시 값이 한 공간 키의 예시 값과 같다(희귀 값: 키 예시 중 한 공간에서만 나온 값).
        공간을 합치지 않고 참조 후보로만 남긴다"""
        key_vals = collections.defaultdict(set)
        for (op, side), paths in self.resp.items():
            for p in paths:
                node = self.rec_node.get((op, side, p))
                if not node or node == "@local":
                    continue
                for k in self.keys:
                    for r in paths.get(p + "." + k, []):
                        if r.get("example"):
                            key_vals[r["example"]].add(self.space_of_node(node))
        rare = {v: next(iter(s)) for v, s in key_vals.items() if len(s) == 1 and len(v) >= 8}
        cand = collections.Counter()
        for (op, side), paths in self.resp.items():
            for p, rows in paths.items():
                ex = rows[0].get("example")
                if ex in rare and not any(p.endswith("." + k) for k in self.keys):
                    cand[(re.sub(r"\[\*\]", "", p.rsplit(".", 1)[-1]), rare[ex])] += 1
        self.example_ref_candidates = [{"field": f, "space": s, "n": n} for (f, s), n in sorted(cand.items())]

    # ------------------------------------------------------------------ 쓰기 (S2) 와 감사
    def writes(self):
        self.body_edges, self.write_only = [], collections.defaultdict(set)
        for (op, side), paths in sorted(self.req.items()):
            o = self.ops.get(op, {})
            if side != "request" or o.get("http_method") not in ("POST", "PUT", "PATCH"):
                continue
            rs = self.rec_node.get((op, "response", "$"))
            if rs and rs != "@local":
                T = self.space_of_node(rs)
            elif self.op_pos.get(op):
                T = self.space_of_pos(self.op_pos[op][-1][1])
            else:
                continue
            for p, rows in paths.items():
                if any(r["type"] == "object" for r in rows) or p + "[*]" in paths or p == "$":
                    continue
                rel = re.sub(r"^\$(\[\*\])?\.?", "", p).replace("[*]", "")
                key = "space:%s|%s" % (T, rel)
                if key in self.items:
                    self.items[key]["write_by"].add(op)
                    self.body_edges.append({"op": op, "path": p, "item": key})
                else:
                    self.write_only[key].add(op)

    def audit(self):
        alias = self.plex.get("audit_alias", {})
        names = {c["name"] for c in self.cls.values()}
        self.changes, self.unmatched, self.action_links = collections.defaultdict(list), collections.Counter(), []
        for e in self.events:
            if e["catalog"] != "audit":
                continue
            sp = alias.get(e.get("category"))
            if sp in names:
                self.changes[sp].append(e["name"])
                self.action_links.append({"action": e["name"], "space": sp, "verb": None, "effect": "unknown", "others": [],
                                          "tokens": [], "kind": "candidate", "items": [], "basis": None})
            else:
                self.unmatched[e.get("category")] += 1

    # ------------------------------------------------------------------ ⑦ 불변식과 출력
    def check(self):
        for root, c in sorted(self.cls.items()):
            if c["form"] == "path_only":
                self.queue.append({"kind": "path_only", "space": c["name"], "positions": c["positions"]})
            elif not c["keys"]:                            # V1: 단건 조회는 있지만 돌려준 레코드에 키가 없다
                self.queue.append({"kind": "space_without_key", "space": c["name"], "positions": c["item_positions"]})
        for k, it in self.items.items():
            if len([t for t in it["types"] if t not in ("null", "unknown")]) > 1:
                self.queue.append({"kind": "type_conflict", "item": k, "types": sorted(it["types"])})

    def dump(self):
        dets = collections.defaultdict(lambda: {"items": 0, "slots": 0, "src": collections.Counter()})
        out_items = []
        for k, it in self.items.items():
            d = dets[it["det"]]
            d["items"] += 1
            d["slots"] += len(it["slots"])
            d["src"].update(it["src"])
            out_items.append({"key": k, "det": it["det"], "rel": it["rel"], "cls": "ref" if it["ref"] else "other", "ref_space": it["ref"],
                              "types": sorted(it["types"]), "src": dict(it["src"]), "n_slots": len(it["slots"]),
                              "slots": sorted(set(it["slots"]))[:40], "read_by": sorted(it["read_by"]),
                              "write_by": sorted(it["write_by"]), "changed_by": [], "filter_by": []})
        ref_list = [{"from": a, "to": b, "n": e["n"], "fields": e["fields"].most_common(8), "via": dict(e["via"])}
                    for (a, b), e in sorted(self.refs.items())]
        grades = collections.Counter(e["grade"] for e in self.edges)
        spaces = {c["name"]: dict(form=c["form"], keys=c["keys"], positions=c["positions"], item_positions=c["item_positions"],
                                  parent=c.get("parent", []), graphql_types=c["graphql_types"]) for c in self.cls.values()}
        evid = collections.defaultdict(list)
        for e in self.edges:
            for x in (e["a"], e["b"]):
                if x.startswith(("pos:", "key:", "gql:")):
                    r = self.uf.find(x)
                    if r in self.cls:
                        evid[self.cls[r]["name"]].append(e)
                        break
        data = {
            "provider": self.p,
            "rules": "info_map v2: 근거 간선과 동치류 (ID 공간 설계.md)",
            "totals": {"slots": sum(len(i["slots"]) for i in self.items.values()), "items": len(self.items),
                       "determinants": len(dets), "ref_edges": len(ref_list), "write_edges": 0,
                       "body_write_edges": len(self.body_edges), "body_relation_edges": 0, "write_only": len(self.write_only),
                       "filter_edges": 0, "audit_actions_matched": sum(len(v) for v in self.changes.values()),
                       "audit_actions_unmatched": sum(self.unmatched.values()), "queue": len(self.queue),
                       "action_kinds": {"candidate": len(self.action_links)}, "action_linked": {},
                       "spaces": sum(1 for c in self.cls.values() if c["form"] != "path_only"),
                       "space_forms": dict(collections.Counter(c["form"] for c in self.cls.values())),
                       "edge_grades": dict(grades), "example_ref_candidates": len(self.example_ref_candidates),
                       "node_id": dict(getattr(self, "nid_stats", {}), example_id_mismatch=len(self.nid_mismatch)),
                       "graphql": dict(self.gql_stats)},
            "determinants": {d: {"items": v["items"], "slots": v["slots"], "src": dict(v["src"])} for d, v in sorted(dets.items())},
            "items": out_items, "refs": ref_list,
            "changes": {k: sorted(v) for k, v in sorted(self.changes.items())},
            "action_links": sorted(self.action_links, key=lambda x: (x["space"], x["action"])),
            "audit_unmatched": dict(self.unmatched.most_common()),
            "space_notes": self.plex.get("space_notes", {}),
            "spaces": spaces,
            "space_evidence": {k: v[:30] for k, v in sorted(evid.items())},
            "example_ref_candidates": self.example_ref_candidates,
            "graphql": self.gql_spaces,
            "queue_by_kind": dict(collections.Counter(q["kind"] for q in self.queue)),
            "queue_sample": self.queue[:300],
        }
        path = os.path.join(HERE, "out", self.p, "info_map_v2.json")
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        tpl = io.open(os.path.join(HERE, "info_map_view.html"), encoding="utf-8").read()
        title = {"okta": "Okta", "slack": "Slack", "github": "GitHub", "gws": "Google Workspace", "salesforce": "Salesforce",
                 "jira": "Jira", "confluence": "Confluence", "atlassian": "Atlassian 조직"}.get(self.p, self.p) + " (v2 근거 기반)"
        html = tpl.replace("/*TITLE*/", title).replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, sort_keys=True).replace("</", "<\\/"))
        with io.open(os.path.join(HERE, "out", self.p, "info_map_v2.html"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(html)
        return data

    def run(self):
        self.parse()
        self.fingerprints()
        self.build_edges()
        self.curated()
        self.spaces()
        self.mapping()
        self.graphql()
        self.example_refs()
        self.writes()
        self.audit()
        self.check()
        return self.dump()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    d = Map2(sys.argv[1] if len(sys.argv) > 1 else "okta").run()
    print(json.dumps(d["totals"], ensure_ascii=False))
    print(json.dumps(d["queue_by_kind"], ensure_ascii=False))
