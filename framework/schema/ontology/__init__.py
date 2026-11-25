# -*- coding: utf-8 -*-
"""개념 사전 적재기. 검사(validation/)와 수집기(collect/)가 같이 쓴다.

    import ontology                         # 저장소 루트가 sys.path 에 있어야 한다
    ontology.interfaces()                   # ['Tenant', 'Principal', ...]
    ontology.template_pairs()['owned_by']   # [('Endpoint', 'Integration'), ...]

사전 파일은 손으로 고친다. 고치면 `python validation/run_all.py` 가 명세 문서 표와 같은지 본다.
"""
import io
import os
import re

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {}


def load(name):
    """`ontology/<name>.yaml` 을 읽는다."""
    if name not in _cache:
        with io.open(os.path.join(HERE, name + ".yaml"), encoding="utf-8") as f:
            _cache[name] = yaml.safe_load(f)
    return _cache[name]


def interfaces():
    return [i["name"] for i in load("interfaces")["interfaces"]]


def relation_types():
    """{이름: 행}. 행은 relation_types.yaml 의 그대로다."""
    return {r["name"]: r for r in load("relation_types")["relation_types"]}


def template_pairs():
    """{이름: [(출발 interface, 도착 interface)]}. `any` 는 9종으로 편다.

    가지(`;`)마다 따로 편다. 가지를 합집합으로 펴면 `owned_by` 가 실제로 없는
    Principal --> Tenant 를 받아버린다.
    """
    nine = interfaces()
    out = {}
    for name, r in relation_types().items():
        pairs = []
        for b in r["branches"]:
            src = nine if "any" in b["from"] else b["from"]
            tgt = nine if "any" in b["to"] else b["to"]
            pairs += [(s, t) for s in src for t in tgt if (s, t) not in pairs]
        out[name] = pairs
    return out


def relation_semantics():
    """{이름: 의미 행} — relation_semantics.yaml 의 `relations`. 이름 · 방향 · 성질 · 효과."""
    return load("relation_semantics")["relations"]


def reference_semantics():
    """{참조 칸 이름: 뜻} — relation_semantics.yaml 의 `references`. 관계 행 없이 Object 의 참조가 만드는 간선."""
    return load("relation_semantics").get("references") or {}


def rule_semantics():
    """{규칙 이름: 뜻} — relation_semantics.yaml 의 `rules`. 사전 표 · 속성 · 자동화 Link 가 만드는 간선."""
    return load("relation_semantics").get("rules") or {}


def crosswalk():
    """{키 종류: 규칙} — crosswalk.yaml 의 `kinds`. SaaS 를 넘는 연결 (관계 또는 Link)."""
    return load("crosswalk")["kinds"]


def relation_grades():
    """{relation_type: 명세 표현 등급} — relation_types.yaml 의 `grades` 를 관계 기준으로 편 것."""
    return {t: g["name"] for g in load("relation_types")["grades"] for t in g["relation_types"]}


def computed_grades(name):
    """effects · conditions 가 만드는 간선 종류를 grade_of_kind 로 옮긴 등급 집합. 간선이 없으면 빈 집합."""
    table = load("relation_semantics")["grade_of_kind"]
    r = relation_semantics()[name]
    kinds = [e["kind"] for b in r.get("effects") or [] for e in b["emits"]]
    kinds += [e["kind"] for c in r.get("conditions") or [] for case in c["cases"] for e in case["emits"]]
    return {table[k] for k in kinds}


def role_name(role, objects):
    """has_role_on 역할 자리 하나의 이름 — capabilities.yaml `role_name_from` 을 위에서부터 본다. 못 찾으면 None.

    role 은 관계의 references.role ({kind, value}). objects 는 {키: 객체}이고 객체의 속성은 properties 나 props 칸에 있다.
    """
    if not role:
        return None
    for src in load("capabilities")["role_name_from"]:
        if src["role"] == "name_key" and role.get("kind") == "name_key":
            v = role.get(src["take"])
        elif src["role"] == "object" and role.get("kind") != "name_key":
            o = objects.get(role.get("value")) or {}
            v = (o.get("properties") or o.get("props") or {}).get(src["take"].split(".", 1)[1])
        else:
            continue
        if isinstance(v, str) and v.strip():
            return v
    return None


def role_scopes(role, objects):
    """역할 객체의 scope 목록 — capabilities.yaml `role_scopes_from`. 역할이 이름(name_key)이거나 목록이 없으면 None."""
    if not role or role.get("kind") == "name_key":
        return None
    src = load("capabilities").get("role_scopes_from") or {}
    o = objects.get(role.get("value")) or {}
    v = (o.get("properties") or o.get("props") or {}).get(str(src.get("take", "")).split(".", 1)[-1])
    if isinstance(v, str):
        v = [x for x in re.split(r"[\s,]+", v) if x]
    return [str(x) for x in v] if isinstance(v, list) else None


