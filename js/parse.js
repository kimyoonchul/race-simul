// 주행 기록 파일 → 세션 원시 데이터(1Hz 위치·속도 + 게이트/랩 통과 시각)
// 지원: RaceLogic/RaceChrono VBO, RaceChrono CSV v3, 위도·경도·속도 열이 있는 일반 CSV.
// 브라우저 안에서만 읽습니다(서버 전송 없음).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var r2 = function (n) { return Math.round(n * 100) / 100; };

  // 불규칙 표본(t 오름차순) → 1초 간격 선형 보간, 지역 평면 좌표(m)로 변환
  function finalize(rows, meta, gatesLL, crossingsAbs) {
    rows = rows.filter(function (r) { return isFinite(r.t) && isFinite(r.lat) && isFinite(r.lon) && isFinite(r.v) && (r.lat !== 0 || r.lon !== 0); });
    if (rows.length < 30) throw new Error('유효한 GPS 표본이 너무 적습니다.');
    var t0 = Math.ceil(rows[0].t - 1e-6), t1 = Math.floor(rows[rows.length - 1].t + 1e-6), n = t1 - t0 + 1;
    if (n < 60) throw new Error('기록이 너무 짧습니다(1분 미만).');
    var lat0 = 0, lon0 = 0, i, j = 0;
    for (i = 0; i < rows.length; i++) { lat0 += rows[i].lat; lon0 += rows[i].lon; }
    lat0 /= rows.length; lon0 /= rows.length;
    var mLon = 111320 * Math.cos(lat0 * Math.PI / 180), mLat = 110574;
    var x = [], y = [], v = [];
    for (i = 0; i < n; i++) {
      var t = t0 + i;
      while (j < rows.length - 2 && rows[j + 1].t < t) j++;
      var a = rows[j], b = rows[Math.min(rows.length - 1, j + 1)], f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      x.push(r2((a.lon + (b.lon - a.lon) * f - lon0) * mLon));
      y.push(r2((a.lat + (b.lat - a.lat) * f - lat0) * mLat));
      v.push(r2(a.v + (b.v - a.v) * f));
    }
    var out = { meta: meta, x: x, y: y, v: v, gates: [] };
    out.meta.samples = n;
    (gatesLL || []).forEach(function (g) {
      out.gates.push({ kind: g.kind, x: r2((g.lon - lon0) * mLon), y: r2((g.lat - lat0) * mLat), x2: r2((g.lon2 - lon0) * mLon), y2: r2((g.lat2 - lat0) * mLat) });
    });
    if (crossingsAbs && crossingsAbs.length >= 2) out.crossings = crossingsAbs.map(function (tc) { return tc - t0; });
    return out;
  }

  function parseVbo(text, name) {
    var lines = text.split(/\r?\n/), sec = {}, cur = null, i;
    for (i = 0; i < lines.length; i++) {
      var m = /^\[(.+)\]\s*$/.exec(lines[i]);
      if (m) { cur = m[1].toLowerCase(); sec[cur] = []; if (cur === 'data') { sec.dataStart = i + 1; break; } }
      else if (cur) sec[cur].push(lines[i]);
    }
    if (sec.dataStart == null) throw new Error('VBO 파일에 [data] 구간이 없습니다.');
    var cols = (sec['column names'] || []).join(' ').trim().split(/\s+/);
    var iT = cols.indexOf('time'), iLat = cols.indexOf('lat'), iLon = cols.indexOf('long'), iV = cols.indexOf('velocity');
    if (iT < 0 || iLat < 0 || iLon < 0 || iV < 0) throw new Error('VBO 열 이름(time/lat/long/velocity)을 찾지 못했습니다.');
    var tsec = function (s) { return (+s.slice(0, 2)) * 3600 + (+s.slice(2, 4)) * 60 + (+s.slice(4)); };
    var rows = [], prev = -1, day = 0;
    for (i = sec.dataStart; i < lines.length; i++) {
      var p = lines[i].trim().split(/\s+/);
      if (p.length <= Math.max(iT, iLat, iLon, iV)) continue;
      var t = tsec(p[iT]) + day; if (t < prev - 40000) { day += 86400; t += 86400; } prev = t;
      rows.push({ t: t, lat: +p[iLat] / 60, lon: -(+p[iLon]) / 60, v: +p[iV] }); // 분 단위, 경도는 서쪽이 +
    }
    var gates = [];
    (sec.laptiming || []).forEach(function (l) {
      var q = l.trim().split(/\s+/);
      if (q.length < 5 || !/^(start|split)/i.test(q[0])) return;
      gates.push({ kind: /^start/i.test(q[0]) ? 'Start' : 'Split', lon: -(+q[1]) / 60, lat: +q[2] / 60, lon2: -(+q[3]) / 60, lat2: +q[4] / 60 });
    });
    var c = /(\d\d)\/(\d\d)\/(\d{4})/.exec(lines[0] || ''), nm = (sec['session data'] || []).filter(function (l) { return /^name /.test(l); })[0];
    var t0 = Math.ceil(rows.length ? rows[0].t : 0), hh = Math.floor(t0 / 3600) % 24, mm = Math.floor(t0 % 3600 / 60), s2 = t0 % 60, pad = function (k) { return (k < 10 ? '0' : '') + k; };
    return finalize(rows, { venue: nm ? nm.slice(5).trim() : (name || 'Session').replace(/\.[^.]+$/, ''), startUtc: c ? c[3] + '-' + c[2] + '-' + c[1] + 'T' + pad(hh) + ':' + pad(mm) + ':' + pad(s2) + 'Z' : null, source: 'VBO' }, gates, null);
  }

  function splitCsv(line) {
    var out = [], cur = '', q = false, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line[i];
      if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out;
  }

  function parseRaceChronoCsv(text, name) {
    var lines = text.split(/\r?\n/), h = -1, i, title = null;
    for (i = 0; i < Math.min(lines.length, 40); i++) {
      if (/^Session title,/.test(lines[i])) title = splitCsv(lines[i])[1];
      if (/^timestamp,/.test(lines[i])) { h = i; break; }
    }
    if (h < 0) return null;
    var cols = splitCsv(lines[h]), iT = cols.indexOf('timestamp'), iLap = cols.indexOf('lap_number'), iLat = cols.indexOf('latitude'), iLon = cols.indexOf('longitude'), iV = cols.indexOf('speed');
    if (iLat < 0 || iLon < 0 || iV < 0) throw new Error('RaceChrono CSV에서 위치·속도 열을 찾지 못했습니다.');
    var rows = [], cross = [], lastLap = '';
    for (i = h + 1; i < lines.length; i++) {
      var p = lines[i].split(',');
      if (p.length <= iV || !/^\d/.test(p[iT])) continue; // 단위·출처 줄 건너뜀
      var t = +p[iT];
      rows.push({ t: t, lat: +p[iLat], lon: +p[iLon], v: +p[iV] * 3.6 });
      if (iLap >= 0 && p[iLap] !== '' && p[iLap] !== lastLap) { cross.push(t); lastLap = p[iLap]; }
    }
    return finalize(rows, { venue: title || (name || 'Session').replace(/\.[^.]+$/, ''), startUtc: rows.length ? new Date(Math.ceil(rows[0].t) * 1000).toISOString().replace('.000', '') : null, source: 'RaceChrono CSV' }, null, cross);
  }

  function parseGenericCsv(text, name) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); }), h = -1, i, cols;
    for (i = 0; i < Math.min(lines.length, 30); i++) { if (/lat/i.test(lines[i]) && /(lon|lng)/i.test(lines[i])) { h = i; break; } }
    if (h < 0) throw new Error('위도·경도 열이 있는 CSV가 아닙니다.');
    var sep = lines[h].indexOf(';') >= 0 && lines[h].indexOf(',') < 0 ? ';' : ',';
    cols = lines[h].split(sep).map(function (c) { return c.replace(/"/g, '').trim(); });
    function find(re) { for (var k = 0; k < cols.length; k++) if (re.test(cols[k])) return k; return -1; }
    var iLat = find(/lat/i), iLon = find(/(lon|lng)/i), iV = find(/(speed|velocity|^v$)/i), iT = find(/(^time|timestamp|elapsed|^t$)/i), iLap = find(/^lap/i);
    if (iV < 0) throw new Error('속도 열을 찾지 못했습니다.');
    var rows = [], cross = [], lastLap = null, vmax = 0;
    for (i = h + 1; i < lines.length; i++) {
      var p = lines[i].split(sep);
      var lat = parseFloat(p[iLat]), lon = parseFloat(p[iLon]), v = parseFloat(p[iV]);
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(v)) continue;
      var t = iT >= 0 ? parseFloat(p[iT]) : rows.length / 10;
      if (!isFinite(t)) continue;
      rows.push({ t: t, lat: lat, lon: lon, v: v }); if (v > vmax) vmax = v;
      if (iLap >= 0 && p[iLap] !== lastLap) { if (lastLap !== null) cross.push(t); lastLap = p[iLap]; }
    }
    if (!rows.length) throw new Error('CSV에서 표본을 읽지 못했습니다.');
    var head = cols[iV].toLowerCase(), k = /mph/.test(head) ? 1.609344 : /(km|kph)/.test(head) ? 1 : /m\/s|mps/.test(head) ? 3.6 : (vmax > 90 ? 1 : 3.6);
    var unix = rows[0].t > 1e9, ms = rows[0].t > 1e12;
    rows.forEach(function (r) { r.v *= k; if (ms) r.t /= 1000; });
    if (ms) cross = cross.map(function (c) { return c / 1000; });
    return finalize(rows, { venue: (name || 'Session').replace(/\.[^.]+$/, ''), startUtc: unix ? new Date(Math.ceil(rows[0].t) * 1000).toISOString().replace('.000', '') : null, source: 'CSV' }, null, cross);
  }

  function parse(text, name) {
    if (/\[data\]/i.test(text.slice(0, 20000)) && /\[column names\]/i.test(text.slice(0, 20000))) return parseVbo(text, name);
    return parseRaceChronoCsv(text, name) || parseGenericCsv(text, name);
  }

  return { parse: parse, vbo: parseVbo, raceChronoCsv: parseRaceChronoCsv, genericCsv: parseGenericCsv };
});
