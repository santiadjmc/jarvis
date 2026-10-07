package com.jarvis.jarvis

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class JarvisAccessibilityService : AccessibilityService() {
    companion object {
        var instance: JarvisAccessibilityService? = null
        const val MAX_NODES = 400
        const val MAX_DEPTH = 40
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    fun readScreen(): List<Map<String, Any?>> {
        val root = rootInActiveWindow ?: return emptyList()
        val out = mutableListOf<Map<String, Any?>>()
        collectNodes(root, out, 0)
        return out
    }

    private fun collectNodes(node: AccessibilityNodeInfo, out: MutableList<Map<String, Any?>>, depth: Int) {
        if (depth > MAX_DEPTH || out.size >= MAX_NODES) return
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        if (!text.isNullOrBlank() || !desc.isNullOrBlank() || node.isClickable || node.isEditable) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            out.add(
                mapOf(
                    "text" to text,
                    "contentDescription" to desc,
                    "className" to node.className?.toString(),
                    "viewId" to node.viewIdResourceName,
                    "clickable" to node.isClickable,
                    "editable" to node.isEditable,
                    "bounds" to listOf(bounds.left, bounds.top, bounds.right, bounds.bottom),
                ),
            )
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectNodes(child, out, depth + 1)
        }
    }

    private fun findNode(node: AccessibilityNodeInfo, viewId: String?, text: String?): AccessibilityNodeInfo? {
        val textMatches = text != null && (
            node.text?.toString()?.contains(text, ignoreCase = true) == true ||
                node.contentDescription?.toString()?.contains(text, ignoreCase = true) == true
            )
        if ((viewId != null && node.viewIdResourceName == viewId) || (viewId == null && textMatches)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNode(child, viewId, text)
            if (found != null) return found
        }
        return null
    }

    fun tapNode(viewId: String?, text: String?): Boolean {
        val root = rootInActiveWindow ?: return false
        val target = findNode(root, viewId, text) ?: return false
        var node: AccessibilityNodeInfo? = target
        while (node != null) {
            if (node.isClickable) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            node = node.parent
        }
        return target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    fun tapAt(x: Int, y: Int): Boolean {
        val path = Path()
        path.moveTo(x.toFloat(), y.toFloat())
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun typeText(viewId: String?, text: String?, value: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val target = findNode(root, viewId, text) ?: return false
        val arguments = Bundle()
        arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        return target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long): Boolean {
        val path = Path()
        path.moveTo(x1.toFloat(), y1.toFloat())
        path.lineTo(x2.toFloat(), y2.toFloat())
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun pressBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)

    fun pressHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    fun pressRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)
}
