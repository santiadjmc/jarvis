import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_config.dart';
import '../services/ws/connection_controller.dart';
import 'theme/jarvis_theme.dart';

class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key});

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  late final TextEditingController _hostController;
  late final TextEditingController _keyController;
  late final TextEditingController _nameController;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    final cfg = ref.read(settingsControllerProvider);
    _hostController = TextEditingController(text: cfg.host);
    _keyController = TextEditingController(text: cfg.apiKey ?? '');
    _nameController = TextEditingController(text: cfg.deviceName ?? '');
  }

  @override
  void dispose() {
    _hostController.dispose();
    _keyController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final host = _hostController.text.trim();
    final key = _keyController.text.trim();
    final name = _nameController.text.trim();
    if (name.isNotEmpty) {
      await ref.read(settingsControllerProvider.notifier).save(deviceName: name);
    }
    setState(() {
      _validationError = host.isEmpty
          ? 'Enter the server address, e.g. 192.168.1.2:3000'
          : key.isEmpty
              ? 'Enter the API key'
              : null;
    });
    if (_validationError != null) return;

    final ok = await ref.read(connectionControllerProvider.notifier).connect(host, key);
    if (mounted && !ok && ref.read(connectionControllerProvider).status != ConnectionStatus.retrying) {
      setState(() => _validationError = 'Could not reach that server.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionControllerProvider);
    final status = connection.status;
    final busy = status == ConnectionStatus.connecting || status == ConnectionStatus.connected;
    final connected = status == ConnectionStatus.connected;

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ReactorCore(
                  size: 88,
                  active: connected,
                  color: connected ? JarvisColors.signal : JarvisColors.cyan,
                  icon: connected ? Icons.check : null,
                ),
                const SizedBox(height: 28),
                const Text(
                  'JARVIS',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: JarvisType.display,
                    fontSize: 30,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 2,
                    color: JarvisColors.ink,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Connect to your server to get started',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: JarvisColors.inkMuted, fontSize: 13.5),
                ),
                const SizedBox(height: 36),
                TextField(
                  controller: _hostController,
                  style: const TextStyle(color: JarvisColors.ink, fontFamily: JarvisType.mono, fontSize: 14),
                  decoration: const InputDecoration(
                    labelText: 'Server',
                    prefixIcon: Icon(Icons.dns_outlined),
                    hintText: '192.168.1.2:3000',
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _keyController,
                  obscureText: true,
                  style: const TextStyle(color: JarvisColors.ink, fontFamily: JarvisType.mono, fontSize: 14),
                  decoration: const InputDecoration(
                    labelText: 'API key',
                    prefixIcon: Icon(Icons.key_outlined),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _nameController,
                  style: const TextStyle(color: JarvisColors.ink),
                  decoration: const InputDecoration(
                    labelText: 'Device name',
                    prefixIcon: Icon(Icons.smartphone_outlined),
                    hintText: 'e.g. Phone, Laptop',
                  ),
                ),
                const SizedBox(height: 22),
                SizedBox(
                  height: 50,
                  child: FilledButton.icon(
                    onPressed: busy ? null : _connect,
                    icon: status == ConnectionStatus.connecting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: JarvisColors.void_),
                          )
                        : Icon(connected ? Icons.check : Icons.power_settings_new),
                    label: Text(status == ConnectionStatus.connecting
                        ? 'Connecting'
                        : connected
                            ? 'Connected'
                            : 'Connect'),
                    style: FilledButton.styleFrom(
                      backgroundColor: connected ? JarvisColors.signal : JarvisColors.cyan,
                    ),
                  ),
                ),
                if (_validationError != null) ...[
                  const SizedBox(height: 14),
                  Text(
                    _validationError!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: JarvisColors.danger, fontSize: 13),
                  ),
                ],
                if (status == ConnectionStatus.retrying) ...[
                  const SizedBox(height: 14),
                  HudPanel(
                    borderColor: JarvisColors.amber,
                    color: JarvisColors.amber.withValues(alpha: 0.06),
                    child: Column(
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2, color: JarvisColors.amber),
                            ),
                            SizedBox(width: 10),
                            Text('Retrying connection…', style: TextStyle(color: JarvisColors.amber, fontSize: 13)),
                          ],
                        ),
                        if ((connection.errorMessage ?? '').isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            connection.errorMessage!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: JarvisColors.inkMuted, fontSize: 12),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
