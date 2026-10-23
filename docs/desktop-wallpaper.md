# 桌面壁纸

`app/public/wallpapers/lake-dusk.jpg` 为 T方舟 原生桌面使用的本地静态壁纸，1536 × 1024，约 210KB，构建后随宿主打包，无需联网加载。使用 Codex 内置 imagegen 生成，转换为 JPEG 用于发布；原生成文件不参与运行时加载。

壁纸通过桌面独立的视口背景层加载，以中心裁切适配手机、平板和电脑。添加更多应用时不会拉伸图像。文字使用白色及阴影保持辨识度；背景加载失败时回退到深蓝色。桌面样式不作用于 AI 页或应用内页面。

## 选择与上传

「设置 → 桌面壁纸」提供山湖暮色、海岸微光、沙丘晚照三张本地壁纸。通用壁纸用于所有设备，手机、平板、电脑可分别设置覆盖项或选择「跟随通用」。可以先预览，点击固定底部的「应用壁纸」后才保存；「恢复默认」也先更新草稿，未应用时不改变桌面。

PNG、JPEG、WebP 上传沿用鉴权资源服务（单张 10MB，前端拒绝无法解码或超过 4000 万像素的图片），文件存入资源库；配置只存资源 ID，不存 base64、公开地址或登录 token。更换壁纸不会删除原图。已删除资源在读取配置时自动清除引用，设备覆盖项回退到通用壁纸，通用项回退到默认内置壁纸。

非触控窗口按宽度分为手机（小于 600px）、平板（600–1199px）和电脑（至少 1200px）；触控设备按短边区分手机与平板，横竖屏不更换设备类型。所有图片使用居中裁切保持比例。自定义图片在桌面叠加暗色遮罩，增强白字辨识度。

## 持久化与边界

- `user_desktop_appearance` 按账号保存 `wallpapers` JSON、版本号和更新时间。首次部署先运行 `pnpm db:init`；桌面外观表已纳入完整初始化，旧开发库按 [初始化说明](database-initialization.md) 处理。
- `GET /api/v1/desktop/appearance` 返回 `{data:{revision,wallpapers}}`，`PUT` 接收 `{revision,wallpapers}`。服务端从登录态取账号，验证图片归属、类型和删除状态，拒绝任意 URL、未知内置 ID 以及额外字段。
- 并发修改使用版本校验，冲突返回 `DESKTOP_APPEARANCE_CHANGED`；相同配置重试幂等。前端重载最新配置后要求重新选择，不静默覆盖其他设备的修改。
- 设置应用只调用 `app-shell-sdk` 的显式壁纸端口。宿主负责上传、鉴权取图、会话变更隔离、私有 Blob URL 的创建/释放和桌面渲染；账号切换时清理图片与请求。进入桌面或恢复前台时刷新配置。壁纸与应用业务配置、AI 工具注册无关。
- 验证：`pnpm test:desktop-appearance`（真实 MySQL/资源文件集成测试，只使用可清理的测试账号）；`pnpm --filter @t-box/api exec tsx --test ../app/test/desktop-wallpaper.test.ts`（设备判定、覆盖与回退）。

新增内置壁纸同样使用 Codex 内置 imagegen，转换为本地 JPEG：`app/public/wallpapers/coast-dusk.jpg`（约 424KB）与 `app/public/wallpapers/dunes-dusk.jpg`（约 226KB）。

海岸微光最终提示词：

> Use case: photorealistic-natural. Asset type: native phone, tablet and desktop launcher wallpaper. Landscape 3:2 approximately 1536x1024. Serene rocky coastline at dusk, dark teal ocean with soft surf and a distant headland, gentle sand in the lower third. Refined natural landscape photography, cool muted sea green and deep blue, no vivid sunset. Keep upper 40 percent a quiet dark blue sky for white clock and icon labels. Coast and waves stay visible when center-cropped into a tall portrait phone screen. Fine real water texture and atmospheric depth, no busy detail in the top third. No people, boats, buildings, text, watermarks, logos, phone frame or UI. Wallpaper only.

沙丘晚照最终提示词：

> Use case: photorealistic-natural. Asset type: native phone, tablet and desktop launcher wallpaper. Landscape 3:2 approximately 1536x1024. Minimal sculpted desert dunes at blue hour, smooth copper-brown and dusty violet sand ridgelines, subtle directional twilight and a deep blue dusk sky. Natural landscape photography with delicate sand texture, restrained colors, elegant calm composition. Upper 40 percent is a smooth dark sky for white clock and application labels. The central dune ridge and flowing curves remain visible in a center crop for a tall portrait phone screen. No sun, moon, stars, people, buildings, footprints, text, watermark, logos, phone frame or UI. Wallpaper only.

最终生成提示词：

> Use case: photorealistic-natural. Asset type: production wallpaper for a phone-style application launcher, also used on tablets and desktop. Generate a landscape 3:2 image, approximately 1536x1024. Scene: a serene alpine lake at blue hour, distant layered mountain silhouettes and a small softly lit snowy peak, still water reflecting the mountains. Photorealistic landscape photography, natural fine detail, restrained cool blue and teal tones, peaceful rather than dramatic. Composition for responsive cropping: the mountain and its reflection remain visible in the center portrait crop. Keep upper 40 percent a smooth dark blue dusk sky with minimal cloud detail so white clock text and app icons are legible; mountain horizon around 55 percent, reflection and gentle water texture in the lower half. No people, buildings, boats, moon, text, logo, watermark, gradients-as-abstract-art, phone frame, UI or icons. Deliver the wallpaper image only.
