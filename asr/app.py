"""Vetflow ASR service.

POST /transcribe?language=en   body: raw audio bytes (webm/opus, wav, mp3, mp4, ogg, flac)
returns {text, segments, confidence, provider, language}

Providers (selected per request by language, with ASR_PROVIDER as the default):
  canary   NVIDIA Canary-180M-Flash (CC-BY-4.0). English, German, French, Spanish. Not Hindi.
  whisper  faster-whisper (MIT). Used for Hindi. Accuracy on Indian-accented veterinary speech is unmeasured.
  mock     Fixed text, for tests and CI. Never enable in production.

Audio is decoded in memory, never written to disk, and dropped when the request ends.
"""
from __future__ import annotations

import io
import os
import threading
import time
from typing import Protocol

from fastapi import FastAPI, HTTPException, Request, Response

MAX_BYTES = 25 * 1024 * 1024
SAMPLE_RATE = 16000
LANG_PROVIDER = {"en": "canary", "de": "canary", "fr": "canary", "es": "canary", "hi": "whisper"}

app = FastAPI(title="vetflow-asr", docs_url=None, redoc_url=None)
_lock = threading.Semaphore(int(os.environ.get("ASR_CONCURRENCY", "2")))


def decode_to_mono_16k(data: bytes):
    """Decode any supported container to float32 mono 16 kHz using PyAV (bundles LGPL ffmpeg libraries)."""
    import av  # type: ignore
    import numpy as np  # type: ignore

    out = []
    with av.open(io.BytesIO(data)) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError("no audio stream")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(stream):
            for f in resampler.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None) or []:
            out.append(f.to_ndarray().reshape(-1))
    if not out:
        raise ValueError("empty audio")
    return (np.concatenate(out).astype("float32")) / 32768.0


def trim_silence(audio):
    """Drop leading and trailing silence with Silero VAD when it is installed; otherwise return the audio unchanged."""
    try:
        import torch  # type: ignore
        from silero_vad import get_speech_timestamps, load_silero_vad  # type: ignore

        model = _vad_model()
        ts = get_speech_timestamps(torch.from_numpy(audio), model, sampling_rate=SAMPLE_RATE)
        if not ts:
            return audio[:0]
        return audio[ts[0]["start"]: ts[-1]["end"]]
    except Exception:
        return audio


_vad = None


def _vad_model():
    global _vad
    if _vad is None:
        from silero_vad import load_silero_vad  # type: ignore

        _vad = load_silero_vad()
    return _vad


class Provider(Protocol):
    name: str

    def transcribe(self, audio, language: str) -> dict: ...


class MockProvider:
    name = "mock"

    def transcribe(self, audio, language: str) -> dict:
        text = os.environ.get("ASR_MOCK_TEXT", "mock transcript")
        return {"text": text, "segments": [{"start": 0.0, "end": len(audio) / SAMPLE_RATE, "text": text}], "confidence": None}


class CanaryProvider:
    """NVIDIA Canary-180M-Flash through NeMo. The model is loaded once, on first use."""

    name = "canary"
    _model = None

    def _load(self):
        if CanaryProvider._model is None:
            from nemo.collections.asr.models import EncDecMultiTaskModel  # type: ignore

            m = EncDecMultiTaskModel.from_pretrained(os.environ.get("CANARY_MODEL", "nvidia/canary-180m-flash"))
            m.eval()
            CanaryProvider._model = m
        return CanaryProvider._model

    def transcribe(self, audio, language: str) -> dict:
        import soundfile as sf  # type: ignore
        import tempfile

        model = self._load()
        # NeMo's transcribe() takes file paths, so the clip is written to a private temp file for the call
        # and removed straight after. It never leaves the container.
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            sf.write(tmp.name, audio, SAMPLE_RATE)
            out = model.transcribe([tmp.name], source_lang=language, target_lang=language, pnc="yes", timestamps=True)
        hyp = out[0]
        text = getattr(hyp, "text", str(hyp))
        segs = []
        ts = getattr(hyp, "timestamp", None) or {}
        for s in ts.get("segment", []) or []:
            segs.append({"start": float(s.get("start", 0)), "end": float(s.get("end", 0)), "text": s.get("segment", "")})
        return {"text": text, "segments": segs or [{"start": 0.0, "end": len(audio) / SAMPLE_RATE, "text": text}], "confidence": None}


class WhisperProvider:
    """faster-whisper (CTranslate2). Used for Hindi."""

    name = "whisper"
    _model = None

    def _load(self):
        if WhisperProvider._model is None:
            from faster_whisper import WhisperModel  # type: ignore

            WhisperProvider._model = WhisperModel(
                os.environ.get("WHISPER_MODEL", "small"), device="cpu", compute_type="int8",
                cpu_threads=int(os.environ.get("ASR_THREADS", "4")),
            )
        return WhisperProvider._model

    def transcribe(self, audio, language: str) -> dict:
        model = self._load()
        segments, info = model.transcribe(audio, language=language, vad_filter=True, beam_size=1)
        segs = [{"start": float(s.start), "end": float(s.end), "text": s.text.strip()} for s in segments]
        text = " ".join(s["text"] for s in segs).strip()
        return {"text": text, "segments": segs, "confidence": float(info.language_probability) if info.language_probability else None}


PROVIDERS: dict[str, Provider] = {"mock": MockProvider(), "canary": CanaryProvider(), "whisper": WhisperProvider()}


def pick_provider(language: str) -> Provider:
    default = os.environ.get("ASR_PROVIDER", "canary")
    name = "mock" if default == "mock" else LANG_PROVIDER.get(language, default)
    if name == "whisper" and os.environ.get("ASR_ENABLE_WHISPER", "false").lower() != "true":
        raise HTTPException(501, f"language '{language}' needs the whisper provider, which is switched off")
    return PROVIDERS[name]


@app.get("/health")
def health():
    return {"status": "ok", "provider": os.environ.get("ASR_PROVIDER", "canary")}


@app.post("/transcribe")
async def transcribe(request: Request, language: str = "en"):
    if language not in LANG_PROVIDER:
        raise HTTPException(400, "unsupported language")
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "audio too large")
    provider = pick_provider(language)
    started = time.time()
    try:
        audio = decode_to_mono_16k(data)
    except Exception:
        raise HTTPException(415, "audio could not be decoded")
    audio = trim_silence(audio)
    if len(audio) < SAMPLE_RATE // 4:
        return {"text": "", "segments": [], "confidence": None, "provider": provider.name, "language": language}
    # Concurrency is bounded so three clips at once do not exhaust a small VM.
    with _lock:
        result = provider.transcribe(audio, language)
    result.update(provider=provider.name, language=language, seconds=round(time.time() - started, 2))
    return Response(content=__import__("json").dumps(result), media_type="application/json", headers={"Cache-Control": "no-store"})
