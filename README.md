# 00406A Tracker — R44 自動公開市場資料版

完整網頁：`index.html`，保留原有 19 個頁面與三帳戶獨立統計。

## 自動更新如何運作

- `.github/workflows/update-market.yml`：GitHub Actions 每天按台灣時間 **09:17、15:17、20:17** 嘗試核對公開行情及除息資料（排程可能延遲）。
- `scripts/update_market.py`：由證交所抓取價格、成交量、成交金額與 ETF 除息排程；無需 FinMind 金鑰也能運作。
- `data/market.json`：公開、可查核的資料快照，附檢查時間、行情日期與來源錯誤；**不含任何私人帳務**。
- `js/auto-market.js`：APP 開啟時自動載入快照，更新價格、量能雷達及除息提醒。

第一次執行已可透過 Actions 自動觸發，之後依排程更新。若想立即核對：GitHub → Actions → **00406A 公開市場資料自動更新** → **Run workflow**。網頁上「檢查最新資料」只會重新讀取已發布的快照，**不會立即觸發 GitHub Actions 抓取**。

## 選用 FinMind 歷史資料

到 GitHub 專案 **Settings → Secrets and variables → Actions → New repository secret**，新增名稱 `FINMIND_TOKEN`，再執行上述 workflow；不要將金鑰貼到 `index.html` 或任何公開檔案。沒有設置也能透過 TWSE 取得最近數個月公開交易資料。歷史年份的行情仍可能需要 FinMind 來源。

## 重要界線

- 公開除息公告與「預估配息」**不是**銀行／券商實收股息，系統不會自動記入個人帳務。
- 主帳戶、大寶、二寶交易仍保存在各自瀏覽器的 localStorage，不會被 GitHub 自動備份或跨手機同步。
- 開啟 APP 才會讀取新快照；GitHub 的更新不會即時推播到關閉中的網頁。
- 證交所資料來源中斷時保留最近可得資料，顯示來源失敗／更新時間，不假裝是即時行情。
- 更新程式前請先從 APP 的 **R30 資料安全** 匯出 SHA-256 JSON 帳務備份。
