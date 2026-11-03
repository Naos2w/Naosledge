# NaosTeams validation profile

The trusted repository base opts into repository QA using the existing offline CI checks: TypeScript, production build, offline unit tests and the closed-production HTTP smoke. The supervisor runs these checks in its isolated workspace; an Agent cannot replace this profile during a task. Passing checks alone do not prove product acceptance.

This profile grants no production publication, Vault access, Neon credential access or live synchronization authority. Real browser/device requirements and live integration checks must be reported as unverified unless separately authorized evidence exists. Target product work remains in isolated attempts.
