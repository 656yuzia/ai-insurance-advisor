# AI 保障顧問

AI 保障顧問是一個以 OpenAI API 驅動的保險保障整理工具。使用者填寫基本資料後，系統會先整理人生階段與主要風險，再透過四項保障自我檢查，產生需要優先確認的保障方向。網站定位是「初步整理與討論輔助」，不是正式投保建議，也不推薦特定保險公司或商品。

## 功能特色

- 基本資料表單：年齡、婚姻、小孩、職業、年收入與選填進階資料。
- AI 初步分析：根據使用者資料產生「人生階段」與「主要風險」。
- 保障缺口自我檢查：醫療、重大疾病、家庭責任、長照／失能四個方向。
- AI 缺口整理：依自我檢查結果產生摘要、優先確認項目與 AI 總結。
- 預約導流：完成分析後顯示保單健檢預約入口與常見問題。
- 保障小百科與作者頁：補足作品集展示與使用者信任資訊。
- 後端知識庫：`ai-brain/*.md` 作為 AI 回答風格與知識內容來源，不透過靜態網站公開。
- 成本與濫用控制：API route 具備 JSON body 上限、同源檢查、短時間 rate limit、每日 IP 額度與每日全站額度。

## 技術架構

- Frontend：HTML、CSS、原生 JavaScript
- Backend：Node.js、Express
- AI SDK：OpenAI Node SDK
- 部署目標：Vercel
- 主要入口：
  - `index.html`：主流程頁
  - `about.html`：作者介紹
  - `knowledge.html`：保障小百科
  - `script.js`：前端互動與 API 呼叫
  - `server.js`：Express server、OpenAI API route、防護 middleware
  - `ai-brain/`：AI 銷售風格與保險知識庫

## API 流程

### `POST /api/analyze`

接收使用者基本資料，驗證欄位後呼叫 OpenAI `gpt-5.2`，產生初步保障整理。

### `POST /api/check-gaps`

接收基本資料、STEP 2 分析結果與四項自我檢查答案，呼叫 OpenAI `gpt-5.2`，產生保障缺口整理。

兩個 API 都會先經過同源檢查與請求額度控管，避免公開部署後被大量濫用而增加 OpenAI 成本。

## 環境變數

必要：

```bash
OPENAI_API_KEY=sk-...
```

選填：

```bash
PORT=3000
ALLOWED_ORIGINS=https://your-domain.vercel.app,https://www.your-domain.com
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=8
API_DAILY_LIMIT_PER_IP=24
API_DAILY_LIMIT_GLOBAL=120
```

說明：

- `ALLOWED_ORIGINS`：允許跨 origin 呼叫 API 的白名單。一般同源網站不需要設定。
- `API_RATE_LIMIT_WINDOW_MS`：短時間限流視窗，預設 15 分鐘。
- `API_RATE_LIMIT_MAX`：每個 IP 在限流視窗內最多 API 請求數，預設 8。
- `API_DAILY_LIMIT_PER_IP`：每個 IP 每日最多 API 請求數，預設 24。
- `API_DAILY_LIMIT_GLOBAL`：全站每日最多 API 請求數，預設 120。

## 本機執行

安裝依賴：

```bash
npm install
```

設定環境變數後啟動：

```bash
OPENAI_API_KEY=sk-... npm start
```

預設網址：

```text
http://localhost:3000
```

## 安全測試方式

目前 `npm test` 會執行 `test.js`，而 `test.js` 會直接呼叫 OpenAI API。這代表它可能產生付費 API 成本，不適合作為一般 CI 或本機例行測試。

不會呼叫 OpenAI 的安全檢查：

```bash
node --check server.js
node --check script.js
node --check test.js
```

若要測試防護 middleware，可以用無效 payload 或跨站 `Origin`，讓請求停在驗證、同源檢查或 rate limit，不要送出會通過欄位驗證的真實 OpenAI 請求。

範例：

```bash
PORT=3100 API_RATE_LIMIT_MAX=2 API_DAILY_LIMIT_PER_IP=3 API_DAILY_LIMIT_GLOBAL=5 npm start
curl -i -X POST http://localhost:3100/api/analyze \
  -H "Content-Type: application/json" \
  -H "Origin: https://example.com" \
  -d '{"age":35}'
curl -i -X POST http://localhost:3100/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"age":10}'
```

## Vercel 部署

`vercel.json` 會將：

- `/api/(.*)` 導向 `server.js`
- `*.html`、`styles.css`、`script.js`、`assets/**` 作為靜態資源
- `ai-brain/**` 包進 server build，供後端讀取

部署前請確認：

- Vercel 專案已設定 `OPENAI_API_KEY`。
- 若有正式網域或預覽網域需求，依情況設定 `ALLOWED_ORIGINS`。
- API 額度環境變數符合展示流量與預算。
- `assets/og-cover.jpg` 可公開讀取，社群分享圖連結正確。
- `script.js` 裡的聯絡方式已換成正式連結。

## 成本與部署風險

這個專案的核心功能會呼叫 OpenAI API，公開部署時主要風險是被大量觸發而產生成本。後端目前已加入基本防護，但仍建議在正式作品集展示前補強：

- 更持久的 rate limit 儲存，例如 Redis、Vercel KV 或資料庫。
- 後台或環境變數控制的展示開關。
- 不呼叫 OpenAI 的 mock contract tests。
- 前端請求 timeout / AbortController。
- 部署紀錄與錯誤監控。

## 作品集亮點

- 將保險業務場景拆成可互動的 AI 分析流程。
- 使用後端 Markdown 知識庫控制 AI 語氣與回答邊界。
- 特別處理低壓力、非恐嚇式、非商品導向的保險溝通方式。
- 加入 API 成本與濫用防護，適合公開展示。
- 使用繁體中文 UI，貼近台灣保險顧問實際使用情境。

## 限制

- AI 分析僅供初步保障觀念整理，不代表正式投保建議。
- 未串接會員、資料庫或長期紀錄保存。
- 目前 rate limit 使用記憶體儲存，serverless 或多實例環境下不保證跨實例共享。
- `npm test` 仍是付費 OpenAI smoke test，尚未改成 mock 測試。
