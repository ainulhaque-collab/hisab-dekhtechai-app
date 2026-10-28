import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hisabdekhtechai.app',
  appName: 'Hisab Dekhtechai',
  webDir: 'dist',
  plugins: { PushNotifications: { presentationOptions: ['alert', 'sound'] } },
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
