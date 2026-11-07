"""The speech worker: Kokoro, loaded ONCE, answering on a socket.

Started by the TTS door, not by a human. Loading the model is 3.5 s, so a process that reloads per line is not a
service - it is a test. This stays up and renders lines in ~1.4x realtime on CPU.

    GET  /health              -> {ok, model, voices, loadedSec}
    POST /say {text, voice, speed} -> audio/wav

The voice ids are the cast's own (media/voice/cast.json): af_sky is Destiny's interim preset.
"""

import json
import os
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.environ.get("HYDRA_MEDIA", r"C:\AI\hydra-local\media")
KOKORO_DIR = os.path.join(MEDIA, "voice", "kokoro")
MODEL = os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx")
VOICES = os.path.join(KOKORO_DIR, "voices-v1.0.bin")
PORT = int(os.environ.get("TTS_WORKER_PORT", "8145"))

_state = {"kokoro": None, "loadedSec": None, "error": None}
_lock = threading.Lock()


def load():
    """Load the model once. A failure is reported, never hidden: the door then falls back to SAPI."""
    if _state["kokoro"] is not None:
        return _state["kokoro"]
    t0 = time.time()
    try:
        from kokoro_onnx import Kokoro

        _state["kokoro"] = Kokoro(MODEL, VOICES)
        _state["loadedSec"] = round(time.time() - t0, 2)
        _state["error"] = None
    except Exception as exc:  # noqa: BLE001 - the reason must survive to the caller
        _state["error"] = f"{type(exc).__name__}: {exc}"
    return _state["kokoro"]


def render(text, voice="af_sky", speed=1.04):
    k = load()
    if k is None:
        raise RuntimeError(_state["error"] or "kokoro did not load")
    import io
    import soundfile as sf

    samples, rate = k.create(text, voice=voice, speed=float(speed), lang="en-us")
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # noqa: D401 - quiet by design
        sys.stderr.write("[kokoro] " + (fmt % args) + "\n")

    def _json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {
                "ok": _state["kokoro"] is not None,
                "model": os.path.basename(MODEL),
                "loadedSec": _state["loadedSec"],
                "error": _state["error"],
                "voices": ["af_sky", "af_nicole", "af_bella"],
            })
            return
        self._json(404, {"ok": False, "error": "no such route"})

    def do_POST(self):
        if self.path != "/say":
            self._json(404, {"ok": False, "error": "no such route"})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            text = str(body.get("text") or "").strip()
            if not text:
                self._json(400, {"ok": False, "error": "nothing to say"})
                return
            with _lock:
                wav = render(text, body.get("voice") or "af_sky", body.get("speed") or 1.04)
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"[kokoro] worker on 127.0.0.1:{PORT} (model {os.path.basename(MODEL)})\n")
    srv.serve_forever()
