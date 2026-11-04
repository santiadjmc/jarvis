<div align="center">

# 🤖 Jarvis

**A local-first AI assistant that actually lives on your hardware.**

Chat, voice, tools, memory, and device control — all wired to the model you choose.

[![CI](https://github.com/santiadjmc/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/santiadjmc/jarvis/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Flutter 3.29+](https://img.shields.io/badge/Flutter-3.29%2B-02569B?logo=flutter&logoColor=white)](https://flutter.dev/)
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
| 🛡️ **You stay in control** | Risky tools ask for approval. Tool access is allowlistable. `fetch_url` blocks private networks by default. |

## 🚀 What it can do

- 🧠 **Bring your own brain** — point `AI_BASE_URL` at a local or hosted OpenAI-compatible endpoint.
- ⚡ **Fast + deep routing** — a resident fast model for everyday chat, a deeper model for reasoning-heavy work.
- 💬 **Streaming chat** — tool calling, cancellation, and automatic context compaction.
- 🎙️ **Voice in, voice out** — speech-to-text in the client and optional Piper text-to-speech on the server.
- 🛠️ **A real toolbox** — files, shell, code search, web search, HTTP, memory, scheduling, calendar, Git, Gmail, Google Calendar, Drive, YouTube, and a headless browser.
- 📱 **Device superpowers** — SMS, calls, contacts, location, notifications, clipboard, app launching, and accessibility actions, gated by capability.
- 🧰 **Memory & routines** — a local facts store with embedding recall, plus one-off and recurring tasks.
- 🎨 **HUD-style client** — chat, settings, setup, and voice in a focused interface.

## 🏗️ Architecture

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

**The loop:**

1. The client sends a message over WebSocket.
2. The server routes it to the fast or deep model.
3. The model calls tools; the server executes them or asks you to approve.
4. Results stream back, and long conversations compact themselves.

- `src/backend` — server, agent loop, tools, memory, scheduling, voice, and tests.
- `src/app` — the Flutter client.
- `tool` — standalone end-to-end scripts for WebSocket, TTS, and device flows.

## 🧰 The toolbox

| Area | Tools |
| --- | --- |
| 🌐 **Web** | `web_search`, `fetch_url`, `http_request`, `get_weather`, `convert_currency` |
| 📂 **Files & code** | `read_file`, `write_file`, `append_file`, `list_dir`, `search_files`, `grep_files`, `run_command`, `git_status`, `git_diff`, `git_log`, `git_commit` |
| 🧠 **Memory & time** | `remember`, `recall`, `forget`, `list_memories`, `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`, `create_event`, `list_events`, `delete_event` |
| 📬 **Communication** | `send_email`, `gmail_list_messages`, `gmail_read_message`, `gmail_send`, `google_calendar_*`, `google_drive_*`, `youtube_*` |
| 🖥️ **Browser** | `browser_open`, `browser_click`, `browser_type`, `browser_extract_text`, `browser_screenshot`, `browser_close` |
| 📱 **Device** | `device_get_battery`, `device_get_location`, `device_send_sms`, `device_call_number`, `device_launch_app`, `device_show_notification`, and more |
| ⚙️ **System** | `get_system_info`, `get_time`, `list_processes`, `kill_process`, `ping_host`, `check_port` |

Enable or restrict tools with `JARVIS_TOOLS` and `JARVIS_DEVICE_TOOLS`.

## ⚡ Quick start

You need **Node.js 20+**, **Flutter 3.29+**, and a model endpoint. [Ollama](https://ollama.com/) is the path of least resistance.

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
JWT_SECRET=<long random string>
JARVIS_MASTER_KEY=<long random admin key>
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_API_KEY=ollama
AI_MODEL=llama3.2
```

Start it:

```bash
npm run dev
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

In the app, enter the server address shown in the server log (for example `http://192.168.1.20:3000`) and the API key. On Android, the client can connect over the LAN; the manifest allows cleartext HTTP for local-network use.

### 3. Say hello

Open the chat and ask it something. Then try something useful: “What’s in my Downloads folder?”, “Remind me at 6pm to call Alex”, or “Summarize the top story on Hacker News.”

The server authenticates clients with API keys. Set `JARVIS_MASTER_KEY` in `.env` to bootstrap an admin key, or follow the auth flow in `src/backend/auth` for additional keys. Never commit your real `.env`.

## 🔧 Configuration

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

Or run the Flutter commands directly from `src/app`:

```bash
flutter analyze
flutter test
```

## 🛡️ Security notes

- Jarvis is designed for a trusted local network. Do not expose the server directly to the public internet without a reverse proxy, TLS, and an authentication review.
- `.env` contains secrets. It is git-ignored; keep it that way and rotate any key that has ever been committed.
- The server binds to `0.0.0.0` by default so phones on the LAN can connect. Set `HOST=127.0.0.1` if you only use the desktop client.
- `fetch_url` blocks loopback, private, link-local, and other reserved addresses by default. Set `JARVIS_FETCH_ALLOW_PRIVATE=1` only if you understand the SSRF risk.
- The Android client requests sensitive permissions (SMS, calls, contacts, location, accessibility) because device tools use them. Review the manifest and disable capabilities you do not need.
- Risky tools require approval. Keep `JARVIS_AUTO_APPROVE=0` unless you fully trust the model and the prompts it receives.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## 🗂️ Project layout

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
