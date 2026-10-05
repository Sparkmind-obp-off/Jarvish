# Voice Runtime

Target:
MIC → VAD → STT → CORE → LLM → TTS → SPEAKER

Local-first:
- whisper.cpp for STT
- Piper/Kokoro for TTS
- local VAD
- optional wake-word adapter

Cloud fallback adapters can be added without changing Jarvish Core.
