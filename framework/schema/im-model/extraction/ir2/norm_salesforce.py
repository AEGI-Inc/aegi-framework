# -*- coding: utf-8 -*-
"""Salesforce -> IR2. 범위: Object Reference 전체, REST, Platform Events, CDC, EventLogFile, Metadata API (IR 설계.md 1절).

    python norm_salesforce.py

PDF 는 pypdf(순수 파이썬, pdftext.py)로 읽는다. 옛 normalize_salesforce.py 의 구간 자르기와 필드 블록 읽기를 옮겼다.
1. Object Reference: 객체마다 이름 있는 모양(필드 Type, 이름, Properties), 「System Fields」의 Id -> key_decl(stated, 필드 타입 id),
   Refers To -> ref_decl(stated, 대상이 둘 이상이면 poly)
2. 동작은 원문 경로가 아니라 REST 안내서의 일반 규칙을 객체마다 펼친 것이다 (grade transform, 출처 REST 안내서):
   query() -> GET query?q=SELECT ... FROM <객체>, retrieve() -> GET sobjects/<객체>/{id}, create() -> POST sobjects/<객체>,
   update() -> PATCH sobjects/<객체>/{id}, delete() -> DELETE sobjects/<객체>/{id}
3. Platform Events 안내서: 표준 플랫폼 이벤트 -> 이벤트 카탈로그(기계 키 = API 이름), payload 모양(stated). query() 가 있는 저장 객체는
   위 규칙의 조회 동작도 만든다. 목록의 객체는 모두 이벤트 카탈로그로 두고 구독 채널(/event/...)과 지원 호출을 ext 에 남긴다
4. EventLogFile 유형 -> log_type 카탈로그. 기계 키(EventType 값)는 설명 글에만 있어 null 로 둔다
5. CDC 안내서의 ChangeEventHeader 필드 -> 변경 이벤트 카탈로그 payload
6. Mobile SDK 안내서 「Scope Parameter Values」 -> OAuth scope 권한 어휘
7. REST 안내서 Reference 의 URI, HTTP Method -> 동작 (경로 stated, 동작 종류 transform)
8. Metadata API 안내서: 보안 설정 유형 12종 -> 이름 있는 모양 (옛 변환기와 같은 목록). sObject 동작으로 펼치지 않는다
description 은 옮기지 않는다.
"""
import json
import re
import sys

import core
import pdftext

P = "salesforce"
OBJ = "sf_object_reference"
REST = "sf_rest_api"
NOISE = {"Details", "Field Name", "Standard Objects", "Field", "Type", "Properties", "Description", "DetailsField Name", "DetailsField"}
SCALAR = {"boolean": "boolean", "int": "integer", "double": "number", "long": "integer", "currency": "number", "percent": "number"}
REST_VARS = {"sObject", "sObjectName", "SobjectName", "id", "Id", "ID", "userId", "selfServiceUserId", "fieldName", "fieldValue",
             "layoutName", "recordTypeId", "actionName", "listViewID", "queryLocator", "blobField", "approvalProcessName",
             "workflowRuleId", "eventName", "schemaId", "relationshipFieldName", "developerName", "contextId",
             "contentReferenceId", "NQ_API_NAME", "OpportunityLineItemId", "ExternalIdFieldName",
             "embeddedServiceConfigDeveloperName", "richTextImageFields", "language", "category", "action"}
META_TYPES = ("AuthProvider", "Certificate", "ConnectedApp", "CorsWhitelistOrigin", "CspTrustedSite", "ExternalClientApplication",
              "ExternalCredential", "NamedCredential", "OauthCustomScope", "ProfileSessionSetting", "RemoteSiteSetting",
              "TransactionSecurityPolicy")
META_KNOWN_TYPES = {"string", "boolean", "int", "integer", "double", "number", "datetime", "date", "textarea",
                    "url", "email", "phone", "id", "picklist", "enumeration", "base64", "anytype"}
