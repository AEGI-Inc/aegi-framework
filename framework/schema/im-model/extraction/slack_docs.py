# -*- coding: utf-8 -*-
"""Slack 공식 문서 스냅샷(docs.slack.dev, 서버 렌더링 HTML) 파서. extraction = parser@1.

페이지 구조가 일정한 부분만 읽는다: 인자 블록, Facts 의 Scopes, 응답과 payload 의 JSON 코드 블록,
manifest 레퍼런스의 필드 경로. 자연어 설명은 읽지 않는다.
"""
import html
import json
import re

PARSER = "parser@1"


def _text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment))


def code_blocks(page, start=None, end=None):
    """<code class=codeBlockLines...> 블록을 순서대로 텍스트로. start/end 는 구역을 자르는 문자열."""
    if start and start in page:
        page = page[page.index(start):]
    if end and end in page:
        page = page[:page.index(end)]
    out = []
    for m in re.finditer(r"<code class=codeBlockLines[^>]*>(.*?)</code>", page, re.S):
        lines = re.findall(r"<div class=token-line[^>]*>(.*?)</div>", m.group(1), re.S)
        out.append("\n".join(_text(l) for l in lines))
    return out


def loose_json(text):
    """문서 예시용 JSON. 주석, 말줄임, 끝 쉼표를 걷어 낸다. 못 읽으면 None."""
    try:
        return json.loads(text)
    except ValueError:
        pass
    t = re.sub(r"(?<![:\\])//[^\n]*", "", text)        # 주석. 주소의 // (https://) 는 남긴다
    t = re.sub(r"^\s*\.\.\.\s*,?\s*$", "", t, flags=re.M)
    t = re.sub(r",(\s*[}\]])", r"\1", t)
    try:
        return json.loads(t)
    except ValueError:
        return None


def scopes_in(fragment):
    txt = re.sub(r"\b[Tt]oken:", " ", _text(fragment))          # "User token: admin.users:write"
    return sorted(set(re.findall(r"\b([a-z][a-z_.]*:[a-z_.:\-]+)\b", txt)))


def method_page(page):
    """인자, scope, HTTP 메서드, 응답 예시."""
    params = []
    args = page[page.find("id=arguments"):page.find("id=usage-info")] if "id=arguments" in page else ""
    for blk in re.split(r"<div class=param-container>", args)[1:]:
        name = re.search(r"reference-name><strong><code>([^<]+)</code>", blk)
        if not name:
            continue
        typ = re.search(r"<span class=type><code>([^<]+)</code>", blk)
        ex = re.search(r"<em>Example: </em><code>([^<]*)</code>", blk)
        params.append(dict(name=html.unescape(name.group(1)), type=typ.group(1) if typ else None,
                           required="class=required>Required<" in blk,
                           example=html.unescape(ex.group(1))[:80] if ex else None))
    scopes = []
    m = re.search(r"<strong class=info-key>Scopes</strong>(.*?)<strong class=info-key>", page, re.S)
    if m:
        scopes = scopes_in(m.group(1))
    verb = re.search(r"\b(GET|POST) https://slack\.com/api/", _text(page[:page.find("id=arguments")] if "id=arguments" in page else page))
    examples, failed = [], 0
    for b in code_blocks(page, "id=response", "id=errors"):
        j = loose_json(b)
        if isinstance(j, dict) and j.get("ok") is not False:
            examples.append(j)
        elif j is None:
            failed += 1
    return dict(params=params, scopes=scopes, http_method=verb.group(1) if verb else None,
                examples=examples, unparsed_examples=failed)


def event_page(page):
    """필요 scope 와 payload 예시. 예시가 event wrapper 면 event 부분을 쓴다."""
    m = re.search(r"<strong class=info-key>Required Scopes</strong>(.*?)<strong class=info-key>", page, re.S)
    scopes = scopes_in(m.group(1)) if m else []
    payload = None
    for b in code_blocks(page, "id=usage-info"):
        j = loose_json(b)
        if isinstance(j, dict):
            payload = j.get("event") if isinstance(j.get("event"), dict) else j
            break
    return dict(scopes=scopes, payload=payload)


