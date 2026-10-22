# 微信小程序（成员端）

面向俱乐部成员：成员列表、活动日程与 RSVP、订阅提醒、组队招募。

## 技术预期

- 微信小程序原生（WXML / WXSS / JS）
- 对接本仓库 `cloud/` 云开发环境（同一 AppID / 云环境）

## 目录

```
miniprogram/
├── styles/tokens.wxss   # 主题（与视觉风格指南对齐）
├── pages/
│   ├── index/           # 首页（身份 + 入口）
│   ├── bind/            # 按角色名绑定
│   ├── join/            # 邀请码入会（P0-e）
│   ├── members/         # 成员列表只读
│   ├── member-detail/   # 成员详情
│   └── admin-login/     # 管理端扫码确认（P0-c）
├── utils/api.js         # 调用 memberApi
├── app.js / app.json / app.wxss
└── project.config.json  # 提示：请打开仓库根目录
```

## 本地开发

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. **导入仓库根目录** `俱乐部管理/`（不是本 `miniprogram/` 子目录）
3. AppID / 云环境与 `cloud/env.json` 一致
4. 部署云函数：`cloud/functions/memberApi`（及已有的 `adminApi`）

说明见 `docs/P0-d成员端.md`。

## 当前配置

- AppID：`wx0a3fc7a2aee9f66f`（仓库根 `project.config.json`）
- 云环境：`cloud1-d6gjqx2kd2f3765f4`
- 阶段：**P0-e**（邀请码入会）；说明见 `docs/P0-e邀请码入会.md`
