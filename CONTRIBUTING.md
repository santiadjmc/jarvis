# Contributing to Jarvis

Thanks for taking the time to contribute. This document covers the development setup, the checks we run, and what we look for in a pull request.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For large changes, open an issue first so we can agree on the approach.
- Do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

### Backend

```bash
git clone https://github.com/santiadjmc/jarvis.git
cd jarvis
npm install
cp .env.example .env
```

Fill in `JWT_SECRET`, `JARVIS_MASTER_KEY`, and your model endpoint in `.env`. A local Ollama instance is the simplest option:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
npm run dev
```

### Flutter client

```bash
cd src/app
flutter pub get
flutter run
```

The client needs a running server. Use the LAN address printed by the server, or `http://127.0.0.1:3000` for the desktop client.

## Checks

Run these before opening a pull request:

```bash
npm run typecheck
npm test
npm run analyze:app
npm run test:app
```

If you changed only the backend, the first two are enough. If you changed only the Flutter client, the last two are enough. CI runs all four.

## Code style

- Match the existing style in the file you are editing.
- Keep the backend in TypeScript and the client in Dart.
- Prefer small, focused functions and explicit error handling.
- Do not add comments that restate the code. Use comments only when the reason for a decision is not obvious.
- Do not commit generated files, build output, `node_modules`, `.env`, signing keys, or local machine paths.

## Pull requests

- Keep each pull request focused on one problem.
- Describe what changed, why, and how you tested it.
- Include screenshots or recordings for UI changes.
- Update documentation and `.env.example` when you add or change configuration.
- Make sure the diff contains no secrets and no unrelated reformatting.

We may ask for changes before merging. By submitting a pull request you agree that your contribution is licensed under the project's [AGPL-3.0-only license](LICENSE).

## Commit messages

Use a short imperative subject line, for example:

```text
Fix conversation compaction ordering
Add Gmail header validation
Document local model setup
```

Add a body when the change needs context. Reference issues with `Fixes #123` or `Refs #123`.

## Community

Be respectful and constructive. Everyone interacting with the project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
