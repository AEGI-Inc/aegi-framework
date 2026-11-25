# -*- coding: utf-8 -*-
"""Jev 판정 형식 (2026-10-16). 과제 하나 = state 만들기 + 원자 진술문 질문들 + 코드에서 합치는 규칙 + 결과별 기준 확률.

형식 원칙 (TypeSafe 지침과 1차 시범에서 배운 것):
- Noul 은 질문이 아니라 진술문. 부정을 쓰지 않는다. 경계 사례는 criteria 의 true, false 에 적는다
- 여러 요인이 섞인 판단은 원자 진술 여럿으로 나누고, 한 요청에 함께 보낸다(같은 state, 병렬 평가). 합치기는 코드가 한다
- state 는 판단에 필요한 것만 JSON 으로. 테넌트 실측 값은 넣지 않는다
- 모델 이름을 고정한다. 기준 확률은 과제마다, 결과(합치기, 후보 표시)마다 정답표로 보정한다
- 계산, 세기, 날짜 비교는 코드가 한다
- criteria 의 예시는 평가 대상과 겹치지 않는 다른 분야에서 고른다 (루프 16: 평가 쌍을 예시로 적어 점수가 부풀었다)
"""

MODEL = "jev-1.13.0"


def space_view(space, shapes, max_props=30):
    """공간 하나를 state 용 JSON 으로: 단건 위치, 스키마 이름, 속성 이름 (공개 명세에서 온 것만)"""
    names = sorted({(shapes.get(x) or {}).get("name") or x.split(":")[-1] for x in space["shapes"]})[:6]
    props = []
    for x in space["shapes"]:
        for pr in (shapes.get(x) or {}).get("props") or []:
            if pr["name"] not in props:
                props.append(pr["name"])
    return {"endpoints": ["/" + P for P in space["item_positions"][:4]], "schemas": names, "fields": props[:max_props]}


# ---------------------------------------------------------------------- 과제: 중복 공간
DUPLICATE_QUESTIONS = {
    "same_entity": {
        "type": "noul",
        "instructions": "Group A and Group B describe the same kind of real-world entity.",
        "criteria": {
            "true": "A record of A and a record of B can be the very same entity, for example the same customer record "
                    "returned by a detail endpoint and by a search endpoint, or the same invoice seen inside an account.",
            "false": "A and B are different entity types that happen to share field names, for example an invoice and a "
                     "payment, or a shipment and a parcel.",
        },
    },
    "same_identifier": {
        "type": "noul",
        "instructions": "A record of Group A and a record of Group B are identified by the same id value.",
    },
    "variant_of_parent": {
        "type": "noul",
        "instructions": "Group A and Group B are two different subtypes or variants of a broader concept, each a type of its own.",
        "criteria": {
            "true": "For example a refund transaction and a charge transaction, or a text setting value and a color setting "
                    "value.",
            "false": "For example a detailed and a compact representation of the same invoice.",
        },
    },
    "scoped_view": {
        "type": "noul",
        "instructions": "One group is the same entity as the other group, shown inside the context of a parent object.",
    },
}


def duplicate_state(provider, a, b, A, B, shapes, shared):
    # 신호 설명에서 뽑은 문자열에는 예시 ID나 자격증명 값이 섞일 수 있다. 양쪽 원문 필드 이름만 전송한다.
    def field_names(space):
        return {pr["name"] for sid in space["shapes"] for pr in (shapes.get(sid) or {}).get("props") or []}
    shared_fields = set(shared) & field_names(A) & field_names(B)
    return {"api": provider, "group_a": dict(name=a, **space_view(A, shapes)), "group_b": dict(name=b, **space_view(B, shapes)),
            "fields_with_equal_example_values": sorted(shared_fields)[:12]}


def duplicate_combine(ans):
    """합치기 규칙 (코드): 같은 대상이고 같은 id 로 식별되며, 하위 유형 관계가 아니다"""
    se, si, vp = ans.get("same_entity"), ans.get("same_identifier"), ans.get("variant_of_parent")
    if se is None or si is None or vp is None:
        return None
    return round(se * si * (1 - vp), 4) ** (1 / 3) if se * si * (1 - vp) > 0 else 0.0


TASKS = {
    "duplicates": {"questions": DUPLICATE_QUESTIONS, "combine": duplicate_combine,
                   "thresholds": {"mark_candidate": None, "merge_with_rule_evidence": None}},   # 정답표로 보정 뒤 채운다
}


# ---------------------------------------------------------------------- 과제: 레코드와 자기 식별자 (Slack RPC, 2026-10-18)
RECORD_ENTITY = {
    "type": "noul",
    "instructions": "The object is one record of a persistent entity in the workspace, and the record has an identifier of its own.",
    "criteria": {
        "true": "For example an invoice object with its invoice id, or a warehouse object with its warehouse code.",
        "false": "For example a response envelope with a status flag and a cursor, a counter summary, or a nested settings "
                 "block that only describes its parent.",
    },
}


def record_state(method, path, fields):
    """fields: [(이름, 예시 값)] 공개 문서 예시에서 온 것만"""
    return {"api_method": method, "object_path_in_response": path,
            "fields": [{"name": n, "example": v} for n, v in fields]}


def record_questions(fields):
    crit = {n: "The field `%s` holds the identifier of this object itself." % n for n, _ in fields}
    crit["none"] = "No field identifies this object itself; the fields only describe it or point to other objects."
    return {"is_entity": RECORD_ENTITY,
            "own_identifier": {"type": "choice", "instructions": "Which field holds the identifier of this object itself?",
                               "criteria": crit}}


TASKS["records"] = {"questions": None, "thresholds": {"is_entity": 0.7, "own_identifier": 0.6}}


