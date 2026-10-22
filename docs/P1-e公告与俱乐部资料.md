# P1-e：公告 + 俱乐部资料

> P1 收尾刀。管理端维护俱乐部名称/图标/简介与公告；小程序首页展示。

## 范围

- 云库：`club_profile`（`name` / `iconUrl` / `intro`）；`announcements`
- 本机 API：`GET/PUT /api/club-profile`（资料字段）；`GET/POST/PUT/DELETE /api/announcements`
- 管理端：`/club` 俱乐部资料；`/announcements` 公告 CRUD（置顶/编辑/删除）
- 小程序首页：品牌区（名称·图标·简介）+ 公告列表（绑定成员后可见；点按展开）
- 成员端云函数：`getClubProfile`（未绑定也可看品牌）；`listAnnouncements`（须可查看成员）

## 规则

| 项 | 说明 |
|----|------|
| 图标 | 管理端「本地上传」→ 云存储（`POST /api/club-profile/icon`）；也可粘贴 URL / fileID |
| 公告排序 | 置顶优先，再按 `publishedAt` 倒序 |
| 首页条数 | 最多 5 条 |
| 权限 | 写操作走管理端本机 API（管理员登录）；小程序只读 |

## 验收

> **验收通过**：2026-10-22（含本地上传图标、简介展示位调整）

1. [x] 管理端可改名称/图标/简介并保存（含本地上传）  
2. [x] 管理端可发布/置顶/编辑/删除公告  
3. [x] 小程序首页显示俱乐部名称（及图标/简介，若已填）  
4. [x] 已绑定成员首页可见公告；未绑定不可见公告列表  

## 部署

1. 重启 `cloud/dev-server`  
2. 重新部署 **`memberApi`**（含 `announcementsDb.js`）  
3. 管理端刷新即可  

## 路径

| 端 | 路径 |
|----|------|
| 本机公告 | `cloud/dev-server/src/cloudAnnouncements.js` |
| 本机俱乐部 | `cloud/dev-server/src/cloudClub.js` |
| 成员端 | `cloud/functions/memberApi/announcementsDb.js`、`clubDb.js` |
| 管理端 | `admin/src/views/ClubView.vue`、`AnnouncementsView.vue` |
| 首页 | `miniprogram/pages/index/` |
