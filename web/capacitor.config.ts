import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.healthconnector',
  appName: 'HealthConnector',
  webDir: 'dist',
  plugins: {
    // Route fetch() through native HTTP so the app can reach a self-hosted
    // server on any address, including plain http:// on the home network.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
