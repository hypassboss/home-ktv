import {
  KEY, sb, api, on, emit, chartList, chartSongs, favoritesOf, sungSongs, queueNow, enqueue,
  badges, esc, bestVideo, kindOf, toast, store, findGuide, forgetGuide, ytThumb, songsByIds, closeQueue, artistsList, songsByArtist,
} from "./shared.js?v=1795487718";
import { playApplause } from "./applause.js?v=1795487718";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ================= D-pad spatial navigation =================
let scope = document; // element that limits focus
function focusables() {
  return $$(".f", scope).filter((el) => {
    if (el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}
function focusFirst(root = scope) {
  const el = $$(".f", root).find((e) => !e.closest("[hidden]"));
  if (el) el.focus();
}
function move(dir) {
  const list = focusables();
  const cur = document.activeElement;
  if (!cur || !list.includes(cur)) { list[0]?.focus(); return; }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bd = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const dx = x - cx, dy = y - cy;
    const horiz = dir === "left" || dir === "right";
    if (dir === "right" && dx <= 4) continue;
    if (dir === "left" && dx >= -4) continue;
    if (dir === "down" && dy <= 4) continue;
    if (dir === "up" && dy >= -4) continue;
    const d = horiz ? Math.abs(dx) + Math.abs(dy) * 3 : Math.abs(dy) + Math.abs(dx) * 2.2;
    if (d < bd) { bd = d; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
document.addEventListener("keydown", (e) => {
  if (KEYMAP[e.key]) { e.preventDefault(); onArrow(KEYMAP[e.key]); return; }
  if (e.key === "Enter" || e.key === " ") {
    const el = document.activeElement;
    if (el && el.classList.contains("f")) { e.preventDefault(); el.click(); }
    else onArrow("down");
    return;
  }
  if (["Escape", "Backspace", "GoBack", "BrowserBack"].includes(e.key)) { e.preventDefault(); onBack(); return; }
  if (e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause") { togglePause(); return; }
  if (e.key === "MediaTrackNext" || e.key === "MediaFastForward") { skip(); return; }
});
window.ktvBack = onBack; // the APK shell calls this for the remote's Back key

// ================= views =================
let view = "splash"; // splash | home | playing | ctl
function show(v) {
  view = v;
  $("#splash").hidden = v !== "splash";
  $("#home").hidden = v !== "home";
  $("#ctlBar").hidden = v !== "ctl";
  scope = v === "home" ? $("#home") : v === "ctl" ? $("#ctlBar") : v === "splash" ? $("#splash") : document;
  if (v === "home") { renderMiniNow(); setTimeout(() => focusFirst($("#content")) || null, 0); }
  if (v === "ctl") setTimeout(() => focusFirst($("#ctlBar")), 0);
  updateNowBar();
}
function onArrow(dir) {
  if (view === "playing") { show("ctl"); return; }
  move(dir);
}
function onBack() {
  if (view === "ctl") { show("playing"); return true; }
  if (view === "home" && current) { show("playing"); return true; }
  if (view === "playing") { show("home"); renderTab(); return true; }
  return false; // nothing to close → the APK may exit
}

// ================= home menu =================
// Same structure as the phone: 點歌 (category tabs) · 排行榜 · 歌星 · 最愛 · 常唱 · 已點
const TABS = [
  { id: "home", ico: "🎵", name: "點歌" },
  { id: "charts", ico: "🏆", name: "排行榜" },
  { id: "artists", ico: "🧑‍🎤", name: "歌星" },
  { id: "fav", ico: "⭐", name: "家人最愛" },
  { id: "sung", ico: "🕘", name: "常唱的歌" },
  { id: "queue", ico: "📋", name: "已點" },
];
const CATS = [["foryou", "為你推薦"], ["cn-qq-ktv", "K歌金曲"], ["tw-kkbox-song", "華語熱門"], ["tw-kkbox-new", "新歌"], ["cn-douyin", "抖音熱歌"],
  ["classic-90s", "經典老歌"], ["classic-00s", "2000 年代"], ["classic-tw", "台語"], ["classic-hk", "粵語"], ["classic-duet", "男女對唱"]];
let tab = "home", charts = [], chartSel = {}, cat = store("ktv_tvcat") || "foryou", chartRegion = "tw", artistSel = "", artistG = "all", qCount = 0;
function renderTabs() {
  $("#tabs").innerHTML = TABS.map((t) => `<button class="f tab ${t.id === tab ? "on" : ""}" data-tab="${t.id}"><i>${t.ico}</i>${t.name}${t.id === "queue" && qCount ? `<b class="cnt">${qCount}</b>` : ""}</button>`).join("");
  $$("#tabs .tab").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; artistSel = ""; renderTabs(); renderTab(); $(`#tabs [data-tab="${tab}"]`).focus(); }));
}
function card(s, extra = "") {
  const v = bestVideo(s);
  const rk = s.rank ? `<span class="rk ${s.rank <= 3 ? "top" : ""}">${s.rank}</span>` : "";
  return `<button class="f card ${s.yt_status === "none" ? "na" : ""}" data-song="${s.id}">
    <span class="cv">${v ? `<img loading="lazy" alt="" src="${ytThumb(v)}" onerror="this.remove()">` : ""}<span class="ph">${esc((s.title || "?").slice(0, 1))}</span>${rk}<span class="go">🎤 K歌</span></span>
    <span class="tx"><span class="t">${esc(s.title)}</span>
    <span class="a">${esc(s.artist || "")}</span>
    ${extra}
    <span class="b">${badges(s)}</span></span>
  </button>`;
}
function bindCards(root) {
  $$("[data-song]", root).forEach((b) => (b.onclick = async () => {
    if (b.classList.contains("na")) { toast("這首還找不到 KTV 影片：用手機搜尋歌名，就能從 YouTube 加進來", 3500); return; }
    try { const ok = await enqueue(b.dataset.song, null); toast(!ok ? "這首已經在排隊了" : current ? "已加入排隊 🎵" : "準備播放…"); refreshQueue(); }
    catch { toast("點歌失敗，請再試一次"); }
  }));
}
const grid = (songs, ex) => `<div class="grid">${songs.map((s) => card(s, ex ? ex(s) : "")).join("")}</div>`;
function chipRow(items, sel, attr) {
  return items.map(([k, n]) => `<button class="f chip ${k === sel ? "on" : ""}" ${attr}="${esc(k)}">${esc(n)}</button>`).join("");
}
async function renderTab() {
  const head = $("#mainHead"), box = $("#content"), my = tab + cat + chartRegion + artistSel + artistG;
  const stale = () => tab + cat + chartRegion + artistSel + artistG !== my;
  box.innerHTML = `<div class="empty">載入中…</div>`;
  if (tab === "home") {
    const cats = CATS.filter(([k]) => k === "foryou" || charts.some((c) => c.id === k));
    if (!cats.some(([k]) => k === cat)) cat = "foryou";
    head.innerHTML = `<h2>點歌</h2>${chipRow(cats, cat, "data-cat")}`;
    $$("[data-cat]", head).forEach((b) => (b.onclick = () => { cat = b.dataset.cat; store("ktv_tvcat", cat); renderTab().then(() => $(`[data-cat="${cat}"]`)?.focus()); }));
    if (cat === "foryou") {
      const [sung, fav, ktv, top] = await Promise.all([sungSongs(null, 10), favoritesOf(null), chartSongs("cn-qq-ktv", 10), chartSongs("tw-kkbox-song", 10)]);
      if (stale()) return;
      box.innerHTML =
        (sung.length ? `<div class="row-title">全家常唱 <small>唱過最多次</small></div>${grid(sung, (s) => `<span class="who">唱過 ${s.times} 次</span>`)}` : "") +
        (fav.length ? `<div class="row-title">家人的最愛</div>${grid(fav.slice(0, 10))}` : "") +
        `<div class="row-title">KTV 最多人點 <small>K歌金曲</small></div>${grid(ktv)}` +
        `<div class="row-title">華語熱門 <small>KKBOX 週榜</small></div>${grid(top)}`;
    } else {
      const songs = await chartSongs(cat, 60);
      if (stale()) return;
      box.innerHTML = songs.length ? grid(songs) : `<div class="empty">這個分類還沒有歌</div>`;
    }
  } else if (tab === "charts") {
    const list = charts.filter((c) => c.region === chartRegion);
    const sel = chartSel[chartRegion] || list[0]?.id;
    chartSel[chartRegion] = sel;
    head.innerHTML = `<h2>排行榜</h2>${chipRow([["tw", "台灣"], ["cn", "大陸"], ["classic", "經典"]], chartRegion, "data-reg")}<span class="sep"></span>${chipRow(list.map((c) => [c.id, c.name]), sel, "data-chart")}`;
    $$("[data-reg]", head).forEach((b) => (b.onclick = () => { chartRegion = b.dataset.reg; renderTab().then(() => $(`[data-reg="${chartRegion}"]`)?.focus()); }));
    $$("[data-chart]", head).forEach((b) => (b.onclick = () => { chartSel[chartRegion] = b.dataset.chart; renderTab().then(() => $(`[data-chart="${b.dataset.chart}"]`)?.focus()); }));
    const songs = sel ? await chartSongs(sel, 60) : [];
    if (stale()) return;
    const c = list.find((x) => x.id === sel);
    box.innerHTML = `<div class="row-title">${esc(c?.name || "")} <small>${esc(c?.source || "")}${c?.updated_at ? " · 更新於 " + new Date(c.updated_at).toLocaleDateString("zh-TW") : ""}</small></div>
      ${songs.length ? grid(songs) : `<div class="empty">還沒有資料</div>`}`;
  } else if (tab === "artists") {
    if (artistSel) {
      head.innerHTML = `<button class="f chip" id="abk">‹ 歌星</button><h2>${esc(artistSel)}</h2>`;
      $("#abk").onclick = () => { artistSel = ""; renderTab().then(() => focusFirst($("#content"))); };
      const songs = await songsByArtist(artistSel);
      if (stale()) return;
      box.innerHTML = songs.length ? grid(songs) : `<div class="empty">歌庫裡還沒有這位歌星的歌，可以用手機搜尋 YouTube 加進來</div>`;
    } else {
      head.innerHTML = `<h2>歌星</h2>${chipRow([["all", "全部"], ["male", "男歌手"], ["female", "女歌手"], ["group", "團體"]], artistG, "data-ag")}`;
      $$("[data-ag]", head).forEach((b) => (b.onclick = () => { artistG = b.dataset.ag; renderTab().then(() => $(`[data-ag="${artistG}"]`)?.focus()); }));
      artistsCache ||= await artistsList();
      if (stale()) return;
      const list = artistsCache.filter((a) => artistG === "all" || a.gender === artistG);
      box.innerHTML = `<div class="agrid">${list.map((a) => `<button class="f abtn" data-artist="${esc(a.name)}"><b>${esc(a.name)}</b><small>${a.n} 首</small></button>`).join("")}</div>`;
      $$("[data-artist]", box).forEach((b) => (b.onclick = () => { artistSel = b.dataset.artist; renderTab().then(() => focusFirst($("#content"))); }));
    }
  } else if (tab === "fav") {
    head.innerHTML = `<h2>家人最愛</h2>`;
    const [{ data: fr }, { data: mem }] = await Promise.all([
      sb.from("ktv_favorites").select("member_id,song_id,created_at").order("created_at", { ascending: false }),
      sb.from("ktv_members").select("id,name,emoji").order("created_at"),
    ]);
    const songs = await songsByIds([...new Set((fr || []).map((r) => r.song_id))]);
    if (stale()) return;
    const byId = new Map(songs.map((x) => [x.id, x]));
    box.innerHTML = (mem || []).map((m) => {
      const mine = (fr || []).filter((r) => r.member_id === m.id).map((r) => byId.get(r.song_id)).filter(Boolean);
      return mine.length ? `<div class="row-title">${esc(m.emoji + " " + m.name)} 的最愛 <small>${mine.length} 首</small></div>${grid(mine)}` : "";
    }).join("") || `<div class="empty">還沒有人加最愛。唱歌時在手機按 ♡ 收藏，或唱完時按「❤ 加入最愛」。</div>`;
  } else if (tab === "sung") {
    head.innerHTML = `<h2>常唱的歌</h2>`;
    const songs = await sungSongs(null, 60);
    if (stale()) return;
    box.innerHTML = songs.length ? grid(songs, (s) => `<span class="who">唱過 ${s.times} 次${s.best ? " · 最高 " + s.best + " 分" : ""}</span>`) : `<div class="empty">還沒有唱過的歌，唱完的歌會自動記在這裡。</div>`;
  } else if (tab === "queue") {
    head.innerHTML = `<h2>已點</h2>`;
    const q = await queueNow();
    if (stale()) return;
    const rows = [q.playing, ...q.queued].filter(Boolean);
    box.innerHTML = rows.length ? `<div class="grid">${rows.map((r, i) => card(r.song, `<span class="who">${i === 0 && q.playing ? "▶ 正在唱" : "第 " + (q.playing ? i : i + 1) + " 首"}${r.member ? " · " + esc(r.member.emoji + r.member.name) : ""}</span>`)).join("")}</div>` : `<div class="empty">還沒有人點歌。用遙控器選一首，或用手機掃左下角 QR Code 點歌。</div>`;
  }
  bindCards(box);
  if (view === "home" && !$("#home").contains(document.activeElement)) focusFirst(box);
}
let artistsCache = null;
function renderMiniNow() {
  const el = $("#miniNow");
  if (!current) { el.hidden = true; return; }
  el.hidden = false;
  const v = curVideo || bestVideo(current.song);
  el.innerHTML = `${v ? `<img alt="" src="${ytThumb(v)}" onerror="this.remove()">` : ""}<span class="go">▶ 回到影片</span><span class="muted">${esc(current.song.title)}</span>`;
}

// ================= QR for phones =================
const BASE = location.pathname.replace(/[^/]*$/, ""); // works at / and at /home-ktv/
function drawQr() { drawQrTo($("#qr"), location.origin + BASE + "m.html?k=" + encodeURIComponent(KEY)); }
function drawQrTo(cv, url) {
  try {
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    const ctx = cv.getContext("2d"), n = qr.getModuleCount(), size = cv.width;
    const cell = Math.floor(size / (n + 2)), off = Math.floor((size - cell * n) / 2);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size); ctx.fillStyle = "#0d0a17";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
  } catch { /* qr lib missing */ }
}

// ================= player =================
let yt = null, ytReady = false, current = null, curVideo = null, paused = false, ending = false;
window.onYouTubeIframeAPIReady = () => { ytReady = true; };
function makePlayer(videoId, start = 0) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const wait = () => (window.YT && YT.Player ? go() : Date.now() - t0 > 15000 ? reject(new Error("yt_api")) : setTimeout(wait, 200));
    const go = () => {
      if (yt) { yt.loadVideoById({ videoId, startSeconds: start }); resolve(); return; }
      yt = new YT.Player("player", {
        videoId,
        playerVars: { start: Math.floor(start), autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, cc_load_policy: 0 },
        events: { onReady: (e) => { e.target.playVideo(); resolve(); }, onStateChange, onError },
      });
    };
    wait();
  });
}
function onStateChange(e) {
  if (e.data === 0) songEnded(); // ENDED
  if (e.data === 1) { paused = false; busy(false); broadcastState(); }
  if (e.data === 2) { paused = true; broadcastState(); }
}
async function onError(e) {
  // 100 removed, 101/150 embedding blocked, 2/5 bad id → mark and try another version
  if (!current || !curVideo) return;
  if (guideOn && backing) { forgetGuide(current.song.id); guideOn = false; curVideo = backing; toast("這個原唱版不能播，回到伴唱版"); await makePlayer(backing.id); return; }
  guideOn = false;
  const song = current.song;
  current.errs = (current.errs || 0) + 1;
  busy(true, "這個版本不能播，換一個…");
  if (current.errs <= 3) try {
    const r = await api("mark_bad", { song_id: song.id, video_id: curVideo.id });
    current.song = r.song;
    const v = bestVideo(r.song);
    if (v) { curVideo = v; await makePlayer(v.id); return; }
  } catch { /* fallthrough */ }
  toast("找不到可以播放的版本，跳下一首");
  await finishCurrent("skipped");
}
function busy(onoff, text = "準備中…") { $("#busy").hidden = !onoff; $("#busyText").textContent = text; }

