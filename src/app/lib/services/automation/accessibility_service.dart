import 'package:flutter/services.dart';

class AccessibilityService {
  AccessibilityService._();

  static const _channel = MethodChannel('jarvis/accessibility');

  static Future<bool> isEnabled() async {
    try {
      return (await _channel.invokeMethod<bool>('isEnabled')) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> openSettings() async {
    try {
      await _channel.invokeMethod('openSettings');
    } catch (_) {}
  }

  static Future<List<Map<String, dynamic>>> readScreen() async {
    final raw = await _channel.invokeMethod<List<dynamic>>('readScreen');
    return (raw ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<bool> tapNode({String? viewId, String? text}) async {
    return (await _channel.invokeMethod<bool>('tapNode', {'viewId': viewId, 'text': text})) ?? false;
  }

  static Future<bool> tapAt(int x, int y) async {
    return (await _channel.invokeMethod<bool>('tapAt', {'x': x, 'y': y})) ?? false;
  }

  static Future<bool> typeText({String? viewId, String? text, required String value}) async {
    return (await _channel.invokeMethod<bool>('typeText', {'viewId': viewId, 'text': text, 'value': value})) ?? false;
  }

  static Future<bool> swipe(int x1, int y1, int x2, int y2, {int durationMs = 300}) async {
    return (await _channel.invokeMethod<bool>('swipe', {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'durationMs': durationMs})) ?? false;
  }

  static Future<bool> pressBack() async => (await _channel.invokeMethod<bool>('pressBack')) ?? false;

  static Future<bool> pressHome() async => (await _channel.invokeMethod<bool>('pressHome')) ?? false;

  static Future<bool> pressRecents() async => (await _channel.invokeMethod<bool>('pressRecents')) ?? false;
}
