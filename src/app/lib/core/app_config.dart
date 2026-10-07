import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppConfig {
  const AppConfig({
    this.host = defaultHost,
    this.apiKey,
    this.model,
    this.deviceId,
    this.deviceName,
    this.voiceReplies = true,
  });

  static const defaultHost = '';
  static const schema = 'ws';
  static const heartbeatIntervalName = 'jarvis';
  static String? _storedDeviceId;

  final String host;
  final String? apiKey;
  final String? model;
  final String? deviceId;
  final String? deviceName;
  final bool voiceReplies;

  bool get isConfigured => apiKey != null && apiKey!.isNotEmpty && host.isNotEmpty;

  String get wsUrl => '$schema://$host/ws?key=${Uri.encodeQueryComponent(apiKey ?? '')}';

  String get effectiveDeviceId => deviceId ?? (_storedDeviceId ??= SettingsController._generateId());

  String get deviceType {
    if (kIsWeb) return 'web';
    if (defaultTargetPlatform == TargetPlatform.android) return 'android';
    if (defaultTargetPlatform == TargetPlatform.iOS) return 'ios';
    if (defaultTargetPlatform == TargetPlatform.windows) return 'windows';
    if (defaultTargetPlatform == TargetPlatform.macOS) return 'macos';
    if (defaultTargetPlatform == TargetPlatform.linux) return 'linux';
    return 'other';
  }

  String get effectiveDeviceName => (deviceName ?? '').trim().isNotEmpty ? deviceName!.trim() : '$deviceType-$_shortId';

  String get _shortId => effectiveDeviceId.replaceAll('-', '').substring(0, min(6, effectiveDeviceId.length));

  AppConfig copyWith({
    String? host,
    String? apiKey,
    String? model,
    String? deviceId,
    String? deviceName,
    bool? voiceReplies,
    bool clearKey = false,
  }) {
    return AppConfig(
      host: host ?? this.host,
      apiKey: clearKey ? null : (apiKey ?? this.apiKey),
      model: model ?? this.model,
      deviceId: deviceId ?? this.deviceId,
      deviceName: deviceName ?? this.deviceName,
      voiceReplies: voiceReplies ?? this.voiceReplies,
    );
  }
}

class SettingsController extends Notifier<AppConfig> {
  static const _kHost = 'jarvis.host';
  static const _kKey = 'jarvis.api_key';
  static const _kModel = 'jarvis.model';
  static const _kDeviceId = 'jarvis.device_id';
  static const _kDeviceName = 'jarvis.device_name';
  static const _kVoiceReplies = 'jarvis.voice_replies';
  int _revision = 0;

  @override
  AppConfig build() {
    _load();
    return const AppConfig();
  }

  Future<void> _load() async {
    final revision = _revision;
    final prefs = await SharedPreferences.getInstance();
    var deviceId = prefs.getString(_kDeviceId) ?? AppConfig._storedDeviceId;
    if (deviceId == null || deviceId.isEmpty) {
      deviceId = _generateId();
      await prefs.setString(_kDeviceId, deviceId);
    }
    AppConfig._storedDeviceId = deviceId;
    if (revision != _revision) return;
    state = AppConfig(
      host: prefs.getString(_kHost) ?? AppConfig.defaultHost,
      apiKey: prefs.getString(_kKey),
      model: prefs.getString(_kModel),
      deviceId: deviceId,
      deviceName: prefs.getString(_kDeviceName),
      voiceReplies: prefs.getBool(_kVoiceReplies) ?? true,
    );
  }

  Future<void> save({
    String? host,
    String? apiKey,
    String? model,
    String? deviceName,
    bool? voiceReplies,
  }) async {
    _revision++;
    final cfg = state;
    state = AppConfig(
      host: host ?? cfg.host,
      apiKey: apiKey ?? cfg.apiKey,
      model: model ?? cfg.model,
      deviceId: cfg.deviceId,
      deviceName: deviceName ?? cfg.deviceName,
      voiceReplies: voiceReplies ?? cfg.voiceReplies,
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kHost, state.host);
    if (apiKey != null) await prefs.setString(_kKey, apiKey);
    if (model != null) await prefs.setString(_kModel, model);
    if (deviceName != null) await prefs.setString(_kDeviceName, deviceName);
    if (voiceReplies != null) await prefs.setBool(_kVoiceReplies, voiceReplies);
  }

  Future<void> clear() async {
    _revision++;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kHost);
    await prefs.remove(_kKey);
    await prefs.remove(_kModel);
    await prefs.remove(_kDeviceName);
    await prefs.remove(_kVoiceReplies);
    AppConfig._storedDeviceId = null;
    state = const AppConfig();
  }

  static String _generateId() {
    final rng = Random();
    const hex = '0123456789abcdef';
    final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    final sb = StringBuffer();
    for (var i = 0; i < 16; i++) {
      if (i == 4 || i == 6 || i == 8 || i == 10) sb.write('-');
      sb.write(hex[bytes[i] >> 4]);
      sb.write(hex[bytes[i] & 0x0F]);
    }
    return sb.toString();
  }
}

final settingsControllerProvider = NotifierProvider<SettingsController, AppConfig>(SettingsController.new);
