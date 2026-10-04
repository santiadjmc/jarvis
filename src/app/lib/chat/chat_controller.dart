import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../protocol/jarvis_protocol.dart';
import '../services/ws/connection_controller.dart';
import '../services/device_tools/device_tool_executor.dart';
import '../services/voice/tts_controller.dart';
import '../core/app_config.dart';

enum MessageRole { user, assistant, error }

enum ToolStepStatus { running, awaitingApproval, done, denied, failed }

class ToolStep {
  const ToolStep({
    required this.callId,
    required this.name,
    required this.params,
    this.requiresApproval = false,
    this.status = ToolStepStatus.running,
    this.error,
    this.result,
    this.executor,
  });

  final String callId;
  final String name;
  final Map<String, dynamic> params;
  final bool requiresApproval;
  final ToolStepStatus status;
  final String? error;
  final String? result;
  final String? executor;

  bool get isDeviceTool => executor == 'device';

  ToolStep copyWith({
    ToolStepStatus? status,
    String? error,
    String? result,
  }) {
    return ToolStep(
      callId: callId,
      name: name,
      params: params,
      requiresApproval: requiresApproval,
      status: status ?? this.status,
      error: error ?? this.error,
      result: result ?? this.result,
      executor: executor,
    );
  }

  Map<String, dynamic> toJson() => {
        'callId': callId,
        'name': name,
        'params': params,
        'requiresApproval': requiresApproval,
        'status': status.name,
        if (error != null) 'error': error,
        if (result != null) 'result': result,
        if (executor != null) 'executor': executor,
      };

  factory ToolStep.fromJson(Map<String, dynamic> json) => ToolStep(
        callId: json['callId'] as String,
        name: json['name'] as String,
        params: (json['params'] as Map<String, dynamic>? ?? const {}),
        requiresApproval: json['requiresApproval'] as bool? ?? false,
        status: ToolStepStatus.values.firstWhere(
          (s) => s.name == json['status'],
          orElse: () => ToolStepStatus.done,
        ),
        error: json['error'] as String?,
        result: json['result'] as String?,
        executor: json['executor'] as String?,
      );
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    this.content = '',
    this.thinking = '',
    this.complete = false,
    this.model,
    this.status,
    this.errorMessage,
    this.tools = const [],
  });

  final String id;
  final MessageRole role;
  final String content;
  final String thinking;
  final bool complete;
  final String? model;
  final ChatStatus? status;
  final String? errorMessage;
  final List<ToolStep> tools;

  ChatMessage copyWith({
    String? content,
    String? thinking,
    bool? complete,
    String? model,
    ChatStatus? status,
    String? errorMessage,
    List<ToolStep>? tools,
    bool clearStatus = false,
  }) {
    return ChatMessage(
      id: id,
      role: role,
      content: content ?? this.content,
      thinking: thinking ?? this.thinking,
      complete: complete ?? this.complete,
      model: model ?? this.model,
      status: clearStatus ? null : (status ?? this.status),
      errorMessage: errorMessage ?? this.errorMessage,
      tools: tools ?? this.tools,
    );
  }

  ChatMessage asCompleteWith(String finalContent, {String? finalModel}) {
    return copyWith(
      content: finalContent,
      thinking: thinking,
      complete: true,
      model: finalModel ?? model,
      clearStatus: true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'content': content,
        'thinking': thinking,
        'complete': complete,
        if (model != null) 'model': model,
        if (status != null) 'status': status!.name,
        if (errorMessage != null) 'errorMessage': errorMessage,
        'tools': tools.map((t) => t.toJson()).toList(),
      };

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        role: MessageRole.values.firstWhere((r) => r.name == json['role']),
        content: json['content'] as String? ?? '',
        thinking: json['thinking'] as String? ?? '',
        complete: json['complete'] as bool? ?? true,
        model: json['model'] as String?,
        status: json['status'] is String
            ? ChatStatus.values.firstWhere((s) => s.name == json['status'])
            : null,
        errorMessage: json['errorMessage'] as String?,
        tools: (json['tools'] as List<dynamic>? ?? [])
            .map((t) => ToolStep.fromJson(t as Map<String, dynamic>))
            .toList(),
      );
}

class ChatState {
  const ChatState({this.messages = const [], this.sessionId, this.online = false, this.pendingError});

  final List<ChatMessage> messages;
  final String? sessionId;
  final bool online;
  final String? pendingError;

  ChatState copyWith({List<ChatMessage>? messages, String? sessionId, bool? online, String? pendingError, bool clearError = false}) {
    return ChatState(
      messages: messages ?? this.messages,
      sessionId: sessionId ?? this.sessionId,
      online: online ?? this.online,
      pendingError: clearError ? null : (pendingError ?? this.pendingError),
    );
  }
}

