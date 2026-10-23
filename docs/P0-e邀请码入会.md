# P0-e：邀请码关联微信（非新建成员）

## 产品意图

- 成员名单由管理员手录 / OCR 导入维护。  
- 邀请码只做一件事：让**已在名单中的人**用微信关联到对应角色，从而能看俱乐部信息。  
- 随便拿到小程序、但没有有效邀请码 + 正确角色名的人，**不能看名单**。  
- 角色名与名单匹配不上 → 不允许关联。

## 流程

1. 管理端生成邀请码 → 发给真实成员  
2. 小程序填 **邀请码 + 角色名**（须与名单完全一致）→ 提交  
3. 校验：邀请码可用；存在 `status=active` 且角色名相同的成员；未被他人绑定  
4. 管理端审核通过 → 写 `members.boundOpenid` + `users.memberId`（不新建成员）  
5. 申请人可看成员列表  

管理员联调：仅管理员在首页「管理入口」与关联页可见「解除关联（联调）」；普通成员不展示联调/扫码登录入口。  
访客上手：首页未关联时展示三步说明（要邀请码 → 填角色名 → 等待审核）；未关联访问活动/成员时引导至 `pages/join`（旧 `pages/bind` 仅为跳转引导）。  

管理端**移出成员**时同步：`boundOpenid=null`、清空对应用户 `memberId`、普通成员 `role` 降为 `guest`、关闭该角色待审关联申请。

**注意**：小程序用**管理员/超管**微信号测时，移出角色后**仍可看名单**（管理权限，不是绑定权限）。验「失权」请用普通成员微信，或看首页身份是否变为访客且 `canViewMembers=false`。  
`memberApi` 在 `whoami` / `listMembers` 会校验档案仍为 `active`；若已 `left` 会自动清绑定。

## 部署

1. 重启 `cloud/dev-server`  
2. 重新部署 `memberApi`  
3. 管理端 `/invites`；小程序 `pages/join`  

## 冒烟

**后端契约**（不经小程序，可重复跑）：

```bash
cd cloud/dev-server && node scripts/smoke-p0e.mjs
```

覆盖：建临时成员 → 邀请码 → 待审申请 → 审核绑定 `boundOpenid`/`users.memberId` → 移出解绑。  
临时成员会留在云库且 `status=left`（角色名 `冒烟P0e_*`），可忽略或手删。

**小程序端手测**（需开发者工具 + 已部署最新 `memberApi`）：

1. 管理端生成邀请码；确认名单里有未绑定的角色名  
2. 小程序「邀请码关联角色」：填邀请码 + 该角色名 → 提交  
3. 管理端审核通过 → 小程序能看成员列表  
4. 管理端移出该成员 → **普通成员微信**应失去查看权（首页变为访客；列表 403）。管理员微信仍可看，属预期  
5. 负例：错误角色名应被拒绝（名单中无此角色）  
6. 改云函数后须重新部署 `memberApi`（及若走云端写库则 `adminApi`）

## 路径

| 端 | 路径 |
|----|------|
| 管理端 | `admin/src/views/InvitesView.vue` |
| 本机审核 | `cloud/dev-server/src/cloudInvites.js`（approve = 绑定已有成员） |
| 云函数提交 | `cloud/functions/memberApi/invitesDb.js` |
| 小程序 | `miniprogram/pages/join/` |
