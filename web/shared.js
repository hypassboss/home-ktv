// Shared data layer for the KTV TV + phone pages
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SUPA_URL = "https://qznvabjtxcbffjryfgqi.supabase.co";
export const PUB_KEY = "sb_publishable_TRgsEg23hMBQbxEsNYEBeg_awalcnSP";
export const FN_URL = SUPA_URL + "/functions/v1/ktv-api";

function ls(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { return null; }
}
export const store = ls;

// Home access key: from ?k= (QR code / first link), remembered afterwards
function readKey() {
  const u = new URL(location.href);
  const k = u.searchParams.get("k");
  if (k) {
    ls("ktv_key", k);
    u.searchParams.delete("k");
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    return k;
  }
  return ls("ktv_key") || "";
}
export const KEY = readKey();

export const sb = createClient(SUPA_URL, PUB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-ktv-key": KEY } },
  realtime: { params: { eventsPerSecond: 10 } },
});

export async function api(action, body = {}) {
  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ktv-key": KEY, apikey: PUB_KEY },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

// ---- realtime room (broadcast only; data itself lives in tables) ----
const handlers = {};
export const room = sb.channel("ktv-room-" + KEY.slice(0, 6), { config: { broadcast: { self: false } } });
room.on("broadcast", { event: "*" }, (msg) => { (handlers[msg.event] || []).forEach((fn) => fn(msg.payload || {})); });
let joined = false;
const pending = [];
room.subscribe((status) => {
  if (status === "SUBSCRIBED") { joined = true; while (pending.length) room.send(pending.shift()); }
});
export function on(event, fn) { (handlers[event] ||= []).push(fn); }
export function emit(event, payload = {}) {
  const m = { type: "broadcast", event, payload };
  if (joined) room.send(m); else pending.push(m);
}

// ---- data helpers ----
export const SONG_COLS = "id,title,artist,language,era,gender,yt,yt_status";

export async function chartList() {
  const { data } = await sb.from("ktv_charts").select("*").order("region").order("sort");
  return data || [];
}
export async function chartSongs(chartId, limit = 50) {
  const { data } = await sb.from("ktv_chart_entries").select("rank, song:ktv_songs(" + SONG_COLS + ")").eq("chart_id", chartId).order("rank").limit(limit);
  return (data || []).map((r) => ({ ...r.song, rank: r.rank })).filter((s) => s.id);
}
export async function songsByIds(ids) {
  if (!ids.length) return [];
  const { data } = await sb.from("ktv_songs").select(SONG_COLS).in("id", ids);
  const m = new Map((data || []).map((s) => [s.id, s]));
  return ids.map((id) => m.get(id)).filter(Boolean);
}
export async function searchSongs(q) {
  const { data } = await sb.rpc("ktv_search", { p_q: q, p_limit: 40 });
  return dedupe(data || []);
}
// Charts bring the same song in under slightly different names ("甲乙丙丁 (你我怎麼兩清)" / "甲乙丙丁Strangers - 你我怎麼兩清").
// Show it once: the copy that can play and has the most versions.
const plain = (t) => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const coreTitle = (t) => {
  t = t || "";
  const c = plain(t.replace(/[（(【\[].*?[）)】\]]/g, "").replace(/\s+[-–—].*$/, "").replace(/(\p{Script=Han})[a-z]+$/iu, "$1"));
  return c || plain(t); // English-only titles keep their full name
};
export function dedupe(songs) {
  const best = new Map(), order = [];
  const score = (s) => (s.yt_status === "ok" ? 10 : 0) + (s.yt || []).filter((x) => !x.bad).length;
  for (const s of songs) {
    const k = coreTitle(s.title) + "|" + (s.artist || "").split(SPLIT)[0].replace(/\s+/g, "").toLowerCase();
    if (!best.has(k)) { best.set(k, s); order.push(k); } else if (score(s) > score(best.get(k))) best.set(k, s);
  }
  return order.map((k) => best.get(k));
}
const SPLIT = /\s*[、,，&\/／]\s*/;
export async function artistsList() {
  const { data } = await sb.from("ktv_songs").select("artist,gender").neq("artist", "").limit(5000);
  const m = new Map();
  for (const r of data || []) {
    const names = r.artist.split(SPLIT).filter(Boolean);
    for (const name of names) {
      const a = m.get(name) || { name, n: 0, gender: null };
      a.n++;
      if (names.length === 1 && r.gender && r.gender !== "duet") a.gender = r.gender;
      m.set(name, a);
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "zh-Hant"));
}
export async function songsByArtist(name) {
  const { data } = await sb.from("ktv_songs").select(SONG_COLS).ilike("artist", "%" + name + "%").order("title").limit(300);
  return data || [];
}
export async function members() {
  const { data } = await sb.from("ktv_members").select("*").order("created_at");
  return data || [];
}
export async function favoritesOf(memberId) {
  const q = sb.from("ktv_favorites").select("song_id, created_at").order("created_at", { ascending: false });
  const { data } = memberId ? await q.eq("member_id", memberId) : await q;
  const ids = [...new Set((data || []).map((r) => r.song_id))];
  return songsByIds(ids);
}
export async function sungSongs(memberId, limit = 60) {
  const { data } = await sb.rpc("ktv_sung_songs", { p_member: memberId || null, p_limit: limit });
  const rows = data || [];
  const songs = await songsByIds(rows.map((r) => r.song_id));
  const byId = new Map(rows.map((r) => [r.song_id, r]));
  return songs.map((s) => ({ ...s, times: byId.get(s.id)?.times, best: byId.get(s.id)?.best_score }));
}
export async function queueNow() {
  const { data } = await sb.from("ktv_queue")
    .select("id,status,priority,member_id,song_id,created_at,started_at, song:ktv_songs(" + SONG_COLS + "), member:ktv_members(name,emoji)")
    .in("status", ["queued", "playing"]).order("priority");
  const rows = data || [];
  return { playing: rows.find((r) => r.status === "playing") || null, queued: rows.filter((r) => r.status === "queued") };
}
export async function enqueue(songId, memberId, front = false) {
  const { data: dup } = await sb.from("ktv_queue").select("id").eq("song_id", songId).in("status", ["queued", "playing"]).limit(1);
  if (dup && dup.length) return false; // already waiting or playing
  const row = { song_id: songId, member_id: memberId || null };
  if (front) { // 插播: goes ahead of everything that is waiting
    const { data: first } = await sb.from("ktv_queue").select("priority").eq("status", "queued").order("priority").limit(1);
    if (first && first.length) row.priority = first[0].priority - 1;
  }
  const { error } = await sb.from("ktv_queue").insert(row);
  if (error) throw error;
  emit("queue");
  // warm up the YouTube match in the background
  sb.from("ktv_songs").select("yt_status").eq("id", songId).single().then(({ data }) => {
    if (data && data.yt_status !== "ok") api("resolve", { song_id: songId }).catch(() => {});
  });
  return true;
}
export async function bumpToFront(queueId) {
  const { data } = await sb.from("ktv_queue").select("priority").eq("status", "queued").order("priority").limit(1);
  const min = data?.[0]?.priority ?? Date.now() / 1000;
  await sb.from("ktv_queue").update({ priority: min - 1 }).eq("id", queueId);
  emit("queue");
}
export async function removeQueued(queueId) {
  await sb.from("ktv_queue").update({ status: "skipped" }).eq("id", queueId);
  emit("queue");
}

// ---- display helpers ----
export const GENDER = { male: "男", female: "女", group: "團體", duet: "合唱" };
export const LANG = { taiwanese: "台語", cantonese: "粵語", english: "英文", japanese: "日文", korean: "韓文" };
export function badges(s) {
  const b = [];
  if (GENDER[s.gender]) b.push(`<span class="bd g-${s.gender}">${GENDER[s.gender]}</span>`);
  if (LANG[s.language]) b.push(`<span class="bd lang">${LANG[s.language]}</span>`);
  if (s.yt_status === "ok") {
    const ktv = (s.yt || []).some((c) => c.ktv && !c.bad);
    b.push(ktv ? `<span class="bd ktv">KTV</span>` : `<span class="bd mv">MV</span>`);
  } else if (s.yt_status === "none") b.push(`<span class="bd none">找不到</span>`);
  return b.join("");
}
export function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// "b" = backing track (no lead vocal), "g" = guide vocal (original singer: 導唱/原唱 KTV, MV, lyric video)
export function kindOf(c) {
  const t = c.t || "";
  // 導唱 versions, and "左伴右唱" videos (vocals in one channel — on a TV both channels play, so you hear the singer)
  if (/導唱|导唱|KTV\s*原唱|原唱版|原聲版|原声版|左伴右唱|右伴左唱|左右聲道|左右声道|原唱跟唱/i.test(t)) return "g";
  if (/伴奏|伴唱|karaoke|卡拉|去人聲|去人声|消音|instrumental|純音樂|纯音乐|無人聲|无人声|no ?vocal|off ?vocal/i.test(t)) return "b";
  if (/原唱/.test(t)) return "g";
  return c.ktv ? "b" : "g";
}
// A version people keep skipping in the first seconds (and rarely sing to the end) drops to the back.
const doubtful = (x) => (x.weak || 0) - 2 * (x.good || 0) >= 2;
export function bestVideo(song) {
  const all = (song.yt || []).filter((x) => !x.bad);
  const c = all.filter((x) => !doubtful(x)).concat(all.filter(doubtful));
  const proven = c.find((x) => (x.good || 0) >= 2 && !doubtful(x) && kindOf(x) === "b");
  return proven || c.find((x) => x.ktv && kindOf(x) === "b") || c.find((x) => kindOf(x) === "b") || c.find((x) => x.ktv) || c[0] || null;
}
// Close a queue row and remember how it went, so the app learns which versions are good.
export async function closeQueue(item, status, video, playedSec) {
  const played = Math.max(0, Math.round(playedSec || 0));
  await sb.from("ktv_queue").update({ status, played_sec: played, end_reason: status, video_id: video?.id || null }).eq("id", item.id);
  const kind = status === "done" ? "full" : status === "skipped" && played < 30 && video ? "early" : null;
  if (kind && video) sb.rpc("ktv_feedback", { p_song: item.song.id, p_video: video.id, p_kind: kind }).then(() => {}, () => {});
}
// 導唱: find an original-vocal video that lines up with the backing video now playing.
// Best = same uploader + same length (KTV channels publish 伴唱/導唱 pairs cut from one master → same timeline).
const guideMemo = {};
export async function findGuide(song, cur) {
  if (guideMemo[song.id]) return guideMemo[song.id];
  const titleKey = (song.title || "").replace(/\s+/g, "");
  const rate = (v) => {
    if (!v || v.bad || v.id === cur?.id) return -99;
    if (kindOf({ ...v, ktv: false }) !== "g") return -99;
    if (v.sec && (v.sec < 100 || v.sec > 540)) return -99;
    let sc = 0;
    if ((v.t || "").replace(/\s+/g, "").includes(titleKey)) sc += 3; else sc -= 4;
    if (cur?.ch && v.ch && v.ch === cur.ch) sc += 6;
    if (/導唱|导唱/.test(v.t || "")) sc += 3;
    if (/KTV|卡拉|伴唱/i.test(v.t || "")) sc += 1;
    if (cur?.sec && v.sec) { const d = Math.abs(v.sec - cur.sec); sc += d <= 2 ? 5 : d <= 6 ? 2 : d > 30 ? -3 : 0; }
    return sc;
  };
  let pool = (song.yt || []).slice();
  let best = null;
  const pick = () => { best = pool.map((v) => [rate(v), v]).filter(([r]) => r > -20).sort((x, y) => y[0] - x[0])[0] || null; };
  pick();
  for (const q of [`${song.title} ${song.artist || ""} 導唱`, `${song.title} ${song.artist || ""} 原唱 歌詞`]) {
    if (best && best[0] >= 9) break;
    try { const r = await api("yt_search", { q }); pool = pool.concat(r.videos || []); pick(); } catch { /* */ }
  }
  if (!best || best[0] < 0) return null;
  const v = best[1];
  const synced = !!(cur && ((cur.ch && v.ch === cur.ch) || (cur.sec && v.sec && Math.abs(cur.sec - v.sec) <= 2)));
  return (guideMemo[song.id] = { v, synced });
}
export function forgetGuide(songId) { delete guideMemo[songId]; }
export const ytThumb = (v) => (v ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : "");
export function toast(msg, ms = 2200) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}

// ---- phone microphone -> TV speakers (WebRTC audio) ----
const RTC = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
function gathered(pc) {
  return new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const t = setTimeout(res, 2500);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
  });
}
export async function micOffer(stream) {
  const pc = new RTCPeerConnection(RTC);
  stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return { pc, sdp: pc.localDescription.sdp };
}
export async function micAnswer(sdp, onStream) {
  const pc = new RTCPeerConnection(RTC);
  pc.ontrack = (e) => {
    try { e.receiver.playoutDelayHint = 0; e.receiver.jitterBufferTarget = 0; } catch { /* older browsers */ }
    onStream(e.streams[0] || new MediaStream([e.track]));
  };
  await pc.setRemoteDescription({ type: "offer", sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { pc, sdp: pc.localDescription.sdp };
}
