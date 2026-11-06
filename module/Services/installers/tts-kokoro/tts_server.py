#!/usr/bin/env python
"""
tts_server.py — the Kokoro TTS service door for node .149 (and any node that adopts it).

  GET  /health                     {ok, model, voices, jobs}
  GET  /voices                     [names]
  POST /tts                        {text, voice, speed, lang} -> {ok, file, seconds, sample_rate}
  GET  /outputs/<file>             the wav itself (so another node can pull it)

DESIGN (why it looks like this)
  · ONE JOB AT A TIME — a lock, exactly like the image and video kits. Two jobs queued means
    the second waits; it never interleaves.
  · THE MODEL LOADS ONCE at startup and stays. A request never pays a load.
  · FREE TEXT GOES IN A BODY, never a command line (no quoting class of bugs).
  · EVERY JOB IS A FILE — out/tts_<stamp>_<voice>.wav — so the output is the receipt, and the
    same file is servable over HTTP for a node that wants to pull it.
  · STDOUT IS THE LIFE FILE: one line per request (text length, voice, seconds, path).
"""
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(ROOT, "models", "kokoro-v1.0.onnx")
VOICES = os.path.join(ROOT, "models", "voices-v1.0.bin")
OUT = os.path.join(ROOT, "out")
PORT = int(os.environ.get("TTS_PORT", "8100"))

os.makedirs(OUT, exist_ok=True)
print(f"[tts] loading model {os.path.basename(MODEL)} …", flush=True)
T0 = time.time()
KOKORO = Kokoro(MODEL, VOICES)
VOICE_NAMES = sorted(KOKORO.get_voices())
print(f"[tts] ready in {time.time() - T0:.1f}s · {len(VOICE_NAMES)} voices · port {PORT}", flush=True)

LOCK = threading.Lock()
JOBS = [0]


def synth(text: str, voice: str, speed: float, lang: str) -> dict:
    with LOCK:
        JOBS[0] += 1
        job = JOBS[0]
        t0 = time.time()
        samples, rate = KOKORO.create(text, voice=voice, speed=speed, lang=lang)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_voice = "".join(c if c.isalnum() or c in "-_" else "_" for c in voice)
        name = f"tts_{stamp}_{safe_voice}.wav"
        path = os.path.join(OUT, name)
        sf.write(path, samples, rate)
        secs = len(samples) / float(rate)
        print(f"[tts] job {job} · {len(text)} chars · {voice} · {secs:.1f}s audio · "
              f"{time.time() - t0:.1f}s wall · {name}", flush=True)
        return {
            "ok": True, "job": job, "file": path, "name": name,
            "seconds": round(secs, 2), "sample_rate": rate,
            "wall_seconds": round(time.time() - t0, 2),
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "hydra-tts/0.1"

    def log_message(self, fmt, *args):  # keep stdout for the life lines only
        pass

    def _send(self, code, payload, ctype="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/health", "/"):
            return self._send(200, {"ok": True, "service": "tts-kokoro", "model": os.path.basename(MODEL),
                                    "voices": len(VOICE_NAMES), "jobs": JOBS[0]})
        if self.path == "/voices":
            return self._send(200, VOICE_NAMES)
        if self.path.startswith("/outputs/"):
            name = os.path.basename(self.path[len("/outputs/"):])
            path = os.path.join(OUT, name)
            if not os.path.isfile(path):
                return self._send(404, {"ok": False, "error": "no such output"})
            with open(path, "rb") as f:
                return self._send(200, f.read(), "audio/wav")
        return self._send(404, {"ok": False, "error": "no route"})

    def do_POST(self):
        if self.path != "/tts":
            return self._send(404, {"ok": False, "error": "no route"})
        try:
            n = int(self.headers.get("content-length", "0"))
            req = json.loads(self.rfile.read(n) or b"{}")
            text = (req.get("text") or "").strip()
            if not text:
                return self._send(400, {"ok": False, "error": "text is required"})
            voice = req.get("voice") or "af_sarah"
            if voice not in VOICE_NAMES:
                return self._send(400, {"ok": False, "error": f"unknown voice {voice}",
                                        "voices": VOICE_NAMES[:12]})
            speed = float(req.get("speed") or 1.0)
            lang = req.get("lang") or "en-us"
            return self._send(200, synth(text, voice, speed, lang))
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"ok": False, "error": str(e)})


if __name__ == "__main__":
    print(f"[tts] {sys.version.split()[0]} · pid {os.getpid()} · out {OUT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
