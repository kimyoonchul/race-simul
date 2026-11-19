// HUD: 계기판·랩 목록·미니맵·타임라인·배너. DOM/캔버스만 다루고 재생 상태는 app.js가 넘겨줍니다.
(function (root) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S, cb, cache = {}, mini = {}, tl = {}, lapSpeed = [], ggTrail = [], bannerTimer = 0, theme = 'z4';
  var NU = 300;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fmtLap(t, d) { d = d == null ? 2 : d; var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(d); }
  function fmtClock(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function set(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
  function cls(id, v) { if (cache['c:' + id] !== v) { cache['c:' + id] = v; $(id).setAttribute('class', v); } }
  function css(name) { return getComputedStyle($('app')).getPropertyValue(name).trim(); }
  function speedColor(v, lo, hi) { var f = clamp((v - lo) / (hi - lo), 0, 1); return 'hsl(' + (225 - 225 * f) + ',90%,' + (52 + 8 * Math.sin(f * 3.14)) + '%)'; }

  // ── 게이지(크로노그래프풍 눈금 다이얼) ───────────────────────────
  // 각도는 SVG 기준(+x에서 시계 방향). sweep이 음수면 반시계.
  // 눈금은 호에 stroke-dasharray를 걸어 그립니다. 값 호도 같은 간격이라 지나온 눈금만 켜집니다.
  var CX = 100, CY = 104, R_TICK = 85.5;
  var GAUGES = {
    z4: { tach: { a0: 150, sweep: 240 } },
    m340i: { tach: { a0: 60, sweep: -210 }, speedo: { a0: 120, sweep: 210, max: 280 } },
    stinger: { tach: { a0: 135, sweep: 270 } },
  };
  var REG = { a0: 135, sweep: 270 }, REGS = [['rThr', 'THR'], ['rBrk', 'BRK'], ['rDsc', 'DISC']]; // 보조 다이얼
  var tach = GAUGES.z4.tach, speedo = null;
  function pt(a, r, cx, cy) { var rad = a * Math.PI / 180; return ((cx == null ? CX : cx) + r * Math.cos(rad)).toFixed(2) + ' ' + ((cy == null ? CY : cy) + r * Math.sin(rad)).toFixed(2); }
  function arcLen(g, r) { return r * Math.abs(g.sweep) * Math.PI / 180; }
  function arc(g, f0, f1, r, cx, cy) {
    if (f1 < f0 + 0.001) f1 = f0 + 0.001;
    var a0 = g.a0 + g.sweep * f0, a1 = g.a0 + g.sweep * f1;
    return 'M' + pt(a0, r, cx, cy) + ' A' + r + ' ' + r + ' 0 ' + (Math.abs(a1 - a0) > 180 ? 1 : 0) + ' ' + (g.sweep > 0 ? 1 : 0) + ' ' + pt(a1, r, cx, cy);
  }
  // 눈금 고리: 전체 눈금을 n등분한 간격으로 폭 tw인 눈금을 f0부터 끝까지. 첫 눈금이 f0 위에 오도록 호를 눈금 반폭만큼 앞에서 시작합니다.
  function ticks(id, g, f0, r, sw, n, tw, cx, cy) {
    var el = $(id), L = arcLen(g, r), e = tw / 2 / L;
    el.setAttribute('d', arc(g, f0 - e, 1 + e, r, cx, cy));
    el.setAttribute('stroke-width', sw);
    el.setAttribute('stroke-dasharray', tw + ' ' + (L / n - tw).toFixed(3));
  }
  // 값 호(켜지는 눈금)의 간격을 맞춰 두고, 시작 보정값을 돌려줍니다
  function litTicks(id, g, r, sw, n, tw) {
    var el = $(id), L = arcLen(g, r);
    el.setAttribute('stroke-width', sw); el.setAttribute('stroke-dasharray', tw + ' ' + (L / n - tw).toFixed(3));
    return tw / 2 / L;
  }
  function numbers(gid, g, max, step, div) {
    var grp = $(gid); grp.innerHTML = '';
    for (var k = 0; k <= max; k += step) {
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'text'), p = pt(g.a0 + g.sweep * (k / max), 63.5).split(' ');
      t.setAttribute('x', p[0]); t.setAttribute('y', p[1]); t.textContent = k / div; grp.appendChild(t);
    }
  }
  // 큰 다이얼 하나: 테두리 + 잔눈금(nMin) + 중간 눈금(nMid) + 굵은 눈금(nMaj)
  function dial(p, g, nMin, nMid, nMaj) {
    $(p + 'Bez').setAttribute('d', arc(g, 0, 1, 94));
    ticks(p + 'Trk', g, 0, R_TICK, 9, nMin, 1.1);
    ticks(p + 'Mid', g, 0, 84, 12, nMid, 1.4);
    ticks(p + 'Maj', g, 0, 82.5, 15, nMaj, 2);
    g.e = litTicks(p + 'Val', g, R_TICK, 9, nMin, 1.8);
  }
  function regSvg(id, name) {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="face" cx="32" cy="32" r="30.5"/>' +
      '<path class="trk" id="' + id + 'T"/><path class="val" id="' + id + 'V"/><path class="maj" id="' + id + 'M"/>' +
      '<text class="nm" x="32" y="24.5">' + name + '</text><text class="nv" id="' + id + 'N" x="32" y="59"></text>' +
      '<g class="hand" id="' + id + 'H"><line x1="26" y1="32" x2="56.5" y2="32"/><circle cx="32" cy="32" r="2.6"/></g></svg>';
  }
  function buildGauges() {
    var cfg = GAUGES[theme] || GAUGES.z4, red = S.car.redline;
    tach = cfg.tach; tach.max = Math.ceil((red + 500) / 1000) * 1000;
    dial('t', tach, tach.max / 100, tach.max / 500, tach.max / 1000);        // 100rpm 잔눈금, 500·1000rpm 굵은 눈금
    ticks('tRed', tach, red / tach.max, R_TICK, 9, tach.max / 100, 1.8);
    $('tRedB').setAttribute('d', arc(tach, red / tach.max, 1, 91.6));
    numbers('tNums', tach, tach.max, 1000, 1000);
    speedo = cfg.speedo || null;
    if (speedo) { dial('s', speedo, speedo.max / 5, speedo.max / 20, speedo.max / 40); numbers('sNums', speedo, speedo.max, 40, 1); } // 5km/h 잔눈금
    REGS.forEach(function (d) {
      $(d[0]).innerHTML = regSvg(d[0], d[1]);
      ticks(d[0] + 'T', REG, 0, 26, 5, 20, 0.9, 32, 32);
      ticks(d[0] + 'M', REG, 0, 25, 7, 4, 1.5, 32, 32);
      REG.e = litTicks(d[0] + 'V', REG, 26, 5, 20, 1.5);
    });
    var sh = $('shift'); sh.innerHTML = '';
    for (var k = 0; k < 14; k++) sh.appendChild(document.createElement('i'));
    cache.lit = -1;
  }
  // 보조 다이얼 값 갱신: 바뀔 때만 SVG 속성을 씁니다
  function reg(id, f, txt) {
    var q = Math.round(clamp(f, 0, 1) * 250);
    if (cache['r:' + id] !== q) {
      cache['r:' + id] = q;
      $(id + 'V').setAttribute('d', arc(REG, -REG.e, q / 250, 26, 32, 32));
      $(id + 'H').setAttribute('transform', 'rotate(' + (REG.a0 + REG.sweep * q / 250).toFixed(1) + ' 32 32)');
    }
    set(id + 'N', txt);
  }

  // ── 미니맵 ───────────────────────────────────────────────────────
  function buildMinimap() {
    var cv = $('minimap'), R = S.ref, pad = 20, i;
    var xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (i = 0; i < R.n; i++) { xmin = Math.min(xmin, R.x[i]); xmax = Math.max(xmax, R.x[i]); ymin = Math.min(ymin, R.y[i]); ymax = Math.max(ymax, R.y[i]); }
    var W = cv.width, sc0 = (W - 2 * pad) / (xmax - xmin);
    var H = Math.round(clamp((ymax - ymin) * sc0 + 2 * pad, W * 0.6, W * 1.9));
    cv.height = H;
    var sc = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (ymax - ymin));
    var ox = (W - (xmax - xmin) * sc) / 2, oy = (H - (ymax - ymin) * sc) / 2;
    mini.px = function (x) { return ox + (x - xmin) * sc; };
    mini.py = function (y) { return H - oy - (y - ymin) * sc; };
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    var g = off.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 13; g.beginPath();
    for (i = 0; i <= R.n; i++) { var m = i % R.n; if (i) g.lineTo(mini.px(R.x[m]), mini.py(R.y[m])); else g.moveTo(mini.px(R.x[m]), mini.py(R.y[m])); }
    g.stroke();
    var lo = Infinity, hi = 0; for (i = 0; i < R.n; i++) { lo = Math.min(lo, R.v[i]); hi = Math.max(hi, R.v[i]); }
    g.lineWidth = 5;
    for (i = 0; i < R.n; i += 4) {
      var a = i, b = Math.min(R.n, i + 5) % R.n;
      g.strokeStyle = speedColor(R.v[a], lo, hi); g.beginPath(); g.moveTo(mini.px(R.x[a]), mini.py(R.y[a])); g.lineTo(mini.px(R.x[b]), mini.py(R.y[b])); g.stroke();
    }
    function tick(u, color, len) {
      var m2 = Math.round(u * R.n) % R.n, x = mini.px(R.x[m2]), y = mini.py(R.y[m2]);
      g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.moveTo(x - R.nx[m2] * len, y + R.ny[m2] * len); g.lineTo(x + R.nx[m2] * len, y - R.ny[m2] * len); g.stroke();
    }
    tick(0, '#ffffff', 13); S.splitU.forEach(function (u) { tick(u, '#7fd0ff', 10); });
    g.font = '600 19px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,214,110,0.9)';
    var off2 = 26 / sc * 0.6;
    S.corners.forEach(function (c) {
      var m3 = Math.round(c.uApex * R.n) % R.n, side = c.dir === 'L' ? -1 : 1;
      g.fillText(c.name.slice(1), mini.px(R.x[m3] + R.nx[m3] * side * off2), mini.py(R.y[m3] + R.ny[m3] * side * off2));
    });
    mini.bg = off; mini.ctx = cv.getContext('2d'); mini.W = W; mini.H = H;
  }
  function drawMinimap(st) {
    var g = mini.ctx; g.clearRect(0, 0, mini.W, mini.H); g.drawImage(mini.bg, 0, 0);
    if (st.ghost) { g.fillStyle = css('--violet'); g.beginPath(); g.arc(mini.px(st.ghost.x), mini.py(st.ghost.y), 8, 0, 6.3); g.fill(); }
    var x = mini.px(st.x), y = mini.py(st.y);
    g.save(); g.translate(x, y); g.rotate(-st.hd);
    g.fillStyle = '#fff'; g.strokeStyle = '#06080b'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(17, 0); g.lineTo(-10, 10); g.lineTo(-5, 0); g.lineTo(-10, -10); g.closePath(); g.stroke(); g.fill(); g.restore();
  }

  // ── 타임라인 ─────────────────────────────────────────────────────
  function buildTimeline() {
    var cv = $('timeline'), W = cv.width, H = cv.height, off = document.createElement('canvas'); off.width = W; off.height = H;
    var g = off.getContext('2d'), T = S.duration, i;
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, W, H);
    var colors = { push: css('--red'), cool: '#7fd0ff', warm: css('--amber') };
    S.laps.forEach(function (l, j) {
      var x0 = l.t0 / T * W, x1 = l.t1 / T * W;
      g.globalAlpha = j === S.best ? 0.5 : 0.26; g.fillStyle = j === S.best ? css('--violet') : colors[l.kind]; g.fillRect(x0 + 1, 0, x1 - x0 - 2, H);
      g.globalAlpha = 1; g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '600 22px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textBaseline = 'top';
      if (x1 - x0 > 26) g.fillText(l.n, x0 + 6, 3);
    });
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(0, H);
    var top = Math.max(1, S.topSpeed / 3.6);
    for (i = 0; i <= W; i += 2) { var k = Math.min(S.count - 1, Math.round(i / W * (S.count - 1))); g.lineTo(i, H - (S.v[k] / top) * (H - 22)); }
    g.lineTo(W, H); g.closePath(); g.fill();
    tl.bg = off; tl.ctx = cv.getContext('2d'); tl.W = W; tl.H = H;
  }
  function drawTimeline(t) {
    var g = tl.ctx, x = t / S.duration * tl.W;
    g.clearRect(0, 0, tl.W, tl.H); g.drawImage(tl.bg, 0, 0);
    g.fillStyle = 'rgba(6,8,11,0.45)'; g.fillRect(x, 0, tl.W - x, tl.H);
    g.fillStyle = '#fff'; g.fillRect(x - 1.5, 0, 3, tl.H);
  }

  // ── 속도 트레이스(현재 랩 vs 베스트) ─────────────────────────────
  function buildLapSpeed() {
    lapSpeed = S.laps.map(function (l) {
      var a = new Float32Array(NU + 1), NQ = l.tAtU.length - 1;
      for (var q = 0; q <= NU; q++) {
        var f = q / NU * NQ, i0 = Math.floor(f), i1 = Math.min(NQ, i0 + 1), t = l.t0 + l.tAtU[i0] + (l.tAtU[i1] - l.tAtU[i0]) * (f - i0);
        a[q] = S.v[Math.min(S.count - 1, Math.round(t * S.hz))] * 3.6;
      }
      return a;
    });
  }
  function drawTrace(st) {
    var cv = $('trace'); if (cv.offsetParent === null) return;
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, top = Math.max(50, Math.ceil(S.topSpeed / 50) * 50), padL = 46, padB = 20;
    var X = function (u) { return padL + u * (W - padL - 6); }, Y = function (v) { return (H - padB) - v / top * (H - padB - 8); };
    g.clearRect(0, 0, W, H);
    g.font = '600 17px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textBaseline = 'middle';
    S.corners.forEach(function (c) {
      if (c.u1 < c.u0) return;
      g.fillStyle = 'rgba(255,214,110,0.08)'; g.fillRect(X(c.u0), 0, X(c.u1) - X(c.u0), H - padB);
      g.fillStyle = 'rgba(255,214,110,0.75)'; g.textAlign = 'center'; g.fillText(c.name, X(c.uApex), H - 9);
    });
    g.textAlign = 'right'; g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 1; g.fillStyle = 'rgba(147,160,176,0.9)';
    for (var v = 50; v <= top; v += 50) { g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(W, Y(v)); g.stroke(); g.fillText(v, padL - 8, Y(v)); }
    S.splitU.forEach(function (u) { g.strokeStyle = 'rgba(127,208,255,0.45)'; g.beginPath(); g.moveTo(X(u), 0); g.lineTo(X(u), H - padB); g.stroke(); });
    function line(arr, upto, color, lw) {
      g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; g.beginPath();
      var n = Math.max(1, Math.round(upto * NU));
      for (var q = 0; q <= n; q++) { if (q) g.lineTo(X(q / NU), Y(arr[q])); else g.moveTo(X(0), Y(arr[0])); }
      g.stroke();
    }
    line(lapSpeed[S.best], 1, css('--violet'), 2.5);
    if (st.lap >= 0 && st.lap !== S.best) line(lapSpeed[st.lap], st.u, '#ffffff', 3);
    var cx = X(clamp(((st.u % 1) + 1) % 1, 0, 1));
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H - padB); g.stroke();
  }

  // ── G-G ──────────────────────────────────────────────────────────
  // 점은 몸이 쏠리는 쪽으로 움직입니다: 좌회전이면 오른쪽(aLat +는 좌회전), 제동이면 위(앞), 가속이면 아래(뒤).
  // 눈금 고리·원·글자는 한 번만 그려 두고 매 프레임 복사합니다.
  var ggBg = null;
  function ggBackground(W) {
    var b = document.createElement('canvas'); b.width = b.height = W;
    var g = b.getContext('2d'), c = W / 2, sc = (W / 2 - 20) / 1.3, i, a, k, d;
    for (i = 0; i < 72; i++) { // 바깥 눈금 고리: 5° 간격, 30°마다 길게
      a = i * Math.PI / 36; k = i % 6 === 0;
      g.strokeStyle = k ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.34)'; g.lineWidth = k ? 2.6 : 1.6;
      g.beginPath(); g.moveTo(c + Math.cos(a) * (c - (k ? 13 : 8)), c + Math.sin(a) * (c - (k ? 13 : 8))); g.lineTo(c + Math.cos(a) * (c - 1.5), c + Math.sin(a) * (c - 1.5)); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5;
    [0.5, 1.0].forEach(function (r) { g.beginPath(); g.arc(c, c, r * sc, 0, 6.3); g.stroke(); });
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,178,36,0.55)'; g.beginPath(); g.arc(c, c, 1.2 * sc, 0, 6.3); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.moveTo(c, c - 1.2 * sc); g.lineTo(c, c + 1.2 * sc); g.moveTo(c - 1.2 * sc, c); g.lineTo(c + 1.2 * sc, c); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.42)'; g.lineWidth = 1.4;
    for (i = -12; i <= 12; i++) { // 십자선 위 0.1g 눈금, 0.5g마다 길게
      if (!i) continue; k = i % 5 === 0 ? 7 : 3.5; d = i * 0.1 * sc;
      g.beginPath(); g.moveTo(c + d, c - k); g.lineTo(c + d, c + k); g.moveTo(c - k, c + d); g.lineTo(c + k, c + d); g.stroke();
    }
    g.fillStyle = 'rgba(165,177,192,0.95)'; g.font = '600 17px "Barlow Condensed", "Noto Sans KR", "Arial Narrow", sans-serif'; g.textAlign = 'center';
    g.fillText('제동', c, 28); g.fillText('가속', c, W - 15);
    g.save(); g.translate(27, c); g.rotate(-Math.PI / 2); g.fillText('우회전', 0, 0); g.restore();
    g.save(); g.translate(W - 27, c); g.rotate(Math.PI / 2); g.fillText('좌회전', 0, 0); g.restore();
    return { cv: b, sc: sc, ice: css('--ice') };
  }
  function drawGG(st) {
    var cv = $('gg'); if (cv.offsetParent === null) return;
    var g = cv.getContext('2d'), W = cv.width, c = W / 2, i;
    if (!ggBg) ggBg = ggBackground(W);
    var sc = ggBg.sc;
    g.clearRect(0, 0, W, W); g.drawImage(ggBg.cv, 0, 0);
    ggTrail.push([st.aLat, st.aLong]); if (ggTrail.length > 46) ggTrail.shift();
    g.strokeStyle = ggBg.ice; g.lineWidth = 3;
    for (i = 1; i < ggTrail.length; i++) {
      g.globalAlpha = i / ggTrail.length * 0.75;
      g.beginPath(); g.moveTo(c + ggTrail[i - 1][0] * sc, c + ggTrail[i - 1][1] * sc); g.lineTo(c + ggTrail[i][0] * sc, c + ggTrail[i][1] * sc); g.stroke();
    }
    g.globalAlpha = 1;
    var x = c + st.aLat * sc, y = c + st.aLong * sc;
    g.fillStyle = st.aLong < -0.15 ? css('--red') : '#fff'; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.fill();
    g.strokeStyle = '#06080b'; g.lineWidth = 2; g.stroke();
  }

  // ── 초기화 ───────────────────────────────────────────────────────
  function init(session, callbacks, spec) {
    S = session; cb = callbacks; cache = {}; ggTrail = []; ggBg = null;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ggBg = null; }); // 글꼴이 늦게 오면 바탕을 다시 그림
    theme = spec.cluster;
    $('app').setAttribute('data-cluster', theme);
    $('model').innerHTML = spec.brand[0] + ' <b>' + spec.brand[1] + '</b>';
    Array.prototype.forEach.call($('cars').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.car === spec.id)); });
    var d = S.meta.startUtc ? new Date(S.meta.startUtc) : null;
    set('venue', (S.meta.venue || 'SESSION').toUpperCase());
    set('date', d && !isNaN(d) ? d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '') + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : (S.meta.source || ''));
    buildGauges(); buildMinimap(); buildTimeline(); buildLapSpeed();
    set('ttot', fmtClock(S.duration));
    set('lapsum', S.laps.length + ' LAPS');
    set('theo', fmtLap(S.stats.theoretical)); set('cons', '±' + S.stats.consistency.toFixed(2) + 's');
    set('repairN', S.repairedSeconds);

    var list = $('laplist'); list.innerHTML = '';
    var bt = S.laps[S.best].time, worst = Math.max.apply(null, S.laps.map(function (l) { return l.time; }));
    S.laps.forEach(function (l, j) {
      var b = document.createElement('button');
      b.className = 'lap ' + l.kind + (j === S.best ? ' best' : ''); b.id = 'lap' + j;
      b.title = l.sectors.map(function (x, k) { return 'S' + (k + 1) + ' ' + x.toFixed(2); }).join(' · ') + ' — 최고 ' + l.vmax.toFixed(0) + 'km/h' + (l.est ? ' — 출발선 통과 시각 추정(GPS 끊김)' : '');
      b.innerHTML = '<span class="n">' + l.n + '</span><span class="tm">' + (l.est ? '≈' : '') + fmtLap(l.time) + '</span><span class="bar"><i style="width:' + (100 - (l.time - bt) / Math.max(0.01, worst - bt) * 82).toFixed(0) + '%"></i></span><span class="gap">' + (j === S.best ? 'BEST' : '+' + (l.time - bt).toFixed(2)) + '</span>';
      b.addEventListener('click', function () { cb.seekLap(j); });
      list.appendChild(b);
    });
    buildReport(spec);
  }

  function buildReport(spec) {
    var b = S.laps[S.best], st = S.stats, h = '';
    function stat(v, unit, l) { return '<div class="stat"><div class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</div><div class="l">' + l + '</div></div>'; }
    h += '<h2>세션 리포트</h2><p>' + (S.meta.venue || '') + ' · ' + spec.name + ' · 타임드 랩 ' + S.laps.length + '개 · 트랙 주행 ' + st.trackKm.toFixed(1) + 'km</p><div class="stats">';
    h += stat(fmtLap(b.time), '', '베스트 랩 (LAP ' + b.n + ')');
    h += stat(fmtLap(st.theoretical), '', '이론 베스트 (섹터 최고 합)');
    h += stat(S.topSpeed.toFixed(0), 'km/h', '최고 속도 (GPS)');
    h += stat('±' + st.consistency.toFixed(2), 's', '푸시 랩 ' + st.pushCount + '개 편차 (평균 ' + fmtLap(st.pushMean) + ')');
    h += stat(st.maxLatG.toFixed(2), 'g', '최대 횡가속');
    h += stat(st.maxBrakeG.toFixed(2), 'g', '최대 감속');
    h += stat(st.maxBrakeT.toFixed(0), '°C', '디스크 최고 온도');
    h += '</div><h3>LAPS</h3><div class="tblwrap"><table class="ct"><tr><th>LAP</th><th>TIME</th><th>GAP</th>' + b.sectors.map(function (_, k) { return '<th>S' + (k + 1) + '</th>'; }).join('') + '<th>최고 km/h</th><th>구분</th></tr>';
    var kindName = { push: 'PUSH', cool: 'COOL DOWN', warm: 'WARM UP' };
    S.laps.forEach(function (l, j) {
      h += '<tr' + (j === S.best ? ' style="color:var(--violet)"' : '') + '><td>' + l.n + '</td><td>' + (l.est ? '≈' : '') + fmtLap(l.time) + '</td><td>' + (j === S.best ? '—' : '+' + (l.time - b.time).toFixed(2)) + '</td>' + l.sectors.map(function (x, k) { return '<td' + (x === S.bestSectors[k] ? ' style="color:var(--violet)"' : '') + '>' + x.toFixed(2) + '</td>'; }).join('') + '<td>' + l.vmax.toFixed(0) + '</td><td>' + kindName[l.kind] + '</td></tr>';
    });
    h += '</table></div>';
    if (S.corners.length) {
      h += '<h3>코너별 최저 속도 (km/h) — 번호는 GPS 주행선 자동 검출</h3><div class="tblwrap"><table class="ct"><tr><th>코너</th><th>방향</th><th>베스트랩</th><th>세션 최고</th><th>차이</th></tr>';
      S.corners.forEach(function (c) {
        var m = c.min[S.best]; if (!(m === m)) return;
        h += '<tr><td>' + c.name + '</td><td>' + (c.dir === 'L' ? '좌' : '우') + ' ' + c.turnDeg.toFixed(0) + '°</td><td>' + m.toFixed(0) + '</td><td>' + c.bestMin.toFixed(0) + '</td><td style="color:' + (c.bestMin - m > 3 ? 'var(--amber)' : 'var(--green)') + '">' + (c.bestMin - m > 0.5 ? '−' + (c.bestMin - m).toFixed(0) : '최고') + '</td></tr>';
      });
      h += '</table></div>';
    }
    h += '<p style="margin-top:14px;color:var(--dim)">GPS 기록 기준입니다. 섹터·코너 속도에는 ±수 km/h 오차가 있고, 추정 항목은 선택한 차량(' + spec.name + ') 제원으로 계산했습니다.</p>';
    $('reportBody').innerHTML = h;
  }

  var KIND = { push: ['PUSH LAP', '--red'], cool: ['COOL DOWN', '--ice'], warm: ['WARM UP', '--amber'], out: ['OUT LAP', '--amber'], 'in': ['IN LAP', '--ice'], pit: ['PADDOCK', '--ice'] };
  function setKind(kind) {
    if (cache.kind === kind) return; cache.kind = kind;
    $('lapkind').textContent = KIND[kind][0];
    $('app').style.setProperty('--accent', 'var(' + KIND[kind][1] + ')');
    $('app').classList.toggle('mode-cool', kind === 'cool' || kind === 'in');
  }

  function banner(c, k, t, s, big, ms) {
    var el = $('banner');
    el.innerHTML = '<div class="bn ' + c + '"><div><div class="k">' + k + '</div><div class="t">' + t + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div><div class="big">' + (big || '') + '</div></div>';
    el.className = ''; void el.offsetWidth; el.className = 'show';
    clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { el.className = 'hide'; }, ms || 3600);
  }
  function clearBanner() { clearTimeout(bannerTimer); $('banner').className = ''; }
  function callout(html) { if (cache.callout !== html) { cache.callout = html; $('callout').innerHTML = html; } }

  function frame(st) {
    var kmh = Math.round(st.v * 3.6), car = S.car, red = car.redline;
    set('spd', kmh); set('spd2', kmh); set('spdIn', kmh);
    set('gear', st.v < 0.3 ? 'P' : String(st.gear));
    set('rpmnum', (Math.round(st.rpm / 10) * 10).toLocaleString('en-US'));
    // 바늘은 transform 속성 하나로만 돌립니다(CSS transform-origin을 같이 쓰면 중심이 두 번 적용돼 바늘이 계기판 밖으로 나감)
    var fq = Math.round(clamp(st.rpm / tach.max, 0, 1) * 1000);
    if (cache.tf !== fq) {
      cache.tf = fq;
      $('tVal').setAttribute('d', arc(tach, -tach.e, fq / 1000, R_TICK));
      $('tNeedle').setAttribute('transform', 'rotate(' + (tach.a0 + tach.sweep * fq / 1000).toFixed(2) + ' ' + CX + ' ' + CY + ')');
      if (theme === 'stinger') $('tGlow').style.opacity = (0.35 + 0.65 * fq / 1000).toFixed(2);
    }
    cls('tVal', st.rpm > red - 600 ? 'val hot' : 'val');
    if (theme === 'stinger') {
      var w = st.rpm * Math.PI / 30, tq = st.thr * Math.min(car.torqueNm || 500, car.powerW / Math.max(w, 60));
      set('torque', Math.round(tq / 5) * 5);
      set('boost', Math.abs(st.thr * clamp((st.rpm - 1300) / 1500, 0, 1) * 1.05).toFixed(2)); // abs: -0.00 표기 방지
    }
    if (speedo) {
      var sq = Math.round(clamp(st.v * 3.6 / speedo.max, 0, 1) * 1000);
      if (cache.sf !== sq) {
        cache.sf = sq;
        $('sVal').setAttribute('d', arc(speedo, -speedo.e, sq / 1000, R_TICK));
        $('sNeedle').setAttribute('transform', 'rotate(' + (speedo.a0 + speedo.sweep * sq / 1000).toFixed(2) + ' ' + CX + ' ' + CY + ')');
      }
    }
    var leds = $('shift').children, lit = clamp(Math.ceil((st.rpm - (red - 2400)) / 2200 * 14), 0, 14), flash = st.rpm > red - 260 && (st.wall * 12 | 0) % 2 === 0;
    if (cache.lit !== lit) { cache.lit = lit; for (var i = 0; i < 14; i++) leds[i].className = i < lit ? (i < 6 ? 'g' : i < 10 ? 'y' : 'r') : ''; }
    cls('shift', flash ? 'flash' : '');

    reg('rThr', st.thr, Math.round(st.thr * 100));
    reg('rBrk', st.brk, Math.round(st.brk * 100));
    reg('rDsc', st.brakeT / 600, Math.round(st.brakeT / 5) * 5 + '°');
    // 랩 스톱워치 초침: 1/5초씩 끊어 움직임(1.2°)
    var chr = st.lap >= 0 ? Math.floor((st.t - S.laps[st.lap].t0) * 5) % 300 : 0;
    if (cache.chr !== chr) { cache.chr = chr; $('chronoH').setAttribute('transform', 'rotate(' + (chr * 1.2).toFixed(1) + ' 24 24)'); }

    // 랩 타이머·델타·섹터
    if (st.lap >= 0) {
      var l = S.laps[st.lap];
      set('lapno', 'LAP ' + l.n + '/' + S.laps.length);
      set('laptime', fmtLap(st.t - l.t0, 1));
      if (st.lap === S.best) { set('delta', 'BEST'); cls('delta', 'neg'); }
      else { set('delta', (st.delta >= 0 ? '+' : '−') + Math.abs(st.delta).toFixed(2)); cls('delta', st.delta >= 0 ? 'pos' : 'neg'); }
      for (var si = 0; si < 3; si++) {
        var id = 'sec' + si, has = si < l.sectors.length, done = has && st.t >= l.cuts[si + 1], live = has && st.t >= l.cuts[si] && !done;
        if (!has) { set(id, ''); cls(id, ''); }
        else if (done) { set(id, l.sectors[si].toFixed(2)); cls(id, l.sectorFlag[si]); }
        else if (live) { set(id, (st.t - l.cuts[si]).toFixed(1)); cls(id, 'live'); }
        else { set(id, 'S' + (si + 1)); cls(id, ''); }
      }
      setKind(l.kind);
    } else {
      var out = st.t < S.laps[0].t0, on = st.w > 0.5;
      set('lapno', on ? (out ? 'OUT LAP' : 'IN LAP') : 'PADDOCK'); set('laptime', '–:––.–'); set('delta', ''); cls('delta', '');
      for (var s2 = 0; s2 < 3; s2++) { set('sec' + s2, 'S' + (s2 + 1)); cls('sec' + s2, ''); }
      setKind(on ? (out ? 'out' : 'in') : 'pit');
    }
    if (cache.now !== st.lap) {
      if (cache.now >= 0 && $('lap' + cache.now)) $('lap' + cache.now).classList.remove('now');
      if (st.lap >= 0) { var row = $('lap' + st.lap); row.classList.add('now'); row.parentNode.scrollTop = Math.max(0, row.offsetTop - row.parentNode.clientHeight / 2); }
      cache.now = st.lap;
    }

    // G·하중(정적 하중 대비 %)
    set('ggnum', '횡 ' + Math.abs(st.aLat).toFixed(2) + ' · 종 ' + (st.aLong >= 0 ? '+' : '−') + Math.abs(st.aLong).toFixed(2) + ' g');
    var dl = st.aLong * (car.hcg || 0.47) / (car.wb || 2.47), dt = st.aLat * (car.hcg || 0.47) / (car.track || 1.61);
    var loads = { tFL: 1 - 2 * dl - 2 * dt, tFR: 1 - 2 * dl + 2 * dt, tRL: 1 + 2 * dl - 2 * dt, tRR: 1 + 2 * dl + 2 * dt };
    for (var key in loads) {
      var p = clamp(loads[key], 0, 2), elT = $(key);
      elT.firstChild.style.height = (p * 50).toFixed(0) + '%';
      elT.firstChild.style.background = p > 1.45 ? css('--red') : p > 1.2 ? css('--amber') : css('--ice');
      var txt = Math.round(p * 100); if (cache[key] !== txt) { cache[key] = txt; elT.lastChild.textContent = txt; }
    }

    set('tnow', fmtClock(st.t));
    $('speedfx').style.opacity = clamp((st.v * 3.6 - 120) / 80, 0, 1).toFixed(2);
    // 강한 제동에서는 화면 가장자리가 붉어집니다(가속 연출은 fx.js)
    var bfx = clamp((-st.aLong - 0.2) / 0.45, 0, 1).toFixed(2);
    if (cache.brakefx !== bfx) { cache.brakefx = bfx; $('brakefx').style.opacity = bfx; }
    drawMinimap(st); drawTimeline(st.t); drawTrace(st); drawGG(st);
  }

  root.HUD = { init: init, frame: frame, banner: banner, clearBanner: clearBanner, callout: callout, fmtLap: fmtLap };
})(typeof self !== 'undefined' ? self : this);
