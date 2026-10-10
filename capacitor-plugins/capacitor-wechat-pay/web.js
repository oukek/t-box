import { WebPlugin } from "@capacitor/core";
export class WechatPayWeb extends WebPlugin {
  async getStatus() { return { enabled: false, configured: false, installed: false, appId: "" }; }
  async pay() { throw this.unavailable("微信 APP 支付只支持原生 App"); }
}
