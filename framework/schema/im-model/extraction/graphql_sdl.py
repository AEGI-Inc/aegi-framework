# -*- coding: utf-8 -*-
"""GraphQL SDL -> 타입 표 (2026-10-15). GitHub schema.docs.graphql 용. 형식 변환만 한다.

정의 하나가 행 하나다: name, kind(object, interface, union, enum, input, scalar), implements, fields, possible_types.
필드는 이름, 가리키는 타입 이름, 목록 여부, 필수 여부, 인자 이름. 설명 문자열("..." 와 \"\"\"...\"\"\")은 버린다.
"""
import re

KINDS = {"type": "object", "interface": "interface", "union": "union", "enum": "enum", "input": "input", "scalar": "scalar"}


def strip(text):
    text = re.sub(r'"""[\s\S]*?"""', " ", text)               # 블록 설명
    text = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', text)           # 한 줄 문자열 (지시어 인자 값)
    text = re.sub(r"#[^\n]*", " ", text)
    return text


def balanced(text, i, open_, close):
    """text[i] 가 open_ 일 때 짝이 맞는 close 다음 위치"""
    depth = 0
    for j in range(i, len(text)):
        if text[j] == open_:
            depth += 1
        elif text[j] == close:
            depth -= 1
            if depth == 0:
                return j + 1
    return len(text)


def no_directives(s):
    out, i = [], 0
    while i < len(s):
        m = re.compile(r"@\w+\s*").match(s, i)
        if m:
            i = m.end()
            if i < len(s) and s[i] == "(":
                i = balanced(s, i, "(", ")")
            continue
        out.append(s[i])
        i += 1
    return "".join(out)


def parse_type(t):
    t = t.strip()
    lst = t.startswith("[")
    name = re.sub(r"[\[\]!\s]", "", t)
    return name, lst, t.endswith("!")


def parse_fields(body):
    fields, i = [], 0
    body = no_directives(body)
    while i < len(body):
        m = re.compile(r"\s*(\w+)\s*").match(body, i)
        if not m:
            i += 1
            continue
        name, i = m.group(1), m.end()
        args = []
        if i < len(body) and body[i] == "(":
            j = balanced(body, i, "(", ")")
            args = re.findall(r"(\w+)\s*:", body[i + 1:j - 1])
            i = j
        m = re.compile(r"\s*:\s*([\[\]\w!\s]+?)(?=\s*=|\s+\w+\s*[:(]|\s*$)", re.S).match(body, i)
        if not m:                                              # enum 값
            fields.append({"name": name})
            continue
        tname, lst, req = parse_type(m.group(1))
        fields.append({"name": name, "type": tname, "list": lst, "required": req, "args": args})
        i = m.end()
        d = re.compile(r"\s*=\s*").match(body, i)            # 입력 필드 기본값
        if d:
            i = d.end()
            if i < len(body) and body[i] in "[{":
                i = balanced(body, i, body[i], "]" if body[i] == "[" else "}")
            else:
                i = re.compile(r"\S+").match(body, i).end()
    return fields


def parse(text):
    text = strip(text)
    rows, i = [], 0
    head = re.compile(r"\b(extend\s+)?(type|interface|union|enum|input|scalar)\s+(\w+)")
    while True:
        m = head.search(text, i)
        if not m:
            break
        kind, name = KINDS[m.group(2)], m.group(3)
        j = m.end()
        # 머리: implements ... 와 지시어, 그리고 { 또는 = 또는 다음 정의
        k = j
        while k < len(text) and text[k] not in "{=":
            if head.match(text, k) and k > j:
                break
            if text[k] == "@":
                mm = re.compile(r"@\w+\s*").match(text, k)
                k = mm.end()
                if k < len(text) and text[k] == "(":
                    k = balanced(text, k, "(", ")")
                continue
            k += 1
        headtxt = no_directives(text[j:k])
        row = {"name": name, "kind": kind}
        mi = re.search(r"implements\s+([\w\s&,]+)", headtxt)
        if mi:
            row["implements"] = sorted(x for x in re.split(r"[\s&,]+", mi.group(1)) if x)
        if k < len(text) and text[k] == "{":
            e = balanced(text, k, "{", "}")
            row["fields"] = parse_fields(text[k + 1:e - 1])
            i = e
        elif k < len(text) and text[k] == "=":
            mm = re.compile(r"=\s*\|?\s*(\w+(?:\s*\|\s*\w+)*)").match(text, k)
            row["possible_types"] = sorted(re.split(r"\s*\|\s*", mm.group(1).strip()))
            i = mm.end()
        else:
            i = k
        rows.append(row)
    # 인터페이스 구현 타입
    impl = {}
    for r in rows:
        for x in r.get("implements", []):
            impl.setdefault(x, []).append(r["name"])
    for r in rows:
        if r["kind"] == "interface":
            r["possible_types"] = sorted(impl.get(r["name"], []))
    return rows
