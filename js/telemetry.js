// 텔레메트리 처리: 1Hz GPS(위치·속도) → 20Hz 재생용 채널
// 실측: 시간·위치·속도. 그 외(G, RPM, 기어, 스로틀, 브레이크, 브레이크 온도)는 모두 속도·경로에서 계산한 추정값.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Telemetry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = 9.80665;
  var HZ = 20;

  // ── 차량 가정값(추정 채널 계산에만 사용) ─────────────────────────────
  // 기어비·종감속: ZF 8단(1단 5.25 / 2단 3.36 / 8단 0.64, 종감속 3.15)은 공개 제원으로 확인,
  // 중간 단수와 레드라인·질량·출력·공기저항은 가정값.
  var CAR = {
    gears: [5.25, 3.36, 2.172, 1.72, 1.316, 1.0, 0.822, 0.64],
    finalDrive: 3.154,
    tyreCirc: Math.PI * (19 * 0.0254 + 2 * 0.275 * 0.35) * 0.97, // 275/35R19, 구름반경 보정 3%
    redline: 7000,
    idle: 750,
    massKg: 1700,
    powerW: 285e3,
    cdA: 0.62,
    crr: 0.012,
    mu: 1.0,
    driveEff: 0.9,
    traction: 0.55, // 구동륜 접지 한계(후륜 0.55, 사륜 0.92)
    wb: 2.47, track: 1.61, hcg: 0.47, torqueNm: 500,
  };

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hermite(y0, y1, d0, d1, f) {
    var f2 = f * f, f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * y0 + (f3 - 2 * f2 + f) * d0 + (-2 * f3 + 3 * f2) * y1 + (f3 - f2) * d1;
  }
  function median(a) {
    var s = Array.prototype.slice.call(a).sort(function (p, q) { return p - q; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function box(src, half) { // 양쪽 half 샘플 이동평균
    var n = src.length, out = new Float64Array(n), acc = 0, cnt = 0, i, lo = 0, hi = -1;
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - half), b = Math.min(n - 1, i + half);
      while (hi < b) { hi++; acc += src[hi]; cnt++; }
      while (lo < a) { acc -= src[lo]; lo++; cnt--; }
      out[i] = acc / cnt;
    }
    return out;
  }
  function boxCircular(src, half) {
    var n = src.length, out = new Float64Array(n), i, j;
    for (i = 0; i < n; i++) {
      var s = 0;
      for (j = -half; j <= half; j++) s += src[(i + j + n) % n];
      out[i] = s / (2 * half + 1);
    }
    return out;
  }
  function resampleClosed(xs, ys, n) { // 닫힌 폴리라인 → 균일 호길이 n점
    var m = xs.length, cum = new Float64Array(m + 1), i;
    for (i = 0; i < m; i++) cum[i + 1] = cum[i] + Math.hypot(xs[(i + 1) % m] - xs[i], ys[(i + 1) % m] - ys[i]);
    var total = cum[m], ox = new Float64Array(n), oy = new Float64Array(n), j = 0;
    for (i = 0; i < n; i++) {
      var s = (i / n) * total;
      while (j < m - 1 && cum[j + 1] < s) j++;
      var f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]), b = (j + 1) % m;
      ox[i] = xs[j] + (xs[b] - xs[j]) * f; oy[i] = ys[j] + (ys[b] - ys[j]) * f;
    }
    return { x: ox, y: oy, len: total };
  }
  function gaussCircularVar(src, sigma) { // 위치별 σ(점 단위)가 다른 원형 가우시안
    var n = src.length, out = new Float64Array(n), i, j;
    for (i = 0; i < n; i++) {
      var sg = sigma[i], r = Math.ceil(sg * 3), acc = 0, ws = 0;
      for (j = -r; j <= r; j++) { var wgt = Math.exp(-0.5 * j * j / (sg * sg)); acc += wgt * src[((i + j) % n + n) % n]; ws += wgt; }
      out[i] = acc / ws;
    }
    return out;
  }
  function pchipSlopes(y) { // 단조 3차 보간 기울기
    var n = y.length, d = new Float64Array(n), i;
    d[0] = y[1] - y[0]; d[n - 1] = y[n - 1] - y[n - 2];
    for (i = 1; i < n - 1; i++) {
      var a = y[i] - y[i - 1], b = y[i + 1] - y[i];
      d[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    }
    return d;
  }
  function centralSlopes(y) {
    var n = y.length, d = new Float64Array(n), i;
    d[0] = y[1] - y[0]; d[n - 1] = y[n - 1] - y[n - 2];
    for (i = 1; i < n - 1; i++) d[i] = (y[i + 1] - y[i - 1]) / 2;
    return d;
  }

  var NR = 2400; // 기준선 점 수

  // 정류장 좌표(닫힌 곡선) → 평활된 기준선(직선은 강하게, 코너는 약하게)
  function headingOf(xs, ys, span) {
    var n = xs.length, h = new Float64Array(n);
    for (var q = 0; q < n; q++) h[q] = Math.atan2(ys[(q + span) % n] - ys[(q - span + n) % n], xs[(q + span) % n] - xs[(q - span + n) % n]);
    return h;
  }
  function curvatureOf(xs, ys, span, sp) {
    var h = headingOf(xs, ys, span), n = xs.length, c = new Float64Array(n);
    for (var q = 0; q < n; q++) c[q] = wrapPi(h[(q + span) % n] - h[(q - span + n) % n]) / (2 * span * sp);
    return c;
  }
  // 균일 간격 닫힌 곡선 rs → 기준선 구조체. (sx, sy)에 가장 가까운 점이 index 0(출발선)
  function finishRef(rs, spacing, sx, sy) {
    var bi0 = 0, bd0 = Infinity, m;
    for (m = 0; m < NR; m++) { var dd0 = Math.hypot(rs.x[m] - sx, rs.y[m] - sy); if (dd0 < bd0) { bd0 = dd0; bi0 = m; } }
    var x = Float64Array.from(rs.x, function (_, q) { return rs.x[(q + bi0) % NR]; });
    var y = Float64Array.from(rs.y, function (_, q) { return rs.y[(q + bi0) % NR]; });
    var hd = headingOf(x, y, 2);
    var k = boxCircular(curvatureOf(x, y, Math.max(2, Math.round(4 / spacing)), spacing), Math.round(3 / spacing));
    var nx = new Float64Array(NR), ny = new Float64Array(NR);
    for (m = 0; m < NR; m++) { nx[m] = -Math.sin(hd[m]); ny[m] = Math.cos(hd[m]); } // 진행방향 왼쪽
    return { n: NR, x: x, y: y, nx: nx, ny: ny, k: k, hd: hd, len: rs.len, spacing: spacing };
  }
  // 실제 서킷 중심선(지도 벡터, 닫힌 폴리라인 [x0,y0,x1,y1,…])을 기준선으로. 꺾인 선을 살짝 둥글립니다.
  function makeRefTruth(line, sx, sy, reverse) {
    var n = line.length >> 1, xs = new Float64Array(n), ys = new Float64Array(n), m;
    for (m = 0; m < n; m++) { var q = reverse ? n - 1 - m : m; xs[m] = line[q * 2]; ys[m] = line[q * 2 + 1]; }
    var rs = resampleClosed(xs, ys, NR), spacing = rs.len / NR, sig = new Float64Array(NR).fill(3.5 / spacing);
    rs = resampleClosed(gaussCircularVar(rs.x, sig), gaussCircularVar(rs.y, sig), NR); spacing = rs.len / NR;
    return finishRef(rs, spacing, sx, sy);
  }
  // 세션 원점(meta.lat0/lon0)에서 가까운 등록 서킷을 찾아, 그 지도 도형을 세션 지역 좌표(m)로 옮겨 돌려줍니다.
  function matchVenue(raw, list) {
    var mt = raw && raw.meta;
    if (!mt || !isFinite(mt.lat0) || !isFinite(mt.lon0) || !list) return null;
    var mLon = 111320 * Math.cos(mt.lat0 * Math.PI / 180), mLat = 110574;
    for (var i = 0; i < list.length; i++) {
      var vn = list[i], dx = (vn.lon - mt.lon0) * mLon, dy = (vn.lat - mt.lat0) * mLat;
      if (Math.hypot(dx, dy) > 3000) continue;
      var sh = function (a) { var o = new Array(a.length); for (var q = 0; q < a.length; q += 2) { o[q] = a[q] + dx; o[q + 1] = a[q + 1] + dy; } return o; };
      var polys = function (a) { return (a || []).map(sh); };
      return {
        id: vn.id, name: vn.name, hw: vn.hw, credit: vn.credit, line: sh(vn.line),
        lanes: (vn.lanes || []).map(function (l) { return { c: l.c, p: sh(l.p) }; }),
        roads: (vn.roads || []).map(function (r) { return { w: r.w, p: sh(r.p) }; }),
        pads: (vn.pads || []).map(function (pd) { return { k: pd.k, p: sh(pd.p) }; }),
        water: polys(vn.water), parking: polys(vn.parking),
        buildings: (vn.buildings || []).map(function (b) { return { h: b.h, k: b.k, p: sh(b.p) }; }),
      };
    }
    return null;
  }

  function makeRef(stX, stY) {
    var rs = resampleClosed(stX, stY, NR), spacing = rs.len / NR, m, pass;
    var sig = new Float64Array(NR);
    for (pass = 0; pass < 2; pass++) {
      var sig0 = new Float64Array(NR).fill(20 / spacing);
      var hx = gaussCircularVar(rs.x, sig0), hy = gaussCircularVar(rs.y, sig0);
      var kh = curvatureOf(hx, hy, Math.round(8 / spacing), spacing);
      for (m = 0; m < NR; m++) sig[m] = clamp(0.35 / Math.max(1e-6, Math.abs(kh[m])), 9, 60) / spacing;
      sig = boxCircular(sig, Math.round(10 / spacing));
      rs = resampleClosed(gaussCircularVar(rs.x, sig), gaussCircularVar(rs.y, sig), NR); spacing = rs.len / NR;
    }
    return finishRef(rs, spacing, stX[0], stY[0]); // 출발선이 index 0에 오도록 회전
  }
  // idx 근처 ±r점에서 가장 가까운 기준선 점
  function nearestIdx(ref, x, y, c, r) {
    var bi = c, bd = Infinity;
    for (var q = -r; q <= r; q++) {
      var idx = ((c + q) % NR + NR) % NR, d = (ref.x[idx] - x) * (ref.x[idx] - x) + (ref.y[idx] - y) * (ref.y[idx] - y);
      if (d < bd) { bd = d; bi = idx; }
    }
    return bi;
  }

  function process(raw, opts) {
    opts = opts || {};
    var car = opts.car || CAR;
    var N = raw.x.length;
    var X = Float64Array.from(raw.x), Y = Float64Array.from(raw.y);
    var V = Float64Array.from(raw.v, function (k) { return k / 3.6; });
    var M = (N - 1) * HZ + 1;
    var i, j, k, m;

    // ── 1. 속도 드롭아웃 1차 보정 ─────────────────────────────────────
    // 폰 GPS가 순간적으로 속도를 낮게 읽는 구간(다음 초에 1g 넘게 '가속')을
    // 차가 낼 수 있는 가속·감속 한계로 메웁니다. 값은 올리기만 합니다.
    // 한계값은 선택한 차량이 아니라 고정 기준 제원으로 계산 — 차량을 바꿔도 트랙·랩 데이터가 달라지지 않게
    function accelCap(vv) {
      var drag = 0.5 * 1.2 * CAR.cdA * vv * vv / CAR.massKg;
      return Math.max(0.6, Math.min(0.85 * G, 1.15 * (CAR.powerW * CAR.driveEff / (CAR.massKg * Math.max(vv, 5)) - drag)));
    }
    for (i = N - 1; i >= 1; i--) { var lim = V[i] - accelCap(V[i]); if (V[i - 1] < lim) V[i - 1] = lim; }
    for (i = 1; i < N; i++) { var lim2 = V[i - 1] - 1.3 * G; if (V[i] < lim2) V[i] = lim2; }

    var vS = pchipSlopes(V);
    var v = new Float64Array(M), dist = new Float64Array(M);
    for (k = 0; k < M; k++) {
      i = Math.min(N - 2, Math.floor(k / HZ));
      v[k] = Math.max(0, hermite(V[i], V[i + 1], vS[i], vS[i + 1], k / HZ - i));
    }
    for (k = 1; k < M; k++) dist[k] = dist[k - 1] + (v[k] + v[k - 1]) * 0.5 / HZ;
    function distAt(t) {
      var f = clamp(t * HZ, 0, M - 1), a = Math.floor(f), b = Math.min(M - 1, a + 1);
      return dist[a] + (dist[b] - dist[a]) * (f - a);
    }
    function timeAtDist(d) {
      var lo = 0, hi = M - 1;
      if (d <= dist[0]) return 0;
      if (d >= dist[hi]) return hi / HZ;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (dist[mid] <= d) lo = mid; else hi = mid; }
      var span = dist[hi] - dist[lo];
      return (lo + (span > 1e-9 ? (d - dist[lo]) / span : 0)) / HZ;
    }

    var xS = centralSlopes(X), yS = centralSlopes(Y);
    // GPS 끊김: 기록기가 두 수신점 사이를 직선·등간격으로 메운 초(이동 벡터가 3초 이상 똑같음). 이 초의 위치는 믿지 않습니다.
    var interp = new Uint8Array(N), run = 0;
    for (i = 2; i <= N; i++) {
      var same = i < N && Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]) > 2 && Math.hypot(X[i] - 2 * X[i - 1] + X[i - 2], Y[i] - 2 * Y[i - 1] + Y[i - 2]) < 0.35;
      if (same) run++;
      else { if (run >= 2) for (j = i - 1 - run; j < i - 1; j++) interp[j] = 1; run = 0; }
    }
    function rawPos(t) {
      var a = clamp(Math.floor(t), 0, N - 2), f = clamp(t - a, 0, 1);
      return [hermite(X[a], X[a + 1], xS[a], xS[a + 1], f), hermite(Y[a], Y[a + 1], yS[a], yS[a + 1], f)];
    }

    // ── 2. 스타트/피니시 통과와 랩 ────────────────────────────────────
    // 게이트의 두 점이 '중심 + 진행방향 기준점'(RaceChrono)인지 '게이트 양 끝'(Racelogic)인지 주행 방향으로 판별
    function gateFrame(g) {
      var dx = g.x2 - g.x, dy = g.y2 - g.y, len = Math.hypot(dx, dy) || 1, bi = -1, bd = Infinity, q;
      dx /= len; dy /= len;
      for (q = 1; q < N - 1; q++) { if (V[q] < 3) continue; var d = (X[q] - g.x) * (X[q] - g.x) + (Y[q] - g.y) * (Y[q] - g.y); if (d < bd) { bd = d; bi = q; } }
      var along = true, cx = g.x, cy = g.y;
      if (bi > 0) { var tx = X[bi + 1] - X[bi - 1], ty = Y[bi + 1] - Y[bi - 1], tl = Math.hypot(tx, ty) || 1; along = Math.abs((tx * dx + ty * dy) / tl) > 0.6; }
      if (!along) { cx = (g.x + g.x2) / 2; cy = (g.y + g.y2) / 2; var ndx = -dy; dy = dx; dx = ndx; }
      return { x: cx, y: cy, dx: dx, dy: dy, half: along ? 18 : Math.max(12, len * 0.65) };
    }
    function gateCrossings(g) {
      var fm = gateFrame(g), res = [];
      for (var q = 0; q < N - 1; q++) {
        var sa = (X[q] - fm.x) * fm.dx + (Y[q] - fm.y) * fm.dy;
        var sb = (X[q + 1] - fm.x) * fm.dx + (Y[q + 1] - fm.y) * fm.dy;
        if ((sa < 0) === (sb < 0)) continue;
        var fr = sa / (sa - sb);
        var px0 = X[q] + (X[q + 1] - X[q]) * fr, py0 = Y[q] + (Y[q + 1] - Y[q]) * fr;
        if (Math.abs(-(px0 - fm.x) * fm.dy + (py0 - fm.y) * fm.dx) > fm.half) continue;
        res.push({ t: q + fr, dir: sb > sa ? 1 : -1 });
      }
      var pos = res.filter(function (r) { return r.dir > 0; }).length;
      var keep = pos * 2 >= res.length ? 1 : -1;
      return res.filter(function (r) { return r.dir === keep; }).map(function (r) { return r.t; });
    }
    var gates = raw.gates || [];
    var sf = gates.filter(function (g) { return g.kind === 'Start'; })[0];
    var splits = gates.filter(function (g) { return g.kind === 'Split'; });
    var cross;
    if (raw.crossings && raw.crossings.length >= 2) cross = raw.crossings.filter(function (t) { return t > 0 && t < N - 1; });
    else {
      if (!sf) { // 게이트 정보가 없으면 최고속 지점을 스타트/피니시로 사용
        var kmx = 2; for (i = 2; i < N - 2; i++) if (V[i] > V[kmx]) kmx = i;
        sf = { x: X[kmx], y: Y[kmx], x2: X[kmx] + (X[kmx + 1] - X[kmx - 1]), y2: Y[kmx] + (Y[kmx + 1] - Y[kmx - 1]) };
      }
      cross = gateCrossings(sf);
    }
    if (cross.length < 2) throw new Error('랩을 찾지 못했습니다. 스타트/피니시를 두 번 이상 통과한 기록이 필요합니다.');
    // estCross: 기록기가 놓친 통과를 위치로 되살린 시각(아래 '통과 누락 복구'). 그 시각에 걸친 랩은 추정 랩(est)
    var laps = [], estT = raw.estCross || [];
    function isEst(t) { for (var q = 0; q < estT.length; q++) if (Math.abs(estT[q] - t) < 1e-6) return true; return false; }
    for (j = 0; j + 1 < cross.length; j++) {
      laps.push({ n: j + 1, t0: cross[j], t1: cross[j + 1], time: cross[j + 1] - cross[j], spdLen: distAt(cross[j + 1]) - distAt(cross[j]), spd0: distAt(cross[j]), est: isEst(cross[j]) || isEst(cross[j + 1]) });
    }
    var timed = laps.filter(function (l) { return !l.est; }); if (!timed.length) timed = laps;
    var bestTime = Math.min.apply(null, timed.map(function (l) { return l.time; }));
    var best = laps.indexOf(timed.filter(function (l) { return l.time === bestTime; })[0]);
    var first = laps[0], last = laps[laps.length - 1];
    // 여러 바퀴가 한 랩으로 묶인 구간(통과 누락)은 기준선·거리 보정 계산에서 뺍니다
    var medLen = median(laps.map(function (l) { return l.spdLen; }));
    var okLaps = laps.filter(function (l) { return l.spdLen < medLen * 1.5 && l.spdLen > medLen * 0.5; }); if (!okLaps.length) okLaps = laps;
    var sfX = median(cross.map(function (t) { return rawPos(t)[0]; })), sfY = median(cross.map(function (t) { return rawPos(t)[1]; }));

    // ── 3. 기준 주행선 ────────────────────────────────────────────────
    var maxLen = Math.max.apply(null, okLaps.map(function (l) { return l.spdLen; }));
    var clean = okLaps.filter(function (l) { return l.spdLen >= maxLen * 0.97; });
    var ref, venue = opts.venue && opts.venue.line && opts.venue.line.length >= 80 ? opts.venue : null, gpsBias = [0, 0], devMed = 0;
    if (venue) {
      // 등록 서킷: 실제 지도 중심선이 기준선. GPS 궤적으로 진행 방향을 판별하고, GPS의 일정한 치우침(평균 벡터)을 빼 줍니다.
      ref = makeRefTruth(venue.line, sfX, sfY, false);
      var qa = Math.ceil(first.t0), qb = Math.floor(last.t1), q0, pi = -1, dirSum = 0, dev = [];
      for (q0 = qa; q0 <= qb; q0++) {
        if (V[q0] < 8) { pi = -1; continue; }
        var ni = nearestIdx(ref, X[q0], Y[q0], 0, NR / 2);
        dev.push(Math.hypot(X[q0] - ref.x[ni], Y[q0] - ref.y[ni]));
        if (pi >= 0) { var di = ((ni - pi + NR + NR / 2) % NR) - NR / 2; if (Math.abs(di) < NR / 8) dirSum += di; }
        pi = ni;
      }
      devMed = dev.length ? median(dev) : 99; // 이 세션 GPS가 중심선에서 벗어나는 정도(중앙값, m)
      if (devMed > 30) venue = null; // 이 서킷의 주행이 아님 → GPS만으로 처리
      else {
        var rev = dirSum < 0;
        if (rev) ref = makeRefTruth(venue.line, sfX, sfY, true);
        for (var pass2 = 0; pass2 < 2; pass2++) {
          var bx = 0, by = 0, bn = 0;
          for (q0 = qa; q0 <= qb; q0++) {
            if (V[q0] < 8) continue;
            var nj = nearestIdx(ref, X[q0], Y[q0], 0, NR / 2), ex = X[q0] - ref.x[nj], ey = Y[q0] - ref.y[nj];
            if (ex * ex + ey * ey < 625) { bx += ex; by += ey; bn++; }
          }
          if (bn < 20) break;
          bx = clamp(bx / bn, -12, 12); by = clamp(by / bn, -12, 12);
          for (q0 = 0; q0 < N; q0++) { X[q0] -= bx; Y[q0] -= by; }
          gpsBias[0] += bx; gpsBias[1] += by;
        }
        // 출발선: 게이트가 있으면 그 실제 좌표, 없으면 통과 지점(치우침 보정 후)
        var g0 = sf ? gateFrame(sf) : null;
        ref = makeRefTruth(venue.line, g0 ? g0.x : sfX - gpsBias[0], g0 ? g0.y : sfY - gpsBias[1], rev);
      }
    }
    if (!venue) {
      // 1차: 속도 드롭아웃이 적은(적분거리가 긴) 랩들을 진행률로 겹쳐 위치 중앙값
      var NS = 2000, stX = new Float64Array(NS), stY = new Float64Array(NS);
      var bufX = new Float64Array(clean.length), bufY = new Float64Array(clean.length);
      for (m = 0; m < NS; m++) {
        for (j = 0; j < clean.length; j++) {
          var p = rawPos(timeAtDist(clean[j].spd0 + (m / NS) * clean[j].spdLen));
          bufX[j] = p[0]; bufY[j] = p[1];
        }
        stX[m] = median(bufX); stY[m] = median(bufY);
      }
      ref = makeRef(boxCircular(stX, 3), boxCircular(stY, 3));
    }

    // 1Hz 실측점을 기준선에 순차 투영: 호길이 위치 sPos(누적 m), 횡편차 latRaw
    var iFirst = Math.ceil(first.t0), iLast = Math.floor(last.t1), iJoin, iExit;
    var sPos = new Float64Array(N), latRaw = new Float64Array(N);
    function track() {
      var win = Math.round(45 / ref.spacing), idx, s, q, step, nidx, d, misses, noisy = !!venue && devMed > 8, offLim = noisy ? 55 : venue ? 20 : 13, missLim = noisy ? 8 : venue ? 3 : 2; // 합류·이탈 판정: GPS 기준선은 13m·2초, 실제 중심선은 20m·3초, GPS가 많이 튀는 세션(중심선 편차 중앙값 8m 초과)은 55m·8초
      function at(q2, c) {
        nidx = nearestIdx(ref, X[q2], Y[q2], c, win);
        d = (X[q2] - ref.x[nidx]) * ref.nx[nidx] + (Y[q2] - ref.y[nidx]) * ref.ny[nidx];
        var off = Math.hypot(X[q2] - ref.x[nidx], Y[q2] - ref.y[nidx]);
        return off;
      }
      // 첫 통과 직후에서 시작
      idx = nearestIdx(ref, X[iFirst], Y[iFirst], 0, win); s = idx * ref.spacing;
      if (s > ref.len / 2) s -= ref.len;
      sPos[iFirst] = s; latRaw[iFirst] = (X[iFirst] - ref.x[idx]) * ref.nx[idx] + (Y[iFirst] - ref.y[idx]) * ref.ny[idx];
      misses = 0; iExit = N - 1;
      for (q = iFirst + 1; q < N; q++) { // 전진
        var pred = sPos[q - 1] + Math.max(V[q], 2);
        var c = Math.round(pred / ref.spacing);
        var off = at(q, c);
        step = ((nidx - (((c % NR) + NR) % NR) + NR + NR / 2) % NR) - NR / 2;
        sPos[q] = Math.max(sPos[q - 1], (c + step) * ref.spacing);
        latRaw[q] = d;
        if (q > iLast && !interp[q]) { if (off > offLim) { misses++; if (misses >= missLim) { iExit = q - missLim; break; } } else misses = 0; }
      }
      misses = 0; iJoin = 0;
      for (q = iFirst - 1; q >= 0; q--) { // 후진
        var pred2 = sPos[q + 1] - Math.max(V[q], 2);
        var c2 = Math.round(pred2 / ref.spacing);
        var off2 = at(q, c2);
        step = ((nidx - (((c2 % NR) + NR) % NR) + NR + NR / 2) % NR) - NR / 2;
        sPos[q] = Math.min(sPos[q + 1], (c2 + step) * ref.spacing);
        latRaw[q] = d;
        if (!interp[q]) { if (off2 > offLim) { misses++; if (misses >= missLim) { iJoin = q + missLim; break; } } else misses = 0; }
      }
    }
    track();

    // 2차: 전 랩의 횡편차 중앙값만큼 기준선을 옮겨 다듬기(느린 랩은 GPS 지연이 적어 더 정확). 실제 중심선을 쓸 때는 건너뜀
    if (!venue) {
    var binM = 16, nb = Math.round(ref.len / binM), bins = [];
    for (m = 0; m < nb; m++) bins.push([]);
    for (i = iFirst; i <= iLast; i++) {
      if (V[i] < 5) continue;
      var fr0 = (((sPos[i] / ref.len) % 1) + 1) % 1;
      bins[Math.min(nb - 1, Math.floor(fr0 * nb))].push(clamp(latRaw[i], -9, 9));
    }
    var binOff = bins.map(function (b) { return b.length >= 4 ? median(b) : 0; });
    var sx2 = new Float64Array(NR), sy2 = new Float64Array(NR);
    for (m = 0; m < NR; m++) {
      var fb = (m / NR) * nb - 0.5, b0 = ((Math.floor(fb) % nb) + nb) % nb, b1 = (b0 + 1) % nb, wb = fb - Math.floor(fb);
      var o2 = binOff[b0] + (binOff[b1] - binOff[b0]) * wb;
      sx2[m] = ref.x[m] + ref.nx[m] * o2; sy2[m] = ref.y[m] + ref.ny[m] * o2;
    }
    ref = makeRef(sx2, sy2);
    track();
    }

    // 통과 누락 복구: GPS가 끊겨 기록기가 출발선 통과를 놓치면 두 바퀴가 한 랩이 됩니다.
    // 기준선 위 진행 거리가 두 바퀴 이상인 랩은 바퀴 수로 나눈 지점의 시각을 통과로 넣고 처음부터 다시 처리합니다(그 랩은 추정 랩).
    if (!opts._relap) {
      var addCross = [];
      laps.forEach(function (l) {
        var ia = Math.round(l.t0), ib = Math.round(l.t1), loops = Math.round((sPos[ib] - sPos[ia]) / ref.len);
        for (var c = 1; c < loops; c++) {
          var target = sPos[ia] + (sPos[ib] - sPos[ia]) * c / loops, q = ia;
          while (q < ib - 1 && sPos[q + 1] < target) q++;
          addCross.push(q + (target - sPos[q]) / Math.max(1e-6, sPos[q + 1] - sPos[q]));
        }
      });
      if (addCross.length) {
        var raw2 = {}, opts2 = {}, key;
        for (key in raw) raw2[key] = raw[key];
        for (key in opts) opts2[key] = opts[key];
        raw2.crossings = cross.concat(addCross).sort(function (a, b) { return a - b; }); raw2.estCross = addCross; opts2._relap = true;
        return process(raw2, opts2);
      }
    }

    // ── 4. 속도 적분과 위치 투영의 융합 ───────────────────────────────
    // 고주파는 속도 적분, 저주파(드리프트·드롭아웃)는 위치 투영을 따릅니다.
    var ratios = clean.map(function (l) { return l.spdLen / ref.len; });
    var scale = median(ratios); // 속도 적분 거리 / 기준선 호길이
    var kJoin = iJoin * HZ, kExit = iExit * HZ;
    var err = new Float64Array(M);
    for (k = 0; k < M; k++) {
      var kk = clamp(k, kJoin, kExit), ia = Math.min(N - 2, Math.floor(kk / HZ)), fa = kk / HZ - ia;
      err[k] = (sPos[ia] + (sPos[ia + 1] - sPos[ia]) * fa) * scale - dist[kk];
    }
    err = box(box(err, 50), 50);
    var fused = new Float64Array(M);
    for (k = 0; k < M; k++) { fused[k] = dist[k] + err[k]; if (k > 0 && fused[k] < fused[k - 1]) fused[k] = fused[k - 1]; }
    var vf = new Float64Array(M);
    for (k = 1; k < M - 1; k++) vf[k] = (fused[k + 1] - fused[k - 1]) * HZ / 2;
    vf = box(vf, 5);
    // 표시 속도는 GPS 실측 속도를 그대로 두고, 융합 결과가 뚜렷이 더 빠른 구간(드롭아웃)만 끌어올림
    var repaired = 0, vShow = new Float64Array(M);
    // 끌어올린 속도는 앞뒤 6초 안에서 GPS가 실제로 잰 최고 속도를 넘지 않게(끊김 뒤 위치가 한꺼번에 따라붙으며 생기는 가짜 최고속 방지)
    var vLoc = new Float64Array(N);
    for (i = 0; i < N; i++) { var mxv = 0; for (j = Math.max(0, i - 6); j <= Math.min(N - 1, i + 6); j++) if (V[j] > mxv) mxv = V[j]; vLoc[i] = mxv; }
    for (k = 0; k < M; k++) { var vfc = Math.min(vf[k], vLoc[Math.min(N - 1, Math.round(k / HZ))]); vShow[k] = v[k] + Math.max(0, vfc - v[k] - Math.max(2.5, 0.12 * v[k])); }
    vShow = box(vShow, 3);
    for (k = 0; k < M; k++) { if (k % HZ === 0 && vShow[k] - raw.v[k / HZ] / 3.6 > 2.5) repaired++; v[k] = vShow[k]; }
    dist = fused;

    laps.forEach(function (l) { l.d0 = distAt(l.t0); l.d1 = distAt(l.t1); l.len = l.d1 - l.d0; });
    var lapMeters = ref.len * scale;

    function refAt(u) {
      var f = ((u % 1) + 1) % 1 * NR, a = Math.floor(f) % NR, b = (a + 1) % NR, w = f - a;
      return [ref.x[a] + (ref.x[b] - ref.x[a]) * w, ref.y[a] + (ref.y[b] - ref.y[a]) * w, ref.nx[a], ref.ny[a], ref.k[a] + (ref.k[b] - ref.k[a]) * w];
    }
    var splitU = splits.length ? splits.map(function (g) { return nearestIdx(ref, g.x, g.y, 0, NR / 2) / NR; }).sort(function (a, b) { return a - b; }) : [1 / 3, 2 / 3];

    // ── 5. 정차 구간 드리프트 제거 후 부드러운 원시 경로(트랙 밖 표시용) ──
    var Xc = Float64Array.from(X), Yc = Float64Array.from(Y);
    for (i = 0; i < N;) {
      if (V[i] < 0.5) {
        j = i; while (j < N && V[j] < 0.5) j++;
        if (j - i >= 3) {
          var mx = median(X.subarray(i, j)), my = median(Y.subarray(i, j));
          for (k = i; k < j; k++) { Xc[k] = mx; Yc[k] = my; }
        }
        i = j;
      } else i++;
    }
    var xcS = centralSlopes(Xc), ycS = centralSlopes(Yc);
    var rx = new Float64Array(M), ry = new Float64Array(M);
    for (k = 0; k < M; k++) {
      i = Math.min(N - 2, Math.floor(k / HZ)); var f = k / HZ - i;
      rx[k] = hermite(Xc[i], Xc[i + 1], xcS[i], xcS[i + 1], f);
      ry[k] = hermite(Yc[i], Yc[i + 1], ycS[i], ycS[i + 1], f);
    }
    rx = box(box(rx, 15), 15); ry = box(box(ry, 15), 15);

    // ── 6. 진행률 u, 랩 인덱스, 트랙 위 가중치, 횡편차 ────────────────
    var u = new Float64Array(M), lapIdx = new Int16Array(M).fill(-1);
    for (k = 0; k < M; k++) {
      var t = k / HZ;
      if (t < first.t0) u[k] = 1 - (first.d0 - dist[k]) / lapMeters;
      else if (t >= last.t1) u[k] = (dist[k] - last.d1) / lapMeters;
      else {
        for (j = 0; j < laps.length; j++) if (t < laps[j].t1) break;
        lapIdx[k] = j; u[k] = clamp((dist[k] - laps[j].d0) / laps[j].len, 0, 1);
      }
    }
    var w = new Float64Array(M), ramp = 3 * HZ;
    for (k = 0; k < M; k++) {
      if (k < kJoin) w[k] = 0;
      else if (k < kJoin + ramp) w[k] = smoothstep(0, 1, (k - kJoin) / ramp);
      else if (k <= kExit - ramp) w[k] = 1;
      else if (k <= kExit) w[k] = smoothstep(0, 1, (kExit - k) / ramp);
      else w[k] = 0;
    }
    var lat = new Float64Array(M);
    for (k = 0; k < M; k++) {
      var ib = Math.min(N - 2, Math.floor(k / HZ)), fb2 = k / HZ - ib;
      lat[k] = clamp(latRaw[ib] + (latRaw[ib + 1] - latRaw[ib]) * fb2, -5, 5);
    }
    lat = box(box(lat, 24), 24);

    // ── 7. 표시 위치, 헤딩, G ─────────────────────────────────────────
    var px = new Float64Array(M), py = new Float64Array(M), kap = new Float64Array(M);
    for (k = 0; k < M; k++) {
      var q2 = refAt(u[k]), o = clamp(lat[k] * 0.6, -3, 3);
      px[k] = w[k] * (q2[0] + q2[2] * o) + (1 - w[k]) * rx[k];
      py[k] = w[k] * (q2[1] + q2[3] * o) + (1 - w[k]) * ry[k];
      kap[k] = q2[4];
    }
    var hd = new Float64Array(M), have = false, lastHd = 0, firstValid = -1;
    for (k = 0; k < M; k++) {
      var a3 = Math.max(0, k - 3), b3 = Math.min(M - 1, k + 3);
      var ddx = px[b3] - px[a3], ddy = py[b3] - py[a3];
      if (v[k] > 1.2 && Math.hypot(ddx, ddy) > 0.25) {
        var hnow = Math.atan2(ddy, ddx);
        if (have) hnow = lastHd + wrapPi(hnow - lastHd); else { firstValid = k; have = true; }
        lastHd = hnow;
      }
      hd[k] = lastHd;
    }
    for (k = 0; k < firstValid; k++) hd[k] = hd[firstValid];
    hd = box(hd, 4);
    var yaw = new Float64Array(M);
    for (k = 1; k < M - 1; k++) yaw[k] = (hd[k + 1] - hd[k - 1]) * HZ / 2;
    yaw = box(yaw, 8);
    var aLat = new Float64Array(M), aLong = new Float64Array(M);
    // 트랙 위: v²·κ(기준선 곡률), 트랙 밖: v·요레이트.  +는 좌회전
    for (k = 0; k < M; k++) aLat[k] = (w[k] * v[k] * v[k] * kap[k] + (1 - w[k]) * v[k] * yaw[k]) / G;
    for (k = 1; k < M - 1; k++) aLong[k] = (v[k + 1] - v[k - 1]) * HZ / 2 / G;
    aLong = box(aLong, 8); aLat = box(box(aLat, 8), 6);
    // 1Hz GPS는 코너를 실제보다 날카롭게 그려 횡G가 과대해지므로,
    // 타이어 마찰원(약 1.2g) 안으로 부드럽게 눌러 담습니다.
    for (k = 0; k < M; k++) {
      aLong[k] = clamp(aLong[k], -1.3, 0.9);
      var capG = Math.sqrt(Math.max(0.16, 1.2 * 1.2 - aLong[k] * aLong[k]));
      aLat[k] = capG * Math.tanh(aLat[k] / capG);
    }

    // ── 8. 스로틀/브레이크·기어/RPM·브레이크 온도 추정 ────────────────
    var thr = new Float64Array(M), brk = new Float64Array(M);
    for (k = 0; k < M; k++) {
      var drag = 0.5 * 1.2 * car.cdA * v[k] * v[k] + car.crr * car.massKg * G;
      var need = car.massKg * aLong[k] * G + drag;
      var avail = Math.min(car.mu * car.massKg * G * (car.traction || 0.55), car.powerW * car.driveEff / Math.max(v[k], 3));
      thr[k] = v[k] < 0.3 ? 0 : clamp(need / avail, 0, 1);
      brk[k] = v[k] < 0.3 ? 0 : clamp((-aLong[k] - 0.06) / 0.95, 0, 1);
    }
    thr = box(thr, 3); brk = box(brk, 3);

    var gear = new Int8Array(M), rpm = new Float64Array(M);
    var kRpm = 60 * car.finalDrive / car.tyreCirc;
    var g = 0, hold = 0, top = car.gears.length - 1;
    for (k = 0; k < M; k++) {
      while (g < top && v[k] * kRpm * car.gears[g] > car.redline - 150) { g++; hold = Math.round(0.5 * HZ); }
      var r0 = v[k] * kRpm * car.gears[g];
      if (hold > 0) hold--;
      else {
        var upAt = 4300 + (car.redline - 350 - 4300) * thr[k];
        var downAt = brk[k] > 0.08 ? 3600 : 1900 + 1500 * thr[k];
        var rDown = g > 0 ? v[k] * kRpm * car.gears[g - 1] : Infinity;
        if (g < top && r0 > upAt) { g++; hold = Math.round(0.8 * HZ); }
        else if (g > 0 && r0 < downAt && rDown < car.redline - 900) { g--; hold = Math.round(0.7 * HZ); }
        else if (g > 0 && thr[k] > 0.92 && rDown < car.redline - 1500) { g--; hold = Math.round(1.0 * HZ); }
      }
      gear[k] = g + 1;
      rpm[k] = Math.min(car.redline, Math.max(v[k] * kRpm * car.gears[g], car.idle + 1500 * thr[k] * smoothstep(8, 0, v[k])));
    }
    rpm = box(rpm, 2);

    // 브레이크 디스크 온도(열모델): 제동 에너지의 70%가 앞 디스크 2장으로, 주행풍으로 냉각
    var brakeT = new Float32Array(M), Tb = 60, Tamb = 16;
    for (k = 0; k < M; k++) {
      var dec = Math.max(0, -aLong[k] - 0.05) * G;
      var heat = 0.7 * car.massKg * dec * v[k] / (2 * 7.5 * 460);
      var cool = (Tb - Tamb) * (0.003 + 0.00042 * v[k]);
      Tb += (heat - cool) / HZ;
      brakeT[k] = Tb;
    }

    // ── 9. 랩 상세 ────────────────────────────────────────────────────
    var NQ = 400;
    laps.forEach(function (l) {
      var cuts = [l.t0].concat(splitU.map(function (uu) { return timeAtDist(l.d0 + uu * l.len); })).concat([l.t1]);
      l.cuts = cuts;
      l.sectors = []; for (var s = 0; s + 1 < cuts.length; s++) l.sectors.push(cuts[s + 1] - cuts[s]);
      var ka = Math.ceil(l.t0 * HZ), kb = Math.floor(l.t1 * HZ), vmax = 0, vmin = Infinity, gl = 0, gb = 0, tmax = 0;
      for (var z = ka; z <= kb; z++) {
        if (v[z] > vmax) vmax = v[z]; if (v[z] < vmin) vmin = v[z];
        if (Math.abs(aLat[z]) > gl) gl = Math.abs(aLat[z]); if (-aLong[z] > gb) gb = -aLong[z];
        if (brakeT[z] > tmax) tmax = brakeT[z];
      }
      l.vmax = vmax * 3.6; l.vmin = vmin * 3.6; l.maxLatG = gl; l.maxBrakeG = gb; l.maxBrakeT = tmax;
      l.tAtU = new Float32Array(NQ + 1);
      for (var qq = 0; qq <= NQ; qq++) l.tAtU[qq] = timeAtDist(l.d0 + (qq / NQ) * l.len) - l.t0;
      l.tAtU[0] = 0; l.tAtU[NQ] = l.time;
    });
    var nSec = laps[0].sectors.length, bestSectors = [];
    for (j = 0; j < nSec; j++) bestSectors.push(Math.min.apply(null, timed.map(function (l) { return l.sectors[j]; }))); // 통과 시각을 추정한 랩은 제외

    // 랩 성격과 기록 갱신(시간순): push / warm / cool, 섹터 색(best=세션 최고 갱신, up=직전 랩보다 빠름)
    var runBest = Infinity, runSec = []; for (j = 0; j < nSec; j++) runSec.push(Infinity);
    laps.forEach(function (l, idx) {
      l.prevBest = runBest === Infinity ? null : runBest;
      l.newBest = !l.est && l.time < runBest; // 통과 시각을 추정한 랩은 기록 갱신으로 치지 않음
      if (l.newBest) runBest = l.time;
      l.sectorFlag = l.sectors.map(function (s, si) {
        var rec = !l.est && s < runSec[si]; // 추정 랩의 섹터는 최고 기록으로 치지 않음
        var flag = rec ? 'best' : (idx > 0 && s < laps[idx - 1].sectors[si] ? 'up' : 'down');
        if (rec) runSec[si] = s;
        return flag;
      });
      l.push = l.time <= bestTime * 1.03;
    });
    laps.forEach(function (l, idx) {
      var pushedBefore = laps.slice(0, idx).some(function (p2) { return p2.push; });
      var nextPush = idx + 1 < laps.length && laps[idx + 1].push;
      l.kind = l.push ? 'push' : (!pushedBefore || nextPush ? 'warm' : 'cool');
    });

    // ── 코너 검출(기준선 곡률) + 랩별 코너 최저속 ─────────────────────
    var corners = [], inC = false, cs = 0, kSm = boxCircular(ref.k, Math.round(6 / ref.spacing)), absK = Float64Array.from(kSm, Math.abs), TH = 0.008;
    var startM = 0; while (startM < NR && absK[startM] > TH) startM++; // 직선에서 시작
    for (var mm = 0; mm <= NR; mm++) {
      m = (startM + mm) % NR;
      var on = mm < NR && absK[m] > TH;
      if (on && !inC) { inC = true; cs = mm; }
      else if (!on && inC) {
        inC = false;
        var a0 = cs, b0c = mm - 1, pk = a0;
        for (var q3 = a0; q3 <= b0c; q3++) if (absK[(startM + q3) % NR] > absK[(startM + pk) % NR]) pk = q3;
        var turn = 0; for (var q4 = a0; q4 <= b0c; q4++) turn += kSm[(startM + q4) % NR] * ref.spacing;
        var prevC = corners[corners.length - 1], dirNow = turn > 0 ? 'L' : 'R';
        if (prevC && (a0 - prevC.b) * ref.spacing < 25 && prevC.dir === dirNow) { // 같은 방향으로 붙어 있으면 병합
          prevC.b = b0c; prevC.turn += turn; if (absK[(startM + pk) % NR] > absK[(startM + prevC.pk) % NR]) prevC.pk = pk;
        } else corners.push({ a: a0, b: b0c, pk: pk, dir: dirNow, turn: turn });
      }
    }
    corners = corners.filter(function (c) { return Math.abs(c.turn) >= 0.42; }).map(function (c) {
      return { turnDeg: Math.abs(c.turn) * 180 / Math.PI, u0: ((startM + c.a) % NR) / NR, u1: ((startM + c.b) % NR) / NR, uApex: ((startM + c.pk) % NR) / NR, dir: c.dir, radius: 1 / absK[(startM + c.pk) % NR] };
    }).sort(function (a, b) { return a.uApex - b.uApex; });
    corners.forEach(function (c, idx) {
      c.name = 'C' + (idx + 1);
      c.min = laps.map(function (l) {
        var ua = c.u0 - 0.004, ub = c.u1 + 0.004, mn = Infinity;
        if (ua > ub) return NaN; // 출발선을 걸치는 코너는 제외
        var ka2 = Math.floor(timeAtDist(l.d0 + clamp(ua, 0, 1) * l.len) * HZ), kb2 = Math.ceil(timeAtDist(l.d0 + clamp(ub, 0, 1) * l.len) * HZ);
        for (var z2 = ka2; z2 <= kb2; z2++) if (v[z2] < mn) mn = v[z2];
        return mn * 3.6;
      });
      c.bestMin = Math.max.apply(null, c.min.filter(function (x) { return x === x; }));
    });

    // 세션 통계
    var pushLaps = laps.filter(function (l) { return l.push && !l.est; }); if (!pushLaps.length) pushLaps = laps.filter(function (l) { return l.push; });
    var pm = pushLaps.reduce(function (a, l) { return a + l.time; }, 0) / pushLaps.length;
    var stats = {
      pushCount: pushLaps.length,
      pushMean: pm,
      consistency: Math.sqrt(pushLaps.reduce(function (a, l) { return a + (l.time - pm) * (l.time - pm); }, 0) / pushLaps.length),
      theoretical: bestSectors.reduce(function (a, b) { return a + b; }, 0),
      trackKm: (dist[kExit] - dist[kJoin]) / 1000,
      maxLatG: Math.max.apply(null, laps.map(function (l) { return l.maxLatG; })),
      maxBrakeG: Math.max.apply(null, laps.map(function (l) { return l.maxBrakeG; })),
      maxBrakeT: Math.max.apply(null, laps.map(function (l) { return l.maxBrakeT; })),
    };

    // 기준선 위 베스트랩 속도(미니맵 색)
    ref.v = new Float32Array(NR);
    var bl = laps[best];
    for (m = 0; m < NR; m++) {
      var tt = timeAtDist(bl.d0 + (m / NR) * bl.len) * HZ, ta = Math.floor(tt), tb = Math.min(M - 1, ta + 1);
      ref.v[m] = (v[ta] + (v[tb] - v[ta]) * (tt - ta)) * 3.6;
    }

    // 진입·퇴장 도로(트랙 밖 구간)의 폴리라인
    var access = [], cur = null;
    for (k = 0; k < M; k++) {
      if (w[k] < 0.999) {
        if (!cur) { cur = []; access.push(cur); }
        var lp = cur.length ? cur[cur.length - 1] : null;
        if (!lp || Math.hypot(px[k] - lp[0], py[k] - lp[1]) > 2.5) cur.push([px[k], py[k]]);
      } else cur = null;
    }

    var vmaxAll = 0, kTop = 0;
    for (k = 0; k < M; k++) if (v[k] > vmaxAll) { vmaxAll = v[k]; kTop = k; }

    return {
      hz: HZ, count: M, duration: (M - 1) / HZ, car: car,
      v: v, dist: dist, x: px, y: py, hd: hd, aLat: aLat, aLong: aLong,
      thr: thr, brk: brk, gear: gear, rpm: rpm, u: u, w: w, lapIdx: lapIdx, brakeT: brakeT,
      laps: laps, best: best, bestSectors: bestSectors, splitU: splitU,
      ref: ref, lapMeters: lapMeters, access: access, tJoin: kJoin / HZ, tExit: kExit / HZ,
      topSpeed: vmaxAll * 3.6, tTop: kTop / HZ, meta: raw.meta, cleanLapCount: clean.length,
      repairedSeconds: repaired, scale: scale, corners: corners, stats: stats,
      venue: venue, gpsBias: gpsBias, // venue: 실제 지도 선형으로 보정한 등록 서킷(없으면 null)
    };
  }

  return { process: process, matchVenue: matchVenue, CAR: CAR, HZ: HZ, G: G };
});
