# Jarvish Security

## Credential rules
- Never commit API keys, OAuth secrets, cookies, tokens or production credentials.
- Use environment/secret storage.
- Keep .env files ignored.
- Separate development and production credentials.

## Permission rules
All tools declare a permission level.
Risky external actions require confirmation.
Destructive operations are never silently inferred.

## Evidence
Execution should retain enough structured evidence to explain:
- what was requested
- what Jarvish planned
- which tools ran
- what changed
- how the result was verified

## Provider isolation
Provider adapters receive only the data required for their task. The core remains provider-neutral.
