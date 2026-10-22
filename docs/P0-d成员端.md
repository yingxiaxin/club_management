# P0-d：小程序成员端（tokens + 绑定 + 列表只读）

> **验收**：2026-10-22 通过（部署 `memberApi`、角色名绑定、成员列表只读）。

## 范围

- `miniprogram/styles/tokens.wxss`：与管理端同一色板语义  
- 云函数 `memberApi`：`whoami` / `bindByCharacterName` / `listMembers` / `getMember`  
- 页面：首页、绑定角色、成员列表、成员详情（`admin-login` 保留）

邀请码入会属 **P0-e**，本阶段不做。

## 绑定规则（过渡）

管理员已用手录/OCR 写入 `members` 后，成员在小程序输入**完全一致的角色名**自助绑定：

1. 匹配 `status=active` 的档案  
2. 若 `boundOpenid` 已被其他微信占用 → 拒绝  
3. 写入 `members.boundOpenid`，并更新/创建 `users`：`memberId`；非管理员角色升为 `member`（不降级 `admin` / `super_admin`）  
4. 仅 `canViewMembers`（已绑定的 `member`，或管理员）可拉列表/详情  

未绑定访客不可浏览名单（符合说明书访客权限；入会申请页留给 P0-e）。

## 部署

1. 开发者工具打开**仓库根目录**  
2. 左树 `cloud/functions/memberApi` → 右键 **上传并部署：云端安装依赖**  
3. 云端测试：`{ "action": "health" }` → `ok: true`  
4. 模拟器打开首页 → 绑定一个云库中已有角色名 → 打开成员列表  

## 相关路径

| 路径 | 说明 |
|------|------|
| `miniprogram/styles/tokens.wxss` | 主题 |
| `miniprogram/pages/members/` | 列表 |
| `miniprogram/pages/bind/` | 绑定 |
| `cloud/functions/memberApi/` | 成员端云函数 |
