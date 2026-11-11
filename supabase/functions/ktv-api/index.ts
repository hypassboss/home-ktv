// KTV home system API — YouTube KTV matching + chart ingestion.
// All requests need header x-ktv-key (home access key).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as OpenCC from "npm:opencc-js@1.0.5";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ktv-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const s2t = OpenCC.Converter({ from: "cn", to: "tw" });

let KEY: string | null = null;
async function accessKey() {
  if (KEY) return KEY;
  const { data } = await SB.from("ktv_config").select("v").eq("k", "access_key").single();
  KEY = data?.v ?? "";
  return KEY;
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

// ---------- text helpers ----------
function cleanTitle(t: string) {
  return t
    .replace(/\s+-\s+[^-]*(?:《|》|主題曲|主题曲|插曲|片尾曲|片頭曲|片头曲|電視劇|电视剧|影集|電影|电影)[^-]*$/, "")
    .replace(/[（(【\[][^）)】\]]*(?:《|》|插曲|主題曲|主题曲|片尾|片頭|片头|Live|live|LIVE|feat|Feat|cover|Cover|版|Ver|ver|Remix|remix|伴奏|劇|剧)[^）)】\]]*[）)】\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanArtist(a: string) {
  return a.replace(/\s*[（(][A-Za-z0-9 .'&\-]+[）)]\s*/g, "").replace(/\s+/g, " ").trim();
}
function mainArtist(a: string) {
  return cleanArtist(a).split(/\s*(?:[、,，&\/／;；]|\s[xX×]\s|feat\.?|Feat\.?)\s*/)[0].trim();
}
function norm(s: string) {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}
// Chinese song: Han characters in the title (or a Han-named artist), and no Korean/Japanese kana in the title
function isChinese(title: string, artist: string) {
  if (/[가-힯぀-ヿ]/.test(title)) return false;
  return /\p{Script=Han}/u.test(title) || /\p{Script=Han}/u.test(artist);
}
function songKey(title: string, artist: string) {
  return norm(title) + "|" + norm(mainArtist(artist));
}

// ---------- YouTube ----------
type Vid = { id: string; t: string; ch: string; sec: number };
function parseDur(s?: string) {
  if (!s) return 0;
  return s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
}
function collectVideos(node: any, out: Vid[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) collectVideos(n, out); return; }
  const vr = node.videoRenderer;
  if (vr && vr.videoId) {
    out.push({
      id: vr.videoId,
      t: vr.title?.runs?.map((r: any) => r.text).join("") ?? "",
      ch: vr.ownerText?.runs?.[0]?.text ?? "",
      sec: parseDur(vr.lengthText?.simpleText),
    });
    return;
  }
  for (const k in node) collectVideos(node[k], out);
}
async function ytSearch(q: string): Promise<Vid[]> {
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&hl=zh-TW&gl=TW";
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" } });
  const html = await r.text();
  const i = html.indexOf("var ytInitialData = ");
  if (i < 0) return [];
  const start = i + "var ytInitialData = ".length;
  const end = html.indexOf(";</script>", start);
  try {
    const data = JSON.parse(html.slice(start, end));
    const out: Vid[] = [];
    collectVideos(data?.contents, out);
    return out;
  } catch { return []; }
}
async function embeddable(id: string) {
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { headers: { "User-Agent": UA } });
    await r.body?.cancel();
    return r.status === 200;
  } catch { return true; }
}
const KTV_RE = /ktv|伴唱|卡拉|karaoke|導唱|导唱|kala|伴奏版|消音/i;
const BAD_RE = /live|演唱會|演唱会|cover|翻唱|reaction|教學|教学|\bdj\b|remix|shorts|抖音|tiktok|1小時|1小时|一小時|1 hour|循環|循环|鋼琴|钢琴|吉他|piano|guitar|舞蹈|dance|8d|慢速|加速|sped up|slowed|片段/i;
const LABEL_RE = /華納|华纳|環球|环球|sony|滾石|滚石|相信音樂|相信音乐|華研|华研|金牌大風|台灣索尼|warner|universal|avex|種子音樂|種子|豐華|丰华|ktv|卡拉/i;
// The video must really be this song: compare in Traditional Chinese on both sides.
function titleMatch(vt: string, ch: string, title: string, artist: string) {
  const nv = norm(s2t(vt)), nt = norm(s2t(title));
  if (!nt) return false;
  const a = norm(s2t(mainArtist(artist)));
  const hasArtist = !a || nv.includes(a) || norm(s2t(ch)).includes(a);
  if (nv.includes(nt)) return [...nt].length > 2 || hasArtist; // very short titles also need the artist
  const runs = (s2t(title).match(/\p{Script=Han}{2,}/gu) ?? []).map(norm);
  return runs.length > 1 && hasArtist && runs.some((r) => nv.includes(r)); // "中文名English - 副標" style titles
}
function scoreVid(v: Vid, title: string, artist: string) {
  if (!titleMatch(v.t, v.ch, title, artist)) return { s: -99, ktv: false };
  let s = 4;
  const nt = norm(s2t(v.t));
  const isKtv = KTV_RE.test(v.t) || /ktv|卡拉/i.test(v.ch);
  if (isKtv) s += 6;
  const a = norm(s2t(mainArtist(artist)));
  if (a && (nt.includes(a) || norm(s2t(v.ch)).includes(a))) s += 2;
  if (LABEL_RE.test(v.ch)) s += 2;
  if (BAD_RE.test(v.t)) s -= 6;
  if (/[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(v.t)) s -= 4; // Vietnamese karaoke versions
  if (v.sec && v.sec > 9 * 60) s -= 5;
  if (v.sec && v.sec < 100) s -= 6;
  return { s, ktv: isKtv };
}
async function matchSong(title: string, artist: string) {
  const q1 = `${title} ${mainArtist(artist)} KTV`.trim();
  let vids = await ytSearch(q1);
  if (vids.length < 3) vids = vids.concat(await ytSearch(`${title} ${mainArtist(artist)}`.trim()));
  const seen = new Set<string>();
  const ranked = vids
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .map((v) => ({ v, ...scoreVid(v, title, artist) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  const out: Array<{ id: string; t: string; ch: string; sec: number; ktv: boolean }> = [];
  for (const x of ranked) {
    if (out.length >= 4) break;
    if (await embeddable(x.v.id)) out.push({ id: x.v.id, t: x.v.t, ch: x.v.ch, sec: x.v.sec, ktv: x.ktv });
  }
  return out;
}
async function resolveSong(song: any) {
  // versions that failed to play on the TV stay recorded so they are never picked again
  const bad = (song.yt ?? []).filter((c: any) => c.bad);
  const cands = (await matchSong(song.title, song.artist)).filter((c) => !bad.some((b: any) => b.id === c.id));
  const upd = { yt: [...cands, ...bad], yt_status: cands.length ? "ok" : "none", yt_checked_at: new Date().toISOString() };
  await SB.from("ktv_songs").update(upd).eq("id", song.id);
  return { ...song, ...upd };
}

// ---------- charts ----------
type Entry = { title: string; artist: string; year?: number };
const CHARTS: Array<{ id: string; name: string; region: "tw" | "cn"; source: string; sort: number; fetch: () => Promise<Entry[]> }> = [];
function kkbox(type: "song" | "newrelease") {
  return async () => {
    const r = await fetch(`https://kma.kkbox.com/charts/api/v1/weekly?category=297&lang=tc&limit=50&terr=tw&type=${type}`, { headers: { "User-Agent": UA, Referer: "https://kma.kkbox.com/charts/" } });
    const j = await r.json();
    const arr = j?.data?.charts?.[type] ?? [];
    return arr.map((x: any) => ({ title: x.song_name, artist: x.artist_name, year: x.release_date ? Number(String(x.release_date).slice(0, 4)) : undefined }));
  };
}
function qq(topid: number, num = 50) {
  return async () => {
    const data = { comm: { ct: 24, cv: 0 }, toplist: { module: "musicToplist.ToplistInfoServer", method: "GetDetail", param: { topid, num, period: "" } } };
    const r = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg?data=" + encodeURIComponent(JSON.stringify(data)), { headers: { "User-Agent": UA, Referer: "https://y.qq.com/" } });
    const j = await r.json();
    const d = j?.toplist?.data;
    const info = d?.songInfoList ?? [];
    if (info.length) {
      return info.map((x: any) => ({
        title: x.title || x.name,
        artist: (x.singer ?? []).map((s: any) => s.name).join("、"),
        year: x.time_public ? Number(String(x.time_public).slice(0, 4)) : undefined,
      }));
    }
    return (d?.data?.song ?? []).map((x: any) => ({ title: x.title, artist: x.singerName }));
  };
}
function netease(id: number) {
  return async () => {
    const r = await fetch(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=50`, { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } });
    const j = await r.json();
    return (j?.playlist?.tracks ?? []).slice(0, 50).map((x: any) => ({
      title: x.name,
      artist: (x.ar ?? []).map((a: any) => a.name).join("、"),
      year: x.publishTime ? new Date(x.publishTime).getFullYear() : undefined,
    }));
  };
}
CHARTS.push(
  { id: "tw-kkbox-song", name: "KKBOX 華語單曲週榜", region: "tw", source: "KKBOX", sort: 10, fetch: kkbox("song") },
  { id: "tw-kkbox-new", name: "KKBOX 華語新歌週榜", region: "tw", source: "KKBOX", sort: 20, fetch: kkbox("newrelease") },
  { id: "tw-qq-taiwan", name: "台灣地區榜", region: "tw", source: "QQ音樂", sort: 30, fetch: qq(61) },
  { id: "cn-qq-ktv", name: "K歌金曲榜", region: "cn", source: "QQ音樂", sort: 10, fetch: qq(36) },
  { id: "cn-douyin", name: "抖音熱歌榜", region: "cn", source: "QQ音樂", sort: 20, fetch: qq(60) },
  { id: "cn-qq-hot", name: "QQ 熱歌榜", region: "cn", source: "QQ音樂", sort: 30, fetch: qq(26) },
  { id: "cn-qq-new", name: "QQ 新歌榜", region: "cn", source: "QQ音樂", sort: 40, fetch: qq(27) },
  { id: "cn-qq-rise", name: "QQ 飆升榜", region: "cn", source: "QQ音樂", sort: 50, fetch: qq(62) },
  { id: "cn-netease-rise", name: "網易雲飆升榜", region: "cn", source: "網易雲音樂", sort: 60, fetch: netease(19723756) },
  { id: "cn-netease-new", name: "網易雲新歌榜", region: "cn", source: "網易雲音樂", sort: 70, fetch: netease(3779629) },
  { id: "cn-netease-hot", name: "網易雲熱歌榜", region: "cn", source: "網易雲音樂", sort: 80, fetch: netease(3778678) },
);

let ARTISTS: Map<string, string> | null = null;
async function artistGender(a: string) {
  if (!ARTISTS) {
    const { data } = await SB.from("ktv_artists").select("name,gender");
    ARTISTS = new Map((data ?? []).map((x: any) => [norm(x.name), x.gender]));
  }
  const parts = cleanArtist(a).split(/\s*(?:[、,，&\/／;；]|feat\.?)\s*/).filter(Boolean);
  if (parts.length >= 2) return "duet";
  return ARTISTS.get(norm(parts[0] ?? "")) ?? null;
}

async function upsertSongs(entries: Entry[], language = "mandarin") {
  const rows: any[] = [];
  const keys: string[] = [];
  for (const e of entries) {
    const title = cleanTitle(e.title ?? "");
    const artist = cleanArtist(e.artist ?? "");
    if (!title) { keys.push(""); continue; }
    const key = songKey(title, artist);
    keys.push(key);
    const era = e.year && e.year > 1950 ? Math.floor(e.year / 10) * 10 : null;
    rows.push({ title, artist, song_key: key, language, era, gender: await artistGender(artist) });
  }
  // insert new ones only (keep existing metadata/yt)
  const uniq = [...new Map(rows.map((r) => [r.song_key, r])).values()];
  if (uniq.length) await SB.from("ktv_songs").upsert(uniq, { onConflict: "song_key", ignoreDuplicates: true });
  const { data } = await SB.from("ktv_songs").select("id,song_key").in("song_key", keys.filter(Boolean));
  const idByKey = new Map((data ?? []).map((x: any) => [x.song_key, x.id]));
  return keys.map((k) => (k ? idByKey.get(k) ?? null : null));
}

async function refreshChart(c: (typeof CHARTS)[number]) {
  let entries = await c.fetch();
  entries = entries
    .map((e) => ({ ...e, title: s2t(e.title ?? ""), artist: /^various artists$/i.test(e.artist ?? "") ? "" : s2t(e.artist ?? "") }))
    .filter((e) => isChinese(e.title, e.artist));
  const ids = await upsertSongs(entries);
  const seen = new Set<string>();
  const ent: any[] = [];
  ids.forEach((id) => { if (id && !seen.has(id)) { seen.add(id); ent.push({ chart_id: c.id, rank: ent.length + 1, song_id: id }); } });
  await SB.from("ktv_charts").upsert({ id: c.id, name: c.name, region: c.region, source: c.source, sort: c.sort, updated_at: new Date().toISOString() });
  if (ent.length) {
    await SB.from("ktv_chart_entries").delete().eq("chart_id", c.id);
    await SB.from("ktv_chart_entries").insert(ent);
  }
  return { id: c.id, fetched: entries.length, saved: ent.length };
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : Object.fromEntries(new URL(req.url).searchParams); } catch { /* empty */ }
  const action = body.action;

  // ---- TV pairing (no key yet): TV shows a code, an already-paired phone confirms it ----
  if (action === "pair_start") {
    await SB.from("ktv_pairing").delete().lt("created_at", new Date(Date.now() - 15 * 60e3).toISOString());
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await SB.from("ktv_pairing").insert({ code });
    return json({ code });
  }
  if (action === "pair_poll") {
    const { data } = await SB.from("ktv_pairing").select("*").eq("code", String(body.code ?? "")).maybeSingle();
    if (!data || Date.now() - new Date(data.created_at).getTime() > 10 * 60e3) return json({ status: "expired" });
    if (!data.confirmed) return json({ status: "waiting" });
    await SB.from("ktv_pairing").delete().eq("code", data.code);
    return json({ status: "ok", key: await accessKey() });
  }

  const key = req.headers.get("x-ktv-key") ?? new URL(req.url).searchParams.get("k");
  if (!key || key !== (await accessKey())) return json({ error: "unauthorized" }, 401);
  if (action === "pair_confirm") {
    const { data } = await SB.from("ktv_pairing").update({ confirmed: true }).eq("code", String(body.code ?? "")).select().maybeSingle();
    return json({ ok: !!data });
  }
  try {
    switch (action) {
      case "resolve": {
        const { data: song } = await SB.from("ktv_songs").select("*").eq("id", body.song_id).single();
        if (!song) return json({ error: "not_found" }, 404);
        if (song.yt_status === "ok" && !body.force && (song.yt ?? []).some((c: any) => !c.bad)) return json({ song });
        return json({ song: await resolveSong(song) });
      }
      case "mark_bad": {
        const { data: song } = await SB.from("ktv_songs").select("*").eq("id", body.song_id).single();
        if (!song) return json({ error: "not_found" }, 404);
        const yt = (song.yt ?? []).map((c: any) => (c.id === body.video_id ? { ...c, bad: true } : c));
        const anyGood = yt.some((c: any) => !c.bad);
        await SB.from("ktv_songs").update({ yt, yt_status: anyGood ? "ok" : "pending" }).eq("id", song.id);
        if (!anyGood) return json({ song: await resolveSong({ ...song, yt }) });
        return json({ song: { ...song, yt } });
      }
      case "recheck": {
        // re-validate stored matches with the current title rule; no YouTube requests
        const { data: all } = await SB.from("ktv_songs").select("id,title,artist,yt").eq("yt_status", "ok").limit(5000);
        let dropped = 0, requeued = 0;
        for (const s of all ?? []) {
          const keep = (s.yt ?? []).filter((c: any) => c.bad || titleMatch(c.t ?? "", c.ch ?? "", s.title, s.artist));
          if (keep.length === (s.yt ?? []).length) continue;
          dropped += (s.yt ?? []).length - keep.length;
          const good = keep.some((c: any) => !c.bad);
          if (!good) requeued++;
          await SB.from("ktv_songs").update({ yt: keep, yt_status: good ? "ok" : "pending", yt_checked_at: good ? new Date().toISOString() : null }).eq("id", s.id);
        }
        return json({ checked: (all ?? []).length, dropped, requeued });
      }
      case "yt_search": {
        const vids = (await ytSearch(String(body.q ?? "") + " KTV")).slice(0, 15);
        return json({ videos: vids.map((v) => ({ ...v, ktv: KTV_RE.test(v.t) })) });
      }
      case "add_video": {
        const title = cleanTitle(String(body.title ?? "")).slice(0, 120);
        const artist = cleanArtist(String(body.artist ?? "")).slice(0, 80);
        if (!title || !body.video_id) return json({ error: "bad_request" }, 400);
        const key = songKey(title, artist) + (artist ? "" : "#" + body.video_id);
        const cand = [{ id: body.video_id, t: body.video_title ?? title, ch: body.channel ?? "", sec: body.sec ?? 0, ktv: KTV_RE.test(body.video_title ?? "") }];
        const { data: existing } = await SB.from("ktv_songs").select("*").eq("song_key", key).maybeSingle();
        if (existing) {
          const yt = [cand[0], ...(existing.yt ?? []).filter((c: any) => c.id !== body.video_id)];
          const { data } = await SB.from("ktv_songs").update({ yt, yt_status: "ok" }).eq("id", existing.id).select().single();
          return json({ song: data });
        }
        const { data, error } = await SB.from("ktv_songs").insert({ title, artist, song_key: key, yt: cand, yt_status: "ok", gender: await artistGender(artist), yt_checked_at: new Date().toISOString() }).select().single();
        if (error) return json({ error: error.message }, 400);
        return json({ song: data });
      }
      case "refresh_charts": {
        const only = body.only ? String(body.only).split(",") : null;
        const res = [];
        for (const c of CHARTS.filter((c) => !only || only.includes(c.id))) {
          try { res.push(await refreshChart(c)); } catch (e) { res.push({ id: c.id, error: String(e) }); }
        }
        return json({ charts: res });
      }
      case "resolve_pending": {
        const n = Math.min(Number(body.n ?? 4), 8);
        const { data: songs } = await SB.rpc("ktv_claim_pending", { p_n: n });
        const out = [];
        for (const s of songs ?? []) {
          try { const r = await resolveSong(s); out.push({ t: s.title, n: r.yt.length }); } catch (e) { out.push({ t: s.title, error: String(e) }); }
        }
        return json({ resolved: out });
      }
      case "ingest_list": {
        // body.items: [{title, artist, year, language}], body.chart: {id,name,region,sort}
        const items: any[] = body.items ?? [];
        const byLang = new Map<string, any[]>();
        items.forEach((it, i) => { const l = it.language ?? "mandarin"; if (!byLang.has(l)) byLang.set(l, []); byLang.get(l)!.push({ ...it, _i: i }); });
        const ids: (string | null)[] = new Array(items.length).fill(null);
        for (const [lang, arr] of byLang) {
          const r = await upsertSongs(arr, lang);
          arr.forEach((it, j) => (ids[it._i] = r[j]));
        }
        if (body.chart) {
          const c = body.chart;
          await SB.from("ktv_charts").upsert({ id: c.id, name: c.name, region: c.region, source: c.source ?? "經典精選", sort: c.sort ?? 100, updated_at: new Date().toISOString() });
          const seen = new Set<string>(); const ent: any[] = [];
          ids.forEach((id) => { if (id && !seen.has(id)) { seen.add(id); ent.push({ chart_id: c.id, rank: ent.length + 1, song_id: id }); } });
          await SB.from("ktv_chart_entries").delete().eq("chart_id", c.id);
          if (ent.length) await SB.from("ktv_chart_entries").insert(ent);
        }
        return json({ ok: true, count: ids.filter(Boolean).length });
      }
      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
