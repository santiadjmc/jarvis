# Jarvis Flutter client

The Flutter client for [Jarvis](../../README.md), a local-first AI assistant. It provides chat, voice input, settings, setup, and the device-side tools that the server can invoke.

## Run

```bash
flutter pub get
flutter run
```

The app needs a running Jarvis server. On first launch, enter the server address printed by the server (for example `http://192.168.1.20:3000`) and the API key.

For Linux desktop, install the usual Flutter Linux toolchain and the runtime libraries required by the audio and media plugins. For Android, use an Android SDK supported by the current Flutter stable channel.

## Checks

```bash
flutter analyze
flutter test
```

## Structure

- `lib/chat` — chat state and protocol handling.
- `lib/core` — shared configuration and utilities.
- `lib/protocol` — WebSocket message types.
- `lib/services` — WebSocket, voice, device tools, automation, and background services.
- `lib/ui` — screens and the HUD theme.

## License

AGPL-3.0-only. See the repository [LICENSE](../../LICENSE).
