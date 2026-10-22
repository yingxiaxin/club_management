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

1. PC 登录页点「刷新登录票」→ **复制票号**  
2. 开发者工具打开 `pages/admin-login/index` → 粘贴票号 →「确认登录管理端」  
3. PC 自动进入后台  

若要真正显示可扫的小程序码：在 `cloud/dev-server/.env` 增加公众平台 **AppSecret** 后重启 API：

```env
WECHAT_APPID=wx0a3fc7a2aee9f66f
WECHAT_APP_SECRET=你的AppSecret
CLOUD_QR_ENV_VERSION=develop
```

AppSecret：[微信公众平台](https://mp.weixin.qq.com/) → 开发 → 开发管理 → 开发设置（勿提交 Git）。

## 代码位置

| 路径 | 说明 |
|------|------|
| `cloud/functions/adminApi/authDb.js` | 票 + 用户校验 + 小程序码 |
| `cloud/dev-server/src/cloudAuth.js` | 本机代理 callFunction |
| `miniprogram/pages/admin-login/` | 手机确认页 |
| `admin/src/views/LoginView.vue` | PC 扫码 UI |
