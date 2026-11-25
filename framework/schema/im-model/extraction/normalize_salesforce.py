# -*- coding: utf-8 -*-
"""② Salesforce Object Reference (공식 PDF) -> 공통 형식. extraction = parser@1 (PyMuPDF 텍스트).

    python normalize_salesforce.py

2026-10-14 추가 자료 (snapshot_2026-10-13):
- Platform Events 안내서: 표준 플랫폼 이벤트와 실시간 이벤트 모니터링 객체(LoginEvent, ApiEvent, PermissionSetEvent ...)의
  필드 -> 이벤트 payload 자리 (side=payload, op_id=event:<이름>). 「Supported Calls」에 query() 가 있는 저장 객체(*Store,
  LoginEvent 같은 big object)는 sObject 처럼 조회 동작도 만든다
- Object Reference 의 「EventLogFile Supported Event Types」: 유형마다 필드 -> 감사 action (catalog=audit, category=event_log_file)과
  감사 필드 자리 (side=audit, op_id=audit:<필드>)
- Change Data Capture 안내서의 ChangeEventHeader 필드 -> 변경 이벤트 payload 자리 (event:change_event)
- Mobile SDK 안내서 「Scope Parameter Values」 표의 (scope 이름) -> 권한 어휘
- REST API 안내서 Reference 의 URI, HTTP Method -> sObject 밖 리소스 동작 (Limits, Query, sObject User Password ...)

Salesforce 는 대상 타입이 API 경로가 아니라 객체 정의(sObject)에 있다. 객체마다
- 「Supported Calls」(query, retrieve, create, update, delete ...) 를 표준 sObject REST 동작으로 펼친다
  (query -> GET /sobjects/<Object>, retrieve -> GET /sobjects/<Object>/{Id}, 나머지는 같은 경로의 POST/PATCH/DELETE)
- 필드 블록(Type, 이름, Properties, Refers To)을 응답 레코드의 필드로 옮긴다. 참조 대상(Refers To)은 ref_targets 로 둔다
자연어 설명(Description)은 옮기지 않는다.
"""
import hashlib
import io
import json
import os
import re
import sys

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", ".."))
PDF = "salesforce_api_list/snapshot_2026-10-12/raw/resources.docs.salesforce.com__latest__latest__en-us__sfdc__pdf__object_reference.pdf"
OUT = os.path.join(HERE, "out", "salesforce", "ir")
CALLS = {"query()": ("GET", "list"), "retrieve()": ("GET", "get"), "create()": ("POST", "create"),
         "update()": ("PATCH", "update"), "delete()": ("DELETE", "delete")}
NOISE = {"Details", "Field Name", "Standard Objects", "Field", "Type", "Properties", "Description"}
S13 = "salesforce_api_list/snapshot_2026-10-13/raw/resources.docs.salesforce.com__latest__latest__en-us__sfdc__pdf__"
SOURCES = {
    "sf_platform_events": S13 + "platform_events.pdf",
    "sf_change_data_capture": S13 + "salesforce_change_data_capture.pdf",
    "sf_mobile_sdk": S13 + "mobile_sdk.pdf",
    "sf_rest_api": S13 + "api_rest.pdf",
    "sf_metadata_api": S13 + "api_meta.pdf",
}
# REST 안내서 경로의 변수 이름 (문서는 {} 없이 쓴다). 이 이름의 경로 조각은 파라미터다
REST_VARS = {"sObject", "sObjectName", "SobjectName", "id", "Id", "ID", "userId", "selfServiceUserId", "fieldName", "fieldValue",
             "layoutName", "recordTypeId", "actionName", "listViewID", "queryLocator", "blobField", "approvalProcessName",
             "workflowRuleId", "eventName", "schemaId", "relationshipFieldName", "developerName", "contextId",
             "contentReferenceId", "NQ_API_NAME", "OpportunityLineItemId", "ExternalIdFieldName",
             "embeddedServiceConfigDeveloperName", "richTextImageFields", "language", "category", "action"}
