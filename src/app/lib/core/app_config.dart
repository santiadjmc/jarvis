import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'settings_migration.dart';

class AppConfig {
  const AppConfig({
    this.host = defaultHost,
    this.apiKey,
    this.model,
    this.deviceId,
    this.deviceName,
    this.voiceReplies = true,
    this.allowInsecureWs = false,
  });

  static const defaultHost = '';
  static const heartbeatIntervalName = 'jarvis';
  static String? _storedDeviceId;

  final String host;
  final String? apiKey;
  final String? model;
  final String? deviceId;
  final String? deviceName;
  final bool voiceReplies;

  /// Opt-in for plain `ws://` on a trusted LAN. When false, only `wss://` is used.
  final bool allowInsecureWs;

  bool get isConfigured => apiKey != null && apiKey!.isNotEmpty && host.isNotEmpty;

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
    bool? allowInsecureWs,
    bool clearKey = false,
  }) {
    return AppConfig(
      host: host ?? this.host,
      apiKey: clearKey ? null : (apiKey ?? this.apiKey),
      model: model ?? this.model,
      deviceId: deviceId ?? this.deviceId,
      deviceName: deviceName ?? this.deviceName,
      voiceReplies: voiceReplies ?? this.voiceReplies,
      allowInsecureWs: allowInsecureWs ?? this.allowInsecureWs,
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
  static const _kAllowInsecureWs = 'jarvis.allow_insecure_ws';
  static const _secureStorage = FlutterSecureStorage();

  /// A locked or missing keyring (mostly Linux/libsecret) can block for the
  /// D-Bus timeout or wait on an unlock prompt; don't let that hold up startup.
  static const _secureStorageTimeout = Duration(seconds: 3);
  int _revision = 0;
  final Completer<void> _loaded = Completer<void>();

  /// Completes once persisted settings (including the device id) are loaded.
  Future<void> get loaded => _loaded.future;

  @override
  AppConfig build() {
    _load();
    return const AppConfig();
  }

  Future<void> _load() async {
    try {
      await _loadFromPrefs();
    } catch (e) {
      debugPrint('Jarvis: failed to load settings: $e');
    } finally {
      if (!_loaded.isCompleted) _loaded.complete();
    }
  }

  Future<void> _loadFromPrefs() async {
    final revision = _revision;
    final prefs = await SharedPreferences.getInstance();
    var deviceId = prefs.getString(_kDeviceId) ?? AppConfig._storedDeviceId;
    if (deviceId == null || deviceId.isEmpty) {
      deviceId = _generateId();
      await prefs.setString(_kDeviceId, deviceId);
    }
    AppConfig._storedDeviceId = deviceId;
    final host = prefs.getString(_kHost);
    var allowInsecureWs = prefs.getBool(_kAllowInsecureWs);
    final migrated = migrateAllowInsecureWs(savedHost: host, storedFlag: allowInsecureWs);
    if (migrated != null) {
      allowInsecureWs = migrated;
      await prefs.setBool(_kAllowInsecureWs, migrated);
    }
    if (revision != _revision) return;
    final apiKey = await _readApiKey(prefs);
    // The keystore read can take a while; don't clobber a save() made meanwhile.
    if (revision != _revision) return;
    state = AppConfig(
      host: host ?? AppConfig.defaultHost,
      apiKey: apiKey,
      model: prefs.getString(_kModel),
      deviceId: deviceId,
      deviceName: prefs.getString(_kDeviceName),
      voiceReplies: prefs.getBool(_kVoiceReplies) ?? true,
      allowInsecureWs: allowInsecureWs ?? false,
    );
  }

  Future<void> save({
    String? host,
    String? apiKey,
    String? model,
    String? deviceName,
    bool? voiceReplies,
    bool? allowInsecureWs,
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
      allowInsecureWs: allowInsecureWs ?? cfg.allowInsecureWs,
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kHost, state.host);
    if (apiKey != null) await _writeApiKey(prefs, apiKey);
    if (model != null) await prefs.setString(_kModel, model);
    if (deviceName != null) await prefs.setString(_kDeviceName, deviceName);
    if (voiceReplies != null) await prefs.setBool(_kVoiceReplies, voiceReplies);
    if (allowInsecureWs != null) await prefs.setBool(_kAllowInsecureWs, allowInsecureWs);
  }

  Future<void> clear() async {
    _revision++;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kHost);
    await prefs.remove(_kKey);
    try {
      await _secureStorage.delete(key: _kKey).timeout(_secureStorageTimeout);
    } catch (e) {
      debugPrint('Jarvis: could not clear API key from secure storage: $e');
    }
    await prefs.remove(_kModel);
    await prefs.remove(_kDeviceName);
    await prefs.remove(_kVoiceReplies);
    await prefs.remove(_kAllowInsecureWs);
    // jarvis.device_id stays in prefs, so keep using the same id in memory too.
    state = AppConfig(deviceId: state.deviceId ?? AppConfig._storedDeviceId);
  }

  /// Reads the API key from the platform keystore, migrating any key left in
  /// plaintext SharedPreferences by older versions.
  static Future<String?> _readApiKey(SharedPreferences prefs) async {
    final legacy = prefs.getString(_kKey);
    try {
      if (legacy != null) {
        // A key in preferences is either from an old version or was written
        // there because the keystore was unavailable at the time; either way
        // it's the newest one, so move it over.
        await _secureStorage.write(key: _kKey, value: legacy).timeout(_secureStorageTimeout);
        await prefs.remove(_kKey);
        return legacy;
      }
      return await _secureStorage.read(key: _kKey).timeout(_secureStorageTimeout);
    } catch (e) {
      // No usable keystore (e.g. Linux without a secret service, or a locked
      // keyring that timed out): keep the old behaviour.
      debugPrint('Jarvis: secure storage unavailable, using preferences: $e');
      return legacy;
    }
  }

  static Future<void> _writeApiKey(SharedPreferences prefs, String apiKey) async {
    try {
      await _secureStorage.write(key: _kKey, value: apiKey).timeout(_secureStorageTimeout);
      await prefs.remove(_kKey);
    } catch (e) {
      debugPrint('Jarvis: secure storage unavailable, using preferences: $e');
      await prefs.setString(_kKey, apiKey);
    }
  }

  static String _generateId() {
    final rng = Random.secure();
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
