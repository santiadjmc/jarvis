import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio_media_kit/just_audio_media_kit.dart';

import 'core/app_config.dart';
import 'services/ws/connection_controller.dart';
import 'ui/chat_screen.dart';
import 'ui/setup_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  JustAudioMediaKit.ensureInitialized();
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

class _HomeRouterState extends ConsumerState<HomeRouter> {
  bool _autoConnectTried = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeAutoConnect());
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

    final showChat =
        connection.status == ConnectionStatus.connected || connection.status == ConnectionStatus.retrying;
    return showChat ? const ChatScreen() : const SetupScreen();
  }
}
