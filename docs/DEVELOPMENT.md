# 复刻仓库开发指南

维护仓库：[h1255514288/xscript](https://github.com/h1255514288/xscript)。上游：[JackLuguibin/xscript](https://github.com/JackLuguibin/xscript)。

这份指南用于修改 XScript 平台本身。只想编写手机自动化脚本时，先看 [十分钟上手](十分钟上手.md)。

## 环境与首次安装

通用开发需要 Git、Python 3.10+ 和 npm。Node 推荐使用根目录 `.nvmrc` 指定的 22 系列最新版；控制台测试依赖要求 22.22.2+、24.15.0+（24 系列）或 26+，22 早期版本和 24.14 不满足要求。后台与 MCP 推荐使用上游 CI 覆盖的 Python 3.12；设备内置运行时和 Android 构建机仍需 Python 3.10。

Windows PowerShell、cmd、Linux 和 macOS 使用同一入口，无需激活虚拟环境。在仓库根目录执行（系统只有 `python3` 时替换命令中的 `python`）：

```bash
python scripts/dev.py doctor
python scripts/dev.py setup
python scripts/dev.py check repo python console
```

`setup` 默认创建 `.venv`，安装后台与 MCP 的测试依赖，并通过 `npm ci` 安装控制台依赖。它使用执行该命令的 Python 创建虚拟环境，不修改系统 Python。再次执行复用现有环境；不要在不同 Python 版本之间复用 `.venv`。

安装遵循各组件的 `pyproject.toml` 和 `package-lock.json`，不要为解决一次下载失败而随意升级已固定的版本。已有 `node_modules` 会由 `npm ci` 按锁文件重建。

先预览将执行的命令：

```bash
python scripts/dev.py setup python console --dry-run
python scripts/dev.py check repo python console extension webide --dry-run
```

只开发 Python 或 VS Code 扩展时可以单独安装：

```bash
python scripts/dev.py setup python
python scripts/dev.py setup extension
```

`doctor` 检查 Python、Git、Node 和 npm，并显示可选 JDK/ADB 的位置。它不代表 Android SDK 或设备权限已经配置完成。

## 在本机启动后台

完成 `setup` 后先构建控制台：

```bash
npm --prefix backend/web run build
```

Windows PowerShell：

```powershell
.\.venv\Scripts\python.exe -m xscript_server init --data xscript-data
.\.venv\Scripts\python.exe -m xscript_server serve --data xscript-data --port 8765
```

Linux / macOS：

```bash
.venv/bin/python -m xscript_server init --data xscript-data
.venv/bin/python -m xscript_server serve --data xscript-data --port 8765
```

初始化按提示创建自己的管理员账号；数据目录已经初始化时跳过 `init`。访问 `http://127.0.0.1:8765/`，终端按 Ctrl+C 停止服务。本地数据放在已忽略的 `xscript-data/` 中。控制台热更新、PostgreSQL 与部署配置见 [后台说明](../backend/README.md)。

## 选择验证范围

| 修改内容 | 命令 | 验证范围 |
| --- | --- | --- |
| 文档、生成文件、开发入口 | `python scripts/dev.py check repo` | 入口回归测试、已跟踪文件检查、文档链接、六类生成文件一致性 |
| 后台、MCP、设备 HTTP 客户端 | `python scripts/dev.py check python` | 后台单元测试、MCP 单元测试、mock 设备集成链路 |
| 管理控制台 | `python scripts/dev.py check console` | 现有前端测试、类型检查与生产构建 |
| VS Code 扩展 | `python scripts/dev.py check extension` | TypeScript 编译、单元测试、与 PyCharm 共用模板的一致性 |
| 设备 Web IDE | `python scripts/dev.py check webide` | Node 测试；浏览器用例是否执行取决于 Chrome 检测结果 |

`check` 不带目标时只执行 `repo`。指定多个目标时依次执行；失败立即返回非零退出码；明确选择的组件缺少依赖时报错，不会被当作通过。查看测试输出中的 skip，尤其是浏览器和设备相关用例。

Windows 的 `check webide` 默认逐个执行测试文件，避免多个浏览器实例同时启动导致超时；Linux / macOS 保留 Node 默认并行策略。配置 `CHROME` 为本机 Chrome / Edge 可执行文件路径后执行浏览器用例。

Windows 后台测试会明确跳过依赖 Unix 进程组/`pkill` 的三个打包工作进程用例；这些仍由 Linux CI 验证。没有 Python 3.10 时，加密脚本保护的相关测试也会跳过。扩展测试创建临时符号链接，需要 Windows 开发者模式或具备相应权限的终端。入口会向 Node 测试传递当前 Python 路径，避免依赖 Windows 上未安装的 `python3` 命令；显式设置的 `PYTHON` / `XSCRIPT_TEST_PYTHON` 优先。

`check_repo_files.py` 默认只检查 Git 已跟踪文件；提交前暂存新文件后另跑 `python scripts/check_repo_files.py --staged`。

现有 [完整 CI](../.github/workflows/ci.yml) 继续覆盖 Python 3.10/3.12、覆盖率、PostgreSQL、设备 Python 运行时、Android 构建、桌面端和编辑器。新增 [开发工具 CI](../.github/workflows/dev-tools.yml) 在 Windows 与 Linux 验证通用入口。便携入口不代替完整 CI：

- Android：按 [Android 说明](../android/README.md) 安装 JDK、SDK、Python 3.10，并在 Bash / Git Bash 中运行 `android/build.sh`；PowerShell 直接运行 `.sh` 不受支持。
- 设备运行时：沿用 [根目录测试说明](../README.md#开发与测试) 的 `.venv-rt` 和手机依赖版本。
- 桌面端：按 [桌面端说明](../desktop/README.md) 配置独立 Qt 环境，执行前端与 Python 测试。
- 完整本机检查：依赖齐全的 Bash 环境中运行 `bash scripts/verify.sh`，检查它列出的所有跳过项。
- 真机验证：按对应 `scripts/device_*.py` 的参数说明执行，记录设备、Android 版本、运行模式和结果。

## 开始一个新功能

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/my-feature
```

先按 [新功能工作流程](WORKFLOW.md) 明确需求和验收，再按 [扩展规范](EXTENDING.md) 确定影响面、修改代码和测试。功能、交付与发布模板均在工作流程中链接；建议先后顺序见 [迭代计划](ITERATION_PLAN.md)。上游同步、提交和发布规则见 [贡献指南](../CONTRIBUTING.md)。
