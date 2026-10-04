import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:whisper_ggml/whisper_ggml.dart';

enum VoiceStatus { idle, listening, transcribing, unavailable }

class VoiceState {
  const VoiceState({required this.status, this.transcript = '', this.error});

  final VoiceStatus status;
  final String transcript;
  final String? error;

  VoiceState copyWith({VoiceStatus? status, String? transcript, String? error, bool clearError = false}) {
    return VoiceState(
      status: status ?? this.status,
      transcript: transcript ?? this.transcript,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class VoiceController extends Notifier<VoiceState> {
  SpeechToText? _stt;
  AudioRecorder? _recorder;
  WhisperController? _whisper;
  String? _recPath;
  bool _nativeInitialized = false;
  void Function(String text)? _onFinal;

  @override
  VoiceState build() => const VoiceState(status: VoiceStatus.idle);

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
        onError: (e) => state = state.copyWith(error: e.errorMsg),
        onStatus: (status) {
          if (status == 'notListening') {
            state = state.copyWith(status: VoiceStatus.idle, clearError: true);
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
      listenOptions: SpeechListenOptions(
        partialResults: true,
        onDevice: _isNative,
        listenMode: ListenMode.dictation,
      ),
    );
    state = state.copyWith(status: VoiceStatus.listening, transcript: '', clearError: true);
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
    final dir = await getTemporaryDirectory();
    _recPath = p.join(dir.path, 'jarvis_rec_${DateTime.now().millisecondsSinceEpoch}.wav');
    await _recorder!.start(
      const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000, numChannels: 1),
      path: _recPath!,
    );
    state = state.copyWith(status: VoiceStatus.listening, transcript: '', clearError: true);
  }

  Future<void> _stopAndTranscribeWhisper() async {
    final path = _recPath;
    if (path == null) return;
    try {
      await _recorder?.stop();
      state = state.copyWith(status: VoiceStatus.transcribing);
      final model = WhisperModel.baseEn;
      await _whisper!.downloadModel(model);
      final result = await _whisper!.transcribe(model: model, audioPath: path, lang: 'en');
      final text = result?.transcription.text.trim() ?? '';
      state = const VoiceState(status: VoiceStatus.idle);
      if (text.isNotEmpty) _onFinal?.call(text);
    } catch (e) {
      state = VoiceState(status: VoiceStatus.idle, error: 'Transcription failed: $e');
    }
  }
}

final voiceControllerProvider = NotifierProvider<VoiceController, VoiceState>(VoiceController.new);