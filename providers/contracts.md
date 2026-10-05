# Provider Contracts

Jarvish treats all AI vendors as replaceable adapters.

Required adapter contract:
- name
- capability
- model identifier
- request translation
- normalized response
- timeout
- error normalization

Priority:
1. local
2. free/low-cost cloud
3. premium cloud escalation

No provider credential belongs in source control.
