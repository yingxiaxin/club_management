# PC 管理后台（Web）

面向超管与管理员：成员维护、邀请码、活动与公告、提醒配置、数据导出等。

## 技术预期

- Vue 3 + Vite + Element Plus + TypeScript（推荐）
- 调用 `cloud/` 云函数 HTTP 访问或 CloudBase Web SDK（实现阶段二选一，优先与小程序同一云环境）

## 目录约定（实现后）

```
admin/
├── src/
│   ├── views/
│   ├── components/
│   ├── api/
│   ├── router/
│   └── stores/
├── index.html
├── package.json
└── vite.config.ts
```

## 本地开发（实现后）

```bash
cd admin
npm install
npm run dev
```

登录：微信扫码（管理员 openid）；超管应急账号密码作备份入口。

> P0 编码尚未开始；权限与页面以 `docs/功能说明书.md` 为准。
