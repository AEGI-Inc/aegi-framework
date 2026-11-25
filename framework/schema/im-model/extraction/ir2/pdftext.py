# -*- coding: utf-8 -*-
"""PDF 읽기 (pypdf, 순수 파이썬). 목차와 쪽 글자만 쓴다.

이 PC 에서는 PyMuPDF(fitz)의 원생 모듈이 Windows 보안(Smart App Control)에 막혀 옛 normalize_salesforce.py 를 그대로 돌릴 수 없다.
pypdf 는 줄 나눔과 낱말 붙임이 PyMuPDF 와 조금 다르다 (예: 「Field Name Details」 머리 줄이 「DetailsField Name」으로 붙는다).
쪽 글자는 PDF 해시별로 cache/ 에 저장해 두 번째 실행부터 빠르게 읽는다 (같은 PDF 면 같은 글자).
"""
import hashlib
import io
import json
import os

import pypdf

import core

CACHE = os.path.join(core.HERE, "cache")


class Doc:
    def __init__(self, path):
        self.path = path
        self.r = pypdf.PdfReader(path)
        self.page_count = len(self.r.pages)
        self.sha = core.sha256_file(path)
        self.cpath = os.path.join(CACHE, "pdf_%s.json" % self.sha[:16])
        self.cache = {}
        if os.path.exists(self.cpath):
            self.cache = json.load(io.open(self.cpath, encoding="utf-8"))
        self.dirty = False
        self._toc = None

    def get_toc(self):
        """[(단계 1부터, 제목, 쪽 1부터, 위 좌표)]"""
        if self._toc is None:
            out = []

            def walk(items, lvl):
                for x in items:
                    if isinstance(x, list):
                        walk(x, lvl + 1)
                    else:
                        try:
                            pg = self.r.get_destination_page_number(x) + 1
                        except Exception:
                            continue
                        top = x.get("/Top") if hasattr(x, "get") else None
                        out.append((lvl, str(x.title), pg, float(top) if top is not None else None))
            walk(self.r.outline, 1)
            self._toc = out
        return self._toc

    def text(self, i):
        """0부터 센 쪽의 글자 (줄 끝은 \\n)"""
        k = str(i)
        if k not in self.cache:
            t = self.r.pages[i].extract_text() or ""
            self.cache[k] = t.replace("\r\n", "\n").replace("\r", "\n")
            self.dirty = True
        return self.cache[k]

    def save(self):
        if self.dirty:
            os.makedirs(CACHE, exist_ok=True)
            with io.open(self.cpath, "w", encoding="utf-8", newline="\n") as f:
                json.dump(self.cache, f, ensure_ascii=False, sort_keys=True)
            self.dirty = False
