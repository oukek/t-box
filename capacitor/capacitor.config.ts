import type { CapacitorConfig } from '@capacitor/cli';

const liveReloadUrl = (process.env.CAP_LIVE_RELOAD_URL ?? process.env.CAP_SERVER_URL)?.trim();

if (liveReloadUrl && !/^https?:\/\//.test(liveReloadUrl)) {
  throw new Error('CAP_LIVE_RELOAD_URL must be an absolute HTTP(S) URL.');
}

const config: CapacitorConfig = {
  appId: 'com.tbox.app',
  appName: 'T Box',
  webDir: 'www',
  backgroundColor: '#f4f6f8',
  loggingBehavior: 'debug',
  plugins: { LocalNotifications: { presentationOptions: ['sound'] } },
  ...(liveReloadUrl
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: new URL(liveReloadUrl).protocol === 'http:',
        },
      }
    : {}),
};

export default config;
