import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceCapture } from '../ai/voiceCapture';
import { aiErrorMessage } from '../ai/client';

function recording() {
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => { stops++; } }] } as unknown as MediaStream;
  const recorder: any = { state: 'inactive', mimeType: 'audio/webm', start() { this.state = 'recording'; },
    stop() { this.state = 'inactive'; queueMicrotask(() => {
      this.ondataavailable({ data: new Blob(['synthetic voice'], { type: this.mimeType }) }); this.onstop();
    }); } };
  return { stream, recorder, stopped: () => stops };
}

test('Voice recording starts only on request and stopping releases the microphone', async () => {
  const fake = recording(); let requests = 0, starts = 0;
  const capture = new VoiceCapture(async () => { requests++; return fake.stream; }, () => fake.recorder);
  assert.equal(requests, 0);
  const result = capture.start(() => { starts++; capture.stop(); });
  const blob = await result;
  assert.equal(requests, 1); assert.equal(starts, 1); assert.equal(blob.type, 'audio/webm');
  assert.equal(await blob.text(), 'synthetic voice'); assert.ok(fake.stopped() >= 1);
});

test('Closing while microphone permission is pending stops every track and discards recording', async () => {
  const fake = recording();
  let accept!: (stream: MediaStream) => void;
  const capture = new VoiceCapture(() => new Promise(resolve => { accept = resolve; }), () => fake.recorder);
  const result = capture.start(() => assert.fail('Cancelled recording must not start'));
  const rejected = assert.rejects(result, /AI_RECORDING_CANCELLED/);
  capture.cancel(); accept(fake.stream);
  await rejected; assert.ok(fake.stopped() >= 1); assert.equal(fake.recorder.state, 'inactive');
});

test('Closing an active recording rejects it and does not leave the microphone running', async () => {
  const fake = recording();
  const capture = new VoiceCapture(async () => fake.stream, () => fake.recorder);
  const result = capture.start(() => capture.cancel());
  await assert.rejects(result, /AI_RECORDING_CANCELLED/); assert.ok(fake.stopped() >= 1);
});

test('OS microphone denial, missing hardware and busy capture are safe actionable recording failures', async () => {
  for (const [name, code] of [['NotAllowedError', 'AI_MEDIA_PERMISSION_DENIED'], ['NotFoundError', 'AI_MICROPHONE_NOT_FOUND'],
    ['NotReadableError', 'AI_MICROPHONE_BUSY'], ['SecurityError', 'AI_MEDIA_PERMISSION_DENIED']] as const) {
    const capture = new VoiceCapture(async () => { throw new DOMException('private OS detail', name); });
    await assert.rejects(capture.start(() => assert.fail('must not record')), error => {
      assert.equal((error as Error).message, code);
      assert.doesNotMatch(aiErrorMessage(error, true), /temporarily unavailable|private OS/); return true;
    });
  }
});

test('Recorder construction failure releases every acquired microphone track', async () => {
  const fake = recording();
  const capture = new VoiceCapture(async () => fake.stream, () => { throw new DOMException('private codec detail', 'NotSupportedError'); });
  await assert.rejects(capture.start(() => assert.fail('must not start')), /AI_RECORDING_UNAVAILABLE/);
  assert.ok(fake.stopped() >= 1);
});

test('Closing while an OS microphone prompt later rejects remains cancellation', async () => {
  let deny!: (error: Error) => void;
  const capture = new VoiceCapture(() => new Promise((_resolve, reject) => { deny = reject; }));
  const result = capture.start(() => assert.fail('must not start'));
  const rejected = assert.rejects(result, /AI_RECORDING_CANCELLED/);
  capture.cancel(); deny(new DOMException('private prompt detail', 'NotAllowedError')); await rejected;
});