CALL_RULE = {
    "query()": ("GET", "query", "read_many", "REST 안내서 Query 리소스: GET /services/data/vXX.X/query?q=SELECT ... FROM <sObject>"),
    "retrieve()": ("GET", "sobjects/{sObject}/{id}", "read_one", "REST 안내서 sObject Rows: GET /services/data/vXX.X/sobjects/<sObject>/<id>"),
    "create()": ("POST", "sobjects/{sObject}", "create", "REST 안내서 sObject Basic Information: POST /services/data/vXX.X/sobjects/<sObject>"),
    "update()": ("PATCH", "sobjects/{sObject}/{id}", "update", "REST 안내서 sObject Rows: PATCH /services/data/vXX.X/sobjects/<sObject>/<id>"),
    "delete()": ("DELETE", "sobjects/{sObject}/{id}", "delete", "REST 안내서 sObject Rows: DELETE /services/data/vXX.X/sobjects/<sObject>/<id>"),
}


def lines_of(doc, page, end, nxt_title):
    """page 부터 end 쪽 앞까지(1부터 센 쪽) 줄. 마지막 쪽은 다음 목차 제목 줄 앞에서 자른다.
    다음 제목 줄이 여럿이면 뒤 6줄 안에 Supported Calls 나 Fields 가 오는 것을 고른다 (SEE ALSO 목록의 같은 이름을 건너뛴다)"""
    out = []
    for pg in range(page - 1, min(end, doc.page_count)):
        ls = doc.text(pg).split("\n")
        if pg == end - 1 and nxt_title and pg != page - 1:
            hits = [i for i, l in enumerate(ls) if l.strip() == nxt_title]
            good = [i for i in hits if any(x.strip() in ("Supported Calls", "Fields") for x in ls[i + 1:i + 7])]
            cut = (good or hits or [None])[0]
            if cut is not None:
                ls = ls[:cut]
        out += ls
    return out


def toc_sections(doc, under=None):
    toc = doc.get_toc()
    out, on, lvl0 = [], under is None, None
    for n, (lvl, title, page, _) in enumerate(toc):
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
    rows = []
    for pg in range(page - 1, min(end, doc.page_count)):
        rows += [(pg + 1, l.strip()) for l in doc.text(pg).split("\n")]
    starts = [i for i, (pg, l) in enumerate(rows) if pg == page and l == title]
    if starts:
        rows = rows[starts[-1]:]
    if nxt_title:
        cut = next((i for i, (pg, l) in enumerate(rows) if i > 0 and pg == end and l == nxt_title), None)
        if cut is not None:
            rows = rows[:cut]
    return [l for _, l in rows]


def parse_section(lines, obj):
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


def pe_fields(lines):
    out = []
    for i in range(len(lines) - 1):
        m = re.match(r"^Type:\s*([A-Za-z]+)", lines[i + 1])
        if m and re.match(r"^[A-Z][A-Za-z0-9_]*$", lines[i]):
            out.append(dict(name=lines[i], type=m.group(1), props=[], refs=[]))
    return list({f["name"]: f for f in out}.values())


def parse_meta_type(doc, page, end_page, title, nxt_title):
    lines = []
    for p in range(page - 1, min(end_page, doc.page_count)):
        lines += [l.strip() for l in doc.text(p).split("\n") if l.strip()]
    if title in lines:
        lines = lines[lines.index(title):]
    if nxt_title and nxt_title in lines:
        lines = lines[:lines.index(nxt_title)]
    if "Fields" not in lines:
        return []
    sub = lines[lines.index("Fields") + 1:]
    stop = {"Declarative Metadata Sample Definition", "Usage", "SEE ALSO", "Associated Objects", "Wildcard Support in the Manifest File"}
    sub = sub[:next((i for i, l in enumerate(sub) if l in stop), len(sub))]
    clean = [l for l in sub if not re.match(r"^\d+$", l) and l not in ("Metadata Types", title, "Description", "Field Type", "Field Name", "Field")]
    fields = []
    bad = ("string", "boolean", "true", "false", "field", "type", "name", "description")
    for i in range(len(clean) - 1):
        w1, w2 = clean[i], clean[i + 1]
        if (w1.lower() in META_KNOWN_TYPES or re.match(r"^[A-Z][A-Za-z0-9]+(\[\])?$", w1)) and re.match(r"^[a-z][A-Za-z0-9_]*$", w2):
            if w2 not in bad:
                fields.append(dict(name=w2, type=w1))
        elif re.match(r"^[a-z][A-Za-z0-9_]*$", w1) and (w2.lower() in META_KNOWN_TYPES or re.match(r"^[A-Z][A-Za-z0-9]+(\[\])?$", w2)):
            if w1 not in bad:
                fields.append(dict(name=w1, type=w2))
    res = {}
    for f in fields:
        res.setdefault(f["name"], f)
    return list(res.values())


