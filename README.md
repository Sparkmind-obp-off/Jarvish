# Jarvish

Personal AI Operator — independent from HOLBERY.

## Vision
Voice-first, memory-aware, tool-using, verifiable personal operator.

VOICE INPUT → UNDERSTAND → CONTEXT/MEMORY → PLAN → TOOLS → EXECUTE → VERIFY → REMEMBER → VOICE OUTPUT

## Project boundary
Jarvish is a standalone project. It does not depend on HOLBERY or Bozq One System.

## Architecture
- apps/web — future voice-first UI
- core — provider-independent Jarvish core
- voice — STT/TTS/VAD/wake-word adapters
- memory — memory policy and persistence
- tools — safe tool registry and adapters
- providers — interchangeable AI providers
- cloudflare — edge/control-plane configuration
- database — schema and migrations
- tests — contract and integration tests
- docs — architecture, roadmap, security

## Principles
1. Core ownership: Jarvish logic is ours, providers are adapters.
2. Local-first where practical.
3. Cloudflare-first for the control plane.
4. Free/open-source first; paid providers are optional escalation.
5. No single AI provider is mandatory.
6. External actions require explicit permission according to risk.
7. Every meaningful execution should produce evidence and verification.

## Status
Foundation bootstrap.
