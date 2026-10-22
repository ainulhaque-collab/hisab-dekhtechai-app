import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hisabdekhtechai.app',
  appName: 'হিসাব দেখতে চাই (Hisab DekhteChai)',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    buildOptions: {
      keystorePath: 'release-key.keystore',
      keystoreAlias: 'hisabdekhtechai',
    },
  },
};

export default config;
