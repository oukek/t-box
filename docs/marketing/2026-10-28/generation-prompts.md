# 素材生成记录

生成方式：Codex 内置 image_gen。

海报按 9:16 设计；微信分享图单独构图，以海报为风格参考，生成高清母版后缩放至 300 × 300 px。

## 交付文件

- `t-ark-poster.png`：海报，1080 × 1920 px。生成原图为 941 × 1672 px，以 Lanczos 缩放导出。
- `t-ark-wechat-300.jpg`：微信分享图，300 × 300 px，JPEG quality 90，4:4:4。
- `t-ark-wechat-300.png`：微信分享图的 PNG 版本，300 × 300 px。
- `t-ark-wechat-master.png`：方图生成母版，1254 × 1254 px。
- `share-copy.md`：分享标题、描述、朋友圈配文与海报文案。

已逐项核对图片中文字；已在 300 × 300 实际尺寸下查看分享图，确认品牌、标题和描述均可辨识。海报不展示具体应用界面或名称。

## 海报提示词

```text
Use case: ads-marketing.
Asset type: finished Chinese brand campaign poster for T方舟 / T Ark, portrait 9:16, requested output 1440 x 2560 pixels.
Primary request: Create a complete, exceptionally polished editorial technology brand poster for T方舟, an AI conversation space with an application platform where users install apps on demand and the catalog expands. Market the platform only. Do not depict, name, list, or imply any particular application.
Brand identity: existing brand uses a simple four rounded-square mark in a 2 by 2 arrangement tilted counterclockwise five degrees. Top-left pale sage #c5dfd4, top-right medium sage #83b3a4, bottom-left deep teal #277e70, bottom-right jade #4b9784. Use this exact four-block geometry, without adding another logo. Brand typography is clean modern Chinese sans-serif, dignified and human.
Art direction: luminous warm ivory #f5f6f1, rich dark forest #153e35, jade green #277e70, pale sage. Airy sophisticated design, tactile ceramic and frosted jade glass, precise typography, quiet premium product-launch quality. Warm and useful rather than science-fiction.
Composition: generous 7 percent safe margins. Top-left brand lockup four-square mark with “T方舟” and smaller “T Ark”. A small descriptor below. Strong left-aligned oversized two-line headline in upper third, clean typographic spacing. Short supporting copy below. Middle-to-lower visual occupies about 42 percent: a beautifully art-directed sculptural, isometric open modular space built from rounded-square jade glass and porcelain modules, with four primary modules echoing the existing brand mark and a few abstract unmarked tiles extending outward to suggest growth and optional installation. One understated abstract speech-bubble outline can signify conversation. Sculptural geometry and soft natural shadows, subtle atmospheric light, real material depth, an editorial object installation on ivory. No literal ark boat, no phone, no app UI, no screenshots, no labeled app tiles.
Bottom: three concise benefits as one clean line separated by centered dots, thin restrained divider, CTA and a clearly legible website URL. Leave ample breathing room. No fake buttons, no QR code.
Text (verbatim, render Chinese accurately, only these strings):
Top brand “T方舟” and “T Ark”
Descriptor “你的 AI 日常空间”
Main headline split into two lines: “日常，” / “一处安放。”
Support copy split into two lines: “从对话开始，” / “构建适合自己的应用空间。”
Benefits “AI 对话 · 按需安装 · 持续扩展”
CTA “打开 T方舟，探索更多可能”
Website “tboxos.cn”
Constraints: Every Chinese character and Latin spelling must be accurate. Main headline should read clearly on a phone. Text is flat printed editorial typography, never mapped onto the sculpture. No concrete app names or symbols for calendars, finance, calculators, image editing, shopping, notes, children or any other named use case. No other brands, unsupported claims, free/permanent/unlimited claims, watermarks, badges, sparkles, generic sci-fi network lines, neon purple, blue gradients, illegible microtext, dense paragraphs, or extra text. Deliver the finished single poster, edge to edge, without a mockup frame.
```

## 微信分享图提示词

```text
Use case: ads-marketing.
Asset type: WeChat share thumbnail for T方舟 / T Ark. A square 1:1 finished brand image designed to remain clear at the FINAL SIZE of 300 x 300 pixels; generate a crisp high-resolution square master, approximately 1200 x 1200 pixels.
Input image: Image 1 is ONLY a campaign art-direction and brand reference, not a layout to crop. The new composition is a purpose-designed square companion to that poster.
Primary request: Make a highly legible, beautifully refined miniature brand card for an AI conversation and expandable app platform. Use the same warm ivory background, jade and sage green glass/ceramic four-module design language, forest-green Chinese sans-serif typography, warm natural light, and calm premium mood as the reference.
Composition: safe margins at least 9 percent. Upper-left the exact four rounded-square brand mark in a 2 by 2 layout slightly tilted counterclockwise, beside a large clear “T方舟”. The middle-left oversized bold two-line slogan “日常，” then “一处安放”. A compact sculptural group of four rounded-square modules sits toward the bottom-right, echoing the 2 by 2 brand mark in isometric frosted jade glass and porcelain, simple abstract solids with soft shadows. Use fewer objects than the reference: NO miniature rooms, NO chairs, furniture, plants, intricate interiors, or tiny scattered objects. The sculpture should occupy about the lower 40 percent and leave typography clear. At bottom-left a short, adequately sized descriptor “AI 与应用空间”. Balanced square composition with generous space, clearly connected to the poster.
Text (verbatim; these three groups ONLY):
“T方舟”
“日常，” / “一处安放”
“AI 与应用空间”
Render all Chinese characters accurately. Brand should read immediately at 300 pixels, slogan should be the largest type. Final 300-pixel equivalent type sizes: brand about 24 pixels, main slogan about 32 pixels, descriptor about 13 pixels. Strong dark-green-on-ivory contrast.
Constraints: Do not list or depict any concrete apps or function-specific icons. No website URL, CTA, English microtext, QR code, phone, app screenshot, fake UI, badge, watermark, unsupported claims, extra writing, tiny labels, neon, generic tech network imagery or frame. The square should work as a share thumbnail, with reduced detail and decisive hierarchy. Deliver ONE square image, not a pair or a contact sheet.
```
