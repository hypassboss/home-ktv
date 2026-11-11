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
export async function enqueue(songId, memberId) {
  const { error } = await sb.from("ktv_queue").insert({ song_id: songId, member_id: memberId || null });
  if (error) throw error;
  emit("queue");
  // warm up the YouTube match in the background
  sb.from("ktv_songs").select("yt_status").eq("id", songId).single().then(({ data }) => {
    if (data && data.yt_status !== "ok") api("resolve", { song_id: songId }).catch(() => {});
  });
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
export function bestVideo(song) {
  const c = (song.yt || []).filter((x) => !x.bad);
  return c.find((x) => x.ktv) || c[0] || null;
}
export function toast(msg, ms = 2200) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), ms);
}
