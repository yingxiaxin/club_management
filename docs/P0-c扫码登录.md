# P0-c 管理端扫码登录

## 流程

1. PC 打开管理端登录页 → `POST /api/auth/qr/start` → 展示小程序码  
2. 管理员微信扫码 → 打开小程序 `pages/admin-login` → 点「确认登录管理端」  
3. 云函数校验 openid 属于管理员 → 票状态 `confirmed`  
4. PC 轮询 `GET /api/auth/qr/:ticketId` → 签发本地 session → 进入后台  

应急账号密码仍可用（折叠面板）。

## 你需要做的（首次）

1. **重新上传并部署**云函数 `adminApi`（含 `authDb.js`；选「云端安装依赖」）  
2. 云开发控制台建集合（若无）：`users`、`login_tickets`  
3. 登记管理员微信：开发者工具打开「管理端扫码登录」→ 记下 openid → 云库 `users` 写入  
   `{ "openid": "<openid>", "role": "super_admin", "displayName": "超管", "memberId": null }`  
4. 本机已配 `CLOUDBASE_*`，重启 `dev-server`  
5. 浏览器打开登录页验收  

### 小程序码报 `invalid wx openapi access_token`

这是云函数调微信出码接口失败（常见）。**登录票仍会创建**，可先用手输票号：

1. PC 登录页点「刷新二维码」；若无码则 **复制登录编号**  
2. 打开小程序 `pages/admin-login`（管理端登录确认）→ 粘贴编号 → 确认  
3. PC 自动进入后台  

> 登录页面向管理员的文案已正式化；开发版/出码环境变量等排障仍见下文与 `上线待办.md`。

若要真正显示可扫的小程序码：在 `cloud/dev-server/.env` 填写公众平台 **AppSecret** 后**重启** `npm run dev`：

```env
WECHAT_APPID=wx0a3fc7a2aee9f66f
WECHAT_APP_SECRET=你的AppSecret
CLOUD_QR_ENV_VERSION=develop
```

1. 打开 [微信公众平台](https://mp.weixin.qq.com/) → 登录小程序（AppID `wx0a3fc7a2aee9f66f`）  
2. **开发** → **开发管理** → **开发设置** → AppSecret（重置/查看，复制一次）  
3. 只粘贴进本机 `.env` 的 `WECHAT_APP_SECRET=`（**勿发到聊天、勿提交 Git**）  
4. 重启 `cloud/dev-server`；`GET http://127.0.0.1:3789/api/health` 应见 `"wxacodeLocal": true`  
5. 浏览器打开管理端登录页 → 应出现可扫小程序码  

> 实现备注：本机 Node 16 无全局 `fetch`，出码走 `node:https`（`cloud/dev-server/src/wxacode.js`）。2026-10-22 本机 API 已测通返回二维码图。

### 手机扫码提示「开发版小程序已过期」

`.env` 里 `CLOUD_QR_ENV_VERSION=develop` 时，出的是**开发版**码。开发版会过期，且手机上须先「激活」过开发版，不能单靠登录页那张码长期使用。

**做法 A（立刻可用，仍用 develop）**

1. 微信开发者工具打开本仓库 → 点工具栏 **预览** → 用手机微信扫工具里那张预览码（先打开一次小程序）  
2. 再扫管理端登录页的小程序码 → 应能进 `admin-login`  
3. 微信须是该小程序的**开发者 / 体验者**

**做法 B（更稳，推荐日常）**

1. 开发者工具：**上传** → 在公众平台设为 **体验版**  
2. `.env` 改 `CLOUD_QR_ENV_VERSION=trial` → **重启** `dev-server`  
3. 刷新管理端登录页再扫（体验者名单里的微信号可扫）

**做法 C（不依赖出码）**：登录页复制票号 → 开发者工具打开 `pages/admin-login` 粘贴确认（P0-c 已验收过）。

## 代码位置

| 路径 | 说明 |
|------|------|
| `cloud/functions/adminApi/authDb.js` | 票 + 用户校验 + 小程序码 |
| `cloud/dev-server/src/cloudAuth.js` | 本机代理 callFunction |
| `miniprogram/pages/admin-login/` | 手机确认页 |
| `admin/src/views/LoginView.vue` | PC 扫码 UI |
