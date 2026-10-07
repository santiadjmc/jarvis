import 'dart:io' show Platform, Process;

import 'package:battery_plus/battery_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_phone_dialer/flutter_phone_dialer.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:installed_apps/installed_apps.dart';
import 'package:telephony_sms/telephony_sms.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../automation/accessibility_service.dart';

const _telephonySms = TelephonySMS();

final _localNotifications = FlutterLocalNotificationsPlugin();
bool _notificationsInitialized = false;
int _notificationId = 0;

Future<void> _ensureNotificationsInitialized() async {
  if (_notificationsInitialized) return;
  _notificationsInitialized = true;
  await _localNotifications.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      linux: LinuxInitializationSettings(defaultActionName: 'Open Jarvis'),
    ),
  );
}

class DeviceToolResult {
  const DeviceToolResult({required this.success, this.data, this.error, this.executionTimeMs});

  final bool success;
  final Object? data;
  final String? error;
  final int? executionTimeMs;

  Map<String, dynamic> toJson() => {
        'success': success,
        if (data != null) 'data': data,
        if (error != null) 'error': error,
        if (executionTimeMs != null) 'executionTimeMs': executionTimeMs,
      };

  factory DeviceToolResult.failure(String error, {int? ms}) =>
      DeviceToolResult(success: false, error: error, executionTimeMs: ms);
}

class DeviceMeta {
  const DeviceMeta({
    required this.deviceId,
    required this.deviceName,
    required this.deviceType,
    required this.capabilities,
    this.model,
    this.manufacturer,
    this.osVersion,
  });

  final String deviceId;
  final String deviceName;
  final String deviceType;
  final List<String> capabilities;
  final String? model;
  final String? manufacturer;
  final String? osVersion;

  Map<String, dynamic> toJson() => {
        'deviceId': deviceId,
        'deviceName': deviceName,
        'deviceType': deviceType,
        'capabilities': capabilities,
        if (model != null) 'model': model,
        if (manufacturer != null) 'manufacturer': manufacturer,
        if (osVersion != null) 'osVersion': osVersion,
      };
}

List<String> capabilitiesFor(String deviceType) {
  final caps = <String>[
    'device:time',
    'device:info',
    'device:open_url',
    'device:set_clipboard',
    'device:get_clipboard',
    'device:show_notification',
  ];
  if (deviceType == 'android' || deviceType == 'ios') {
    caps.add('device:vibrate');
  }
  if (deviceType != 'ios' && deviceType != 'web') {
    caps.add('device:run_command');
  }
  if (deviceType == 'android' || deviceType == 'ios' || deviceType == 'linux' || deviceType == 'windows' || deviceType == 'macos') {
    caps.add('device:get_battery');
  }
  if (deviceType == 'android' || deviceType == 'ios' || deviceType == 'linux' || deviceType == 'windows' || deviceType == 'macos') {
    caps.add('device:get_location');
  }
  caps.add('device:play_music');
  if (deviceType == 'android') {
    caps.addAll(const [
      'device:list_contacts',
      'device:launch_app',
      'device:list_installed_apps',
      'device:call_number',
      'device:send_sms',
      'device:accessibility_status',
      'device:read_screen',
      'device:tap',
      'device:type_text',
      'device:swipe',
      'device:navigate',
      'device:send_whatsapp_message',
    ]);
  }
  return caps;
}

class DeviceToolExecutor {
  DeviceToolExecutor._();

  static final DeviceToolExecutor instance = DeviceToolExecutor._();

