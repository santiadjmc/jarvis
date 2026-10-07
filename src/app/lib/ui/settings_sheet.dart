import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/chat_controller.dart';
import '../core/app_config.dart';
import '../protocol/jarvis_protocol.dart';
import '../services/ws/connection_controller.dart';

class SettingsSheet extends ConsumerStatefulWidget {
  const SettingsSheet({super.key});

  @override
  ConsumerState<SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends ConsumerState<SettingsSheet> {
  late final TextEditingController _hostController;
  late final TextEditingController _keyController;
  late final TextEditingController _modelController;
  late final TextEditingController _nameController;
  StreamSubscription<ServerMessage>? _configSub;
  List<String> _availableModels = [];

  @override
  void initState() {
    super.initState();
    final cfg = ref.read(settingsControllerProvider);
    _hostController = TextEditingController(text: cfg.host);
    _keyController = TextEditingController(text: cfg.apiKey ?? '');
    _modelController = TextEditingController(text: cfg.model ?? '');
    _nameController = TextEditingController(text: cfg.deviceName ?? '');

    final connection = ref.read(connectionControllerProvider.notifier);
    if (ref.read(connectionControllerProvider).status == ConnectionStatus.connected) {
      _configSub = connection.messages.listen((msg) {
        if (msg is! ConfigResponseMessage) return;
        if (msg.key != 'models') return;
        final value = msg.value;
        if (value is! List) return;
        final names = value
            .map((e) => e is Map ? e['name']?.toString() : e.toString())
            .whereType<String>()
            .toList();
        if (mounted) setState(() => _availableModels = names);
      });
      connection.sendConfigGet('models');
    }
  }

  @override
  void dispose() {
    _configSub?.cancel();
    _hostController.dispose();
    _keyController.dispose();
    _modelController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _saveAndMaybeReconnect() async {
    final host = _hostController.text.trim();
    final key = _keyController.text.trim();
    final model = _modelController.text.trim();
    final name = _nameController.text.trim();

    final previous = ref.read(settingsControllerProvider);
    final notifier = ref.read(settingsControllerProvider.notifier);
    await notifier.save(
      host: host.isEmpty ? null : host,
      apiKey: key.isEmpty ? null : key,
      model: model.isEmpty ? null : model,
      deviceName: name.isEmpty ? null : name,
    );

    final connection = ref.read(connectionControllerProvider.notifier);
    final cfg = ref.read(settingsControllerProvider);
    final notConnected = ref.read(connectionControllerProvider).status != ConnectionStatus.connected;
    if (cfg.isConfigured &&
        (previous.host != cfg.host || previous.apiKey != cfg.apiKey || notConnected)) {
      await connection.disconnect();
      await connection.connect(cfg.host, cfg.apiKey!);
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _disconnect() async {
    await ref.read(connectionControllerProvider.notifier).disconnect();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _resetConversation() async {
    await ref.read(chatControllerProvider.notifier).reset();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _setAutoApprove(bool value) async {
    if (value) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          backgroundColor: const Color(0xFF101830),
          title: const Text('Enable full autonomous mode?'),
          content: const Text(
            'Jarvis will run every tool it decides to use — including shell commands, '
            'file writes/deletes, and device actions — without asking you first. '
            'Only enable this if you trust it completely.',
            style: TextStyle(fontSize: 13),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
              child: const Text('Enable'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    ref.read(chatControllerProvider.notifier).setAutoApprove(value);
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionControllerProvider);
    final autoApprove = ref.watch(chatControllerProvider.select((s) => s.autoApprove));

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Settings',
            style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Server: ${connection.status.name}',
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _hostController,
            decoration: const InputDecoration(
              labelText: 'Server',
              hintText: '192.168.1.2:3000',
              prefixIcon: Icon(Icons.dns_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _keyController,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'API key',
              prefixIcon: Icon(Icons.key_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _modelController,
            decoration: const InputDecoration(
              labelText: 'Model override (blank = auto)',
              hintText: 'e.g. llama3.2',
              prefixIcon: Icon(Icons.auto_awesome_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          if (_availableModels.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final name in _availableModels)
                  ActionChip(
                    label: Text(name, style: const TextStyle(fontSize: 12)),
                    backgroundColor: const Color(0xFF101830),
                    side: const BorderSide(color: Colors.white12),
                    onPressed: () => setState(() => _modelController.text = name),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Device name',
              hintText: 'e.g. Phone, Laptop',
              prefixIcon: Icon(Icons.smartphone),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Voice replies', style: TextStyle(fontSize: 14)),
            subtitle: const Text(
              'Speak responses aloud when you talk to Jarvis',
              style: TextStyle(fontSize: 12, color: Colors.white54),
            ),
            value: ref.watch(settingsControllerProvider).voiceReplies,
            onChanged: (value) => ref.read(settingsControllerProvider.notifier).save(voiceReplies: value),
          ),
          const SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('"Hey Jarvis" wake word', style: TextStyle(fontSize: 14)),
            subtitle: const Text(
              'Always listen for "Jarvis" on this device and start voice input automatically',
              style: TextStyle(fontSize: 12, color: Colors.white54),
            ),
            value: ref.watch(settingsControllerProvider).wakeWordEnabled,
            onChanged: connection.status == ConnectionStatus.connected
                ? (value) async {
                    await ref.read(settingsControllerProvider.notifier).save(wakeWordEnabled: value);
                    await ref.read(chatControllerProvider.notifier).syncWakeWord();
                  }
                : null,
          ),
          const SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Full autonomous mode', style: TextStyle(fontSize: 14)),
            subtitle: Text(
              autoApprove
                  ? 'Jarvis runs every tool automatically — nothing needs approval'
                  : 'Jarvis asks before risky actions (shell, file writes, device control)',
              style: TextStyle(fontSize: 12, color: autoApprove ? Colors.redAccent : Colors.white54),
            ),
            activeThumbColor: Colors.redAccent,
            value: autoApprove,
            onChanged: connection.status == ConnectionStatus.connected ? _setAutoApprove : null,
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _saveAndMaybeReconnect,
            icon: const Icon(Icons.check),
            label: const Text('Save'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              backgroundColor: const Color(0xFF00B8D4),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _resetConversation,
                  icon: const Icon(Icons.delete_sweep_outlined),
                  label: const Text('Reset'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _disconnect,
                  icon: const Icon(Icons.power_settings_new),
                  label: const Text('Disconnect'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
