# 新功能扩展规范

先描述用户场景、输入输出、失败行为和验收标准，再选择修改层。详细组件关系见 [技术架构](ARCHITECTURE.md)，当前功能边界见 [功能对照](功能对照.md)。

从提出需求到验收和发布的完整步骤见 [新功能工作流程](WORKFLOW.md)；可复用 [功能说明模板](templates/FEATURE.md)。小改动不要求填写完整模板。

## 功能放在哪里

| 功能方向 | 主要目录 | 需要同步考虑 |
| --- | --- | --- |
| Android 权限、服务、系统桥接、原生 UI | `android/app/` | 生命周期、线程、无障碍/root 模式、权限拒绝、JVM 与真机测试 |
| 设备 Python API、AScript 兼容 | `android/python-runtime/` | 旧接口兼容、类型存根、编辑器补全、设备行为 |
| 设备 HTTP API | `protocol/openapi.yaml` 与 Android 服务端实现 | 路由、鉴权、错误响应、各客户端、mock 设备 |
| 云控、授权、用户、数据存储 | `backend/xscript_server/` | SQLite/PostgreSQL、数据迁移、权限、控制台 |
| 管理控制台 | `backend/web/` | 服务端契约、加载/空态/错误态、测试与类型检查 |
| MCP 工具 | `ide/mcp-server/` | API 参数、超时、错误信息、工具目录与设备权限 |
| VS Code / PyCharm 集成 | `ide/vscode-extension/`、`ide/pycharm-plugin/` | 设备协议、模板与存根同步、命令入口 |
| 桌面应用与流程节点 | `desktop/` | Qt 与前端通信、节点描述、持久化兼容、前后端测试 |
| 使用示例和文档 | `examples/`、`docs/` | 可运行示例、支持范围、设备前置条件 |

## 公共 API 的变更顺序

1. 先更新接口实现及行为测试；设备 HTTP 接口同步 [OpenAPI 契约](../protocol/openapi.yaml)。
2. 对现有参数优先做兼容性扩展，保留默认行为；破坏性调整需写清迁移方式。`xscript.*` 和 `ascript.*` 的兼容差异应明确说明。
3. 按依赖顺序重新生成派生文件：

   ```bash
   python scripts/gen_stubs.py
   python scripts/gen_completions.py
   python scripts/gen_editor_docs.py
   python scripts/gen_nodespecs.py
   python scripts/gen_api_catalog.py
   python scripts/gen_connect_check.py
   python scripts/dev.py check repo
   ```

4. 检查生成差异，只保留与本功能有关的变更。生成文件的源头和用途以各脚本说明为准，不直接修改生成结果。
5. 更新对应客户端、mock、文档和示例，执行受影响模块的检查。

## 测试与验收

每个行为变更至少覆盖成功路径和重要失败路径，例如缺权限、设备断连、无结果、参数非法或旧数据兼容。修复问题时先增加能够复现它的回归用例；简单文档修改不需要机械添加测试。

跨层功能应有一条可重复的集成验证路径。设备 API 可以先用 `scripts/mock_device.py` 与现有 mock 集成验证客户端契约，随后对设备行为做真机检查。有关界面控件、坐标和识别结果必须依据实际观测；设备脚本规则见 [AGENT_RULES](AGENT_RULES.md)。

PR 中记录执行命令、通过结果、跳过项和原因。修改 Android、Qt 或图色能力却没有对应环境时，明确留出真机/桌面验收，不能把静态检查写成实测通过。

## 后续迭代

基础设施稳定后，每个新功能以独立 Issue 和分支推进。建议按以下顺序评估需求：现有流程的可靠性与错误提示、设备连接与脚本调试体验、图色和流程节点能力、云控与部署体验。具体优先级由实际使用需求决定；上游未实现的项目以 [路线图](路线图.md) 为参考，不在复刻时预先承诺实现。
