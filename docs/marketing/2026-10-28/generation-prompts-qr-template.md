# 带二维码位的海报模板

生成方式：Codex 内置 imagegen 编辑，以已确认的 t-ark-poster-v2.png 为输入。

成品：t-ark-poster-qr-template.png。运行时 JPEG 模板位于 api/assets/promotion-poster.jpg，最终 1080 × 1920。程序生成的真实二维码放置于 x=760、y=1625，尺寸 232 × 232，二维码白边由 qrcode 库生成。

提示词：

```text
Edit the supplied approved T方舟 software-platform poster into a reusable QR-code poster template. Preserve the deep evergreen and mint software visual, T方舟 four-square mark, headline, AI phone conversation screen and abstract app grid. Keep all existing top text accurate. Maintain 9:16 portrait. Recompose and slightly shrink the phone and app-grid hero upward so ALL content ends above 80 percent height. Replace the current bottom wide CTA button and URL footer with a clean bottom band of solid deep evergreen. In the bottom-right band reserve a COMPLETELY EMPTY WHITE SQUARE for a real QR code, occupying about 22 percent of total width. It must contain no fake code, symbol, icon or writing. Place that square approximately at x=72 percent width, y=83 percent height, with clear safe margins. To the left of the blank square, set only these two short lines in crisp white/mint Chinese typography: “扫码打开 T方舟” and “从一句话，到更多可能”. Below that, smaller text “tboxos.cn”. Keep benefits “AI 对话 · 按需安装 · 持续扩展” immediately above the bottom band. No other new text. Reserve at least the bottom 18 percent for the clean scan footer. No interiors or concrete app names. This is a finished poster TEMPLATE awaiting a real programmatically rendered QR code; the QR area MUST remain pure blank white.
```
