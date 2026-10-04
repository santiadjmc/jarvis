import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

enum TtsStatus { idle, playing }

class TtsState {
  const TtsState({this.status = TtsStatus.idle});

  final TtsStatus status;
}

class TtsController extends Notifier<TtsState> {
  AudioPlayer? _player;
  Future<void> _queue = Future<void>.value();
  int _generation = 0;

  @override
  TtsState build() {
    ref.onDispose(() {
      _generation++;
      _player?.dispose();
    });
    return const TtsState();
  }

  void enqueue(Uint8List wav) {
    final gen = _generation;
    _queue = _queue.then((_) async {
      if (gen != _generation) return;
      if (wav.isEmpty) return;
      await _playOnce(wav);
    });
  }

  void clear() {
    _generation++;
    _queue = Future<void>.value();
    _player?.stop();
    state = const TtsState();
  }

  Future<void> _playOnce(Uint8List wav) async {
    final race = _generation;
    File? file;
    try {
      final dir = await getTemporaryDirectory();
      file = File(p.join(dir.path, 'tts_${DateTime.now().microsecondsSinceEpoch}.wav'));
      await file.writeAsBytes(wav, flush: true);
      if (race != _generation) return;
      final player = _player ??= AudioPlayer();
      await player.setAudioSource(AudioSource.uri(Uri.file(file.path)));
      state = const TtsState(status: TtsStatus.playing);
      await player.play();
    } catch (_) {
    } finally {
      if (file != null) unawaited(file.delete());
      if (ref.mounted) state = const TtsState();
    }
  }
}

final ttsControllerProvider = NotifierProvider<TtsController, TtsState>(TtsController.new);