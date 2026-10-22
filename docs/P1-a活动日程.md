# P1-a：活动实例（管理端）

> P1 第一刀。小程序日程 / RSVP / 订阅提醒见后续子阶段。

## 范围

- 云库集合：`activities`（首次访问本机 API 时尝试 `createCollection`）
- 本机 API：`cloud/dev-server/src/cloudActivities.js` + `/api/activities*`
- 管理端：`/activities` 活动 CRUD / 发布 / 取消
- 开始/结束：分量填写（年、月、日、星期、时间）；活动表区域内部滚动
- 提醒周期：无时间 → `none`；年月日+时间 → 仅 `once`；日+时间 → `once`/`daily`；周几+时间 → `once`/`weekly`；仅时间 → `daily`

## 不做

- **活动模板**（已砍：类型在活动上直接选）
- 小程序今日/本周列表与详情  
- RSVP  
- 订阅消息实际推送与定时触发器（字段已预留）  
- 公告 / 俱乐部资料完善  
- 组队（详情仅预留字段 `enableTeam`）

## 验收

> **2026-10-22 用户验收通过。**

1. [x] 管理端可新建活动（草稿）→ 发布 → 列表可见  
2. [x] 可取消活动；已取消不可再发布  
3. [x] 活动多时仅表格区域滚动  
4. [x] 开始全空保存被拒；无时间时提醒周期仅为「不提醒」  

## 部署

1. 重启 `cloud/dev-server`（须 `DATA_BACKEND=cloud`）  
2. admin 打开 http://127.0.0.1:5173/activities  
