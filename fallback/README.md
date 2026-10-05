# Fallback

Provider order is configurable.

Example:
LOCAL → CLOUDFLARE/EDGE → FREE CLOUD → PREMIUM

Failures are normalized so the core can retry with another provider without changing business logic.
