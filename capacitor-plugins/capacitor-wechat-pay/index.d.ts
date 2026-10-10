import type { PluginListenerHandle } from "@capacitor/core";
export interface WechatPayStatus { enabled: boolean; configured: boolean; installed: boolean; appId: string; }
export interface WechatPayRequest {
  appId: string; partnerId: string; prepayId: string; packageValue: "Sign=WXPay";
  nonceStr: string; timeStamp: string; sign: string;
}
/** A client hint only. Never use this callback to credit a wallet. */
export interface WechatPayResult { code: number; }
export interface WechatPayPlugin {
  getStatus(): Promise<WechatPayStatus>;
  pay(parameters: WechatPayRequest): Promise<{ launched: boolean }>;
  addListener(event: "paymentResult", listener: (result: WechatPayResult) => void): Promise<PluginListenerHandle>;
  addListener(event: "foreground", listener: () => void): Promise<PluginListenerHandle>;
}
export declare const WechatPay: WechatPayPlugin;
