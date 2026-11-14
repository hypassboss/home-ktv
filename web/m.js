import {
  KEY, sb, api, on, emit, chartList, chartSongs, searchSongs, members, favoritesOf, sungSongs,
  queueNow, enqueue, bumpToFront, removeQueued, badges, esc, toast, store, bestVideo, kindOf, artistsList, songsByArtist, micOffer, SONG_COLS,
} from "./shared.js?v=1794698353";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const V = $("#view");

let me = null;              // current member {id,name,emoji}
let favIds = new Set();
let dl = new Map();         // song_id -> status
let charts = [];
let view = "home", region = store("ktv_region") || "foryou", chartSel = {};

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
// One row = cover · title/singer · red K歌 button · ⋮ (插播 / 最愛 / 同歌手 / 下載)
function cover(s) {
  const v = bestVideo(s);
  return v ? `<img class="cover" loading="lazy" alt="" onerror="this.style.visibility='hidden'" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg">`
    : `<div class="cover ph">${esc((s.title || "?").slice(0, 1))}</div>`;
}
function row(s, opts = {}) {
  const left = opts.rank != null ? `<span class="rk ${opts.rank <= 3 ? "top" : ""}">${opts.rank}</span>` : "";
  const info = opts.info ? `<span>${opts.info}</span>` : "";
  const fav = favIds.has(s.id) ? `<span style="color:var(--gold)">★</span>` : "";
  songCache.set(s.id, s);
  return `<div class="song" data-sid="${s.id}">
    ${left}${cover(s)}
    <div class="meta"><div class="t">${esc(s.title)}</div>
      <div class="a">${esc(s.artist || "")}</div>
      <div class="tags">${fav}${badges(s)}${info}</div></div>
    <button class="kbtn" data-add="${s.id}">K歌</button>
    <button class="more" data-more="${s.id}" aria-label="更多">⋮</button></div>`;
}
let songCache = new Map();
async function toggleFav(id) {
  if (!me) return openWho();
  if (favIds.has(id)) { favIds.delete(id); await sb.from("ktv_favorites").delete().eq("member_id", me.id).eq("song_id", id); toast("已取消最愛"); }
  else { favIds.add(id); await sb.from("ktv_favorites").insert({ member_id: me.id, song_id: id }); toast("加入我的最愛 ★"); }
}
async function requestDl(id) {
  const st = dl.get(id);
  if (st === "done") { toast("已下載，可以離線唱"); return; }
  if (st) { toast("已在下載佇列，等處理站接單"); return; }
  const { error } = await sb.from("ktv_downloads").upsert({ song_id: id, status: "requested", requested_by: me?.id || null, updated_at: new Date().toISOString() });
  if (error) { toast("送出失敗"); return; }
  dl.set(id, "requested");
  toast("已送到下載佇列（處理站上線後會自動處理）", 3200);
}
function bindRows(root) {
  $$(".song[data-sid] .meta", root).forEach((m) => (m.onclick = () => openSongSheet(m.closest(".song").dataset.sid)));
  $$("[data-more]", root).forEach((b) => (b.onclick = () => openSongSheet(b.dataset.more)));
  $$("[data-ins]", root).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const ok = await enqueue(b.dataset.ins, me?.id, true); toast(ok ? "已插播，下一首就唱 ⤒" : "這首已經在排隊了"); refreshNow(); }
    catch { toast("插播失敗，請再試一次"); }
    b.disabled = false;
  }));
  $$("[data-add]", root).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const ok = await addSong(b.dataset.add, false); if (ok) { b.textContent = "已點"; setTimeout(() => (b.textContent = "K歌"), 1800); } }
    catch { toast("點歌失敗，請再試一次"); }
    b.disabled = false;
  }));
}
// 點歌: first song while nothing plays on this phone → open the singing screen right away
async function addSong(id, front) {
  const wasIdle = !lastQueue?.playing && !lastQueue?.queued?.length;
  const ok = await enqueue(id, me?.id, front);
  toast(!ok ? "這首已經在排隊了" : front ? "已插播，下一首就唱 ⤒" : "已點歌 🎵");
  await refreshNow();
  if (ok && wasIdle && mode === "local") openPlayer();
  return ok;
}

// ================= views =================
async function render() {
  const tab = view === "artist" ? "artists" : view === "charts" || view === "search" ? "home" : view;
  $$("#tabbar button[data-v]").forEach((b) => b.classList.toggle("on", b.dataset.v === tab));
  if (view === "home") return renderHome();
  if (view === "charts") return renderCharts();
  if (view === "search") return renderSearch();
  if (view === "artists") return renderArtists();
  if (view === "artist") return renderArtist();
  if (view === "queue") return renderQueue();
  if (view === "mine") return renderMine();
}
$$("#tabbar button").forEach((b) => (b.onclick = () => { view = b.dataset.v; $("#q").value = ""; lastQ = ""; render(); window.scrollTo(0, 0); }));

// ---- 點歌台 (home): shortcut tiles + category tabs, like the big KTV apps ----
const CATS = [["foryou", "為你推薦"], ["cn-qq-ktv", "K歌金曲"], ["tw-kkbox-song", "華語熱門"], ["tw-kkbox-new", "新歌"], ["cn-douyin", "抖音熱歌"],
  ["classic-90s", "經典老歌"], ["classic-tw", "台語"], ["classic-hk", "粵語"], ["classic-duet", "男女對唱"]];
