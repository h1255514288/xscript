# 代码保护的使用与验证

`--protect` 将工程 Python 源码编译成与设备一致的 **Python 3.10 字节码**，输出 `.pyc`，保留资源。它提高直接复制源码的门槛，不能防止字节码反编译，也不实现 AScript V4 密文格式。

## 构建要求

构建机安装 Python 3.10，通过 `XSCRIPT_BUILD_PYTHON` 指定解释器；也可自动查找 `python3.10` 或 `uv python find 3.10`。其他小版本生成的字节码无法在当前设备运行时导入。

PowerShell 示例，替换解释器与工程路径：

```powershell
$env:XSCRIPT_BUILD_PYTHON = 'C:\Python310\python.exe'
python backend/xscript_pack.py examples/xs_smoke --app-id com.example.smoke --name "代码保护示例" --protect --out dist/
```

其余参数见 [APK 打包](PACKAGING.md)。后台勾选保护时，实际执行 APK 构建或热更新 bundle 生成的机器也需要此解释器；远程打包机需各自配置。

## 产物与失败行为

- APK 打包先复制工程到临时目录再编译，原始工程保留。
- 热更新保留上传的 `source.zip`，生成 `bundle-pyc.zip` 和摘要；保护包有 `__init__.pyc`，不含工程 `.py`，图片与配置保持原样。
- 语法错误、缺少解释器或版本不匹配使构建失败，不会生成可用的保护 bundle。
- 底层 `compile_tree()` 会替换传入目录中的源码，只在临时副本上调用，不要对正在维护或运行的工程直接调用。
- 原生第三方库仍需要 Android ABI 支持；代码保护不改变依赖的运行平台。

## 验证步骤

1. 运行 `python -m unittest discover -s backend/tests -p test_protect.py -v`，确认未因缺少 3.10 被跳过。
2. 核对源码编译后的真实导入、资源保留、原始上传保留、错误解释器拒绝、语法错误不生成保护包。
3. 检查 APK 中 `assets/pack/<工程名>/`，入口为 `.pyc`，没有工程源码，不能只凭“打包成功”推断已保护。
4. 在同版本运行时的测试设备启动，确认相对导入、资源和需要的设备操作正常。
5. 保存源码、依赖、构建参数与解释器版本；需要恢复时，重新构建已验证版本，沿用自己的签名和递增 APK 版本码。

主机测试证明编译与包结构，设备运行和签名覆盖升级另行验收。服务端私钥、长期令牌不能随源码或字节码工程分发。
