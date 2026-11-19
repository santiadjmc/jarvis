import 'package:flutter_test/flutter_test.dart';
import 'package:jarvis/core/settings_migration.dart';

void main() {
  group('migrateAllowInsecureWs', () {
    bool? migrate(String? host, [bool? stored]) => migrateAllowInsecureWs(savedHost: host, storedFlag: stored);

    test('turns insecure mode on for hosts saved without a scheme', () {
      expect(migrate('192.168.1.2:3000'), isTrue);
      expect(migrate('  jarvis.local:3000 '), isTrue);
    });

    test('turns insecure mode on for ws:// and http:// hosts', () {
      expect(migrate('ws://192.168.1.2:3000'), isTrue);
      expect(migrate('HTTP://192.168.1.2:3000/'), isTrue);
    });

    test('keeps insecure mode off for wss:// and https:// hosts', () {
      expect(migrate('wss://jarvis.example.com'), isFalse);
      expect(migrate('https://example.com/jarvis'), isFalse);
    });

    test('does nothing for fresh installs', () {
      expect(migrate(null), isNull);
      expect(migrate(''), isNull);
    });

    test('never overrides a flag the user already saved', () {
      expect(migrate('192.168.1.2:3000', false), isNull);
      expect(migrate('wss://example.com', true), isNull);
    });

    test('leaves unknown schemes to the connection error path', () {
      expect(migrate('ftp://example.com'), isNull);
    });
  });
}