let homeTab = store("ktv_hometab") || "foryou";
function renderHome() {
  const cats = CATS.filter(([k]) => k === "foryou" || charts.some((c) => c.id === k));
  if (!cats.some(([k]) => k === homeTab)) homeTab = "foryou";
  V.innerHTML = `<div class="tiles">
      <button class="tile" data-go="queue"><i>📋</i>已點<b class="tb" id="tileQ" hidden></b></button>
      <button class="tile" data-go="charts"><i>🏆</i>排行榜</button>
      <button class="tile" data-go="artists"><i>🧑‍🎤</i>歌星</button>
      <button class="tile" data-go="duet"><i>💑</i>對唱</button>
      <button class="tile" data-go="fav"><i>⭐</i>最愛</button>
    </div>
    <div class="ctabs">${cats.map(([k, n]) => `<button class="ctab ${k === homeTab ? "on" : ""}" data-cat="${k}">${n}</button>`).join("")}</div>
    <div id="chartBody"><div class="empty">載入中…</div></div>`;
  $$("[data-go]", V).forEach((b) => (b.onclick = () => {
    const g = b.dataset.go;
    if (g === "duet") { artistFilter = "duet"; view = "artists"; }
    else if (g === "fav") { mineTab = "fav"; view = "mine"; }
    else view = g;
    render(); window.scrollTo(0, 0);
  }));
  $$("[data-cat]", V).forEach((b) => (b.onclick = () => {
    homeTab = b.dataset.cat; store("ktv_hometab", homeTab);
    $$("[data-cat]", V).forEach((x) => x.classList.toggle("on", x === b));
    b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    homeBody();
  }));
  setTileBadge();
  homeBody();
  $(".ctab.on", V)?.scrollIntoView({ inline: "center", block: "nearest" });
}
function setTileBadge() { const t = $("#tileQ"), n = lastQueue?.queued?.length || 0; if (t) { t.hidden = !n; t.textContent = n; } }
async function homeBody() {
  const tab = homeTab;
  if (tab === "foryou") return renderForYou();
  $("#chartBody").innerHTML = `<div class="empty">載入中…</div>`;
  const songs = await chartSongs(tab, 60);
  if (view !== "home" || homeTab !== tab || !$("#chartBody")) return;
  $("#chartBody").innerHTML = songs.length ? `<div class="list">${songs.map((s) => row(s, { rank: s.rank })).join("")}</div>` : `<div class="empty">這個分類還沒有歌</div>`;
  bindRows($("#chartBody"));
}