def role_privileges(role, objects):
    """역할 객체의 권한 이름 목록 — capabilities.yaml `role_privileges_from`. 역할이 이름(name_key)이거나 목록이 없으면 None."""
    if not role or role.get("kind") == "name_key":
        return None
    src = load("capabilities").get("role_privileges_from") or {}
    o = objects.get(role.get("value")) or {}
    v = (o.get("properties") or o.get("props") or {}).get(str(src.get("take", "")).split(".", 1)[-1])
    return [str(x) for x in v] if isinstance(v, list) else None


def privilege_rank(provider, privileges):
    """권한 이름 목록 → 세기 — capabilities.yaml `privilege_rank`. 이름마다 위에서부터 처음 맞는 줄의 rank, 그 가운데 가장 센 값.
    맞는 이름이 하나도 없으면 None(모르는 이름을 0 으로 치지 않는다). 그 provider 표나 목록이 없으면 None."""
    table = (load("capabilities").get("privilege_rank") or {}).get(provider)
    if table is None or privileges is None:
        return None
    ranks = [next((row["rank"] for row in table if re.search(row["match"], p)), None) for p in privileges]
    ranks = [r for r in ranks if r is not None]
    return max(ranks) if ranks else None


def scope_rank(provider, scopes):
    """scope 목록 → 세기 — capabilities.yaml `scope_rank`. 맞는 줄 가운데 가장 센 rank, 하나도 안 맞으면 0. 그 provider 표가 없으면 None."""
    table = (load("capabilities").get("scope_rank") or {}).get(provider)
    if table is None or scopes is None:
        return None
    return max([row["rank"] for s in scopes for row in table if re.search(row["match"], s)] or [0])


def token_scope_reach(provider, scopes):
    """토큰 scope 목록 → 「무엇에 무엇을」 — capabilities.yaml `token_scopes`. 그 provider 표가 없으면 None.
    돌려주는 것: {"reach": [(scope, 자원 마디, object_types, rank)], "identity": [...], "unmapped": [...]}.
    엔진 src/detection/v2/engine/tokenScopes.ts scopeReach() 와 같은 가름이다."""
    table = (load("capabilities").get("token_scopes") or {}).get(provider)
    if table is None or scopes is None:
        return None
    out = {"reach": [], "identity": [], "unmapped": []}
    for s in scopes:
        if re.search(table.get("identity") or "$^", s):
            out["identity"].append(s)
            continue
        m = re.search(table["grammar"], s)
        res = (table.get("resources") or {}).get(m.group(1)) if m else None
        ability = m.group(2) if m else None
        if res is None or ability not in (table.get("abilities") or {}):
            out["unmapped"].append(s)
            continue
        rank = (res.get("ranks") or {}).get(ability, table["abilities"][ability])
        out["reach"].append((s, m.group(1), list(res.get("object_types") or []), rank))
    return out


def role_rank(provider, name):
    """역할 이름 → 세기. 이름만으로 아는 표(okta_standard_roles · capability_names · role_name_rank · role_rank)에서 찾는다. 모르면 None.

    capability_names 는 능력 목록이라 세기는 그 능력(묶음이면 펴서) 가운데 가장 센 것이다(capability_vocabulary rank).

    대시보드 roleCapability() 의 이름 단계와 같은 순서이고, provider 표(role_name_rank)를 SaaS 이름 없는 표(role_rank) 앞에 둔다.
    엔진의 다른 단계(사람이 확인한 값, 권한 요약 문자열, Okta 사용자 정의 역할의 permissions)는 아직 명세 밖이다.
    GitHub 역할의 base_role 은 role_rank_order 의 base_role 단계(role_base_rank)가 읽는다.
    """
    cap = load("capabilities")
    low = (name or "").strip().lower()
    if provider == "okta" and low in cap["okta_standard_roles"]:
        return cap["okta_standard_roles"][low]["rank"]
    names = {k.lower(): v for k, v in ((cap.get("capability_names") or {}).get(provider) or {}).items()}
    if low in names:
        voc, bundles = cap["capability_vocabulary"], cap.get("capability_bundles") or {}
        caps = [x for c in names[low] for x in (bundles.get(c) or [c])]
        return max((voc[c]["rank"] for c in caps), default=0)
    for row in (cap.get("role_name_rank") or {}).get(provider) or []:
        if re.search(row["match"], (name or "").strip()):
            return row["rank"]
    return cap["role_rank"].get(low)


