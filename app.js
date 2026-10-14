'use strict';
/* くまもとハザードマップ v2 — 高校生が「平時に、自分の危険を体感して備える」ための地図
   柱：①知る（検索・判定）②体感する（自分の身長・住まいで深さを描く／水が引くまでの時間／家ごと流される区域）③備える（避難場所・避難カード） */

// ================= 定数 =================
const BASE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const DEM_URL  = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';   // 標高（海＝値なし）
const HZ_ROOT  = 'https://disaportaldata.gsi.go.jp/raster/';
const MIN_SAVE_Z = 10, HZ_MAX_Z = 17, DEM_MAX_Z = 14, PREF_MAX_Z = 12, PLACE_MAX_Z = 16;
const KB_PER_TILE = { 10: 75, 11: 75, 12: 75, 13: 44, 14: 44, 15: 40, 16: 25 };
const P = 'hm2-';                                                  // 保存データの名前（v1と分ける）

// 浸水深の凡例（ハザードマップポータルサイトの凡例画像から取得）[R,G,B, ラベル, 下限m, 上限m]
const DEPTH = [
  [255,255,179,'0.3m未満',0,0.3], [255,255,178,'0.3m未満',0,0.3], [247,245,169,'0.5m未満',0,0.5],
  [248,225,166,'0.5〜1m',0.5,1], [255,216,192,'0.5〜3m',0.5,3], [255,183,183,'3〜5m',3,5],
  [255,145,145,'5〜10m',5,10], [242,133,201,'10〜20m',10,20], [220,122,220,'20m以上',20,24],
];
const LEGEND_DEPTH = [DEPTH[2], DEPTH[4], DEPTH[5], DEPTH[6], DEPTH[7], DEPTH[8]];
// 浸水継続時間（水が引くまで）[R,G,B, ラベル, 時間の上限h]
const DURATION = [
  [160,210,255,'12時間未満',12], [0,65,255,'12時間〜1日',24], [250,245,0,'1〜3日',72], [255,153,0,'3日〜1週間',168],
  [255,40,0,'1〜2週間',336], [180,0,104,'2週間以上',672], [96,0,96,'4週間以上',1000],
];
// 土砂災害警戒区域の色 [R,G,B, 特別警戒区域か, 指定予定か]
const DOSHA_COLORS = {
  '05_dosekiryukeikaikuiki': [[165,0,33,1,0],[183,51,77,1,1],[230,200,50,0,0],[235,211,91,0,1]],
  '05_kyukeishakeikaikuiki': [[250,40,0,1,0],[251,83,51,1,1],[250,230,0,0,0],[251,235,51,0,1]],
  '05_jisuberikeikaikuiki':  [[180,0,40,1,0],[195,51,83,1,1],[255,153,0,0,0],[255,173,51,0,1]],
};
const L_KEIZOKU = '01_flood_l2_keizoku_data';
const L_HANRAN  = '01_flood_l2_kaokutoukai_hanran_data';
const L_KAGAN   = '01_flood_l2_kaokutoukai_kagan_data';
const L_NAISUI  = '02_naisui_data';

const LAYERS = {
  flood:    { label:'洪水', kind:'depth', paths:['01_flood_l2_shinsuishin_data'], swatch:'#ffb7b7', shelterBit:1,
              title:'川があふれたときの浸水の深さ', note:'想定最大規模（1000年に1回程度）の大雨で川があふれた場合の想定です。' },
  dosha:    { label:'土砂災害', kind:'zone', paths:Object.keys(DOSHA_COLORS), names:['土石流','がけ崩れ','地すべり'], swatch:'#e6c832', shelterBit:2,
              title:'土砂災害警戒区域', note:'大雨のときは、区域の外の頑丈な建物へ早めに避難します。' },
  tsunami:  { label:'津波', kind:'depth', paths:['04_tsunami_newlegend_data'], swatch:'#ff9191', shelterBit:8,
              title:'津波の浸水の深さ', note:'最大クラスの津波が起きた場合の想定です。' },
  takashio: { label:'高潮', kind:'depth', paths:['03_hightide_l2_shinsuishin_data'], swatch:'#f285c9', shelterBit:4,
              title:'高潮の浸水の深さ', note:'想定最大規模の台風による高潮の想定です。' },
};
const ALL_HZ_PATHS = [...Object.values(LAYERS).flatMap(l => l.paths), L_KEIZOKU, L_HANRAN, L_KAGAN, L_NAISUI];

const STOPS = [
  { m: 20,  label: '20m',  sub: '7階〜',   words: '7階建て以上が水につかる' },
  { m: 10,  label: '10m',  sub: '4〜6階',  words: '4〜6階建てが水につかる' },
  { m: 5,   label: '5m',   sub: '2階屋根', words: '2階建ての屋根をこえる' },
  { m: 3,   label: '3m',   sub: '1階天井', words: '1階が天井まで水につかる' },
  { m: 1,   label: '1m',   sub: '腰',      words: '大人の腰より深い' },
  { m: 0.5, label: '0.5m', sub: 'ひざ',    words: '大人のひざより深い' },
  { m: null, label: '全部', sub: '色分け', words: '' },
];
const TIMINGS = [
  { id: 'l3', t: '「高齢者等避難」（警戒レベル3）が出たら', s: '暗くなる前・雨が強くなる前に動ける。いちばん安全' },
  { id: 'l4', t: '「避難指示」（警戒レベル4）が出たら', s: 'この時点で、危険な場所にいる人は全員避難します' },
  { id: 'eve', t: '大雨・台風の予報が出た前の晩に', s: '家族で集まって、早めに移動しておく' },
];

// ================= 小物 =================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const hzTpl = path => HZ_ROOT + path + '/{z}/{x}/{y}.png';
const fmtMB = b => !b ? '0MB' : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + 'GB' : Math.max(0.1, b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0) + 'MB';
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
const fmtM = m => (Math.round(m * 10) / 10).toString().replace(/\.0$/, '') + 'm';
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const DIR8 = ['北','北東','東','南東','南','南西','西','北西'];
const dirName = deg => DIR8[Math.round(deg / 45) % 8];
const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
};

// ================= 状態 =================
let activeLayer = store.get('layer', 'flood');
let quality = store.get('quality', 15);
let threshold = null;
let me = store.get('me', { height: 165, home: 'h2', floor: 3 });      // 身長cm／住まい h1=平屋 h2=2階建て apt=マンション
let cards = store.get('cards', []);
let munis = [], shelters = [];
const jobs = {};
let saved = store.get('saved', {});
const saveLedger = () => store.set('saved', saved);

// ================= 地図 =================
const KUMAMOTO_BOUNDS = [[32.09, 129.95], [33.20, 131.34]];
const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 18, tapHold: true });
const savedView = store.get('view', null);
if (savedView) map.setView(savedView.c, savedView.z); else map.fitBounds(KUMAMOTO_BOUNDS, { paddingTopLeft: [0, 90], paddingBottomRight: [60, 40] });
map.attributionControl.setPrefix(false);
L.tileLayer(BASE_URL, {
  maxNativeZoom: 18, maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>｜出典：<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>・<a href="https://www.gsi.go.jp/bousaichiri/hinanbasho.html" target="_blank">指定緊急避難場所データ</a>',
}).addTo(map);
map.createPane('places'); map.getPane('places').style.zIndex = 420;
map.createPane('shelters'); map.getPane('shelters').style.zIndex = 640;
const hazardGroup = L.layerGroup().addTo(map);
const placeGroup = L.layerGroup().addTo(map);
const shelterDots = L.layerGroup().addTo(map);
const routeGroup = L.layerGroup().addTo(map);

// ================= タイル画素の読み取り =================
const pixCache = new Map(), PIX_MAX = 600;
const pxCanvas = document.createElement('canvas');
const pxCtx = pxCanvas.getContext('2d', { willReadFrequently: true });
addEventListener('online', () => pixCache.clear());
function getTilePixels(url) {
  if (pixCache.has(url)) { const p = pixCache.get(url); pixCache.delete(url); pixCache.set(url, p); return p; }
  const p = (async () => {
    let res;
    try { res = await fetch(url, { mode: 'cors' }); } catch { return { state: 'missing' }; }
    if (res.headers.get('X-HM-Missing')) return { state: 'missing' };
    if (res.status === 404 || res.headers.get('X-HM-Empty')) return { state: 'empty' };
    if (!res.ok) return { state: 'missing' };
    try {
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      pxCanvas.width = bmp.width; pxCanvas.height = bmp.height;
      pxCtx.clearRect(0, 0, bmp.width, bmp.height); pxCtx.drawImage(bmp, 0, 0);
      return { state: 'img', w: bmp.width, h: bmp.height, data: pxCtx.getImageData(0, 0, bmp.width, bmp.height).data };
    } catch { return { state: 'missing' }; }
  })();
  pixCache.set(url, p);
  p.then(v => { if (v.state === 'missing' && navigator.onLine) pixCache.delete(url); });
  if (pixCache.size > PIX_MAX) pixCache.delete(pixCache.keys().next().value);
  return p;
}
async function pixelAt(tpl, lat, lng, maxZ) {
  for (let z = maxZ; z >= MIN_SAVE_Z; z--) {
    const fx = lon2x(lng, z), fy = lat2y(lat, z), x = Math.floor(fx), y = Math.floor(fy);
    const v = await getTilePixels(tileUrl(tpl, z, x, y));
    if (v.state === 'missing') continue;
    if (v.state === 'empty') return { state: 'none', z };
    const px = Math.min(v.w - 1, Math.floor((fx - x) * v.w)), py = Math.min(v.h - 1, Math.floor((fy - y) * v.h));
    const i = (py * v.w + px) * 4, d = v.data;
    return { state: 'img', rgba: [d[i], d[i + 1], d[i + 2], d[i + 3]], z };
  }
  return { state: 'unknown' };
}
async function sample(path, lat, lng) {
  const r = await pixelAt(hzTpl(path), lat, lng, HZ_MAX_Z);
  if (r.state !== 'img') return r;
  return r.rgba[3] < 40 ? { state: 'none', z: r.z } : { state: 'hit', rgba: r.rgba, z: r.z };
}
// 標高：{state:'land', h} | {state:'sea'} | {state:'unknown'}
async function elevation(lat, lng) {
  const r = await pixelAt(DEM_URL, lat, lng, DEM_MAX_Z);
  if (r.state === 'none') return { state: 'sea' };
  if (r.state !== 'img') return { state: 'unknown' };
  const [R, G, B] = r.rgba, x = R * 65536 + G * 256 + B;
  if (x === 8388608) return { state: 'sea' };
  return { state: 'land', h: (x < 8388608 ? x : x - 16777216) * 0.01 };
}
const near3 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
function nearest(table, rgba, tol = 45) {
  let best = null, bd = 1e9;
  for (const row of table) { const d = near3(row, rgba); if (d < bd) { bd = d; best = row; } }
  return bd <= tol ? best : null;
}
const classifyDepth = rgba => nearest(DEPTH, rgba);
const classifyDuration = rgba => nearest(DURATION, rgba, 60);
function classifyDosha(path, rgba) {
  const c = nearest(DOSHA_COLORS[path], rgba, 40);
  if (c) return { special: !!c[3], planned: !!c[4] };
  if (rgba[2] > 100 && rgba[0] < 60) return null;                     // 指定予定の点線（紺色）は区域の枠なので数えない
  return { special: rgba[0] > 150 && rgba[1] < 90, planned: false };   // 中間色は赤みで判断
}

