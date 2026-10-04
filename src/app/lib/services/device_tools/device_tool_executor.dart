import 'dart:io' show Platform, Process;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';

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
  final caps = <String>['device:time', 'device:info', 'device:open_url', 'device:set_clipboard', 'device:get_clipboard'];
  if (deviceType == 'android' || deviceType == 'ios') {
    caps.add('device:vibrate');
  }
  if (deviceType != 'ios' && deviceType != 'web') {
    caps.add('device:run_command');
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