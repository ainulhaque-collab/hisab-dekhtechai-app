import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundService } from '../services/soundService';

test('BUG-012: mute, bounded volume, independent haptics and failed playback do not throw', () => {
  const values = new Map<string, string>();
  const audio: Array<{ src: string; volume: number }> = [];
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
  } });
  class MockAudio {
    volume = 1; preload = ''; constructor(public src: string) { audio.push(this); }
    addEventListener() {} play() { return Promise.reject(new Error('Audio permission denied')); } pause() {}
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: MockAudio });
  try {
    soundService.setPreferences({ soundsEnabled: false, hapticsEnabled: false });
    assert.doesNotThrow(() => soundService.playTransactionSuccess('income')); assert.equal(audio.length, 0);
    soundService.setPreferences({ soundsEnabled: true, soundVolume: 0 }); soundService.playExpenseSound(); assert.equal(audio.length, 0);
    soundService.setPreferences({ soundVolume: 9 }); soundService.playTransferSound(); assert.equal(audio[0].volume, 1); assert.ok(audio[0].src.endsWith('/audio/transfer.wav'));
    values.set('hisab_sound_volume', 'NaN'); assert.equal(soundService.getPreferences().soundVolume, 0.7);
    assert.doesNotThrow(() => { for (let n = 0; n < 10; n++) soundService.playIncomeSound(); });
  } finally {
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio); else Reflect.deleteProperty(globalThis, 'Audio');
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
