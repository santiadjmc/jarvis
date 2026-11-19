import 'package:flutter_test/flutter_test.dart';
import 'package:jarvis/services/device_tools/device_tool_executor.dart';

void main() {
  group('normalizePhoneNumber', () {
    test('accepts common formats', () {
      expect(normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
      expect(normalizePhoneNumber('(555) 123-4567'), '5551234567');
      expect(normalizePhoneNumber('112'), '112');
    });

    test('accepts 00-prefixed international numbers', () {
      expect(normalizePhoneNumber('00 49 1512 3456 7890'), '0049151234567890');
    });

    test('strips a tel: prefix', () {
      expect(normalizePhoneNumber('tel:+1-555-123-4567'), '+15551234567');
      expect(normalizePhoneNumber('TEL:112'), '112');
    });

    test('accepts 2-digit service codes', () {
      expect(normalizePhoneNumber('17'), '17');
      expect(normalizePhoneNumber('1'), isNull);
    });

    test('keeps pause and extension characters only when allowed', () {
      expect(normalizePhoneNumber('+1 555 123 4567,,123', allowPauses: true), '+15551234567,,123');
      expect(normalizePhoneNumber('+1 555 123 4567;123', allowPauses: true), '+15551234567;123');
      expect(normalizePhoneNumber('tel:+15551234567;ext=42', allowPauses: true), '+15551234567,42');
      expect(normalizePhoneNumber('+1 555 123 4567,,123'), isNull);
    });

    test('rejects MMI/USSD codes and junk', () {
      expect(normalizePhoneNumber('*#06#'), isNull);
      expect(normalizePhoneNumber('*21*5551234567#', allowPauses: true), isNull);
      expect(normalizePhoneNumber('#31#5551234567'), isNull);
      expect(normalizePhoneNumber('call me'), isNull);
      expect(normalizePhoneNumber('+1555,abc', allowPauses: true), isNull);
    });
  });
}