  Future<DeviceMeta> buildMeta(AppConfig config) async {
    String? model;
    String? manufacturer;
    String? osVersion;
    try {
      final info = await DeviceInfoPlugin().deviceInfo;
      if (info is AndroidDeviceInfo) {
        model = info.model;
        manufacturer = info.manufacturer;
        osVersion = info.version.release;
      } else if (info is IosDeviceInfo) {
        model = info.utsname.machine;
        manufacturer = 'Apple';
        osVersion = info.systemVersion;
      } else if (info is LinuxDeviceInfo) {
        model = info.machineId;
        manufacturer = 'Linux';
        osVersion = info.prettyName;
      } else if (info is WindowsDeviceInfo) {
        manufacturer = 'Windows';
        osVersion = info.computerName;
      } else if (info is MacOsDeviceInfo) {
        manufacturer = 'macOS';
        osVersion = info.computerName;
      }
    } catch (_) {}
    final type = config.deviceType;
    return DeviceMeta(
      deviceId: config.effectiveDeviceId,
      deviceName: config.effectiveDeviceName,
      deviceType: type,
      capabilities: capabilitiesFor(type),
      model: model?.toString(),
      manufacturer: manufacturer?.toString(),
      osVersion: osVersion?.toString(),
    );
  }

  Future<DeviceToolResult> execute(String tool, Map<String, dynamic> params, AppConfig config) async {
    final sw = Stopwatch()..start();
    try {
      final Future<DeviceToolResult> result = switch (tool) {
        'device_get_time' => _getTime(),
        'device_get_info' => _getInfo(config),
        'device_get_clipboard' => _getClipboard(),
        'device_set_clipboard' => _setClipboard(params),
        'device_open_url' => _openUrl(params),
        'device_vibrate' => _vibrate(),
        'device_show_notification' => _showNotification(params),
        'device_get_battery' => _getBattery(),
        'device_get_location' => _getLocation(),
        'device_list_contacts' => _listContacts(params),
        'device_launch_app' => _launchApp(params),
        'device_list_installed_apps' => _listInstalledApps(params),
        'device_play_music' => _playMusic(params),
        'device_call_number' => _callNumber(params),
        'device_send_sms' => _sendSms(params),
        'device_accessibility_status' => _accessibilityStatus(),
        'device_read_screen' => _readScreen(),
        'device_tap' => _tap(params),
        'device_type_text' => _typeTextOnScreen(params),
        'device_swipe' => _swipe(params),
        'device_navigate' => _navigate(params),
        'device_send_whatsapp_message' => _sendWhatsappMessage(params),
        'device_run_command' => _runCommand(params),
        _ => Future.value(DeviceToolResult.failure('Unknown device tool: $tool')),
      };
      final resolved = await result;
      return DeviceToolResult(success: resolved.success, data: resolved.data, error: resolved.error, executionTimeMs: sw.elapsedMilliseconds);
    } catch (e) {
      return DeviceToolResult.failure('$e', ms: sw.elapsedMilliseconds);
    }
  }

  Future<DeviceToolResult> _getTime() async {
    final now = DateTime.now();
    return DeviceToolResult(success: true, data: {
      'iso': now.toIso8601String(),
      'unixMs': now.millisecondsSinceEpoch,
      'local': '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}',
      'date': '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}',
      'timezone': now.timeZoneName,
      'timezoneOffsetMinutes': now.timeZoneOffset.inMinutes,
    });
  }

  Future<DeviceToolResult> _getInfo(AppConfig config) async {
    final meta = await buildMeta(config);
    final views = WidgetsBinding.instance.platformDispatcher.views;
    final view = views.isEmpty ? null : views.first;
    final size = view?.physicalSize;
    final dpr = view?.devicePixelRatio;
    return DeviceToolResult(success: true, data: {
      ...meta.toJson(),
      if (size != null) 'screen': {'widthPx': size.width, 'heightPx': size.height, 'scale': dpr},
    });
  }

