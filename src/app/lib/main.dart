import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio_media_kit/just_audio_media_kit.dart';

import 'chat/chat_controller.dart';
import 'core/app_config.dart';
import 'services/automation/system_assistant_service.dart';
import 'services/background/background_connection_service.dart';
import 'services/ws/connection_controller.dart';
import 'ui/chat_screen.dart';
import 'ui/setup_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  JustAudioMediaKit.ensureInitialized();
  BackgroundConnectionService.init();
  runApp(const ProviderScope(child: JarvisApp()));
}

class JarvisApp extends StatelessWidget {
  const JarvisApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Jarvis',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00E5FF),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0B1020),
      ),
      home: const HomeRouter(),
    );
  }
}

class HomeRouter extends ConsumerStatefulWidget {
  const HomeRouter({super.key});

  @override
  ConsumerState<HomeRouter> createState() => _HomeRouterState();
}

class _HomeRouterState extends ConsumerState<HomeRouter> with WidgetsBindingObserver {
  bool _autoConnectTried = false;
  bool _pendingAssistantVoiceStart = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeAutoConnect());
    unawaited(_checkAssistantTrigger());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_checkAssistantTrigger());
    }
  }

  Future<void> _checkAssistantTrigger() async {
    final triggered = await SystemAssistantService.consumeAssistantTrigger();
    if (triggered && mounted) setState(() => _pendingAssistantVoiceStart = true);
  }

  Future<void> _maybeAutoConnect() async {
    if (_autoConnectTried) return;
    final cfg = ref.read(settingsControllerProvider);
    final alreadyConnected = ref.read(connectionControllerProvider).status == ConnectionStatus.connected;
    if (!cfg.isConfigured || alreadyConnected) return;
    _autoConnectTried = true;
    await ref.read(connectionControllerProvider.notifier).connect(cfg.host, cfg.apiKey!);
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionControllerProvider);
    final config = ref.watch(settingsControllerProvider);

    if (config.isConfigured && !_autoConnectTried && connection.status == ConnectionStatus.disconnected) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _maybeAutoConnect());
    }

    if (_pendingAssistantVoiceStart && connection.status == ConnectionStatus.connected) {
      _pendingAssistantVoiceStart = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(chatControllerProvider.notifier).startVoiceInput();
      });
    }

    final showChat = connection.status == ConnectionStatus.connected ||
        (connection.hasConnectedOnce &&
            (connection.status == ConnectionStatus.retrying || connection.status == ConnectionStatus.connecting));
    return showChat ? const ChatScreen() : const SetupScreen();
  }
}
