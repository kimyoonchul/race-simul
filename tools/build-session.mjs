// 주행 기록(VBO / RaceChrono CSV v3 / 일반 CSV) → data/*.js 변환기. 브라우저와 같은 파서(js/parse.js)를 씁니다.
// 사용법: node tools/build-session.mjs <기록 파일> <출력 .js> <전역 변수 이름> [서킷 표시 이름]
//   예: node tools/build-session.mjs inje.csv data/session-inje.js SESSION_INJE "Inje Speedium"
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Parse = require(path.join(here, '..', 'js', 'parse.js'));
const [src, out, name, venue] = process.argv.slice(2);
if (!src || !out || !/^[A-Z_][A-Z0-9_]*$/.test(name || '')) { console.error('usage: node tools/build-session.mjs <file> <out.js> <GLOBAL_NAME> [venue]'); process.exit(1); }

const raw = Parse.parse(fs.readFileSync(src, 'utf8'), path.basename(src));
if (venue) raw.meta.venue = venue;
raw.meta.source = 'RaceChrono · 폰 내장 GPS 1Hz';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `// 자동 생성: tools/build-session.mjs — 직접 수정하지 마세요\nwindow.${name} = ${JSON.stringify(raw)};\n`);
console.log(`${out}: ${raw.x.length} samples, ${(raw.crossings || []).length} crossings, ${raw.gates.length} gates, origin ${raw.meta.lat0}, ${raw.meta.lon0}`);
