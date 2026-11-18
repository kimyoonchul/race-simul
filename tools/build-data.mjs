// VBO(RaceChrono) → data/session.js 변환기
// 사용법: node tools/build-data.mjs <session.vbo> [출력경로]
// RaceChrono 폰 GPS는 1Hz 실측을 10Hz로 선형보간해 내보내므로, 정수 초 샘플(실측)만 추립니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const out = process.argv[3] || path.join(here, '..', 'data', 'session.js');
if (!src) { console.error('usage: node tools/build-data.mjs <file.vbo> [out.js]'); process.exit(1); }

const lines = fs.readFileSync(src, 'latin1').split(/\r?\n/);
const sec = (name) => lines.indexOf(`[${name}]`);
const tsec = (s) => (+s.slice(0, 2)) * 3600 + (+s.slice(2, 4)) * 60 + (+s.slice(4));

// VBO 좌표: 분 단위, 경도는 서쪽이 +
const toDeg = (latMin, lonMin) => ({ lat: latMin / 60, lon: -lonMin / 60 });

const created = /(\d\d)\/(\d\d)\/(\d{4}) at (\d\d):(\d\d):(\d\d)/.exec(lines[0]);
const nameLine = lines.slice(sec('session data') + 1).find((l) => l.startsWith('name '));

const rows = [];
for (let i = sec('data') + 1; i < lines.length; i++) {
  const p = lines[i].trim().split(/\s+/);
  if (p.length < 7) continue;
  const t = tsec(p[1]);
  if (Math.abs(t - Math.round(t)) > 1e-6) continue; // 보간 샘플 제외
  const { lat, lon } = toDeg(+p[2], +p[3]);
  rows.push({ t: Math.round(t), lat, lon, v: +p[4] });
}
for (let i = 1; i < rows.length; i++) {
  if (rows[i].t - rows[i - 1].t !== 1) throw new Error(`1Hz 샘플 누락: index ${i}`);
}

const lat0 = rows.reduce((s, r) => s + r.lat, 0) / rows.length;
const lon0 = rows.reduce((s, r) => s + r.lon, 0) / rows.length;
const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
const mPerLat = 110574;
const local = (lat, lon) => [(lon - lon0) * mPerLon, (lat - lat0) * mPerLat];
const r2 = (n) => Math.round(n * 100) / 100;

// [laptiming] 게이트: 첫 점 = 게이트 중심, 둘째 점 = 진행 반대 방향 기준점
const gates = [];
for (let i = sec('laptiming') + 1; i < lines.length && lines[i].trim(); i++) {
  const p = lines[i].trim().split(/\s+/);
  const a = toDeg(+p[2], +p[1]);
  const b = toDeg(+p[4], +p[3]);
  const la = local(a.lat, a.lon), lb = local(b.lat, b.lon);
  gates.push({ kind: p[0], x: r2(la[0]), y: r2(la[1]), x2: r2(lb[0]), y2: r2(lb[1]) });
}

const startUtc = created
  ? `${created[3]}-${created[2]}-${created[1]}T${String(Math.floor(rows[0].t / 3600)).padStart(2, '0')}:${String(Math.floor((rows[0].t % 3600) / 60)).padStart(2, '0')}:${String(rows[0].t % 60).padStart(2, '0')}Z`
  : null;

const data = {
  meta: {
    venue: nameLine ? nameLine.slice(5).trim() : 'Session',
    startUtc,
    source: 'RaceChrono · 폰 내장 GPS 1Hz',
    samples: rows.length,
    lat0: +lat0.toFixed(7), // 지역 좌표 원점(실제 지도 선형과 맞출 때 사용)
    lon0: +lon0.toFixed(7),
  },
  gates,
  x: rows.map((r) => r2(local(r.lat, r.lon)[0])), // 동쪽 +m
  y: rows.map((r) => r2(local(r.lat, r.lon)[1])), // 북쪽 +m
  v: rows.map((r) => r2(r.v)),                    // km/h
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// 자동 생성: tools/build-data.mjs — 직접 수정하지 마세요\nwindow.SESSION_RAW = ${JSON.stringify(data)};\n`);
console.log(`wrote ${out}: ${rows.length} samples (1Hz), ${gates.length} gates, start ${startUtc}`);
