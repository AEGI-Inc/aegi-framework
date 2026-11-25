# -*- coding: utf-8 -*-
"""Atlassian 문서 스냅샷(support.atlassian.com, developer.atlassian.com) 파서. extraction = parser@1.

페이지 HTML 이 스크립트 안 문자열로 들어 있어(<\\/td>) 이스케이프를 풀고 읽는다.
읽는 것은 제목(h2, h3)과 표의 첫 칸(이름)뿐이다. 설명 칸과 본문 문장은 읽지 않는다.
"""
import html
import json
import re

PARSER = "parser@1"


def unescape(page):
    """스크립트 문자열 안의 HTML 을 꺼낸다. 문서 본문이 들어 있는 가장 긴 구간을 쓴다."""
    s = page.replace("<\\/", "</").replace("\\'", "'").replace('\\"', '"').replace("\\n", "\n")
    s = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    return s


def text(fragment):
    fragment = re.sub(r"<style[^>]*>.*?</style>", " ", fragment, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def sections(page):
    """(제목 단계, 제목, 그 제목 아래 표들) 목록. 표는 행 목록, 행은 칸 글자 목록. 머리 행은 th 로 따로 둔다."""
    s = unescape(page)
    out, cur = [], None
    for m in re.finditer(r"<(h[1-4])[^>]*>(.*?)</\1>|<table[^>]*>(.*?)</table>", s, re.S):
        if m.group(1):
            cur = {"level": m.group(1), "title": text(m.group(2)), "tables": []}
            out.append(cur)
        elif cur is not None:
            rows = []
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(3), re.S):
                cells = re.findall(r"<(t[hd])[^>]*>(.*?)</t[hd]>", r, re.S)
                rows.append({"th": all(t == "th" for t, _ in cells), "cells": [text(c) for _, c in cells]})
            cur["tables"].append(rows)
    return out


def first_column(page, header=None):
    """제목별로 표의 첫 칸 값(머리 행 제외). header 가 주어지면 머리 행 첫 칸이 그 이름인 표만."""
    out = []
    for sec in sections(page):
        for rows in sec["tables"]:
            head = next((r["cells"] for r in rows if r["th"]), [])
            if header and (not head or head[0].lower() != header.lower()):
                continue
            for r in rows:
                if not r["th"] and r["cells"] and r["cells"][0]:
                    out.append((sec["title"], r["cells"][0], head))
    return out
