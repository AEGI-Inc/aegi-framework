# -*- coding: utf-8 -*-
"""수집 사다리 2, 3단의 브라우저 어댑터 (IR 설계.md 9절).

모든 어댑터는 같은 꼴이다:
    fetch(url) -> {status, final_url, body, network_json[], method}
network_json 은 그 쪽이 부른 JSON 응답 목록 [{url, status, body}] 이다. 화면 대신 이것을 먼저 저장한다.

- PlaywrightAdapter      (2단) 헤드리스 Chromium. `pip install playwright` 후 `python -m playwright install chromium`
- CdpChromeAdapter       (3단) 사람이 띄운 실제 Chrome 에 CDP 로 붙는다. 환경 변수 AEGI_CDP_ENDPOINT (예: http://127.0.0.1:9222)
                         Chrome 은 사람이 `chrome --remote-debugging-port=9222 --user-data-dir=<별도 폴더>` 로 띄운다
- AgentCliAdapter        (3단) CLI 를 가진 에이전틱 브라우저. 환경 변수 AEGI_AGENT_BROWSER_CMD 에 명령 틀을 둔다.
                         명령은 {url} 을 받아 표준 출력으로 위 꼴의 JSON 한 개를 내야 한다

하지 않는 것: CAPTCHA 풀기, 브라우저 지문 위장, 차단을 피하려는 프록시 돌리기. 사이트가 확인 문제를 내면
어댑터는 받은 그대로 돌려주고, fetch.py 가 4단(사람)으로 넘긴다.
"""
import importlib.util
import json
import os
import shlex
import subprocess

UA = "AEGI-IR-collector/1.0 (vendor documentation snapshot; security research)"


class Unavailable(Exception):
    pass


class Adapter:
    method = "none"

    def available(self):
        return False, "구현 없음"

    def fetch(self, url):
        raise Unavailable(self.method)


def _playwright_installed():
    return importlib.util.find_spec("playwright") is not None


class PlaywrightAdapter(Adapter):
    method = "browser_playwright"

    def available(self):
        if not _playwright_installed():
            return False, "playwright 없음. 설치: pip install playwright && python -m playwright install chromium"
        return True, "ok"

    def fetch(self, url, wait_ms=4000):
        ok, why = self.available()
        if not ok:
            raise Unavailable(why)
        from playwright.sync_api import sync_playwright
        nets = []
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            ctx = b.new_context(user_agent=UA)
            page = ctx.new_page()

            def on_resp(r):
                ct = (r.headers or {}).get("content-type", "")
                if "json" in ct:
                    try:
                        nets.append({"url": r.url, "status": r.status, "body": r.text()})
                    except Exception:
                        pass
            page.on("response", on_resp)
            resp = page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(wait_ms)
            body = page.content()
            out = {"status": resp.status if resp else 0, "final_url": page.url, "body": body,
                   "network_json": nets, "method": self.method}
            b.close()
        return out


class CdpChromeAdapter(Adapter):
    """사람이 쓰는 Chrome 에 붙는다. 사람의 세션과 같은 조건으로 연다. 붙는 것만 하고 로그인이나 확인 문제는 사람이 한다"""
    method = "browser_cdp"

    def available(self):
        ep = os.environ.get("AEGI_CDP_ENDPOINT")
        if not ep:
            return False, "AEGI_CDP_ENDPOINT 없음 (예: http://127.0.0.1:9222)"
        if not _playwright_installed():
            return False, "CDP 연결에 playwright 가 필요하다 (pip install playwright)"
        return True, ep

    def fetch(self, url, wait_ms=4000):
        ok, why = self.available()
        if not ok:
            raise Unavailable(why)
        from playwright.sync_api import sync_playwright
        nets = []
        with sync_playwright() as p:
            b = p.chromium.connect_over_cdp(os.environ["AEGI_CDP_ENDPOINT"])
            ctx = b.contexts[0] if b.contexts else b.new_context()
            page = ctx.new_page()
            page.on("response", lambda r: nets.append({"url": r.url, "status": r.status, "body": _safe_text(r)})
                    if "json" in (r.headers or {}).get("content-type", "") else None)
            resp = page.goto(url, wait_until="networkidle")
            page.wait_for_timeout(wait_ms)
            out = {"status": resp.status if resp else 0, "final_url": page.url, "body": page.content(),
                   "network_json": nets, "method": self.method}
            page.close()
        return out


def _safe_text(r):
    try:
        return r.text()
    except Exception:
        return None


class AgentCliAdapter(Adapter):
    method = "browser_agent"

    def available(self):
        cmd = os.environ.get("AEGI_AGENT_BROWSER_CMD")
        return (True, cmd) if cmd else (False, "AEGI_AGENT_BROWSER_CMD 없음 (예: 'agent-browser fetch --json {url}')")

    def fetch(self, url):
        ok, cmd = self.available()
        if not ok:
            raise Unavailable(cmd)
        args = [a.replace("{url}", url) for a in shlex.split(cmd)]
        r = subprocess.run(args, capture_output=True, text=True, timeout=300)
        out = json.loads(r.stdout)
        out["method"] = self.method
        return out


LADDER_BROWSERS = {2: [PlaywrightAdapter()], 3: [CdpChromeAdapter(), AgentCliAdapter()]}


def status():
    rows = []
    for step, ads in sorted(LADDER_BROWSERS.items()):
        for a in ads:
            ok, why = a.available()
            rows.append({"step": step, "method": a.method, "available": ok, "note": why})
    return rows


if __name__ == "__main__":
    print(json.dumps(status(), ensure_ascii=False, indent=1))
