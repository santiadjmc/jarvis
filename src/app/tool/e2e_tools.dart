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
  final approve = args.length > 3 && args[3] == 'approve';
  final expectTool = args.length > 4 ? args[4] : 'get_time';

  final channel = WebSocketChannel.connect(Uri.parse('ws://$host/ws?key=${Uri.encodeQueryComponent(key)}'));
  await channel.ready.timeout(const Duration(seconds: 5));

  final sentId = const Uuid().v4();
  final toolCalls = <String, String>{};
  var toolResults = 0;
  String? finalModel;
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
          if (msg.kind == TokenKind.assistant) stdout.write(msg.content);
        case StreamEndMessage():
          finalModel = msg.model;
          completer.complete();
        case ToolCallMessage():
          toolCalls[msg.callId] = msg.tool;
          stdout.writeln('\n[tool_call: ${msg.tool} approval=${msg.approvalRequired}]');
          if (approve && msg.approvalRequired) {
            channel.sink.add(jsonEncode(ToolResponseMessage(
              id: const Uuid().v4(),
              requestId: msg.requestId,
              callId: msg.callId,
              action: 'approve',
            ).toJson()));
            stdout.writeln('[approved ${msg.tool}]');
          }
        case ToolResultMessage():
          toolResults++;
          stdout.writeln('\n[tool_result: ${msg.tool} success=${msg.success}${msg.error != null ? ' error=${msg.error}' : ''}]');
        case JarvisError():
          stdout.writeln('\n[error: ${msg.message}]');
          completer.completeError(Exception(msg.message));
        case StatusMessage() || ConnectedMessage() || PongMessage():
          break;
        case VoiceResponseMessage() || ConfigResponseMessage():
          break;
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

  await completer.future.timeout(const Duration(seconds: 180));
  final dt = DateTime.now().difference(t0);

  stdout.writeln('\n---');
  stdout.writeln('tool_calls=${toolCalls.values.toList()} tool_results=$toolResults model=$finalModel dt=${dt.inMilliseconds}ms');

  var pass = true;
  final toolsCalled = toolCalls.values.toList();
  if (toolsCalled.isEmpty) {
    stdout.writeln('FAIL: model did not call any tool');
    pass = false;
  } else if (!toolsCalled.contains(expectTool)) {
    stdout.writeln('FAIL: expected tool "$expectTool" was never called (got $toolsCalled)');
    pass = false;
  }
  if (finalModel == null) {
    stdout.writeln('FAIL: no stream_end received');
    pass = false;
  }

  stdout.writeln(pass ? 'PASS' : 'FAIL');
  exit(pass ? 0 : 1);
}