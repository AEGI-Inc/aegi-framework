# -*- coding: utf-8 -*-
"""GraphQL SDL 파서 (토큰 단위). 기존 graphql_sdl.py 와 같은 결과에 지시어(@deprecated)를 더한다.

정의 하나가 행 하나다: name, kind(object, interface, union, enum, input, scalar), implements, fields,
possible_types, values(enum), directives. 필드는 이름, 타입(이름, 목록, 필수, 원소 필수), 인자, 지시어.
설명 문자열은 버린다. @deprecated 의 reason 은 수명 판정(종료 공지와 날짜, 1절)에만 쓴다.
"""
import re

TOK = re.compile(r'"""(?:[^"\\]|\\.|"(?!""))*"""|"(?:[^"\\\n]|\\.)*"|#[^\n]*|\.\.\.|[!$()\:=@\[\]{|}&]'
                 r'|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[_A-Za-z][_0-9A-Za-z]*', re.S)
KINDS = {"type": "object", "interface": "interface", "union": "union", "enum": "enum", "input": "input", "scalar": "scalar"}


def tokens(text):
    return [t for t in TOK.findall(text) if not t.startswith("#")]   # 쉼표는 TOK 에 없어 저절로 빠진다


class P:
    def __init__(self, text):
        self.t = tokens(text)
        self.i = 0

    def peek(self, k=0):
        return self.t[self.i + k] if self.i + k < len(self.t) else None

    def next(self):
        x = self.peek()
        self.i += 1
        return x

    def skip_desc(self):
        while self.peek() and self.peek().startswith('"'):
            self.i += 1

    def value(self):
        x = self.next()
        if x in ("[", "{"):
            close = "]" if x == "[" else "}"
            out = []
            while self.peek() not in (close, None):
                if x == "{":
                    k = self.next()
                    self.next()                         # :
                    out.append((k, self.value()))
                else:
                    out.append(self.value())
            self.next()
            return dict(out) if x == "{" else out
        if x == "$":
            return "$" + self.next()
        if x.startswith('"'):
            return x[3:-3] if x.startswith('"""') else bytes(x[1:-1], "utf-8").decode("unicode_escape", "ignore")
        return x

    def directives(self):
        out = []
        while self.peek() == "@":
            self.next()
            name = self.next()
            args = {}
            if self.peek() == "(":
                self.next()
                while self.peek() not in (")", None):
                    k = self.next()
                    self.next()
                    args[k] = self.value()
                self.next()
            out.append({"name": name, "args": args})
        return out

    def typeref(self):
        if self.peek() == "[":
            self.next()
            inner = self.typeref()
            self.next()                                 # ]
            req = False
            if self.peek() == "!":
                self.next()
                req = True
            return {"name": inner["name"], "list": True, "required": req, "item_required": inner["required"],
                    "depth": inner.get("depth", 0) + 1}
        name = self.next()
        req = False
        if self.peek() == "!":
            self.next()
            req = True
        return {"name": name, "list": False, "required": req}

    def input_values(self, close):
        out = []
        while self.peek() not in (close, None):
            self.skip_desc()
            if self.peek() == close:
                break
            name = self.next()
            self.next()                                 # :
            t = self.typeref()
            d = None
            if self.peek() == "=":
                self.next()
                d = self.value()
            dirs = self.directives()
            out.append({"name": name, "type": t, "default": d, "directives": dirs})
        self.next()
        return out

    def fields(self):
        out = []
        self.next()                                     # {
        while self.peek() not in ("}", None):
            self.skip_desc()
            if self.peek() == "}":
                break
            name = self.next()
            args = []
            if self.peek() == "(":
                self.next()
                args = self.input_values(")")
            self.next()                                 # :
            t = self.typeref()
            dirs = self.directives()
            out.append({"name": name, "type": t, "args": args, "directives": dirs})
        self.next()
        return out

    def parse(self):
        rows = []
        while self.peek() is not None:
            self.skip_desc()
            x = self.next()
            if x is None:
                break
            if x == "extend":
                x = self.next()
            if x == "schema":
                self.directives()
                self.next()
                ops = {}
                while self.peek() != "}":
                    k = self.next()
                    self.next()
                    ops[k] = self.next()
                self.next()
                rows.append({"name": "__schema__", "kind": "schema", "ops": ops})
                continue
            if x == "directive":
                self.next()                             # @
                self.next()                             # 이름
                if self.peek() == "(":
                    self.next()
                    self.input_values(")")
                if self.peek() == "repeatable":
                    self.next()
                self.next()                             # on
                while self.peek() == "|" or (self.peek() and re.match(r"^[A-Z_]+$", self.peek() or "")):
                    self.next()
                continue
            if x not in KINDS:
                continue
            kind = KINDS[x]
            name = self.next()
            row = {"name": name, "kind": kind}
            if self.peek() == "implements":
                self.next()
                impl = []
                while self.peek() not in ("{", "@", None) and self.peek() not in KINDS and self.peek() != "extend":
                    y = self.next()
                    if y != "&":
                        impl.append(y)
                row["implements"] = sorted(impl)
            row["directives"] = self.directives()
            if kind == "union":
                if self.peek() == "=":
                    self.next()
                    if self.peek() == "|":
                        self.next()
                    pts = [self.next()]
                    while self.peek() == "|":
                        self.next()
                        pts.append(self.next())
                    row["possible_types"] = sorted(pts)
            elif kind == "enum":
                vals = []
                if self.peek() == "{":
                    self.next()
                    while self.peek() not in ("}", None):
                        self.skip_desc()
                        if self.peek() == "}":
                            break
                        v = self.next()
                        vals.append({"name": v, "directives": self.directives()})
                    self.next()
                row["values"] = vals
            elif kind == "input":
                if self.peek() == "{":
                    self.next()
                    row["fields"] = self.input_values("}")
            elif kind in ("object", "interface"):
                if self.peek() == "{":
                    row["fields"] = self.fields()
            rows.append(row)
        impl = {}
        for r in rows:
            for x in r.get("implements", []):
                impl.setdefault(x, []).append(r["name"])
        for r in rows:
            if r["kind"] == "interface":
                r["possible_types"] = sorted(impl.get(r["name"], []))
        return rows


def parse(text):
    return P(text).parse()


def removal(dirs):
    """@deprecated 지시어 -> (deprecated 여부, 제거 날짜). reason 의 「Removal on YYYY-MM-DD」만 읽는다"""
    for d in dirs or []:
        if d["name"] == "deprecated":
            m = re.search(r"Removal on (\d{4}-\d{2}-\d{2})", str(d["args"].get("reason", "")))
            return True, (m.group(1) if m else None)
    return False, None