# sObject 일반 CRUD 경로는 객체별 동작(Object Reference)과 겹쳐 뺀다. User 비밀번호처럼 객체 이름이 박힌 경로는 남는다
REST_SKIP_PREFIXES = ("/sobjects/{sObject}",)
FTYPES = {"boolean": "boolean", "int": "integer", "double": "number", "long": "integer", "currency": "number", "percent": "number"}
META_KNOWN_TYPES = {"string", "boolean", "int", "integer", "double", "number", "datetime", "date", "textarea",
                    "url", "email", "phone", "id", "picklist", "enumeration", "base64", "anytype"}


def parse_meta_type(doc, page, end_page, title, nxt_title):
    """Metadata API 안내서(api_meta.pdf)의 한 설정 유형 구간 -> 필드 목록"""
    lines = []
    for p in range(page - 1, min(end_page, doc.page_count)):
        txt = doc[p].get_text()
        lines += [l.strip() for l in txt.split("\n") if l.strip()]
    if title in lines:
        lines = lines[lines.index(title):]
    if nxt_title and nxt_title in lines:
        lines = lines[:lines.index(nxt_title)]
    if "Fields" not in lines:
        return []
    f_idx = lines.index("Fields")
    sub = lines[f_idx + 1:]
    stop_words = {"Declarative Metadata Sample Definition", "Usage", "SEE ALSO", "Associated Objects", "Wildcard Support in the Manifest File"}
    end_idx = len(sub)
    for i, l in enumerate(sub):
        if l in stop_words:
            end_idx = i
            break
    sub = sub[:end_idx]
    clean = [l for l in sub if not re.match(r"^\d+$", l) and l not in ("Metadata Types", title, "Description", "Field Type", "Field Name", "Field")]
    fields = []
    for i in range(len(clean) - 1):
        w1, w2 = clean[i], clean[i + 1]
        if (w1.lower() in META_KNOWN_TYPES or re.match(r"^[A-Z][A-Za-z0-9]+(\[\])?$", w1)) and re.match(r"^[a-z][A-Za-z0-9_]*$", w2):
            if w2 not in ("string", "boolean", "true", "false", "field", "type", "name", "description"):
                fields.append(dict(name=w2, type=w1))
        elif re.match(r"^[a-z][A-Za-z0-9_]*$", w1) and (w2.lower() in META_KNOWN_TYPES or re.match(r"^[A-Z][A-Za-z0-9]+(\[\])?$", w2)):
            if w1 not in ("string", "boolean", "true", "false", "field", "type", "name", "description"):
                fields.append(dict(name=w1, type=w2))
    res = {}
    for f in fields:
        res.setdefault(f["name"], f)
    return list(res.values())



def toc_sections(doc, under=None):
    """목차 항목 -> (단계, 제목, 시작 쪽, 끝 쪽, 다음 제목). under 가 주어지면 그 제목 아래 항목만"""
    toc = doc.get_toc()
    out, on, lvl0 = [], under is None, None
    for n, (lvl, title, page) in enumerate(toc):
        if under is not None:
            if title.strip() == under:
                on, lvl0 = True, lvl
                continue
            if on and lvl <= lvl0:
                on = False
        if not on:
            continue
        nxt = next((m for m in range(n + 1, len(toc)) if toc[m][0] <= lvl), None)
        end = toc[nxt][2] if nxt is not None else page + 1
        out.append((lvl, title.strip(), page, max(end, page), toc[nxt][1].strip() if nxt is not None else None))
    return out


def section_lines(doc, page, end, title, nxt_title):
    """제목 줄부터 다음 제목 줄 앞까지의 줄.
    시작은 시작 쪽에서 제목 줄의 마지막 등장(같은 쪽의 「IN THIS SECTION」 목록을 건너뛴다),
    끝은 다음 항목의 시작 쪽에서 그 제목 줄의 첫 등장(본문 「SEE ALSO」 링크의 같은 이름에서 끊지 않는다)"""
    rows, foot = [], set()
    for pg in range(page - 1, min(end, doc.page_count)):
        ls = doc[pg].get_text().split("\n")
        foot |= {len(rows) + k for k in range(max(0, len(ls) - 5), len(ls))}   # 쪽 아래 머리글(장 제목, 쪽 번호)
        rows += [(pg + 1, l.strip()) for l in ls]
    starts = [i for i, (pg, l) in enumerate(rows) if pg == page and l == title and i not in foot]
    if starts:
        rows = rows[starts[-1]:]
    if nxt_title:
        cut = next((i for i, (pg, l) in enumerate(rows) if i > 0 and pg == end and l == nxt_title), None)
        if cut is not None:
            rows = rows[:cut]
    return [l for _, l in rows]