// ================= 深さスライダー（洪水のみ） =================
const COL_RED = [217, 48, 37, 205], COL_ORANGE = [245, 124, 0, 190], COL_GRAY = [120, 120, 120, 55];
let classMemo = new Map();
function thresholdColor(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let c = classMemo.get(key);
  if (c === undefined) {
    const d = classifyDepth([r, g, b]);
    c = !d ? COL_ORANGE : d[4] >= threshold ? COL_RED : d[5] > threshold ? COL_ORANGE : COL_GRAY;
    classMemo.set(key, c);
  }
  return c;
}
const ThresholdLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const dz = Math.max(0, coords.z - HZ_MAX_Z), sz = coords.z - dz, scale = 1 << dz;
    const sx = coords.x >> dz, sy = coords.y >> dz;
    const ox = (coords.x - (sx << dz)) * 256 / scale, oy = (coords.y - (sy << dz)) * 256 / scale;
    getTilePixels(tileUrl(hzTpl(this.options.path), sz, sx, sy)).then(v => {
      if (v.state === 'img') {
        const ctx = c.getContext('2d'), out = ctx.createImageData(256, 256), o = out.data, src = v.data, f = v.w / 256;
        for (let y = 0; y < 256; y++) {
          const syy = Math.min(v.h - 1, Math.floor((oy + y / scale) * f));
          for (let x = 0; x < 256; x++) {
            const i = (syy * v.w + Math.min(v.w - 1, Math.floor((ox + x / scale) * f))) * 4;
            if (src[i + 3] < 40) continue;
            const col = thresholdColor(src[i], src[i + 1], src[i + 2]), j = (y * 256 + x) * 4;
            o[j] = col[0]; o[j + 1] = col[1]; o[j + 2] = col[2]; o[j + 3] = col[3];
          }
        }
        ctx.putImageData(out, 0, 0);
      }
      done(null, c);
    });
    return c;
  },
});
let sliderOpen = false;
function renderSlider() {
  const show = activeLayer === 'flood';
  $('#dsToggle').hidden = !show || sliderOpen;
  $('#depthSlider').hidden = !show || !sliderOpen;
  if (!show) { $('#dsBanner').hidden = true; return; }
  $('#dsTrack').innerHTML = STOPS.map((s, i) =>
    `<div class="ds-stop${s.m === threshold ? ' on' : ''}${s.m === null ? ' off' : ''}" data-i="${i}"><b>${s.label}</b><small>${s.sub}</small></div>`).join('');
  const b = $('#dsBanner');
  if (threshold === null || !sliderOpen) { b.hidden = true; return; }
  const s = STOPS.find(x => x.m === threshold);
  b.innerHTML = `<b>${s.label}以上（${s.words}）</b><br>
    <span class="k"><i style="background:rgb(${COL_RED.slice(0, 3)})"></i>${s.label}以上</span><span class="k"><i style="background:rgb(${COL_ORANGE.slice(0, 3)})"></i>以上かも</span><span class="k"><i style="background:rgba(120,120,120,.5)"></i>未満</span>`;
  b.hidden = false;
}
function setThreshold(m) { if (m === threshold) return; threshold = m; classMemo = new Map(); showLayer(activeLayer, true); }
$('#dsToggle').onclick = () => { sliderOpen = true; if (threshold === null) setThreshold(3); else renderSlider(); };
$('#dsClose').onclick = () => { sliderOpen = false; setThreshold(null); renderSlider(); };
(() => {
  const track = $('#dsTrack');
  const pick = e => {
    let best = 0, bd = 1e9;
    [...track.querySelectorAll('.ds-stop')].forEach((el, i) => { const r = el.getBoundingClientRect(), d = Math.abs(e.clientY - (r.top + r.height / 2)); if (d < bd) { bd = d; best = i; } });
    setThreshold(STOPS[best].m);
  };
  let dragging = false;
  track.addEventListener('pointerdown', e => { dragging = true; track.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
  track.addEventListener('pointermove', e => { if (dragging) pick(e); });
  track.addEventListener('pointerup', () => dragging = false);
  track.addEventListener('pointercancel', () => dragging = false);
})();

// ================= レイヤー =================
function showLayer(key, keepSheet) {
  activeLayer = key; store.set('layer', key);
  hazardGroup.clearLayers();
  const l = LAYERS[key];
  if (key === 'flood' && threshold !== null) new ThresholdLayer({ path: l.paths[0], maxZoom: 18 }).addTo(hazardGroup);
  else for (const p of l.paths) L.tileLayer(hzTpl(p), { maxNativeZoom: HZ_MAX_Z, maxZoom: 18, opacity: 0.78, crossOrigin: true }).addTo(hazardGroup);
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.key === key));
  renderLegend(); renderSlider(); drawShelterDots();
  if (lastTap && !keepSheet) inspect(lastTap);
}
for (const [key, l] of Object.entries(LAYERS)) {
  const b = document.createElement('button');
  b.className = 'chip'; b.dataset.key = key;
  b.innerHTML = `<i style="background:${l.swatch}"></i>${esc(l.label)}`;
  b.onclick = () => showLayer(key);
  $('#layerChips').appendChild(b);
}
function renderLegend() {
  const l = LAYERS[activeLayer];
  const sw = (c, t) => `<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`;
  let rows;
  if (l.kind === 'depth') rows = LEGEND_DEPTH.slice().reverse().map(d => sw(`rgb(${d[0]},${d[1]},${d[2]})`, d[3])).join('');
  else rows = sw('rgb(165,0,33)', '土石流・特別警戒区域') + sw('rgb(230,200,50)', '土石流・警戒区域') + sw('rgb(250,40,0)', 'がけ崩れ・特別警戒区域') +
              sw('rgb(250,230,0)', 'がけ崩れ・警戒区域') + sw('rgb(180,0,40)', '地すべり・特別警戒区域') + sw('rgb(255,153,0)', '地すべり・警戒区域') +
              `<div class="note">点線で囲まれた区域は「指定予定」です。</div>`;
  rows += `<div class="row" style="margin-top:6px"><span class="shel-dot"></span>避難場所（${esc(l.label)}に対応）</div>
           <div class="note">色がない場所も、安全とは限りません。小さな川や下水があふれる浸水は、地図に含まれていないことがあります。</div>`;
  $('#legend').innerHTML = `<h3>${esc(l.label)}の色の見かた</h3>${rows}`;
}
$('#btnLegend').onclick = () => { const g = $('#legend'); g.hidden = !g.hidden; $('#btnLegend').classList.toggle('active', !g.hidden); };

// ================= 市町村 =================
let muniLayer;
function muniStyle(f) {
  const s = saved['m:' + f.properties.code];
  return s && s.done ? { color: '#0a66d8', weight: 1.6, opacity: .8, fill: true, fillColor: '#0a66d8', fillOpacity: .04, interactive: false }
                     : { color: '#5d6677', weight: .8, opacity: .55, fill: false, interactive: false };
}
const refreshMuniStyle = () => { if (muniLayer) muniLayer.setStyle(muniStyle); };
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(f, lon, lat) {
  const b = f.properties.bbox;
  if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
  return f.geometry.coordinates.some(poly => pointInRing(lon, lat, poly[0]));
}
const muniAt = (lat, lon) => munis.find(f => inFeature(f, lon, lat));
function updatePlace() {
  const c = map.getCenter();
  store.set('view', { c: [c.lat, c.lng], z: map.getZoom() });
  if (map.getZoom() < 10) { $('#placeName').textContent = '熊本県'; return; }
  const f = muniAt(c.lat, c.lng);
  $('#placeName').textContent = f ? f.properties.name : '熊本県外';
}
map.on('moveend', () => { updatePlace(); drawShelterDots(); });

