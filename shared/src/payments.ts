export type WechatPaymentMode = "native" | "h5" | "jsapi" | "app";
export interface WechatPaymentConfiguration {
  id?: string;
  enabled: boolean;
  appId: string; // Service account AppID for web payments
  mobileAppId: string; // WeChat Open Platform mobile application
  app: boolean;
  merchantId: string;
  merchantSerial: string;
  platformSerial: string;
  platformPublicKey: string;
  apiBaseUrl: string;
  frontendUrl: string;
  description: string;
  native: boolean;
  h5: boolean;
  jsapi: boolean;
  hasPrivateKey?: boolean;
  hasApiV3Key?: boolean;
  hasAppSecret?: boolean;
}
export interface WechatPaymentSecrets {
  privateKey?: string;
  apiV3Key?: string;
  appSecret?: string;
}
