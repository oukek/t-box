import { WebPlugin } from "@capacitor/core";

export class NativeScannerWeb extends WebPlugin {
  async scan() {
    throw this.unavailable("Native scanner is only available inside the Capacitor shell.");
  }

  async isSupported() {
    return { supported: false };
  }
}
