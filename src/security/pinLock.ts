/**
 * Persistent Cryptographic 4-Digit PIN Security Module
 * Strictly adheres to Phase 5 specifications:
 * - Slow Key Derivation Function: PBKDF2 with HMAC-SHA256 and 100,000 iterations
 * - 128-bit cryptographic random salt
 * - Never stores PIN in plaintext
 * - Rate limiting & brute-force cooldown protection (max 5 failed attempts)
 * - Persistent lockout state across app restarts
 * - Seamless backward-compatible migration from legacy hashes
 */

import { computeSha256 } from '../sync/canonical';

const PIN_STORAGE_KEY = 'hisab_pin_security_v1';
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 60 * 1000; // 60 seconds lockout
const PBKDF2_ITERATIONS = 100000;

export interface PinConfig {
  enabled: boolean;
  salt: string;
  hash: string;
  kdfVersion?: 'pbkdf2_v1' | 'legacy_sha256';
  failedAttempts: number;
  lockedUntil: number | null;
}

const inMemoryFallbackStore = new Map<string, string>();

export class PinLockManager {
  private config: PinConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): PinConfig {
    try {
      let raw: string | null = null;
      if (typeof localStorage !== 'undefined') {
        raw = localStorage.getItem(PIN_STORAGE_KEY);
      } else {
        raw = inMemoryFallbackStore.get(PIN_STORAGE_KEY) || null;
      }
      if (raw) return JSON.parse(raw);
    } catch {
      // Fallback default
    }
    return {
      enabled: false,
      salt: '',
      hash: '',
      kdfVersion: 'pbkdf2_v1',
      failedAttempts: 0,
      lockedUntil: null,
    };
  }

  private saveConfig(): void {
    const serialized = JSON.stringify(this.config);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(PIN_STORAGE_KEY, serialized);
      } catch {
        // Handle restricted storage
      }
    }
    inMemoryFallbackStore.set(PIN_STORAGE_KEY, serialized);
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

  /**
   * Derives a cryptographic hash for the PIN using PBKDF2 (HMAC-SHA-256, 100,000 iterations).
   * Slow key derivation function (20-40ms) prevents offline brute-forcing of 4-digit PINs.
   */
  public static async hashPin(pin: string, saltHex: string): Promise<string> {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(pin);
    const saltBuffer = new Uint8Array(
      saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || Array.from(enc.encode(saltHex))
    );

    const baseKey = await crypto.subtle.importKey(
      'raw',
      pinBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      baseKey,
      256
    );

    return Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  public static async verifyPin(enteredPin: string, salt: string, expectedHash: string): Promise<boolean> {
    const computed = await PinLockManager.hashPin(enteredPin, salt);
    if (computed === expectedHash) {
      return true;
    }
    // Backward compatibility check for legacy salted SHA-256 hashes
    const legacy = await computeSha256(`hisab-pin-salt:${salt}:${enteredPin}`);
    return legacy === expectedHash;
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
      kdfVersion: 'pbkdf2_v1',
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
      kdfVersion: 'pbkdf2_v1',
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

    // 1. Try PBKDF2 slow KDF verification
    const computed = await PinLockManager.hashPin(enteredPin, this.config.salt);

    let isMatch = computed === this.config.hash;

    // 2. Fallback check for legacy SHA-256 and transparent upgrade
    if (!isMatch && this.config.kdfVersion === 'legacy_sha256') {
      const legacyComputed = await computeSha256(`hisab-pin-salt:${this.config.salt}:${enteredPin}`);
      if (legacyComputed === this.config.hash) {
        isMatch = true;
        // Upgrade legacy hash to PBKDF2
        this.config.hash = computed;
        this.config.kdfVersion = 'pbkdf2_v1';
      }
    }

    if (isMatch) {
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