// ================= 避難場所 =================
const shelterIcon = L.divIcon({ className: '', html: '<div class="shel-dot"></div>', iconSize: [12, 12] });
function drawShelterDots() {
  shelterDots.clearLayers();
  if (!shelters.length || map.getZoom() < 13) return;
  const b = map.getBounds().pad(0.1), bit = LAYERS[activeLayer].shelterBit;
  for (const s of shelters) {
    if (!(s[4] & bit) || !b.contains([s[2], s[3]])) continue;
    L.marker([s[2], s[3]], { icon: shelterIcon, pane: 'shelters' }).bindPopup(`<b>${esc(s[0])}</b><br><small>${esc(s[1])}</small>`).addTo(shelterDots);
  }
}
function nearestShelters(lat, lng, bit, n) {
  const out = [];
  for (const s of shelters) {
    if (!(s[4] & bit)) continue;
    const d = distM(lat, lng, s[2], s[3]);
    if (out.length < n || d < out[out.length - 1].d) { out.push({ s, d }); out.sort((a, b) => a.d - b.d); if (out.length > n) out.pop(); }
  }
  return out;
}
// 直線上に海があるか（標高データで判定。判定できなければ false）
async function crossesSea(lat1, lon1, lat2, lon2) {
  const d = distM(lat1, lon1, lat2, lon2), steps = Math.min(60, Math.max(3, Math.ceil(d / 150)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, e = await elevation(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t);
    if (e.state === 'sea') return true;
  }
  return false;
}
async function maxDepthAlong(path, lat1, lon1, lat2, lon2) {
  const d = distM(lat1, lon1, lat2, lon2), steps = Math.min(120, Math.max(4, Math.ceil(d / 40)));
  let worst = null;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, r = await sample(path, lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t);
    if (r.state === 'hit') { const c = classifyDepth(r.rgba); if (c && (!worst || c[5] > worst[5])) worst = c; }
  }
  return worst;
}
async function doshaAt(lat, lng) {
  const hits = [];
  for (const [i, p] of LAYERS.dosha.paths.entries()) {
    const r = await sample(p, lat, lng);
    if (r.state === 'hit') { const c = classifyDosha(p, r.rgba); if (c) hits.push({ name: LAYERS.dosha.names[i], ...c }); }
  }
  return hits;
}
// 海を越えない、近い順3件
async function pickShelters(lat, lng, bit) {
  const cand = nearestShelters(lat, lng, bit, 10), out = [];
  for (const c of cand) {
    if (out.length >= 3) break;
    if (await crossesSea(lat, lng, c.s[2], c.s[3])) continue;
    out.push(c);
  }
  return out;
}
const arrowSVG = deg => `<svg viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path d="M12 2l6 18-6-4-6 4z"/></svg>`;
let lastShelters = [];
async function renderShelters(latlng, seq, ctx) {
  const el = $('#shelters'); if (!el) return;
  const l = LAYERS[activeLayer];
  if (!shelters.length) { el.innerHTML = '<div class="shel-info">避難場所データを読み込み中です</div>'; return; }
  const near = await pickShelters(latlng.lat, latlng.lng, l.shelterBit);
  if (seq !== inspectSeq) return;
  lastShelters = near;
  routeGroup.clearLayers();
  if (!near.length) { el.innerHTML = `<h4>近くの避難場所</h4><div class="shel-info">海を渡らずに行ける、${esc(l.label)}に対応した避難場所が見つかりません。</div>`; return; }
  near.forEach((n, i) => {
    const ll = [n.s[2], n.s[3]];
    if (i === 0) L.polyline([latlng, ll], { color: '#1e8e3e', weight: 3, dashArray: '6 6', opacity: .9, interactive: false }).addTo(routeGroup);
    L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="shel-pin">${i + 1}</div>`, iconSize: [24, 24] }), pane: 'shelters', zIndexOffset: 1000 })
      .bindPopup(`<b>${esc(n.s[0])}</b><br><small>${esc(n.s[1])}</small>`).addTo(routeGroup);
  });
  el.innerHTML = `<h4>近くの避難場所（${esc(l.label)}に対応）</h4>` + near.map((n, i) => {
    const deg = bearingDeg(latlng.lat, latlng.lng, n.s[2], n.s[3]);
    return `<button class="shel-row" data-i="${i}"><span class="shel-no">${i + 1}</span><span class="shel-main">
      <div class="shel-name">${esc(n.s[0])}</div>
      <div class="shel-dist">${arrowSVG(deg)}${dirName(deg)}へ ${fmtDist(n.d)}<span style="color:var(--sub);font-size:11.5px">（直線）</span></div>
      <div class="shel-info" id="shi${i}">${esc(n.s[1])}</div><div class="shel-warn" id="shw${i}"></div></span></button>`;
  }).join('') + `<div class="shel-info" style="margin-top:4px">距離は直線です。実際に歩く道と、途中に危ない場所がないかを、ふだんから確かめておきましょう。</div>`;
  el.querySelectorAll('.shel-row').forEach(b => b.onclick = () => {
    const n = near[+b.dataset.i];
    map.fitBounds(L.latLngBounds([latlng, [n.s[2], n.s[3]]]).pad(0.35), { paddingBottomRight: [0, $('#sheet').offsetHeight * 0.6] });
  });
  for (let i = 0; i < near.length; i++) {
    const n = near[i], info = $('#shi' + i), warn = $('#shw' + i);
    if (l.kind === 'depth') {
      const [here, worst] = await Promise.all([sample(l.paths[0], n.s[2], n.s[3]), maxDepthAlong(l.paths[0], latlng.lat, latlng.lng, n.s[2], n.s[3])]);
      if (seq !== inspectSeq) return;
      const c = here.state === 'hit' ? classifyDepth(here.rgba) : null;
      if (c) info.textContent = `この避難場所の敷地も浸水想定 ${c[3]}（上の階へ避難する施設の場合があります）`;
      if (worst && worst[5] > Math.max(ctx.originHi || 0, c ? c[5] : 0)) warn.textContent = `⚠ 途中に、今いる場所より深い浸水想定（${worst[3]}）の場所があります。浸水が始まる前に移動します。`;
    } else {
      const hits = await doshaAt(n.s[2], n.s[3]);
      if (seq !== inspectSeq) return;
      if (hits.length) warn.textContent = `⚠ この避難場所も土砂災害の${hits.some(h => h.special) ? '特別' : ''}警戒区域にかかっています。市町村の案内を確かめてください。`;
    }
  }
}

// ================= わたしの住まい（体感の自分ごと化） =================
const HOME_LABEL = { h1: '平屋', h2: '2階建て', apt: 'マンション・アパート' };
const floorLevel = n => me.home === 'apt' ? 0.5 + 3 * (n - 1) : 0.5 + 2.8 * (n - 1);   // その階の床の高さ（地面から）
const myTopFloor = () => me.home === 'h1' ? 1 : me.home === 'h2' ? 2 : me.floor;
const homeText = () => me.home === 'apt' ? `マンション・アパートの${me.floor}階` : HOME_LABEL[me.home];
function myStory(lo, hi) {
  const F = myTopFloor(), L0 = floorLevel(F), head = L0 + me.height / 100;
  const where = me.home === 'apt' ? `${F}階のあなたの部屋` : `家の${F === 1 ? '中' : 'いちばん上の' + F + '階'}`;
  if (lo >= head) return { level: 'red', text: `<b>${where}にいても、頭の上まで水が来るおそれがあります。</b>家の中にいては命を守れません。浸水が始まる前に、避難場所へ移動します。` };
  if (hi > L0 + 0.3) return { level: 'red', text: `<b>${where}の床の上まで水が来るおそれがあります。</b>（床の高さ 約${fmtM(L0)}、想定 ${fmtM(lo)}〜${fmtM(hi)}）` };
  return { level: 'blue', text: `<b>${where}（床の高さ 約${fmtM(L0)}）までは、水は来ない想定です。</b>ただし1階や道路は水につかり、外に出られなくなります。` };
}
function settingsForm(onDone) {
  let h = me.height, home = me.home, fl = me.floor;
  const render = () => {
    openSheet(`<div class="res-title">わたしの住まい</div>
      <p class="res-desc" style="margin:2px 0 6px">身長と住まいを入れると、「自分の家だと水がどこまで来るか」で表示します。この端末の中だけに保存されます。</p>
      <label class="lbl">身長</label><div class="numrow"><input class="field" id="meH" type="number" inputmode="numeric" min="90" max="210" value="${h}"><span>cm</span></div>
      <label class="lbl">住まい</label>
      <div class="chipsel">${Object.entries(HOME_LABEL).map(([k, v]) => `<button data-home="${k}" class="${k === home ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${home === 'apt' ? `<label class="lbl">住んでいる階</label><div class="numrow"><input class="field" id="meF" type="number" inputmode="numeric" min="1" max="60" value="${fl}"><span>階</span></div>` : ''}
      <button class="btn-main" id="meSave">これで表示する</button>`);
    $('#meH').oninput = e => h = e.target.value;
    if ($('#meF')) $('#meF').oninput = e => fl = e.target.value;
    document.querySelectorAll('[data-home]').forEach(b => b.onclick = () => { home = b.dataset.home; render(); });
    $('#meSave').onclick = () => {
      me = { height: Math.min(210, Math.max(90, +h || 165)), home, floor: Math.min(60, Math.max(1, Math.round(+fl || 1))) };
      store.set('me', me); store.set('meSet', true); onDone && onDone();
    };
  };
  render();
}

// 水の深さを、自分（身長）と自分の住まいに並べて描く
function depthSVG(lo, hi) {
  const W = 320, H = 180, G = 160, myH = me.height / 100;
  const floors = me.home === 'h1' ? 1 : me.home === 'h2' ? 2 : Math.max(me.floor + 1, 3);
  const storyH = me.home === 'apt' ? 3 : 2.8;
  const bTop = 0.5 + storyH * floors + (me.home === 'apt' ? 0 : 1.4);
  const top = Math.max(7.5, hi * 1.12, Math.min(bTop + 0.6, 40));
  const k = (G - 14) / top, yAt = m => G - m * k;
  const hx = me.home === 'apt' ? 170 : 160, hw = me.home === 'apt' ? 92 : 100;
  let bld = '';
  if (me.home === 'apt') {
    const wallTop = yAt(0.5 + storyH * floors);
    bld += `<rect x="${hx}" y="${wallTop}" width="${hw}" height="${G - wallTop}" fill="#fff" stroke="#5d6677" stroke-width="1.5"/>`;
    for (let f = 1; f <= floors; f++) {
      const y0 = yAt(floorLevel(f)), y1 = yAt(floorLevel(f) + storyH);
      if (y1 < 0) break;
      const mine = f === me.floor;
      if (mine) bld += `<rect x="${hx + 1}" y="${y1}" width="${hw - 2}" height="${y0 - y1}" fill="#ffe8b0"/>`;
      bld += `<line x1="${hx}" y1="${y0}" x2="${hx + hw}" y2="${y0}" stroke="#9aa4b2" stroke-width="1"/>`;
      if (y0 - y1 > 9 && (f <= 3 || mine || f === floors)) bld += `<text x="${hx + hw + 4}" y="${(y0 + y1) / 2 + 4}" font-size="10" fill="${mine ? '#b06000' : '#5d6677'}" font-weight="${mine ? 700 : 400}">${f}階${mine ? '（自分）' : ''}</text>`;
    }
  } else {
    const wallTop = yAt(0.5 + storyH * floors), roof = yAt(0.5 + storyH * floors + 1.4);
    bld += `<g stroke="#5d6677" stroke-width="1.5" fill="#fff"><rect x="${hx}" y="${wallTop}" width="${hw}" height="${G - wallTop}"/>
      <path d="M${hx - 8} ${wallTop} L${hx + hw / 2} ${roof} L${hx + hw + 8} ${wallTop} Z" fill="#e9edf3"/></g>`;
    for (let f = 1; f <= floors; f++) {
      const y0 = yAt(floorLevel(f));
      bld += `<line x1="${hx}" y1="${y0}" x2="${hx + hw}" y2="${y0}" stroke="#9aa4b2" stroke-dasharray="3 3"/>
              <text x="${hx + hw + 4}" y="${yAt(floorLevel(f) + 1.2)}" font-size="10" fill="#5d6677">${f}階</text>`;
    }
  }
  const px = 82, ph = myH * k;
  const person = `<g fill="#1d2433"><circle cx="${px}" cy="${G - ph + ph * 0.09}" r="${ph * 0.09}"/>
      <rect x="${px - ph * 0.085}" y="${G - ph + ph * 0.2}" width="${ph * 0.17}" height="${ph * 0.42}" rx="${ph * 0.05}"/>
      <rect x="${px - ph * 0.08}" y="${G - ph * 0.4}" width="${ph * 0.07}" height="${ph * 0.4}"/>
      <rect x="${px + ph * 0.01}" y="${G - ph * 0.4}" width="${ph * 0.07}" height="${ph * 0.4}"/></g>
      <text x="${px + ph * 0.16 + 2}" y="${G - ph + 6}" font-size="10" fill="#5d6677">自分 ${me.height}cm</text>`;
  const water = `<rect x="0" y="${yAt(hi)}" width="${W}" height="${G - yAt(hi)}" fill="#3d8bfd" opacity=".22"/>
      <rect x="0" y="${yAt(lo)}" width="${W}" height="${G - yAt(lo)}" fill="#3d8bfd" opacity=".38"/>
      <line x1="0" y1="${yAt(hi)}" x2="${W}" y2="${yAt(hi)}" stroke="#1a5fd0" stroke-width="2"/>
      <text x="8" y="${yAt(hi) - 5}" font-size="12" font-weight="700" fill="#1a5fd0">最大 ${hi >= 24 ? '20m以上' : hi + 'm'}</text>`;
  return `<svg class="depthviz" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="浸水の深さと、自分・自分の住まいの比較">
    <rect width="${W}" height="${H}" fill="#f3f5f9"/>${bld}${person}${water}
    <line x1="0" y1="${G}" x2="${W}" y2="${G}" stroke="#8a93a3" stroke-width="2"/><rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#e3e7ee"/></svg>`;
}

// ================= 地点を調べる =================
let lastTap = null, tapMarker = null, inspectSeq = 0, lastResult = null;
function depthWords(hi) {
  if (hi <= 0.5) return '大人のひざくらいまで。床下まで水が来るおそれがあります。';
  if (hi <= 1)   return '大人の腰の高さまで。1階の床上まで水が来るおそれがあります。';
  if (hi <= 3)   return '1階の天井近くまで。1階は水につかるおそれがあります。';
  if (hi <= 5)   return '2階の床上まで水が来るおそれがあります。';
  if (hi <= 10)  return '2階建ての屋根をこえる深さです。';
  if (hi <= 20)  return '4〜6階建ての建物に相当する深さです。';
  return '7階建て以上の建物に相当する深さです。';
}
const coarseNote = z => z !== undefined && z <= PREF_MAX_Z ? `<p class="res-note">※電波がないため、県全体の概略地図で判定しています。境界付近は誤差があります。</p>` : '';
const outsideNote = `<p class="res-note">色がついていない場所でも、安全とは限りません。国や県が想定を作っていない小さな川や、下水があふれる浸水は含まれていません。</p>`;

async function inspect(latlng, opts = {}) {
  lastTap = latlng;
  const seq = ++inspectSeq;
  if (!tapMarker) tapMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#d93025', fillOpacity: 1 }).addTo(map);
  else tapMarker.setLatLng(latlng);
  routeGroup.clearLayers();
  const m = muniAt(latlng.lat, latlng.lng);
  const place = opts.label || (m ? m.properties.name : '');
  openSheet(`<div class="res-place">${esc(place)}</div><div class="spinner"></div>`);

  const elev = await elevation(latlng.lat, latlng.lng);
  if (seq !== inspectSeq) return;
  if (elev.state === 'sea') {
    openSheet(`<div class="res-place">${esc(place)}</div><p class="res-depth neutral">ここは海の上です</p><p class="res-desc">陸の上をタップしてください。</p>`);
    return;
  }
  const l = LAYERS[activeLayer];
  const res = { lat: latlng.lat, lng: latlng.lng, place: place || '選んだ地点', layer: activeLayer, elev: elev.state === 'land' ? elev.h : null };
  let html = `<div class="res-place">${esc(place)}${res.elev !== null ? `　海抜 約${fmtM(Math.max(0, res.elev))}` : ''}</div>
              <div class="res-title">${esc(l.title)}</div>`;
  let figure = '', ctx = {};
  if (l.kind === 'depth') {
    const [r, dur, hanran, kagan] = await Promise.all([
      sample(l.paths[0], latlng.lat, latlng.lng),
      activeLayer === 'flood' ? sample(L_KEIZOKU, latlng.lat, latlng.lng) : null,
      activeLayer === 'flood' ? sample(L_HANRAN, latlng.lat, latlng.lng) : null,
      activeLayer === 'flood' ? sample(L_KAGAN, latlng.lat, latlng.lng) : null,
    ]);
    if (seq !== inspectSeq) return;
    if (r.state === 'hit') {
      const d = classifyDepth(r.rgba);
      if (d) {
        res.depth = d[3]; res.lo = d[4]; res.hi = d[5]; ctx.originHi = d[5];
        html += `<p class="res-depth">${d[3]}</p><p class="res-desc">${depthWords(d[5])}</p>`;
        const st = myStory(d[4], d[5]);
        html += `<div class="mine"><button class="edit" id="editMe">住まいを変える</button>あなたの家（${esc(homeText())}）だと…<br>${st.text}</div>`;
        figure = depthSVG(d[4], d[5]);
      } else html += `<p class="res-depth">浸水の想定あり</p><p class="res-desc">深さの区分は読み取れませんでした。</p>`;
      html += coarseNote(r.z);
    } else if (r.state === 'none') {
      html += `<p class="res-depth neutral">この地点は、${esc(l.label)}の想定区域に入っていません</p>${outsideNote}${coarseNote(r.z)}`;
    } else {
      html += `<p class="res-depth unknown">判定できません</p><p class="res-desc">電波がなく、この地域の地図が保存されていません。</p>`;
    }
    if (hanran?.state === 'hit' || kagan?.state === 'hit') {
      res.kaoku = true;
      html += `<div class="alert red"><b>家ごと流される・倒れるおそれのある区域です</b><br>${hanran?.state === 'hit' ? '川があふれた水の勢いで、木造の家が流されるおそれがあります。' : ''}${kagan?.state === 'hit' ? '川岸がけずられて、家が建物ごと倒れるおそれがあります。' : ''}2階に上がるのではなく、<b>区域の外へ避難</b>します。</div>`;
    }
    if (dur?.state === 'hit') {
      const c = classifyDuration(dur.rgba);
      if (c) {
        res.duration = c[3];
        html += `<div class="alert blue"><b>水が引くまで：${c[3]}</b><br>${c[4] >= 24 ? 'その間、家から出られず、電気・水道・トイレが使えなくなるおそれがあります。上の階で助かっても、備えがないと生活できません。' : '短い時間でも、その間は外に出られません。'}</div>`;
      }
    }
  } else {
    const hits = await doshaAt(latlng.lat, latlng.lng);
    if (seq !== inspectSeq) return;
    if (hits.length) {
      const special = hits.some(h => h.special), planned = hits.every(h => h.planned);
      res.depth = special ? '土砂災害特別警戒区域' : '土砂災害警戒区域';
      html += `<p class="res-depth" style="color:${special ? '#c5221f' : '#b06000'}">${special ? '特別警戒区域' : '警戒区域'}${planned ? '（指定予定）' : ''}</p>
               <p class="res-desc">${hits.map(h => esc(h.name)).join('・')}のおそれがある区域です。${special ? '建物がこわれ、命に危険がおよぶおそれが大きい区域です。' : ''}</p>`;
    } else {
      html += `<p class="res-depth neutral">この地点は、土砂災害警戒区域に入っていません</p><p class="res-note">がけや山のそばでは、区域の外でも大雨のときは注意が必要です。</p>`;
    }
  }
  lastResult = res;
  html += `<div class="others" id="others"></div>
           <button class="btn-main" id="makeCard">この場所の避難カードをつくる</button>
           <div class="block" id="shelters"><div class="spinner"></div></div>
           ${figure ? `<div class="block"><h4>深さのイメージ（自分と住まいを並べると）</h4>${figure}</div>` : ''}
           <p class="res-note">${esc(l.note)} 実際の避難の判断は、市町村の発表に従ってください。</p>
           <button class="btn-line" id="savePlaceHere">この地点の周りを、電波がなくても見られるように保存</button>`;
  openSheet(html);
  if ($('#editMe')) $('#editMe').onclick = () => settingsForm(() => inspect(latlng, opts));
  $('#makeCard').onclick = () => cardForm(lastResult);
  $('#savePlaceHere').onclick = () => openSaveSheet(latlng);
  renderShelters(latlng, seq, ctx);
  summarizeOthers(latlng, seq);
}
async function summarizeOthers(latlng, seq) {
  const tags = [];
  for (const [key, l] of Object.entries(LAYERS)) {
    if (key === activeLayer) continue;
    if (l.kind === 'depth') { const r = await sample(l.paths[0], latlng.lat, latlng.lng); if (r.state === 'hit') { const d = classifyDepth(r.rgba); tags.push(`${l.label}：${d ? d[3] : 'あり'}`); } }
    else { const h = await doshaAt(latlng.lat, latlng.lng); if (h.length) tags.push(`${l.label}：${h.some(x => x.special) ? '特別警戒区域' : '警戒区域'}`); }
  }
  const n = await sample(L_NAISUI, latlng.lat, latlng.lng);
  if (n.state === 'hit') { const d = classifyDepth(n.rgba); tags.push(`下水があふれる浸水：${d ? d[3] : 'あり'}`); }
  if (seq !== inspectSeq) return;
  if (lastResult) lastResult.others = tags;
  const el = $('#others');
  if (el && tags.length) el.innerHTML = '<span style="background:none;padding-left:0">ほかの災害</span>' + tags.map(t => `<span>${esc(t)}</span>`).join('');
}

// ================= 結果シート =================
function openSheet(html, mode) {
  $('#sheetBody').innerHTML = html;
  const s = $('#sheet'); s.hidden = false; s.scrollTop = 0;
  s.classList.toggle('full', mode === 'full'); s.classList.remove('peek');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  $('#sheet').hidden = true; document.body.classList.remove('sheet-open');
  lastTap = null; inspectSeq++; routeGroup.clearLayers();
  if (tapMarker) { map.removeLayer(tapMarker); tapMarker = null; }
}
$('#sheetClose').onclick = closeSheet;
(() => {     // つまみ：タップで大きさを切り替え、下に引くとたたむ・閉じる
  const g = $('#grab'), s = $('#sheet');
  let y0 = null, moved = 0;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; moved = 0; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (y0 !== null) moved = e.clientY - y0; });
  g.addEventListener('pointerup', () => {
    if (y0 === null) return; y0 = null;
    if (Math.abs(moved) < 8) { const full = s.classList.contains('full'); s.classList.toggle('full', !full); s.classList.remove('peek'); return; }
    if (moved > 0) { if (s.classList.contains('peek')) closeSheet(); else if (s.classList.contains('full')) s.classList.remove('full'); else s.classList.add('peek'); }
    else { if (s.classList.contains('peek')) s.classList.remove('peek'); else s.classList.add('full'); }
  });
})();
map.on('click', e => { $('#legend').hidden = true; inspect(e.latlng); });
map.on('contextmenu', e => openSaveSheet(e.latlng));

