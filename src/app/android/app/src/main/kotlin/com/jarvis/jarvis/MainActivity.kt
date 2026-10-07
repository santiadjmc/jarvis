package com.jarvis.jarvis

import android.content.Intent
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "jarvis/accessibility"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName).setMethodCallHandler { call, result ->
            val service = JarvisAccessibilityService.instance
            when (call.method) {
                "isEnabled" -> result.success(service != null)
                "openSettings" -> {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    result.success(null)
                }
                "readScreen" -> {
                    if (service == null) {
                        result.error("UNAVAILABLE", "Accessibility service is not enabled", null)
                    } else {
                        result.success(service.readScreen())
                    }
                }
                "tapNode" -> {
                    if (service == null) {
                        result.error("UNAVAILABLE", "Accessibility service is not enabled", null)
                    } else {
                        result.success(service.tapNode(call.argument("viewId"), call.argument("text")))
                    }
                }
                "tapAt" -> {
                    if (service == null) {
                        result.error("UNAVAILABLE", "Accessibility service is not enabled", null)
                    } else {
                        val x = call.argument<Int>("x") ?: 0
                        val y = call.argument<Int>("y") ?: 0
                        result.success(service.tapAt(x, y))
                    }
                }
                "typeText" -> {
                    if (service == null) {
                        result.error("UNAVAILABLE", "Accessibility service is not enabled", null)
                    } else {
                        val value = call.argument<String>("value") ?: ""
                        result.success(service.typeText(call.argument("viewId"), call.argument("text"), value))
                    }
                }
                "swipe" -> {
                    if (service == null) {
                        result.error("UNAVAILABLE", "Accessibility service is not enabled", null)
                    } else {
                        val x1 = call.argument<Int>("x1") ?: 0
                        val y1 = call.argument<Int>("y1") ?: 0
                        val x2 = call.argument<Int>("x2") ?: 0
                        val y2 = call.argument<Int>("y2") ?: 0
                        val durationMs = (call.argument<Int>("durationMs") ?: 300).toLong()
                        result.success(service.swipe(x1, y1, x2, y2, durationMs))
                    }
                }
                "pressBack" -> result.success(service?.pressBack() ?: false)
                "pressHome" -> result.success(service?.pressHome() ?: false)
                "pressRecents" -> result.success(service?.pressRecents() ?: false)
                else -> result.notImplemented()
            }
        }
    }
}
