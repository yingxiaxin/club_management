# 本地管理端 API（P0-a / P0-ocr 开发服）

供 `admin` 联调。数据落在 `data/members.json`（首次从 seed 复制，已 gitignore）。

```bash
cd cloud/dev-server
npm install
npm run dev
```

默认：http://127.0.0.1:3789  

应急账号见控制台输出。接口契约：`../api-contract.md`

## 截图 OCR（P0-ocr）

- 依赖：`tesseract.js` + `sharp`（预处理）+ `multer`（上传）
- 语言包 `chi_sim`：优先用目录内 `tessdata/`；若无则首次识别时下载到 `%LOCALAPPDATA%/club-management-tessdata`（已 gitignore，勿提交大文件）
- 流程：`POST /api/ocr/parse`（多图）→ 预览编辑 → `POST /api/ocr/commit`
- 解析自测：`npm run test:ocr-parse`
- 样例图：仓库根目录 `游戏截图/俱乐部成员列表.png`
- **可选腾讯云 OCR**（角色名更准）：复制 `.env.example` 为 `.env` 填入密钥，并 `npm i tencentcloud-sdk-nodejs-ocr`；用 `dotenv` 或系统环境变量加载后重启。未配置时回退本地 Tesseract。

> Node 建议 18+；当前亦兼容 Node 16（`sharp@0.32`）。  
> 游戏头像会挡住角色名首字，本地引擎很难认全，导入前请人工核对角色名。