// ================= 現在地 =================
let meMarker = null;
$('#btnLocate').onclick = () => {
  if (!navigator.geolocation) return toast('この端末では現在地を取得できません');
  toast('現在地を取得しています…', 1500);
  navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }) }).addTo(map);
    else meMarker.setLatLng(ll);
    map.setView(ll, Math.max(map.getZoom(), 16));
    inspect(L.latLng(ll), { label: '現在地' });
  }, () => toast('現在地を取得できませんでした。位置情報の許可を確認してください'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
};

// ================= 検索 =================
let searchTimer = null;
function openSearch() { $('#search').hidden = false; $('#searchInput').focus(); renderSearch(''); }
function closeSearch() { $('#search').hidden = true; $('#searchInput').blur(); }
$('#btnSearch').onclick = openSearch;
$('#searchClose').onclick = closeSearch;
$('#searchInput').addEventListener('input', e => { clearTimeout(searchTimer); const q = e.target.value.trim(); searchTimer = setTimeout(() => renderSearch(q), 350); });
async function renderSearch(q) {
  const ul = $('#searchResults');
  if (!q) { ul.innerHTML = `<li class="rhead">住所（例：熊本市中央区水前寺）や、学校・公民館などの名前で探せます</li>`; return; }
  const items = [];
  for (const f of munis) if (f.properties.name.includes(q)) { const b = f.properties.bbox; items.push({ t: f.properties.name, s: '市町村', bounds: [[b[1], b[0]], [b[3], b[2]]] }); }
  for (const s of shelters) if (s[0].includes(q)) { items.push({ t: s[0], s: s[1] + '（避難場所）', ll: [s[2], s[3]] }); if (items.length > 12) break; }
  let html = items.length ? `<li class="rhead">この中から</li>` + items.slice(0, 10).map((it, i) => `<li data-i="l${i}"><b>${esc(it.t)}</b><small>${esc(it.s)}</small></li>`).join('') : '';
  ul.innerHTML = html + (navigator.onLine ? `<li class="rhead">住所を探しています…</li>` : `<li class="rhead">電波がないため、住所の検索はできません</li>`);
  bindResults(items, []);
  if (!navigator.onLine) return;
  let addr = [];
  try {
    const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
    addr = (await r.json()).slice(0, 8).map(a => ({ t: a.properties.title, s: '住所', ll: [a.geometry.coordinates[1], a.geometry.coordinates[0]] }));
  } catch {}
  if ($('#searchInput').value.trim() !== q) return;
  html += addr.length ? `<li class="rhead">住所</li>` + addr.map((it, i) => `<li data-i="a${i}"><b>${esc(it.t)}</b><small>番地まで一致しないことがあります。表示後、地図をタップして位置を合わせてください</small></li>`).join('') : `<li class="rhead">住所が見つかりませんでした</li>`;
  ul.innerHTML = html;
  bindResults(items, addr);
}
function bindResults(items, addr) {
  document.querySelectorAll('#searchResults li[data-i]').forEach(li => li.onclick = () => {
    const k = li.dataset.i, it = k[0] === 'l' ? items[+k.slice(1)] : addr[+k.slice(1)];
    closeSearch();
    if (it.bounds) { map.fitBounds(it.bounds); return; }
    map.setView(it.ll, 17);
    inspect(L.latLng(it.ll[0], it.ll[1]), { label: it.t });
  });
}