  Future<DeviceToolResult> _getClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text ?? '';
    return DeviceToolResult(success: true, data: {'text': text, 'isEmpty': text.isEmpty});
  }

  Future<DeviceToolResult> _setClipboard(Map<String, dynamic> params) async {
    final text = (params['text'] as String?) ?? '';
    if (text.isEmpty) return DeviceToolResult.failure('text is required');
    await Clipboard.setData(ClipboardData(text: text));
    return DeviceToolResult(success: true, data: {'copiedChars': text.length});
  }

  Future<DeviceToolResult> _openUrl(Map<String, dynamic> params) async {
    final url = (params['url'] as String?) ?? '';
    final parsed = Uri.tryParse(url);
    if (parsed == null || !(parsed.scheme == 'https' || parsed.scheme == 'http')) {
      return DeviceToolResult.failure('Only http(s) URLs are supported');
    }
    final ok = await launchUrl(parsed, mode: LaunchMode.externalApplication);
    return ok ? const DeviceToolResult(success: true) : DeviceToolResult.failure('Could not open $url');
  }

  Future<DeviceToolResult> _vibrate() async {
    await HapticFeedback.mediumImpact();
    return const DeviceToolResult(success: true);
  }

  Future<DeviceToolResult> _showNotification(Map<String, dynamic> params) async {
    final title = (params['title'] as String?) ?? '';
    final body = (params['body'] as String?) ?? '';
    if (title.isEmpty && body.isEmpty) return DeviceToolResult.failure('title or body is required');
    try {
      await _ensureNotificationsInitialized();
      await _localNotifications.show(
        id: _notificationId++,
        title: title,
        body: body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            'jarvis_alerts',
            'Jarvis alerts',
            channelDescription: 'Notifications Jarvis sends you proactively',
            importance: Importance.high,
            priority: Priority.high,
          ),
          linux: LinuxNotificationDetails(),
        ),
      );
      return const DeviceToolResult(success: true);
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _getBattery() async {
    try {
      final battery = Battery();
      final level = await battery.batteryLevel;
      final state = await battery.batteryState;
      return DeviceToolResult(success: true, data: {
        'level': level,
        'state': state.name,
        'charging': state == BatteryState.charging || state == BatteryState.full,
      });
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _getLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return DeviceToolResult.failure('Location services are disabled on this device');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        return DeviceToolResult.failure('Location permission denied');
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 15)),
      );
      return DeviceToolResult(success: true, data: {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'accuracyMeters': position.accuracy,
        'timestamp': position.timestamp.toIso8601String(),
      });
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _listContacts(Map<String, dynamic> params) async {
    try {
      final permission = await FlutterContacts.permissions.request(PermissionType.read);
      if (permission != PermissionStatus.granted && permission != PermissionStatus.limited) {
        return DeviceToolResult.failure('Contacts permission denied');
      }
      final query = (params['query'] as String?)?.trim() ?? '';
      final contacts = await FlutterContacts.getAll(
        properties: {ContactProperty.phone},
        filter: query.isNotEmpty ? ContactFilter.name(query) : null,
      );
      final results = contacts.take(50).map((c) => {
            'name': c.displayName,
            'phones': c.phones.map((p) => p.number).toList(),
          }).toList();
      return DeviceToolResult(success: true, data: {'count': results.length, 'contacts': results});
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _launchApp(Map<String, dynamic> params) async {
    final app = (params['app'] as String?)?.trim() ?? '';
    if (app.isEmpty) return DeviceToolResult.failure('app is required');
    try {
      final direct = await InstalledApps.startApp(app);
      if (direct == true) return DeviceToolResult(success: true, data: {'launched': app, 'via': 'package_name'});

      final apps = await InstalledApps.getInstalledApps();
      final match = apps.cast<AppInfo?>().firstWhere(
            (a) => a!.name.toLowerCase().contains(app.toLowerCase()),
            orElse: () => null,
          );
      if (match == null) return DeviceToolResult.failure('No installed app found matching "$app"');
      final launched = await InstalledApps.startApp(match.packageName);
      return launched == true
          ? DeviceToolResult(success: true, data: {'launched': match.name, 'packageName': match.packageName, 'via': 'name_match'})
          : DeviceToolResult.failure('Found "${match.name}" but could not launch it');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _listInstalledApps(Map<String, dynamic> params) async {
    try {
      final query = (params['query'] as String?)?.trim().toLowerCase() ?? '';
      final apps = await InstalledApps.getInstalledApps();
      final filtered = query.isEmpty ? apps : apps.where((a) => a.name.toLowerCase().contains(query)).toList();
      final results = filtered.map((a) => {'name': a.name, 'packageName': a.packageName}).toList();
      return DeviceToolResult(success: true, data: {'count': results.length, 'apps': results});
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _playMusic(Map<String, dynamic> params) async {
    final query = (params['query'] as String?)?.trim() ?? '';
    if (query.isEmpty) return DeviceToolResult.failure('query is required');
    final app = (params['app'] as String?)?.trim().toLowerCase();
    final encoded = Uri.encodeComponent(query);

    Future<bool> tryLaunch(Uri uri) async {
      try {
        if (!await canLaunchUrl(uri)) return false;
        return await launchUrl(uri, mode: LaunchMode.externalApplication);
      } catch (_) {
        return false;
      }
    }

    if (app != 'youtube_music') {
      final spotifyOk = await tryLaunch(Uri.parse('spotify:search:$encoded'));
      if (spotifyOk) return DeviceToolResult(success: true, data: {'query': query, 'app': 'spotify'});
      if (app == 'spotify') return DeviceToolResult.failure('Spotify is not installed or could not handle the request');
    }

    final ytOk = await tryLaunch(Uri.parse('https://music.youtube.com/search?q=$encoded'));
    return ytOk
        ? DeviceToolResult(success: true, data: {'query': query, 'app': 'youtube_music'})
        : DeviceToolResult.failure('Could not open a music app for "$query"');
  }

  Future<DeviceToolResult> _callNumber(Map<String, dynamic> params) async {
    final number = (params['number'] as String?)?.trim() ?? '';
    if (number.isEmpty) return DeviceToolResult.failure('number is required');
    try {
      final called = await FlutterPhoneDialer.callNumber(number);
      return called
          ? DeviceToolResult(success: true, data: {'calling': number})
          : DeviceToolResult.failure('Call permission denied or could not be placed');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _sendSms(Map<String, dynamic> params) async {
    final number = (params['number'] as String?)?.trim() ?? '';
    final message = (params['message'] as String?) ?? '';
    if (number.isEmpty) return DeviceToolResult.failure('number is required');
    if (message.isEmpty) return DeviceToolResult.failure('message is required');
    try {
      if (!await _telephonySms.requestPermission()) {
        return DeviceToolResult.failure('SMS permission denied');
      }
      await _telephonySms.sendSMS(phone: number, message: message);
      return DeviceToolResult(success: true, data: {'to': number, 'sentChars': message.length});
    } on TelephonySmsException catch (e) {
      return DeviceToolResult.failure(e.toString());
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _accessibilityStatus() async {
    final enabled = await AccessibilityService.isEnabled();
    if (!enabled) {
      await AccessibilityService.openSettings();
      return const DeviceToolResult(success: true, data: {
        'enabled': false,
        'openedSettings': true,
        'note': 'Opened Settings for the user to enable the Jarvis accessibility service by hand (Android requires manual approval for this).',
      });
    }
    return const DeviceToolResult(success: true, data: {'enabled': true});
  }

  Future<DeviceToolResult> _requireAccessibility() async {
    if (await AccessibilityService.isEnabled()) return const DeviceToolResult(success: true);
    return DeviceToolResult.failure(
      'The accessibility service is not enabled. Call device_accessibility_status to prompt the user to enable it in Settings, then try again.',
    );
  }

  Future<DeviceToolResult> _readScreen() async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    try {
      final nodes = await AccessibilityService.readScreen();
      return DeviceToolResult(success: true, data: {'count': nodes.length, 'elements': nodes});
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _tap(Map<String, dynamic> params) async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    final text = params['text'] as String?;
    final x = (params['x'] as num?)?.toInt();
    final y = (params['y'] as num?)?.toInt();
    try {
      final ok = (x != null && y != null)
          ? await AccessibilityService.tapAt(x, y)
          : await AccessibilityService.tapNode(text: text);
      return ok ? const DeviceToolResult(success: true) : DeviceToolResult.failure('Could not find or tap the target element');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _typeTextOnScreen(Map<String, dynamic> params) async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    final text = params['text'] as String?;
    final value = (params['value'] as String?) ?? '';
    if (value.isEmpty) return DeviceToolResult.failure('value is required');
    try {
      final ok = await AccessibilityService.typeText(text: text, value: value);
      return ok ? const DeviceToolResult(success: true) : DeviceToolResult.failure('Could not find the target input field');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _swipe(Map<String, dynamic> params) async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    final x1 = (params['x1'] as num?)?.toInt();
    final y1 = (params['y1'] as num?)?.toInt();
    final x2 = (params['x2'] as num?)?.toInt();
    final y2 = (params['y2'] as num?)?.toInt();
    if (x1 == null || y1 == null || x2 == null || y2 == null) return DeviceToolResult.failure('x1, y1, x2, y2 are required');
    try {
      final ok = await AccessibilityService.swipe(x1, y1, x2, y2);
      return ok ? const DeviceToolResult(success: true) : DeviceToolResult.failure('Swipe gesture could not be dispatched');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _navigate(Map<String, dynamic> params) async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    final action = (params['action'] as String?) ?? '';
    try {
      final ok = switch (action) {
        'back' => await AccessibilityService.pressBack(),
        'home' => await AccessibilityService.pressHome(),
        'recents' => await AccessibilityService.pressRecents(),
        _ => false,
      };
      if (action != 'back' && action != 'home' && action != 'recents') {
        return DeviceToolResult.failure("action must be 'back', 'home', or 'recents'");
      }
      return ok ? const DeviceToolResult(success: true) : DeviceToolResult.failure('Navigation action failed');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _sendWhatsappMessage(Map<String, dynamic> params) async {
    final gate = await _requireAccessibility();
    if (!gate.success) return gate;
    final number = (params['number'] as String?)?.replaceAll(RegExp(r'[^\d+]'), '') ?? '';
    final message = (params['message'] as String?) ?? '';
    if (number.isEmpty) return DeviceToolResult.failure('number is required');
    if (message.isEmpty) return DeviceToolResult.failure('message is required');
    try {
      final uri = Uri.parse('https://wa.me/${number.replaceAll('+', '')}?text=${Uri.encodeComponent(message)}');
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        return DeviceToolResult.failure('Could not open WhatsApp');
      }
      await Future<void>.delayed(const Duration(milliseconds: 2500));
      var sent = await AccessibilityService.tapNode(viewId: 'com.whatsapp:id/send');
      if (!sent) sent = await AccessibilityService.tapNode(text: 'Send');
      return sent
          ? DeviceToolResult(success: true, data: {'to': number, 'sentChars': message.length})
          : DeviceToolResult.failure('Opened WhatsApp with the message ready but could not find/tap the Send button');
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }

  Future<DeviceToolResult> _runCommand(Map<String, dynamic> params) async {
    final command = (params['command'] as String?) ?? '';
    if (command.trim().isEmpty) return DeviceToolResult.failure('command is required');
    const timeout = Duration(seconds: 30);
    try {
      final shell = Platform.isAndroid ? '/system/bin/sh' : 'sh';
      final process = await Process.run(shell, ['-c', command]).timeout(timeout);
      return DeviceToolResult(success: true, data: {
        'exitCode': process.exitCode,
        'stdout': (process.stdout as String).trim(),
        'stderr': (process.stderr as String).trim(),
      });
    } catch (e) {
      return DeviceToolResult.failure('$e');
    }
  }
}

final deviceToolExecutorProvider = Provider<DeviceToolExecutor>((ref) => DeviceToolExecutor.instance);