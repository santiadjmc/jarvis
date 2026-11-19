import 'dart:async';
import 'dart:convert';
import 'dart:io' show TlsException;

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/status.dart' as ws_status;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../protocol/jarvis_protocol.dart';
import '../../core/app_config.dart';
import '../background/background_connection_service.dart';
import '../device_tools/device_tool_executor.dart';

enum ConnectionStatus { disconnected, connecting, connected, retrying }

/// Thrown when the configured address would use plain `ws://` but the user has
/// not enabled the "insecure LAN" opt-in.
class InsecureTransportException implements Exception {
  const InsecureTransportException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ConnectionState {
  const ConnectionState({required this.status, this.errorMessage, this.latencyMs, this.hasConnectedOnce = false});

  final ConnectionStatus status;
  final String? errorMessage;
  final int? latencyMs;
  final bool hasConnectedOnce;

  ConnectionState copyWith({
    ConnectionStatus? status,
    String? errorMessage,
    int? latencyMs,
    bool? hasConnectedOnce,
    bool clearError = false,
  }) {
    return ConnectionState(
      status: status ?? this.status,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      latencyMs: latencyMs ?? this.latencyMs,
      hasConnectedOnce: hasConnectedOnce ?? this.hasConnectedOnce,
    );
  }
}

class ConnectionController extends Notifier<ConnectionState> with WidgetsBindingObserver {
  static const heartbeatInterval = Duration(seconds: 25);
  static const inactivityTimeout = Duration(seconds: 40);
  static const connectTimeout = Duration(seconds: 15);

  WebSocketChannel? _channel;
  final StreamController<ServerMessage> _messages = StreamController<ServerMessage>.broadcast();
  Timer? _heartbeat;
  Timer? _reconnectTimer;
  Timer? _connectTimer;
  Timer? _inactivityTimer;
  Completer<bool>? _connectResult;
  int _reconnectAttempt = 0;
  bool _manualClose = false;
  String? _host;
  String? _apiKey;
  DateTime? _lastPingSentAt;

  /// Tool results / approvals that could not be sent (socket down or
  /// reconnecting), keyed by frame type + callId so each call is sent once.
  /// Flushed after the next device_hello.
  final Map<String, String> _outbox = {};
  static const _outboxLimit = 100;
  bool _helloSent = false;
  final _uuid = const Uuid();

  Stream<ServerMessage> get messages => _messages.stream;

  @override
  ConnectionState build() {
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() {
      scheduleMicrotask(() {
        WidgetsBinding.instance.removeObserver(this);
        _heartbeat?.cancel();
        _reconnectTimer?.cancel();
        _connectTimer?.cancel();
        _inactivityTimer?.cancel();
        _manualClose = true;
        _closeSocket();
        _messages.close();
      });
    });
    return const ConnectionState(status: ConnectionStatus.disconnected);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycleState) {
    if (_manualClose || _host == null || _apiKey == null) return;
    if (lifecycleState == AppLifecycleState.paused || lifecycleState == AppLifecycleState.hidden) {
      _inactivityTimer?.cancel();
      return;
    }
    if (lifecycleState != AppLifecycleState.resumed) return;
    if (state.status == ConnectionStatus.connected) {
      _resetInactivityCheck();
      sendPing();
      return;
    }
    if (state.status == ConnectionStatus.connecting) return;
    debugPrint('Jarvis reconnecting after app resume');
    _open();
  }

  Future<bool> connect(String host, String apiKey) async {
    if (state.status == ConnectionStatus.connecting &&
        _connectResult != null &&
        _host == host &&
        _apiKey == apiKey) {
      return _connectResult!.future;
    }
    _manualClose = false;
    _reconnectAttempt = 0;
    if (_host != host || _apiKey != apiKey) _outbox.clear();
    _host = host;
    _apiKey = apiKey;
    await ref.read(settingsControllerProvider.notifier).save(host: host, apiKey: apiKey);
    _connectResult?.complete(false);
    final completer = _connectResult = Completer<bool>();
    state = state.copyWith(hasConnectedOnce: false);
    _open();
    return completer.future;
  }

