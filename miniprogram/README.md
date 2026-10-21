# 微信小程序（成员端）

面向俱乐部成员：成员列表、活动日程与 RSVP、订阅提醒、组队招募。

## 技术预期

- 微信小程序原生（WXML / WXSS / JS 或 TS）
- 对接本仓库 `cloud/` 云开发环境（同一 AppID / 云环境）

## 目录约定（实现后）

```
miniprogram/
├── pages/          # 页面
├── components/     # 组件
├── services/       # 调用云函数 / 业务 API
├── utils/
├── app.js / app.json / app.wxss
└── project.config.json
```

## 本地开发

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本目录为小程序项目
3. 填写 AppID，并开通云开发（与 `cloud/` 同一环境）

## 当前配置

- AppID：`wx0a3fc7a2aee9f66f`（见 `project.config.json`）
- 云环境：与 `cloud/env.json` 中 `envId` 一致

导入本目录到微信开发者工具即可（方式 B，见开通指南）。

> P0 业务编码尚未开始；先以 `docs/功能说明书.md` 为准。说「开始 P0」后由 Agent 生成页面与云初始化代码。
