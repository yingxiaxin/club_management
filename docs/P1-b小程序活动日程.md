# P1-b：小程序今日 / 本周活动 + 详情（只读）

> P1 第二刀。RSVP / 订阅提醒见 P1-c 及后续。

## 范围

- 云函数 `memberApi`：`listSchedule`、`getActivity`
- 日程匹配：`scheduleMatch.js`（上海时区；兼容 `startSchedule` 分量，不单靠 `startAt`）
- 小程序：首页今日摘要、`pages/activities` 列表、`pages/activity-detail` 详情
- 可见状态：仅 `published` / `ongoing`；访客不可见（同成员列表权限）

## 不做

- RSVP（P1-c）
- 「提醒我」订阅授权与推送
- 组队列表（详情仅提示已开启组队）
- 草稿 / 已取消 / 已结束 不出现在成员端

## 匹配规则（摘要）

| 开始分量 | 今日 | 本周 |
|----------|------|------|
| 完整年月日（或有 `startAt`） | 该日 | 落在本周一～日 |
| 仅周几（±时间） | 今天是该周几 | 本周恒命中 |
| 仅时间 | 每天 | 每天 |
| 仅「日」±时间 | 今天日号相同 | 本周内日号相同的那天 |

## 紧迫度（相对开始时刻）

有开始**时间**才计算；无时间则类型 label 保持默认品牌金。

| 档次 | 条件 | 类型 label | 标题字色 |
|------|------|------------|----------|
| `hot` | 已开始，或距开始 ≤10 分钟 | 橙红字 + 🔥 | 奶油白微偏橙红 |
| `soon` | 距开始 >10 分钟且 ≤1 小时 | 琥珀字 + ⏰ | 微偏黄 |
| `calm` | 距开始 >1 小时 | 苔绿字 + 🍃 | 微偏绿 |

色值在 `miniprogram/styles/tokens.wxss`；样式类 `styles/urgency.wxss`。

## 验收

> **2026-10-22 用户验收通过**（含紧迫度三档）。

1. [x] 管理端发布「周几 + 时间」活动后，对应日出现在小程序「今日」；整周出现在「本周」
2. [x] 草稿不可见；未绑定成员 403
3. [x] 详情只读：标题 / 类型 / 开始结束文案 / 说明；组队入口占位
4. [x] `node cloud/dev-server/scripts/smoke-p1b-schedule.mjs` 通过

## 部署

1. 重新部署云函数 **`memberApi`**（含 `activitiesDb.js` / `scheduleMatch.js`）
2. 开发者工具打开仓库根目录，编译小程序
3. 管理端先发至少一条已发布活动再测

## 路径

| 端 | 路径 |
|----|------|
| 匹配逻辑 | `cloud/functions/memberApi/scheduleMatch.js` |
| 云函数入口 | `cloud/functions/memberApi/index.js` |
| 冒烟 | `cloud/dev-server/scripts/smoke-p1b-schedule.mjs` |
| 小程序列表 | `miniprogram/pages/activities/` |
| 小程序详情 | `miniprogram/pages/activity-detail/` |
