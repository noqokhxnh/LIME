from contextlib import asynccontextmanager
import io
import time
from typing import Any, Optional
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
import soundfile as sf  # type: ignore[import-untyped, import-not-found]
from vieneu import Vieneu  # type: ignore[import-untyped, import-not-found]

_tts_engine: Any = None

def get_tts() -> Any:
    global _tts_engine
    if _tts_engine is None:
        print("[VieNeu-TTS] Đang tải mô hình v3nano ONNX...")
        _tts_engine = Vieneu(mode="v3nano")
        print("[VieNeu-TTS] Tải mô hình thành công.")
    return _tts_engine

@asynccontextmanager
async def lifespan(_: FastAPI):
    get_tts()
    yield

app = FastAPI(title="VieNeu-TTS Microservice", version="1.0.0", lifespan=lifespan)

class TTSRequest(BaseModel):
    text: str = Field(..., description="Văn bản tiếng Việt cần đọc")
    voice: Optional[str] = Field("Minh Quân", description="Tên giọng đọc")
    speed: Optional[float] = Field(1.0, description="Tốc độ đọc (1.0 là bình thường)")

@app.get("/health")
def health():
    return {"status": "ok", "model": "v3nano"}

@app.get("/api/voices")
def list_voices():
    engine = get_tts()
    voices = engine.list_preset_voices()
    return [{"name": name, "id": code} for name, code in voices]

@app.post("/api/tts")
def synthesize(req: TTSRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Văn bản không được để trống")

    engine = get_tts()
    # Nguồn sự thật là list_preset_voices() -> [(label, id), ...]. Trước đây dùng
    # getattr(engine, "available_voices", []) nhưng Vieneu v3nano KHÔNG có thuộc
    # tính này, nên set luôn rỗng và mọi request bị ép về giọng mặc định.
    preset_pairs = engine.list_preset_voices()
    available_voices = {name for _, name in preset_pairs}
    ordered_names = [name for _, name in preset_pairs]
    engine_default = getattr(engine, "_default_voice", None)
    if engine_default in available_voices:
        default_voice = engine_default
    else:
        default_voice = ordered_names[0] if ordered_names else "Minh Quân"

    req_voice = (req.voice or "").strip()
    if req_voice and req_voice in available_voices:
        voice_to_use = req_voice
    else:
        voice_to_use = default_voice
        if req_voice:
            print(
                f"[VieNeu-TTS] Cảnh báo: giọng '{req_voice}' không có trong danh sách "
                f"{sorted(available_voices)}. Tự động chuyển về '{voice_to_use}'."
            )

    t0 = time.time()
    try:
        audio = engine.infer(text, voice=voice_to_use, speed=req.speed or 1.0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tổng hợp giọng nói: {str(e)}")

    infer_time = time.time() - t0
    sample_rate = 24000
    duration = len(audio) / float(sample_rate)
    rtf = infer_time / duration if duration > 0 else 0

    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV")
    buf.seek(0)
    wav_bytes = buf.read()

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "X-Audio-Duration": f"{duration:.3f}",
            "X-Inference-Time": f"{infer_time:.3f}",
            "X-RTF": f"{rtf:.3f}",
        },
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
