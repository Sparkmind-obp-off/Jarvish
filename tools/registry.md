# Tool Registry Contract

Every tool must declare:
- unique name
- description
- input schema
- permission level
- confirmation policy
- timeout
- deterministic result/evidence format

Execution flow:
PLAN → CHECK PERMISSION → CONFIRM IF REQUIRED → EXECUTE → VERIFY → RECORD EVIDENCE → REPORT
