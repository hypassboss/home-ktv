# 家庭 KTV

自己家用的 KTV：電視播放、手機點歌、台灣與大陸排行榜、我的最愛、唱過的歌、評分。

## 結構
- `web/` 電視版（`tv.html`）與手機點歌版（`m.html`），推到 main 會自動發佈到 GitHub Pages
- `android/` Android TV 外殼 APK，開啟 `tv.html`；每次推送自動建置並放到 Release「apk-latest」
- `supabase/functions/ktv-api/` 雲端函式：YouTube KTV 版自動配對、排行榜抓取、電視配對

資料庫在 Supabase（`ktv_` 開頭的資料表）。程式碼裡沒有家庭金鑰：新電視第一次開啟時顯示配對 QR Code，用已設定好的手機掃描即可。

## 排程
- 每 3 分鐘：替還沒配對的歌找 YouTube KTV 版
- 每週一 05:00（台灣時間）：更新 11 個排行榜
