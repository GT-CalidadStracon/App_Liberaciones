"""Servidor simulado del Apps Script para probar la app SIN tocar el sistema real.
Modos (GET /__mode?m=ok|fail|drop|slow) y estado (GET /__state)."""
import json, time, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODE = {"m": "ok"}
STORE = {"items": [], "received": [], "ver": 3}
CONFIG = None

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        if self.path.startswith("/__mode"):
            MODE["m"] = self.path.split("m=")[1]; return self._json({"mode": MODE["m"]})
        if self.path.startswith("/__state"):
            return self._json({"stored": len(STORE["items"]), "received": STORE["received"], "mode": MODE["m"]})
        self._json({"ok": True})
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        a = body.get("action")
        if body.get("key") != "KEY-TEST": return self._json({"ok": False, "error": "Clave de equipo incorrecta"})
        if a == "ping": return self._json({"ok": True})
        if a == "getConfig": return self._json({"ok": True, "config": CONFIG, "version": STORE["ver"], "fecha": "x", "por": "mock"} if CONFIG else {"ok": True})
        if a == "addLib":
            STORE["received"].append({"uid": body.get("uid"), "len": len(json.dumps(body))})
            if MODE["m"] == "fail": return self._json({"ok": False, "error": "Hoja bloqueada"})
            if MODE["m"] == "drop":  # procesa pero no responde (equivale a perder la señal tras guardar)
                if body["uid"] not in [i["uid"] for i in STORE["items"]]: STORE["items"].append(body)
                self.connection.close(); return
            if MODE["m"] == "slow": time.sleep(40)
            if body["uid"] not in [i["uid"] for i in STORE["items"]]: STORE["items"].append(body)
            return self._json({"ok": True, "id": "L-%04d" % len(STORE["items"])})
        if a == "listLibs": return self._json({"ok": True, "items": [], "hoja": ""})
        return self._json({"ok": False, "error": "acción desconocida"})

if __name__ == "__main__":
    cfgfile = sys.argv[1] if len(sys.argv) > 1 else None
    if cfgfile:
        CONFIG = json.load(open(cfgfile, encoding="utf-8"))
    ThreadingHTTPServer(("127.0.0.1", 8766), H).serve_forever()
