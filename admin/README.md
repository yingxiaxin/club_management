# PC 管理后台（Web）

Vue 3 + Vite + Element Plus。样式主题在 `src/styles/tokens.css`（暗色+橄榄褐 `#bda377`），换肤优先改该文件；色板说明见 `docs/视觉风格指南.md`。

## 本地运行

先启动 API，再启动本前端：

```bash
# 终端 1
cd cloud/dev-server
npm install
npm run dev

# 终端 2
cd admin
npm install
npm run dev
```

浏览器打开：http://127.0.0.1:5173  

应急账号配置在本机 `cloud/dev-server/.env` 的 `EMERGENCY_*`（见 `.env.example`）；**不要**写进页面或公开文档。日常请用微信扫码。

> 建议 Node **18+**。若为 Node 16，本仓库已锁定 Vite 4 以便运行。

## 生产构建（公网方案甲）

```bash
cd admin
npm ci
npm run build
```

产物在 `admin/dist/`。由 `cloud/dev-server` 在 `SERVE_ADMIN=1` 时同域托管。完整步骤见 **`docs/管理端公网托管.md`**。

## 当前能力

- 微信扫码登录 + 应急账号
- 成员 CRUD、截图 OCR 导入、邀请码、活动、提醒、公告、俱乐部资料、组队相关 API 对接
- Design Tokens 主题抽离