let advancing = false;
async function refreshQueue() {
  const q = await queueNow();
  if (q.playing && (!current || current.id !== q.playing.id)) {
    // resume what was marked playing (e.g. after a reload)
    const age = Date.now() - new Date(q.playing.started_at || q.playing.created_at).getTime();
    if (age > 20 * 60e3) { await sb.from("ktv_queue").update({ status: "skipped" }).eq("id", q.playing.id); return refreshQueue(); }
    if (!advancing) startItem(q.playing);
  } else if (!q.playing && !current && q.queued.length && !advancing) {
    advancing = true;
    const next = q.queued[0];
    await sb.from("ktv_queue").update({ status: "playing", started_at: new Date().toISOString() }).eq("id", next.id);
    emit("queue");
    advancing = false;
    startItem({ ...next, status: "playing" });
  }
  updateNowBar(q);
  const n = q.queued.length + (q.playing ? 1 : 0);
  if (n !== qCount) { qCount = n; const had = document.activeElement?.dataset?.tab; renderTabs(); if (had) $(`#tabs [data-tab="${had}"]`)?.focus(); }
  if (view === "home" && tab === "queue") renderTab();
}
async function startItem(item) {
  current = item; ending = false;
  busy(true, `準備「${item.song.title}」…`);
  let song = item.song;
  if (song.yt_status !== "ok" || !bestVideo(song)) {
    try { song = (await api("resolve", { song_id: song.id })).song; } catch { /* ignore */ }
  }
  current.song = song;
  const v = bestVideo(song);
  if (!v) { toast(`找不到「${song.title}」的影片，跳下一首`); await finishCurrent("skipped"); return; }
  curVideo = v; backing = null;
  guideOn = kindOf(v) === "g";
  if (view !== "splash") show("playing");
  clearTimeout(busyT);
  busyT = setTimeout(() => { if (!$("#busy").hidden) { busy(false); toast("影片載入比較慢，可按 OK 叫出控制列切歌"); } }, 20000);
  try { await makePlayer(v.id); }
  catch { busy(false); toast("YouTube 播放器載入失敗，請檢查網路"); return; }
  broadcastState();
  flashNowBar();
}
let busyT = null;
function nowText(q) {
  const nx = q?.queued?.[0];
  return { nx: nx ? `下一首：${nx.song.title}${nx.member ? "（" + nx.member.name + "）" : ""}` : "下一首：還沒有人點，快用手機點歌" };
}
let lastQ = null;
function updateNowBar(q) {
  lastQ = q || lastQ;
  const el = $("#nowBar");
  if (!current) { el.hidden = true; renderMiniNow(); return; }
  const m = current.member;
  el.innerHTML = `<div class="who">${m ? esc(m.emoji + " " + m.name) + " 正在唱" : "正在唱"}${guideOn ? " · 導唱中" : ""}</div>
    <div class="t">${esc(current.song.title)} <span class="muted" style="font-size:1.2vw;font-weight:500">${esc(current.song.artist || "")}</span></div>
    <div class="nx">${esc(nowText(lastQ).nx)}</div>`;
  el.hidden = view === "home";
  if (view === "home") renderMiniNow();
}
let dimT = null;
function flashNowBar() {
  const el = $("#nowBar");
  updateNowBar();
  el.classList.remove("dim");
  clearTimeout(dimT);
  dimT = setTimeout(() => el.classList.add("dim"), 8000);
}
function broadcastState() {
  emit("state", current ? { qid: current.id, song_id: current.song.id, title: current.song.title, artist: current.song.artist, member_id: current.member_id, paused } : { qid: null });
}
function togglePause() {
  if (!yt || !current) return;
  if (paused) yt.playVideo(); else yt.pauseVideo();
}
async function skip() { if (current) await finishCurrent("skipped"); }
function fastForward() { seekBy(5); }
// reactions sent from phones float up over the video
on("react", (p) => {
  const e = String(p.e || "").slice(0, 8); if (!e) return;
  const el = document.createElement("div");
  el.className = "fxfly" + (e.length > 2 ? " txt" : "");
  el.style.left = 8 + Math.random() * 80 + "%";
  el.innerHTML = `${esc(e)}${p.who ? `<small>${esc(String(p.who).slice(0, 12))}</small>` : ""}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
  if (e === "👏") applause();
});
function replay() { if (yt && current) { yt.seekTo(0, true); yt.playVideo(); flashNowBar(); } }
// 導唱: switch to a vocal version at the same moment; prefer the same channel's 導唱 cut so the timing lines up
let guideOn = false, backing = null;
async function toggleGuide() {
  if (!current || !yt) return;
  const song = current.song;
  const t = Math.max(0, (yt.getCurrentTime ? yt.getCurrentTime() : 0) || 0);
  if (guideOn) {
    const b = backing || (song.yt || []).find((x) => !x.bad && kindOf(x) === "b");
    if (!b) { toast("這首目前只有原唱版，沒有伴唱版"); return; }
    guideOn = false; curVideo = b; await makePlayer(b.id, t); toast("導唱關閉（伴唱版）"); flashNowBar(); return;
  }
  busy(true, "尋找對得上拍子的原唱版…");
  const r = await findGuide(song, curVideo).catch(() => null);
  busy(false);
  if (current?.song.id !== song.id) return;
  if (!r) { toast("找不到這首的原唱版本"); return; }
  backing = curVideo; guideOn = true; curVideo = r.v;
  await makePlayer(r.v.id, t);
  toast(r.synced ? "導唱開啟（同一支伴唱帶的原唱版，拍子對齊）" : "導唱開啟（原唱 MV 版）· 歌聲快或慢的話用 ⏪ ⏩ 對拍", 4500);
  flashNowBar();
}
function seekBy(d) { if (yt && current) { yt.seekTo(Math.max(0, (yt.getCurrentTime ? yt.getCurrentTime() : 0) + d), true); toast(d > 0 ? `快轉 ${d} 秒 ⏩` : `倒退 ${-d} 秒 ⏪`); } }
async function altVersion() {
  if (!current) return;
  const c = (current.song.yt || []).filter((x) => !x.bad);
  const i = c.findIndex((x) => x.id === curVideo?.id);
  const nx = c[(i + 1) % c.length];
  if (nx && nx.id !== curVideo?.id) { curVideo = nx; await makePlayer(nx.id); toast("已換成另一個版本"); }
  else toast("目前只有這個版本");
}

async function finishCurrent(status) {
  if (!current) return;
  const item = current, video = guideOn && backing ? backing : curVideo;
  let played = 0; try { played = yt?.getCurrentTime ? yt.getCurrentTime() : 0; } catch { /* */ }
  advancing = true; // block the 8-second poll from restarting this song while its status is being saved
  current = null; curVideo = null;
  try { yt?.stopVideo(); } catch { /* */ }
  try { await closeQueue(item, status, video, played); } finally { advancing = false; }
  emit("queue");
  updateNowBar();
  if (view === "ctl" || view === "playing") show("home");
  busy(false);
  refreshQueue();
}

// ================= end of song → score =================
let scoreWait = null;
on("score", (p) => { if (scoreWait && p.hid === scoreWait.hid) scoreWait.scores.push(p); });
async function songEnded() {
  if (ending || !current) return;
  ending = true;
  const item = current;
  const { data: h } = await sb.from("ktv_history").insert({ member_id: item.member_id, song_id: item.song.id }).select("id").single();
  const hid = h?.id;
  scoreWait = { hid, scores: [] };
  emit("ended", { qid: item.id, hid, song_id: item.song.id, title: item.song.title });
  const el = $("#score");
  el.hidden = false; el.classList.remove("pop");
  el.innerHTML = `<div class="s-msg">唱完了！</div><div class="s-sub">評分中…</div>`;
  await new Promise((r) => setTimeout(r, 2800));
  const best = scoreWait.scores.sort((a, b) => b.score - a.score)[0];
  scoreWait = null;
  const who = item.member ? item.member.emoji + " " + item.member.name : "";
  const clapName = applause("end");
  if (best) {
    if (hid) await sb.from("ktv_history").update({ score: best.score }).eq("id", hid);
    el.innerHTML = `<div class="s-who">${esc(who)}　${esc(item.song.title)}</div><div class="s-num">${best.score}</div><div class="s-msg">${praise(best.score)}</div><div class="s-sub">喜歡這首？手機上按 ❤ 加入最愛</div>`;
    el.classList.add("pop");
  } else {
    el.innerHTML = `<div class="s-who">${esc(who)}　${esc(item.song.title)}</div><div class="s-msg" style="font-size:5vw">👏 唱得好！</div><div class="s-sub">想要分數？手機點歌頁打開「評分麥克風」</div><div class="s-sub">喜歡這首？手機上按 ❤ 加入最愛</div>`;
  }
  if (clapName) el.insertAdjacentHTML("beforeend", `<div class="s-sub" style="opacity:.45;font-size:.9vw">掌聲：${esc(clapName)}版</div>`);
  await new Promise((r) => setTimeout(r, 5500));
  el.hidden = true;
  await finishCurrent("done");
}
function praise(s) {
  if (s >= 95) return "歌神降臨！";
  if (s >= 90) return "太好聽了！";
  if (s >= 85) return "唱得真好！";
  if (s >= 78) return "很有感覺！";
  return "勇氣可嘉！";
}
let actx = null;
function applause(kind = "short") {
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); return playApplause(actx, kind); } catch { return ""; }
}

// ================= control bar + phone commands =================
$$("#ctlBar .ctl").forEach((b) => (b.onclick = () => {
  const c = b.dataset.c;
  if (c === "pause") togglePause();
  if (c === "skip") skip();
  if (c === "replay") replay();
  if (c === "ff") fastForward();
  if (c === "back") seekBy(-5);
  if (c === "alt") altVersion();
  if (c === "guide") toggleGuide();
  if (c === "menu") { show("home"); renderTab(); return; }
  show("playing");
}));
on("ctl", (p) => {
  if (p.cmd === "pause") togglePause();
  if (p.cmd === "skip") skip();
  if (p.cmd === "replay") replay();
  if (p.cmd === "alt") altVersion();
  if (p.cmd === "guide") toggleGuide();
  if (p.cmd === "fx") applause();
  if (p.cmd === "ff") fastForward();
  if (p.cmd === "back") seekBy(-5);
});
// touch screens (phone/tablet used as the player): tap the video for controls, tap the mini bar to return
$("#stage").onclick = () => { if (view === "playing") show("ctl"); };
$("#miniNow").onclick = () => { if (current) show("playing"); };
on("queue", () => refreshQueue());
on("hello", () => broadcastState());


// ================= boot =================
// First run on a new TV: show a pairing QR; a phone that is already set up confirms it.
async function startPairing() {
  show("splash");
  $("#startBtn").hidden = true;
  const note = $("#splashNote"), cv = $("#pairQr");
  try {
    const { code } = await api("pair_start");
    drawQrTo(cv, location.origin + BASE + "m.html?pair=" + code);
    cv.hidden = false;
    note.innerHTML = `第一次使用這台電視：用<b>已經能點歌的手機</b>掃描上方 QR Code 完成配對<span class="code">${code}</span>`;
    const poll = setInterval(async () => {
      try {
        const r = await api("pair_poll", { code });
        if (r.status === "ok") { clearInterval(poll); store("ktv_key", r.key); note.textContent = "配對完成！"; setTimeout(() => location.reload(), 800); }
        if (r.status === "expired") { clearInterval(poll); startPairing(); }
      } catch { /* keep polling */ }
    }, 2000);
  } catch {
    note.textContent = "連不上網路，5 秒後重試…";
    setTimeout(startPairing, 5000);
  }
}

async function boot() {
  if (new URLSearchParams(location.search).get("auto") === "1") store("ktv_autostart", "1");
  if (!KEY) { startPairing(); return; }
  drawQr();
  renderTabs();
  charts = await chartList().catch(() => []);
  show("splash");
  setTimeout(() => $("#startBtn").focus(), 50);
  $("#startBtn").onclick = () => {
    try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { /* */ }
    show("home"); renderTab();
    const old = new Date(Date.now() - 3 * 3600e3).toISOString();
    sb.from("ktv_queue").update({ status: "skipped" }).in("status", ["queued", "playing"]).lt("created_at", old).then(() => refreshQueue(), () => refreshQueue());
  };
  if (store("ktv_autostart") === "1") $("#startBtn").click();
  setInterval(refreshQueue, 8000);
  setInterval(() => { if (current) broadcastState(); }, 15000);
}
boot();
