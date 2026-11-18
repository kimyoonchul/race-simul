// 텔레메트리 처리 결과 점검: node tools/check-telemetry.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Telemetry = require('../js/telemetry.js');
const window = {};
new Function('window', fs.readFileSync(path.join(here, '..', 'data', 'session.js'), 'utf8'))(window);

const t0 = performance.now();
const s = Telemetry.process(window.SESSION_RAW);
const ms = performance.now() - t0;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails.push(name); };

console.log(`processed ${s.count} samples in ${ms.toFixed(0)}ms, duration ${s.duration.toFixed(1)}s`);
console.log(`reference line ${s.ref.len.toFixed(0)}m, speed/geometry scale ${s.scale.toFixed(3)}, clean laps ${s.cleanLapCount}, repaired ${s.repairedSeconds}s`);
console.log(`split u: ${s.splitU.map((u) => u.toFixed(3)).join(', ')}  join ${s.tJoin.toFixed(1)}s exit ${s.tExit.toFixed(1)}s  top ${s.topSpeed.toFixed(1)}km/h @${s.tTop.toFixed(1)}s`);
for (const l of s.laps) {
  console.log(`  L${String(l.n).padStart(2)} ${fmt(l.time)} ${l.kind.padEnd(4)}${l.newBest ? '*' : ' '} len ${l.len.toFixed(0)}m  S ${l.sectors.map((x) => x.toFixed(2)).join(' / ')}  vmax ${l.vmax.toFixed(0)} vmin ${l.vmin.toFixed(0)}  latG ${l.maxLatG.toFixed(2)} brkG ${l.maxBrakeG.toFixed(2)} brakeT ${l.maxBrakeT.toFixed(0)}${l.n - 1 === s.best ? '  ← BEST' : ''}`);
}

check('15 laps', s.laps.length === 15, `${s.laps.length}`);
check('best lap 90.45s', Math.abs(s.laps[s.best].time - 90.45) < 0.06, s.laps[s.best].time.toFixed(2));
const lens = s.laps.map((l) => l.len);
check('lap lengths consistent (±2%)', (Math.max(...lens) - Math.min(...lens)) / s.lapMeters < 0.04, `${Math.min(...lens).toFixed(0)}..${Math.max(...lens).toFixed(0)}m`);

let mono = true;
for (let k = 1; k < s.count; k++) if (s.lapIdx[k] >= 0 && s.lapIdx[k] === s.lapIdx[k - 1] && s.u[k] < s.u[k - 1] - 1e-9) { mono = false; break; }
check('progress monotonic within laps', mono);

let maxJump = 0, kJ = 0;
for (let k = 1; k < s.count; k++) {
  const step = Math.hypot(s.x[k] - s.x[k - 1], s.y[k] - s.y[k - 1]);
  const exp = (s.v[k] + s.v[k - 1]) / 2 / s.hz;
  if (step - exp > maxJump) { maxJump = step - exp; kJ = k; }
}
check('no position jumps (>1m beyond speed)', maxJump < 1.0, `max excess ${maxJump.toFixed(2)}m at t=${(kJ / s.hz).toFixed(1)}s`);

let maxLat = 0, maxLong = 0, minLong = 0, maxRpm = 0, maxT = 0;
const gearTop = new Array(9).fill(0);
for (let k = 0; k < s.count; k++) {
  maxLat = Math.max(maxLat, Math.abs(s.aLat[k])); maxLong = Math.max(maxLong, s.aLong[k]); minLong = Math.min(minLong, s.aLong[k]);
  maxRpm = Math.max(maxRpm, s.rpm[k]); gearTop[s.gear[k]] = Math.max(gearTop[s.gear[k]], s.v[k] * 3.6); maxT = Math.max(maxT, s.brakeT[k]);
}
check('lateral g within ±1.25', maxLat < 1.25, maxLat.toFixed(2));
check('long g plausible', maxLong <= 0.9 && minLong >= -1.3, `${minLong.toFixed(2)} .. ${maxLong.toFixed(2)}`);
check('rpm at or under redline', maxRpm <= 7000, maxRpm.toFixed(0));
check('top speed matches GPS (197.2)', Math.abs(s.topSpeed - 197.2) < 3, s.topSpeed.toFixed(1));
console.log('  top speed per gear:', gearTop.slice(1).map((x, i) => `${i + 1}:${x.toFixed(0)}`).join('  '));
const kT = Math.round(s.tTop * s.hz);
console.log(`  at top speed: gear ${s.gear[kT]} rpm ${s.rpm[kT].toFixed(0)};  brake temp max ${maxT.toFixed(0)}°C`);
console.log(`  shifts: ${Array.from(s.gear).reduce((n, g, i, a) => n + (i && g !== a[i - 1] ? 1 : 0), 0)};  access paths: ${s.access.map((p) => p.length + 'pts').join(', ')}`);
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
