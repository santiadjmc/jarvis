import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
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
  void Function()? _onDrained;

  @override
  TtsState build() {
    ref.onDispose(() {
      _generation++;
      _player?.dispose();
    });
    return const TtsState();
  }

  void setOnDrained(void Function()? callback) {
    _onDrained = callback;
  }

  void enqueue(Uint8List wav, {bool isFinal = false}) {
    final gen = _generation;
    _queue = _queue.then((_) async {
      if (gen != _generation) return;
      if (wav.isNotEmpty) await _playOnce(wav);
      if (isFinal && gen == _generation) _onDrained?.call();
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
      await player.playerStateStream
          .firstWhere(
            (s) =>
                s.processingState == ProcessingState.completed ||
                s.processingState == ProcessingState.idle ||
                race != _generation,
          )
          .timeout(const Duration(seconds: 120));
    } catch (e) {
      debugPrint('Jarvis: TTS playback failed: $e');
    } finally {
      if (file != null) unawaited(file.delete().catchError((_) => file!));
      if (ref.mounted && race == _generation) state = const TtsState();
    }
  }
}

final ttsControllerProvider = NotifierProvider<TtsController, TtsState>(TtsController.new);