class SF:
    def __init__(self):
        self.ir = core.IR(P)
        self.docs = {}
        self.objects = {}            # 객체 이름 -> (필드 목록, 출처 위치)

    def doc(self, sid):
        if sid not in self.docs:
            self.docs[sid] = pdftext.Doc(core.nemo(core.registry()[sid]["file"]))
        return self.docs[sid]

    def H(self, sid, loc, grade="stated"):
        return {"src": self.ir.src(sid, loc), "grade": grade, "life": self.ir.life()}

    def field_prop(self, f):
        t = f["type"].lower()
        p = {"name": f["name"], "scalar": SCALAR.get(t, "string"), "format": f["type"], "required": False}
        if "Nillable" in f.get("props", []):
            p["nullable"] = True
        if f.get("props") and "Create" not in f["props"] and "Update" not in f["props"]:
            p["read_only"] = True
        return p

    def object_shape(self, sid, name, fields, loc, with_id=True):
        shid = "sh:%s:%s" % (sid, name)
        props = []
        if with_id and not any(f["name"] == "Id" for f in fields):
            props.append({"name": "Id", "scalar": "string", "format": "id", "required": False, "read_only": True})
        props += [self.field_prop(f) for f in fields]
        row = dict(id=shid, name=name, origin="named", kind="object", props=props, **self.H(sid, loc))
        row["ext"] = {"field_properties": {f["name"]: f["props"] for f in fields if f.get("props")}}
        if with_id and not any(f["name"] == "Id" for f in fields):
            row["ext"]["id_from"] = "Object Reference 「System Fields」: 모든 객체에 Id (필드 타입 id) 가 있다"
        self.ir.add("shape", row)
        return shid

    def sobject_ops(self, sid, name, shid, fields, calls, loc):
        for call in calls:
            if call not in CALL_RULE:
                continue
            verb, tmpl, kind, rule = CALL_RULE[call]
            t = tmpl.replace("{sObject}", name)
            oid = "op:%s:%s.%s" % (sid, name, call[:-2])
            request, responses, params = None, [], []
            if "{id}" in t:
                params.append({"name": "id", "in": "path", "required": True, "scalar": "string", "format": "id"})
            if call == "query()":
                params.append({"name": "q", "in": "query", "required": True, "scalar": "string", "format": "soql"})
                rid = "sh:%s:op:%s.query:resp" % (sid, name)
                self.ir.add("shape", dict(id=rid + ".records", name=None, origin="inline", kind="array", items={"shape": shid},
                                          **self.H(REST, rule, "transform")))
                self.ir.add("shape", dict(id=rid, name=None, origin="inline", kind="object",
                                          props=[{"name": "totalSize", "scalar": "integer", "required": False},
                                                 {"name": "done", "scalar": "boolean", "required": False},
                                                 {"name": "nextRecordsUrl", "scalar": "string", "required": False},
                                                 {"name": "records", "shape": rid + ".records", "required": False}],
                                          **self.H(REST, rule, "transform")))
                responses = [{"status": "200", "media": "application/json", "shape": rid}]
            elif call == "retrieve()":
                responses = [{"status": "200", "media": "application/json", "shape": shid}]
            elif call in ("create()", "update()"):
                want = "Create" if call == "create()" else "Update"
                rid = "sh:%s:op:%s.%s:req" % (sid, name, call[:-2])
                self.ir.add("shape", dict(id=rid, name=None, origin="inline", kind="object",
                                          props=[self.field_prop(f) for f in fields if want in f.get("props", [])],
                                          **self.H(REST, rule, "transform")))
                request = rid
                if call == "create()":                    # REST 안내서: 생성 응답은 {id, success, errors} (201)
                    cid = "sh:%s:SaveResult" % REST
                    if not self.ir.has("shape", cid):
                        self.ir.add("shape", dict(id=cid + ".errors", name=None, origin="inline", kind="array",
                                                  items={"scalar": "any"}, **self.H(REST, rule, "transform")))
                        self.ir.add("shape", dict(id=cid, name=None, origin="inline", kind="object",
                                                  props=[{"name": "id", "scalar": "string", "format": "id", "required": False},
                                                         {"name": "success", "scalar": "boolean", "required": False},
                                                         {"name": "errors", "shape": cid + ".errors", "required": False}],
                                                  **self.H(REST, rule, "transform")))
                    responses = [{"status": "201", "media": "application/json", "shape": cid}]
                else:
                    responses = [{"status": "204", "media": None, "shape": None}]
            else:
                responses = [{"status": "204", "media": None, "shape": None}]
            row = dict(id=oid, surface="rest", name="%s.%s" % (name, call[:-2]), method=verb, kind=kind, kind_grade="transform",
                       path={"template": t, "positions": core.path_positions(t)}, params=params, request=request,
                       responses=responses, grants=["gr:oauth_scope:api"], **self.H(REST, rule, "transform"))
            row["ext"] = {"object": name, "object_source": "%s %s" % (sid, loc), "supported_call": call}
            if call == "query()":
                row["ext"]["soql_from"] = name
            self.ir.add("operation", row)
            self.api_ops.append(oid)

    # ------------------------------------------------------------------ 1, 2
    def object_reference(self):
        doc = self.doc(OBJ)
        toc = doc.get_toc()
        self.api_ops = []
        refs = []
        for n, (lvl, title, page, top) in enumerate(toc):
            obj = title.strip()
            if not re.match(r"^[A-Z][A-Za-z0-9_]+$", obj) or obj in self.objects:
                continue
            nxt = next((m for m in range(n + 1, len(toc)) if toc[m][2] > page), None)
            end = toc[nxt][2] if nxt is not None else page + 1
            lines = [l.strip() for l in lines_of(doc, page, end, toc[nxt][1].strip() if nxt is not None else None)]
            if obj not in lines or "Supported Calls" not in lines:
                continue
            lines = lines[lines.index(obj):]
            calls, fl = parse_section(lines, obj)
            if not calls or not fl:
                continue
            loc = "%s p.%d" % (obj, page)
            self.objects[obj] = (fl, loc)
            shid = self.object_shape(OBJ, obj, fl, loc)
            self.ir.add("key_decl", dict(id="kd:%s" % shid, shape=shid, props=["Id"], form="global",
                                         evidence="sObject 필드 타입 id (System Fields 의 Id)", **self.H(OBJ, "System Fields")))
            self.sobject_ops(OBJ, obj, shid, fl, calls, loc)
            for f in fl:
                if f["type"].lower() == "reference" and f["refs"]:
                    refs.append((obj, f, loc))
                elif f["type"].lower() == "reference":
                    self.ir.add("hole", dict(id="hole:ref_target_unstated:%s.%s" % (obj, f["name"]),
                                             at={"shape": shid}, hole="untyped_field_list",
                                             reason="reference 필드 %s 에 Refers To 가 없다 (참조 대상 미정)" % f["name"], **self.H(OBJ, loc)))
        merged = {}
        for obj, f, loc in refs:                          # 같은 객체에 같은 이름 필드가 둘 읽히면 Refers To 를 합친다
            k = (obj, f["name"])
            if k in merged:
                merged[k][1]["refs"] = sorted(set(merged[k][1]["refs"]) | set(f["refs"]))
            else:
                merged[k] = (obj, dict(f), loc)
        for obj, f, loc in merged.values():
            shid = "sh:%s:%s" % (OBJ, obj)
            to = [r for r in f["refs"] if r in self.objects]
            row = dict(id="rd:%s.%s" % (shid, f["name"]), to={"shapes": ["sh:%s:%s" % (OBJ, r) for r in to]}, poly=len(f["refs"]) > 1,
                       **self.H(OBJ, "%s %s Refers To" % (loc, f["name"])), **{"from": {"shape": shid, "prop": f["name"]}})
            miss = [r for r in f["refs"] if r not in self.objects]
            row["ext"] = {"refers_to": f["refs"]}
            if miss:
                row["ext"]["targets_not_in_object_reference"] = miss
            self.ir.add("ref_decl", row)

    # ------------------------------------------------------------------ 3, 4, 5
    def events(self):
        sid = "sf_platform_events"
        pe = self.doc(sid)
        seen = set()
        for lvl, title, page, end, nxt in toc_sections(pe, "Standard Platform Event Object List"):
            name = re.sub(r"\s*\(Beta\)$", "", title)
            if not re.match(r"^[A-Z][A-Za-z0-9]+$", name) or name in seen or name in ("Fields", "Usage", "Example"):
                continue
            lines = section_lines(pe, page, end, title, nxt)
            fl = pe_fields(lines)
            if not fl:
                continue
            seen.add(name)
            loc = "%s p.%d" % (name, page)
            shid = self.object_shape(sid, name, fl, loc, with_id=False)
            text = "\n".join(lines)
            m = re.search(r"Supported Calls\n(.+?)\n", text)
            calls = re.findall(r"[a-zA-Z]+\(\)", m.group(1)) if m else []
            if "query()" in calls and name not in self.objects:
                self.sobject_ops(sid, name, shid, fl, ["query()"], loc)
            chan = next((lines[i + 1] for i, l in enumerate(lines[:-1]) if l == "Subscription Channel"
                         and lines[i + 1].startswith("/")), None)
            row = dict(id="cat:event:%s" % name, catalog="event", key=name, display=None, category="Standard Platform Event Object List",
                       payload=shid, targets=[], **self.H(sid, loc))
            row["ext"] = {"supported_calls": calls, "beta": title.endswith("(Beta)"), "channel": chan}
            self.ir.add("catalog", row)
        # EventLogFile 유형
        doc = self.doc(OBJ)
        for lvl, title, page, end, nxt in toc_sections(doc, "EventLogFile Supported Event Types"):
            if not title.endswith(" Event Type"):
                continue
            lines = section_lines(doc, page, end, title, nxt)
            _, fl = parse_section(lines + ["Type"], title)
            if not fl:
                continue
            loc = "%s p.%d" % (title, page)
            pid = "sh:%s:elf:%s" % (OBJ, title)
            self.ir.add("shape", dict(id=pid, name=None, origin="inline", kind="object", props=[self.field_prop(f) for f in fl],
                                      **self.H(OBJ, loc)))
            row = dict(id="cat:log_type:%s" % title, catalog="log_type", key=None, display=title, category="EventLogFile",
                       payload=pid, targets=[], **self.H(OBJ, loc))
            row["ext"] = {"key_note": "기계 키(EventType 값)는 EVENT_TYPE 필드 설명 글에만 있다. 설명은 읽지 않는다"}
            self.ir.add("catalog", row)
        # CDC 머리
        sid = "sf_change_data_capture"
        cdc = self.doc(sid)
        for lvl, title, page, end, nxt in toc_sections(cdc):
            if title != "ChangeEventHeader Fields":
                continue
            lines = section_lines(cdc, page, end + 2, title, "Change Event Body Fields")
            hdr = []
            for i in range(len(lines) - 1):
                if lines[i] in ("string", "string[]", "Enumeration", "int", "long", "boolean") and re.match(r"^[a-z][A-Za-z]+$", lines[i + 1]):
                    hdr.append(dict(name=lines[i + 1], type=lines[i].rstrip("[]"), array=lines[i].endswith("[]")))
            loc = "ChangeEventHeader Fields p.%d" % page
            hid = "sh:%s:ChangeEventHeader" % sid
            props = []
            for h in {x["name"]: x for x in hdr}.values():
                if h["array"]:
                    aid = "%s.%s" % (hid, h["name"])
                    self.ir.add("shape", dict(id=aid, name=None, origin="inline", kind="array",
                                              items={"scalar": SCALAR.get(h["type"].lower(), "string")}, **self.H(sid, loc)))
                    props.append({"name": h["name"], "shape": aid, "required": False})
                else:
                    props.append({"name": h["name"], "scalar": SCALAR.get(h["type"].lower(), "string"), "format": h["type"], "required": False})
            self.ir.add("shape", dict(id=hid, name="ChangeEventHeader", origin="named", kind="object", props=props, **self.H(sid, loc)))
            pid = "sh:%s:ChangeEvent" % sid
            self.ir.add("shape", dict(id=pid, name=None, origin="inline", kind="object",
                                      props=[{"name": "ChangeEventHeader", "shape": hid, "required": True}], **self.H(sid, loc)))
            self.ir.add("catalog", dict(id="cat:event:change_event", catalog="event", key=None, display="ChangeEventHeader Fields",
                                        category="change_data_capture", payload=pid, targets=[], **self.H(sid, loc)))
            break

    # ------------------------------------------------------------------ 6, 7, 8
    def scopes_rest_meta(self):
        sid = "sf_mobile_sdk"
        mob = self.doc(sid)
        for lvl, title, page, end, nxt in toc_sections(mob):
            if title != "Scope Parameter Values":
                continue
            text = "\n".join(section_lines(mob, page, end + 1, title, nxt))
            text = text[: text.find("Client Side")] if "Client Side" in text else text
            for grp in re.findall(r"\(([a-z_]+(?:,\s*[a-z_]+)*)\)", text):
                for name in re.split(r",\s*", grp):
                    gid = "gr:oauth_scope:%s" % name
                    if not self.ir.has("grant", gid):
                        self.ir.add("grant", dict(id=gid, kind="oauth_scope", name=name, operations=[], **self.H(sid, "Scope Parameter Values")))
            break
        rest = self.doc(REST)
        toc = rest.get_toc()
        ref_page = next(p for l, t, p, _ in toc if t.strip() == "Reference" and l == 1)
        lines = []
        for pg in range(ref_page - 1, rest.page_count):
            lines += [(pg + 1, l) for l in rest.text(pg).split("\n")]
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
                    meth = re.findall(r"\b(GET|POST|PATCH|PUT|DELETE|HEAD)\b", mm.group(1) or lines[k + 1][1])
                    break
            path = re.sub(r"^/services/data/v[0-9X]+\.[0-9X]+", "", raw.split("?")[0]).rstrip("/") or "/"
            if path.startswith("/services/") or path == "/":
                continue
            segs = ["{%s}" % x if x in REST_VARS else x for x in path.split("/")]
            t = "/".join(segs).strip("/")
            if t.startswith("sobjects/{sObject}"):
                continue                                  # 객체별 동작(위 규칙)과 겹친다
            for verb in meth:
                name = "%s %s" % (verb, t)
                oid = "op:%s:%s" % (REST, name)
                if self.ir.has("operation", oid):
                    continue
                params = [{"name": x[1:-1], "in": "path", "required": True, "scalar": "string"} for x in segs if x.startswith("{")]
                last = t.split("/")[-1]
                kind = core.rest_kind(verb, t, None, None)
                row = dict(id=oid, surface="rest", name=name, method=verb, kind=kind, kind_grade="transform",
                           path={"template": t, "positions": core.path_positions(t)}, params=params, request=None,
                           responses=[], grants=["gr:oauth_scope:api"], **self.H(REST, "Reference p.%d URI %s" % (pg, raw)))
                row["ext"] = {"raw_path": raw, "kind_rule": core.KIND_RULE}
                self.ir.add("operation", row)
                self.api_ops.append(oid)
        sid = "sf_metadata_api"
        meta = self.doc(sid)
        mtoc = meta.get_toc()
        for n, (lvl, title, page, _) in enumerate(mtoc):
            t = title.strip()
            if t not in META_TYPES or self.ir.has("shape", "sh:%s:%s" % (sid, t)):
                continue
            nxt = mtoc[n + 1] if n + 1 < len(mtoc) else (0, "END", page + 5, None)
            fl = parse_meta_type(meta, page, nxt[2], t, nxt[1].strip())
            if not fl:
                continue
            props = [{"name": f["name"], "scalar": SCALAR.get(f["type"].lower(), "string"), "format": f["type"], "required": False}
                     for f in fl]
            row = dict(id="sh:%s:%s" % (sid, t), name=t, origin="named", kind="object", props=props, **self.H(sid, "%s p.%d" % (t, page)))
            row["ext"] = {"api": "Metadata API (파일 기반 배포와 조회. sObject REST 동작이 아니다)"}
            self.ir.add("shape", row)

    def run(self):
        self.object_reference()
        self.events()
        self.scopes_rest_meta()
        gid = "gr:oauth_scope:api"
        if not self.ir.has("grant", gid):
            self.ir.add("grant", dict(id=gid, kind="oauth_scope", name="api", operations=[], **self.H("sf_mobile_sdk", "Scope Parameter Values")))
        g = self.ir.get("grant", gid)
        g["operations"] = sorted(set(self.api_ops))
        g["ext"] = {"operations_rule": "api scope 가 REST API 접근을 허용한다 (Scope Parameter Values). 동작 연결은 변환기가 펼친 것이다",
                    "operations_grade": "transform"}
        for d in self.docs.values():
            d.save()
        return self.ir.write()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(SF().run(), ensure_ascii=False))
