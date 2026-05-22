# Docs

`nanobot-channel-webui/docs/` 现在只保留仍然适合作为“当前事实入口”的文档。

当前项目定位已经从通用聊天入口，调整为「案件研判 + 上图分析 + 对话辅助」的
WebUI 工作台插件。阅读和维护文档时，要优先以 `PRODUCT.md`、`AGENTS.md` 和
case-graph 事实文档为准。

优先阅读：

- [../README.md](../README.md)
  - 插件安装、运行、发布入口
- [../PRODUCT.md](../PRODUCT.md)
  - 当前产品目标、用户和定位
- [../DESIGN.md](../DESIGN.md)
  - 当前长期设计基线
- [case-graph/README.md](./case-graph/README.md)
  - 经侦上图分析器相关事实文档入口
- [case-graph/real-example/](./case-graph/real-example)
  - 原版 `/trade/query` 的真实请求/响应样本，供对比参考

当前硬约束：

- 完整功能实现或运行时行为修改完成后，需要执行 `./scripts/publish-local.sh` 发布到本地，再交给用户测试。
- 测试按风险自主判断：简单文档、文案、索引类修改不需要跑 Python 或前端测试；影响运行时、图谱状态、持久化、发布包或跨端契约的修改才需要有针对性验证。
- 上图分析中的图结构和布局位置是研判过程资产；自动扩图、钻取、刷新、加载和回放不能移动已有节点。

清理原则：

- 删除只描述某个阶段执行过程的 `plan` / `design` / `release-notes` 文档
- 删除已经被当前事实文档吸收、继续保留只会制造分叉的文档
- 删除一次性调试产物或临时样例文件
- 保留可复用的真实样本快照，例如 `case-graph/real-example/` 下的请求/响应基线
- 如果文档事实已经不符合当前代码、`~/.nanobot/workspace/.nanobot_channel_webui` 过程文件或产品定位，要随功能修改一并更新

当前目录应视为“索引层”，不是历史档案层。