// ================= 避難カード =================
function cardForm(res) {
  if (!res) return;
  let name = res.place === '現在地' ? '自宅' : (res.place || '自宅');
  let dest = 0, timing = 'l3', msg = '', meet = '';
  const opts = lastShelters.map((n, i) => ({ k: i, t: n.s[0], s: `${dirName(bearingDeg(res.lat, res.lng, n.s[2], n.s[3]))}へ ${fmtDist(n.d)}（直線）` }));
  const canStay = res.hi !== undefined && !res.kaoku && res.hi <= floorLevel(myTopFloor()) && !(res.duration && /週間/.test(res.duration));
  if (canStay) opts.push({ k: 'stay', t: '家の上の階にとどまる', s: '水が来ない想定の階で、水と食料を備えて待つ' });
  const render = () => {
    openSheet(`<div class="res-title">避難カードをつくる</div>
      <p class="res-desc" style="margin:2px 0">3つ決めるだけです。できたカードは画像で保存して、家族に送れます。</p>
      <label class="lbl">この場所の名前</label><input class="field" id="cName" value="${esc(name)}" maxlength="20">
      <label class="lbl">① どこへ逃げる？</label>
      <div class="optlist">${opts.length ? opts.map(o => `<button class="opt ${o.k === dest ? 'on' : ''}" data-dest="${o.k}"><span class="dot"></span><span><b>${esc(o.t)}</b><small>${esc(o.s)}</small></span></button>`).join('') : '<div class="shel-info">近くの避難場所が見つかりませんでした。</div>'}</div>
      ${canStay ? '' : (res.hi !== undefined ? '<div class="shel-info">この場所は、家の中にとどまる避難（上の階へ）が向かないため、避難場所から選びます。</div>' : '')}
      <label class="lbl">② いつ逃げ始める？</label>
      <div class="optlist">${TIMINGS.map(o => `<button class="opt ${o.id === timing ? 'on' : ''}" data-timing="${o.id}"><span class="dot"></span><span><b>${esc(o.t)}</b><small>${esc(o.s)}</small></span></button>`).join('')}</div>
      <label class="lbl">③ 家族に伝えたいこと</label>
      <textarea class="field" id="cMsg" maxlength="80" placeholder="例：先に避難したら、LINEで「着いた」と送る">${esc(msg)}</textarea>
      <label class="lbl">はぐれたときの集合場所（任意）</label><input class="field" id="cMeet" value="${esc(meet)}" maxlength="24" placeholder="例：〇〇小学校の正門">
      <button class="btn-main" id="cMake">カードをつくる</button>`, 'full');
    $('#cName').oninput = e => name = e.target.value;
    $('#cMsg').oninput = e => msg = e.target.value;
    $('#cMeet').oninput = e => meet = e.target.value;
    document.querySelectorAll('[data-dest]').forEach(b => b.onclick = () => { dest = b.dataset.dest === 'stay' ? 'stay' : +b.dataset.dest; render(); });
    document.querySelectorAll('[data-timing]').forEach(b => b.onclick = () => { timing = b.dataset.timing; render(); });
    $('#cMake').onclick = async () => {
      const o = opts.find(x => x.k === dest);
      const card = {
        id: Date.now().toString(36), created: Date.now(), name: (name || '自宅').trim(), lat: res.lat, lng: res.lng,
        layer: res.layer, depth: res.depth || null, lo: res.lo, hi: res.hi, duration: res.duration || null, kaoku: !!res.kaoku,
        others: res.others || [], dest: o ? { t: o.t, s: o.s } : null, timing, msg: msg.trim(), meet: meet.trim(),
        me: { ...me },
      };
      cards.unshift(card); store.set('cards', cards.slice(0, 20));
      closeSheet(); openCards(card.id);
    };
  };
  render();
}