  void _open() {
    final host = _host;
    final apiKey = _apiKey;
    if (host == null || apiKey == null) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _connectTimer?.cancel();
    _heartbeat?.cancel();
    _heartbeat = null;
    _closeSocket();
    _helloSent = false;
    final Uri uri;
    try {
      uri = _webSocketUri(host, allowInsecure: ref.read(settingsControllerProvider).allowInsecureWs);
    } on InsecureTransportException catch (e) {
      _stopWithError(e.message);
      return;
    } catch (e) {
      _failConnect('Could not reach server: $e');
      return;
    }
    state = state.copyWith(status: ConnectionStatus.connecting, clearError: true);
    try {
      debugPrint('Jarvis connecting to $uri');
      // The key travels in the Authorization header, never in the URL.
      final channel = IOWebSocketChannel.connect(uri, headers: {'Authorization': 'Bearer $apiKey'});
      _channel = channel;
      channel.ready.then(
        (_) {},
        onError: (Object e) {
          if (!identical(_channel, channel)) return;
          _onSocketError(uri, e, 'Could not reach server');
        },
      );
      _connectTimer?.cancel();
      _connectTimer = Timer(connectTimeout, () {
        if (_channel == null || state.status == ConnectionStatus.connected) return;
        _closeSocket(channel);
        _scheduleReconnect('Connection timed out${host.isEmpty ? '' : ' — is $host reachable?'}');
      });
      _pump(channel, uri);
    } catch (e) {
      _failConnect('Could not reach server: $e');
    }
  }

