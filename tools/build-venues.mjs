// OpenStreetMap 추출본(tools/osm/*.json, 지역 좌표 m) → data/venues.js
// 등록 서킷의 실제 중심선·피트 레인·건물·주차장·물을 앱이 쓰는 작은 형식으로 줄입니다.
// 사용법: node tools/build-venues.mjs
// 지도 데이터 © OpenStreetMap contributors (ODbL). tools/osm/*.json은 Overpass API로 받은 뒤 서킷 원점 기준 m 좌표로 바꾼 것입니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const VENUES = [
  { id: 'bmw-dc', name: 'BMW 드라이빙 센터', file: 'osm/bmw-dc.json', hw: 5.0, near: 420 },
  { id: 'inje', name: '인제 스피디움', file: 'osm/inje.json', hw: 6.5, near: 520 },
];
const r1 = (n) => Math.round(n * 10) / 10;
const flat = (pts) => pts.flatMap((p) => [r1(p[0]), r1(p[1])]);
const open = (pts) => (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts);
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function length(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return d; }
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function resample(pts, step, closed) {
  const src = closed ? pts.concat([pts[0]]) : pts, out = [];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  if (!closed) out.push(src[src.length - 1]);
  return out;
}

const result = [];
for (const cfg of VENUES) {
  const src = JSON.parse(fs.readFileSync(path.join(here, cfg.file), 'utf8'));
  // 멀티폴리곤의 안쪽 고리(구멍)는 도형으로 쓰지 않습니다
  const ways = src.ways.filter((w) => !String(w.id).includes('/inner')).map((w) => ({ ...w, tags: w.tags || {} }));
  const race = ways.filter((w) => w.tags.highway === 'raceway');
  // 본 코스: 면(area)이 아닌 닫힌 raceway 중 가장 긴 것
  const loopWay = race.filter((w) => w.closed && w.tags.area !== 'yes').sort((a, b) => b.lengthM - a.lengthM)[0];
  if (!loopWay) throw new Error(cfg.id + ': 닫힌 raceway way가 없습니다');
  const loop = open(loopWay.pts), dense = resample(loop, 4, true);
  const distToLoop = (p) => { let m = Infinity; for (const q of dense) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < m) m = d; } return m; };
  const nearLoop = (pts, lim) => pts.some((p) => distToLoop(p) < lim);

  // 서로 다른 구간 사이의 최소 간격(중심선 기준) → 반폭이 그 절반을 넘지 않게
  let gap = Infinity; const n = dense.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const da = Math.min(j - i, n - (j - i)) * 4; if (da < 70) continue;
    const d = Math.hypot(dense[i][0] - dense[j][0], dense[i][1] - dense[j][1]); if (d < gap) gap = d;
  }
  const hw = Math.min(cfg.hw, Math.floor((gap / 2 - 0.4) * 10) / 10);

  const lanes = race.filter((w) => w !== loopWay && w.tags.area !== 'yes').map((w) => ({ c: w.closed ? 1 : 0, p: flat(open(w.pts)) }));
  const pads = race.filter((w) => w.tags.area === 'yes' && w.closed && !w.tags.name && area(open(w.pts)) < 60000)
    .map((w) => ({ k: w.tags.surface === 'unpaved' ? 'dirt' : 'asphalt', p: flat(open(w.pts)) }));
  const roads = ways.filter((w) => ['service', 'unclassified', 'track', 'residential', 'tertiary'].includes(w.tags.highway) && !w.closed && length(w.pts) >= 25 && nearLoop(w.pts, cfg.near * 0.8))
    .map((w) => ({ w: w.tags.highway === 'service' ? (w.tags.service === 'parking_aisle' ? 4 : 5) : w.tags.highway === 'track' ? 3.5 : 7, p: flat(w.pts) }));
  const polys = (test, lim) => ways.filter((w) => w.closed && test(w.tags) && distToLoop(centroid(open(w.pts))) < lim).map((w) => flat(open(w.pts)));
  const parking = polys((t) => t.amenity === 'parking', cfg.near);
  const water = polys((t) => t.natural === 'water', cfg.near * 1.3);
  const buildings = ways.filter((w) => w.closed && (w.tags.building || w.tags.leisure === 'bleachers') && distToLoop(centroid(open(w.pts))) < cfg.near)
    .map((w) => {
      const pts = open(w.pts), a = area(pts), lv = parseFloat(w.tags['building:levels']), ht = parseFloat(w.tags.height);
      const stand = w.tags.leisure === 'bleachers' || /스탠드|stand/i.test(w.tags.name || '') || w.tags.building === 'grandstand';
      // 관람석 도형(bleachers)은 같은 자리의 스탠드 건물보다 낮게 잡아 지붕이 한 면에 겹치지 않게 합니다
      const h = w.tags.leisure === 'bleachers' ? 5.5 : stand ? 9 : isFinite(ht) ? ht : isFinite(lv) ? Math.max(4, lv * 3.6) : a >= 3000 ? 12 : a >= 800 ? 8 : 5;
      return { h: r1(h), k: stand ? 'stand' : a >= 3000 || lv >= 4 ? 'main' : 'box', name: w.tags.name || '', p: flat(pts) };
    });
  result.push({
    id: cfg.id, name: cfg.name, lat: +src.origin.lat.toFixed(7), lon: +src.origin.lon.toFixed(7), hw, gap: r1(gap), len: Math.round(loopWay.lengthM),
    credit: '© OpenStreetMap contributors', osmWay: loopWay.id,
    line: flat(loop), lanes, pads, roads, parking, water, buildings,
  });
  console.log(`${cfg.id}: loop way ${loopWay.id} ${Math.round(loopWay.lengthM)} m (${loop.length} pts), min gap ${gap.toFixed(1)} m → hw ${hw}, lanes ${lanes.length}, pads ${pads.length}, roads ${roads.length}, parking ${parking.length}, water ${water.length}, buildings ${buildings.length} [${buildings.map((b) => (b.name || b.k) + ' ' + b.h + 'm').join(', ')}]`);
}
const out = path.join(here, '..', 'data', 'venues.js');
fs.writeFileSync(out, `// 자동 생성: tools/build-venues.mjs — 직접 수정하지 마세요\n// 등록 서킷의 실제 선형·건물. 좌표는 (lat, lon)을 원점으로 한 m(동, 북). 지도 데이터 © OpenStreetMap contributors (ODbL)\nwindow.VENUES = ${JSON.stringify(result)};\n`);
console.log(out + ': ' + fs.statSync(out).size + ' bytes');
