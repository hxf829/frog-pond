# 🐸 青蛙池塘 Frog Pond

一个给孩子自由探索编程的池塘游戏，参考 Computer History Museum 的 Frog Pond 展项及其 CHI 2014 论文 *Programming in the Pond*。本项目针对单屏 iPad 和幼儿做了自己的调整，并非官方作品。游戏使用 HTML、CSS、JavaScript；iPad App 使用 Xcode 封装并内置游戏资源。

## 安装 iPad App

项目包含可离线运行的 iPad App，要求 iPadOS 16 或更新版本。源代码及游戏资源必须保留在当前项目目录，不能只拷贝 Xcode 工程文件。

1. 使用数据线连接并解锁 iPad，在 iPad 上选择信任此电脑。
2. 在 Mac 的 Xcode 中打开 `ios/FrogPond.xcodeproj`，在 **Xcode → Settings → Accounts** 登录 Apple 账号。
3. 选择项目的 **FrogPond** target，在 **Signing & Capabilities** 中勾选 **Automatically manage signing** 并选择自己的 Team。如果 Bundle Identifier 已被使用，改成自己独有的标识，例如 `com.example123.frogpond`（每一段只使用英文字母、数字和连字符）。
4. 在 iPad 的 **设置 → 隐私与安全性 → 开发者模式** 中开启开发者模式并按提示重启。如果看不到该选项，先连接 Xcode 并尝试运行一次。
5. 在 Xcode 顶部的运行设备中选择自己的 iPad，点击 ▶。首次运行时按提示在 iPad 上信任开发者。安装并验证后可从主屏幕启动游戏，游戏资源已内置，游玩时无需连接 Mac 或网络。

免费 Apple 账号可以使用 Personal Team 安装到自己的设备，但签名通常 7 天后过期，需要用 Xcode 重新安装。付费开发者账号可按 Apple 的签名和设备注册规则分发应用。详见 Apple 的[账号与签名说明](https://developer.apple.com/help/account/basics/about-your-developer-account)和[开发者模式说明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)。

运行 `sh ios/build-unsigned.sh` 可以生成 `ios/build/FrogPond-unsigned.ipa`。这个包**未签名，不能直接安装到 iPad**；本机没有可用的 Apple 开发签名证书时，请使用上述 Xcode 方式签名并安装。拥有相应开发者计划和注册设备时，也可以在 Xcode 中通过 **Product → Archive → Distribute App** 导出已签名的安装包。

也可以运行 `sh ios/test-simulator.sh <iPad模拟器UDID>` 验证 iPad 模拟器中的离线页面、积木执行和蛙鸣加载；使用 `xcrun simctl list devices available` 查看模拟器 UDID。

## 在 iPad 浏览器上玩

1. 让 iPad 和 Mac 连接同一个 Wi-Fi。
2. 在 Mac 上双击 `start-server.command`，打开终端显示的访问地址。
3. 用 iPad 的 Safari 打开地址，也可以点分享 → **添加到主屏幕**。

本地服务器禁止缓存游戏文件，重新打开或刷新页面即可加载最新版本。如果之前已经启动服务器，请先关闭旧服务器，再重新运行 `start-server.command`。旧版的游戏离线缓存会在联网打开游戏时清除，不会清除其他网站的数据。浏览器版本需要连接本地服务器；如果改用其他服务器部署，也需要在该服务器配置 `Cache-Control: no-store` 响应头。

## 怎样玩

默认进入「自由池塘」。池塘里只有一只青蛙，甲虫会飞来飞去。大小不同的荷叶上有路线和落脚点，大荷叶上可以有多个落脚点。点下面的图案积木，再按绿色的 ▶ 运行，让青蛙按顺序行动。青蛙面对前方相邻落脚点上的虫子时，使用「吃」就会伸出舌头把虫子拉进嘴里并得分。飞行中的虫子需要等它落下才能吃。

池塘右下角的虫虫收集会显示四种颜色的虫子。吃到某种颜色后，对应图案亮起并显示数量；每种颜色至少吃到一只，就会显示胜利画面并自动进入下一个挑战。切换玩法后重新计数。

- **跳**：朝青蛙箭头的方向，沿路线跳到相邻落脚点；荷叶之间水面太宽、没有路线时不能跳。
- **左转 / 右转 / 转身**：改变方向。
- **叫**：让青蛙叫一声。
- **吃**：吃掉青蛙正前方相邻落脚点上的虫子。
- **如果 / 重复**：把积木放进凹槽，尝试条件判断和循环。
- 点路线连接的相邻落脚点，也可以直接让青蛙跳过去。

积木可以点按添加，也可以拖入程序；拖动程序里的积木可以改变顺序。点击积木之间的插入线，或者点一个凹槽，可以选择接下来添加积木的位置。「如果」可以选择条件并添加「否则」分支；「重复」可以选择次数。运行或单步时，当前积木和正在执行的分支会亮起，状态栏显示条件是否成立、循环进行到第几次；循环上的圆点表示当前和已完成的次数，嵌套循环会分别显示进度。

半透明编程区悬浮在池塘上，长程序可以在编程区内滚动；荷叶落脚点仍可直接点按。

青蛙叫声使用 egomassive 在 Freesound 发布的 [Frog.ogg](https://freesound.org/people/egomassive/sounds/536759/) 音效预览（CC0），原始录音为 Craig Smith 的《R01-47-Frog Ribbits》。

顶部可以选择自由池塘或五个小挑战。挑战中的目标虫会停在荷叶上，不会无限重生；完成全部五个挑战后，青蛙们会一起庆祝。挑战进度在当前页面中保留，刷新页面或在通关画面回到池塘会重新开始。清空和删除可以撤销；程序区的重置会停止运行并清空程序和执行进度，保留青蛙、虫子、分数和收集数量。运行中按停止后，可以用单步从停止的位置继续；再次按运行会从程序开头、青蛙当前的位置出发。切换玩法会重新开始池塘。

## 自动测试

运行 `python3 tests/browser_test.py` 检查鼠标和触摸交互，运行 `python3 tests/cache_test.py` 检查缓存响应头和旧缓存清理。测试需要本机安装 Chrome，可用环境变量 `CHROME` 指定路径；模拟屏幕尺寸不能替代真实 iPad 上的测试。

## 与论文原型的主要区别

论文中的第三版使用桌面两端的独立编程面板，控制不同颜色的青蛙；本项目为了适合孩子在 iPad 上玩，使用单只青蛙和单个面板，也不提供孵化指令。论文主要描述设计和测试，不是完整规则说明；本项目的关卡和具体甲虫节奏是自己的设计。