function wrapText(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const ch of String(text)) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}
function svgToImage(svg) {
  return new Promise((ok, ng) => { const img = new Image(); img.onload = () => ok(img); img.onerror = ng; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
}
async function renderCardImage(card) {
  // 縦に長いキャンバスに描いてから、使った高さで切り出す（文字量でカードの長さが変わる）
  const W = 1080, c = document.createElement('canvas'); c.width = W; c.height = 3200;
  const g = c.getContext('2d'), F = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, c.height);
  g.fillStyle = '#0a66d8'; g.fillRect(0, 0, W, 190);
  g.fillStyle = '#fff'; g.font = `800 64px ${F}`; g.fillText('わたしの避難カード', 60, 105);
  g.font = `500 32px ${F}`; g.fillText(`${card.name}　${new Date(card.created).toLocaleDateString('ja-JP')} 作成`, 60, 158);
  let y = 260;
  const label = t => { g.fillStyle = '#5d6677'; g.font = `700 30px ${F}`; g.fillText(t, 60, y); y += 50; };
  const body = (t, size = 40, color = '#1d2433', weight = 700) => { g.fillStyle = color; g.font = `${weight} ${size}px ${F}`; for (const ln of wrapText(g, t, W - 120)) { g.fillText(ln, 60, y); y += size * 1.38; } };
  label('この場所の危険（想定最大規模）');
  const risk = [];
  if (card.depth) risk.push(`${LAYERS[card.layer]?.label || ''}：${card.depth}`);
  if (card.duration) risk.push(`水が引くまで：${card.duration}`);
  if (card.kaoku) risk.push('家ごと流される・倒れるおそれのある区域');
  for (const o of card.others || []) risk.push(o);
  body(risk.length ? risk.join('\n') : `${LAYERS[card.layer]?.label || ''}の想定区域の外（ただし安全とは限らない）`, 40, '#c5221f');
  y += 10;
  if (card.hi !== undefined && card.hi !== null) {
    const keep = me; me = card.me;
    try { const img = await svgToImage(depthSVG(card.lo, card.hi)); g.drawImage(img, 60, y, W - 120, (W - 120) * 180 / 320); } catch {}
    me = keep; y += (W - 120) * 180 / 320 + 40;
  }
  label('① どこへ逃げる？');
  body(card.dest ? card.dest.t : '（未定）', 50, '#1d2433', 800);
  if (card.dest) body(card.dest.s, 32, '#5d6677', 500);
  y += 14; label('② いつ逃げ始める？');
  body(TIMINGS.find(t => t.id === card.timing)?.t || '', 42, '#1d2433', 800);
  if (card.msg) { y += 14; label('③ 家族へ'); body(card.msg, 38, '#1d2433', 500); }
  if (card.meet) { y += 14; label('はぐれたときの集合場所'); body(card.meet, 38, '#1d2433', 500); }
  y += 30;
  // 出典欄
  const foot = ['出典：ハザードマップポータルサイト、国土地理院（指定緊急避難場所）', 'くまもとハザードマップ（試作）／NPO法人plus mirai', '実際の避難の判断は、市町村の発表に従ってください。'];
  g.font = `500 24px ${F}`;
  const fl = foot.flatMap(t => wrapText(g, t, W - 120));
  const footH = 40 + fl.length * 34;
  g.fillStyle = '#f3f5f9'; g.fillRect(0, y, W, footH);
  g.fillStyle = '#5d6677'; fl.forEach((t, i) => g.fillText(t, 60, y + 48 + i * 34));
  const H = Math.ceil(y + footH);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  out.getContext('2d').drawImage(c, 0, 0, W, H, 0, 0, W, H);
  return await new Promise(r => out.toBlob(b => r(b), 'image/png'));
}
const cardFiles = {};
async function openCards(focusId) {
  $('#cardPanel').hidden = false;
  const body = $('#cardBody');
  if (!cards.length) { body.innerHTML = `<div class="empty">まだカードがありません。<br>地図で自宅や学校をタップして、「この場所の避難カードをつくる」から作れます。</div>`; return; }
  const card = cards.find(c => c.id === focusId) || cards[0];
  body.innerHTML = `<div class="spinner"></div>`;
  const blob = await renderCardImage(card);
  const file = new File([blob], `hinan-card-${card.name}.png`, { type: 'image/png' });
  cardFiles[card.id] = file;
  const url = URL.createObjectURL(blob);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  body.innerHTML = `<img class="cardimg" src="${url}" alt="わたしの避難カード：${esc(card.name)}">
    ${canShare ? `<button class="btn-main" id="cShare">家族に送る・画像を保存</button>` : `<div class="empty">画像を長押しすると、写真に保存できます。保存した画像をLINEで家族に送れます。</div>`}
    <button class="btn-line" id="cMap">地図でこの場所を見る</button>
    <h3 class="sec">つくったカード</h3>
    <ul class="cardlist">${cards.map(c => `<li><div class="meta"><b>${esc(c.name)}</b><small>${new Date(c.created).toLocaleDateString('ja-JP')}・${esc(c.dest ? c.dest.t : '避難先未定')}</small></div>
      <button class="dlbtn" data-open="${c.id}"><span>${c.id === card.id ? '表示中' : '見る'}</span></button><button class="dlbtn" data-del="${c.id}" style="min-width:56px;background:#fce8e6;color:#c5221f"><span>削除</span></button></li>`).join('')}</ul>`;
  if (canShare) $('#cShare').onclick = () => {
    navigator.share({ files: [cardFiles[card.id]], title: 'わたしの避難カード', text: `${card.name}の避難カードです。避難先：${card.dest ? card.dest.t : '未定'}` }).catch(() => {});
  };
  $('#cMap').onclick = () => { $('#cardPanel').hidden = true; map.setView([card.lat, card.lng], 16); inspect(L.latLng(card.lat, card.lng), { label: card.name }); };
  body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCards(b.dataset.open));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const c = cards.find(x => x.id === b.dataset.del);
    if (!confirm(`「${c.name}」のカードを削除しますか？`)) return;
    cards = cards.filter(x => x.id !== c.id); store.set('cards', cards); openCards();
  });
}
$('#btnCards').onclick = () => openCards();
$('#cardClose').onclick = () => { $('#cardPanel').hidden = true; };

// ================= オンライン表示 =================
function updateNet() { const on = navigator.onLine, b = $('#netBadge'); b.textContent = on ? 'オンライン' : 'オフライン'; b.className = 'badge ' + (on ? 'online' : 'offline'); }
addEventListener('online', updateNet);
addEventListener('offline', () => { updateNet(); toast('オフラインです。保存した地域だけ表示できます'); });
updateNet();

