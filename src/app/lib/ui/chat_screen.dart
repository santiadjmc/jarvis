import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/chat_controller.dart';
import '../core/app_config.dart';
import '../protocol/jarvis_protocol.dart' show ChatStatus;
import '../services/voice/tts_controller.dart';
import '../services/voice/voice_controller.dart';
import '../services/ws/connection_controller.dart';
import 'settings_sheet.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _scrollController = ScrollController();
  bool _stick = true;
  double? _lastPixels;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final p = _scrollController.position;
    _lastPixels ??= p.pixels;
    if (p.maxScrollExtent - p.pixels < 24) {
      _stick = true;
    } else if (p.pixels < _lastPixels!) {
      _stick = false;
    }
    _lastPixels = p.pixels;
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatControllerProvider);
    final connection = ref.watch(connectionControllerProvider);

    final streaming = chat.messages.any((m) => !m.complete);
    final lastIsUser = chat.messages.isNotEmpty && chat.messages.last.role == MessageRole.user;
    final follow = lastIsUser || (streaming && _stick);

    if (follow && _scrollController.hasClients) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_scrollController.hasClients) return;
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      });
    }

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _PulsingCore(),
            SizedBox(width: 8),
            Text('JARVIS'),
          ],
        ),
        actions: [
          if (connection.status != ConnectionStatus.connected)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Text(
                  connection.status == ConnectionStatus.connecting
                      ? 'connecting…'
                      : 'reconnecting…',
                  style: const TextStyle(color: Colors.orangeAccent, fontSize: 12),
                ),
              ),
            )
          else if (connection.latencyMs != null)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.circle, size: 8, color: _latencyColor(connection.latencyMs!)),
                    const SizedBox(width: 6),
                    Text(
                      '${connection.latencyMs}ms',
                      style: const TextStyle(color: Colors.white38, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Colors.white70),
            tooltip: 'Settings',
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              backgroundColor: const Color(0xFF101830),
              builder: (_) => const SettingsSheet(),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: chat.messages.isEmpty
                ? const _EmptyState()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: chat.messages.length,
                    itemBuilder: (context, index) => _MessageBubble(message: chat.messages[index]),
                  ),
          ),
          if (chat.pendingError != null)
            _ErrorBanner(message: chat.pendingError!, onDismiss: () => ref.read(chatControllerProvider.notifier).clearPendingError()),
          _Composer(),
        ],
      ),
    );
  }
}

Color _latencyColor(int latencyMs) {
  if (latencyMs < 150) return const Color(0xFF7CF29D);
  if (latencyMs < 400) return const Color(0xFFFFB74D);
  return const Color(0xFFFF8A80);
}

class _PulsingCore extends ConsumerStatefulWidget {
  const _PulsingCore();

  @override
  ConsumerState<_PulsingCore> createState() => _PulsingCoreState();
}

class _PulsingCoreState extends ConsumerState<_PulsingCore> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 2),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final busy = ref.watch(chatControllerProvider.select((s) => s.messages.any((m) => !m.complete)));
    final speaking = ref.watch(ttsControllerProvider).status == TtsStatus.playing;
    final active = busy || speaking;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = active ? _controller.value : 0.0;
        return Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.black.withValues(alpha: 0.4),
            border: Border.all(color: const Color(0xFF00E5FF), width: 1.5),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF00E5FF).withValues(alpha: 0.25 + t * 0.35),
                blurRadius: 6 + t * 10,
                spreadRadius: t * 2,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.hexagon_outlined, color: Color(0xFF00E5FF), size: 56),
          const SizedBox(height: 16),
          Text(
            'Connected to Jarvis',
            style: Theme.of(context).textTheme.titleMedium!.copyWith(color: Colors.white70),
          ),
          const SizedBox(height: 8),
          const Text(
            'Ask me anything.',
            style: TextStyle(color: Colors.white38),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends ConsumerWidget {
  const _MessageBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return switch (message.role) {
      MessageRole.user => _UserBubble(message: message),
      MessageRole.assistant => _AssistantBubble(message: message),
      MessageRole.error => _ErrorBubble(message: message),
    };
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12, left: 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF122A3A),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Text(
          message.content,
          style: const TextStyle(color: Colors.white, fontSize: 15),
        ),
      ),
    );
  }
}

class _AssistantBubble extends ConsumerStatefulWidget {
  const _AssistantBubble({required this.message});

  final ChatMessage message;

  @override
  ConsumerState<_AssistantBubble> createState() => _AssistantBubbleState();
}

