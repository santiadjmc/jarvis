import 'package:flutter_test/flutter_test.dart';
import 'package:jarvis/services/ws/connection_controller.dart';

void main() {
  const path = '/oauth/google/start?token=abc';

  test('bare LAN host in insecure mode resolves to http', () {
    expect(
      ConnectionController.serverUrl('192.168.1.2:3000', path, allowInsecure: true).toString(),
      'http://192.168.1.2:3000/oauth/google/start?token=abc',
    );
  });

  test('wss host resolves to https and keeps the proxy sub-path', () {
    expect(
      ConnectionController.serverUrl('wss://example.com/jarvis/', path, allowInsecure: false).toString(),
      'https://example.com/jarvis/oauth/google/start?token=abc',
    );
  });

  test('TLS mismatch detection', () {
    expect(ConnectionController.looksLikeTlsMismatch(const HandshakeLike()), isTrue);
    expect(ConnectionController.looksLikeTlsMismatch(Exception('Connection refused')), isFalse);
  });
}

class HandshakeLike implements Exception {
  const HandshakeLike();

  @override
  String toString() => 'HandshakeException: Handshake error in client (OS Error: WRONG_VERSION_NUMBER)';
}
