# Jarvish maturity — evidence-based

This is a status map, not a replacement for implementation.

| Stage | Implemented now | Activation or remaining work |
|---|---|---|
| V0 TALK | Browser mic/STT adapter, Groq adapter, authenticated core/API, browser TTS, error states | Live Groq secret and physical user-device voice round trip; local Whisper/Piper not active |
| V1 MEMORY | Typed D1 facts, relevance retrieval, chronological session history, explicit approval/write/read-back | Dedicated production D1 blocked by account quota; Wrangler local D1 tested |
| V2 SEE | Existing vision boundary preserved | No vision/OCR or screenshot-understanding provider; not claimed |
| V3 ACT | Tool registry, GitHub inspect/branch, web read, memory write/search/delete, verification ledger | Real web read + memory verified locally; GitHub external writes need optional scoped runtime token and confirmation |
| V4 AUTONOMY | Bounded plans (4 independent steps), gates, atomic claims, checkpoints and one read-only retry | No autonomous background queue, output chaining or uncontrolled loops; not full autonomy |
| V5 OPERATOR | Owner workspace + persistent execution records | Activation + repeatable live user tasks required before operational claim |
| V6 TRUE JARVISH | Objective retained | Not built/functional/operational as a complete system |

## Immediate activation

Make dedicated D1 quota available, run `node scripts/activate-d1.mjs`, set encrypted production owner/Groq secrets, redeploy, verify health + real chat + memory + tools + voice. Other projects remain technically and operationally separate. The D1 activation script never deletes/reuses their resources.

## Subsequent engineering

Connect a separate authenticated local inference/STT/TTS runtime, add provider-independent vision, implement narrowly scoped calendar/email adapters, add explicit output chaining and interrupted-run investigation/recovery, and implement user-controlled retention/erasure. Each requires tests and real verification before a maturity claim. Shell/desktop control must run outside Workers through an explicitly secured execution agent, not Node processes embedded in the edge application.
