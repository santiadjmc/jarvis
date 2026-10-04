import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_config.dart';
import '../services/ws/connection_controller.dart';

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
          ? 'Enter the server LAN address, e.g. 192.168.1.2:3000'
          : key.isEmpty
              ? 'Enter the API key'
              : null;
    });
    if (_validationError != null) return;

    final ok = await ref.read(connectionControllerProvider.notifier).connect(host, key);
    if (mounted && !ok && ref.read(connectionControllerProvider).status != ConnectionStatus.retrying) {
      setState(() => _validationError = 'Connection failed.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionControllerProvider);
    final status = connection.status;
    final busy = status == ConnectionStatus.connecting || status == ConnectionStatus.connected;

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ArcReactor(size: 72, active: status == ConnectionStatus.connected),
                const SizedBox(height: 24),
                Text(
                  'JARVIS',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.displaySmall!.copyWith(
                        fontWeight: FontWeight.bold,
                        letterSpacing: 4,
                        color: const Color(0xFF00E5FF),
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Local AI assistant',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: Colors.white54),
                ),
                const SizedBox(height: 40),
                TextField(
                  controller: _hostController,
                  enabled: !busy,
                  decoration: const InputDecoration(
                    labelText: 'Server',
                    prefixIcon: Icon(Icons.dns_outlined),
                    hintText: '192.168.1.2:3000',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _keyController,
                  enabled: !busy,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'API key',
                    prefixIcon: Icon(Icons.key_outlined),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _nameController,
                  enabled: !busy,
                  decoration: const InputDecoration(
                    labelText: 'Device name',
                    prefixIcon: Icon(Icons.smartphone),
                    hintText: 'e.g. Phone, Laptop',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: busy ? null : _connect,
                  icon: status == ConnectionStatus.connecting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.power_settings_new),
                  label: Text(status == ConnectionStatus.connecting
                      ? 'Connecting…'
                      : status == ConnectionStatus.connected
                          ? 'Connected ✓'
                          : 'Connect'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: status == ConnectionStatus.connected ? const Color(0xFF00C853) : const Color(0xFF00B8D4),
                  ),
                ),
                if (_validationError != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _validationError!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                ],
                if (status == ConnectionStatus.retrying) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.orangeAccent.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.orangeAccent.withValues(alpha: 0.5)),
                    ),
                    child: Column(
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orangeAccent),
                            ),
                            SizedBox(width: 8),
                            Text('Connection failed. Retrying automatically…',
                                style: TextStyle(color: Colors.orangeAccent, fontSize: 13)),
                          ],
                        ),
                        if ((connection.errorMessage ?? '').isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            connection.errorMessage!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white70, fontSize: 12),
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

class _ArcReactor extends StatelessWidget {
  const _ArcReactor({required this.size, this.active = false});

  final double size;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final glow = active ? const Color(0xFF00C853) : const Color(0xFF00E5FF);
    return Center(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.black.withValues(alpha: 0.6),
          border: Border.all(color: glow, width: 3),
          boxShadow: [
            BoxShadow(
              color: glow.withValues(alpha: active ? 0.6 : 0.35),
              blurRadius: active ? 32 : 24,
              spreadRadius: active ? 4 : 2,
            ),
          ],
        ),
        alignment: Alignment.center,
        child: Icon(active ? Icons.check_circle_outline : Icons.hexagon_outlined, color: glow, size: 28),
      ),
    );
  }
}