class _AssistantBubbleState extends ConsumerState<_AssistantBubble> {
  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final streaming = !message.complete;
    final hasActivity = message.status != null ||
        message.thinking.isNotEmpty ||
        message.tools.isNotEmpty;

    return Container(
      margin: const EdgeInsets.only(bottom: 12, right: 48),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF101830),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.status != null || streaming)
            _StatusChip(status: message.status, streaming: streaming),
          if (message.errorMessage != null) ...[
            const SizedBox(height: 8),
            Text(
              message.errorMessage!,
              style: const TextStyle(color: Colors.redAccent, fontSize: 13),
            ),
          ],
          if (message.thinking.isNotEmpty) ...[
            const SizedBox(height: 8),
            _ThinkingDrawer(thinking: message.thinking, streaming: streaming),
            const SizedBox(height: 8),
          ],
          if (message.tools.isNotEmpty) ...[
            const SizedBox(height: 8),
            _ToolsSection(tools: message.tools),
            const SizedBox(height: 8),
          ],
          if (message.content.isNotEmpty)
            MarkdownBody(
              data: message.content,
              styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
                p: const TextStyle(color: Colors.white, fontSize: 15, height: 1.5),
                code: const TextStyle(
                  color: Color(0xFF80FFEA),
                  backgroundColor: Color(0xFF0B1020),
                  fontFamily: 'monospace',
                ),
                codeblockDecoration: BoxDecoration(
                  color: const Color(0xFF0B1020),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              selectable: true,
            )
          else if (streaming && !hasActivity)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 4),
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          if (!streaming && message.content.isNotEmpty)
            Align(
              alignment: Alignment.topRight,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (message.model != null)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Text(
                        message.model!,
                        style: const TextStyle(color: Colors.white24, fontSize: 10.5, fontStyle: FontStyle.italic),
                      ),
                    ),
                  IconButton(
                    constraints: const BoxConstraints(),
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.volume_up_outlined, size: 18, color: Colors.white38),
                    tooltip: 'Read aloud',
                    onPressed: () => ref
                        .read(chatControllerProvider.notifier)
                        .speakMessage(message.id, message.content),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ToolsSection extends ConsumerWidget {
  const _ToolsSection({required this.tools});

  final List<ToolStep> tools;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final step in tools) ...[
          _ToolCard(step: step),
          const SizedBox(height: 6),
        ],
      ],
    );
  }
}

class _ToolCard extends ConsumerStatefulWidget {
  const _ToolCard({required this.step});

  final ToolStep step;

  @override
  ConsumerState<_ToolCard> createState() => _ToolCardState();
}

