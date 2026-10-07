package com.jarvis.jarvis

import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    companion object {
        var pendingAssistantTrigger = false
    }

    private val channelName = "jarvis/accessibility"
    private val assistantChannelName = "jarvis/assistant"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        configureAssistantChannel(flutterEngine)
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

    private fun configureAssistantChannel(flutterEngine: FlutterEngine) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, assistantChannelName).setMethodCallHandler { call, result ->
            when (call.method) {
                "isSupported" -> result.success(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                "isDefaultAssistant" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val roleManager = getSystemService(RoleManager::class.java)
                        result.success(roleManager?.isRoleHeld(RoleManager.ROLE_ASSISTANT) ?: false)
                    } else {
                        result.success(false)
                    }
                }
                "requestDefaultAssistant" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val roleManager = getSystemService(RoleManager::class.java)
                        if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) {
                            startActivity(roleManager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT))
                        }
                    }
                    result.success(null)
                }
                "consumeAssistantTrigger" -> {
                    val triggered = pendingAssistantTrigger
                    pendingAssistantTrigger = false
                    result.success(triggered)
                }
                else -> result.notImplemented()
            }
        }
    }
}
