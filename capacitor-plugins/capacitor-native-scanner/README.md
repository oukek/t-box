# @t-box/capacitor-native-scanner

源自参考项目 `app-plugins/capacitor-native-scanner`，适配 Capacitor 8、T Box Android namespace 和 iOS 15.4。

```ts
import { NativeScanner } from '@t-box/capacitor-native-scanner';

const { supported } = await NativeScanner.isSupported();
if (supported) {
  const result = await NativeScanner.scan({ formats: ['qr_code', 'ean_13'], torch: false });
  console.log(result.text);
}
```

Android 使用 ZXing Embedded，iOS 使用 AVFoundation。浏览器 `isSupported()` 返回 false，`scan()` 抛出 unavailable。用户取消扫描抛出 `SCAN_CANCELED`，拒绝相机权限抛出 `CAMERA_PERMISSION_DENIED`。

宿主 iOS 必须设置 `NSCameraUsageDescription`；T Box 原生壳已配置。扫码需要有摄像头的设备验证，模拟器编译通过不代表扫描功能已验收。