class ChatController extends Notifier<ChatState> {
  final _uuid = const Uuid();
  String? _activeRequestId;
  String? _sessionId;
  bool _subscribed = false;
  bool _loadStarted = false;
  Timer? _persistTimer;
  File? _storeFile;
  List<ChatMessage> _messages = [];
  final Map<String, String> _callToMessage = {};
  final Set<String> _runningCalls = {};

  @override
  ChatState build() {
    final connection = ref.watch(connectionControllerProvider);
    final online = connection.status == ConnectionStatus.connected;
    _sessionId ??= _uuid.v4();
    _initListener();
    if (!_loadStarted) {
      _loadStarted = true;
      unawaited(_loadSession());
    }
    return ChatState(online: online, sessionId: _sessionId, messages: _messages);
  }

  Future<File?> _getStoreFile() async {
    if (_storeFile != null) return _storeFile;
    final dir = await getApplicationSupportDirectory();
    _storeFile = File(p.join(dir.path, 'session.json'));
    return _storeFile;
  }

  Future<void> _loadSession() async {
    try {
      final file = await _getStoreFile();
      if (file == null || !await file.exists()) return;
      final raw = await file.readAsString();
      if (raw.trim().isEmpty) return;
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final loadedId = decoded['sessionId'] as String?;
      final loaded = (decoded['messages'] as List<dynamic>? ?? [])
          .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
          .toList();
      if (loaded.isEmpty) return;
      _sessionId = loadedId;
      _messages = loaded;
      _callToMessage.clear();
      for (final m in loaded) {
        for (final t in m.tools) {
          _callToMessage[t.callId] = m.id;
        }
      }
      state = ChatState(messages: _messages, sessionId: loadedId, online: state.online);
    } catch (e) {
      stderr.writeln('Failed to load session: $e');
    }
  }

