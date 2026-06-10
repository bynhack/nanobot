# Case Audit Docs

这组文档记录当前“涉诈资金审计”独立功能的产品事实、功能状态和待办问题。

涉诈资金审计不是案件资金上图的一个弹层视图，而是围绕金额认定的独立工作流：
以被害人被骗入账或上一层已认定金额为起点，按交易时间分段累计资金池，遇到
嫌疑人出账时按最低口径形成可认定金额，并支持继续向下级资金链逐层追踪。

当前应优先阅读：

- [feature-tracker.md](./feature-tracker.md)
  - 当前涉诈资金审计功能台账
  - 用于区分已完成、部分完成和后续优化项
- [pending-fixes.md](./pending-fixes.md)
  - 当前 UI、交互、组件化和产品语义仍待处理的问题
- [../case-audit-amount-recognition.md](../case-audit-amount-recognition.md)
  - 金额认定、最低可认定、余额可覆盖和排除关联的通俗说明

维护原则：

- 功能状态变化写入 `feature-tracker.md`
- 当前待办、缺陷和开放决策写入 `pending-fixes.md`
- 不按原版实现做差异跟踪；当前产品以本项目代码、用户工作流和审计证据输出为准
- 涉及 UI 组件化时，应优先复用 `frontend/src/components/ui/` 下的通用组件，再补页面特定样式
