import {
  KEY, sb, api, on, emit, chartList, chartSongs, favoritesOf, sungSongs, queueNow, enqueue,
  badges, esc, bestVideo, toast, store,
} from "./shared.js?v=1794446854";

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
const TABS = [
  { id: "home", name: "首頁" },
  { id: "tw", name: "台灣排行" },
  { id: "cn", name: "大陸排行" },
  { id: "classic", name: "經典回憶" },
  { id: "fav", name: "家人最愛" },
  { id: "sung", name: "常唱的歌" },
  { id: "queue", name: "排隊中" },
];
let tab = "home", charts = [], chartSel = {};
function renderTabs() {
  $("#tabs").innerHTML = TABS.map((t) => `<button class="f tab ${t.id === tab ? "on" : ""}" data-tab="${t.id}">${t.name}</button>`).join("");
  $$("#tabs .tab").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTabs(); renderTab(); $(`#tabs [data-tab="${tab}"]`).focus(); }));
}
function card(s, extra = "") {
  return `<button class="f card" data-song="${s.id}">
    ${s.rank ? `<span class="rk">${s.rank}</span>` : ""}
    <span class="t">${esc(s.title)}</span>
    <span class="a">${esc(s.artist || "")}</span>
    ${extra}
    <span class="b">${badges(s)}</span>
  </button>`;
}
function bindCards(root) {
  $$("[data-song]", root).forEach((b) => (b.onclick = async () => {
    try { const ok = await enqueue(b.dataset.song, null); toast(!ok ? "這首已經在排隊了" : current ? "已加入排隊" : "準備播放…"); refreshQueue(); }
    catch { toast("點歌失敗，請再試一次"); }
  }));
}
async function renderTab() {
  const head = $("#mainHead"), box = $("#content");
  box.innerHTML = `<div class="empty">載入中…</div>`;
  if (tab === "home") {
    head.innerHTML = `<h2>今晚想唱什麼？</h2>`;
    const [sung, top, ktv, classic] = await Promise.all([
      sungSongs(null, 10), chartSongs("tw-kkbox-song", 10), chartSongs("cn-qq-ktv", 10), chartSongs("classic-90s", 10),
    ]);
    box.innerHTML =
      (sung.length ? `<div class="row-title">全家常唱 <small>唱過最多次</small></div><div class="grid">${sung.map((s) => card(s, `<span class="who">唱過 ${s.times} 次</span>`)).join("")}</div>` : "") +
      `<div class="row-title">KKBOX 華語單曲週榜 <small>台灣</small></div><div class="grid">${top.map((s) => card(s)).join("")}</div>` +
      `<div class="row-title">K歌金曲榜 <small>大陸 KTV 熱唱</small></div><div class="grid">${ktv.map((s) => card(s)).join("")}</div>` +
      `<div class="row-title">90 年代經典 <small>大家都會唱</small></div><div class="grid">${classic.map((s) => card(s)).join("")}</div>`;
  } else if (tab === "tw" || tab === "cn" || tab === "classic") {
    const list = charts.filter((c) => c.region === tab);
    const sel = chartSel[tab] || list[0]?.id;
    chartSel[tab] = sel;
    head.innerHTML = `<h2>${TABS.find((t) => t.id === tab).name}</h2>` +
      list.map((c) => `<button class="f chip ${c.id === sel ? "on" : ""}" data-chart="${c.id}">${esc(c.name)}</button>`).join("");
    $$("[data-chart]", head).forEach((b) => (b.onclick = () => { chartSel[tab] = b.dataset.chart; renderTab().then(() => $(`[data-chart="${b.dataset.chart}"]`)?.focus()); }));
    const songs = await chartSongs(sel, 60);
    const c = list.find((x) => x.id === sel);
    box.innerHTML = `<div class="row-title">${esc(c?.name || "")} <small>${esc(c?.source || "")}${c?.updated_at ? " · 更新於 " + new Date(c.updated_at).toLocaleDateString("zh-TW") : ""}</small></div>
      <div class="grid">${songs.map((s) => card(s)).join("") || `<div class="empty">還沒有資料</div>`}</div>`;
  } else if (tab === "fav") {
    head.innerHTML = `<h2>家人最愛</h2>`;
    const songs = await favoritesOf(null);
    box.innerHTML = songs.length ? `<div class="grid">${songs.map((s) => card(s)).join("")}</div>` : `<div class="empty">還沒有人加最愛。用手機點歌時按 ★ 就會出現在這裡。</div>`;
  } else if (tab === "sung") {
    head.innerHTML = `<h2>常唱的歌</h2>`;
    const songs = await sungSongs(null, 60);
    box.innerHTML = songs.length ? `<div class="grid">${songs.map((s) => card(s, `<span class="who">唱過 ${s.times} 次${s.best ? " · 最高 " + s.best + " 分" : ""}</span>`)).join("")}</div>` : `<div class="empty">還沒有唱過的歌，唱完的歌會自動記在這裡。</div>`;
  } else if (tab === "queue") {
    head.innerHTML = `<h2>排隊中</h2>`;
    const q = await queueNow();
    const rows = [q.playing, ...q.queued].filter(Boolean);
    box.innerHTML = rows.length ? `<div class="grid">${rows.map((r, i) => card(r.song, `<span class="who">${i === 0 && q.playing ? "▶ 正在唱" : "第 " + (q.playing ? i : i + 1) + " 首"}${r.member ? " · " + esc(r.member.emoji + r.member.name) : ""}</span>`)).join("")}</div>` : `<div class="empty">還沒有人點歌。</div>`;
  }
  bindCards(box);
  if (view === "home" && !$("#home").contains(document.activeElement)) focusFirst(box);
}
function renderMiniNow() {
  const el = $("#miniNow");
  if (!current) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `正在唱 <b>${esc(current.song.title)}</b><br><span class="muted">按返回鍵回到畫面</span>`;
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
function makePlayer(videoId) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const wait = () => (window.YT && YT.Player ? go() : Date.now() - t0 > 15000 ? reject(new Error("yt_api")) : setTimeout(wait, 200));
    const go = () => {
      if (yt) { yt.loadVideoById(videoId); resolve(); return; }
      yt = new YT.Player("player", {
        videoId,
        playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, cc_load_policy: 0 },
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
  curVideo = v;
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
  if (!current) { el.hidden = true; return; }
  const m = current.member;
  el.innerHTML = `<div class="who">${m ? esc(m.emoji + " " + m.name) + " 正在唱" : "正在唱"}</div>
    <div class="t">${esc(current.song.title)} <span class="muted" style="font-size:1.2vw;font-weight:500">${esc(current.song.artist || "")}</span></div>
    <div class="nx">${esc(nowText(lastQ).nx)}</div>`;
  el.hidden = view === "home";
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
function replay() { if (yt && current) { yt.seekTo(0, true); yt.playVideo(); flashNowBar(); } }
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
  const item = current;
  advancing = true; // block the 8-second poll from restarting this song while its status is being saved
  current = null; curVideo = null;
  try { yt?.stopVideo(); } catch { /* */ }
  try { await sb.from("ktv_queue").update({ status }).eq("id", item.id); } finally { advancing = false; }
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
  emit("ended", { qid: item.id, hid });
  const el = $("#score");
  el.hidden = false; el.classList.remove("pop");
  el.innerHTML = `<div class="s-msg">唱完了！</div><div class="s-sub">評分中…</div>`;
  await new Promise((r) => setTimeout(r, 2800));
  const best = scoreWait.scores.sort((a, b) => b.score - a.score)[0];
  scoreWait = null;
  const who = item.member ? item.member.emoji + " " + item.member.name : "";
  applause();
  if (best) {
    if (hid) await sb.from("ktv_history").update({ score: best.score }).eq("id", hid);
    el.innerHTML = `<div class="s-who">${esc(who)}　${esc(item.song.title)}</div><div class="s-num">${best.score}</div><div class="s-msg">${praise(best.score)}</div>`;
    el.classList.add("pop");
  } else {
    el.innerHTML = `<div class="s-who">${esc(who)}　${esc(item.song.title)}</div><div class="s-msg" style="font-size:5vw">👏 唱得好！</div><div class="s-sub">想要分數？手機點歌頁打開「評分麥克風」</div>`;
  }
  await new Promise((r) => setTimeout(r, 4500));
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
function applause() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const dur = 2.6, sr = actx.sampleRate, buf = actx.createBuffer(1, sr * dur, sr), d = buf.getChannelData(0);
    for (let k = 0; k < 90; k++) { // many short noise bursts = crowd clapping
      const t0 = Math.floor(Math.random() * (dur - 0.08) * sr), len = Math.floor(sr * (0.01 + Math.random() * 0.02));
      const amp = 0.25 + Math.random() * 0.35;
      for (let i = 0; i < len; i++) d[t0 + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
    }
    for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, (d.length - i) / (sr * 0.8));
    const src = actx.createBufferSource(), f = actx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.6;
    src.buffer = buf; src.connect(f).connect(actx.destination); src.start();
  } catch { /* */ }
}

// ================= control bar + phone commands =================
$$("#ctlBar .ctl").forEach((b) => (b.onclick = () => {
  const c = b.dataset.c;
  if (c === "pause") togglePause();
  if (c === "skip") skip();
  if (c === "replay") replay();
  if (c === "alt") altVersion();
  if (c === "menu") { show("home"); renderTab(); return; }
  show("playing");
}));
on("ctl", (p) => {
  if (p.cmd === "pause") togglePause();
  if (p.cmd === "skip") skip();
  if (p.cmd === "replay") replay();
  if (p.cmd === "alt") altVersion();
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