// ---- 排行榜 page: every chart, by region ----
async function renderCharts() {
  if (!["tw", "cn", "classic"].includes(region)) region = "tw";
  const list = charts.filter((c) => c.region === region);
  const sel = chartSel[region] || list[0]?.id;
  chartSel[region] = sel;
  V.innerHTML = `<div class="vhead"><button class="back" id="bk">‹ 點歌</button><h2>排行榜</h2></div>
    <div class="seg">${[["tw", "台灣"], ["cn", "大陸"], ["classic", "經典"]].map(([k, n]) => `<button data-r="${k}" class="${k === region ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="chips">${list.map((c) => `<button class="chip ${c.id === sel ? "on" : ""}" data-chart="${c.id}">${esc(c.name)}</button>`).join("")}</div>
    <div id="chartBody"><div class="empty">載入中…</div></div>`;
  $("#bk").onclick = () => { view = "home"; render(); };
  $$("[data-r]", V).forEach((b) => (b.onclick = () => { region = b.dataset.r; store("ktv_region", region); renderCharts(); }));
  $$("[data-chart]", V).forEach((b) => (b.onclick = () => { chartSel[region] = b.dataset.chart; renderCharts(); }));
  if (!sel) { $("#chartBody").innerHTML = `<div class="empty">排行榜還沒有資料</div>`; return; }
  const songs = await chartSongs(sel, 60);
  if (view !== "charts" || chartSel[region] !== sel || !$("#chartBody")) return;
  const c = list.find((x) => x.id === sel);
  $("#chartBody").innerHTML = `<div class="sub">${esc(c.source)}${c.updated_at ? " · 更新於 " + new Date(c.updated_at).toLocaleDateString("zh-TW") : ""}</div>
    <div class="list">${songs.map((s) => row(s, { rank: s.rank })).join("")}</div>`;
  bindRows($("#chartBody"));
}

// 猜你會唱: your most-sung singers' other songs + what the family likes; first-timers get the songs everyone knows
async function renderForYou() {
  $("#chartBody").innerHTML = `<div class="empty">幫你挑歌中…</div>`;
  const sections = [];
  const mine = me ? await sungSongs(me.id, 60) : [];
  const sungIds = new Set(mine.map((s) => s.id));
  if (mine.length) {
    const w = new Map();
    for (const s of mine) for (const a of (s.artist || "").split(/\s*[、,，&\/／]\s*/).filter(Boolean)) w.set(a, (w.get(a) || 0) + (s.times || 1));
    const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
    const lists = await Promise.all(top.map((a) => songsByArtist(a)));
    const picks = [];
    lists.forEach((songs) => songs.filter((s) => !sungIds.has(s.id) && s.yt_status !== "none").slice(0, 4).forEach((s) => picks.push(s)));
    if (picks.length) sections.push(["你常唱的歌手，還有這些", picks]);
    sections.push(["再唱一次", mine.slice(0, 8)]);
  }
  const fam = (await favoritesOf(null)).filter((s) => !sungIds.has(s.id)).slice(0, 10);
  if (fam.length) sections.push(["家人的最愛", fam]);
  if (!mine.length) {
    const [ktv, c90, c00] = await Promise.all([chartSongs("cn-qq-ktv", 10), chartSongs("classic-90s", 10), chartSongs("classic-00s", 10)]);
    sections.push(["KTV 最多人點", ktv], ["大家都會唱（90 年代）", c90], ["大家都會唱（2000 年代）", c00]);
  }
  if (view !== "home" || homeTab !== "foryou" || !$("#chartBody")) return;
  $("#chartBody").innerHTML = sections.filter(([, s]) => s.length).map(([h, s]) => `<div class="sub hd">${esc(h)}</div><div class="list">${s.map((x) => row(x)).join("")}</div>`).join("")
    || `<div class="empty">唱幾首之後，這裡會依你的習慣推薦</div>`;
  bindRows($("#chartBody"));
}

let lastQ = "", lastVids = null;
function renderSearch() {
  V.innerHTML = `<div id="sr"><div class="empty">輸入歌名或歌星，或按 🎤 直接說：「我要唱 月亮代表我的心」</div></div>`;
  if (lastQ) doSearch(lastQ, true);
}
// the search box lives in the header and works from every tab
function goSearch(q, alsoYoutube) {
  if (view !== "search") { view = "search"; render(); }
  doSearch(q).then(() => { if (alsoYoutube && q.trim()) ytSearch(q.trim()); });
}
{
  let t = null;
  $("#q").oninput = () => { clearTimeout(t); t = setTimeout(() => goSearch($("#q").value, false), 350); };
  $("#sf").onsubmit = (e) => { e.preventDefault(); clearTimeout(t); $("#q").blur(); goSearch($("#q").value, true); };
  $("#q").onfocus = () => document.body.classList.add("typing");
  $("#q").onblur = () => setTimeout(() => document.body.classList.remove("typing"), 150);
  $("#voiceBtn").onclick = () => voice();
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
async function ytSearch(q, isArtist) {
  const yr = $("#yr");
  if (!yr) return;
  yr.innerHTML = `<div class="empty">搜尋 YouTube 中…</div>`;
  try { const r = await api("yt_search", { q }); lastVids = r.videos; showVids(q, r.videos, isArtist); }
  catch { yr.innerHTML = `<div class="empty">YouTube 搜尋失敗，稍後再試</div>`; }
}
function showVids(q, vids, isArtist) {
  const yr = $("#yr");
  if (!yr) return;
  if (!vids.length) { yr.innerHTML = `<div class="empty">YouTube 找不到結果</div>`; return; }
  yr.innerHTML = `<div class="sub" style="margin-top:12px">YouTube 結果（點一個就加入歌庫並點歌）</div><div class="list">${vids.map((v, i) => `
    <div class="vid"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg">
      <div class="meta"><div class="t" style="white-space:normal;font-size:15px">${esc(v.t)}</div>
        <div class="a">${esc(v.ch)} ${v.ktv ? `<span class="bd ktv">KTV</span>` : ""}</div></div>
      <button class="ib go" data-v="${i}">點歌</button></div>`).join("")}</div>`;
  $$("[data-v]", yr).forEach((b) => (b.onclick = async () => {
    const v = vids[+b.dataset.v];
    b.disabled = true;
    try {
      const { title, artist } = guessTitle(q, v, isArtist);
      const r = await api("add_video", { video_id: v.id, title, artist, video_title: v.t, channel: v.ch, sec: v.sec });
      await enqueue(r.song.id, me?.id);
      toast(`已點「${r.song.title}」🎵`);
      refreshNow();
    } catch { toast("加入失敗"); }
    b.disabled = false;
  }));
}
// Best guess for title/artist from the user's words + the video title ("歌手 - 歌名 KTV")
function guessTitle(q, v, isArtist) {
  const m = v.t.match(/^\s*([^-–—|｜【\[]+?)\s*[-–—]\s*([^-–—|｜【\[(（]+)/);
  const clean = (t) => t.replace(/\s*(KTV|伴奏|伴唱|卡拉OK|karaoke|原唱|導唱|歌詞版?|高清|官方|MV|Official|Lyric[s]?|Video)\b.*$/i, "").trim();
  if (m) {
    const a = m[1].trim(), t = clean(m[2]) || m[2].trim();
    if (isArtist) return t.includes(q) && !a.includes(q) ? { title: clean(a) || a, artist: q } : { title: t, artist: q };
    if (q.includes(t) || t.includes(q)) return { title: t, artist: a };
    if (q.includes(a) || a.includes(q)) return { title: a, artist: t };
    return { title: t, artist: a };
  }
  if (isArtist) return { title: clean(v.t.replace(q, "")).replace(/^[\s\-–—:：《》【】\[\]]+|[\s\-–—:：《》【】\[\]]+$/g, "") || v.t.slice(0, 40), artist: q };
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
    goSearch(t, true);
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
      <div class="acts">${i > 0 ? `<button class="ib" data-mv="${i}" aria-label="往前一首">↑</button><button class="ib" data-up="${r.id}" aria-label="插播">⤒ 置頂</button>` : ""}<button class="ib" data-rm="${r.id}" aria-label="移除">✕</button></div></div>`).join("")}</div>`
      : `<div class="empty">還沒有點歌。到「點歌」或「歌星」選歌，或用上面的搜尋</div>`);
  $$("[data-up]").forEach((b) => (b.onclick = async () => { await bumpToFront(+b.dataset.up); toast("已移到下一首"); renderQueue(); }));
  $$("[data-mv]").forEach((b) => (b.onclick = async () => {
    const i = +b.dataset.mv, a = q.queued[i - 1], c = q.queued[i];
    await sb.from("ktv_queue").update({ priority: a.priority }).eq("id", c.id);
    await sb.from("ktv_queue").update({ priority: c.priority === a.priority ? a.priority + 0.5 : c.priority }).eq("id", a.id);
    emit("queue"); renderQueue();
  }));
  $$("[data-rm]").forEach((b) => (b.onclick = async () => { await removeQueued(+b.dataset.rm); renderQueue(); }));
}
function openSongSheet(id) {
  const s = songCache.get(id); if (!s) return;
  const first = (s.artist || "").split(/\s*[、,，&\/／]\s*/)[0];
  const fav = favIds.has(id);
  const st = dl.get(id);
  $("#songSheet .sheet-in").innerHTML = `<div style="display:flex;gap:12px;align-items:center">${cover(s)}<div style="min-width:0"><h2>${esc(s.title)}</h2><p class="muted" style="margin:0">${esc(s.artist || "")}</p></div></div>
    <div class="mgrid">
      <button class="sbtn go" data-act="add">🎤 K歌（排隊）</button>
      <button class="sbtn go" data-act="ins">⤒ 插播（下一首）</button>
      <button class="sbtn" data-act="fav">${fav ? "★ 取消最愛" : "☆ 加入最愛"}</button>
      ${first ? `<button class="sbtn" data-act="artist">🧑‍🎤 ${esc(first)} 的歌</button>` : ""}
      <button class="sbtn" data-act="dl">${st === "done" ? "✓ 已下載到 USB" : st ? "⏳ 下載排隊中" : "⬇ 下載到 USB"}</button>
      <button class="sbtn ${first ? "" : "wide"}" data-act="close">取消</button>
    </div>`;
  $("#songSheet").hidden = false;
  $$("#songSheet [data-act]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.act;
    $("#songSheet").hidden = true;
    if (a === "add" || a === "ins") {
      try { await addSong(id, a === "ins"); } catch { toast("點歌失敗，請再試一次"); }
    }
    if (a === "fav") { await toggleFav(id); if (view === "mine" || view === "home") render(); }
    if (a === "dl") requestDl(id);
    if (a === "artist") { curArtist = first; view = "artist"; $("#q").value = ""; render(); window.scrollTo(0, 0); }
  }));
}
$("#songSheet").onclick = (e) => { if (e.target.id === "songSheet") $("#songSheet").hidden = true; };

// ---- 歌星 ----
let artistFilter = "all", artistsCache = null, curArtist = "";
async function renderArtists() {
  const F = [["all", "全部"], ["male", "男歌手"], ["female", "女歌手"], ["group", "團體"], ["duet", "對唱合唱"]];
  V.innerHTML = `<div class="chips">${F.map(([k, n]) => `<button class="chip ${k === artistFilter ? "on" : ""}" data-af="${k}">${n}</button>`).join("")}</div><div id="ab"><div class="empty">載入中…</div></div>`;
  $$("[data-af]", V).forEach((b) => (b.onclick = () => { artistFilter = b.dataset.af; renderArtists(); }));
  if (artistFilter === "duet") {
    const { data } = await sb.from("ktv_songs").select(SONG_COLS).eq("gender", "duet").neq("yt_status", "none").order("title").limit(300);
    if (view !== "artists" || artistFilter !== "duet" || !$("#ab")) return;
    $("#ab").innerHTML = (data || []).length ? `<div class="sub">兩人以上一起唱的歌，共 ${data.length} 首</div><div class="list">${data.map((s) => row(s)).join("")}</div>` : `<div class="empty">歌庫裡還沒有對唱歌曲</div>`;
    bindRows($("#ab"));
    return;
  }
  artistsCache = artistsCache || (await artistsList());
  if (view !== "artists" || !$("#ab")) return;
  const list = artistsCache.filter((a) => artistFilter === "all" || a.gender === artistFilter);
  $("#ab").innerHTML = list.length
    ? `<div class="agrid">${list.map((a) => `<button class="abtn" data-artist="${esc(a.name)}"><b>${esc(a.name)}</b><small>${a.n} 首</small></button>`).join("")}</div>`
    : `<div class="empty">沒有符合的歌星，可以用上面的搜尋找</div>`;
  $$("[data-artist]", V).forEach((b) => (b.onclick = () => { curArtist = b.dataset.artist; view = "artist"; render(); window.scrollTo(0, 0); }));
}
async function renderArtist() {
  const name = curArtist;
  V.innerHTML = `<div class="vhead"><button class="back" id="bk">‹ 歌星</button><h2>${esc(name)}</h2></div><div id="sr"><div class="empty">載入中…</div></div>`;
  $("#bk").onclick = () => { view = "artists"; render(); };
  const songs = await songsByArtist(name);
  if (view !== "artist" || curArtist !== name) return;
  $("#sr").innerHTML = (songs.length ? `<div class="list">${songs.map((s) => row(s)).join("")}</div>` : `<div class="empty">歌庫裡還沒有這位歌星的歌</div>`) +
    `<button class="ytbtn" id="ytb">到 YouTube 找「${esc(name)}」更多歌</button><div id="yr"></div>`;
  bindRows($("#sr"));
  $("#ytb").onclick = () => ytSearch(name, true);
}

// ---- 我的：最愛 / 唱過 ----
let mineTab = "fav";
async function renderMine() {
  if (!me) return openWho();
  const elder = document.body.classList.contains("elder");
  V.innerHTML = `<div class="mecard"><div class="big">${esc(me.emoji)}</div><div><b>${esc(me.name)}</b><span class="muted" style="font-size:14px">點的歌、最愛、分數都記在這裡</span></div>
      <div class="acts"><button class="ib" id="swMe">換人</button></div></div>
    <div class="seg"><button data-mt="fav" class="${mineTab === "fav" ? "on" : ""}">我的最愛</button><button data-mt="sung" class="${mineTab === "sung" ? "on" : ""}">唱過的歌</button></div>
    <div id="mb"><div class="empty">載入中…</div></div>
    <button class="ytbtn" id="elderBtn" style="color:var(--fg)">👓 長輩模式（字更大、按鈕更少）：${elder ? "開" : "關"}</button>`;
  $$("[data-mt]", V).forEach((b) => (b.onclick = () => { mineTab = b.dataset.mt; renderMine(); }));
  $("#swMe").onclick = openWho;
  $("#elderBtn").onclick = () => { setElder(!document.body.classList.contains("elder")); renderMine(); };
  const tab = mineTab;
  const songs = tab === "fav" ? await favoritesOf(me.id) : await sungSongs(me.id, 80);
  if (view !== "mine" || tab !== mineTab || !$("#mb")) return;
  $("#mb").innerHTML = songs.length
    ? `<div class="list">${songs.map((s) => (tab === "fav" ? row(s) : row(s, { info: `唱過 ${s.times} 次${s.best ? " · 最高 " + s.best : ""}${dl.get(s.id) === "done" ? " · 已下載" : ""}` }))).join("")}</div>`
    : `<div class="empty">${tab === "fav" ? "還沒有最愛。按歌曲右邊的 ⋮ →「加入最愛」。" : "還沒有唱過的歌，唱完會自動記錄。"}</div>`;
  bindRows($("#mb"));
}

// ================= now playing + controls =================
let nowState = null, lastQueue = null;
async function refreshNow() {
  const q = await queueNow().catch(() => null);
  if (!q) return;
  lastQueue = q;
  P.tick(q);
  const b = $("#qBadge");
  b.hidden = !q.queued.length; b.textContent = q.queued.length;
  setTileBadge();
  const p = q.playing, plOpen = document.body.classList.contains("pl-open");
  const who = p?.member ? esc(p.member.emoji + " " + p.member.name) + " 正在唱" : "正在唱";
  $("#now").innerHTML = p
    ? `<div class="lab">${who}${nowState?.paused ? " · 暫停中" : ""}</div><div class="t">${esc(p.song.title)}</div><div class="a">${esc(p.song.artist || "")}</div>`
    : `<div class="now-empty">還沒有歌在播。按「繼續點歌」選一首，或按下面的 ⌄ 回去點歌 🎤</div>`;
  document.body.classList.toggle("has-song", !!p);
  $("#singBtn").classList.toggle("live", !!p);
  // mini player bar
  $("#mini").hidden = !p || plOpen;
  if (p) {
    $("#miniT").textContent = p.song.title;
    $("#miniA").textContent = (p.song.artist || "") + (mode === "remote" ? " · 電視播放中" : "");
    const v = bestVideo(p.song);
    $("#miniImg").src = v ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : "";
    $(".mthumb").style.visibility = mode === "local" ? "hidden" : "visible"; // in local mode the live video sits there
  }
  // singing screen: in TV mode show the cover + a note where the video would be
  const v = p && bestVideo(p.song);
  $("#vimg").src = v ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : "";
  $("#vimg").hidden = !v;
  $("#vnote").innerHTML = mode === "remote" ? (p ? "📺 在電視上播放中<br><small style='font-weight:500;opacity:.8'>這支手機是遙控器</small>" : "📺 電視唱模式<br><small style='font-weight:500;opacity:.8'>點歌後會在電視播放</small>") : "";
  $("#upnext").innerHTML = q.queued.length
    ? q.queued.slice(0, 3).map((r, i) => `<div class="up"><span>${i + 1}</span><b>${esc(r.song.title)}</b><small>${esc(r.song.artist || "")}</small></div>`).join("") + (q.queued.length > 3 ? `<div class="up"><span></span><small>還有 ${q.queued.length - 3} 首…</small></div>` : "")
    : `<div class="up"><small>還沒有下一首</small></div>`;
  if (view === "queue") renderQueue();
}
const CTL_NAME = { pause: "暫停 / 播放", skip: "切歌", replay: "重唱", alt: "換一個版本", guide: "導唱 開 / 關", fx: "掌聲 👏", ff: "快轉 10 秒" };
// reactions: fly up on the screen that plays the video
function floatFx(box, text, who) {
  if (!box) return;
  const el = document.createElement("div");
  el.className = "fxfly" + (text.length > 2 ? " txt" : "");
  el.style.left = 8 + Math.random() * 74 + "%";
  el.innerHTML = `${esc(text)}${who ? `<small>${esc(who)}</small>` : ""}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
