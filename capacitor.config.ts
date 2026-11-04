import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hisabdekhtechai.app',
  appName: 'Hisab Dekhtechai',
  webDir: 'dist',
  // Credential bridge arguments/results must never enter Capacitor debug logs.
  loggingBehavior: 'none',
  plugins: {
    PushNotifications: { presentationOptions: ['alert', 'sound'] },
    // Preserve MainActivity's existing modal-aware back navigation.
    App: { disableBackButtonHandler: true },
  },
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