def pe_fields(lines):
    """「이름 / Type: x / Properties: ...」 꼴 필드"""
    out = []
    for i in range(len(lines) - 1):
        m = re.match(r"^Type:\s*([A-Za-z]+)", lines[i + 1])
        if m and re.match(r"^[A-Z][A-Za-z0-9_]*$", lines[i]):
            out.append(dict(name=lines[i], type=m.group(1)))
    return list({f["name"]: f for f in out}.values())


def write(name, rows):
    os.makedirs(OUT, exist_ok=True)
    rows = sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
    with io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    return len(rows)


def parse_section(lines, obj):
    """한 객체 구간의 줄들 -> (supported calls, fields)"""
    text = "\n".join(lines)
    m = re.search(r"Supported Calls\n(.+?)\n(?:Special Access Rules|Fields|Usage|SEE ALSO)", text, re.S)
    calls = sorted(set(re.findall(r"[a-zA-Z]+\(\)", m.group(1)))) if m else []
    fields, i = [], 0
    clean = [l.strip() for l in lines if l.strip() and not re.match(r"^\d+$", l.strip()) and l.strip() != obj]
    while i < len(clean) - 2:
        if clean[i] == "Type" and re.match(r"^[a-zA-Z ]+$", clean[i + 1]) and re.match(r"^[A-Za-z][A-Za-z0-9_]*$", clean[i + 2]):
            ftype, fname = clean[i + 1].strip(), clean[i + 2]
            j, refs, props = i + 3, [], []
            while j < len(clean) and clean[j] != "Type":
                if clean[j] == "Properties" and j + 1 < len(clean):
                    props = [p.strip() for p in clean[j + 1].split(",")]
                if clean[j] == "Refers To":
                    k = j + 1
                    while k < len(clean) and clean[k] not in NOISE and not clean[k].startswith(("Relationship", "This ", "The ")):
                        refs += [x.strip() for x in clean[k].split(",") if re.match(r"^[A-Z][A-Za-z0-9_]*$", x.strip())]
                        if not clean[k].rstrip().endswith(","):
                            break
                        k += 1
                if clean[j] in ("Usage", "SEE ALSO:", "Associated Objects"):
                    break
                j += 1
            fields.append(dict(name=fname, type=ftype, props=props, refs=sorted(set(refs))))
            i = j
        else:
            i += 1
    return calls, fields


