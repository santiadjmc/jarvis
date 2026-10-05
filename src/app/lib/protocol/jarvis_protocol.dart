import 'dart:convert';

enum TokenKind { assistant, thinking }

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.content,
    this.sessionId,
    this.model,
    this.systemPrompt,
    this.stream = true,
    this.voice = false,
    required this.timestamp,
  });

  final String id;
  final String content;
  final String? sessionId;
  final String? model;
  final String? systemPrompt;
  final bool stream;
  final bool voice;
  final int timestamp;

  Map<String, dynamic> toJson() => {
        'type': 'chat',
        'id': id,
        'content': content,
        if (sessionId != null) 'sessionId': sessionId,
        if (model != null) 'model': model,
        if (systemPrompt != null) 'systemPrompt': systemPrompt,
        'stream': stream,
        'voice': voice,
        'timestamp': timestamp,
      };
}

class PingMessage {
  const PingMessage({required this.id, required this.timestamp});

  final String id;
  final int timestamp;

  Map<String, dynamic> toJson() => {'type': 'ping', 'id': id, 'timestamp': timestamp};
}

class CancelMessage {
  const CancelMessage({required this.id, required this.requestId});

  final String id;
  final String requestId;

  Map<String, dynamic> toJson() => {'type': 'cancel', 'id': id, 'requestId': requestId};
}

class ToolResponseMessage {
  const ToolResponseMessage({
    required this.id,
    required this.requestId,
    required this.callId,
    required this.action,
  });

  final String id;
  final String requestId;
  final String callId;
  final String action;

  Map<String, dynamic> toJson() => {
        'type': 'tool_response',
        'id': id,
        'requestId': requestId,
        'callId': callId,
        'action': action,
      };
}

class DeviceHelloMessage {
  const DeviceHelloMessage({
    required this.id,
    required this.deviceId,
    this.deviceName,
    this.deviceType,
    this.capabilities = const [],
  });

  final String id;
  final String deviceId;
  final String? deviceName;
  final String? deviceType;
  final List<String> capabilities;

  Map<String, dynamic> toJson() => {
        'type': 'device_hello',
        'id': id,
        'deviceId': deviceId,
        if (deviceName != null) 'deviceName': deviceName,
        if (deviceType != null) 'deviceType': deviceType,
        'capabilities': capabilities,
      };
}

class ToolExecuteResultMessage {
  const ToolExecuteResultMessage({
    required this.id,
    required this.requestId,
    required this.callId,
    required this.success,
    this.data,
    this.error,
    this.executionTimeMs,
  });

  final String id;
  final String requestId;
  final String callId;
  final bool success;
  final Object? data;
  final String? error;
  final int? executionTimeMs;

  Map<String, dynamic> toJson() => {
        'type': 'tool_execute_result',
        'id': id,
        'requestId': requestId,
        'callId': callId,
        'success': success,
        if (data != null) 'data': data,
        if (error != null) 'error': error,
        if (executionTimeMs != null) 'executionTimeMs': executionTimeMs,
      };
}

class SpeakMessage {
  const SpeakMessage({required this.id, required this.text, this.timestamp});

  final String id;
  final String text;
  final int? timestamp;

  Map<String, dynamic> toJson() => {
        'type': 'speak',
        'id': id,
        'text': text,
        if (timestamp != null) 'timestamp': timestamp,
      };
}

class ConfigGetMessage {
  const ConfigGetMessage({required this.id, required this.key});

  final String id;
  final String key;

  Map<String, dynamic> toJson() => {'type': 'config', 'id': id, 'action': 'get', 'key': key};
}

class TokenMessage extends ServerMessage {
  const TokenMessage({
    required this.id,
    required this.content,
    required this.requestId,
    required this.kind,
    this.proactive = false,
  });

  final String id;
  final String content;
  final String requestId;
  final TokenKind kind;
  final bool proactive;

  factory TokenMessage.fromJson(Map<String, dynamic> json) {
    final kind = switch (json['kind'] as String?) {
      'thinking' => TokenKind.thinking,
      _ => TokenKind.assistant,
    };
    return TokenMessage(
      id: json['id'] as String,
      content: json['content'] as String,
      requestId: json['requestId'] as String,
      kind: kind,
      proactive: json['proactive'] as bool? ?? false,
    );
  }
}

class StreamEndMessage extends ServerMessage {
  const StreamEndMessage({
    required this.id,
    required this.requestId,
    required this.fullResponse,
    required this.model,
    this.proactive = false,
  });

  final String id;
  final String requestId;
  final String fullResponse;
  final String model;
  final bool proactive;

  factory StreamEndMessage.fromJson(Map<String, dynamic> json) => StreamEndMessage(
        id: json['id'] as String,
        requestId: json['requestId'] as String,
        fullResponse: json['fullResponse'] as String,
        model: json['model'] as String,
        proactive: json['proactive'] as bool? ?? false,
      );
}

enum ChatStatus { thinking, toolCalling, searching, generating, reasoning, idle }

class StatusMessage extends ServerMessage {
  const StatusMessage({required this.id, required this.status, this.requestId, this.detail});

  final String id;
  final ChatStatus status;
  final String? requestId;
  final String? detail;

  factory StatusMessage.fromJson(Map<String, dynamic> json) => StatusMessage(
        id: json['id'] as String,
        status: _statusFromString(json['status'] as String),
        requestId: json['requestId'] as String?,
        detail: json['detail'] as String?,
      );

