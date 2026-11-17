# Security Policy

## Supported versions

Code Atlas has not yet published a stable release, so no stable version is currently supported. The `0.1.0-SNAPSHOT` build and individual commits are development artifacts, not supported releases. Security reports for reproducible issues on the latest `main` branch are still welcome on a best-effort basis; older commits are not maintained.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/sajjadvalaei110/prompt-proof/security/advisories/new) to open a private security advisory. Do not open a public issue for a suspected vulnerability.

Please include:

- the affected commit or version, operating system, and relevant runtime or indexer;
- steps to reproduce the issue and its potential security impact;
- a minimal proof of concept, where possible; and
- relevant logs or screenshots with sensitive values removed.

Do not include private source code, credentials, imported indexes or databases, or private prompts. Use redacted evidence and synthetic fixtures instead.

## Sensitive boundaries

Code Atlas reads local repository trees and stores imported source, indexes, and application data locally. Source-only analysis treats imported repositories as read-only and does not run their builds or application code. The optional scip-java engine is a narrow exception: it requires explicit, recorded consent and runs the target Gradle build only in a private copy. Git review captures always use source-only analysis.

The server binds to loopback (`127.0.0.1`) by default; exposing it to other machines can expose local project data and APIs. Source content is sent only to the model endpoint configured by the user, so that endpoint is part of the user's trust boundary.

See the [architecture documentation](docs/ARCHITECTURE.md) and [ADR 0012](docs/adr/0012-scip-java-indexer.md) for the detailed trust and build-consent boundaries.

## Response expectations

Maintainers review private reports on a best-effort basis and use the private advisory to coordinate triage, fixes, and any disclosure. No fixed acknowledgement or remediation deadline is guaranteed.
