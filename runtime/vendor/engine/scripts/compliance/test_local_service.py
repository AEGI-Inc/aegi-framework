import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from local_service import make_handler


class LocalServiceTests(unittest.TestCase):
    def test_policy_runs_and_immutable_history(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            objects = root / "objects.json"
            objects.write_text(json.dumps([{"fixture_key": "user-a", "canonical": {"provider": "gws", "object_type": "User", "properties": {"isAdmin": True, "suspended": False, "isEnforcedIn2Sv": False}}}]), encoding="utf8")
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(str(objects), str(root / "test.db"), "http://127.0.0.1:5194"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}/api/compliance"

            def request(path, data=None):
                body = json.dumps(data).encode() if data is not None else None
                req = urllib.request.Request(base + path, body, {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=5) as response:
                    return json.load(response)
            try:
                first = request("/runs", {"check": "admin_auth"})
                self.assertEqual(first["result"]["gws"][0]["status"], "fail")
                request("/policy", {"require_mfa": False})
                second = request("/runs", {"check": "admin_auth"})
                self.assertEqual(second["result"]["gws"][0]["status"], "not_required")
                self.assertEqual(request("/runs/" + first["id"])["result"]["gws"][0]["status"], "fail")
                self.assertEqual(len(request("/runs")["runs"]), 2)
                with self.assertRaises(urllib.error.HTTPError) as invalid:
                    request("/policy", {"require_mfa": "true"})
                self.assertEqual(invalid.exception.code, 400)
                invalid.exception.close()
                with self.assertRaises(urllib.error.HTTPError) as invalid_check:
                    request("/runs", {"check": []})
                self.assertEqual(invalid_check.exception.code, 400)
                invalid_check.exception.close()
                cross_origin = urllib.request.Request(base + "/policy", b"{}", {"Origin": "https://untrusted.example", "Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    urllib.request.urlopen(cross_origin, timeout=5)
                self.assertEqual(rejected.exception.code, 403)
                rejected.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
