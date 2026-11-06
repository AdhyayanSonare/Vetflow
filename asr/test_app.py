import io
import math
import os
import struct
import wave

os.environ["ASR_PROVIDER"] = "mock"
os.environ["ASR_MOCK_TEXT"] = "carprofen fifty milligrams twice daily"

import av  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app as asr  # noqa: E402

client = TestClient(asr.app)


def tone_wav(seconds=1.0, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(seconds * rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n)))
    return buf.getvalue()


def tone_webm_opus(seconds=1.0):
    """What a browser MediaRecorder produces: webm container with opus audio."""
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="webm")
    stream = out.add_stream("libopus", rate=48000)
    stream.layout = "mono"
    rate = 48000
    samples = (8000 * np.sin(2 * np.pi * 440 * np.arange(int(seconds * rate)) / rate)).astype("int16")
    frame_size = 960
    for i in range(0, len(samples) - frame_size, frame_size):
        frame = av.AudioFrame.from_ndarray(samples[i:i + frame_size].reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = rate
        frame.pts = i
        for pkt in stream.encode(frame):
            out.mux(pkt)
    for pkt in stream.encode(None):
        out.mux(pkt)
    out.close()
    return buf.getvalue()


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_wav_is_transcribed_by_the_provider():
    r = client.post("/transcribe?language=en", content=tone_wav(), headers={"content-type": "audio/wav"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "carprofen fifty milligrams twice daily"
    assert body["provider"] == "mock"
    assert body["language"] == "en"
    assert r.headers["cache-control"] == "no-store"


def test_browser_webm_opus_is_decoded():
    try:
        data = tone_webm_opus()
    except Exception as e:  # the local PyAV build may lack an opus encoder
        import pytest
        pytest.skip(f"no opus encoder here: {e}")
    r = client.post("/transcribe?language=en", content=data, headers={"content-type": "audio/webm"})
    assert r.status_code == 200
    assert r.json()["text"]


def test_rejects_bad_input():
    assert client.post("/transcribe?language=en", content=b"").status_code == 400
    assert client.post("/transcribe?language=en", content=b"not audio").status_code == 415
    assert client.post("/transcribe?language=xx", content=tone_wav()).status_code == 400


def test_very_short_clip_returns_empty_text_without_calling_the_model():
    r = client.post("/transcribe?language=en", content=tone_wav(0.05))
    assert r.status_code == 200
    assert r.json()["text"] == ""


def test_hindi_needs_the_whisper_provider_to_be_enabled(monkeypatch):
    monkeypatch.setenv("ASR_PROVIDER", "canary")
    monkeypatch.delenv("ASR_ENABLE_WHISPER", raising=False)
    r = client.post("/transcribe?language=hi", content=tone_wav())
    assert r.status_code == 501


def test_canary_is_not_used_for_hindi_and_hindi_is_not_sent_to_canary():
    assert asr.LANG_PROVIDER["hi"] == "whisper"
    assert all(asr.LANG_PROVIDER[k] == "canary" for k in ("en", "de", "fr", "es"))