$$("#react [data-e]").forEach((b) => (b.onclick = () => {
  const e = b.dataset.e, who = me?.name || "";
  if (mode === "local") { floatFx($("#pbox"), e, who); if (e === "👏") clap(); }
  else emit("react", { e, who });
  b.classList.add("pop"); setTimeout(() => b.classList.remove("pop"), 300);
}));
on("react", (p) => { if (mode === "local") { floatFx($("#pbox"), String(p.e || "").slice(0, 8), p.who); if (p.e === "👏") clap(); } });
// 長輩模式: everything bigger, fewer distractions
function setElder(on) { document.body.classList.toggle("elder", on); store("ktv_elder", on ? "1" : "0"); }
setElder(store("ktv_elder") === "1");
$("#avatar").onclick = openWho;
$("#who").onclick = (e) => { if (e.target.id === "who" && me) $("#who").hidden = true; };

// ---- singing screen open / close ----
function openPlayer() {
  $("#pl").hidden = false; document.body.classList.add("pl-open");
  history.pushState({ pl: 1 }, "");
  refreshNow();
}
function closePlayer(fromBack) {
  if ($("#pl").hidden) return;
  $("#pl").hidden = true; document.body.classList.remove("pl-open");
  if (!fromBack && history.state?.pl) history.back();
  refreshNow();
}
addEventListener("popstate", () => closePlayer(true));
$("#singBtn").onclick = openPlayer;
$("#plClose").onclick = () => closePlayer();
$("#plBrowse").onclick = () => closePlayer();
$("#mini").onclick = (e) => { if (!e.target.closest("[data-c]")) openPlayer(); };
let actx = null;
function clap() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
    const dur = 2.6, sr = actx.sampleRate, buf = actx.createBuffer(1, sr * dur, sr), d = buf.getChannelData(0);
    for (let k = 0; k < 90; k++) {
      const t0 = Math.floor(Math.random() * (dur - 0.08) * sr), len = Math.floor(sr * (0.01 + Math.random() * 0.02)), amp = 0.25 + Math.random() * 0.35;
      for (let i = 0; i < len; i++) d[t0 + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
    }
    for (let i = 0; i < d.length; i++) d[i] *= Math.min(1, (d.length - i) / (sr * 0.8));
    const src = actx.createBufferSource(), f = actx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.6;
    src.buffer = buf; src.connect(f).connect(actx.destination); src.start();
  } catch { /* */ }
}
$$("#pl [data-c], #mini [data-c], #fsbar [data-c]").forEach((b) => (b.onclick = (e) => {
  e.stopPropagation();
  const c = b.dataset.c;
  if (mode === "local") P.cmd(c); else { emit("ctl", { cmd: c }); toast(CTL_NAME[c]); }
}));
on("queue", refreshNow);
on("state", (s) => { if (mode === "local") return; nowState = s; scorer.onState(s); refreshNow(); });
on("ended", (p) => { if (mode !== "local") scorer.onEnded(p); });
on("ctl", (p) => { if (mode === "local") P.cmd(p.cmd); });
on("hello", () => { if (mode === "local") P.sync(); });

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
    take() { if (!stream) return null; const s = compute(); reset(null); return s; },
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

