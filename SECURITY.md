# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/e-jung/spellami/security/advisories/new) (repository **Security → Advisories → Report a vulnerability**).

Do not open public issues containing vulnerabilities, credentials, Family Codes, or real family data. Include the affected build/version, reproduction steps using fictional data, impact, and any suggested fix. Keep reports private while a fix is coordinated.

Security fixes target the latest version on the default branch. Self-hosters should update and review deployment configuration. The Node/Docker build is intended for a trusted LAN; the Worker build provides family isolation but requires operators to protect secrets and backups. Family Codes grant kid-level access and must be kept private.
