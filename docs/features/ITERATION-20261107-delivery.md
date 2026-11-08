# 2026-11-07 统一交付与验收

状态：实现、自动验证及本地验收包已准备，待用户业务验收；未合并到 `main`，未公开发布。用户决定 HID 暂不接入。分支 `feat/webide-node-selector`，设备应用基于 v0.6.0 / versionCode 12；后台包版本沿用 0.4.0。确切源码提交、产物摘要见交付包 `SOURCE_COMMIT.txt`、`SHA256SUMS`。

## 交付内容和入口

- Web IDE 的“节点”打开独立工作台 `/tools/ui/nodes.html`。支持截图/树/属性三栏、缩放与定位、正则及 XPath 关系、代码生成、只读在线测试、结果反馈、复制和重置，详见 [专项交付](FEATURE-001-delivery.md)。
- 后台“APK 打包”默认从小程序名称或 zip 文件名填写展示名称，支持手改；“系统设置”新增 OSS / CDN 分发配置与连接测试，上传失败回退后台下载，Secret 不回显、空值保留原值。
- 药丸与展开面板固定 3 秒收起。工程更新先完整写入再交换目录；失败保留或恢复旧工程。预上传与设备查询并发时，每个构建使用独立临时文件，完整发布压缩包及摘要。
- 文档补齐 [协作流程](../WORKFLOW.md)、[API 示例](../API_EXAMPLES.md)、[代码保护](../CODE_PROTECTION.md)、[更新和构建机验收](../UPDATE_BUILD_ACCEPTANCE.md)。兼容回归验证降级提示及未实现能力的明确错误。
- Windows 开发环境修复依赖安装跨进程锁、升级/卸载时 RECORD 文件占用，以及 APK 检查工具的可执行文件和 UTF-8 输出处理。

产物在仓库 `dist/acceptance-20261107/`：debug 通用 APK、后台 wheel、控制台静态文件、VS Code 扩展、对应提交的源码归档、相关说明和摘要；压缩包名称含日期以区分同为 v0.6.0 的既有安装包。构建产物、凭据、依赖与设备快照不提交 Git。

## 实际验证结果

环境：Windows、JDK 25.0.4（本机 Android Studio JBR；项目工具链要求见 Android 说明）、SDK Build Tools 36.0.0、Gradle 9.3.1、Node 24.22.1、主机 Python 3.13.13；运行时及保护编译为 Python 3.10.21。浏览器使用无头 Microsoft Edge。

| 检查 | 实际结果 |
| --- | --- |
| 仓库和生成文件 | `python scripts/dev.py check repo` 通过，9 个入口测试通过，六类生成文件一致；暂存后的文件与文档链接检查通过 |
| 后台 | 最终全量 210 项：205 通过、5 跳过；包含保护、OSS 权限/审计、签名清单回退与并发包构建 |
| MCP | 46 项通过，mock vertical slice 通过 |
| 控制台 | 59 项通过，TypeScript 检查和 Vite 生产构建通过 |
| VS Code 扩展 | 85 项通过，编译与模板一致性通过 |
| Python 运行时 | 499 项：496 通过、3 模型测试跳过；XPath 内部方法改为私有后另跑选择器/兼容 30 项通过 |
| Web IDE | 顺序执行全部 238 项：236 通过、2 Windows 平台跳过，包含真实 Edge 页面交互 |
| Android | `:app:testDebugUnitTest :app:assembleDebug` 通过；54 个测试类，共 283 项通过，无跳过 |
| APK | 包名 `com.xscript.app`、版本 0.6.0 / 12，包含 arm64-v8a / x86_64；签名校验通过，为 Android Debug 证书；节点页面与运行时资源已核对 |
| 16 KB | zip 对齐通过，原生 app 库符合要求；206 个库中 46 个 Python 依赖库仍为 4 KB 对齐，清单启用 `pageSizeCompat`，脚本非 strict 模式通过。未在 16 KB 设备实测 |
| 用户手机只读冒烟 | HONOR PTP-AN10 / Android 16 / SDK 36 / 1280×2800，既有 v0.6.0；145 个节点，实际“日志”节点的精确/包含/正则/XPath/父级/完整树、生成代码执行、刷新保留条件和重置均通过 |

跳过项分别为：后台 3 个 POSIX 工作进程用例、2 个未配置 PostgreSQL 的用例；运行时 3 个缺少模型文件的测试；Web IDE 2 个 POSIX 浏览器失败模拟。Linux CI 和模型环境应继续覆盖，未把跳过计为通过。

Web IDE 默认并行执行在本机出现页面等待超时；顺序执行全部用例通过，未更改断言或删减用例。PowerShell 重现命令（先设置 `CHROME` 指向本机浏览器）：

```powershell
$env:PYTHON = (Get-Command python).Source
$env:XSCRIPT_TEST_PYTHON = $env:PYTHON
$env:PYTHONUTF8 = '1'
$files = Get-ChildItem scripts/tests/*.test.cjs | Sort-Object Name | ForEach-Object { $_.FullName }
node --test --test-concurrency=1 @files
```

Android 文件安全测试创建临时符号链接，需 Windows 开发者模式或相应权限；普通受限终端中 6 项曾因创建链接权限失败，具备权限后全量通过。

## 业务验收

1. 先使用手机既有 XScript 开启开发服务、无障碍与截图权限。电脑可按 [源码预览](../NODE_WORKBENCH.md) 连接设备，验证独立页面、布局、定位、正则、复制、在线测试及重置。
2. 新 debug APK 安装到签名兼容的测试设备后，从设备 Web IDE 的“节点”入口复验；在 IDE 保留未保存脚本，插入生成代码，确认内容和缩进正确。
3. 运行测试工程，将应用放到后台，确认药丸与展开面板无操作约 3 秒缩成小球，触控仍可唤醒；不再显示收起时间设置。
4. 后台分别上传 zip、选择小程序版本，核对默认名称与手动改名；实际构建、安装后核对桌面名称及入口。
5. 按 [更新与构建机验收](../UPDATE_BUILD_ACCEPTANCE.md) 验证 v1 → v2 → 回滚、错误签名/摘要/缺入口/中断保留旧工程，以及远程构建机取消、失联和重试。
6. 有 ADB 测试设备后，可用 `XS_ONLY=idle_timing` 运行 `scripts/device_float_e2e.py SERIAL DEVICE_URL`，记录两种形态的耗时；该新增计时段本轮未在设备执行。

## 限制和恢复

手机验证使用源码页面与既有 APK，未安装本轮 APK，未点击或长按业务控件。手机 ADB 不可用；本机模拟器缺少虚拟化加速，软件启动未成功，不能替代新 APK 安装验收。

未验证真实 OSS 账户、PostgreSQL、跨主机 SDK 构建、系统安装器升级及存储不足。硬件 HID 待提供型号/协议/设备；兼容层目前仅提示一次后降级到普通手势。

交付 APK 使用现有包名和 debug 签名。同包名覆盖安装要求签名一致；签名不同不要通过卸载现有应用来勉强升级，应使用测试设备并保留现有数据。版本码未提升，不把此包作为生产更新推送。

源码预览可关闭进程恢复既有页面；OSS 可在后台关闭以恢复后台下载；更新失败按错误保留的旧工程或备份目录恢复。后台升级先备份数据和签名私钥；未改变数据库结构。Python 字节码保护不等于加密。

用户验收：待反馈。代码提交、自动测试通过、安装验收、合并和公开发布是不同状态，本记录不代填用户验收通过。
