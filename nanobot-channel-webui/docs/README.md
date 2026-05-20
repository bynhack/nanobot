# Docs

`nanobot-channel-webui/docs/` 现在只保留仍然适合作为“当前事实入口”的文档。

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

清理原则：

- 删除只描述某个阶段执行过程的 `plan` / `design` / `release-notes` 文档
- 删除已经被当前事实文档吸收、继续保留只会制造分叉的文档
- 删除一次性调试产物或临时样例文件
- 保留可复用的真实样本快照，例如 `case-graph/real-example/` 下的请求/响应基线

当前目录应视为“索引层”，不是历史档案层。
