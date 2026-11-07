# 常用 API 场景示例

示例用于 XScript 工程的 `__init__.py`。新工程使用 `xscript.android`；迁移已有 AScript 工程时保留原导入，再核对 [兼容边界](API.md#ascript-兼容)。参数和返回值见 [API 参考](API.md)。

## action：操作已经确认的节点

从节点工作台获取实际文字，通过工程运行参数传入 `target_text`。以下代码只在唯一命中时点击；没有参数或多匹配时停止并打印原因。

```python
from xscript.android import action, node, system

target = system.params().get("target_text")
if not target:
    raise ValueError("请传入实际观察到的 target_text")
hits = node.Selector(0).text(target).find_all(timeout=0)
if len(hits) != 1:
    raise RuntimeError("目标应唯一，实际匹配 %d 个" % len(hits))
hits[0].click()
action.sleep(0.2)
print("已点击目标，后续应重新观察页面确认结果")
```

常见失败：节点通道未就绪、文字重复、页面变化或目标被窗口遮挡。匹配成功不能代替业务结果确认。需要全树布局节点时，获取和查询都使用模式 `1`。

## node：观察节点并验证定位

```python
from xscript.android import node

print(node.dump(0))
```

在 [节点工作台](NODE_WORKBENCH.md) 点选控件，先在线测试再复制查询。原生字符串默认精确匹配，正则使用 `.regex().text(".*目标.*").regex(False)`，目标替换为实际需要的文字。普通文本中的 `+`、`(` 需要转义或使用精确匹配。

常见失败：简单树没有布局节点；正则不合法；多匹配时 `.find()` 仅返回第一项。AScript 兼容层字符串默认是正则，空 `find_all()` 返回 `None`，原生 API 返回空列表。AScript `Node.path` 是类路径、`Node.node_path` 是结构路径；原生 `Node.path` 是结构路径。

## screen：检查权限后保存截图

```python
from xscript.android import screen, system

print("屏幕尺寸：", screen.size())
status = screen.capture_status()
if status["ok"]:
    screen.strict_capture(True)
    print("截图文件：", screen.capture(system.R.root("latest.png")))
else:
    print("需要处理：", status["reason"])
```

常见失败：录屏授权失效、锁屏、安全页面禁止截图。找图前把真实模板放入工程 `res/img/`，不要引用没有上传的图片。OCR 首次加载可能较慢；图色接口见 [API 参考](API.md)。

## system：工程资源与持久化

```python
from xscript.android import system

key = "api_examples.runs"
runs = int(system.KeyValue.get(key, 0)) + 1
system.KeyValue.save(key, runs)
print("示例运行次数：", runs)
print("工程资源目录：", system.R.res())
```

`KeyValue` 跨运行保留，测试结束可用 `system.KeyValue.remove(key)` 清理本例的值。工程模块使用相对导入，如 `from .helper import run`。兼容层 `reboot` 重启工程进程，不是手机重启。

## ui：检查悬浮窗权限

```python
from xscript.android import ui

if ui.can_overlay():
    ui.toast("XScript 示例已启动")
else:
    print("请在手机设置中允许 XScript 显示悬浮窗")
```

交互式表单可使用 `ui.prompt`、`ui.confirm`，会等待用户选择；不要在要求立即返回的探测请求中打开它们。脚本退出后，所属窗口随运行时清理。

## cloud：检查连接并上报结果

```python
from xscript.android import cloud

if cloud.connected():
    print("上报成功：", cloud.send({"task": "api-example", "status": "ready"}))
else:
    print("云控未连接，请先在 XScript 首页配置自己的后台")
```

连接沿用首页配置，令牌不写入示例。`send()` 为 False 不能视为服务端已收到。响应消息使用 `cloud.on_message` 或有超时的 `cloud.wait_message(timeout=5)`；服务端规则见 [云控](CLOUD.md)。

## pip：检查工程依赖

```python
from xscript.android import pip

packages = pip.list()
print("已安装包数量：", len(packages))
print([p["name"] for p in packages])
```

第三方包在工程 `requirements.txt` 声明并固定验证过的版本；首次启动会联网安装缺少的包。也可在导入 `system` 后使用 `pip.install_requirements(system.R.root("requirements.txt"))`。原生包须有适配当前 Android ABI 的 Chaquopy wheel，电脑安装成功不能代替手机验证。不要提交 `site-packages` 或虚拟环境。

## 验证与扩展

先在目标设备运行需要的单个示例，记录设备、通道、权限和结果。点击示例先在测试页面执行。控件和权限随环境变化，没有设备实测的示例不能称为业务验收通过。

`test_ascript_compat.py` 对选择器迁移、HID 降级警告、未支持插件、官方云入口和 NCNN 转换要求做回归；设备控制、图色和权限另有运行时测试。后续 API 变化同步本文件与 [扩展规范](EXTENDING.md)。
