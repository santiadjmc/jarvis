import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

@pragma('vm:entry-point')
void jarvisForegroundTaskCallback() {
  FlutterForegroundTask.setTaskHandler(_JarvisTaskHandler());
}

class _JarvisTaskHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}

  @override
  void onNotificationButtonPressed(String id) {}

  @override
  void onNotificationPressed() {
    FlutterForegroundTask.launchApp('/');
  }

  @override
  void onNotificationDismissed() {}
}

class BackgroundConnectionService {
  BackgroundConnectionService._();

  static bool _initialized = false;

  static bool get _supported => !kIsWeb && Platform.isAndroid;

  static void init() {
    if (!_supported || _initialized) return;
    _initialized = true;
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'jarvis_connection',
        channelName: 'Jarvis connection',
        channelDescription: 'Keeps Jarvis connected in the background so it can reach this device anytime.',
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  static Future<void> requestPermissions() async {
    if (!_supported) return;
    final permission = await FlutterForegroundTask.checkNotificationPermission();
    if (permission != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }
  }

  static Future<void> start({required String text}) async {
    if (!_supported) return;
    init();
    try {
      if (await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.updateService(
          notificationTitle: 'Jarvis',
          notificationText: text,
        );
        return;
      }
      await FlutterForegroundTask.startService(
        serviceId: 821,
        notificationTitle: 'Jarvis',
        notificationText: text,
        callback: jarvisForegroundTaskCallback,
      );
    } catch (_) {}
  }

  static Future<void> stop() async {
    if (!_supported) return;
    try {
      await FlutterForegroundTask.stopService();
    } catch (_) {}
  }
}
