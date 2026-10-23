/**
 * Persistent Cryptographic 4-Digit PIN Security Module
 * Strictly adheres to Phase 5 specifications:
 * - Salted cryptographic hashing (SHA-256 with 128-bit random salt)
 * - Never stores PIN in plaintext
 * - Rate limiting & brute-force cooldown protection (max 5 failed attempts)
 * - Session unlock state management
 */

import { computeSha256 } from '../sync/canonical';

const PIN_STORAGE_KEY = 'hisab_pin_security_v1';
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 1000; // 60 seconds lockout

export interface PinConfig {
  enabled: boolean;
  salt: string;
  hash: string;
  failedAttempts: number;
  lockedUntil: number | null;
}

export class PinLockManager {
  private config: PinConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): PinConfig {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(PIN_STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        // Fallback default
      }
    }
    return {
      enabled: false,
      salt: '',
      hash: '',
      failedAttempts: 0,
      lockedUntil: null,
    };
  }

  private saveConfig(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(this.config));
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled && !!this.config.hash;
  }

  public isLockedOut(): { locked: boolean; remainingSeconds: number } {
    if (this.config.lockedUntil && Date.now() < this.config.lockedUntil) {
      const remainingSeconds = Math.ceil((this.config.lockedUntil - Date.now()) / 1000);
      return { locked: true, remainingSeconds };
    }
    if (this.config.lockedUntil && Date.now() >= this.config.lockedUntil) {
      this.config.lockedUntil = null;
      this.config.failedAttempts = 0;
      this.saveConfig();
    }
    return { locked: false, remainingSeconds: 0 };
  }

  public static generateSalt(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  public static async hashPin(pin: string, salt: string): Promise<string> {
    return computeSha256(`hisab-pin-salt:${salt}:${pin}`);
  }

  public static async verifyPin(enteredPin: string, salt: string, expectedHash: string): Promise<boolean> {
    const computed = await PinLockManager.hashPin(enteredPin, salt);
    return computed === expectedHash;
  }

  public resetAttempts(): void {
    this.config.failedAttempts = 0;
    this.config.lockedUntil = null;
    this.saveConfig();
  }

  public async setPin(newPin: string): Promise<void> {
    if (!/^\d{4}$/.test(newPin)) {
      throw new Error('PIN must be exactly 4 numeric digits');
    }

    const salt = PinLockManager.generateSalt();
    const hash = await PinLockManager.hashPin(newPin, salt);

    this.config = {
      enabled: true,
      salt,
      hash,
      failedAttempts: 0,
      lockedUntil: null,
    };
    this.saveConfig();
  }

  public removePin(): void {
    this.config = {
      enabled: false,
      salt: '',
      hash: '',
      failedAttempts: 0,
      lockedUntil: null,
    };
    this.saveConfig();
  }

  public async verifyPin(enteredPin: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isEnabled()) {
      return { success: true };
    }

    const { locked, remainingSeconds } = this.isLockedOut();
    if (locked) {
      return {
        success: false,
        error: `Too many failed attempts. Locked for ${remainingSeconds} seconds.`,
      };
    }

    const computed = await computeSha256(`hisab-pin-salt:${this.config.salt}:${enteredPin}`);

    if (computed === this.config.hash) {
      this.config.failedAttempts = 0;
      this.config.lockedUntil = null;
      this.saveConfig();
      return { success: true };
    }

    this.config.failedAttempts++;
    if (this.config.failedAttempts >= MAX_ATTEMPTS) {
      this.config.lockedUntil = Date.now() + COOLDOWN_MS;
      this.saveConfig();
      return {
        success: false,
        error: `Incorrect PIN. Max attempts reached. Locked for 60 seconds.`,
      };
    }

    this.saveConfig();
    const remaining = MAX_ATTEMPTS - this.config.failedAttempts;
    return {
      success: false,
      error: `Incorrect PIN. ${remaining} attempts remaining.`,
    };
  }
}

export const pinLock = new PinLockManager();
