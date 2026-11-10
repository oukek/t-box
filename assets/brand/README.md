# 方舟标识

主方案为「T 舟」：字母 T 是桅杆，向内收拢的船身表达承载和归拢。移除旧四宫格，避免与普通应用菜单混淆。

- `app-icon.svg`：1024 图标的矢量源；深青绿底 `#135D57`、暖白 `#F4FAF7`、浅绿 `#9CDBBD`。iOS PNG 全不透明，圆角由系统处理。
- `mark.svg` / `mark-light.svg`：单色与反白图形，适合页面、启动屏和 AI 入口。
- `concepts.svg` / `concepts.png`：三个设计方向的比较，01 是已接入的主方案；02 折帆、03 舱门保留为备选。
- 页面使用共享 `packages/ui-kit/src/BrandMark.vue`，几何与 `mark.svg` 一致。
- Android adaptive icon 的前景保留安全留白；传统、圆形图标与 iOS 共用图形。

建议至少 24 px 使用图形，四周留出图形宽度的 1/6；禁止拉伸、旋转或给图形额外加描边。彩色图标使用指定背景；照片和深色背景上使用反白标识。
