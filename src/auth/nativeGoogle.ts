import { Capacitor, registerPlugin } from '@capacitor/core';
const nativeGoogleDrive = registerPlugin<{
  authorize(options: { interactive: boolean; invalidToken?: string }): Promise<{ accessToken: string }>;
}>('NativeGoogleDrive');

export const NativeGoogleDrive = {
  async authorize(options: { interactive: boolean; invalidToken?: string }): Promise<{ accessToken: string }> {
    if (!Capacitor.isPluginAvailable('NativeGoogleDrive')) throw new Error('GOOGLE_NATIVE_UNAVAILABLE');
    return nativeGoogleDrive.authorize(options);
  },
};