def scope_page(page):
    """scope 이름은 제목("chat:write.public scope")에서 읽는다. 주소는 ':' 를 '.' 로 바꿔 놓았다."""
    m = re.search(r"<h1>(.*?)</h1>", page, re.S)
    name = re.sub(r"\s+scope$", "", _text(m.group(1)).strip()) if m else None
    t = re.search(r"<strong class=info-key>Supported token types</strong>(.*?)(?:<h2|<strong class=info-key>)", page, re.S)
    types = [x.strip() for x in re.split(r"\s{2,}|\n", _text(t.group(1))) if x.strip()] if t else []
    return dict(name=name, token_types=types)


MANIFEST_TOP = ("_metadata", "display_information", "features", "oauth_config", "settings", "app_directory",
                "functions", "workflows", "datastores", "outgoing_domains", "external_auth_providers",
                "compliance", "metadata_events", "types")


def manifest_paths(page):
    """manifest 레퍼런스의 <code> 필드 경로. features.slash_commands[].url -> features.slash_commands[*].url"""
    out = set()
    for c in re.findall(r"<code>([a-z_]+(?:\.[a-z_\[\]]+){1,6})</code>", page):
        if c.split(".")[0] in MANIFEST_TOP:
            out.add(c.replace("[]", "[*]"))
    return sorted(out)


def legal_hold_methods(page):
    """Legal Hold 레퍼런스: 메서드 페이지가 따로 없고 한 페이지에 섹션(id=policies_activate ...)으로 있다.
    섹션마다 인자 표(Argument, Example, Required)와 Example Response 코드 블록이 있다."""
    out = {}
    secs = list(re.finditer(r"<h3[^>]*id=((?:policies|entities)_[a-z]+)", page))
    end = page.find("id=errors")
    for i, m in enumerate(secs):
        body = page[m.end(): secs[i + 1].start() if i + 1 < len(secs) else end]
        name = "admin.legalHold." + m.group(1).replace("_", ".")
        flat = re.sub(r"\s+", " ", _text(body))
        scopes = sorted(set(re.findall(r"Required scope:\s*([a-z_.]+:[a-z_.]+)", flat)))
        verb = re.search(r"HTTP Method:\s*(GET|POST)", flat)
        params = []
        table = body[body.find("<tbody>"):body.find("</table>")] if "<tbody>" in body else ""
        for row in table.split("<tr>")[1:]:              # 축약 HTML: 닫는 태그가 없다
            cells = [re.sub(r"\s+", " ", _text(c)).strip() for c in row.split("<td>")[1:]]
            if len(cells) >= 3 and cells[0] and cells[0] != "token":
                params.append(dict(name=cells[0], type=None, required=cells[2].lower().startswith("required"),
                                   example=cells[1][:80] or None))
        blocks = code_blocks(body, "Example Response")
        resp = loose_json(blocks[0]) if blocks else None
        out[name] = dict(params=params, scopes=scopes, http_method=verb.group(1) if verb else None,
                         examples=[resp] if isinstance(resp, dict) else [], unparsed_examples=0 if resp else 1)
    return out


def role_table(t):
    """admin.roles.addAssignments 쪽의 역할 표 -> [(역할 이름, 역할 id, 범위)]. 머리 칸 「Role ID」의 열을 id 로 쓴다 (2026-10-18)"""
    out = []
    for tb in re.findall(r"<table>(.*?)(?:</table>|<h[1-6]|$)", t, re.S):
        rows = [r for r in re.split(r"<tr>", tb) if "<th>" in r or "<td>" in r]
        if not rows:
            continue
        head = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.split(r"<th>", rows[0])[1:]]
        if "Role ID" not in head:
            continue
        k = head.index("Role ID")
        for r in rows[1:]:
            cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.split(r"<td>", r)[1:]]
            if len(cells) == len(head):
                out.append((cells[0], cells[k], cells[2] if len(cells) > 2 else None))
    return out
