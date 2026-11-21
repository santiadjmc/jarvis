<div align="center">

# 🤖 Jarvis

**A local-first AI assistant that actually lives on your hardware.**

Chat, voice, tools, memory, and device control — all wired to the model you choose.

[![CI](https://github.com/santiadjmc/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/santiadjmc/jarvis/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js 22.19+](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Flutter stable (Dart 3.13+)](https://img.shields.io/badge/Flutter-stable%20%C2%B7%20Dart%203.13%2B-02569B?logo=flutter&logoColor=white)](https://flutter.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

Jarvis is a self-hosted AI assistant with a TypeScript server and a Flutter client for Android, Linux, and other desktop platforms. It talks to any OpenAI-compatible model endpoint — Ollama by default — and connects the client over a WebSocket protocol for chat, voice, device tools, and approvals.

No hosted Jarvis service. No telemetry. No account. Just your machine, your model, and your data.

## ✨ Why Jarvis?

| | |
| --- | --- |
| 🔒 **Yours** | Runs on your hardware. Conversations, memory, tasks, and files stay local. |
| 🧠 **Model-agnostic** | Ollama, LM Studio, vLLM, llama.cpp, OpenRouter, OpenAI — if it speaks the OpenAI API, Jarvis can use it. |
| 🛠️ **Actually useful** | Not just chat. Jarvis can search, read, write, run commands, manage Git, send email, control a browser, and use your phone. |
| 📱 **Everywhere** | A HUD-style Flutter client for Android and desktop, with voice input and device-side tools. |
| 🛡️ **You stay in control** | Risky tools ask for approval. Tool access is allowlistable. Network tools block private addresses by default, and prompt-injection guardrails limit what external content can make Jarvis do. |

## 🚀 What it can do

- 🧠 **Bring your own brain** — point `AI_BASE_URL` at a local or hosted OpenAI-compatible endpoint.
- ⚡ **Fast + deep routing** — a resident fast model for everyday chat, a deeper model for reasoning-heavy work.
- 💬 **Streaming chat** — tool calling, cancellation, automatic context compaction, and a per-conversation queue so messages run one at a time, in order.
- 🎙️ **Voice in, voice out** — speech-to-text in the client (the platform recognizer on Android/iOS, on-device Whisper on Linux) and optional Piper text-to-speech on the server.
- 🛠️ **A real toolbox** — files, shell, code search, web search, HTTP, memory, scheduling, calendar, Git, Gmail, Google Calendar, Drive, YouTube, and a headless browser.
- 📱 **Device superpowers** — SMS, calls, contacts, location, notifications, clipboard, app launching, and accessibility actions, gated by capability.
- 🧰 **Memory, routines & subagents** — a local facts store with embedding recall, one-off and recurring tasks, and delegated subagents.
- 🛡️ **Guardrails** — approval prompts for risky tools, file-access roots, SSRF protection, and provenance tracking for conversations that have read external content.
- 🎨 **HUD-style client** — chat, settings, setup, and voice in a focused interface.

## 🏗️ Architecture

```text
┌──────────────────────────┐  WebSocket / JSON (Bearer key)  ┌──────────────────────────┐
│  Flutter client          │ ◄──── wss:// or ws:// /ws ────► │  TypeScript server       │
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

**The loop:**

1. The client connects to `/ws` with an `Authorization: Bearer <key>` header and sends a message.
2. The message waits its turn in the conversation's queue, then the server routes it to the fast or deep model.
3. The model calls tools; the server executes them or asks you to approve.
4. Results stream back, and long conversations compact themselves.

- `src/backend` — server, agent loop, tools, memory, scheduling, voice, and tests.
- `src/app` — the Flutter client.
- `tool` — standalone Node end-to-end scripts for WebSocket, TTS, and device flows (`src/app/tool` has Dart equivalents).

## 🧰 The toolbox

| Area | Tools |
| --- | --- |
| 🌐 **Web** | `web_search` (via SearXNG), `fetch_url`, `http_request`, `get_weather`, `convert_currency`, `get_public_ip` |
| 📂 **Files & code** | `read_file`, `write_file`, `append_file`, `copy_file`, `move_file`, `delete_file`, `list_dir`, `search_files`, `grep_files`, `run_command`, `git_status`, `git_diff`, `git_log`, `git_commit` |
| 🧠 **Memory & time** | `remember`, `recall`, `forget`, `list_memories`, `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`, `create_event`, `list_events`, `delete_event` |
| 🤝 **Subagents** | `delegate_task`, `list_agents` |
| 📬 **Communication** | `send_email`, `gmail_list_messages`, `gmail_read_message`, `gmail_send`, `google_account_status`, `google_calendar_*`, `google_drive_*`, `youtube_*` |
| 🖥️ **Browser** | `browser_open`, `browser_click`, `browser_type`, `browser_extract_text`, `browser_screenshot`, `browser_list_pages`, `browser_close` |
| 📱 **Device** | `device_get_battery`, `device_get_location`, `device_send_sms`, `device_send_whatsapp_message`, `device_call_number`, `device_list_contacts`, `device_launch_app`, `device_show_notification`, `device_read_screen`, `device_tap`, `device_type_text`, and more |
| ⚙️ **System & utility** | `get_system_info`, `get_time`, `list_processes`, `kill_process`, `launch_app`, `list_devices`, `ping_host`, `check_port`, `calculate`, `convert_units`, `generate_uuid`, `generate_password` |

Enable or restrict tools with `JARVIS_TOOLS` and `JARVIS_DEVICE_TOOLS`. Device tools are only offered to the model while a connected device has the matching capability.

## ⚡ Quick start

### Requirements

| Component | Needed for | Notes |
| --- | --- | --- |
| **Node.js 22.19+** | the server | `engines.node` is `>=22.19` (CI runs Node 24). |
| A model endpoint | chat | Any OpenAI-compatible `/v1` API. [Ollama](https://ollama.com/) is the path of least resistance. |
| Ollama + `nomic-embed-text` | memory recall (optional) | Embeddings use Ollama's native API. Without it, memory search falls back to substring matching. |
| **Flutter** (stable, Dart SDK ≥ 3.13.2) | the client | Set by `environment.sdk` in `src/app/pubspec.yaml`. |
| [SearXNG](https://docs.searxng.org/) with JSON output | `web_search` (optional) | Defaults to `http://127.0.0.1:8080`. |
| [Piper](https://github.com/rhasspy/piper) + a voice model | server TTS (optional) | Off unless `TTS_ENABLED=true`. |
| Chrome runtime libraries | `browser_*` tools (optional) | Puppeteer downloads Chromium; see [pptr.dev/troubleshooting](https://pptr.dev/troubleshooting). |
| Redis | caching (optional) | Falls back to an in-memory cache when unreachable. |

Speech-to-text runs in the client: Android/iOS use the platform recognizer (`speech_to_text`), and Linux uses on-device Whisper (`whisper_ggml`, which downloads the `base.en` model on first use). The server does not need Whisper.

### 1. Wake up the server

```bash
git clone https://github.com/santiadjmc/jarvis.git
cd jarvis
npm install
cp .env.example .env
```

Pull the default models:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

Edit `.env` and set at least:

```dotenv
JARVIS_MASTER_KEY=<long random admin key, e.g. from: openssl rand -base64 48>
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=ollama
AI_MODEL=llama3.2
```

Start it:

```bash
npm run dev            # tsx watch, restarts on file changes
npm start              # plain run
npm run start:managed  # under the built-in process manager (auto-restart, PM_* settings)
```

The server listens on `http://0.0.0.0:3000` by default. Check it with:

```bash
curl http://127.0.0.1:3000/health
```

### 2. Bring the client to life

```bash
cd src/app
flutter pub get
flutter run
```

In the app, enter the server address shown in the server log (for example `192.168.1.20:3000`) and the API key (your `JARVIS_MASTER_KEY`). The client uses encrypted `wss://` by default, but the stock server only speaks plain HTTP. For a server on your own LAN, turn on **Insecure LAN (ws://)** in the app settings; otherwise put the server behind a TLS reverse proxy and enter its `https://` address. Installs from before this setting existed are switched to Insecure LAN automatically if their saved address had no scheme or used `ws://`.

On Linux, the app stores the API key with libsecret. Building needs `libsecret-1-dev` (`sudo apt install libsecret-1-dev` on Debian/Ubuntu), and running needs `libsecret-1-0` plus a keyring such as GNOME Keyring or KWallet. If the keyring is locked or missing, the app falls back to its regular preferences file after a short timeout.

### 3. Say hello

Open the chat and ask it something. Then try something useful: “What’s in my Downloads folder?”, “Remind me at 6pm to call Alex”, or “Summarize the top story on Hacker News.”

## 🔑 Authentication

- Clients authenticate with API keys. `JARVIS_MASTER_KEY` in `.env` is loaded as an admin key at startup, and it is the key you enter in the app. Keys are kept only as SHA-256 hashes in memory and compared in constant time.
- If `JARVIS_MASTER_KEY` still has the placeholder value from `.env.example`, the server logs an error and refuses to load it, so no client can connect until you set a real secret. Keys shorter than 32 characters log a warning.
- WebSocket clients connect to `/ws` and send the key as an `Authorization: Bearer <key>` header on the upgrade request. Keys in the URL query (`?key=`) are rejected with an "outdated client" message.
- The app connects over `wss://` by default. Use **Insecure LAN (ws://)** only on a network you trust, or terminate TLS at a reverse proxy.
- Browser origins are checked for both the HTTP API and the WebSocket: `localhost`, `127.0.0.1` and `[::1]` on any port are always allowed, and `CORS_ORIGINS` adds more (`*` allows any origin).
- Never commit your real `.env`.

## 🔧 Configuration

All configuration lives in environment variables, loaded from `.env` in the repo root. [`.env.example`](.env.example) has every setting with longer comments. Defaults below are what the code uses when a variable is unset or blank.

### Server and auth

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket listen port. |
| `HOST` | `0.0.0.0` | Listen address. Use `127.0.0.1` if only local clients connect. |
| `TRUST_PROXY` | off | `1`/`true`/`yes`/`on` when running behind a reverse proxy: loopback requests are then never treated as local. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated extra browser origins for the HTTP API and WebSocket, on top of localhost on any port. `*` allows any origin. |
| `JARVIS_MASTER_KEY` | *(none)* | Admin API key loaded at startup. The `.env.example` placeholder is refused. |
| `API_KEY_PREFIX` | `jvs` | Prefix for generated API keys. |
| `NODE_ENV` | — | `production` sets the log level to `info` and drops debug logs; otherwise `debug`. |

### Model backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_BASE_URL` | `${OLLAMA_BASE_URL}/v1` → `http://127.0.0.1:11434/v1` | OpenAI-compatible API root (must expose `/v1/chat/completions`). |
| `AI_API_KEY` | `ollama` | Bearer token for the model endpoint. Ollama ignores it. |
| `AI_MODEL` | `llama3.2` | Fast, always-resident model. Falls back to the legacy `OLLAMA_DEFAULT_MODEL`. |
| `AI_DEEP_MODEL` | same as `AI_MODEL` | Model for reasoning-heavy work. Falls back to the legacy `OLLAMA_DEEP_MODEL`. |
| `JARVIS_ROUTING` | `auto` | `auto`, `always_fast`, or `always_deep`. |
| `AI_TIMEOUT` | `120000` | Model request timeout in ms. Falls back to the legacy `OLLAMA_TIMEOUT`. |
| `OLLAMA_BASE_URL` | `AI_BASE_URL` without `/v1` | Native Ollama API, used for embeddings and model discovery. |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model for memory recall. |

### Agent, tools and chat

| Variable | Default | Purpose |
| --- | --- | --- |
| `JARVIS_TOOLS` | `*` | Server tools: `*`, `none`, `a,b` (allow only), or `-a,-b` (all except). |
| `JARVIS_DEVICE_TOOLS` | `*` | Same syntax, for tools that run on the connected device. |
| `JARVIS_AUTO_APPROVE` | off | `1`/`true`/`yes` skips approval prompts for risky tools. |
| `JARVIS_MAX_TOOL_TURNS` | unlimited | Max LLM↔tool round-trips per response (live chat, tasks, subagents). Blank or `0` means no limit. |
| `JARVIS_MAX_SUBAGENTS` | `3` | Max subagents running at once. |
| `JARVIS_SEARXNG_URL` | `http://127.0.0.1:8080` | SearXNG instance for `web_search` (enable the JSON format). |
| `JARVIS_FETCH_ALLOW_PRIVATE` | off | `1` lets `fetch_url`, `http_request` (and redirects), `check_port` and the headless browser reach private/loopback addresses. |
| `JARVIS_BROWSER_NO_SANDBOX` | off | `1` disables Chromium's sandbox. It is turned off automatically when running as root. |
| `JARVIS_DATA_DIR` | `~/.local/share/jarvis` | Memory, tasks, calendar, agents, Google tokens, TTS cache and screenshots. |
| `JARVIS_FS_ROOTS` | `$HOME`, cwd, temp dir, `/var/log`, `/etc`, `/opt`, `/mnt` | Comma-separated roots the approval-free file tools may read. `/` allows everything. Secrets are always refused (see below). |
| `JARVIS_STREAM_IDLE_TIMEOUT_MS` | `180000` | Abort a chat request after this long without progress. Must exceed the 60 s approval and 90 s device-tool waits. |
| `JARVIS_CHAT_QUEUE_MAX` | `5` | Messages that may wait behind the running one in a conversation; more get `CONVERSATION_BUSY`. `0` rejects any message while a reply runs. |
| `JARVIS_NUM_CTX` | model's configured context (32000 if unknown) | Effective backend context window (e.g. Ollama `num_ctx`); caps compaction budgets. |
| `JARVIS_COMPACT_THRESHOLD` | `0.55` | Fraction of context that triggers summarization. |
| `JARVIS_COMPACT_BATCH` | `10` | Minimum new messages between compactions. |
| `JARVIS_MEMORY_AUTOLOAD` | on | `0` stops auto-recalling memories at the start of each run. |
| `JARVIS_MEMORY_TOP_K` | `3` | Memories recalled per run. |
| `JARVIS_MEMORY_MIN_SCORE` | `0.4` | Minimum similarity for recall. |
| `TZ` | system time zone | Time zone reported by `get_time`. |

### Prompt-injection guardrails

| Variable | Default | Purpose |
| --- | --- | --- |
| `JARVIS_PROVENANCE_GUARDS` | on | `0` turns the guardrails off (taint is still logged). |
| `JARVIS_TAINTED_TASK_MAX` | `3` | Max scheduled tasks created from tainted conversations. |
| `JARVIS_TAINTED_TASK_MIN_INTERVAL_MIN` | `60` | Minimum repeat interval (minutes) for those tasks. |
| `JARVIS_TAINTED_SUBAGENT_MAX` | `1` | Max subagents from tainted conversations at once. |
| `JARVIS_TAINTED_RUN_TOOLS` | `get_time,calculate,convert_units,generate_uuid,list_events,list_scheduled_tasks,recall` | The only tools those tasks and subagents may use. |
| `JARVIS_TAINTED_MAX_OUTBOUND_CHARS` | `4096` | Longer URLs and `browser_type` text are blocked in tainted conversations. |

### Voice (server TTS)

| Variable | Default | Purpose |
| --- | --- | --- |
| `TTS_ENABLED` | off | `1`/`true`/`yes` enables text-to-speech. |
| `TTS_ENGINE` | `piper` | Only `piper` is supported. |
| `TTS_VOICE` | `en_US-ryan-high` | Piper voice name (`<voice>.onnx`). |
| `TTS_SPEED` | `1.0` | Piper length scale. |
| `TTS_PIPER_BIN` | first found of `~/.local/share/piper-venv/bin/piper`, `/usr/local/bin/piper`, `/usr/bin/piper`, else `piper` on `PATH` | Path to the Piper binary. |
| `TTS_MODEL_DIR` | `~/.local/share/jarvis/piper` | Directory containing voice models. |

### Integrations

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | *(none)* | OAuth client for Gmail, Calendar, Drive and YouTube. All three are required. `.env.example` uses `http://localhost:3000/oauth/google/callback` as the redirect. |
| `GOOGLE_REFRESH_TOKEN_DAYS` | *(from Google)* | Override for refresh-token lifetime, used to remind you to reconnect (e.g. `7` for apps still in "Testing"). |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | *(none)* | SMTP server for `send_email`. All three are required. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | off | `1`/`true` for implicit TLS. |
| `SMTP_FROM` | `SMTP_USER` | Sender address. |
| `REDIS_URL` | `redis://${REDIS_HOST}:${REDIS_PORT}` | Optional Redis cache. |
| `REDIS_HOST`, `REDIS_PORT` | `127.0.0.1`, `6379` | Used when `REDIS_URL` is unset. |

### Process manager (`npm run start:managed`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PM_MAX_RESTARTS` | `5` | Restarts before giving up. |
| `PM_RESTART_DELAY` | `3000` | Delay between restarts (ms). |
| `PM_HANG_TIMEOUT` | `0` (off) | Restart if there is no output for this many ms. |
| `PM_WEBHOOK_URL` | *(none)* | Webhook (Discord-style JSON `content`) notified when the server exhausts its restarts. |

### End-to-end scripts

| Variable | Default | Purpose |
| --- | --- | --- |
| `JARVIS_API_KEY` | *(required)* | API key used by the `tool/e2e_*.js` scripts. |
| `JARVIS_WS_SCHEME` | `ws` | WebSocket scheme used by the `tool/e2e_*.js` scripts: `ws` or `wss` (for a server behind a TLS reverse proxy). |
| `JARVIS_WS_INSECURE_TLS` | `0` | Set to `1` to let the `tool/e2e_*.js` scripts accept a self-signed or otherwise untrusted certificate over `wss`. |

## ✅ Tests and checks

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

Backend tests use Node's built-in test runner through `tsx` (`src/backend/tests/*.test.ts`) and cover security, egress and provenance guards, the conversation queue, idempotency, wiring, and regressions. They don't need a model or network.

Or run the Flutter commands directly from `src/app`:

```bash
flutter analyze
flutter test
```

Manual end-to-end scripts against a running server. They connect over plain `ws://` by default; set `JARVIS_WS_SCHEME=wss` to reach a server behind TLS, and add `JARVIS_WS_INSECURE_TLS=1` only if its certificate is self-signed:

```bash
JARVIS_API_KEY=<key> node tool/e2e_ws.js 127.0.0.1:3000 "hello"
JARVIS_API_KEY=<key> node tool/e2e_tts.js 127.0.0.1:3000 "say something"
JARVIS_API_KEY=<key> node tool/e2e_device.js <host> <mode> <prompt>
JARVIS_API_KEY=<key> JARVIS_WS_SCHEME=wss node tool/e2e_ws.js jarvis.example.com "hello"
```

## 🛡️ Security notes

- Jarvis is designed for a trusted local network. Do not expose the server directly to the public internet without a reverse proxy, TLS, and an authentication review.
- Behind a reverse proxy, set `TRUST_PROXY=1`. Otherwise a proxy on the same host makes every request look local. Jarvis also refuses to treat a request as local when it carries `X-Forwarded-For`, `Forwarded` or `X-Real-IP` headers, so `/oauth/google/start` then always needs the one-time link from the app's "Connect Google" button.
- `.env` contains secrets. It is git-ignored; keep it that way and rotate any key that has ever been committed.
- The server binds to `0.0.0.0` by default so phones on the LAN can connect. Set `HOST=127.0.0.1` if you only use the desktop client.
- `fetch_url`, `http_request`, `check_port` and the headless browser block loopback, private, link-local, and other reserved addresses by default (redirects and browser subresources included). Set `JARVIS_FETCH_ALLOW_PRIVATE=1` only if you understand the SSRF risk. `ping_host` is exempt so you can check LAN devices; it still resolves the name first and never passes option-like hosts to `ping`.
- The Android client requests sensitive permissions (SMS, calls, contacts, location, accessibility) because device tools use them. Review the manifest and disable capabilities you do not need.
- Risky tools require approval (a request times out after 60 s). Keep `JARVIS_AUTO_APPROVE=0` unless you fully trust the model and the prompts it receives.
- The approval-free file tools (`read_file`, `list_dir`, `search_files`, `grep_files`) only read inside `JARVIS_FS_ROOTS`, and always refuse secrets: `.env` files, `~/.ssh`, `/etc/shadow`, `/etc/gshadow`, SSH host keys, TLS private keys, `.pem`/PEM key files, `JARVIS_DATA_DIR` and `/proc`.
- **Prompt-injection guardrails.** A conversation that has read external content (mail, web pages, search, Drive, browser, device screen or clipboard) is marked *tainted*. Scheduled tasks and subagents created from it are capped and run with only `JARVIS_TAINTED_RUN_TOOLS` (offline, read-only); memories it saves are stored as untrusted and shown to the model as quoted notes, not instructions. Outbound calls (`fetch_url`, `http_request`, `browser_open`, `device_open_url`, `browser_type`) are blocked only if they would send secret-looking values or data read from local files, git, the clipboard or memory (an approved call is only checked for secrets). Secret-looking strings are redacted from tool results. Every guarded action is logged as `Provenance guard: ...`.
- The headless browser keeps Chromium's sandbox on unless Jarvis runs as root or `JARVIS_BROWSER_NO_SANDBOX=1`.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## 🗂️ Project layout

```text
.
├── src/backend/            TypeScript server
│   ├── ai/                 orchestrator, model routing, conversation compaction
│   ├── agent/              memory, scheduler, calendar, Google, subagents, browser
│   ├── auth/               API keys
│   ├── managers/           logging and cache (Redis or in-memory)
│   ├── server/             Express (health, OAuth), CORS origins, WebSocket
│   ├── tools/              tool registry, approval/result brokers, implementations
│   ├── utils/              file, network, egress and provenance guards
│   ├── voice/              Piper TTS
│   ├── tests/              backend tests
│   ├── index.ts            server entry point (npm start / npm run dev)
│   └── ProcessManager.ts   supervisor (npm run start:managed)
├── src/app/                Flutter client
│   ├── lib/chat/           chat state
│   ├── lib/core/           app config and settings migration
│   ├── lib/protocol/       WebSocket protocol types
│   ├── lib/services/       WebSocket, voice, device tools, automation, background
│   ├── lib/ui/             screens and theme
│   ├── test/               Flutter tests
│   └── tool/               Dart end-to-end scripts
├── tool/                   end-to-end scripts
└── .github/                CI and community templates
```

## 🤝 Contributing

Jarvis is better with company. Whether it’s a bug report, a tool idea, a documentation fix, or a pull request, contributions are welcome.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## 📄 License

Jarvis is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE).

If you run a modified version of Jarvis as a network service, the AGPL requires you to make the corresponding source available to users of that service.

---

<div align="center">

**Created with ❤️ by [Santiago Morales](https://github.com/santiadjmc)**

If Jarvis is useful to you, consider giving it a ⭐

</div>
