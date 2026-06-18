# coastalos/vibevoice/server.py
# FastAPI wrapper around VibeVoice-ASR-7B and VibeVoice-Realtime-0.5B
# Exposes:  POST /asr   — audio → JSON transcript (with diarization)
#           WS   /tts/stream — text → streaming PCM audio chunks
#           GET  /health

import asyncio, io, json, logging, os
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, UploadFile, WebSocket
from fastapi.responses import JSONResponse
from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vibevoice")

app = FastAPI(title="coastal-vibevoice")

# ---------- ASR ----------
ASR_MODEL_ID = os.getenv("VIBEVOICE_ASR_MODEL", "microsoft/VibeVoice-ASR")
asr_processor = None
asr_model = None

def load_asr():
    global asr_processor, asr_model
    if asr_model is not None:
        return
    log.info(f"Loading ASR model: {ASR_MODEL_ID}")
    asr_processor = AutoProcessor.from_pretrained(ASR_MODEL_ID)
    asr_model = AutoModelForSpeechSeq2Seq.from_pretrained(
        ASR_MODEL_ID,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )
    log.info("ASR model loaded")

# ---------- TTS ----------
TTS_MODEL_ID = os.getenv("VIBEVOICE_TTS_MODEL", "microsoft/VibeVoice-Realtime-0.5B")
tts_processor = None
tts_model = None

def load_tts():
    global tts_processor, tts_model
    if tts_model is not None:
        return
    log.info(f"Loading TTS model: {TTS_MODEL_ID}")
    from vibevoice.modular.modeling_vibevoice_streaming_for_conditional_generation import (
        VibeVoiceStreamingForConditionalGenerationInference,
    )
    from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor
    tts_processor = VibeVoiceStreamingProcessor.from_pretrained(TTS_MODEL_ID)
    tts_model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
        TTS_MODEL_ID,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        device_map="auto",
    )
    log.info("TTS model loaded")

@app.on_event("startup")
async def startup():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_asr)
    await loop.run_in_executor(None, load_tts)

@app.get("/health")
async def health():
    return {"status": "ok", "asr": asr_model is not None, "tts": tts_model is not None}

@app.post("/asr")
async def transcribe(audio: UploadFile = File(...), sample_rate: int = Form(16000)):
    raw = await audio.read()
    audio_array, sr = sf.read(io.BytesIO(raw))
    if sr != 16000:
        import librosa
        audio_array = librosa.resample(audio_array, orig_sr=sr, target_sr=16000)
    inputs = asr_processor(audio_array, sampling_rate=16000, return_tensors="pt")
    inputs = {k: v.to(asr_model.device) for k, v in inputs.items()}
    with torch.no_grad():
        output = asr_model.generate(**inputs)
    raw_text = asr_processor.batch_decode(output, skip_special_tokens=False)[0]
    parsed = asr_processor.post_process_transcription(raw_text)
    return JSONResponse(parsed)

@app.websocket("/tts/stream")
async def tts_stream(ws: WebSocket):
    await ws.accept()
    data = json.loads(await ws.receive_text())
    text = data.get("text", "")
    voice = data.get("voice", "en_us_female_1")
    from vibevoice.modular.streamer import AsyncAudioStreamer
    streamer = AsyncAudioStreamer(batch_size=1)
    inputs = tts_processor(text=[text], voice=voice, return_tensors="pt")
    inputs = {k: v.to(tts_model.device) for k, v in inputs.items()}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, lambda: tts_model.generate(**inputs, streamer=streamer))
    async for chunk in streamer:
        pcm = (chunk[0].cpu().numpy() * 32767).astype(np.int16).tobytes()
        await ws.send_bytes(pcm)
    await ws.send_text(json.dumps({"done": True}))
    await ws.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("VIBEVOICE_PORT", "8001")))
