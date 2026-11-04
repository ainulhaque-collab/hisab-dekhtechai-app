import { MAX_AUDIO_BYTES } from './media';

function captureFailure(error: unknown, fallback: string): Error {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error ? error.message : '';
  if (['AI_RECORDING_CANCELLED', 'AI_RECORDING_FAILED', 'AI_AUDIO_INVALID'].includes(code)) return new Error(code);
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) return new Error('AI_MEDIA_PERMISSION_DENIED');
  if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) return new Error('AI_MICROPHONE_NOT_FOUND');
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) return new Error('AI_MICROPHONE_BUSY');
  if (name === 'NotSupportedError') return new Error('AI_RECORDING_UNAVAILABLE');
  return new Error(fallback);
}

/** One short, user-started recording. Never starts a sensor on app/modal load. */
export class VoiceCapture {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private cancelled = false;
  private started = false;
  private rejectRecording?: (reason: Error) => void;
  constructor(private getStream = () => navigator.mediaDevices.getUserMedia({ audio: true }),
    private makeRecorder = (stream: MediaStream) => new MediaRecorder(stream)) {}

  async start(onStarted: () => void): Promise<Blob> {
    if (this.cancelled || this.started) throw new Error('AI_RECORDING_CANCELLED');
    this.started = true;
    try { this.stream = await this.getStream(); }
    catch (failure) { throw this.cancelled ? new Error('AI_RECORDING_CANCELLED') : captureFailure(failure, 'AI_RECORDING_FAILED'); }
    if (this.cancelled) { this.release(); throw new Error('AI_RECORDING_CANCELLED'); }
    try {
      this.recorder = this.makeRecorder(this.stream);
      return await new Promise<Blob>((resolve, reject) => {
        const chunks: Blob[] = []; let size = 0, tooLarge = false;
        this.rejectRecording = reject;
        this.recorder!.ondataavailable = event => {
          size += event.data.size;
          if (size > MAX_AUDIO_BYTES) { tooLarge = true; this.stop(); }
          else if (event.data.size) chunks.push(event.data);
        };
        this.recorder!.onerror = () => { this.release(); reject(new Error('AI_RECORDING_FAILED')); };
        this.recorder!.onstop = () => {
          const mime = this.recorder?.mimeType || chunks[0]?.type || '';
          this.release();
          if (this.cancelled) reject(new Error('AI_RECORDING_CANCELLED'));
          else if (tooLarge || !size || !chunks.length) reject(new Error('AI_AUDIO_INVALID'));
          else resolve(new Blob(chunks, { type: mime }));
        };
        this.recorder!.start(1000);
        this.timer = setTimeout(() => this.stop(), 45_000);
        onStarted();
      });
    } catch (error) { this.release(); throw captureFailure(error, 'AI_RECORDING_FAILED'); }
  }
  stop() { if (this.recorder?.state === 'recording' || this.recorder?.state === 'paused') this.recorder.stop(); }
  cancel() {
    this.cancelled = true;
    this.stop(); this.release();
    this.rejectRecording?.(new Error('AI_RECORDING_CANCELLED'));
  }
  private release() {
    if (this.timer) clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
  }
}