// ================= オフライン保存 =================
const TILE_CACHE = P + 'tiles-v1';
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
function tilesForFeature(f, maxZ) {
  const out = [], [w, s, e, n] = f.properties.bbox, rings = f.geometry.coordinates.map(p => p[0]);
  const inside = (lon, lat) => rings.some(r => pointInRing(lon, lat, r));
  for (let z = MIN_SAVE_Z; z <= maxZ; z++) {
    const x0 = Math.floor(lon2x(w, z)), x1 = Math.floor(lon2x(e, z)), y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
    const vset = new Set();
    for (const r of rings) for (const [lon, lat] of r) vset.add(Math.floor(lon2x(lon, z)) + ',' + Math.floor(lat2y(lat, z)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (z <= 11 || vset.has(x + ',' + y)) { out.push([z, x, y]); continue; }
      const lw = x2lon(x, z), le = x2lon(x + 1, z), ln = y2lat(y, z), ls = y2lat(y + 1, z);
      if (inside((lw + le) / 2, (ln + ls) / 2) || inside(lw, ln) || inside(le, ln) || inside(lw, ls) || inside(le, ls)) out.push([z, x, y]);
    }
  }
  return out;
}
function tilesForCircle(lat, lon, rKm, maxZ) {
  const out = [], kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  for (let z = MIN_SAVE_Z; z <= maxZ; z++) {
    const x0 = Math.floor(lon2x(lon - rKm / kx, z)), x1 = Math.floor(lon2x(lon + rKm / kx, z));
    const y0 = Math.floor(lat2y(lat + rKm / ky, z)), y1 = Math.floor(lat2y(lat - rKm / ky, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const lw = x2lon(x, z), le = x2lon(x + 1, z), ln = y2lat(y, z), ls = y2lat(y + 1, z);
      const cx = Math.max(lw, Math.min(lon, le)), cy = Math.max(ls, Math.min(lat, ln));
      if (Math.hypot((cx - lon) * kx, (cy - lat) * ky) <= rKm) out.push([z, x, y]);
    }
  }
  return out;
}
function tilesForPref() {
  const seen = new Set(), out = [];
  for (const f of munis) for (const t of tilesForFeature(f, PREF_MAX_Z)) { const k = t.join('/'); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}
function tilesForEntry(e) {
  if (e.kind === 'pref') return tilesForPref();
  if (e.kind === 'place') return tilesForCircle(e.lat, e.lon, e.r, e.maxZ);
  const f = munis.find(m => m.properties.code === e.code);
  return f ? tilesForFeature(f, e.maxZ) : [];
}
function urlsForTiles(tiles) {
  const urls = [];
  for (const [z, x, y] of tiles) {
    urls.push(tileUrl(BASE_URL, z, x, y));
    if (z <= DEM_MAX_Z) urls.push(tileUrl(DEM_URL, z, x, y));
    if (z <= HZ_MAX_Z) for (const p of ALL_HZ_PATHS) urls.push(tileUrl(hzTpl(p), z, x, y));
  }
  return urls;
}
const estTilesBytes = tiles => tiles.reduce((a, [z]) => a + (KB_PER_TILE[z] || 30) * 1024, 0) * 1.15;
const estCache = {};
const estFor = (k, fn) => estCache[k] ??= estTilesBytes(fn());
async function downloadArea(key, entry) {
  if (jobs[key]) return;
  if (!navigator.onLine) return toast('保存にはインターネット接続が必要です');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const cache = await caches.open(TILE_CACHE);
  const tiles = tilesForEntry(entry), urls = urlsForTiles(tiles);
  const job = jobs[key] = { cancel: false, done: 0, total: urls.length, bytes: 0, failed: 0 };
  saved[key] = { ...entry, date: Date.now(), tiles: tiles.length, bytes: saved[key]?.bytes || 0, done: false, partial: false };
  saveLedger(); renderPanel(); drawPlaces();
  let i = 0;
  const worker = async () => {
    while (i < urls.length && !job.cancel) {
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) {
          let ok = false;
          for (let a = 0; a < 3 && !ok; a++) {
            try {
              const r = await fetch(url, { mode: 'cors' });
              if (r.ok) { const buf = await r.arrayBuffer(); job.bytes += buf.byteLength; await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'image/png' } })); ok = true; }
              else if (r.status === 404) { await cache.put(url, new Response(EMPTY_PNG, { headers: { 'Content-Type': 'image/png', 'X-HM-Empty': '1' } })); ok = true; }
            } catch { await new Promise(r => setTimeout(r, 400 * (a + 1))); }
          }
          if (!ok) job.failed++;
        }
      } catch (e) { job.failed++; if (e && e.name === 'QuotaExceededError') { job.cancel = true; toast('端末の空き容量が足りません'); } }
      job.done++;
      if (job.done % 40 === 0) renderPanel();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const cancelled = job.cancel; delete jobs[key];
  if (!saved[key]) return;
  saved[key].bytes += job.bytes; saved[key].failed = job.failed;
  saved[key].done = !cancelled && job.failed === 0; saved[key].partial = !saved[key].done;
  saveLedger(); pixCache.clear(); refreshMuniStyle(); drawPlaces(); renderPanel(); updateStorage();
  if (cancelled) toast(`${entry.name}の保存を中断しました（もう一度押すと続きから再開）`);
  else if (job.failed) toast(`${entry.name}：${job.failed}件取得できませんでした。もう一度押すと再試行します`);
  else toast(`${entry.name}を保存しました。電波がなくても見られます`);
}
async function deleteArea(key) {
  const e = saved[key]; if (!e) return;
  if (jobs[key]) jobs[key].cancel = true;
  const keep = new Set();
  for (const [k, s] of Object.entries(saved)) if (k !== key) for (const u of urlsForTiles(tilesForEntry(s))) keep.add(u);
  const urls = urlsForTiles(tilesForEntry(e));
  delete saved[key]; saveLedger();
  const cache = await caches.open(TILE_CACHE);
  for (const u of urls) if (!keep.has(u)) await cache.delete(u);
  pixCache.clear(); refreshMuniStyle(); drawPlaces(); renderPanel(); updateStorage();
  toast(`${e.name}の保存データを削除しました`);
}
const savePref = () => downloadArea('pref', { kind: 'pref', name: '熊本県全体の概略地図', maxZ: PREF_MAX_Z });

const NAME_PRESETS = ['自宅', '学校', '実家', '塾・バイト先'];
function openSaveSheet(latlng) {
  inspectSeq++;
  if (!tapMarker) tapMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0a66d8', fillOpacity: 1 }).addTo(map);
  else tapMarker.setLatLng(latlng);
  routeGroup.clearLayers();
  let name = NAME_PRESETS[0], r = 2;
  const preview = L.circle(latlng, { radius: r * 1000, color: '#0a66d8', weight: 2, dashArray: '6 6', fillOpacity: .06, interactive: false }).addTo(routeGroup);
  const sizeOf = rr => fmtMB(estFor(`c${rr}@${latlng.lat.toFixed(2)}`, () => tilesForCircle(latlng.lat, latlng.lng, rr, PLACE_MAX_Z)));
  const render = () => {
    openSheet(`<div class="res-title">この地点の周りを保存</div>
      <p class="res-desc" style="margin:2px 0 4px">電波がなくても、道路まで鮮明な地図とハザード情報を見られるようにします。</p>
      <div class="chipsel">${NAME_PRESETS.map(n => `<button data-n="${n}" class="${n === name ? 'on' : ''}">${n}</button>`).join('')}</div>
      <input class="field" id="placeName2" placeholder="名前を入力（例：祖母の家）" value="${NAME_PRESETS.includes(name) ? '' : esc(name)}">
      <label class="lbl">保存する範囲</label>
      <div class="seg">${[1, 2, 3].map(x => `<button data-r="${x}" class="${x === r ? 'on' : ''}">半径${x}km<small>約${sizeOf(x)}</small></button>`).join('')}</div>
      <button class="btn-main" id="doSavePlace">保存する</button>`);
    document.querySelectorAll('.chipsel [data-n]').forEach(b => b.onclick = () => { name = b.dataset.n; render(); });
    $('#placeName2').oninput = e => { const v = e.target.value.trim(); name = v || NAME_PRESETS[0]; };
    document.querySelectorAll('.seg [data-r]').forEach(b => b.onclick = () => { r = +b.dataset.r; preview.setRadius(r * 1000); render(); });
    $('#doSavePlace').onclick = () => {
      const id = 'p:' + Date.now().toString(36);
      closeSheet();
      downloadArea(id, { kind: 'place', name, lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6), r, maxZ: PLACE_MAX_Z });
      toast(`${name}の周り（半径${r}km）を保存しています…`);
    };
  };
  render();
  map.fitBounds(preview.getBounds(), { paddingBottomRight: [0, 320] });
}
function drawPlaces() {
  placeGroup.clearLayers();
  for (const e of Object.values(saved)) {
    if (e.kind !== 'place') continue;
    L.circle([e.lat, e.lon], { radius: e.r * 1000, pane: 'places', color: '#0a66d8', weight: 1.5, opacity: .7, dashArray: e.done ? null : '4 6', fillOpacity: .03, interactive: false }).addTo(placeGroup);
    L.marker([e.lat, e.lon], { pane: 'places', icon: L.divIcon({ className: '', html: '', iconSize: [0, 0] }), interactive: false })
      .bindTooltip(esc(e.name) + (e.done ? '' : '（保存中）'), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -4] }).addTo(placeGroup);
  }
}
function statusBtn(key, e) {
  const j = jobs[key];
  if (j) { const pct = Math.floor(j.done / j.total * 100); return { sub: `保存中… ${pct}%（${fmtMB(j.bytes)}）`, btn: `<button class="dlbtn busy" data-act="stop" data-key="${key}"><i class="prog" style="width:${pct}%"></i><span>中断</span></button>` }; }
  if (e && e.done) return { sub: null, btn: `<button class="dlbtn saved" data-act="menu" data-key="${key}"><span>✓ 保存済み</span></button>` };
  if (e && e.partial) return { sub: `途中まで保存（${fmtMB(e.bytes)}）`, btn: `<button class="dlbtn" data-act="resume" data-key="${key}"><span>続きから</span></button>` };
  return null;
}
const dateStr = t => new Date(t).toLocaleDateString('ja-JP');
function renderPanel() {
  if ($('#dlPanel').hidden) return;
  const e = saved.pref, st = statusBtn('pref', e), est = munis.length ? estFor('pref', tilesForPref) : 0;
  $('#prefList').innerHTML = `<li><div class="meta"><div class="name">熊本県全体</div><div class="sub">${st?.sub ?? (e?.done ? `保存済み・${fmtMB(e.bytes)}・${dateStr(e.date)}` : `約${fmtMB(est)}・どこにいても、だいたいの危険がわかる`)}</div></div>${st?.btn ?? `<button class="dlbtn" data-act="pref"><span>保存</span></button>`}</li>`;
  const places = Object.entries(saved).filter(([, x]) => x.kind === 'place');
  $('#placeList').innerHTML = places.length ? places.map(([k, x]) => { const s2 = statusBtn(k, x); return `<li><div class="meta"><div class="name">${esc(x.name)}</div><div class="sub">${s2?.sub ?? `半径${x.r}km・${fmtMB(x.bytes)}・${dateStr(x.date)}`}</div></div>${s2?.btn ?? ''}</li>`; }).join('')
    : `<li><div class="meta"><div class="sub">まだありません。自宅や学校を保存しておくと、電波がなくても道路まで鮮明に見られます。</div></div></li>`;
  if ($('#muniDetails').open) renderMuniList();
}
function renderMuniList() {
  const q = $('#dlSearch').value.trim(), c = map.getCenter(), here = muniAt(c.lat, c.lng), hereCode = here ? here.properties.code : null;
  const list = munis.filter(f => !q || f.properties.name.includes(q)).sort((a, b) => (b.properties.code === hereCode) - (a.properties.code === hereCode));
  $('#dlList').innerHTML = list.map(f => {
    const p = f.properties, key = 'm:' + p.code, e = saved[key], st = statusBtn(key, e);
    const sub = st?.sub ?? (e?.done ? `保存済み・${e.maxZ >= 16 ? '詳細' : '標準'}・${fmtMB(e.bytes)}` : `約${fmtMB(estFor(key + '@' + quality, () => tilesForFeature(f, quality)))}`);
    return `<li><div class="meta"><div class="name">${esc(p.name)}${p.code === hereCode ? '<em>表示中</em>' : ''}</div><div class="sub">${sub}</div></div>${st?.btn ?? `<button class="dlbtn" data-act="muni" data-key="${key}"><span>保存</span></button>`}</li>`;
  }).join('');
}
$('#muniDetails').addEventListener('toggle', () => { if ($('#muniDetails').open) renderMuniList(); });
$('#dlPanel').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act, key = b.dataset.key;
  if (act === 'pref') savePref();
  else if (act === 'muni') { const f = munis.find(m => 'm:' + m.properties.code === key); downloadArea(key, { kind: 'muni', code: f.properties.code, name: f.properties.name, maxZ: quality }); }
  else if (act === 'resume') downloadArea(key, saved[key]);
  else if (act === 'stop') jobs[key].cancel = true;
  else if (act === 'menu') {
    const s = saved[key];
    if (confirm(`「${s.name}」の保存データを削除しますか？\n（「キャンセル」で地図に移動します）`)) deleteArea(key);
    else {
      $('#dlPanel').hidden = true;
      if (s.kind === 'place') map.fitBounds(L.latLng(s.lat, s.lon).toBounds(s.r * 2000));
      else if (s.kind === 'muni') { const bb = munis.find(m => m.properties.code === s.code).properties.bbox; map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]); }
      else map.fitBounds(KUMAMOTO_BOUNDS);
    }
  }
});
$('#addPlace').onclick = () => { $('#dlPanel').hidden = true; toast('保存したい場所を地図で長押しするか、タップして結果の下にある「保存」を押してください', 4500); };
$('#dlSearch').addEventListener('input', renderMuniList);
document.querySelectorAll('#muniDetails .seg button').forEach(b => {
  b.classList.toggle('on', +b.dataset.q === quality);
  b.onclick = () => { quality = +b.dataset.q; store.set('quality', quality); document.querySelectorAll('#muniDetails .seg button').forEach(x => x.classList.toggle('on', x === b)); renderMuniList(); };
});
$('#btnDownload').onclick = () => { $('#dlPanel').hidden = false; renderPanel(); updateStorage(); };
$('#dlClose').onclick = () => { $('#dlPanel').hidden = true; };
async function updateStorage() {
  const total = Object.values(saved).reduce((a, s) => a + (s.bytes || 0), 0);
  let line = `保存済み ${fmtMB(total)}`, bar = '';
  try { const est = await navigator.storage.estimate(); if (est.quota) { line += `<span style="float:right;color:var(--sub)">空き 約${fmtMB(est.quota - est.usage)}</span>`; bar = `<div class="bar"><i style="width:${Math.min(100, est.usage / est.quota * 100).toFixed(1)}%"></i></div>`; } } catch {}
  $('#storageInfo').innerHTML = line + bar;
}