def main():
    pdf = os.path.join(NEMO, PDF)
    doc = fitz.open(pdf)
    toc = doc.get_toc()
    dest = doc.get_toc(simple=False)
    sha = hashlib.sha256(open(pdf, "rb").read()).hexdigest()
    ops, fields, vocab = {}, [], {}
    objects = 0
    for n, (lvl, title, page) in enumerate(toc):
        obj = title.strip()
        if not re.match(r"^[A-Z][A-Za-z0-9_]+$", obj):
            continue
        nxt = next((m for m in range(n + 1, len(toc)) if toc[m][2] > page), None)
        end = toc[nxt][2] if nxt is not None else page + 1
        lines = []
        for pg in range(page - 1, min(end, doc.page_count)):
            to = dest[nxt][3].get("to") if nxt is not None else None
            if pg == end - 1 and to is not None:
                # 마지막 쪽에서는 다음 목차 항목의 제목 블록 위만 읽는다 (CaseTag 에 CaseTeamMember 필드가 섞이던 문제).
                # 목차 링크 높이는 쪽 맨 위 기본값일 때가 있어, 그 높이 아래에서 제목과 같은 첫 줄 블록을 찾는다
                r = doc[pg].rect
                top = r.height - to.y - 5
                ys = [b[1] for b in doc[pg].get_text("blocks")
                      if b[1] >= top and b[4].split("\n")[0].strip() == toc[nxt][1].strip()]
                lines += (doc[pg].get_text(clip=fitz.Rect(0, 0, r.width, min(ys))) if ys else doc[pg].get_text()).split("\n")
            else:
                lines += doc[pg].get_text().split("\n")
        # 객체 구간은 제목 줄에서 시작하고 Supported Calls 가 있다
        if obj not in lines or "Supported Calls" not in lines:
            continue
        lines = lines[lines.index(obj):]
        calls, fl = parse_section(lines, obj)
        if not calls or not fl:
            continue
        objects += 1
        src = {"source": "sf_object_reference", "at": "%s p.%d" % (obj, page)}
        for call in calls:
            if call not in CALLS:
                continue
            verb, kind = CALLS[call]
            path = "/sobjects/%s" % obj if kind in ("list", "create") else "/sobjects/%s/{Id}" % obj
            op_id = "salesforce.%s.%s" % (obj, call[:-2])
            params = [dict(name="Id", **{"in": "path"}, required=True, type="string")] if "{Id}" in path else []
            if kind in ("create", "update"):
                body = [f for f in fl if ("Create" if kind == "create" else "Update") in f["props"]]
                params += [dict(name=f["name"], **{"in": "body"}, required=False, type=f["type"]) for f in body]
                # 요청 본문 자리 (S2 가 응답 항목과 맞춘다). 스키마 이름으로 대상 객체를 알린다
                fields.append(dict(op_id=op_id, side="request", path="$", type="object", schema=obj, src=src))
                for f in body:
                    fields.append(dict(op_id=op_id, side="request", path="$." + f["name"],
                                       type={"boolean": "boolean", "int": "integer", "double": "number"}.get(f["type"], "string"),
                                       sf_type=f["type"], src=src))
            ops[op_id] = dict(op_id=op_id, provider="salesforce", surface="rest", method="%s.%s" % (obj, call[:-2]),
                              path=path, http_method=verb, params=params, scopes=["api"], deprecated=False,
                              has_response=kind in ("list", "get"), src=src)
            if kind in ("list", "get"):
                base = "$.records[*]" if kind == "list" else "$"
                if kind == "list":
                    fields.append(dict(op_id=op_id, side="response", path="$", type="object", src=src))
                    fields.append(dict(op_id=op_id, side="response", path="$.records", type="array", src=src))
                fields.append(dict(op_id=op_id, side="response", path=base, type="object", schema=obj, src=src))
                # 「System Fields」 절: 모든 객체에 Id 가 있다. 객체별 필드 표에는 안 나온다. 다른 시스템 필드는 넣지 않는다
                fields.append(dict(op_id=op_id, side="response", path=base + ".Id", type="string", sf_type="id",
                                   src={"source": "sf_object_reference", "at": "System Fields"}))
                for f in fl:
                    if f["name"] == "Id":
                        continue
                    row = dict(op_id=op_id, side="response", path=base + "." + f["name"],
                               type={"boolean": "boolean", "int": "integer", "double": "number"}.get(f["type"], "string"),
                               sf_type=f["type"], src=src)
                    if f["type"] == "reference" and f["refs"]:
                        row["ref_targets"] = f["refs"]
                    if f["type"] in ("encryptedstring",) or f["name"].lower().endswith(("password", "secret")):
                        row["format"] = "password"
                    if f["type"] == "url":
                        row["format"] = "uri"
                    fields.append(row)
        vocab.setdefault("api", dict(grant_id="salesforce.scope.api", kind="oauth_scope", name="api", op_ids=[],
                                     src={"source": "sf_object_reference", "at": "모든 sObject 동작 (api scope)"}))["op_ids"] += [
            o for o in ops if o.startswith("salesforce.%s." % obj)]
    events, sources = [], {"sf_object_reference": dict(path=PDF, sha256=sha, extraction="parser@1")}
    for sid, rel in SOURCES.items():
        sources[sid] = dict(path=rel, sha256=hashlib.sha256(open(os.path.join(NEMO, rel), "rb").read()).hexdigest(),
                            extraction="parser@1")

    def field_row(op_id, side, path, f, src):
        row = dict(op_id=op_id, side=side, path=path, type=FTYPES.get(f["type"].lower(), "string"), sf_type=f["type"], src=src)
        if f["type"].lower() in ("encryptedstring",) or f["name"].lower().endswith(("password", "secret")):
            row["format"] = "password"
        return row

    # 1) 플랫폼 이벤트와 실시간 이벤트 모니터링 객체
    pe = fitz.open(os.path.join(NEMO, SOURCES["sf_platform_events"]))
    seen_ev = set()
    for lvl, title, page, end, nxt in toc_sections(pe, "Standard Platform Event Object List"):
        name = re.sub(r"\s*\(Beta\)$", "", title)
        if not re.match(r"^[A-Z][A-Za-z0-9]+$", name) or name in seen_ev or name in ("Fields", "Usage", "Example"):
            continue
        lines = section_lines(pe, page, end, title, nxt)
        fl = pe_fields(lines)
        if not fl:
            continue
        seen_ev.add(name)
        src = {"source": "sf_platform_events", "at": "%s p.%d" % (name, page)}
        text = "\n".join(lines)
        m = re.search(r"Supported Calls\n(.+?)\n", text)
        calls = re.findall(r"[a-zA-Z]+\(\)", m.group(1)) if m else []
        if "query()" in calls:                          # 저장 객체: 조회 동작 (big object, *Store)
            op_id = "salesforce.%s.query" % name
            if op_id not in ops:
                ops[op_id] = dict(op_id=op_id, provider="salesforce", surface="rest", method=name + ".query",
                                  path="/sobjects/%s" % name, http_method="GET", params=[], scopes=["api"],
                                  deprecated=False, has_response=True, src=src)
                fields.append(dict(op_id=op_id, side="response", path="$", type="object", src=src))
                fields.append(dict(op_id=op_id, side="response", path="$.records", type="array", src=src))
                fields.append(dict(op_id=op_id, side="response", path="$.records[*]", type="object", schema=name, src=src))
                fields.append(dict(op_id=op_id, side="response", path="$.records[*].Id", type="string", sf_type="id", src=src))
                for f in fl:
                    if f["name"] != "Id":
                        fields.append(field_row(op_id, "response", "$.records[*]." + f["name"], f, src))
                vocab["api"]["op_ids"].append(op_id)
            if name.endswith("Store") or "subscribe()" not in calls:
                continue                                # 저장 객체는 구독하는 이벤트가 아니다
        events.append(dict(event_id="salesforce.event." + name, catalog="event_api", name=name, scopes=[], src=src))
        fields.append(dict(op_id="event:" + name, side="payload", path="$", type="object", src=src))
        for f in fl:
            fields.append(field_row("event:" + name, "payload", "$." + f["name"], f, src))

    # 2) EventLogFile 유형 (Object Reference)
    elf_fields = {}
    for lvl, title, page, end, nxt in toc_sections(doc, "EventLogFile Supported Event Types"):
        if not title.endswith(" Event Type"):
            continue
        lines = section_lines(doc, page, end, title, nxt)
        _, fl = parse_section(lines + ["Type"], title)
        if not fl:
            continue
        name = re.sub(r"[^a-z0-9]+", "_", title[: -len(" Event Type")].lower()).strip("_")
        events.append(dict(event_id="salesforce.audit.action." + name, catalog="audit", name=name, category="event_log_file",
                           display=title, fields=sorted(f["name"] for f in fl),
                           src={"source": "sf_object_reference", "at": "%s p.%d" % (title, page)}))
        for f in fl:
            elf_fields.setdefault(f["name"], f)
    for fname, f in sorted(elf_fields.items()):
        fields.append(dict(op_id="audit:" + fname, side="audit", path="$." + fname, type=FTYPES.get(f["type"].lower(), "string"),
                           sf_type=f["type"], src={"source": "sf_object_reference", "at": "EventLogFile Supported Event Types"}))

    # 3) 변경 데이터 캡처 머리 필드
    cdc = fitz.open(os.path.join(NEMO, SOURCES["sf_change_data_capture"]))
    for lvl, title, page, end, nxt in toc_sections(cdc):
        if title != "ChangeEventHeader Fields":
            continue
        lines = section_lines(cdc, page, end + 2, title, "Change Event Body Fields")
        hdr = []
        for i in range(len(lines) - 1):
            if lines[i] in ("string", "string[]", "Enumeration", "int", "long", "boolean") and re.match(r"^[a-z][A-Za-z]+$", lines[i + 1]):
                hdr.append(dict(name=lines[i + 1], type=lines[i].rstrip("[]"), array=lines[i].endswith("[]")))
        src = {"source": "sf_change_data_capture", "at": "ChangeEventHeader Fields p.%d" % page}
        events.append(dict(event_id="salesforce.event.change_event", catalog="event_api", name="change_event", scopes=[], src=src))
        fields.append(dict(op_id="event:change_event", side="payload", path="$", type="object", src=src))
        fields.append(dict(op_id="event:change_event", side="payload", path="$.ChangeEventHeader", type="object", src=src))
        for h in {x["name"]: x for x in hdr}.values():
            path = "$.ChangeEventHeader." + h["name"]
            if h["array"]:
                fields.append(dict(op_id="event:change_event", side="payload", path=path, type="array", src=src))
                path += "[*]"
            fields.append(dict(op_id="event:change_event", side="payload", path=path,
                               type=FTYPES.get(h["type"].lower(), "string"), src=src))
        break

    # 4) OAuth scope (Mobile SDK 안내서 표)
    mob = fitz.open(os.path.join(NEMO, SOURCES["sf_mobile_sdk"]))
    for lvl, title, page, end, nxt in toc_sections(mob):
        if title != "Scope Parameter Values":
            continue
        text = "\n".join(section_lines(mob, page, end + 1, title, nxt))
        text = text[: text.find("Client Side")] if "Client Side" in text else text
        for grp in re.findall(r"\(([a-z_]+(?:,\s*[a-z_]+)*)\)", text):
            for name in re.split(r",\s*", grp):
                vocab.setdefault(name, dict(grant_id="salesforce.scope." + name, kind="oauth_scope", name=name, op_ids=[],
                                            src={"source": "sf_mobile_sdk", "at": "Scope Parameter Values"}))
        break

    # 5) REST 리소스 (sObject 밖)
    rest = fitz.open(os.path.join(NEMO, SOURCES["sf_rest_api"]))
    ref_page = next(p for l, t, p in rest.get_toc() if t.strip() == "Reference" and l == 1)
    lines = []
    for pg in range(ref_page - 1, rest.page_count):
        lines += [(pg + 1, l) for l in rest[pg].get_text().split("\n")]
    for i, (pg, l) in enumerate(lines):
        m = re.match(r"^\s*URI:?\s*(/services/\S*)?\s*$", l)
        if not m:
            continue
        raw = m.group(1) or (lines[i + 1][1].strip() if i + 1 < len(lines) else "")
        if not raw.startswith("/services/"):
            continue
        meth = []
        for k in range(i + 1, min(i + 12, len(lines) - 1)):
            mm = re.match(r"^\s*HTTP [Mm]ethods?:?\s*(.*)$", lines[k][1])
            if mm:
                meth = re.findall(r"\b(GET|POST|PATCH|PUT|DELETE)\b", mm.group(1) or lines[k + 1][1])
                break
        path = re.sub(r"^/services/data/v[0-9X]+\.[0-9X]+", "", raw.split("?")[0]).rstrip("/") or "/"
        if path.startswith("/services/") or path == "/":
            continue
        segs = ["{%s}" % x if x in REST_VARS else x for x in path.split("/")]
        path = "/".join(segs)
        if path.startswith(REST_SKIP_PREFIXES):
            continue
        for verb in meth:
            op_id = "salesforce.rest.%s%s" % (verb.lower(), path.replace("/", ".").replace("{", "").replace("}", ""))
            if op_id in ops:
                continue
            params = [dict(name=x[1:-1], **{"in": "path"}, required=True, type="string") for x in segs if x.startswith("{")]
            ops[op_id] = dict(op_id=op_id, provider="salesforce", surface="rest", method="%s %s" % (verb, path), path=path,
                              http_method=verb, params=params, scopes=["api"], deprecated=False, has_response=False,
                              src={"source": "sf_rest_api", "at": "p.%d" % pg})
            vocab["api"]["op_ids"].append(op_id)

    # 6) Metadata API 설정 유형 (api_meta.pdf)
    meta_path = os.path.join(NEMO, SOURCES["sf_metadata_api"])
    if os.path.exists(meta_path):
        meta_doc = fitz.open(meta_path)
        meta_toc = meta_doc.get_toc()
        target_meta = {
            "AuthProvider",
            "Certificate",
            "ConnectedApp",
            "CorsWhitelistOrigin",
            "CspTrustedSite",
            "ExternalClientApplication",
            "ExternalCredential",
            "NamedCredential",
            "OauthCustomScope",
            "ProfileSessionSetting",
            "RemoteSiteSetting",
            "TransactionSecurityPolicy",
        }
        meta_calls = {
            "query()": ("GET", "list"),
            "retrieve()": ("GET", "get"),
            "create()": ("POST", "create"),
            "update()": ("PATCH", "update"),
            "delete()": ("DELETE", "delete"),
        }
        for n, (lvl, title, page) in enumerate(meta_toc):
            t_clean = title.strip()
            if t_clean not in target_meta:
                continue
            nxt = meta_toc[n + 1] if n + 1 < len(meta_toc) else (0, "END", page + 5)
            fl = parse_meta_type(meta_doc, page, nxt[2], t_clean, nxt[1].strip())
            if not fl:
                continue
            objects += 1
            src = {"source": "sf_metadata_api", "at": "%s p.%d" % (t_clean, page)}
            fields = [f for f in fields if not f["op_id"].startswith("salesforce.%s." % t_clean)]
            for call, (verb, kind) in meta_calls.items():
                path = "/sobjects/%s" % t_clean if kind in ("list", "create") else "/sobjects/%s/{Id}" % t_clean
                op_id = "salesforce.%s.%s" % (t_clean, call[:-2])
                params = [dict(name="Id", **{"in": "path"}, required=True, type="string")] if "{Id}" in path else []
                if kind in ("create", "update"):
                    body = [f for f in fl if f["name"] != "Id"]
                    params += [dict(name=f["name"], **{"in": "body"}, required=False, type=f["type"]) for f in body]
                    fields.append(dict(op_id=op_id, side="request", path="$", type="object", schema=t_clean, src=src))
                    for f in body:
                        fields.append(dict(op_id=op_id, side="request", path="$." + f["name"],
                                           type=FTYPES.get(f["type"].lower(), "string"), sf_type=f["type"], src=src))
                ops[op_id] = dict(op_id=op_id, provider="salesforce", surface="rest", method="%s.%s" % (t_clean, call[:-2]),
                                  path=path, http_method=verb, params=params, scopes=["api"], deprecated=False,
                                  has_response=kind in ("list", "get"), src=src)
                if kind in ("list", "get"):
                    base = "$.records[*]" if kind == "list" else "$"
                    if kind == "list":
                        fields.append(dict(op_id=op_id, side="response", path="$", type="object", src=src))
                        fields.append(dict(op_id=op_id, side="response", path="$.records", type="array", src=src))
                    fields.append(dict(op_id=op_id, side="response", path=base, type="object", schema=t_clean, src=src))
                    fields.append(dict(op_id=op_id, side="response", path=base + ".Id", type="string", sf_type="id", src=src))
                    for f in fl:
                        if f["name"] == "Id":
                            continue
                        row = dict(op_id=op_id, side="response", path=base + "." + f["name"],
                                   type=FTYPES.get(f["type"].lower(), "string"), sf_type=f["type"], src=src)
                        if f["type"].lower() in ("encryptedstring",) or f["name"].lower().endswith(("password", "secret")):
                            row["format"] = "password"
                        if f["type"].lower() == "url" or f["name"].lower().endswith("url"):
                            row["format"] = "uri"
                        fields.append(row)
                vocab["api"]["op_ids"].append(op_id)

    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))
    counts = dict(objects=objects, operations=write("operations.jsonl", ops.values()), fields=write("fields.jsonl", fields),
                  id_defs=write("id_defs.jsonl", []), events=write("events.jsonl", events),
                  grant_vocab=write("grant_vocab.jsonl", vocab.values()), holes=write("holes.jsonl", []))
    with io.open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=sources, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
