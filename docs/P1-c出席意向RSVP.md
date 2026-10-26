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
| 何时可改 | `published` / `ongoing`：**开始后仍可改**；按本场**结束时间**锁定（无结束分量 → 开始日 23:59 上海）；`ended`/`cancelled` 不可 |
| 周期换场 | 周期模板本场结束后：**先写 RSVP 快照**再清空 RSVP + 解散队伍；详情/列表滚下一场；当日已结束场次仍可进今日/本周但置底 |
| 唯一性 | 同一成员同一活动仅一条（按活动 id；换场时整表清空），重复提交为更新 |

## 不做

- 管理端 RSVP **看板 / 快照列表页**（仅导出选场次；列表页以后按需）
- 订阅消息「提醒我」（属 P1-d，已另做）
- 组队
- Excel 专用格式（与成员导出一致，仅 CSV；Excel 可直接打开）
- 换场前未部署新版 `memberApi` 的历史场次（无快照则无法补导）

## 管理端：按活动导出 RSVP（增补 · 2026-10-26）

| 项 | 约定 |
|----|------|
| 谁 | `admin` / `super_admin` |
| 入口 | 管理端 **活动日程** →「导出 RSVP」→ **选择场次**（本场 / 某一 `YYYY-MM-DD` 快照）后下载 |
| 接口 | `GET /api/activities/:id/rsvps/occurrences`；`GET /api/activities/:id/rsvps/export.csv?dateKey=`（缺省或 `live` = 本场） |
| 本场 | 当前 `activity_rsvps` |
| 历史场次 | `activity_rsvp_snapshots` 中该 `occurrenceDateKey`；无快照 → 404 提示 |
| 列 | 角色名、途径、状态（参加/待定/请假）、**活动时间**（该场次日 + 开始时刻；同文件各行相同） |
| 排序 | 状态序 `going` → `maybe` → `decline`，同状态按角色名 |
| 空数据 | 本场无表态或空快照：仍下载 CSV，仅表头 |
| 活动不存在 | 404 |

## 周期换场快照（增补 · 2026-10-26）

| 项 | 约定 |
|----|------|
| 何时 | `ensureCycleRollover` 即将 `deleteAllByActivity` 之前 |
| 集合 | `activity_rsvp_snapshots`（见数据模型） |
| 幂等 | 该 `activityId__dateKey` 已存在则跳过写入 |
| 部署 | 须部署 **`memberApi`** 后，之后的换场才会落档 |

## 验收

> **2026-10-22 用户验收通过**（成员端表态主路径）。

1. [x] 绑定成员后在详情可切换三态；汇总人数与名单更新  
2. [x] 未绑定 / 访客 403  
3. [ ] 已开始仍可改；**已结束**不可改，页面有提示；周期换场清空 RSVP/队伍  
4. [x] 列表可见「参加 · 待定 · 请假」人数（有人表态时）
5. [x] 管理端对有表态的活动可导出 CSV；列与排序符合上表；空活动仅表头（代码已合；待你手测勾）
6. [ ] 周期换场后存在对应日快照；导出可选本场或该日；无快照日期不可瞎导

## 部署

1. 重新部署云函数 **`memberApi`**（含 `rsvpsDb.js` 快照逻辑）——成员端表态 + **换场落档**  
2. 云库若无 `activity_rsvps` / `activity_rsvp_snapshots`，首次写入会尝试 `createCollection`  
3. 小程序重新编译后测详情页  
4. **导出 RSVP**：本机改 `dev-server` 后重启；公网管理端需 build 同步云主机  
5. 冒烟：`node cloud/dev-server/scripts/smoke-rsvp-export.mjs`（读本机 `.env` 应急超管口令）

## 路径

| 端 | 路径 |
|----|------|
| RSVP DB（成员端） | `cloud/functions/memberApi/rsvpsDb.js` |
| RSVP / 快照（管理端本机） | `cloud/dev-server/src/cloudRsvps.js` |
| 换场 | `cloud/functions/memberApi/activitiesDb.js` → `ensureCycleRollover` |
| 云函数 | `cloud/functions/memberApi/index.js` |
| 详情页 | `miniprogram/pages/activity-detail/` |
| 管理端导出 | `admin/src/views/ActivitiesView.vue`；`admin/src/api/activities.ts` |