// ================= phone as a wireless microphone (voice plays on the TV) =================
const liveMic = (() => {
  let pc = null, stream = null, id = null, lock = null, waitT = null;
  const btn = $("#micLive");
  function stop(quiet) {
    clearTimeout(waitT);
    if (id) emit("mic-stop", { id });
    try { pc?.close(); } catch { /* */ }
    stream?.getTracks().forEach((t) => t.stop());
    try { lock?.release(); } catch { /* */ }
    pc = null; stream = null; id = null; lock = null;
    btn.setAttribute("aria-pressed", "false"); btn.textContent = "🎤 手機當麥克風";
    if (!quiet) toast("麥克風已關閉");
  }
  async function start() {
    if (mode === "local") { toast("影片在這支手機播的時候不能當麥克風。先切到「遙控電視」", 3500); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, channelCount: 1 } }); }
    catch { toast("沒有麥克風權限，請在瀏覽器允許麥克風"); return; }
    btn.setAttribute("aria-pressed", "true"); btn.textContent = "🎤 連線中…";
    try {
      id = Math.random().toString(36).slice(2, 10);
      const o = await micOffer(stream);
      pc = o.pc;
      pc.addEventListener("connectionstatechange", () => {
        if (!pc) return;
        if (pc.connectionState === "connected") { clearTimeout(waitT); btn.textContent = "🎤 麥克風開啟中（按一下關閉）"; toast("麥克風已連上電視 🎤"); }
        if (["failed", "disconnected"].includes(pc.connectionState)) { toast("麥克風連線中斷"); stop(true); }
      });
      emit("mic-offer", { id, sdp: o.sdp, name: me?.name || "" });
      waitT = setTimeout(() => { if (pc && pc.connectionState !== "connected") { toast("電視沒有回應：請確認電視的 KTV 開著，而且和手機在同一個 Wi-Fi", 4500); stop(true); } }, 10000);
      try { lock = await navigator.wakeLock?.request("screen"); } catch { /* */ }
    } catch { toast("麥克風連線失敗"); stop(true); }
  }
  on("mic-answer", async (p) => { if (pc && p.id === id) { try { await pc.setRemoteDescription({ type: "answer", sdp: p.sdp }); } catch { /* */ } } });
  btn.onclick = () => (pc || stream ? stop() : start());
  return { stop };
})();