  void _schedulePersist() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(milliseconds: 800), () {
      unawaited(_persist());
    });
  }

  Future<void> _persist() async {
    try {
      final file = await _getStoreFile();
      if (file == null) return;
      final json = {
        'sessionId': state.sessionId,
        'messages': _messages.where((m) => m.complete).map((m) => m.toJson()).toList(),
      };
      await file.writeAsString(jsonEncode(json));
    } catch (e) {
      stderr.writeln('Failed to persist session: $e');
    }
  }

  void _initListener() {
    if (_subscribed) return;
    _subscribed = true;
    ref.listen(connectionControllerProvider, (prev, next) {
      if (prev?.status != next.status) {
        state = state.copyWith(online: next.status == ConnectionStatus.connected);
      }
    });
    final messages = ref.read(connectionControllerProvider.notifier).messages;
    messages.listen((ServerMessage msg) => _handle(msg), onError: (Object e) {
      state = state.copyWith(pendingError: e.toString());
    });
    ref.onDispose(() {
      _subscribed = false;
    });
  }

  void _handle(ServerMessage msg) {
    switch (msg) {
      case TokenMessage token:
        _onToken(token);
      case StreamEndMessage end:
        _onStreamEnd(end);
      case StatusMessage status:
        _onStatus(status);
      case ToolCallMessage call:
        _onToolCall(call);
      case ToolResultMessage result:
        _onToolResult(result);
      case JarvisError error:
        _onError(error);
      case VoiceResponseMessage voice:
        _onVoice(voice);
      case PongMessage() || ConfigResponseMessage() || ConnectedMessage():
        break;
    }
  }

  ChatMessage? _bubble(String id) {
    for (final m in _messages) {
      if (m.id == id) return m;
    }
    return null;
  }

  String? _messageForCall(String callId) => _callToMessage[callId];

  ChatMessage _ensureBubble(String requestId) {
    final existing = _bubble(requestId);
    if (existing != null) return existing;
    _activeRequestId ??= requestId;
    final bubble = ChatMessage(id: requestId, role: MessageRole.assistant);
    _messages = [..._messages, bubble];
    state = state.copyWith(messages: _messages);
    return bubble;
  }

  void _onToolCall(ToolCallMessage call) {
    if (_callToMessage.containsKey(call.callId)) return;
    final bubble = _ensureBubble(call.requestId);
    _callToMessage[call.callId] = bubble.id;
    final systemCard = call.isDevice;
    final step = ToolStep(
      callId: call.callId,
      name: call.tool,
      params: call.params,
      requiresApproval: call.approvalRequired,
      executor: call.executor,
      status: systemCard && !call.approvalRequired
          ? ToolStepStatus.running
          : (call.approvalRequired ? ToolStepStatus.awaitingApproval : ToolStepStatus.running),
    );
    _replace(bubble.copyWith(tools: [...bubble.tools, step]));
    if (systemCard && !call.approvalRequired) {
      unawaited(_runDeviceStep(bubble.id, step));
    }
  }

  Future<void> _runDeviceStep(String requestId, ToolStep step) async {
    if (_runningCalls.contains(step.callId)) return;
    _runningCalls.add(step.callId);
    try {
      final idxBefore = _stepIndex(requestId, step.callId);
      if (idxBefore != null) {
        _updateStep(requestId, step.callId, status: ToolStepStatus.running);
      }
      final config = ref.read(settingsControllerProvider);
      DeviceToolResult result;
      try {
        result = await DeviceToolExecutor.instance.execute(step.name, step.params, config);
      } catch (e) {
        result = DeviceToolResult(success: false, error: 'Device action failed: $e');
      }
      ref.read(connectionControllerProvider.notifier).sendToolExecuteResult(requestId, step.callId, result);
      _updateStep(requestId, step.callId, status: result.success ? ToolStepStatus.done : ToolStepStatus.failed,
          error: result.error, result: result.success ? _prettifyResult(result.data) : null);
    } finally {
      _runningCalls.remove(step.callId);
    }
  }

  int? _stepIndex(String requestId, String callId) {
    final bubble = _bubble(requestId);
    if (bubble == null) return null;
    final idx = bubble.tools.indexWhere((t) => t.callId == callId);
    return idx < 0 ? null : idx;
  }

  void _updateStep(String requestId, String callId, {ToolStepStatus? status, String? error, String? result}) {
    final bubble = _bubble(_messageForCall(callId) ?? requestId);
    if (bubble == null) return;
    final idx = bubble.tools.indexWhere((t) => t.callId == callId);
    if (idx < 0) return;
    final tools = [...bubble.tools];
    tools[idx] = tools[idx].copyWith(status: status, error: error, result: result);
    _replace(bubble.copyWith(tools: tools));
  }

  void _onToolResult(ToolResultMessage result) {
    final messageId = _messageForCall(result.callId);
    if (messageId == null) return;
    final bubble = _bubble(messageId);
    if (bubble == null) return;
    final idx = bubble.tools.indexWhere((t) => t.callId == result.callId);
    if (idx < 0) return;
    final tools = [...bubble.tools];
    tools[idx] = tools[idx].copyWith(
      status: result.success ? ToolStepStatus.done : ToolStepStatus.failed,
      error: result.error,
      result: result.success ? _prettifyResult(result.data) : null,
    );
    _replace(bubble.copyWith(tools: tools));
  }

  void approveTool(String callId) {
    final messageId = _messageForCall(callId);
    if (messageId == null) return;
    final bubble = _bubble(messageId);
    if (bubble == null) return;
    if (bubble.tools.any((t) => t.callId == callId && t.isDeviceTool)) {
      final step = bubble.tools.firstWhere((t) => t.callId == callId);
      final tools = bubble.tools.map((t) => t.callId == callId ? t.copyWith(status: ToolStepStatus.running) : t).toList();
      _replace(bubble.copyWith(tools: tools));
      unawaited(_runDeviceStep(bubble.id, step));
      return;
    }
    ref.read(connectionControllerProvider.notifier).sendToolResponse(bubble.id, callId, action: 'approve');
    final tools = bubble.tools.map((t) => t.callId == callId ? t.copyWith(status: ToolStepStatus.running) : t).toList();
    _replace(bubble.copyWith(tools: tools));
  }

  void denyTool(String callId) {
    final messageId = _messageForCall(callId);
    if (messageId == null) return;
    final bubble = _bubble(messageId);
    if (bubble == null) return;
    if (bubble.tools.any((t) => t.callId == callId && t.isDeviceTool)) {
      ref.read(connectionControllerProvider.notifier).sendToolExecuteResult(
            bubble.id,
            callId,
            const DeviceToolResult(success: false, error: 'Denied'),
          );
    } else {
      ref.read(connectionControllerProvider.notifier).sendToolResponse(bubble.id, callId, action: 'deny');
    }
    final tools = bubble.tools.map((t) => t.callId == callId ? t.copyWith(status: ToolStepStatus.denied) : t).toList();
    _replace(bubble.copyWith(tools: tools));
  }

  static ChatMessage _settleStrayTools(ChatMessage bubble, ToolStepStatus status, String error) {
    final hasStray = bubble.tools.any(
        (t) => t.status == ToolStepStatus.running || t.status == ToolStepStatus.awaitingApproval);
    if (!hasStray) return bubble;
    final tools = bubble.tools
        .map((t) => (t.status == ToolStepStatus.running || t.status == ToolStepStatus.awaitingApproval)
            ? t.copyWith(status: status, error: error)
            : t)
        .toList();
    return bubble.copyWith(tools: tools);
  }

  static String _prettifyResult(Object? data) {
    if (data is String) {
      return data.length > 2000 ? '${data.substring(0, 2000)}…' : data;
    }
    final json = const JsonEncoder.withIndent('  ').convert(data);
    return json.length > 4000 ? '${json.substring(0, 4000)}…' : json;
  }

  void _onToken(TokenMessage token) {
    final bubble = _ensureBubble(token.requestId);
    final updated = token.kind == TokenKind.thinking
        ? bubble.copyWith(thinking: _appendStreamChunk(bubble.thinking, token.content))
        : bubble.copyWith(content: _appendStreamChunk(bubble.content, token.content));
    _replace(updated);
  }

  static String _appendStreamChunk(String current, String chunk) {
    if (chunk.isEmpty || current.endsWith(chunk)) return current;
    if (chunk.startsWith(current)) return chunk;
    return current + chunk;
  }

  void _onStreamEnd(StreamEndMessage end) {
    final bubble = _ensureBubble(end.requestId);
    _activeRequestId = null;
    final completed =
        _settleStrayTools(bubble.asCompleteWith(end.fullResponse, finalModel: end.model), ToolStepStatus.failed, 'No result received');
    _replace(completed);
  }

  void _onStatus(StatusMessage status) {
    final requestId = status.requestId;
    if (requestId == null) return;
    final existing = _bubble(requestId);
    if (existing == null) {
      _replace(_ensureBubble(requestId).copyWith(status: status.status));
      return;
    }
    if (existing.complete) return;
    _replace(existing.copyWith(status: status.status));
  }

  void _onError(JarvisError error) {
    final requestId = error.requestId;
    if (requestId != null) {
      final bubble = _ensureBubble(requestId);
      _activeRequestId = null;
      final settled = _settleStrayTools(
          bubble.copyWith(errorMessage: error.message, complete: true, clearStatus: true),
          ToolStepStatus.failed,
          error.message);
      _replace(settled);
      return;
    }
    state = state.copyWith(pendingError: error.message);
  }

  void _onVoice(VoiceResponseMessage voice) {
    final isReplay = _messages.any((m) => m.id == voice.requestId);
    final cfg = ref.read(settingsControllerProvider);
    if (!isReplay && !cfg.voiceReplies) return;
    try {
      ref.read(ttsControllerProvider.notifier).enqueue(base64Decode(voice.audio));
    } catch (_) {}
  }

  void _replace(ChatMessage updated) {
    _messages = _messages.map((m) => m.id == updated.id ? updated : m).toList();
    state = state.copyWith(messages: _messages);
    if (updated.complete) _schedulePersist();
  }

  Future<void> send(String text, {String? model, bool voice = false}) async {
    if (text.trim().isEmpty) return;
    if (_activeRequestId != null) return;
    final requestId = _uuid.v4();
    final sent = ref.read(connectionControllerProvider.notifier).sendChat(
          id: requestId,
          content: text,
          sessionId: state.sessionId,
          model: model,
          voice: voice,
        );
    if (!sent) {
      state = state.copyWith(pendingError: 'Not connected to Jarvis.');
      return;
    }
    _activeRequestId = requestId;
    final userMsg = ChatMessage(id: _uuid.v4(), role: MessageRole.user, content: text, complete: true);
    _messages = [..._messages, userMsg];
    state = state.copyWith(messages: _messages, clearError: true);
    _schedulePersist();
  }

  void speakMessage(String messageId, String text) {
    if (text.trim().isEmpty) return;
    ref.read(connectionControllerProvider.notifier).sendSpeak(text: text, requestId: messageId);
  }

  void cancel() {
    final requestId = _activeRequestId;
    if (requestId == null) return;
    ref.read(connectionControllerProvider.notifier).sendCancel(requestId);
    final bubble = _bubble(requestId);
    if (bubble != null) {
      final tools = bubble.tools
          .map((t) => t.status == ToolStepStatus.running ||
                  t.status == ToolStepStatus.awaitingApproval
              ? t.copyWith(status: ToolStepStatus.denied, error: 'Cancelled')
              : t)
          .toList();
      _replace(bubble.copyWith(
        tools: tools,
        complete: true,
        clearStatus: true,
        errorMessage: bubble.content.isEmpty && bubble.tools.isEmpty ? 'Stopped' : null,
      ));
    }
    _activeRequestId = null;
  }

  void clearPendingError() {
    state = state.copyWith(clearError: true);
  }

  Future<void> reset() async {
    _messages = [];
    _activeRequestId = null;
    _callToMessage.clear();
    _runningCalls.clear();
    _sessionId = _uuid.v4();
    _persistTimer?.cancel();
    ref.read(ttsControllerProvider.notifier).clear();
    state = ChatState(sessionId: _sessionId, online: state.online);
    try {
      final file = await _getStoreFile();
      if (file != null && await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }
}

final chatControllerProvider = NotifierProvider<ChatController, ChatState>(ChatController.new);