class _ToolCardState extends ConsumerState<_ToolCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final step = widget.step;
    final params = step.params.entries
        .map((e) => '${e.key}=${step.requiresApproval ? e.value : _short(e.value)}')
        .join(', ');

    final (icon, color) = switch (step.status) {
      ToolStepStatus.running => (Icons.build, const Color(0xFF00E5FF)),
      ToolStepStatus.awaitingApproval => (Icons.lock_outline, const Color(0xFFFFB74D)),
      ToolStepStatus.done => (Icons.check_circle_outline, const Color(0xFF7CF29D)),
      ToolStepStatus.denied => (Icons.block, const Color(0xFFEF9A9A)),
      ToolStepStatus.failed => (Icons.error_outline, const Color(0xFFFF8A80)),
    };

    final statusLabel = switch (step.status) {
      ToolStepStatus.running => 'running',
      ToolStepStatus.awaitingApproval => 'needs approval',
      ToolStepStatus.done => 'done',
      ToolStepStatus.denied => 'denied',
      ToolStepStatus.failed => 'failed',
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1020),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: step.status == ToolStepStatus.awaitingApproval ? const Color(0xFFFFB74D) : Colors.white12,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  step.name,
                  style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (step.isDeviceTool) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E3A5F),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.smartphone, size: 11, color: Color(0xFF80D8FF)),
                      SizedBox(width: 3),
                      Text('device', style: TextStyle(color: Color(0xFF80D8FF), fontSize: 9.5)),
                    ],
                  ),
                ),
              ],
              if (step.status == ToolStepStatus.running)
                SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 1.6, color: color),
                ),
              if (step.status != ToolStepStatus.running)
                Text(statusLabel, style: TextStyle(color: color, fontSize: 11)),
            ],
          ),
          if (params.isNotEmpty) ...[
            const SizedBox(height: 4),
            step.requiresApproval
                ? SelectableText(
                    params,
                    style: const TextStyle(color: Colors.white54, fontFamily: 'monospace', fontSize: 11.5),
                  )
                : Text(params, style: const TextStyle(color: Colors.white38, fontSize: 11), overflow: TextOverflow.ellipsis),
          ],
          if (step.error != null) ...[
            const SizedBox(height: 6),
            Text(step.error!, style: const TextStyle(color: Color(0xFFFF8A80), fontSize: 12)),
          ],
          if (step.result != null && step.result!.isNotEmpty) ...[
            const SizedBox(height: 6),
            GestureDetector(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Text(
                _expanded ? step.result! : '${step.result!.substring(0, step.result!.length > 140 ? 140 : step.result!.length)}${step.result!.length > 140 ? '… (view)' : ''}',
                style: const TextStyle(color: Colors.white54, fontFamily: 'monospace', fontSize: 11),
              ),
            ),
          ],
          if (step.requiresApproval && step.status == ToolStepStatus.awaitingApproval) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => ref.read(chatControllerProvider.notifier).denyTool(step.callId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFEF9A9A),
                      side: const BorderSide(color: Color(0xFFEF9A9A)),
                      padding: const EdgeInsets.symmetric(vertical: 6),
                    ),
                    icon: const Icon(Icons.block, size: 14),
                    label: const Text('Deny', style: TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => ref.read(chatControllerProvider.notifier).approveTool(step.callId),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF7CF29D),
                      foregroundColor: const Color(0xFF002B12),
                      padding: const EdgeInsets.symmetric(vertical: 6),
                    ),
                    icon: const Icon(Icons.check, size: 14),
                    label: const Text('Allow', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  static String _short(Object? v) {
    final s = v.toString();
    return s.length > 40 ? '${s.substring(0, 40)}…' : s;
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.streaming});

  final ChatStatus? status;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      ChatStatus.reasoning => 'reasoning…',
      ChatStatus.toolCalling => 'using tools…',
      ChatStatus.searching => 'searching…',
      ChatStatus.generating => 'generating…',
      ChatStatus.thinking => 'thinking…',
      _ => streaming ? '…' : null,
    };
    if (label == null) return const SizedBox.shrink();

    final color = status == ChatStatus.reasoning ? const Color(0xFFFFB74D) : const Color(0xFF00E5FF);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 10,
          height: 10,
          child: CircularProgressIndicator(strokeWidth: 1.6, color: color),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: color, fontSize: 12, fontStyle: FontStyle.italic)),
      ],
    );
  }
}

class _ThinkingDrawer extends StatefulWidget {
  const _ThinkingDrawer({required this.thinking, required this.streaming});

  final String thinking;
  final bool streaming;

  @override
  State<_ThinkingDrawer> createState() => _ThinkingDrawerState();
}

class _ThinkingDrawerState extends State<_ThinkingDrawer> {
  bool _expanded = false;
  bool _autoOpened = false;

  @override
  void didUpdateWidget(covariant _ThinkingDrawer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_autoOpened && widget.streaming && widget.thinking.isNotEmpty) {
      _autoOpened = true;
      setState(() => _expanded = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
          onExpansionChanged: (v) => setState(() => _expanded = v),
          title: Text(
            'Thought process',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 12,
              fontStyle: FontStyle.italic,
            ),
          ),
          iconColor: Colors.white54,
          collapsedIconColor: Colors.white54,
          children: [
            AnimatedOpacity(
              opacity: _expanded ? 1 : 0,
              duration: const Duration(milliseconds: 200),
              child: _expanded
                  ? SelectableText(
                      widget.thinking,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.55),
                        fontSize: 13,
                        height: 1.4,
                        fontFamily: 'monospace',
                      ),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBubble extends StatelessWidget {
  const _ErrorBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12, right: 48),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF2A0F14),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.redAccent.withValues(alpha: 0.4)),
        ),
        child: Text(
          message.errorMessage ?? 'Something went wrong',
          style: const TextStyle(color: Colors.redAccent, fontSize: 13),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onDismiss});

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return MaterialBanner(
      backgroundColor: const Color(0xFF2A0F14),
      content: Text(message, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
      actions: [
        TextButton(onPressed: onDismiss, child: const Text('Dismiss', style: TextStyle(color: Colors.redAccent))),
      ],
    );
  }
}

class _Composer extends ConsumerStatefulWidget {
  const _Composer();

