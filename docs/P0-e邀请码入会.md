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

管理员联调：关联页可「解除关联（联调）」后重测。  
管理端**移出成员**时同步：`boundOpenid=null`、清空对应用户 `memberId`、关闭该角色待审关联申请。

## 部署

1. 重启 `cloud/dev-server`  
2. 重新部署 `memberApi`  
3. 管理端 `/invites`；小程序 `pages/join`  

## 路径

| 端 | 路径 |
|----|------|
| 管理端 | `admin/src/views/InvitesView.vue` |
| 本机审核 | `cloud/dev-server/src/cloudInvites.js`（approve = 绑定已有成员） |
| 云函数提交 | `cloud/functions/memberApi/invitesDb.js` |
| 小程序 | `miniprogram/pages/join/` |
