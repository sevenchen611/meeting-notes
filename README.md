# Meeting Notes

本機版「會議記錄專案」。

## 功能

- 上傳會議錄音檔
- 使用 Gemini 分析音訊
- 產生結構化會議記錄
- 同時保存 Markdown 與 JSON
- 預覽後再寫入 Notion 會議記錄資料庫

## 啟動

1. 安裝並啟動：

```powershell
npm install
npm run dev
```

開啟 http://localhost:5178

打開網頁後，使用「設定精靈」填入 Gemini API Key、Notion Token 和 Notion 資料庫網址。系統會自動保存到 `.env`。

## 第一版使用方式

1. 選擇錄音檔
2. 補充會議日期、已知與會者、背景說明
3. 按下「開始分析」
4. 檢查產出的會議記錄
5. 確認後再按「寫入 Notion」

如果沒有設定 `GEMINI_API_KEY`，系統會產生示範資料，方便先確認流程。
