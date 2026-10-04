import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:jarvis/protocol/jarvis_protocol.dart';

Future<void> main(List<String> args) async {
  final host = args[0];
  final key = args[1];
  final prompt = args[2];
  // set E2E_CANCEL_AFTER_THINKING=1 to cancel as soon as thinking tokens flow
  final cancelAfterThinking = Platform.environment['E2E_CANCEL_AFTER_THINKING'] == '1';

  final channel = WebSocketChannel.connect(Uri.parse('ws://$host/ws?key=${Uri.encodeQueryComponent(key)}'));
  await channel.ready.timeout(const Duration(seconds: 5));

  final sentId = const Uuid().v4();
  var tokens = 0;
  var thinkingTokens = 0;
  var sawBridge = false;
  String? status;
  String? finalModel;
  bool cancelled = false;
  final completer = Completer<void>();

  channel.stream.listen(
    (raw) {
      final ServerMessage msg;
      try {
        msg = ServerMessage.fromRaw(raw);
      } on FormatException catch (e) {
        stdout.writeln('PROTOCOL ERROR: ${e.message}');
        completer.completeError(e);
        return;
      }
      switch (msg) {
        case TokenMessage():
          tokens++;
          if (msg.kind == TokenKind.thinking) {
            thinkingTokens++;
            if (thinkingTokens >= 1 && cancelAfterThinking && !cancelled) {
              cancelled = true;
              channel.sink.add(jsonEncode(CancelMessage(
                id: const Uuid().v4(),
                requestId: sentId,
              ).toJson()));
              stdout.writeln('\n[cancelled after $thinkingTokens thinking tokens]');
              Timer(const Duration(milliseconds: 300), () {
                if (!completer.isCompleted) completer.complete();
              });
            }
          } else {
            if (msg.content.contains('Let me think about it')) sawBridge = true;
            stdout.write(msg.content);
          }
        case StreamEndMessage():
          finalModel = msg.model;
          completer.complete();
        case StatusMessage():
          status = msg.status.name;
          stdout.write('\n[status: ${msg.status.name}]');
        case JarvisError():
          stdout.writeln('\n[error: ${msg.message}]');
          if (cancelled) {
            completer.complete();
          } else {
            completer.completeError(Exception(msg.message));
          }
        case PongMessage():
          stdout.writeln('\n[pong]');
        case ConnectedMessage():
          stdout.write('[connected: ${msg.clientId}]');
        case ToolCallMessage():
          stdout.writeln('\n[tool_call: ${msg.tool} approval=${msg.approvalRequired}]');
        case ToolResultMessage():
          stdout.writeln('\n[tool_result: ${msg.tool} success=${msg.success}]');
        case VoiceResponseMessage() || ConfigResponseMessage():
          stdout.writeln('\n[${msg.runtimeType}]');
      }
    },
    onError: (Object e) => completer.completeError(e),
    onDone: () => completer.complete(),
  );

  final t0 = DateTime.now();
  channel.sink.add(jsonEncode(ChatMessage(
    id: sentId,
    content: prompt,
    stream: true,
    timestamp: DateTime.now().millisecondsSinceEpoch,
  ).toJson()));

  await completer.future.timeout(const Duration(seconds: 120));
  final dt = DateTime.now().difference(t0);

  stdout.writeln('\n---');
  stdout.writeln('tokens=$tokens thinking=$thinkingTokens bridge="$sawBridge" status=$status model=$finalModel dt=${dt.inMilliseconds}ms');
  if (finalModel == null && !cancelled) {
    stdout.writeln('FAIL: no stream_end received');
    exit(1);
  }
  stdout.writeln('PASS');
  exit(0);
}