import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:porcupine_flutter/porcupine.dart';
import 'package:porcupine_flutter/porcupine_error.dart';
import 'package:porcupine_flutter/porcupine_manager.dart';

class WakeWordService {
  WakeWordService._();

  static PorcupineManager? _manager;
  static bool _starting = false;

  static bool get _supported => !kIsWeb && Platform.isAndroid;

  static Future<bool> start(String accessKey, void Function() onWakeWord) async {
    if (!_supported || accessKey.trim().isEmpty) return false;
    if (_manager != null || _starting) return true;
    _starting = true;
    try {
      _manager = await PorcupineManager.fromBuiltInKeywords(
        accessKey.trim(),
        [BuiltInKeyword.JARVIS],
        (_) => onWakeWord(),
        errorCallback: (PorcupineException error) {
          debugPrint('Jarvis: wake word error: ${error.message}');
        },
      );
      await _manager!.start();
      return true;
    } catch (e) {
      debugPrint('Jarvis: failed to start wake word listener: $e');
      _manager = null;
      return false;
    } finally {
      _starting = false;
    }
  }

  static Future<void> stop() async {
    final manager = _manager;
    _manager = null;
    if (manager == null) return;
    try {
      await manager.stop();
      await manager.delete();
    } catch (_) {}
  }

  static bool get isActive => _manager != null;
}
