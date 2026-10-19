# 单位换算

`converter` 是默认安装、不可卸载、可独立升级的系统应用。Web、Android、iOS 使用相同的独立 Web 包，本地换算，通过应用 SDK 使用宿主登录、存储与后端能力。版本由 `contracts/src/index.ts` 的 manifest 维护；图标源为 `icon.svg`，运行 `pnpm apps:icons` 同步到发布元信息。

## 功能

35 类、314 个单位：长度、面积、体积与容量、质量、温度、温差、时长、速度、加速度、角度、压强、能量、功率、力、力矩、频率、数据容量、数据速率、密度、体积流量、油耗、电流、电压、电阻、电导、电容、电荷、电感、磁通量、磁通密度、照度、亮度、动力黏度、运动黏度、比例与浓度比。

支持科学计数法、单位搜索、交换单位、同类全部结果、复制、收藏 12 组常用换算、保存最近 30 条记录。偏好通过 SDK 存储，由宿主按用户和应用隔离，保留在当前设备/浏览器，不提供跨设备同步；应用自身不直接访问宿主 localStorage。手机使用搜索 Sheet，宽屏使用类别导航；Sheet 不受内容外边距限制。

## 分层与数值约定

- `contracts`：清单、输入/输出类型、导航参数、应用错误目录和静态图标。
- `core/definitions.ts`：单位目录，系数用分子/分母字符串表达；增加单位时在这里扩充，新增类别还需更新 contracts 的类别 ID。
- `core/convert.ts`：不依赖浏览器、Node.js 或 SDK 的纯换算引擎，包含统一校验、单位解析、精度和批量换算；前端与后端在各自进程执行同一套实现。
- `server/module.ts`：AI 工具、Skill、Agent 与应用后端调用入口；宿主仅组合注册，不包含换算业务。
- `web`：自有换算界面和选择器，直接使用 `core` 的目录与同步换算；每次输入、切换单位不发计算请求，也不等待 SDK 偏好读取。通过 SDK 读写收藏与记录。
- `shell`：宿主适配、导航和 SDK 权限；不打包应用页面。

内部使用 decimal.js 的 60 位精度，输入为十进制字符串或科学计数法，最多 50 位有效数字；非零输入绝对值为 1e-300 至 1e300。结果输出最多 20 位有效数字，舍入或使用近似系数时返回 `approximate: true`，页面显示 `≈`。它用于日常和工程单位换算，不承诺任意精度符号运算。

绝对温度检查绝对零度，温差不加温标偏移；油耗/燃油经济性使用倒数关系并要求正数。b/B、SI/IEC、美制/英制必须区分，大小写模糊匹配存在歧义时拒绝猜测。自然月、自然年、实时汇率及缺少密度/电压等条件的跨量纲换算不包含在此目录中。

系数参考 [NIST SP 811 换算表](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9)、[温度定义](https://www.nist.gov/pml/owm/si-units-temperature) 和 [二进制前缀](https://physics.nist.gov/cuu/Units/binary.html)。市制明确采用市斤 500 g、市两 50 g、市尺 1/3 m；热量、马力和烹饪容量标明具体制式。

## AI 与 SDK

所有 AI 工具都是服务器只读工具，遵循宿主已有的按需加载和安装授权机制：

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `converter_catalog` | `category` / `query`，可为 null | 无条件时只给类别摘要；指定类别或搜索词才展开单位 |
| `converter_convert` | `category, value, from, to[]` | 一对多，最多 40 个目标单位 |
| `converter_batch` | `items[]` | 最多 30 项，可混合多个类别 |

Skill `unit-conversion` 与专业 Agent `converter` 由应用提供。模型先查询准确单位 ID，再调用后端；不能自行推测制式。批量换算是纯计算，不存在部分写入问题。

页面的目录与换算在本地完成，不调用以下后端入口；首次打开仍需宿主的安装授权和 SDK 桥。已加载页面即使计算 API 不可达也能换算；收藏与记录继续使用宿主的本地 SDK 存储，需要 SDK 桥可用，与后端换算接口无关。

保留给 API 和其他应用调用的 SDK 入口为 `api.invoke('catalog', {})`、`api.invoke('convert', input)`、`api.invoke('batch', { items })`；对应安装权限为 `converter.catalog`、`converter.convert`、`converter.batch`，收藏/记录另需 `storage`。宿主继续检查账号、安装版本和 generation。无需额外数据库表或配置中心业务项。

导航示例：`{ category: 'mass', from: 'kg', to: 'g', value: '2.5' }`。参数只接受这四个字段，不接受 URL 或脚本。

## 开发、验证和发布

```bash
pnpm dev                          # 包括 5180 端口的换算独立页面
pnpm --filter @t-box/converter-web dev
pnpm --filter @t-box/api exec tsx --test test/converter.test.ts
# 集成测试仅使用已初始化的隔离测试数据库
MYSQL_DATABASE=t_box_test_converter pnpm db:init
MYSQL_DATABASE=t_box_test_converter pnpm --filter @t-box/api exec tsx test/converter.integration.ts
```

独立页面必须从已登录的宿主桌面打开，以建立受控 SDK 桥。根目录 `pnpm build` 会生成静态产物；PM2/Docker 首次部署也包含换算种子。手动 Actions「子应用发布（OSS）」可选择「单位换算 (converter)」，上传后提交后台待审核，选择对应版本发布后用户再从市场更新；不会自动上架。
