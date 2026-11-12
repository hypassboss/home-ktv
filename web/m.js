import {
  KEY, sb, api, on, emit, chartList, chartSongs, searchSongs, members, favoritesOf, sungSongs,
  queueNow, enqueue, bumpToFront, removeQueued, badges, esc, toast, store,
} from "./shared.js?v=1794446854";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const V = $("#view");

let me = null;              // current member {id,name,emoji}
let favIds = new Set();
let dl = new Map();         // song_id -> status
let charts = [];
let view = "home", region = store("ktv_region") || "tw", chartSel = {};

// ================= who am I =================
async function openWho() {
  const list = await members();
  $("#whoList").innerHTML = list.map((m) => `<button data-id="${m.id}">${esc(m.emoji)} ${esc(m.name)}</button>`).join("") || `<span class="muted">還沒有人，先新增自己的名字</span>`;
  $$("#whoList button").forEach((b) => (b.onclick = () => { setMe(list.find((m) => m.id === b.dataset.id)); }));
  $("#who").hidden = false;
}
$("#whoForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#whoName").value.trim();
  if (!name) return;
  const emojis = ["🎤", "🎸", "🎹", "🥁", "🎷", "🎺", "🌟", "🔥", "🐯", "🦊"];
  const { data, error } = await sb.from("ktv_members").insert({ name, emoji: emojis[Math.floor(Math.random() * emojis.length)] }).select().single();
  if (error) { toast(error.code === "23505" ? "這個名字已經有了，直接點它" : "新增失敗"); return; }
  $("#whoName").value = "";
  setMe(data);
};
async function setMe(m) {
  me = m; store("ktv_member", JSON.stringify(m));
  $("#who").hidden = true;
  await loadMine();
  render();
}
async function loadMine() {
  if (!me) return;
  const [{ data: f }, { data: d }] = await Promise.all([
    sb.from("ktv_favorites").select("song_id").eq("member_id", me.id),
    sb.from("ktv_downloads").select("song_id,status"),
  ]);
  favIds = new Set((f || []).map((r) => r.song_id));
  dl = new Map((d || []).map((r) => [r.song_id, r.status]));
}

// ================= song rows =================
function row(s, opts = {}) {
  const fav = favIds.has(s.id);
  const left = opts.rank != null ? `<span class="rk">${opts.rank}</span>` : "";
  const info = opts.info ? `<span>${opts.info}</span>` : "";
  const st = dl.get(s.id);
  const dlBtn = opts.download
    ? `<button class="ib dl ${st === "done" ? "done" : st ? "req" : ""}" data-dl="${s.id}" aria-label="下載">${st === "done" ? "✓" : st ? "⏳" : "⬇"}</button>`
    : "";
  return `<div class="song">
    ${left}
    <div class="meta"><div class="t">${esc(s.title)}</div>
      <div class="a">${esc(s.artist || "")} ${badges(s)} ${info}</div></div>
    <div class="acts">
      <button class="ib star ${fav ? "on" : ""}" data-fav="${s.id}" aria-label="最愛">${fav ? "★" : "☆"}</button>
      ${dlBtn}
      <button class="ib go" data-add="${s.id}" aria-label="點歌">${opts.goLabel || "＋點歌"}</button>
    </div></div>`;
}
function bindRows(root) {
  $$("[data-add]", root).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const ok = await enqueue(b.dataset.add, me?.id); toast(ok ? "已點歌 🎵" : "這首已經在排隊了"); refreshNow(); }
    catch { toast("點歌失敗，請再試一次"); }
    b.disabled = false;
  }));
  $$("[data-fav]", root).forEach((b) => (b.onclick = async () => {
    if (!me) return openWho();
    const id = b.dataset.fav;
    if (favIds.has(id)) { favIds.delete(id); await sb.from("ktv_favorites").delete().eq("member_id", me.id).eq("song_id", id); }
    else { favIds.add(id); await sb.from("ktv_favorites").insert({ member_id: me.id, song_id: id }); toast("加入我的最愛 ★"); }
    const on = favIds.has(id);
    $$(`[data-fav="${id}"]`).forEach((x) => { x.classList.toggle("on", on); x.textContent = on ? "★" : "☆"; });
  }));
  $$("[data-dl]", root).forEach((b) => (b.onclick = async () => {
    const id = b.dataset.dl;
    const st = dl.get(id);
    if (st === "done") { toast("已下載，可以離線唱"); return; }
    if (st) { toast("已在下載佇列，等處理站接單"); return; }
    const { error } = await sb.from("ktv_downloads").upsert({ song_id: id, status: "requested", requested_by: me?.id || null, updated_at: new Date().toISOString() });
    if (error) { toast("送出失敗"); return; }
    dl.set(id, "requested");
    b.classList.add("req"); b.textContent = "⏳";
    toast("已送到下載佇列（處理站上線後會自動處理）", 3200);
  }));
}

