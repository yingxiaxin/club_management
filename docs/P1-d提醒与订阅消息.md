# P1-d：提醒配置 + 「提醒我」订阅

> P1 第四刀。UI/记账已通；**真推送依赖微信订阅消息模板**（见下方收尾教程）。

## 范围（已实现）

- 云库：`club_profile`（`club_main`）、`subscriptions`、`reminder_jobs`
- 管理端：`/reminders` 默认提前量 + 模板 ID + 下发环境
- 本机 API：`GET/PUT /api/club-profile`
- 小程序详情：「提醒我」→ `requestSubscribeMessage`（有模板时）→ `subscribeActivityReminder`
- 云函数 **`reminderDispatch`**：每分钟扫描并发送（需部署 + 开通定时触发器）

## 规则

| 项 | 说明 |
|----|------|
| 默认提前量 | 俱乐部可多选 5/10/15/30/60/120；默认 `[10]` |
| 活动覆盖 | 活动上的 `reminderCycle` / `reminderOffsetsMinutes` 优先；`none` 不发 |
| 谁可订阅 | 须绑定成员；活动未到开始且非「不提醒」 |
| 发送字段 | 已对齐模板「活动集合通知」：`thing1` 活动名称、`time3` 集合时间、`thing5` 备注 |
| 旧数据 | 仅有提前量、无 `reminderCycle` 时，按开始分量推断（完整日期 → `once`）；可用 `_backfill-reminder-cycle.mjs` 回填 |

## 验收进度

1. [x] 管理端可保存默认提前量 / 俱乐部名（写入修复后）  
2. [x] 小程序详情可点「提醒我」；可写入 `subscriptions`  
3. [x] 配好模板后，提前量窗口内真收到订阅消息（或云函数日志 `sent`）  
4. [x] 活动「不提醒」时详情有说明；开启周期后出现按钮  

---

## 收尾教程（给换 Agent：逐步教用户）

> **目标**：用户自己能在微信侧申请模板、填进后台、部署定时函数并验证推送。  
> Agent 以讲解+核对为主；用户卡在控制台操作时逐步带做。

### 步骤 A — 申请订阅消息模板

1. 打开 [微信公众平台](https://mp.weixin.qq.com/) → 登录小程序（AppID `wx0a3fc7a2aee9f66f`）  
2. **功能 → 订阅消息 → 公共模板库**（或「我的模板」）  
3. 选用适合「活动开始提醒」的模板，尽量包含：  
   - 活动名称类（常为 `thing*`）  
   - 时间类（常为 `time*` / `date*`）  
   - 备注/提示类（常为 `thing*`）  
4. 添加到「我的模板」，复制 **模板 ID**  
5. 把模板里每个字段的 **关键词 + 字段名**（如 `thing1` / `time2`）记下来，发给 Agent 或对照步骤 C  

### 步骤 B — 填入管理端

1. 确认本机 API 已启：`cloud/dev-server` → http://127.0.0.1:3789  
2. 管理端 http://127.0.0.1:5173 → **提醒设置**  
3. 粘贴 **订阅消息模板 ID**；下发环境选 **开发版**（联调）  
4. 保存并刷新，确认 ID 还在  

### 步骤 C — 字段对齐（易踩坑）

当前模板（编号 67212「活动集合通知」，已写入代码）：

| 代码字段 | 关键词 | 内容 |
|----------|--------|------|
| `thing1` | 活动名称 | 活动标题 |
| `time3` | 集合时间 | `yyyy年MM月dd日 HH:mm` |
| `thing5` | 备注 | 「将于 N 分钟后开始」 |

模板 ID 填管理端即可。若以后换模板：改 `reminderDispatch` 里 `data: { ... }` 的 key 后重新部署。

### 步骤 D — 部署云函数

1. 微信开发者工具打开**仓库根目录**  
2. 上传并部署：  
   - **`memberApi`**（若尚未含最新订阅相关文件）  
   - **`reminderDispatch`**（务必开启 **定时触发器** `reminderTick`；权限含 `subscribeMessage.send`）  
3. 云开发控制台确认 `reminderDispatch` 触发器为每分钟  

### 步骤 E — 联调真推送

1. 管理端建/改一场**未开始**的活动：提醒周期非「不提醒」，提前量建议先用 **5 或 10 分钟**，开始时间设在「当前 + 提前量 + 一两分钟」  
2. 小程序（开发版）进入详情 → **提醒我** → 授权允许  
3. 云库 `subscriptions` 应有 `status=active` 记录  
4. 等到触发窗口（定时器每分钟扫；到期前后约 2 分钟窗口）  
5. 查：手机是否收到；或云函数日志 / `reminder_jobs` 是否 `sent`  
6. 若一直是 `skipped_no_template` → 模板 ID 未写入或未读到 `club_profile`  
7. 若 `failed` → 看 `error`（多为字段名不符或未授权）  
8. 若同一提前量收到两次：多为 `reminder_jobs` 去重未写入（旧版 `update` 空文档不落库）；已改为先 `sending` 再 `set`。须重新部署 `reminderDispatch`  


### 步骤 F — 验收通过后

- 勾选本文件验收第 3 项；更新 `docs/进度与交接.md`  
- 下发环境可按发版情况改为体验版/正式版  
- 默认下一刀：**公告 / 俱乐部资料**  

---

## 部署速查

1. 重启 `cloud/dev-server`  
2. 部署 **`memberApi`** + **`reminderDispatch`**（定时触发器）  
3. 管理端填模板 ID；小程序编译为开发版  

## 路径

| 端 | 路径 |
|----|------|
| 本机 club | `cloud/dev-server/src/cloudClub.js` |
| 管理端页 | `admin/src/views/RemindersView.vue` |
| 订阅 DB | `cloud/functions/memberApi/subscriptionsDb.js` |
| 调度 | `cloud/functions/reminderDispatch/` |
| 详情 | `miniprogram/pages/activity-detail/` |
| 回填脚本 | `cloud/dev-server/scripts/_backfill-reminder-cycle.mjs` |
