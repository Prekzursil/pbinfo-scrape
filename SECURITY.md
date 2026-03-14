# Security Policy

## Supported versions

This repository is supported on the current private `main` branch and the latest tagged release of **Problem Archive Crawler**.

Older snapshots, branches, and local-only workspace state are provided as historical references and may not receive security fixes.

## Reporting a vulnerability

This repository is intentionally **private**. Please keep vulnerability reports inside GitHub and avoid posting sensitive material anywhere else.

Preferred reporting path:

1. If you have access to repository security advisories, open a **draft GitHub Security Advisory**. This is the preferred private-reporting path for supported releases.
2. Otherwise, open a repository issue and clearly mark it as a **security report** so it can stay within the private collaboration space.
3. If the report includes PBInfo sessions, cookies, local archive paths, or other sensitive reproduction details, minimize the data and redact secrets before sharing it.

Please do **not** include:

- live PBInfo credentials
- raw session cookies
- `.local/` contents
- exported secret bundles or age identities
- private archive payloads that are not necessary to explain the issue

## Response expectations

- We will triage the report on the current supported line.
- Fixes will be validated locally with the existing verification suite before they are merged.
- Remediation notes will stay private unless a future disclosure is intentionally prepared.
- Release reproducibility, canonical snapshot ownership, and maintainer verification steps are documented in [MAINTAINING.md](./MAINTAINING.md).
