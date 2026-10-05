# Jarvish Architecture

## System loop

VOICE INPUT
→ UNDERSTAND
→ MEMORY / CONTEXT
→ REASON / PLAN
→ TOOL SELECTION
→ EXECUTE
→ VERIFY
→ REMEMBER
→ VOICE OUTPUT

## Control plane

Cloudflare Pages hosts the web client.
Cloudflare Workers expose the API/orchestration boundary.
Durable Objects manage realtime sessions and long-lived task state.
D1 stores canonical structured memory and task metadata.
KV is used for cache/short-lived state.
R2 stores artifacts such as audio, documents, screenshots and execution evidence.
Cloudflare AI Gateway can sit between Jarvish and external AI providers for routing, observability, caching and resilience.
Workers AI is an optional edge inference fallback.

## Provider abstraction

The Jarvish core must never assume one model vendor.

LLMProvider:
- local: Ollama / llama.cpp
- cloud/free-tier: Gemini / Groq / OpenRouter / Hugging Face
- premium optional: OpenAI / Anthropic / other compatible providers

VoiceProvider:
- local STT: whisper.cpp
- local TTS: Piper / Kokoro
- optional cloud STT/TTS adapters

## Execution policy

LEVEL 0 READ
- inspect files
- inspect projects
- web research
- status

LEVEL 1 SAFE WRITE
- create drafts
- save notes
- save memory
- create branches

LEVEL 2 EXTERNAL ACTION
- send
- publish
- merge
- deploy

LEVEL 3 DESTRUCTIVE
- delete
- revoke
- production overwrite
- financial action

Level 2 and Level 3 actions require confirmation by default.

## Independence

Jarvish has no runtime dependency on HOLBERY. Integration, if ever needed, must happen through explicit APIs/adapters.
