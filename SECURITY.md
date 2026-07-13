# Security Policy

## Reporting A Vulnerability

Please report security vulnerabilities privately to the project maintainers. Do not include real sensitive files, private documents, photos, archives, or metadata values in public GitHub issues.

If a private channel is not yet published for this repository, open a minimal public issue that says you need to report a security vulnerability, without attaching files or revealing exploit details.

## Scope

Security reports are in scope when they affect BURAN's browser-only processing model, metadata sanitisation correctness, verification correctness, archive safety limits, local certificate generation, or privacy claims.

BURAN processes files locally in the browser. There is no backend, account system, telemetry, analytics, upload API, database, or cloud processing path.

## Supported Versions

Only the latest public release receives security fixes. Pre-release snapshots and local development branches are not covered by a long-term support policy.

## Handling Test Files

Use synthetic fixtures only. Never submit private or sensitive real-world files in public issues or pull requests.