  @override
  ConsumerState<_Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<_Composer> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode(debugLabel: 'composer');
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _focusNode.onKeyEvent = (node, event) {
      if (event is KeyDownEvent &&
          event.logicalKey == LogicalKeyboardKey.enter &&
          !HardwareKeyboard.instance.isShiftPressed) {
        _send();
        return KeyEventResult.handled;
      }
      if (event is KeyRepeatEvent &&
          event.logicalKey == LogicalKeyboardKey.enter &&
          !HardwareKeyboard.instance.isShiftPressed) {
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    };
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text;
    if (text.trim().isEmpty) return;
    final model = ref.read(settingsControllerProvider).model;
    await ref.read(chatControllerProvider.notifier).send(text, model: model);
    _controller.clear();
    setState(() => _hasText = false);
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatControllerProvider);
    final streaming = chat.messages.any((m) => !m.complete);

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          16,
          8,
          16,
          MediaQuery.of(context).viewPadding.bottom > 0 ? MediaQuery.of(context).viewPadding.bottom : 16,
        ),
        child: Row(
          children: [
            const _ContinuousVoiceToggle(),
            const _SpeakingIndicator(),
            _VoiceButton(onFinalText: (text) {
              final cfg = ref.read(settingsControllerProvider);
              ref.read(chatControllerProvider.notifier).send(text, model: cfg.model, voice: cfg.voiceReplies);
            }),
            Expanded(
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                minLines: 1,
                maxLines: 5,
                onChanged: (v) => setState(() => _hasText = v.trim().isNotEmpty),
                onSubmitted: (_) => _send(),
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'Message Jarvis…',
                  hintStyle: const TextStyle(color: Colors.white38),
                  filled: true,
                  fillColor: const Color(0xFF101830),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            streaming
                ? IconButton.filledTonal(
                    onPressed: () => ref.read(chatControllerProvider.notifier).cancel(),
                    icon: const Icon(Icons.stop, color: Colors.white),
                    tooltip: 'Stop',
                  )
                : IconButton.filled(
                    onPressed: _hasText ? _send : null,
                    icon: const Icon(Icons.arrow_upward, color: Color(0xFF0B1020)),
                    style: IconButton.styleFrom(backgroundColor: const Color(0xFF00E5FF)),
                    tooltip: 'Send',
                  ),
          ],
        ),
      ),
    );
  }
}

class _VoiceButton extends ConsumerWidget {
  const _VoiceButton({required this.onFinalText});

  final void Function(String text) onFinalText;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voice = ref.watch(voiceControllerProvider);
    final notifier = ref.read(voiceControllerProvider.notifier);

    if (voice.error != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(voice.error!)));
      });
    }

    final listening = voice.status == VoiceStatus.listening;
    final transcribing = voice.status == VoiceStatus.transcribing;
    final unavailable = voice.status == VoiceStatus.unavailable;

    final icon = transcribing
        ? const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54),
          )
        : Icon(listening ? Icons.mic : Icons.mic_none,
            color: listening ? const Color(0xFFFF5252) : Colors.white54);

    return Stack(
      alignment: Alignment.center,
      children: [
        if (listening)
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: voice.soundLevel),
            duration: const Duration(milliseconds: 120),
            builder: (context, level, _) => Transform.scale(
              scale: 1.0 + level * 0.9,
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFFFF5252).withValues(alpha: 0.10 + level * 0.25),
                ),
              ),
            ),
          ),
        IconButton(
          onPressed: unavailable ? null : () {
            if (listening) {
              notifier.stop();
            } else {
              notifier.start(onFinalText);
            }
          },
          icon: icon,
          tooltip: listening ? 'Stop listening' : 'Voice input',
        ),
      ],
    );
  }
}

class _ContinuousVoiceToggle extends ConsumerWidget {
  const _ContinuousVoiceToggle();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(chatControllerProvider.select((s) => s.continuousVoice));
    return IconButton(
      onPressed: () => ref.read(chatControllerProvider.notifier).setContinuousVoice(!active),
      icon: Icon(Icons.loop, color: active ? const Color(0xFF00E5FF) : Colors.white38),
      tooltip: active ? 'Continuous voice mode: on' : 'Continuous voice mode: off',
    );
  }
}

class _SpeakingIndicator extends ConsumerStatefulWidget {
  const _SpeakingIndicator();

  @override
  ConsumerState<_SpeakingIndicator> createState() => _SpeakingIndicatorState();
}

class _SpeakingIndicatorState extends ConsumerState<_SpeakingIndicator> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 650),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final speaking = ref.watch(ttsControllerProvider).status == TtsStatus.playing;
    if (!speaking) return const SizedBox.shrink();
    return FadeTransition(
      opacity: Tween(begin: 0.4, end: 1.0).animate(_controller),
      child: const Padding(
        padding: EdgeInsets.only(right: 4),
        child: Icon(Icons.graphic_eq, color: Color(0xFF00E5FF), size: 18),
      ),
    );
  }
}