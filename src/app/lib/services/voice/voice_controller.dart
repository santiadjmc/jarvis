import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:whisper_ggml/whisper_ggml.dart';

enum VoiceStatus { idle, listening, transcribing, unavailable }

class VoiceState {
  const VoiceState({required this.status, this.transcript = '', this.error, this.soundLevel = 0});

  final VoiceStatus status;
  final String transcript;
  final String? error;
  final double soundLevel;

  VoiceState copyWith({
    VoiceStatus? status,
    String? transcript,
    String? error,
    double? soundLevel,
    bool clearError = false,
  }) {
    return VoiceState(
      status: status ?? this.status,
      transcript: transcript ?? this.transcript,
      error: clearError ? null : (error ?? this.error),
      soundLevel: soundLevel ?? this.soundLevel,
    );
  }
}

const _maxListenDuration = Duration(minutes: 2);
const _silenceStopDelay = Duration(seconds: 4);

class VoiceController extends Notifier<VoiceState> {
  SpeechToText? _stt;
  AudioRecorder? _recorder;
  WhisperController? _whisper;
  WhisperLiveSession? _liveSession;
  bool _nativeInitialized = false;
  void Function(String text)? _onFinal;
  StreamSubscription<Uint8List>? _audioStreamSub;
  Timer? _silenceTimer;
  Timer? _maxDurationTimer;

  @override
  VoiceState build() {
    ref.onDispose(() {
      _silenceTimer?.cancel();
      _maxDurationTimer?.cancel();
      unawaited(_audioStreamSub?.cancel());
      unawaited(_recorder?.dispose());
      unawaited(_stt?.stop());
      unawaited(_liveSession?.stop());
    });
    return const VoiceState(status: VoiceStatus.idle);
  }

  bool get _isNative => !kIsWeb && (Platform.isAndroid || Platform.isIOS);
  bool get _isWhisper => !kIsWeb && (Platform.isLinux);

  bool get supported => _isNative || _isWhisper;

  Future<void> start(void Function(String text) onFinal) async {
    _onFinal = onFinal;
    if (_isNative) {
      await _startNative();
    } else if (_isWhisper) {
      await _startWhisper();
    } else {
      state = const VoiceState(
        status: VoiceStatus.unavailable,
        error: 'Voice input is not supported on this platform yet.',
      );
    }
  }

  Future<void> stop() async {
    if (_isNative) {
      await _stopNative();
    } else if (_isWhisper) {
      await _stopAndTranscribeWhisper();
    }
  }

  Future<void> _startNative() async {
    _stt ??= SpeechToText();
    if (!_nativeInitialized) {
      final ok = await _stt!.initialize(
        onError: (e) => state = state.copyWith(
          status: e.permanent ? VoiceStatus.unavailable : VoiceStatus.idle,
          error: e.errorMsg,
          soundLevel: 0,
        ),
        onStatus: (status) {
          if ((status == 'notListening' || status == 'done') && state.status == VoiceStatus.listening) {
            state = state.copyWith(status: VoiceStatus.idle, soundLevel: 0, clearError: true);
          }
        },
      );
      if (!ok) {
        state = const VoiceState(
          status: VoiceStatus.unavailable,
          error: 'Speech recognition could not be initialized.',
        );
        return;
      }
      _nativeInitialized = true;
    }
    state = state.copyWith(status: VoiceStatus.listening, transcript: '', soundLevel: 0, clearError: true);
    await _stt!.listen(
      onResult: (result) {
        if (result.finalResult) {
          final text = result.recognizedWords.trim();
          state = const VoiceState(status: VoiceStatus.idle);
          if (text.isNotEmpty) _onFinal?.call(text);
        } else {
          state = state.copyWith(transcript: result.recognizedWords, clearError: true);
        }
      },
      onSoundLevelChange: (level) {
        if (state.status != VoiceStatus.listening) return;
        state = state.copyWith(soundLevel: (level / 10).clamp(0, 1).toDouble());
      },
      listenOptions: SpeechListenOptions(
        partialResults: true,
        onDevice: _isNative,
        listenMode: ListenMode.dictation,
        listenFor: _maxListenDuration,
        pauseFor: _silenceStopDelay,
      ),
    );
  }

  Future<void> _stopNative() async {
    if (_stt?.isListening ?? false) {
      await _stt!.stop();
    }
  }

  Future<void> _startWhisper() async {
    _recorder ??= AudioRecorder();
    _whisper ??= WhisperController();
    final permission = await _recorder!.hasPermission();
    if (!permission) {
      state = const VoiceState(
        status: VoiceStatus.unavailable,
        error: 'Microphone permission denied.',
      );
      return;
    }

    const model = WhisperModel.baseEn;
    String modelPath;
    try {
      modelPath = await _whisper!.downloadModel(model);
    } catch (e) {
      state = VoiceState(status: VoiceStatus.unavailable, error: 'Could not download speech model: $e');
      return;
    }

    final audioStream = await _recorder!.startStream(
      const RecordConfig(encoder: AudioEncoder.pcm16bits, sampleRate: 16000, numChannels: 1),
    );
    _liveSession = await startWhisperLiveSession(modelPath: modelPath, lang: 'auto');

    state = state.copyWith(status: VoiceStatus.listening, transcript: '', soundLevel: 0, clearError: true);

    _liveSession!.partials.listen((text) {
      if (state.status == VoiceStatus.listening) state = state.copyWith(transcript: text, clearError: true);
    });

    _audioStreamSub?.cancel();
    _audioStreamSub = audioStream.listen((chunk) {
      if (state.status != VoiceStatus.listening) return;
      _liveSession?.feed(chunk);

      final normalized = _pcm16Loudness(chunk);
      state = state.copyWith(soundLevel: normalized);
      if (normalized > 0.08) {
        _silenceTimer?.cancel();
        _silenceTimer = Timer(_silenceStopDelay, () {
          if (state.status == VoiceStatus.listening) _stopAndTranscribeWhisper();
        });
      }
    });

    _maxDurationTimer?.cancel();
    _maxDurationTimer = Timer(_maxListenDuration, () {
      if (state.status == VoiceStatus.listening) _stopAndTranscribeWhisper();
    });
  }

  static double _pcm16Loudness(Uint8List chunk) {
    if (chunk.length < 2) return 0;
    final data = ByteData.sublistView(chunk);
    final sampleCount = chunk.length ~/ 2;
    var sumSquares = 0.0;
    for (var i = 0; i < sampleCount; i++) {
      final sample = data.getInt16(i * 2, Endian.little);
      sumSquares += sample * sample;
    }
    final rms = sqrt(sumSquares / sampleCount);
    return (rms / 3000).clamp(0.0, 1.0);
  }

  Future<void> _stopAndTranscribeWhisper() async {
    final session = _liveSession;
    if (session == null) return;
    _liveSession = null;
    _silenceTimer?.cancel();
    _maxDurationTimer?.cancel();
    unawaited(_audioStreamSub?.cancel());
    try {
      await _recorder?.stop();
      state = state.copyWith(status: VoiceStatus.transcribing, soundLevel: 0);
      final text = (await session.stop()).trim();
      state = const VoiceState(status: VoiceStatus.idle);
      if (text.isNotEmpty) _onFinal?.call(text);
    } catch (e) {
      state = VoiceState(status: VoiceStatus.idle, error: 'Transcription failed: $e');
    }
  }
}

final voiceControllerProvider = NotifierProvider<VoiceController, VoiceState>(VoiceController.new);