import { MAX_AUDIO_BYTES } from './media';

/** One short, user-started recording. No permission prompt on app/modal load. */
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
    this.stream = await this.getStream();
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
    } catch (error) { this.release(); throw error; }
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