  /// Builds the socket URI. Defaults to `wss://`; plain `ws://` is only used
  /// when [allowInsecure] (the "insecure LAN" setting) is on.
  static Uri _webSocketUri(String host, {required bool allowInsecure}) {
    var value = host.trim();
    if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*://').hasMatch(value)) {
      value = '${allowInsecure ? 'ws' : 'wss'}://$value';
    }
    final parsed = Uri.parse(value);
    final scheme = switch (parsed.scheme.toLowerCase()) {
      'https' || 'wss' => 'wss',
      'http' || 'ws' => 'ws',
      final other => throw InsecureTransportException('Unsupported server scheme "$other://". Use wss:// or https://.'),
    };
    if (scheme == 'ws' && !allowInsecure) {
      throw const InsecureTransportException(
        'Refusing to connect over unencrypted ws://. Use a wss:// address, or enable '
        '"Insecure LAN (ws://)" in settings if this server is on a trusted local network.',
      );
    }
    // Keep any reverse-proxy sub-path (https://host/jarvis -> wss://host/jarvis/ws).
    var basePath = parsed.path;
    while (basePath.endsWith('/')) {
      basePath = basePath.substring(0, basePath.length - 1);
    }
    return parsed.replace(scheme: scheme, path: basePath.endsWith('/ws') ? basePath : '$basePath/ws');
  }

  static const noTlsMessage =
      "The server doesn't seem to use TLS. Turn on Insecure LAN (ws://) in settings or set up TLS.";

  /// True when [error] from opening a `wss://` socket means the server isn't
  /// speaking TLS at all (e.g. the stock backend serving plain HTTP), as
  /// opposed to a transient network failure worth retrying.
  static bool looksLikeTlsMismatch(Object error) {
    Object? e = error;
    if (e is WebSocketChannelException && e.inner != null) e = e.inner;
    if (e is TlsException) return true; // includes HandshakeException
    final text = error.toString();
    return text.contains('HandshakeException') ||
        text.contains('TlsException') ||
        text.contains('WRONG_VERSION_NUMBER') ||
        text.contains('wrong version number') ||
        text.contains('record overflow');
  }

  void _onSocketError(Uri uri, Object error, String prefix) {
    // Only before the first successful connect: a TLS hiccup on an
    // established wss setup is a network problem worth retrying.
    if (uri.scheme == 'wss' && !state.hasConnectedOnce && looksLikeTlsMismatch(error)) {
      _stopWithError(noTlsMessage);
      return;
    }
    _failConnect('$prefix: $error');
  }

  /// A configuration problem, not a network one: report it and don't retry.
  void _stopWithError(String message) {
    _closeSocket();
    _connectTimer?.cancel();
    _inactivityTimer?.cancel();
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _connectResult?.complete(false);
    _connectResult = null;
    state = state.copyWith(status: ConnectionStatus.disconnected, errorMessage: message);
  }

  void _failConnect(String message) {
    _closeSocket();
    _connectTimer?.cancel();
    _inactivityTimer?.cancel();
    _connectResult?.complete(false);
    _connectResult = null;
    if (!_manualClose) {
      state = state.copyWith(status: ConnectionStatus.retrying, errorMessage: message);
      _scheduleReconnect();
    }
  }

  void _closeSocket([WebSocketChannel? expected]) {
    final channel = expected ?? _channel;
    if (channel == null) return;
    if (expected != null && !identical(_channel, expected)) return;
    _channel = null;
    try {
      channel.sink.close();
    } catch (_) {}
  }

  void _pump(WebSocketChannel channel, Uri uri) {
    channel.stream.listen(
      (raw) {
        if (!identical(_channel, channel)) return;
        _reconnectAttempt = 0;
        _connectTimer?.cancel();
        if (state.status != ConnectionStatus.connected) {
          debugPrint('Jarvis WebSocket connected');
          state = state.copyWith(status: ConnectionStatus.connected, clearError: true, hasConnectedOnce: true);
          _startHeartbeat();
          _connectResult?.complete(true);
          _connectResult = null;
          _sendDeviceHello();
          unawaited(_keepAliveInBackground());
        }
        _resetInactivityCheck();
        try {
          final parsed = ServerMessage.fromRaw(raw is String ? raw : utf8.decode(raw));
          if (parsed is PongMessage) {
            final sentAt = _lastPingSentAt;
            if (sentAt != null) {
              state = state.copyWith(latencyMs: DateTime.now().difference(sentAt).inMilliseconds);
            }
          }
          _messages.add(parsed);
        } on FormatException catch (e) {
          _messages.addError(e);
        }
      },
      onError: (Object e) {
        if (!identical(_channel, channel)) return;
        if (!_manualClose) {
          _onSocketError(uri, e, 'Connection error');
        }
      },
      onDone: () {
        if (!identical(_channel, channel)) return;
        if (!_manualClose) {
          _closeSocket(channel);
          _scheduleReconnect('Connection closed by server');
        } else {
          state = state.copyWith(status: ConnectionStatus.disconnected);
        }
      },
      cancelOnError: false,
    );
  }

  void _resetInactivityCheck() {
    _inactivityTimer?.cancel();
    _inactivityTimer = Timer(inactivityTimeout, () {
      if (_manualClose || state.status != ConnectionStatus.connected) return;
      _closeSocket();
      _scheduleReconnect('No response from server');
    });
  }

  void _scheduleReconnect([String? reason]) {
    _heartbeat?.cancel();
    _heartbeat = null;
    _inactivityTimer?.cancel();
    _connectResult?.complete(false);
    _connectResult = null;
    if (_manualClose) return;
    debugPrint('Jarvis reconnect scheduled: ${reason ?? 'connection lost'}');
    state = state.copyWith(status: ConnectionStatus.retrying, errorMessage: reason);
    final delay = Duration(seconds: 2 * (_reconnectAttempt + 1) > 30 ? 30 : 2 * (_reconnectAttempt + 1));
    _reconnectAttempt++;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, _open);
  }

  Future<void> _keepAliveInBackground() async {
    await BackgroundConnectionService.requestPermissions();
    await BackgroundConnectionService.start(text: 'Connected to ${_host ?? 'Jarvis'}');
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(heartbeatInterval, (_) => sendPing());
  }

  bool sendChat({
    required String id,
    required String content,
    String? sessionId,
    String? model,
    bool stream = true,
    bool voice = false,
  }) {
    if (_channel == null || state.status != ConnectionStatus.connected) return false;
    _send(JsonEncoder().convert(ChatMessage(
      id: id,
      content: content,
      sessionId: sessionId,
      model: model,
      stream: stream,
      voice: voice,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    ).toJson()));
    return true;
  }

  void sendSpeak({required String text, String? requestId}) {
    _send(JsonEncoder().convert(SpeakMessage(
      id: requestId ?? _uuid.v4(),
      text: text,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    ).toJson()));
  }

  void sendPing() {
    _lastPingSentAt = DateTime.now();
    _send(JsonEncoder().convert(PingMessage(
      id: _uuid.v4(),
      timestamp: DateTime.now().millisecondsSinceEpoch,
    ).toJson()));
  }

  void sendCancel(String requestId) {
    _send(JsonEncoder().convert(CancelMessage(id: _uuid.v4(), requestId: requestId).toJson()));
  }

  void sendToolResponse(String requestId, String callId, {required String action}) {
    _sendOrQueue('tool_response:$callId', JsonEncoder().convert(ToolResponseMessage(
      id: _uuid.v4(),
      requestId: requestId,
      callId: callId,
      action: action,
    ).toJson()));
  }

  Future<void> _sendDeviceHello() async {
    // Wait for persisted settings so the stored device id is used, not a
    // random one generated before prefs were read.
    await ref.read(settingsControllerProvider.notifier).loaded.timeout(const Duration(seconds: 5), onTimeout: () {});
    final cfg = ref.read(settingsControllerProvider);
    final meta = await DeviceToolExecutor.instance.buildMeta(cfg);
    final sent = _send(JsonEncoder().convert(DeviceHelloMessage(
      id: _uuid.v4(),
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      deviceType: meta.deviceType,
      capabilities: meta.capabilities,
    ).toJson()));
    if (sent) {
      _helloSent = true;
      _flushOutbox();
    }
  }

  void sendToolExecuteResult(String requestId, String callId, DeviceToolResult result) {
    _sendOrQueue('tool_execute_result:$callId', JsonEncoder().convert(ToolExecuteResultMessage(
      id: _uuid.v4(),
      requestId: requestId,
      callId: callId,
      success: result.success,
      data: result.data,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    ).toJson()));
  }

  void sendConfigGet(String key) {
    _send(JsonEncoder().convert(ConfigGetMessage(id: _uuid.v4(), key: key).toJson()));
  }

  void sendConfigSet(String key, Object? value) {
    _send(JsonEncoder().convert(ConfigSetMessage(id: _uuid.v4(), key: key, value: value).toJson()));
  }

  /// Sends [payload]; returns false if the socket was not usable.
  bool _send(String payload) {
    final channel = _channel;
    if (channel == null || state.status != ConnectionStatus.connected) return false;
    try {
      channel.sink.add(payload);
      return true;
    } catch (_) {
      if (!_manualClose) {
        _closeSocket(channel);
        _scheduleReconnect('Connection lost while sending');
      }
      return false;
    }
  }

  /// Sends a frame that must not be lost (tool results, approvals). If the
  /// socket is down it is queued once per [key] and sent after reconnecting.
  void _sendOrQueue(String key, String payload) {
    if (_outbox.isEmpty && _helloSent && _send(payload)) return;
    if (_outbox.containsKey(key)) return;
    if (_outbox.length >= _outboxLimit) _outbox.remove(_outbox.keys.first);
    _outbox[key] = payload;
    _flushOutbox();
  }

  void _flushOutbox() {
    if (!_helloSent || state.status != ConnectionStatus.connected) return;
    for (final key in _outbox.keys.toList()) {
      final payload = _outbox[key];
      if (payload == null) continue;
      if (!_send(payload)) return;
      _outbox.remove(key);
    }
  }

  Future<void> disconnect() async {
    _manualClose = true;
    unawaited(BackgroundConnectionService.stop());
    _heartbeat?.cancel();
    _heartbeat = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _connectTimer?.cancel();
    _inactivityTimer?.cancel();
    _connectResult?.complete(false);
    _connectResult = null;
    final channel = _channel;
    _channel = null;
    if (channel != null) {
      try {
        await channel.sink.close(ws_status.normalClosure);
      } catch (_) {}
    }
    state = state.copyWith(status: ConnectionStatus.disconnected);
  }
}

final connectionControllerProvider =
    NotifierProvider<ConnectionController, ConnectionState>(ConnectionController.new);
