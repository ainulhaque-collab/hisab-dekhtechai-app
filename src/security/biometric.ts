import { Capacitor, registerPlugin } from '@capacitor/core';
import { pinLock } from './pinLock';
interface Status { available: boolean; enabled: boolean; statusCode?: number }
export interface BiometricBridge {
  status(): Promise<Status>;
  enable(): Promise<{ authenticated: boolean }>;
  authenticate(): Promise<{ authenticated: boolean }>;
  disable(): Promise<void>;
}
const native = registerPlugin<BiometricBridge>('BiometricUnlock');
export class BiometricUnlockManager {
  constructor(private bridge: BiometricBridge = native, private pin = pinLock, private platform = () => Capacitor.getPlatform()) {}
  isNative() { return this.platform() === 'android'; }
  async status(): Promise<Status> {
    if (!this.isNative()) return { available: false, enabled: false };
    return this.bridge.status();
  }
  async enable(currentPin: string) {
    if (!this.isNative() || !this.pin.isEnabled()) throw new Error('Enable App PIN first.');
    const verification = await this.pin.verifyPin(currentPin);
    if (!verification.success) throw new Error(verification.error);
    const result = await this.bridge.enable();
    if (!result.authenticated) throw new Error('Authentication failed.');
  }
  async disable(currentPin: string) {
    const verification = await this.pin.verifyPin(currentPin);
    if (!verification.success) throw new Error(verification.error);
    if (this.isNative()) await this.bridge.disable();
  }
  async unlock(): Promise<boolean> {
    if (!this.isNative() || !this.pin.isEnabled() || this.pin.isLockedOut().locked) return false;
    const status = await this.bridge.status();
    if (!status.available || !status.enabled) return false;
    return (await this.bridge.authenticate()).authenticated === true;
  }
}
export const biometric = new BiometricUnlockManager();
