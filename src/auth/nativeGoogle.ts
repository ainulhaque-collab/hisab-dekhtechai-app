import { registerPlugin } from '@capacitor/core';
export const NativeGoogleDrive = registerPlugin<{
  authorize(options: { interactive: boolean; invalidToken?: string }): Promise<{ accessToken: string }>;
}>('NativeGoogleDrive');
