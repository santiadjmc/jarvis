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
import 'theme/jarvis_theme.dart';

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
    final busy = chat.messages.any((m) => !m.complete);
    final speaking = ref.watch(ttsControllerProvider).status == TtsStatus.playing;

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
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ReactorCore(size: 22, active: busy || speaking),
            const SizedBox(width: 10),
            const Text('JARVIS'),
          ],
        ),
        actions: [
          if (connection.status != ConnectionStatus.connected)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: HudReadout(
                  label: connection.status == ConnectionStatus.connecting ? 'CONNECTING' : 'RECONNECTING',
                  color: JarvisColors.amber,
                ),
              ),
            )
          else if (connection.latencyMs != null)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: HudReadout(
                  label: '${connection.latencyMs}MS',
                  color: _latencyColor(connection.latencyMs!),
                ),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              backgroundColor: JarvisColors.panel,
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
  if (latencyMs < 150) return JarvisColors.signal;
  if (latencyMs < 400) return JarvisColors.amber;
  return JarvisColors.danger;
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const ReactorCore(size: 64),
          const SizedBox(height: 20),
          const Text(
            'Connected to Jarvis',
            style: TextStyle(fontFamily: JarvisType.display, fontSize: 16, fontWeight: FontWeight.w600, color: JarvisColors.ink),
          ),
          const SizedBox(height: 6),
          const Text(
            'Ask me anything.',
            style: TextStyle(color: JarvisColors.inkMuted, fontSize: 13.5),
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
      child: HudPanel(
        margin: const EdgeInsets.only(bottom: 12, left: 48),
        color: JarvisColors.panelRaised,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        bevel: 12,
        child: Text(
          message.content,
          style: const TextStyle(color: JarvisColors.ink, fontSize: 15),
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

    return HudPanel(
      margin: const EdgeInsets.only(bottom: 12, right: 48),
      accentColor: message.proactive ? JarvisColors.cyan.withValues(alpha: 0.5) : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.proactive) ...[
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(message.subagent ? Icons.smart_toy_outlined : Icons.bolt, size: 14, color: JarvisColors.cyan),
                const SizedBox(width: 4),
                Text(
                  message.subagent ? 'Subagent report' : 'Jarvis reached out',
                  style: const TextStyle(color: JarvisColors.cyan, fontSize: 11.5, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 6),
          ],
          if (message.status != null || streaming)
            _StatusChip(status: message.status, streaming: streaming),
          if (message.errorMessage != null) ...[
            const SizedBox(height: 8),
            Text(
              message.errorMessage!,
              style: const TextStyle(color: JarvisColors.danger, fontSize: 13),
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
                p: const TextStyle(color: JarvisColors.ink, fontSize: 15, height: 1.5),
                code: const TextStyle(
                  color: JarvisColors.cyan,
                  backgroundColor: JarvisColors.void_,
                  fontFamily: JarvisType.mono,
                  fontSize: 13.5,
                ),
                codeblockDecoration: BoxDecoration(
                  color: JarvisColors.void_,
                  borderRadius: BorderRadius.circular(6),
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
                        style: const TextStyle(color: JarvisColors.inkFaint, fontFamily: JarvisType.mono, fontSize: 10.5),
                      ),
                    ),
                  IconButton(
                    constraints: const BoxConstraints(),
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.volume_up_outlined, size: 18, color: JarvisColors.inkFaint),
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
      ToolStepStatus.running => (Icons.build, JarvisColors.cyan),
      ToolStepStatus.awaitingApproval => (Icons.lock_outline, JarvisColors.amber),
      ToolStepStatus.done => (Icons.check_circle_outline, JarvisColors.signal),
      ToolStepStatus.denied => (Icons.block, JarvisColors.inkMuted),
      ToolStepStatus.failed => (Icons.error_outline, JarvisColors.danger),
    };

    final statusLabel = switch (step.status) {
      ToolStepStatus.running => 'running',
      ToolStepStatus.awaitingApproval => 'needs approval',
      ToolStepStatus.done => 'done',
      ToolStepStatus.denied => 'denied',
      ToolStepStatus.failed => 'failed',
    };

    return HudPanel(
      color: JarvisColors.void_,
      accentColor: step.status == ToolStepStatus.awaitingApproval ? JarvisColors.amber : null,
      padding: const EdgeInsets.all(10),
      bevel: 6,
      child: SizedBox(
        width: double.infinity,
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
                    style: const TextStyle(color: JarvisColors.ink, fontSize: 13, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (step.isDeviceTool) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: JarvisColors.cyanDim.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.smartphone, size: 11, color: JarvisColors.cyan),
                        SizedBox(width: 3),
                        Text('device', style: TextStyle(color: JarvisColors.cyan, fontFamily: JarvisType.mono, fontSize: 9.5)),
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
                  Text(statusLabel, style: TextStyle(color: color, fontFamily: JarvisType.mono, fontSize: 10.5)),
              ],
            ),
            if (params.isNotEmpty) ...[
              const SizedBox(height: 4),
              step.requiresApproval
                  ? SelectableText(
                      params,
                      style: const TextStyle(color: JarvisColors.inkMuted, fontFamily: JarvisType.mono, fontSize: 11.5),
                    )
                  : Text(params, style: const TextStyle(color: JarvisColors.inkFaint, fontFamily: JarvisType.mono, fontSize: 11), overflow: TextOverflow.ellipsis),
            ],
            if (step.error != null) ...[
              const SizedBox(height: 6),
              Text(step.error!, style: const TextStyle(color: JarvisColors.danger, fontSize: 12)),
            ],
            if (step.result != null && step.result!.isNotEmpty) ...[
              const SizedBox(height: 6),
              GestureDetector(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Text(
                  _expanded ? step.result! : '${step.result!.substring(0, step.result!.length > 140 ? 140 : step.result!.length)}${step.result!.length > 140 ? '… (view)' : ''}',
                  style: const TextStyle(color: JarvisColors.inkMuted, fontFamily: JarvisType.mono, fontSize: 11),
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
                        foregroundColor: JarvisColors.danger,
                        side: const BorderSide(color: JarvisColors.danger),
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
                        backgroundColor: JarvisColors.signal,
                        foregroundColor: JarvisColors.void_,
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
      ChatStatus.reasoning => 'reasoning',
      ChatStatus.toolCalling => 'using tools',
      ChatStatus.searching => 'searching',
      ChatStatus.generating => 'generating',
      ChatStatus.thinking => 'thinking',
      _ => streaming ? 'working' : null,
    };
    if (label == null) return const SizedBox.shrink();

    final color = status == ChatStatus.reasoning ? JarvisColors.amber : JarvisColors.cyan;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 10,
          height: 10,
          child: CircularProgressIndicator(strokeWidth: 1.6, color: color),
        ),
        const SizedBox(width: 6),
        Text(label, style: TextStyle(color: color, fontFamily: JarvisType.mono, fontSize: 11.5)),
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
        color: Colors.white.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 12),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
          onExpansionChanged: (v) => setState(() => _expanded = v),
          title: const Text(
            'Thought process',
            style: TextStyle(color: JarvisColors.inkMuted, fontSize: 12),
          ),
          iconColor: JarvisColors.inkMuted,
          collapsedIconColor: JarvisColors.inkMuted,
          children: [
            AnimatedOpacity(
              opacity: _expanded ? 1 : 0,
              duration: const Duration(milliseconds: 200),
              child: _expanded
                  ? SelectableText(
                      widget.thinking,
                      style: const TextStyle(
                        color: JarvisColors.inkMuted,
                        fontSize: 12.5,
                        height: 1.4,
                        fontFamily: JarvisType.mono,
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
      child: HudPanel(
        margin: const EdgeInsets.only(bottom: 12, right: 48),
        color: const Color(0xFF2A1014),
        borderColor: JarvisColors.danger,
        bevel: 10,
        child: Text(
          message.errorMessage ?? 'Something went wrong',
          style: const TextStyle(color: JarvisColors.danger, fontSize: 13),
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
      backgroundColor: const Color(0xFF2A1014),
      content: Text(message, style: const TextStyle(color: JarvisColors.danger, fontSize: 13)),
      actions: [
        TextButton(
          onPressed: onDismiss,
          style: TextButton.styleFrom(foregroundColor: JarvisColors.danger),
          child: const Text('Dismiss'),
        ),
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
                style: const TextStyle(color: JarvisColors.ink),
                decoration: const InputDecoration(
                  hintText: 'Message Jarvis',
                  contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
              ),
            ),
            const SizedBox(width: 8),
            streaming
                ? IconButton.filledTonal(
                    onPressed: () => ref.read(chatControllerProvider.notifier).cancel(),
                    icon: const Icon(Icons.stop),
                    tooltip: 'Stop',
                  )
                : IconButton.filled(
                    onPressed: _hasText ? _send : null,
                    icon: const Icon(Icons.arrow_upward, color: JarvisColors.void_),
                    style: IconButton.styleFrom(backgroundColor: JarvisColors.cyan),
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
            child: CircularProgressIndicator(strokeWidth: 2, color: JarvisColors.inkMuted),
          )
        : Icon(listening ? Icons.mic : Icons.mic_none,
            color: listening ? JarvisColors.danger : JarvisColors.inkMuted);

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
                  color: JarvisColors.danger.withValues(alpha: 0.10 + level * 0.25),
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
      icon: Icon(Icons.loop, color: active ? JarvisColors.cyan : JarvisColors.inkFaint),
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
        child: Icon(Icons.graphic_eq, color: JarvisColors.cyan, size: 18),
      ),
    );
  }
}
