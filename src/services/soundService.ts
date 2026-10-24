/**
 * Transaction Sound Effects & Haptics Engine
 * Provides subtle, offline synthesized audio confirmations using Web Audio API:
 * 1. Income / Cash In: Bright, positive major-chord confirmation chime
 * 2. Expense / Cash Out: Soft, neutral tactile confirmation tick
 * 3. Transfer: Smooth two-tone movement chime
 *
 * Requirements:
 * - 100% offline, 0 network dependencies, 0 external audio files.
 * - Silent failures: Audio/haptic errors NEVER block financial commits.
 * - Respects user preferences: Sounds On/Off, Volume, Haptics On/Off.
 */

export interface SoundPreferences {
  soundsEnabled: boolean;
  soundVolume: number; // 0.0 to 1.0
  hapticsEnabled: boolean;
}

const PREF_KEY_SOUNDS = 'hisab_sounds_enabled';
const PREF_KEY_VOLUME = 'hisab_sound_volume';
const PREF_KEY_HAPTICS = 'hisab_haptics_enabled';

class SoundService {
  private audioCtx: AudioContext | null = null;

  public getPreferences(): SoundPreferences {
    if (typeof localStorage === 'undefined') {
      return { soundsEnabled: true, soundVolume: 0.7, hapticsEnabled: true };
    }
    const sounds = localStorage.getItem(PREF_KEY_SOUNDS);
    const volume = localStorage.getItem(PREF_KEY_VOLUME);
    const haptics = localStorage.getItem(PREF_KEY_HAPTICS);

    return {
      soundsEnabled: sounds !== null ? sounds === 'true' : true,
      soundVolume: volume !== null ? parseFloat(volume) : 0.7,
      hapticsEnabled: haptics !== null ? haptics === 'true' : true,
    };
  }

  public setPreferences(prefs: Partial<SoundPreferences>): void {
    if (typeof localStorage === 'undefined') return;
    if (prefs.soundsEnabled !== undefined) {
      localStorage.setItem(PREF_KEY_SOUNDS, String(prefs.soundsEnabled));
    }
    if (prefs.soundVolume !== undefined) {
      localStorage.setItem(PREF_KEY_VOLUME, String(prefs.soundVolume));
    }
    if (prefs.hapticsEnabled !== undefined) {
      localStorage.setItem(PREF_KEY_HAPTICS, String(prefs.hapticsEnabled));
    }
  }

  private getAudioContext(): AudioContext | null {
    try {
      if (!this.audioCtx && typeof window !== 'undefined') {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * Trigger device vibration if supported and enabled.
   */
  public triggerHaptic(durationMs = 15): void {
    try {
      const prefs = this.getPreferences();
      if (!prefs.hapticsEnabled) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(durationMs);
      }
    } catch {
      // Ignore vibration error
    }
  }

  /**
   * Income / Cash In: Bright, positive major-third confirmation chime (C5 -> E5 -> G5)
   */
  public playIncomeSound(): void {
    try {
      const prefs = this.getPreferences();
      this.triggerHaptic(20);
      if (!prefs.soundsEnabled) return;

      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const vol = Math.max(0, Math.min(1, prefs.soundVolume));

      // 3 ascending harmonic notes
      const notes = [
        { freq: 523.25, time: 0.00, dur: 0.12 }, // C5
        { freq: 659.25, time: 0.07, dur: 0.14 }, // E5
        { freq: 783.99, time: 0.14, dur: 0.28 }, // G5
      ];

      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, now + n.time);

        gain.gain.setValueAtTime(0, now + n.time);
        gain.gain.linearRampToValueAtTime(vol * 0.25, now + n.time + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.time + n.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + n.time);
        osc.stop(now + n.time + n.dur);
      }
    } catch {
      // Non-blocking: audio failures never impact financial persistence
    }
  }

  /**
   * Expense / Cash Out: Soft neutral tactile confirmation tick (subtle 320Hz to 160Hz pop)
   */
  public playExpenseSound(): void {
    try {
      const prefs = this.getPreferences();
      this.triggerHaptic(15);
      if (!prefs.soundsEnabled) return;

      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const vol = Math.max(0, Math.min(1, prefs.soundVolume));

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);

      gain.gain.setValueAtTime(vol * 0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Non-blocking
    }
  }

  /**
   * Transfer: Smooth movement chime (rising two-tone interval: A4 -> D5)
   */
  public playTransferSound(): void {
    try {
      const prefs = this.getPreferences();
      this.triggerHaptic(25);
      if (!prefs.soundsEnabled) return;

      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const vol = Math.max(0, Math.min(1, prefs.soundVolume));

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(440, now);
      gain1.gain.setValueAtTime(vol * 0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.10);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(587.33, now + 0.08); // D5
      gain2.gain.setValueAtTime(0, now + 0.08);
      gain2.gain.linearRampToValueAtTime(vol * 0.25, now + 0.095);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.26);
    } catch {
      // Non-blocking
    }
  }

  /**
   * Play appropriate sound for transaction type
   */
  public playTransactionSuccess(type: 'income' | 'expense' | 'transfer'): void {
    switch (type) {
      case 'income':
        this.playIncomeSound();
        break;
      case 'expense':
        this.playExpenseSound();
        break;
      case 'transfer':
        this.playTransferSound();
        break;
    }
  }
}

export const soundService = new SoundService();
