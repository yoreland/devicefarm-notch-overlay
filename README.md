# Device Farm Notch Overlay

一个 Chrome / Edge 浏览器插件（Manifest V3）：在 [AWS Device Farm](https://aws.amazon.com/device-farm/) 远程访问会话的实时画面上，叠加画出 iPhone 的**刘海 / Dynamic Island**。

## 为什么需要它

Device Farm 远程画面是设备的屏幕帧（矩形图像）。刘海和 Dynamic Island 是屏幕上的物理遮挡，不是像素，所以系统截图、录屏和远程画面里都看不到它们。控制台已经画了手机外框和屏幕圆角，但没有刘海。这样在远程调试时，很难判断某个按钮或文字在真机上会不会被挡住。

这个插件把刘海 / 岛按机型和比例画回画面上，方便目测。

- **只是视觉叠加**：叠加层设置了 `pointer-events:none`，点击、拖动、键盘输入都会照常传到真机。叠加内容不会出现在 Device Farm 的截图和录像里。
- **不收集数据**：只申请 `storage` 权限（保存你的设置），只在 `https://us-west-2.console.aws.amazon.com/devicefarm/*` 页面运行，不发任何网络请求。

## 支持的机型（目前只支持 iPhone）

| 类型 | 机型 |
|---|---|
| Dynamic Island | 14 Pro / 14 Pro Max、15 系列、16 系列、17 系列、iPhone Air、18 Pro / 18 Pro Max |
| 刘海 | X / XS / XS Max / XR、11 系列、12 系列、13 系列、14 / 14 Plus、16e |
| 无刘海 | SE（2/3 代）、8、7、6s |

表里没有的新款 iPhone（编号 ≥ 18）会按尺寸档位套用 18 Pro / 18 Pro Max 的参数。Android 设备目前不支持，画面上会提示「未收录机型」。

## 安装

1. 到 [Releases](../../releases) 下载最新的 `devicefarm-notch-overlay-vX.Y.Z.zip` 并解压。也可以 clone 本仓库，直接使用其中的 `extension/` 目录。
2. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），开启右上角的「开发者模式」。
3. 点「加载已解压的扩展程序」，选择解压出来的文件夹（里面能看到 `manifest.json`）。
4. 建议把插件图标固定到工具栏，方便打开设置。

升级时，用新版本覆盖原文件夹，再在扩展页点插件卡片上的刷新按钮。

## 使用

在 us-west-2 的 Device Farm 控制台打开一个 iPhone 远程会话。设备连接后，刘海 / 岛会自动出现在画面顶部。没出现的话，刷新一下页面。

点工具栏的插件图标可以调整：

| 选项 | 说明 |
|---|---|
| 启用 | 总开关 |
| 机型 | 默认根据页面上的设备名自动识别。识别不到或识别错时可以手动选择，只对当前标签页生效 |
| 方向 | 自动 / 强制竖屏 / 横屏（刘海在左 / 右）。自动模式下，横屏时刘海默认在左侧 |
| 刘海不透明度 | 调低后可以看清被刘海挡住的内容 |
| 屏幕圆角 | 默认关闭（控制台已自带圆角），打开后按真机圆角遮住四角 |

画面上的提示：

- **未收录机型**：设备不在机型表里（例如 Android），可以在插件弹窗里手动选择。
- **横屏：控制台把横屏画面裁成竖屏框**：控制台有时会把横屏画面裁进竖向画框，这时刘海所在的那一边不在可见区域里，所以不画。

## 局限

- 刘海 / 岛的尺寸是根据公开资料和实机截图得出的近似值，误差约 1–3pt。iPhone 16 已对照真机画面校准。
- iPhone 18 Pro 系列的岛更小，Apple 没有公布尺寸，目前的宽度是按公开实拍测量估算的。
- 有些全屏内容（例如上下留黑边的竖屏视频）可能被误判成"被裁剪的横屏"，这时可以在插件里选「强制竖屏」。
- 插件依赖 Device Farm 控制台页面的结构。控制台改版后可能需要更新插件（插件内置了按画面形状自动识别的兜底逻辑）。

## 开发与测试

插件本身不需要构建。仓库里有一个本地模拟会话页，可以用 Playwright 加载插件做回归测试，不需要 AWS 账号：

```bash
npm install
npx playwright install chromium
npm test            # 截图输出到 test-output/
```

机型参数在 `extension/devices.js`（竖屏逻辑坐标，单位 pt）。欢迎提 Issue / PR 补充或校准机型。

## License

[MIT](LICENSE)

本项目不是 AWS 官方产品，与 Amazon Web Services 和 Apple 无隶属关系。