// ================= play on this phone =================
// "local": this phone shows the KTV video.  "remote": this phone controls the TV.
let mode = "remote";
function praise(s) { return s >= 95 ? "歌神降臨！" : s >= 90 ? "太好聽了！" : s >= 85 ? "唱得真好！" : s >= 78 ? "很有感覺！" : "勇氣可嘉！"; }
const P = (() => {
  let yt = null, current = null, curVideo = null, paused = false, started = false, ending = false, advancing = false, guideOn = false, nudgeT = null, fsT = null;
  const guideCache = {};
  const box = $("#pbox"), pmsg = $("#pmsg"), fsbar = $("#fsbar");
  function msg(html, cls = "") { pmsg.hidden = !html; pmsg.className = cls; pmsg.innerHTML = html || ""; }
  function loadApi() {
    if (document.getElementById("ytapi")) return;
    const s = document.createElement("script"); s.id = "ytapi"; s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
  }
  function load(videoId, start = 0) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const wait = () => (window.YT && YT.Player ? go() : Date.now() - t0 > 15000 ? reject(new Error("yt_api")) : setTimeout(wait, 200));
      const go = () => {
        if (yt) { yt.loadVideoById({ videoId, startSeconds: start }); resolve(); return; }
        yt = new YT.Player("player", {
          videoId,
          playerVars: { start: Math.floor(start), autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1 },
          events: { onReady: (e) => { e.target.playVideo(); resolve(); }, onStateChange, onError },
        });
      };
      wait();
    });
  }
  function onStateChange(e) {
    if (e.data === 0) ended();
    if (e.data === 1) { paused = false; started = true; clearTimeout(nudgeT); if (!ending) msg(""); sync(); }
    if (e.data === 2) { paused = true; sync(); }
  }
  function sync() {
    const s = current ? { qid: current.id, title: current.song.title, paused } : { qid: null };
    scorer.onState(s); emit("state", s);
  }
  async function onError() {
    if (!current || !curVideo) return;
    guideOn = false; current.errs = (current.errs || 0) + 1;
    msg("這個版本不能播，換一個…");
    if (current.errs <= 3) try {
      const r = await api("mark_bad", { song_id: current.song.id, video_id: curVideo.id });
      current.song = r.song;
      const v = bestVideo(r.song);
      if (v) { curVideo = v; await load(v.id); return; }
    } catch { /* fall through */ }
    toast("找不到可以播放的版本，跳下一首"); finish("skipped");
  }
  async function start(item) {
    current = item; ending = false; started = false;
    msg(`準備「${esc(item.song.title)}」…`);
    let song = item.song;
    if (song.yt_status !== "ok" || !bestVideo(song)) { try { song = (await api("resolve", { song_id: song.id })).song; } catch { /* */ } }
    if (current !== item) return;
    current.song = song;
    const v = bestVideo(song);
    if (!v) { toast(`找不到「${song.title}」的影片，跳下一首`); return finish("skipped"); }
    curVideo = v; guideOn = kindOf(v) === "g";
    try { await load(v.id); } catch { msg("YouTube 載入失敗，請檢查網路"); return; }
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => { if (current === item && !started) msg("▶ 點一下開始播放", "tap"); }, 4000);
    sync(); refreshNow();
  }
  async function finish(status) {
    if (!current) return;
    const item = current;
    advancing = true; current = null; curVideo = null; clearTimeout(nudgeT);
    try { yt?.stopVideo(); } catch { /* */ }
    try { await sb.from("ktv_queue").update({ status }).eq("id", item.id); } finally { advancing = false; }
    msg(""); emit("queue"); sync(); refreshNow();
  }
  async function ended() {
    if (ending || !current) return;
    ending = true;
    const item = current, score = scorer.take();
    await sb.from("ktv_history").insert({ member_id: item.member_id, song_id: item.song.id, score });
    msg(score != null ? `<b>${score}</b><span>${praise(score)}</span>` : `<span>👏 唱得好！</span><small>想要分數，先按「評分」再唱</small>`, "score");
    await new Promise((r) => setTimeout(r, 4000));
    await finish("done");
  }
  async function tick(q) {
    if (mode !== "local" || current || advancing) return;
    if (q.playing) {
      const age = Date.now() - new Date(q.playing.started_at || q.playing.created_at).getTime();
      if (age > 20 * 60e3) { await sb.from("ktv_queue").update({ status: "skipped" }).eq("id", q.playing.id); return refreshNow(); }
      start(q.playing);
    } else if (q.queued.length) {
      advancing = true;
      const next = q.queued[0];
      try { await sb.from("ktv_queue").update({ status: "playing", started_at: new Date().toISOString() }).eq("id", next.id); } finally { advancing = false; }
      emit("queue"); start({ ...next, status: "playing" });
    }
  }
  async function guide() {
    const song = current.song, c = (song.yt || []).filter((x) => !x.bad);
    const t = Math.max(0, (yt.getCurrentTime ? yt.getCurrentTime() : 0) || 0);
    if (guideOn) {
      const b = c.find((x) => kindOf(x) === "b");
      if (!b) { toast("這首目前只有原唱版，沒有伴唱版"); return; }
      guideOn = false; curVideo = b; await load(b.id, t); toast("導唱關閉（伴唱版）"); return;
    }
    let g = c.find((x) => kindOf(x) === "g") || guideCache[song.id];
    if (!g) {
      toast("尋找原唱版本…");
      try {
        const r = await api("yt_search", { q: `${song.title} ${song.artist || ""} 原唱 歌詞` });
        const ok = (v) => kindOf({ ...v, ktv: false }) === "g" && (!v.sec || (v.sec > 100 && v.sec < 540));
        g = r.videos.find((v) => ok(v) && v.t.includes(song.title)) || null;
        if (g) guideCache[song.id] = g;
      } catch { /* */ }
    }
    if (!g) { toast("找不到這首的原唱版本"); return; }
    guideOn = true; curVideo = g; await load(g.id, t); toast("導唱開啟（原唱版）");
  }
  async function alt() {
    const c = (current.song.yt || []).filter((x) => !x.bad);
    const i = c.findIndex((x) => x.id === curVideo?.id), nx = c[(i + 1) % c.length];
    if (nx && nx.id !== curVideo?.id) { curVideo = nx; guideOn = kindOf(nx) === "g"; await load(nx.id); toast("已換成另一個版本"); }
    else toast("目前只有這個版本");
  }
  function fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (!box.requestFullscreen) { toast("這個瀏覽器不支援全螢幕"); return; }
    box.requestFullscreen().then(() => { try { screen.orientation.lock("landscape").catch(() => {}); } catch { /* */ } }).catch(() => toast("無法進入全螢幕"));
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) { fsbar.classList.remove("show"); try { screen.orientation.unlock(); } catch { /* */ } } });
  $("#ptap").onclick = () => {
    if (current && yt && (!started || paused)) { yt.playVideo(); return; }
    if (document.fullscreenElement) { fsbar.classList.toggle("show"); clearTimeout(fsT); fsT = setTimeout(() => fsbar.classList.remove("show"), 4000); }
  };
  function cmd(c) {
    if (c === "fs") return fullscreen();
    if (c === "fx") return clap();
    if (!current || !yt) { toast("還沒有歌在播，先點一首"); return; }
    if (c === "pause") { if (paused || !started) yt.playVideo(); else yt.pauseVideo(); }
    if (c === "skip") finish("skipped");
    if (c === "replay") { yt.seekTo(0, true); yt.playVideo(); }
    if (c === "ff") { yt.seekTo((yt.getCurrentTime ? yt.getCurrentTime() : 0) + 10, true); toast("快轉 10 秒 ⏩"); }
    if (c === "guide") guide().catch((e) => { console.error("guide", e); toast("導唱切換失敗"); });
    if (c === "alt") alt().catch((e) => { console.error("alt", e); toast("換版本失敗"); });
  }
  function stop() { try { yt?.stopVideo(); } catch { /* */ } current = null; curVideo = null; clearTimeout(nudgeT); msg(""); }
  return { tick, cmd, sync, stop, loadApi };
})();
function setMode(m, save) {
  mode = m;
  if (save) store("ktv_mode", m);
  $$("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("#pbox").hidden = m !== "local";
  $("#fsBtn").hidden = m !== "local";
  $("#micLive").hidden = m === "local";
  if (m === "local") { liveMic.stop(true); P.loadApi(); refreshNow(); } else { P.stop(); refreshNow(); }
}
$$("#modeSeg button").forEach((b) => (b.onclick = () => setMode(b.dataset.m, true)));
// First visit: if a TV answers, be its remote; otherwise play on this phone.
async function pickMode() {
  const saved = store("ktv_mode");
  if (saved === "local" || saved === "remote") return setMode(saved, false);
  let tv = false;
  on("state", () => { tv = true; });
  emit("hello");
  await new Promise((r) => setTimeout(r, 1500));
  setMode(tv ? "remote" : "local", false);
}

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
  await pickMode();
  refreshNow();
  if (!me) openWho();
  setInterval(refreshNow, 10000);
}
boot();
