import 'package:flutter/material.dart';

class JarvisColors {
  JarvisColors._();

  static const void_ = Color(0xFF0A0D12);
  static const panel = Color(0xFF131822);
  static const panelRaised = Color(0xFF1B2230);
  static const hairline = Color(0xFF293041);

  static const cyan = Color(0xFF5EE6F2);
  static const cyanDim = Color(0xFF2E7E88);
  static const amber = Color(0xFFF2A65E);
  static const signal = Color(0xFF5EF2B0);
  static const danger = Color(0xFFF2605E);

  static const ink = Color(0xFFE6EDF3);
  static const inkMuted = Color(0xFF8792A2);
  static const inkFaint = Color(0xFF4D5668);
}

class JarvisType {
  JarvisType._();

  static const display = 'Space Grotesk';
  static const mono = 'IBM Plex Mono';
}

ThemeData buildJarvisTheme() {
  final base = ThemeData.dark(useMaterial3: true);

  final textTheme = base.textTheme
      .apply(fontFamily: JarvisType.display, bodyColor: JarvisColors.ink, displayColor: JarvisColors.ink)
      .copyWith(
        titleLarge: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 20, letterSpacing: 0.2),
        titleMedium: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 16),
        bodyLarge: const TextStyle(fontFamily: JarvisType.display, fontSize: 15, height: 1.5),
        bodyMedium: const TextStyle(fontFamily: JarvisType.display, fontSize: 14, height: 1.45),
        labelLarge: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 14),
      );

  return base.copyWith(
    scaffoldBackgroundColor: JarvisColors.void_,
    colorScheme: base.colorScheme.copyWith(
      surface: JarvisColors.void_,
      primary: JarvisColors.cyan,
      secondary: JarvisColors.amber,
      error: JarvisColors.danger,
    ),
    textTheme: textTheme,
    appBarTheme: const AppBarTheme(
      backgroundColor: JarvisColors.void_,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: JarvisType.display,
        fontWeight: FontWeight.w600,
        fontSize: 17,
        letterSpacing: 1.5,
        color: JarvisColors.ink,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: JarvisColors.panel,
      hintStyle: const TextStyle(color: JarvisColors.inkFaint),
      labelStyle: const TextStyle(color: JarvisColors.inkMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: const BorderSide(color: JarvisColors.hairline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: const BorderSide(color: JarvisColors.hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(4),
        borderSide: const BorderSide(color: JarvisColors.cyan, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: JarvisColors.cyan,
        foregroundColor: JarvisColors.void_,
        textStyle: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 14),
        shape: const BeveledRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(6))),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: JarvisColors.ink,
        side: const BorderSide(color: JarvisColors.hairline),
        textStyle: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 14),
        shape: const BeveledRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(6))),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: JarvisColors.cyan,
        textStyle: const TextStyle(fontFamily: JarvisType.display, fontWeight: FontWeight.w600, fontSize: 13),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) =>
          states.contains(WidgetState.selected) ? JarvisColors.cyan : JarvisColors.inkMuted),
      trackColor: WidgetStateProperty.resolveWith((states) =>
          states.contains(WidgetState.selected) ? JarvisColors.cyanDim : JarvisColors.panelRaised),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    dividerTheme: const DividerThemeData(color: JarvisColors.hairline, space: 1),
    iconTheme: const IconThemeData(color: JarvisColors.inkMuted),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: JarvisColors.cyan),
  );
}

/// A panel shape with bevelled corners — the structural signature of Jarvis's
/// HUD language, used instead of Material's uniform rounded-rect everywhere.
class HudPanel extends StatelessWidget {
  const HudPanel({
    super.key,
    required this.child,
    this.color = JarvisColors.panel,
    this.borderColor = JarvisColors.hairline,
    this.accentColor,
    this.padding = const EdgeInsets.all(14),
    this.margin,
    this.bevel = 10,
  });

  final Widget child;
  final Color color;
  final Color borderColor;
  final Color? accentColor;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double bevel;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      decoration: ShapeDecoration(
        color: color,
        shape: BeveledRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(bevel)),
          side: BorderSide(color: accentColor ?? borderColor, width: accentColor != null ? 1.2 : 1),
        ),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

/// The reactor-core mark: Jarvis's one recurring, animated brand element.
/// Used at small sizes as an "alive" indicator (app bar) and large as the
/// focal mark on setup/empty states. Deliberately the only glowing element
/// in the interface — everything else stays quiet by comparison.
class ReactorCore extends StatefulWidget {
  const ReactorCore({
    super.key,
    this.size = 20,
    this.active = false,
    this.color = JarvisColors.cyan,
    this.icon,
  });

  final double size;
  final bool active;
  final Color color;
  final IconData? icon;

  @override
  State<ReactorCore> createState() => _ReactorCoreState();
}

class _ReactorCoreState extends State<ReactorCore> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = widget.active ? _controller.value : 0.0;
        final ringWidth = widget.size >= 48 ? 2.5 : 1.4;
        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: JarvisColors.void_.withValues(alpha: 0.5),
            border: Border.all(color: widget.color, width: ringWidth),
            boxShadow: [
              BoxShadow(
                color: widget.color.withValues(alpha: (widget.active ? 0.25 : 0.12) + t * 0.3),
                blurRadius: widget.size * (0.35 + t * 0.35),
                spreadRadius: widget.size * 0.02 + t * widget.size * 0.05,
              ),
            ],
          ),
          alignment: Alignment.center,
          child: widget.icon != null
              ? Icon(widget.icon, color: widget.color, size: widget.size * 0.45)
              : Container(
                  width: widget.size * 0.28,
                  height: widget.size * 0.28,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color),
                ),
        );
      },
    );
  }
}

/// A status dot + monospace label, for connection/latency/telemetry readouts.
class HudReadout extends StatelessWidget {
  const HudReadout({super.key, required this.label, this.color = JarvisColors.inkMuted, this.dot = true});

  final String label;
  final Color color;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (dot) ...[
          Container(width: 6, height: 6, decoration: BoxDecoration(shape: BoxShape.circle, color: color)),
          const SizedBox(width: 6),
        ],
        Text(label, style: TextStyle(fontFamily: JarvisType.mono, fontSize: 11.5, color: color, letterSpacing: 0.2)),
      ],
    );
  }
}