// ================= 初回の案内 =================
const OB = [
  { h: '自分の家は、大雨のときどうなる？', p: 'この地図は、熊本県のどこが、どのくらい水につかるかを見るためのものです。まず<b>自宅や学校</b>を探してみましょう。<br>上の<b>虫めがね</b>で住所を検索するか、<b>「現在地」</b>ボタンを押します。',
    ill: '<svg viewBox="0 0 200 120"><rect x="20" y="10" width="160" height="100" rx="12" fill="#fff" stroke="#c9d0da"/><path d="M20 70 Q60 55 100 72 T180 66 V110 H20Z" fill="#ffb7b7" opacity=".8"/><circle cx="104" cy="50" r="9" fill="#d93025" stroke="#fff" stroke-width="3"/><circle cx="150" cy="28" r="10" fill="none" stroke="#1d2433" stroke-width="3"/><path d="M157 35l9 9" stroke="#1d2433" stroke-width="4" stroke-linecap="round"/></svg>' },
  { h: '深さを、自分の体と家で感じる', p: '地図をタップすると、その場所で想定される水の深さを、<b>あなたの身長と住まい</b>に並べて表示します。<br>「水が引くまで何日かかるか」も出ます。',
    ill: '<svg viewBox="0 0 200 120"><rect x="110" y="40" width="60" height="70" fill="#fff" stroke="#5d6677"/><path d="M102 40 L140 14 L178 40Z" fill="#e9edf3" stroke="#5d6677"/><rect x="0" y="70" width="200" height="40" fill="#3d8bfd" opacity=".35"/><line x1="0" y1="70" x2="200" y2="70" stroke="#1a5fd0" stroke-width="2"/><circle cx="60" cy="62" r="5" fill="#1d2433"/><rect x="56" y="68" width="8" height="20" rx="2" fill="#1d2433"/><rect x="56" y="88" width="3" height="20" fill="#1d2433"/><rect x="61" y="88" width="3" height="20" fill="#1d2433"/></svg>' },
  { h: '最後に「避難カード」をつくる', p: '<b>どこへ・いつ逃げるか</b>を決めて、カードにします。画像で保存して、<b>家族に送りましょう</b>。<br>近くの避難場所は、災害の種類ごとに対応した場所だけを出します。',
    ill: '<svg viewBox="0 0 200 120"><rect x="45" y="8" width="110" height="104" rx="10" fill="#fff" stroke="#c9d0da"/><rect x="45" y="8" width="110" height="24" rx="10" fill="#0a66d8"/><rect x="57" y="44" width="70" height="8" rx="4" fill="#c5221f" opacity=".7"/><rect x="57" y="62" width="86" height="8" rx="4" fill="#c9d0da"/><rect x="57" y="78" width="60" height="8" rx="4" fill="#c9d0da"/><rect x="57" y="94" width="76" height="8" rx="4" fill="#c9d0da"/></svg>' },
  { h: 'はじめる前に', p: '表示しているのは「想定最大規模」（1000年に1回程度）の災害が起きた場合の想定です。<b>色がない場所も安全とは限りません。</b>実際の避難の判断は、市町村の発表に従ってください。<p class="small">地図：国土地理院 地理院タイル／ハザード情報：ハザードマップポータルサイト／避難場所：国土地理院</p>',
    extra: `<label class="check"><input type="checkbox" id="obSave"><span>電波がなくても見られるように、県全体の概略地図（約18MB）を保存する<br><small style="color:var(--sub)">Wi-Fiにつながっているときがおすすめです。あとから「保存」ボタンでもできます。</small></span></label>` },
];
let obIdx = 0;
function renderOnboard() {
  const s = OB[obIdx];
  $('#obSteps').innerHTML = `${s.ill ? `<div class="ob-ill">${s.ill}</div>` : ''}<div class="ob-step-no">${obIdx + 1} / ${OB.length}</div><h2>${s.h}</h2><p>${s.p}</p>${s.extra || ''}`;
  $('#obDots').innerHTML = OB.map((_, i) => `<i class="${i === obIdx ? 'on' : ''}"></i>`).join('');
  $('#obBack').style.visibility = obIdx ? 'visible' : 'hidden';
  $('#obNext').textContent = obIdx === OB.length - 1 ? 'はじめる' : '次へ';
}
function openOnboard() { obIdx = 0; $('#onboard').hidden = false; renderOnboard(); }
$('#obBack').onclick = () => { if (obIdx) { obIdx--; renderOnboard(); } };
$('#obNext').onclick = () => {
  if (obIdx < OB.length - 1) { obIdx++; renderOnboard(); return; }
  const wantSave = $('#obSave')?.checked;
  $('#onboard').hidden = true; store.set('agreed', true);
  if (wantSave) savePref();
  if (!store.get('meSet', false)) setTimeout(() => settingsForm(() => { closeSheet(); toast('設定しました。虫めがねで自宅を探すか、「現在地」を押してみましょう', 4000); }), 300);
};
$('#btnHelp').onclick = openOnboard;

// ================= 起動 =================
Promise.all([
  fetch('data/kumamoto_municipalities.geojson').then(r => r.json()),
  fetch('data/shelters_kumamoto.json').then(r => r.json()),
]).then(([g, sh]) => {
  munis = g.features; shelters = sh.items;
  muniLayer = L.geoJSON(g, { style: muniStyle, interactive: false }).addTo(map);
  updatePlace(); drawShelterDots(); drawPlaces(); renderPanel();
});
showLayer(LAYERS[activeLayer] ? activeLayer : 'flood');
if (!store.get('agreed', false)) openOnboard();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
