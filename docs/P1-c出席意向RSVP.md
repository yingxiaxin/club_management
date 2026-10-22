# P1-c：出席意向 RSVP

> P1 第三刀。订阅提醒见后续。

## 范围

- 云库集合：`activity_rsvps`（文档 id = `{activityId}__{memberId}`）
- `memberApi`：`setRsvp`；`getActivity` / `listSchedule` 挂载汇总
- 小程序详情：参加 / 待定 / 请假；各状态人数与名单（可展开）
- 列表：有表态时展示人数摘要

## 规则

| 项 | 说明 |
|----|------|
| 状态 | `going` 参加 / `maybe` 待定 / `decline` 请假 |
| 谁可表态 | 须绑定有效成员档案（管理员未绑定不可代点） |
| 何时可改 | 活动 `published` 且开始时刻未到（无开始时间则可改）；`ongoing` 或已开始 → 锁定 |
| 唯一性 | 同一成员同一活动仅一条，重复提交为更新 |

## 不做

- 管理端 RSVP 看板（可后续加）
- 订阅消息「提醒我」
- 组队

## 验收

> **2026-10-22 用户验收通过。**

1. [x] 绑定成员后在详情可切换三态；汇总人数与名单更新  
2. [x] 未绑定 / 访客 403  
3. [x] 活动已开始（或进行中）不可改，页面有提示  
4. [x] 列表可见「参加 · 待定 · 请假」人数（有人表态时）

## 部署

1. 重新部署云函数 **`memberApi`**（含 `rsvpsDb.js`）  
2. 云库若无 `activity_rsvps`，首次 `setRsvp` 会尝试 `createCollection`  
3. 小程序重新编译后测详情页  

## 路径

| 端 | 路径 |
|----|------|
| RSVP DB | `cloud/functions/memberApi/rsvpsDb.js` |
| 云函数 | `cloud/functions/memberApi/index.js` |
| 详情页 | `miniprogram/pages/activity-detail/` |
