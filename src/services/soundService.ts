/** Bundled original coin-impact PCM audio. Offline playback, independent haptics,
 * and silent failure. Called only by explicit previews or after durable journal commit. */
export interface SoundPreferences {
  soundsEnabled: boolean;
  soundVolume: number; // 0.0 to 1.0
  hapticsEnabled: boolean;
}

const PREF_KEY_SOUNDS = 'hisab_sounds_enabled';
const PREF_KEY_VOLUME = 'hisab_sound_volume';
const PREF_KEY_HAPTICS = 'hisab_haptics_enabled';

class SoundService {
  private voices = new Set<HTMLAudioElement>();
  public getPreferences(): SoundPreferences {
    if (typeof localStorage === 'undefined') {
      return { soundsEnabled: true, soundVolume: 0.7, hapticsEnabled: true };
    }
    const sounds = localStorage.getItem(PREF_KEY_SOUNDS);
    const volume = localStorage.getItem(PREF_KEY_VOLUME);
    const haptics = localStorage.getItem(PREF_KEY_HAPTICS);

    return {
      soundsEnabled: sounds !== null ? sounds === 'true' : true,
      soundVolume: volume !== null && Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 0.7,
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

  private play(kind: 'income' | 'expense' | 'transfer'): void {
    try {
      const prefs = this.getPreferences();
      this.triggerHaptic(kind === 'transfer' ? 25 : 15);
      if (!prefs.soundsEnabled || typeof Audio === 'undefined') return;
      const volume = Number.isFinite(prefs.soundVolume) ? Math.max(0, Math.min(1, prefs.soundVolume)) : 0.7;
      if (volume === 0) return;
      // Bound overlapping voices during rapid repeated transactions.
      if (this.voices.size >= 4) { const oldest = this.voices.values().next().value!; oldest.pause(); this.voices.delete(oldest); }
      const voice = new Audio(`${import.meta.env?.BASE_URL || '/'}audio/${kind}.wav`);
      voice.volume = volume;
      voice.preload = 'auto';
      this.voices.add(voice);
      const done = () => { this.voices.delete(voice); };
      voice.addEventListener('ended', done, { once: true });
      voice.addEventListener('error', done, { once: true });
      voice.play().catch(done);
    } catch { /* Audio failures never interrupt accounting persistence. */ }
  }
  public playIncomeSound(): void { this.play('income'); }
  public playExpenseSound(): void { this.play('expense'); }
  public playTransferSound(): void { this.play('transfer'); }
  public playTransactionSuccess(type: 'income' | 'expense' | 'transfer'): void { this.play(type); }
}
export const soundService = new SoundService();
