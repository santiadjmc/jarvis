import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/status.dart' as ws_status;
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../protocol/jarvis_protocol.dart';
import '../../core/app_config.dart';
import '../device_tools/device_tool_executor.dart';

enum ConnectionStatus { disconnected, connecting, connected, retrying }

class ConnectionState {
  const ConnectionState({required this.status, this.errorMessage, this.latencyMs});

  final ConnectionStatus status;
  final String? errorMessage;
  final int? latencyMs;

  ConnectionState copyWith({ConnectionStatus? status, String? errorMessage, int? latencyMs, bool clearError = false}) {
    return ConnectionState(
      status: status ?? this.status,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      latencyMs: latencyMs ?? this.latencyMs,
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
        _messages.close();
      });
    });
    return const ConnectionState(status: ConnectionStatus.disconnected);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || _manualClose || _host == null || _apiKey == null) return;
    debugPrint('Jarvis reconnecting after app resume');
    _open();
  }

  Future<bool> connect(String host, String apiKey) async {
    _manualClose = false;
    _reconnectAttempt = 0;
    _host = host;
    _apiKey = apiKey;
    await ref.read(settingsControllerProvider.notifier).save(host: host, apiKey: apiKey);
    _connectResult?.complete(false);
    final completer = _connectResult = Completer<bool>();
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
    state = state.copyWith(status: ConnectionStatus.connecting, clearError: true);
    try {
      final uri = _webSocketUri(host, apiKey);
      debugPrint('Jarvis connecting to ${uri.replace(query: '').toString()}');
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      channel.ready.then(
        (_) {},
        onError: (Object e) {
          if (identical(_channel, channel)) {
            _failConnect('Could not reach server: $e');
          }
        },
      );
      _connectTimer?.cancel();
      _connectTimer = Timer(connectTimeout, () {
        if (_channel == null || state.status == ConnectionStatus.connected) return;
        _closeSocket(channel);
        _scheduleReconnect('Connection timed out${host.isEmpty ? '' : ' — is $host reachable?'}');
      });
      _pump(channel);
    } catch (e) {
      _failConnect('Could not reach server: $e');
    }
  }

  Uri _webSocketUri(String host, String apiKey) {
    var value = host.trim();
    if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*://').hasMatch(value)) {
      value = 'ws://$value';
    }
    final parsed = Uri.parse(value);
    final scheme = switch (parsed.scheme.toLowerCase()) {
      'https' || 'wss' => 'wss',
      _ => 'ws',
    };
    return parsed.replace(
      scheme: scheme,
      path: '/ws',
      queryParameters: {...parsed.queryParameters, 'key': apiKey},
    );
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

  void _pump(WebSocketChannel channel) {
    channel.stream.listen(
      (raw) {
        if (!identical(_channel, channel)) return;
        _reconnectAttempt = 0;
        _connectTimer?.cancel();
        if (state.status != ConnectionStatus.connected) {
          debugPrint('Jarvis WebSocket connected');
          state = state.copyWith(status: ConnectionStatus.connected, clearError: true);
          _startHeartbeat();
          _connectResult?.complete(true);
          _connectResult = null;
          _sendDeviceHello();
        }
        _resetInactivityCheck();
        try {
          _messages.add(ServerMessage.fromRaw(raw is String ? raw : utf8.decode(raw)));
        } on FormatException catch (e) {
          _messages.addError(e);
        }
      },
      onError: (Object e) {
        if (!identical(_channel, channel)) return;
        if (!_manualClose) {
          _failConnect('Connection error: $e');
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
    _send(JsonEncoder().convert(PingMessage(
      id: _uuid.v4(),
      timestamp: DateTime.now().millisecondsSinceEpoch,
    ).toJson()));
  }

  void sendCancel(String requestId) {
    _send(JsonEncoder().convert(CancelMessage(id: _uuid.v4(), requestId: requestId).toJson()));
  }

  void sendToolResponse(String requestId, String callId, {required String action}) {
    _send(JsonEncoder().convert(ToolResponseMessage(
      id: _uuid.v4(),
      requestId: requestId,
      callId: callId,
      action: action,
    ).toJson()));
  }

  Future<void> _sendDeviceHello() async {
    var cfg = ref.read(settingsControllerProvider);
    if (cfg.deviceId == null) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      cfg = ref.read(settingsControllerProvider);
    }
    final meta = await DeviceToolExecutor.instance.buildMeta(cfg);
    _send(JsonEncoder().convert(DeviceHelloMessage(
      id: _uuid.v4(),
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      deviceType: meta.deviceType,
      capabilities: meta.capabilities,
    ).toJson()));
  }

  void sendToolExecuteResult(String requestId, String callId, DeviceToolResult result) {
    _send(JsonEncoder().convert(ToolExecuteResultMessage(
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

  void _send(String payload) {
    final channel = _channel;
    if (channel == null || state.status != ConnectionStatus.connected) return;
    try {
      channel.sink.add(payload);
    } catch (_) {
      if (!_manualClose) {
        _closeSocket(channel);
        _scheduleReconnect('Connection lost while sending');
      }
    }
  }

  Future<void> disconnect() async {
    _manualClose = true;
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