def _obj(objects, key):
    """{키: 객체} 에서 객체 하나와 그 속성 · 종류. 객체 모양은 검사 세계(props · t)와 번들(properties · object_type) 둘 다 받는다."""
    o = objects.get(key) or {}
    return o, (o.get("properties") or o.get("props") or {}), (o.get("t") or o.get("object_type"))


def role_flags_rank(provider, role, objects):
    """역할 객체의 권한 칸 → 세기 — capabilities.yaml `role_flag_rank`. 참인 칸 가운데 가장 센 rank, 칸은 있는데 참이 없으면 0.
    그 provider 표가 없거나, 역할이 이름(name_key)이거나, 칸이 하나도 없으면 None."""
    table = (load("capabilities").get("role_flag_rank") or {}).get(provider)
    if not table or not role or role.get("kind") == "name_key":
        return None
    _, props, _ = _obj(objects, role.get("value"))
    seen = [row for row in table if row["field"].split(".", 1)[1] in props]
    if not seen:
        return None
    return max([row["rank"] for row in seen if props.get(row["field"].split(".", 1)[1]) is True] or [0])


def role_type_rank(provider, role, objects):
    """역할 객체 종류 → 세기 — capabilities.yaml `role_type_rank`. 표에 없으면 None."""
    table = (load("capabilities").get("role_type_rank") or {}).get(provider) or {}
    if not role or role.get("kind") == "name_key":
        return None
    _, _, otype = _obj(objects, role.get("value"))
    return table.get(otype)


def role_base_rank(role, objects):
    """역할 객체의 기반 역할(properties.base_role) → 세기 — capabilities.yaml `role_rank`. 칸이 없거나 표에 없으면 None.
    GitHub 조직 역할 · 사용자 정의 저장소 역할은 API 가 이 역할이 권한을 물려받는 기본 역할(read … admin)을 준다."""
    if not role or role.get("kind") == "name_key":
        return None
    _, props, _ = _obj(objects, role.get("value"))
    base = props.get("base_role")
    return load("capabilities")["role_rank"].get(base.strip().lower()) if isinstance(base, str) else None


def role_grants_rank(provider, role, target, objects, relations, _depth=0):
    """역할 객체가 같은 대상(target)에 받은 권한 줄로 세기 — capabilities.yaml `role_rank_from_grants`.

    relations 는 관계 행 목록이고 행마다 rt(관계 이름) · s(출발 키) · d(도착 키) · role_ref(역할 자리)가 있다.
    그 역할 객체가 출발이고 도착이 target 인 has_role_on 줄들의 세기(role_capability 로 정한 것) 가운데 가장 센 값. 줄이 없으면 None.
    """
    kinds = (load("capabilities").get("role_rank_from_grants") or {}).get(provider) or []
    if not role or role.get("kind") == "name_key" or _depth > 2:
        return None
    key = role.get("value")
    if _obj(objects, key)[2] not in kinds:
        return None
    ranks = [role_capability(x.get("p") or provider, x.get("role_ref"), x["d"], objects, relations, _depth + 1)[0]
             for x in relations if x.get("rt") == "has_role_on" and x.get("s") == key and x.get("d") == target]
    ranks = [r for r in ranks if r is not None]
    return max(ranks) if ranks else None


def role_capability(provider, role, target, objects, relations=(), _depth=0, permissions=None):
    """has_role_on 역할 자리 하나의 세기 — capabilities.yaml `role_rank_order` 를 위에서부터 본다. (rank, 방법) 을 돌려주고 모르면 (None, None).

    role 은 관계의 references.role ({kind, value}), target 은 그 관계의 도착 키(grants 방법이 쓴다).
    permissions 는 관계 행의 권한 키 목록(properties.permissions, permissions 방법이 쓴다).
    """
    for how in load("capabilities")["role_rank_order"]:
        if how == "permissions":
            ranks = [role_rank(provider, str(p)) for p in permissions or []]
            ranks = [x for x in ranks if x is not None]
            rank = max(ranks) if ranks else None
        elif how == "name":
            name = role_name(role, objects)
            rank = role_rank(provider, name) if name is not None else None
        elif how == "scopes":
            rank = scope_rank(provider, role_scopes(role, objects))
        elif how == "privileges":
            rank = privilege_rank(provider, role_privileges(role, objects))
        elif how == "flags":
            rank = role_flags_rank(provider, role, objects)
        elif how == "object_type":
            rank = role_type_rank(provider, role, objects)
        elif how == "grants":
            rank = role_grants_rank(provider, role, target, objects, relations, _depth)
        elif how == "base_role":
            rank = role_base_rank(role, objects)
        else:
            raise ValueError("role_rank_order 에 모르는 방법 %r" % how)
        if rank is not None:
            return rank, how
    return None, None
