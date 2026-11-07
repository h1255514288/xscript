# 开发与贡献

本仓库是 [JackLuguibin/xscript](https://github.com/JackLuguibin/xscript) 的 MIT 复刻，维护地址为 [h1255514288/xscript](https://github.com/h1255514288/xscript)。保留原作者署名、许可证与上游历史。

完整协作与验收方式见 [新功能工作流程](docs/WORKFLOW.md)，建议推进顺序见 [迭代计划](docs/ITERATION_PLAN.md)。从 [开发指南](docs/DEVELOPMENT.md) 配置环境、运行测试；从 [扩展规范](docs/EXTENDING.md) 确认新功能应修改哪些模块。现有用户使用方式见 [README](README.md)。

## 工作流程

1. 从最新 `main` 创建 `feat/<主题>`、`fix/<主题>` 或 `chore/<主题>` 分支。
2. 在 Issue 或 PR 中写明使用场景、预期结果、兼容性和验收方式。
3. 实现范围尽量小；行为变更增加能复现问题或验证结果的测试。文档调整不要求添加无意义的测试。
4. 执行 `python scripts/dev.py check repo`，再运行所改模块的检查。设备权限、手势、OCR、屏幕和生命周期变更另做真机验证；mock 测试不能代替它们。
5. 公共接口变化同步契约、生成文件、示例与文档；执行 `git diff --check`。
6. 提交 PR，写明实际执行的命令与结果，包括跳过的检查及原因。等待对应 CI 完成再合并。

提交信息使用 Conventional Commits，例如 `feat(mcp): add project metadata tool`、`fix(backend): reject expired credentials`、`docs: explain Windows setup`。不提交虚拟环境、依赖目录、构建产物、设备工程数据、配对码、签名私钥或管理员凭据。

## 上游同步

`origin` 指向自己的复刻，`upstream` 指向原项目。首次克隆自己的仓库后配置一次：

```bash
git remote add upstream https://github.com/JackLuguibin/xscript.git
git remote -v
```

已有 `upstream` 时跳过添加命令。工作区干净后，在单独分支合并上游：

```bash
git switch main
git pull --ff-only origin main
git fetch upstream
git switch -c chore/sync-upstream
git merge upstream/main
python scripts/dev.py check repo
git diff --check
git push -u origin chore/sync-upstream
```

解决冲突后，按本次改动涉及的模块补跑检查，再向本仓库 `main` 提交 PR。不要通过强制推送或重置 `main` 同步上游，否则可能丢失本仓库新增功能。分支名已使用时换一个新的名称。

## 发布与版本

当前复刻仍沿用上游应用 ID、包名、版本规则和兼容接口。开发基础改动不单独提升产品版本。独立发布前先阅读 [发布流程](docs/发布.md)，配置本仓库的签名、发布权限和更新渠道；上游的签名密钥不会随 Fork 复制。需要改应用身份、更新地址或包名时作为单独功能处理，并验证升级与数据迁移。

上游 Release 下载链接用于获取上游构建，本仓库没有发布产物时不要把链接替换为不存在的本仓库 Release。
