# -*- coding: utf-8 -*-
"""IR 개체 11종과 공통 머리의 규격 (IR 설계.md 3절).

파일 하나에 개체 종류 하나다(out2/<provider>/ir/<종류>.jsonl). 모든 행은 공통 머리를 가진다:
    id, src{source, locator, rank, snapshot}, grade, life{state, sunset?}, ext{}
종류마다 필수 필드와 허용 값을 아래 표로 적는다. validate.py 와 core.IR.add 가 이 표로 검사한다.
"""

KINDS = ("source", "operation", "shape", "key_decl", "id_format", "ref_decl", "binding",
         "catalog", "grant", "instance", "hole")

GRADES = ("stated", "transform", "example", "curated", "observed")
LIFE_STATES = ("active", "deprecated")          # removed 는 출력에 없다 (1절)
RANKS = (1, 2, 3, 4)

HEADER = ("id", "src", "grade", "life", "ext")
SRC_KEYS = ("source", "locator", "rank", "snapshot")

# 종류별 필드: (필드 이름, 필수 여부)
FIELDS = {
    "source": [("kind", True), ("rank", True), ("url", False), ("file", True), ("fetched_at", False),
               ("sha256", True), ("version", False), ("naming", True), ("fetch_method", True)],
    "operation": [("surface", True), ("name", True), ("method", False), ("kind", True), ("kind_grade", True),
                  ("path", False), ("params", True), ("request", False), ("responses", True), ("grants", True)],
    # scalar: kind=scalar 인 모양의 값 형식 {scalar, format?, enum?}. 3.3 에 자리가 없어 더했다 (10절 설계에 남은 질문)
    "shape": [("name", False), ("origin", True), ("kind", True), ("props", False), ("items", False),
              ("alts", False), ("discriminator", False), ("alt_kind", False), ("scalar", False)],
    "key_decl": [("shape", True), ("props", True), ("form", True), ("evidence", True)],
    "id_format": [("name", True), ("match", True), ("decodes", True), ("applies", True)],
    "ref_decl": [("from", True), ("to", True), ("poly", True)],
    "binding": [("operation", True), ("param", True), ("to", True)],
    "catalog": [("catalog", True), ("key", False), ("display", False), ("category", False),
                ("payload", False), ("targets", True)],
    "grant": [("kind", True), ("name", True), ("operations", True)],
    "instance": [("of", True), ("value", True)],
    "hole": [("at", True), ("hole", True), ("reason", True)],
}

ENUMS = {
    # lexicon: 사람이 정한 사전 파일 (curated 사실의 출처). 3.1 에 없는 종류라 더했다 (10절)
    ("source", "kind"): ("api_schema", "api_doc", "log_doc", "event_doc", "tenant", "lexicon"),
    ("source", "fetch_method"): ("prior_snapshot", "http", "machine_alt", "browser_playwright", "browser_cdp",
                                 "browser_agent", "human", "local_upload"),
    ("operation", "surface"): ("rest", "rpc", "graphql", "scim"),
    ("operation", "kind"): ("read_one", "read_many", "create", "update", "delete", "action", "search", "unknown"),
    ("operation", "kind_grade"): GRADES,
    ("shape", "origin"): ("named", "inline", "example_derived"),
    ("shape", "kind"): ("object", "array", "union", "map", "scalar"),
    ("shape", "alt_kind"): ("subtype", "distinct", "unknown"),
    ("key_decl", "form"): ("global", "local", "composite"),
    ("catalog", "catalog"): ("audit", "event", "log_type"),
    ("grant", "kind"): ("oauth_scope", "app_permission", "role", "privilege"),
}

# 구멍 종류 (3.11). 완성도 계산에 쓴다
HOLE_KINDS = ("open_map", "object_no_props", "doc_only_example", "example_unparsed", "pdf_table_unparsed",
              "no_response_schema", "untyped_field_list", "unresolved_ref", "recursive_cut")

# 모양 속성 한 줄의 키 (3.3 props). shape 또는 scalar 중 하나가 있다
PROP_KEYS = ("name", "shape", "scalar", "format", "enum", "required", "read_only", "write_only", "nullable",
             "deprecated", "sunset", "navigation")


def check_row(kind, row):
    """한 행의 규격 위반 목록 (빈 목록이면 통과)"""
    errs = []
    for k in HEADER:
        if k not in row:
            errs.append("머리 없음: " + k)
    src = row.get("src") or {}
    for k in SRC_KEYS:
        if k not in src:
            errs.append("src 없음: " + k)
    if src.get("rank") not in RANKS:
        errs.append("rank 값: %r" % src.get("rank"))
    if row.get("grade") not in GRADES:
        errs.append("grade 값: %r" % row.get("grade"))
    life = row.get("life") or {}
    if life.get("state") not in LIFE_STATES:
        errs.append("life.state 값: %r" % life.get("state"))
    for f, req in FIELDS[kind]:
        if req and f not in row:
            errs.append("필드 없음: " + f)
    for (k, f), allowed in ENUMS.items():
        if k == kind and row.get(f) is not None and row.get(f) not in allowed:
            errs.append("%s 값: %r" % (f, row.get(f)))
    allowed_keys = set(HEADER) | {f for f, _ in FIELDS[kind]}
    extra = set(row) - allowed_keys
    if extra:
        errs.append("규격에 없는 필드: " + ",".join(sorted(extra)))
    return errs
