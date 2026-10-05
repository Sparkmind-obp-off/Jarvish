# Voice

Target pipeline:

Microphone
→ VAD
→ STT
→ Jarvish Core
→ TTS
→ Speaker

Local-first targets:
- whisper.cpp
- Piper or Kokoro
- open-source/local VAD

Cloud adapters remain optional fallbacks.
