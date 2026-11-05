import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin<{setTheme(options: {dark: boolean}): Promise<void>}>('DeviceAppearance');
export async function applyNativeAppearance(dark: boolean) {
  if (Capacitor.isNativePlatform()) await native.setTheme({dark});
}
