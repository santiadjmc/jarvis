# Security Policy

## Supported versions

Jarvis is developed on the `main` branch. Security fixes are applied there; older commits and forks are not supported.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version or commit, a description, reproduction steps, and any suggested fix.

If private reporting is unavailable, contact the maintainers through the repository before disclosing details publicly.

We will acknowledge the report as soon as possible, investigate, and coordinate a fix and disclosure timeline with you. Please give us reasonable time to release a fix before publishing details.

## Scope

In scope:

- Authentication and authorization bypasses.
- Remote code execution, command injection, and path traversal.
- Server-side request forgery (SSRF) and unsafe URL handling.
- Secret leakage, credential handling, and token validation.
- Cross-site scripting and injection in server-rendered pages.
- Unsafe defaults that expose a self-hosted deployment.
- Vulnerabilities in Jarvis's own code.

Out of scope:

- Vulnerabilities in third-party dependencies that are already publicly known and have an upstream fix (report them upstream, but tell us if Jarvis needs a version bump).
- Issues that require an attacker to already control the host, the model, or the `.env` file.
- Prompt injection that only causes the model to produce misleading text.
- Missing hardening on a deployment that deliberately exposes the server to the public internet without a reverse proxy.

## Deployment guidance

Jarvis is a local-first assistant and assumes a trusted network.

- Do not expose the server directly to the internet. Put it behind a reverse proxy with TLS and strong authentication if remote access is required.
- Keep `JARVIS_AUTO_APPROVE=0`. Risky tools are gated behind user approval for a reason.
- Set `HOST=127.0.0.1` when you do not need LAN access from a phone.
- Use long, random values for `JWT_SECRET` and `JARVIS_MASTER_KEY`.
- Never commit `.env`. If a secret was committed, rotate it immediately and remove it from git history.
- `fetch_url` blocks private and loopback addresses by default. Only set `JARVIS_FETCH_ALLOW_PRIVATE=1` if you accept the SSRF risk.
- Review the Android permissions in `src/app/android/app/src/main/AndroidManifest.xml`. Disable device capabilities you do not use.

## Known limitations

- The model endpoint is trusted. A malicious or compromised model server can return hostile tool calls and content.
- Tool output is untrusted input. Prompt injection through web pages, email, or files is possible; approvals reduce but do not eliminate the risk.
- The local JSON stores (memory, tasks, calendar) are not encrypted at rest. Protect the host account and `JARVIS_DATA_DIR`.
