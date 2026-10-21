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

引擎优先级（自动选择）：

1. **腾讯云 OCR**（若配置了 `TENCENTCLOUD_SECRET_ID/KEY`）
2. **本地 RapidOCR**（本机 Python 已装 `rapidocr_onnxruntime` 时；角色名明显更准）
3. **Tesseract**（兜底；统计列 + 整表双通道）

其它：

- 图像预处理：`sharp`；上传：`multer`
- 语言包 `chi_sim`：仅 Tesseract 需要；优先 `tessdata/`，否则下载到 `%LOCALAPPDATA%/club-management-tessdata`
- 流程：`POST /api/ocr/parse`（多图）→ 预览编辑 → `POST /api/ocr/commit`
- 自测：`npm run test:ocr-parse` / `npm run test:ocr-rapid`
- 样例图：仓库根目录 `游戏截图/俱乐部成员列表.png`

### 启用 RapidOCR（推荐，免费本地）

```bash
pip install rapidocr-onnxruntime
# 可选：指定解释器
# set OCR_PYTHON=C:\Path\to\python.exe
```

强制只用 Tesseract：`set OCR_ENGINE=tesseract`

### 可选腾讯云 OCR

复制 `.env.example` 为 `.env` 填入密钥，并 `npm i tencentcloud-sdk-nodejs-ocr`；重启服务。

> Node 建议 18+；当前亦兼容 Node 16（`sharp@0.32`）。  
> 改代码后需**手动重启** dev-server（无 watch）。  
> 即使 RapidOCR，个别角色名仍可能缺字，导入前请扫一眼确认表。
