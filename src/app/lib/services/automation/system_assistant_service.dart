import 'package:flutter/services.dart';

class SystemAssistantService {
  SystemAssistantService._();

  static const _channel = MethodChannel('jarvis/assistant');

  static Future<bool> isSupported() async {
    try {
      return (await _channel.invokeMethod<bool>('isSupported')) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> isDefaultAssistant() async {
    try {
      return (await _channel.invokeMethod<bool>('isDefaultAssistant')) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> requestDefaultAssistant() async {
    try {
      await _channel.invokeMethod('requestDefaultAssistant');
    } catch (_) {}
  }

  static Future<bool> consumeAssistantTrigger() async {
    try {
      return (await _channel.invokeMethod<bool>('consumeAssistantTrigger')) ?? false;
    } catch (_) {
      return false;
    }
  }
}