# ---------------------------------------------------------------------- 과제: 조합 레코드의 부분 (루프 19)
def part_question(name):
    return {"type": "noul",
            "instructions": "The field `%s` holds the identifier of another object that this record connects." % name,
            "criteria": {"true": "For example `customer_id` in an order line that connects an order and a customer.",
                         "false": "For example a timestamp, a count, a display name, or the record's own identifier."}}


def record_questions2(fields, max_parts=12):
    q = record_questions(fields)
    for n, _ in fields[:max_parts]:
        q["part__" + n] = part_question(n)
    return q


# ---------------------------------------------------------------------- 과제: 부모 안 키의 독립성 (2026-10-18 D5)
LOCAL_INDEPENDENT = {
    "type": "noul",
    "instructions": "The value of the last path parameter names an entity that exists on its own outside the parent, and the "
                    "same value names that same entity under every parent.",
    "criteria": {
        "true": "For example `/stores/{storeId}/products/{sku}` where one sku is the same product in every store, or "
                "`/courses/{courseId}/students/{studentId}` where one student id is the same person in every course.",
        "false": "For example `/orders/{orderId}/lines/{lineNumber}` where line 1 of one order is unrelated to line 1 of "
                 "another, or `/books/{bookId}/chapters/{chapterNo}`.",
    },
}
LOCAL_IS_LINK = {
    "type": "noul",
    "instructions": "The record at this endpoint describes the connection between the parent and the entity named by the last "
                    "path parameter, such as its role, grant or status in that parent.",
    "criteria": {
        "true": "For example an enrollment record of a student in a course, or a stock level of a product in a store.",
        "false": "For example a chapter of a book, or a line of an order.",
    },
}


def local_state(endpoint, key_param, parent_params, schema, fields):
    return {"endpoint": endpoint, "last_path_parameter": key_param, "parent_path_parameters": parent_params,
            "record_schema": schema, "record_fields": fields}


LOCAL_OTHER_KIND = {
    "type": "noul",
    "instructions": "The last path parameter holds the identifier of a different kind of entity than the parent, an entity that "
                    "is not created inside the parent.",
    "criteria": {
        "true": "For example `/stores/{storeId}/products/{sku}`, where a product is defined once and stocked in many stores, or "
                "`/courses/{courseId}/students/{studentId}`, where a student exists before joining a course.",
        "false": "For example `/orders/{orderId}/lines/{lineNumber}`, where a line is created inside its order, or "
                 "`/books/{bookId}/chapters/{chapterNo}`, where a chapter belongs to one book.",
    },
}
LOCAL_SAME_VALUE = {
    "type": "noul",
    "instructions": "Two different parents that use the same value of the last path parameter point to the same entity.",
    "criteria": {
        "true": "For example the same sku under two stores is the same product.",
        "false": "For example line 1 under two orders are two unrelated lines.",
    },
}


def local_questions():
    # 2026-10-18 시범: 독립성 진술은 Google 토큰 0.34, 그룹 회원 0.58 로 낮았다. 원자 둘(other_kind, same_value)로 나눠도
    # same_value 가 거의 모든 경우 0.1~0.4 라 더 나빴다 (LOCAL_OTHER_KIND, LOCAL_SAME_VALUE 는 기록으로 남김).
    # 연결 진술(is_link)은 회원 0.94, 토큰 0.85, 라벨 0.11, 스레드 0.10 으로 갈렸다. 판정은 is_link 만 쓴다 (map3, 0.8 이상)
    return {"independent": LOCAL_INDEPENDENT, "is_link": LOCAL_IS_LINK}


TASKS["locals"] = {"questions": None, "thresholds": {"independent": 0.7}}


# 연결 레코드의 마지막 키가 누구의 id 인가 (D5 2차, 2026-10-18). is_link 0.8 이상인 부모 안 공간에만 묻는다
LOCAL_KEY_ROLE = {
    "type": "choice",
    "instructions": "The last path parameter holds the identifier of which thing?",
    "criteria": {
        "connection_record": "An id issued to the connection record itself, for example `enrollmentId` in "
                             "`/courses/{courseId}/enrollments/{enrollmentId}`.",
        "connected_entity": "The id of the other entity that the parent is connected to, for example `studentId` in "
                            "`/courses/{courseId}/students/{studentId}`.",
    },
}


def localkey_questions():
    return {"key_role": LOCAL_KEY_ROLE}


# 복합키 재료 필드의 대상 (2026-10-18): 예시 값이 없거나 자리 표시라 원문 ID 형식으로 못 정한 필드
def keyfield_question(options):
    """options: {공간 이름: 설명}. none 을 함께 둔다"""
    crit = dict(options)
    crit["none"] = "The field holds no identifier of these objects, for example a name, a time, a scope list or a status."
    return {"target": {"type": "choice", "instructions": "The field holds the identifier of which kind of object?", "criteria": crit}}


def keyfield_state(method, path, field, siblings):
    return {"api_method": method, "record_path_in_response": path, "field": field, "other_fields_in_record": siblings}



def list_part_question(name):
    """문자열 배열용 (2026-10-18 원인 B): 조건의 include, exclude 처럼 대상 목록을 담는 배열. part_question 의 「연결」 진술로는
    Okta 정책 조건 그룹 목록이 0.34 였다"""
    return {"type": "noul",
            "instructions": "The list `%s` holds identifiers of other objects, such as the ids of the members, targets or "
                            "scopes it selects." % name,
            "criteria": {"true": "For example `parcelIds` in a shipment, or `allowedWarehouseIds` in a delivery rule.",
                         "false": "For example a list of tags, of free-text labels, of permission names, or of enum keywords "
                                  "such as ALL or EVERYONE."}}
