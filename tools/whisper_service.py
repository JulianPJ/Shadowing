"""Optional local CPU transcription service. No YouTube downloads or paid API.

pip install -r tools/requirements.txt
uvicorn tools.whisper_service:app --host 127.0.0.1 --port 8765
"""
import os
import tempfile
import threading
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

app = FastAPI(title="Hibiki local transcription")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_methods=["POST", "GET"], allow_headers=["*"])
lock = threading.Lock()


@lru_cache(maxsize=1)
def model():
    # Downloads the open model on first use. Override to small/medium for better accuracy.
    return WhisperModel(os.environ.get("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")


@app.get("/health")
def health():
    return {"ready": True}


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...)):
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Another transcription is running. Try again shortly.")
    name = None
    try:
        suffix = Path(file.filename or "audio.wav").suffix[:10]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as output:
            name = output.name
            total = 0
            while chunk := file.file.read(1024 * 1024):
                total += len(chunk)
                if total > 250 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Use media smaller than 250 MB.")
                output.write(chunk)
        segments, _ = model().transcribe(name, language="ja", vad_filter=True, beam_size=5)
        cues = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments if s.text.strip()]
        if not cues:
            raise HTTPException(status_code=422, detail="No speech found.")
        return {"cues": cues}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=422, detail="This audio could not be transcribed.") from error
    finally:
        if name:
            Path(name).unlink(missing_ok=True)
        lock.release()