  static ChatStatus _statusFromString(String s) => switch (s) {
        'tool_calling' => ChatStatus.toolCalling,
        'searching' => ChatStatus.searching,
        'generating' => ChatStatus.generating,
        'reasoning' => ChatStatus.reasoning,
        'idle' => ChatStatus.idle,
        _ => ChatStatus.thinking,
      };
}

class ToolCallMessage extends ServerMessage {
  const ToolCallMessage({
    required this.id,
    required this.requestId,
    required this.tool,
    required this.callId,
    required this.params,
    required this.approvalRequired,
    this.executor,
  });

  final String id;
  final String requestId;
  final String tool;
  final String callId;
  final Map<String, dynamic> params;
  final bool approvalRequired;
  final String? executor;

  bool get isDevice => executor == 'device';

  factory ToolCallMessage.fromJson(Map<String, dynamic> json) => ToolCallMessage(
        id: json['id'] as String,
        requestId: json['requestId'] as String,
        tool: json['tool'] as String,
        callId: json['callId'] as String,
        params: (json['params'] as Map<String, dynamic>? ?? const {}),
        approvalRequired: json['approvalRequired'] as bool? ?? false,
        executor: json['executor'] as String?,
      );
}

class ToolResultMessage extends ServerMessage {
  const ToolResultMessage({
    required this.id,
    required this.requestId,
    required this.tool,
    required this.callId,
    required this.success,
    this.data,
    this.error,
  });

  final String id;
  final String requestId;
  final String tool;
  final String callId;
  final bool success;
  final Object? data;
  final String? error;

  factory ToolResultMessage.fromJson(Map<String, dynamic> json) => ToolResultMessage(
        id: json['id'] as String,
        requestId: json['requestId'] as String,
        tool: json['tool'] as String,
        callId: json['callId'] as String,
        success: json['success'] as bool? ?? false,
        data: json['data'],
        error: json['error'] as String?,
      );
}

class VoiceResponseMessage extends ServerMessage {
  const VoiceResponseMessage({
    required this.id,
    required this.requestId,
    required this.seq,
    required this.isFinal,
    this.audio,
    this.format,
    this.sampleRate,
  });

  final String id;
  final String requestId;
  final int seq;
  final bool isFinal;
  final String? audio;
  final String? format;
  final int? sampleRate;

  factory VoiceResponseMessage.fromJson(Map<String, dynamic> json) => VoiceResponseMessage(
        id: json['id'] as String,
        requestId: json['requestId'] as String,
        seq: json['seq'] as int? ?? 1,
        isFinal: json['final'] as bool? ?? true,
        audio: json['audio'] as String?,
        format: json['format'] as String?,
        sampleRate: json['sampleRate'] as int?,
      );
}

class JarvisError extends ServerMessage {
  const JarvisError({required this.id, required this.code, required this.message, this.requestId});

  final String id;
  final String code;
  final String message;
  final String? requestId;

  factory JarvisError.fromJson(Map<String, dynamic> json) => JarvisError(
        id: json['id'] as String,
        code: json['code'] as String,
        message: json['message'] as String,
        requestId: json['requestId'] as String?,
      );
}

class PongMessage extends ServerMessage {
  const PongMessage({required this.id, required this.timestamp, required this.serverTime});

  final String id;
  final int timestamp;
  final int serverTime;

  factory PongMessage.fromJson(Map<String, dynamic> json) => PongMessage(
        id: json['id'] as String,
        timestamp: json['timestamp'] as int,
        serverTime: json['serverTime'] as int,
      );
}

class ConfigResponseMessage extends ServerMessage {
  const ConfigResponseMessage({required this.id, required this.key, required this.value});

  final String id;
  final String key;
  final Object? value;

  factory ConfigResponseMessage.fromJson(Map<String, dynamic> json) => ConfigResponseMessage(
        id: json['id'] as String,
        key: json['key'] as String,
        value: json['value'],
      );
}

class ConnectedMessage extends ServerMessage {
  const ConnectedMessage({required this.clientId, required this.serverTime, this.deviceId});

  factory ConnectedMessage.fromJson(Map<String, dynamic> json) => ConnectedMessage(
        clientId: json['clientId'] as String,
        serverTime: json['serverTime'] as int,
        deviceId: json['deviceId'] as String?,
      );

  final String clientId;
  final int serverTime;
  final String? deviceId;
}

sealed class ServerMessage {
  const ServerMessage();

  static ServerMessage fromRaw(String raw) {
    final dynamic decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      throw const FormatException('Invalid server JSON frame');
    }
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Server frame is not a JSON object');
    }
    return fromJson(decoded);
  }

  static ServerMessage fromJson(Map<String, dynamic> json) {
    return switch (json['type']) {
      'token' => TokenMessage.fromJson(json),
      'stream_end' => StreamEndMessage.fromJson(json),
      'status' => StatusMessage.fromJson(json),
      'tool_call' => ToolCallMessage.fromJson(json),
      'tool_result' => ToolResultMessage.fromJson(json),
      'voice' => VoiceResponseMessage.fromJson(json),
      'error' => JarvisError.fromJson(json),
      'pong' => PongMessage.fromJson(json),
      'config_response' => ConfigResponseMessage.fromJson(json),
      'connected' => ConnectedMessage.fromJson(json),
      _ => throw FormatException('Unknown server message type: ${json['type']}'),
    };
  }
}