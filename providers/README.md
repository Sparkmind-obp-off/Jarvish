# Providers

Provider adapters belong here.

Initial targets:
- Local LLM: Ollama / llama.cpp
- Cloud/free: Gemini / Groq / OpenRouter / Hugging Face
- Optional premium: OpenAI / Anthropic
- Local STT: whisper.cpp
- Local TTS: Piper / Kokoro

The core must depend on interfaces, never vendor-specific SDKs.
