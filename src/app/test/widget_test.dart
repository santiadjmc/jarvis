import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:jarvis/main.dart';

void main() {
  testWidgets('app boots to setup screen', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: JarvisApp()));
    await tester.pump();

    expect(find.text('JARVIS'), findsOneWidget);
    expect(find.text('Connect'), findsOneWidget);
  });
}