/// One-time settings upgrades. Kept free of Flutter plugins so they can be
/// unit-tested on their own.
library;

/// Decides the "Insecure LAN (ws://)" flag for installs that predate it.
///
/// Older versions always connected over plain `ws://`, and the setup screen
/// suggested entering just `192.168.1.2:3000`. Once the flag has been saved
/// ([storedFlag] is non-null) it is left alone. Otherwise:
/// - a saved host with no scheme, or with `ws://` / `http://`, keeps working
///   by turning insecure mode on;
/// - a saved `wss://` / `https://` host keeps it off;
/// - no saved host (fresh install) keeps the secure default.
///
/// Returns the flag to persist, or null when nothing needs migrating.
bool? migrateAllowInsecureWs({required String? savedHost, required bool? storedFlag}) {
  if (storedFlag != null) return null;
  final host = savedHost?.trim() ?? '';
  if (host.isEmpty) return null;
  final match = RegExp(r'^([a-zA-Z][a-zA-Z0-9+.-]*)://').firstMatch(host);
  if (match == null) return true;
  return switch (match.group(1)!.toLowerCase()) {
    'ws' || 'http' => true,
    'wss' || 'https' => false,
    _ => null,
  };
}