// ================= views =================
async function render() {
  $$("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.v === view));
  if (view === "home") return renderHome();
  if (view === "search") return renderSearch();
  if (view === "queue") return renderQueue();
  if (view === "fav") return renderFav();
  if (view === "sung") return renderSung();
}
$$("#tabbar button").forEach((b) => (b.onclick = () => { view = b.dataset.v; render(); window.scrollTo(0, 0); }));

async function renderHome() {
  const list = charts.filter((c) => c.region === region);
  const sel = chartSel[region] || list[0]?.id;
  chartSel[region] = sel;
  V.innerHTML = `<div class="seg">${[["tw", "台灣排行"], ["cn", "大陸排行"], ["classic", "經典回憶"]].map(([k, n]) => `<button data-r="${k}" class="${k === region ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="chips">${list.map((c) => `<button class="chip ${c.id === sel ? "on" : ""}" data-c="${c.id}">${esc(c.name)}</button>`).join("")}</div>
    <div id="chartBody"><div class="empty">載入中…</div></div>`;
  $$("[data-r]").forEach((b) => (b.onclick = () => { region = b.dataset.r; store("ktv_region", region); renderHome(); }));
  $$("[data-c]").forEach((b) => (b.onclick = () => { chartSel[region] = b.dataset.c; renderHome(); }));
  if (!sel) { $("#chartBody").innerHTML = `<div class="empty">排行榜還沒有資料</div>`; return; }
  const songs = await chartSongs(sel, 60);
  const c = list.find((x) => x.id === sel);
  $("#chartBody").innerHTML = `<div class="sub">${esc(c.source)}${c.updated_at ? " · 更新於 " + new Date(c.updated_at).toLocaleDateString("zh-TW") : ""}</div>
    <div class="list">${songs.map((s) => row(s, { rank: s.rank })).join("")}</div>`;
  bindRows($("#chartBody"));
}

let lastQ = "", lastVids = null;
function renderSearch() {
  V.innerHTML = `<form class="searchbox" id="sf">
      <input id="q" type="search" placeholder="歌名或歌手，例如：月亮代表我的心" value="${esc(lastQ)}" autocomplete="off" enterkeyhint="search">
      <button type="button" class="voice" id="voiceBtn" aria-label="語音點歌">🎤</button>
    </form>
    <div id="sr">${lastQ ? "" : `<div class="empty">打字或按 🎤 直接說：「我要唱 月亮代表我的心」</div>`}</div>`;
  $("#sf").onsubmit = (e) => { e.preventDefault(); doSearch($("#q").value); };
  let t = null;
  $("#q").oninput = () => { clearTimeout(t); t = setTimeout(() => doSearch($("#q").value), 350); };
  $("#voiceBtn").onclick = voice;
  if (lastQ) doSearch(lastQ, true);
}
async function doSearch(q, keepVids) {
  q = q.trim(); lastQ = q;
  const box = $("#sr");
  if (!box) return;
  if (!q) { box.innerHTML = `<div class="empty">打字或按 🎤 直接說歌名</div>`; return; }
  if (!keepVids) lastVids = null;
  const songs = await searchSongs(q);
  if (q !== lastQ || !$("#sr")) return; // a newer search started while this one was loading
  box.innerHTML = (songs.length ? `<div class="sub">歌庫裡找到 ${songs.length} 首</div><div class="list">${songs.map((s) => row(s)).join("")}</div>`
      : `<div class="empty">歌庫裡沒有「${esc(q)}」</div>`) +
    `<button class="ytbtn" id="ytb">到 YouTube 找「${esc(q)}」的 KTV 版</button><div id="yr"></div>`;
  bindRows(box);
  $("#ytb").onclick = () => ytSearch(q);
  if (lastVids) showVids(q, lastVids);
}
async function ytSearch(q) {
  const yr = $("#yr");
  yr.innerHTML = `<div class="empty">搜尋 YouTube 中…</div>`;
  try { const r = await api("yt_search", { q }); lastVids = r.videos; showVids(q, r.videos); }
  catch { yr.innerHTML = `<div class="empty">YouTube 搜尋失敗，稍後再試</div>`; }
}
function showVids(q, vids) {
  const yr = $("#yr");
  if (!yr) return;
  if (!vids.length) { yr.innerHTML = `<div class="empty">YouTube 找不到結果</div>`; return; }
  yr.innerHTML = `<div class="sub" style="margin-top:12px">YouTube 結果（點一個就加入歌庫並點歌）</div><div class="list">${vids.map((v, i) => `
    <div class="vid"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg">
      <div class="meta"><div class="t" style="white-space:normal;font-size:13px">${esc(v.t)}</div>
        <div class="a">${esc(v.ch)} ${v.ktv ? `<span class="bd ktv">KTV</span>` : ""}</div></div>
      <button class="ib go" data-v="${i}">點</button></div>`).join("")}</div>`;
  $$("[data-v]", yr).forEach((b) => (b.onclick = async () => {
    const v = vids[+b.dataset.v];
    b.disabled = true;
    try {
      const { title, artist } = guessTitle(q, v);
      const r = await api("add_video", { video_id: v.id, title, artist, video_title: v.t, channel: v.ch, sec: v.sec });
      await enqueue(r.song.id, me?.id);
      toast(`已點「${r.song.title}」🎵`);
      refreshNow();
    } catch { toast("加入失敗"); }
    b.disabled = false;
  }));
}
// Best guess for title/artist from the user's words + the video title ("歌手 - 歌名 KTV")
function guessTitle(q, v) {
  const m = v.t.match(/^\s*([^-–—|｜【\[]+?)\s*[-–—]\s*([^-–—|｜【\[(（]+)/);
  if (m) {
    const a = m[1].trim(), t = m[2].trim();
    if (q.includes(t) || t.includes(q)) return { title: t, artist: a };
    if (q.includes(a) || a.includes(q)) return { title: a, artist: t };
    return { title: t, artist: a };
  }
  return { title: q, artist: "" };
}
function voice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("這個瀏覽器不支援語音，請用 Android 的 Chrome"); return; }
  const r = new SR();
  r.lang = "zh-TW"; r.interimResults = false; r.maxAlternatives = 1;
  const btn = $("#voiceBtn");
  btn.classList.add("rec");
  r.onresult = (e) => {
    let t = e.results[0][0].transcript.trim();
    t = t.replace(/^(我想要唱|我要唱|我想唱|幫我點|我要點|點一首|播放|唱|點)\s*/, "").replace(/[。！？,.，]$/, "");
    $("#q").value = t;
    doSearch(t);
  };
  r.onerror = () => toast("沒聽清楚，再說一次");
  r.onend = () => btn.classList.remove("rec");
  r.start();
}

async function renderQueue() {
  V.innerHTML = `<div class="empty">載入中…</div>`;
  const q = await queueNow();
  const who = (r) => (r.member ? esc(r.member.emoji + " " + r.member.name) : "電視點歌");
  V.innerHTML = (q.playing ? `<div class="sub">正在唱</div><div class="list"><div class="song"><span class="rk">▶</span><div class="meta"><div class="t">${esc(q.playing.song.title)}</div><div class="a">${esc(q.playing.song.artist || "")} · ${who(q.playing)}</div></div></div></div>` : "") +
    `<div class="sub" style="margin-top:12px">接下來（${q.queued.length} 首）</div>` +
    (q.queued.length ? `<div class="list">${q.queued.map((r, i) => `<div class="song"><span class="rk">${i + 1}</span>
      <div class="meta"><div class="t">${esc(r.song.title)}</div><div class="a">${esc(r.song.artist || "")} · ${who(r)}</div></div>
      <div class="acts">${i > 0 ? `<button class="ib" data-up="${r.id}" aria-label="插播">⤒ 插播</button>` : ""}<button class="ib" data-rm="${r.id}" aria-label="移除">✕</button></div></div>`).join("")}</div>`
      : `<div class="empty">排隊是空的，去排行或搜尋點歌吧</div>`);
  $$("[data-up]").forEach((b) => (b.onclick = async () => { await bumpToFront(+b.dataset.up); toast("已插播到下一首"); renderQueue(); }));
  $$("[data-rm]").forEach((b) => (b.onclick = async () => { await removeQueued(+b.dataset.rm); renderQueue(); }));
}
async function renderFav() {
  if (!me) return openWho();
  V.innerHTML = `<div class="empty">載入中…</div>`;
  const songs = await favoritesOf(me.id);
  V.innerHTML = `<div class="sub">${esc(me.emoji + " " + me.name)} 的最愛 · <a href="#" id="sw" style="color:var(--cyan)">換人</a></div>` +
    (songs.length ? `<div class="list">${songs.map((s) => row(s)).join("")}</div>` : `<div class="empty">還沒有最愛。在任何歌曲按 ☆ 就會加進來。</div>`);
  $("#sw").onclick = (e) => { e.preventDefault(); openWho(); };
  bindRows(V);
}
async function renderSung() {
  if (!me) return openWho();
  V.innerHTML = `<div class="empty">載入中…</div>`;
  const songs = await sungSongs(me.id, 80);
  V.innerHTML = `<div class="sub">${esc(me.emoji + " " + me.name)} 唱過的歌 · ▶ 線上唱、⬇ 下載到 USB 離線唱</div>` +
    (songs.length ? `<div class="list">${songs.map((s) => row(s, { info: `唱過 ${s.times} 次${s.best ? " · 最高 " + s.best : ""}`, download: true, goLabel: "▶ 線上唱" })).join("")}</div>` : `<div class="empty">還沒有唱過的歌，唱完會自動記錄。</div>`);
  bindRows(V);
}

// ================= now playing + controls =================
let nowState = null;
async function refreshNow() {
  const q = await queueNow().catch(() => null);
  if (!q) return;
  const b = $("#qBadge");
  b.hidden = !q.queued.length; b.textContent = q.queued.length;
  const p = q.playing;
  $("#now").innerHTML = p
    ? `<div class="lab">${p.member ? esc(p.member.emoji + " " + p.member.name) + " 正在唱" : "正在唱"}${nowState?.paused ? " · 暫停中" : ""}</div><div class="t">${esc(p.song.title)} <span class="muted" style="font-size:13px;font-weight:500">${esc(p.song.artist || "")}</span></div>`
    : `<div class="now-empty">還沒有歌在播，點一首吧 🎤</div>`;
  if (view === "queue") renderQueue();
}
$$(".cbtn[data-c]").forEach((b) => (b.onclick = () => { emit("ctl", { cmd: b.dataset.c }); toast({ pause: "暫停 / 播放", skip: "切歌", replay: "重唱", alt: "換一個版本" }[b.dataset.c]); }));
on("queue", refreshNow);
on("state", (s) => { nowState = s; scorer.onState(s); refreshNow(); });
on("ended", (p) => scorer.onEnded(p));

// ================= scoring mic (fun score) =================
// Listens while a song plays: how much of the song has a singing voice, and how steady the pitch is.
const scorer = (() => {
  let stream = null, ctx = null, an = null, buf = null, timer = null;
  let st = { qid: null, frames: 0, voiced: 0, steady: 0, lastHz: 0, paused: false };
  function reset(qid) { st = { qid, frames: 0, voiced: 0, steady: 0, lastHz: 0, paused: false }; }
  function pitch(data, sr) {
    // simple autocorrelation pitch detector, 80–1000 Hz
    let rms = 0; for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);
    if (rms < 0.02) return { rms, hz: 0 };
    const minLag = Math.floor(sr / 1000), maxLag = Math.floor(sr / 80);
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0; for (let i = 0; i < data.length - lag; i += 2) s += data[i] * data[i + lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    return { rms, hz: bestLag ? sr / bestLag : 0 };
  }
  function tick() {
    if (!an || !st.qid || st.paused) return;
    an.getFloatTimeDomainData(buf);
    const { hz } = pitch(buf, ctx.sampleRate);
    st.frames++;
    if (hz) {
      st.voiced++;
      if (st.lastHz && Math.abs(12 * Math.log2(hz / st.lastHz)) < 1) st.steady++;
      st.lastHz = hz;
    } else st.lastHz = 0;
  }
  function compute() {
    if (st.frames < 40) return null; // less than ~6 s of listening
    const sing = Math.min(1, (st.voiced / st.frames) / 0.45);
    const steady = st.voiced ? st.steady / st.voiced : 0;
    return Math.max(60, Math.min(99, Math.round(62 + sing * 24 + steady * 14)));
  }
  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    an = ctx.createAnalyser(); an.fftSize = 2048; buf = new Float32Array(an.fftSize);
    src.connect(an);
    timer = setInterval(tick, 150);
    if (nowState?.qid) reset(nowState.qid);
  }
  function stop() {
    clearInterval(timer); timer = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    ctx?.close(); ctx = null; an = null;
  }
  return {
    get on() { return !!stream; },
    async toggle() { if (stream) stop(); else await start(); return !!stream; },
    onState(s) { if (!stream) return; if (s.qid !== st.qid) reset(s.qid); st.paused = !!s.paused; },
    onEnded(p) {
      if (!stream) return;
      const score = compute();
      if (score != null && p.hid) emit("score", { hid: p.hid, score, member_id: me?.id || null });
      reset(null);
    },
  };
})();
$("#micBtn").onclick = async () => {
  try {
    const onoff = await scorer.toggle();
    $("#micBtn").setAttribute("aria-pressed", onoff);
    toast(onoff ? "評分麥克風已開：把手機放在唱歌的人附近" : "評分麥克風已關", 2600);
  } catch { toast("沒有麥克風權限，請在瀏覽器允許麥克風"); }
};

// ================= boot =================
async function boot() {
  const pair = new URLSearchParams(location.search).get("pair");
  if (!KEY) {
    V.innerHTML = pair
      ? `<div class="empty">這支手機還沒設定。<br>請先用家庭 KTV 的完整連結（含金鑰）打開一次點歌頁，再回來掃電視上的配對 QR Code。</div>`
      : `<div class="empty">請用手機掃描電視上的 QR Code 開啟點歌</div>`;
    return;
  }
  if (pair) {
    history.replaceState(null, "", location.pathname);
    api("pair_confirm", { code: pair })
      .then((r) => toast(r.ok ? "電視配對完成 📺" : "配對碼過期了，請看電視上的新 QR Code", 3500))
      .catch(() => toast("配對失敗，請再掃一次"));
  }
  try { me = JSON.parse(store("ktv_member") || "null"); } catch { me = null; }
  charts = await chartList();
  await loadMine();
  render();
  refreshNow();
  emit("hello");
  if (!me) openWho();
  setInterval(refreshNow, 10000);
}
boot();
