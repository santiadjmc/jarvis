# Jarvis

Jarvis is a local-first, self-hosted AI assistant. It pairs a TypeScript server with a Flutter client for Android, Linux, and other desktop platforms. The server talks to any OpenAI-compatible model endpoint (Ollama by default) and exposes a WebSocket protocol that the client uses for chat, voice, device tools, and approvals.

Everything runs on hardware you control. There is no hosted Jarvis service and no telemetry.

## Features

- **Local or hosted models** — point `AI_BASE_URL` at Ollama, LM Studio, vLLM, llama.cpp, OpenRouter, OpenAI, or any other OpenAI-compatible API.
- **Two-tier routing** — a fast resident model for routine chat and a deeper model for reasoning-heavy work.
- **Streaming chat** with tool calling, cancellation, and automatic context compaction.
- **Voice** — speech-to-text in the client and optional Piper text-to-speech on the server.
- **Tool system** — files, shell, code search, web search/fetch, HTTP requests, memory, scheduling, calendar, Git, Gmail, Google Calendar, Drive, YouTube, a headless browser, and more.
- **Device tools** — let the assistant use the connected phone's capabilities (SMS, calls, contacts, location, notifications, clipboard, app launching, accessibility actions) with explicit capability gating.
- **Approvals** — risky tools require user confirmation unless auto-approve is enabled.
- **Memory** — a local facts store with embedding-based recall and substring fallback.
- **Proactive tasks** — schedule one-off or recurring instructions.
- **Flutter UI** — a HUD-style interface for chat, settings, setup, and voice.

## Architecture

```text
┌──────────────────────────┐        WebSocket / JSON         ┌──────────────────────────┐
│  Flutter client          │ ◄─────────────────────────────► │  TypeScript server       │
│  Android / Linux / ...   │                                 │  Express + ws            │
│                          │                                 │                          │
│  chat · voice · device   │                                 │  AI orchestrator         │
│  approvals · automation  │                                 │  tools · memory · tasks  │
└──────────────────────────┘                                 └────────────┬─────────────┘
                                                                          │
                                                          OpenAI-compatible HTTP API
                                                                          │
                                                              ┌───────────▼───────────┐
                                                              │ Ollama / LM Studio /  │
                                                              │ vLLM / OpenAI / ...   │
                                                              └───────────────────────┘
```

- `src/backend` — the server, agent loop, tools, memory, scheduling, voice, and tests.
- `src/app` — the Flutter client.
- `tool` — standalone end-to-end scripts for WebSocket, TTS, and device flows.

## Requirements

- **Node.js 20+** and npm
- **Flutter 3.29+** with the platform toolchain you need (Android SDK, Linux desktop packages, etc.)
- **A model endpoint** — [Ollama](https://ollama.com/) is the easiest default:

  ```bash
  ollama pull llama3.2
  ollama pull nomic-embed-text
  ```

Optional:

- Piper and a voice model for server-side text-to-speech.
- A SearXNG instance for `web_search`.
- Redis if you want the optional cache backend.
- Google OAuth credentials for Gmail, Calendar, Drive, and YouTube tools.

## Quick start

### 1. Server

```bash
git clone https://github.com/santiadjmc/jarvis.git
cd jarvis
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
JWT_SECRET=<long random string>
JARVIS_MASTER_KEY=<long random admin key>
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=ollama
AI_MODEL=llama3.2
```

Then start it:

```bash
npm run dev
```

The server listens on `http://0.0.0.0:3000` by default. Check `GET /health`.

### 2. Flutter client

```bash
cd src/app
flutter pub get
flutter run
```

In the app, enter the server address shown in the server log (for example `http://192.168.1.20:3000`) and the API key. On Android, the client can connect over the LAN; the manifest allows cleartext HTTP for local-network use.

### 3. API key

The server authenticates clients with API keys. Set `JARVIS_MASTER_KEY` in `.env` to bootstrap an admin key, or follow the auth flow in `src/backend/auth` for creating additional keys. Never commit your real `.env`.

## Configuration

All configuration lives in environment variables. See [`.env.example`](.env.example) for the full list with comments. The most important ones:

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | HTTP/WebSocket listen address. |
| `JWT_SECRET` | Signs session tokens. Use a long random value. |
| `JARVIS_MASTER_KEY` | Bootstrap admin API key. Use a long random value. |
| `CORS_ORIGINS` | Comma-separated browser origins. Defaults to localhost only. |
| `AI_BASE_URL` | OpenAI-compatible API root, e.g. `http://127.0.0.1:11434/v1`. |
| `AI_API_KEY` | Bearer token for the model endpoint. |
| `AI_MODEL`, `AI_DEEP_MODEL` | Fast and deep model names. |
| `JARVIS_ROUTING` | `auto`, `always_fast`, or `always_deep`. |
| `OLLAMA_BASE_URL` | Native Ollama API used for embeddings. |
| `JARVIS_TOOLS` | Allow/deny tools: `*`, `none`, `a,b`, or `-a,-b`. |
| `JARVIS_DEVICE_TOOLS` | Allow/deny device tools. |
| `JARVIS_AUTO_APPROVE` | `1` to skip approval prompts for risky tools. |
| `JARVIS_DATA_DIR` | Where memory, tasks, and calendar JSON live. Defaults to `~/.local/share/jarvis`. |
| `JARVIS_FETCH_ALLOW_PRIVATE` | `1` lets `fetch_url` reach private/loopback addresses. Off by default. |
| `TTS_*` | Piper binary, voice, model directory, and speed. |
| `GOOGLE_*` | OAuth client for Google tools. |

## Tests and checks

Backend:

```bash
npm run typecheck
npm test
```

Flutter client:

```bash
npm run analyze:app
npm run test:app
```

Or run the Flutter commands directly from `src/app`:

```bash
flutter analyze
flutter test
```

## Security notes

- Jarvis is designed to run on a trusted local network. Do not expose the server directly to the public internet without a reverse proxy, TLS, and authentication review.
- `.env` contains secrets. It is git-ignored; keep it that way and rotate any key that has ever been committed.
- The server binds to `0.0.0.0` by default so phones on the LAN can connect. Set `HOST=127.0.0.1` if you only use the desktop client.
- `fetch_url` blocks loopback, private, link-local, and other reserved addresses by default. Set `JARVIS_FETCH_ALLOW_PRIVATE=1` only if you understand the SSRF risk.
- The Android client requests sensitive permissions (SMS, calls, contacts, location, accessibility) because device tools use them. Review the manifest and disable capabilities you do not need.
- Risky tools require approval. Keep `JARVIS_AUTO_APPROVE=0` unless you fully trust the model and the prompts it receives.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Project layout

```text
.
├── src/backend/            TypeScript server
│   ├── ai/                 orchestrator, model routing, conversation compaction
│   ├── agent/              memory, scheduler, calendar, Google, subagents, browser
│   ├── auth/               API keys and JWT
│   ├── server/             Express, WebSocket, REST routes
│   ├── tools/              tool registry and implementations
│   ├── voice/              Piper TTS
│   └── tests/              backend tests
├── src/app/                Flutter client
│   ├── lib/chat/           chat state and protocol
│   ├── lib/services/       WebSocket, voice, device tools, automation, background
│   └── lib/ui/             screens and theme
├── tool/                   end-to-end scripts
└── .github/                CI and community templates
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Jarvis is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE).

If you run a modified version of Jarvis as a network service, the AGPL requires you to make the corresponding source available to users of that service.
