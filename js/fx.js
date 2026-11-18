// 가속·감속 연출(화면 효과): 화면 가장자리 줌 블러 + 방사형 속도선 + 만화식 효과음 글자(부웅~, 끼익~).
// 세기·소실점·글자 위치는 app.js가 매 프레임 넘겨줍니다. CSS 애니메이션을 쓰지 않아 일시정지하면 그대로 멈춥니다.
(function () {
  'use strict';
  var cv, g, small, sg, tmp, tg, W = 0, H = 0, streaks = [], acc = 0, shown = false, MAXW = 960, N = 6;
  var pops = {}, POP_LIFE = 0.95;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // canvas: 줌 블러·속도선용 2D 캔버스, sfxBox: 효과음 글자를 넣을 요소(없어도 됨)
  function init(canvas, sfxBox) {
    cv = canvas; g = cv.getContext('2d');
    small = document.createElement('canvas'); sg = small.getContext('2d');
    tmp = document.createElement('canvas'); tg = tmp.getContext('2d');
    if (sfxBox) ['acc', 'brk'].forEach(function (k) {
      var el = document.createElement('span'); el.className = k; sfxBox.appendChild(el);
      pops[k] = { el: el, t: 0, on: false, side: 1 };
    });
    return !!(g && sg);
  }
  // w, h: 화면 CSS 픽셀. 흐림 효과라 해상도는 낮게 잡습니다(긴 변 최대 960).
  function resize(w, h) {
    var k = Math.min(1, MAXW / Math.max(w, h, 1));
    W = Math.max(2, Math.round(w * k)); H = Math.max(2, Math.round(h * k));
    cv.width = W; cv.height = H; small.width = tmp.width = Math.max(2, W >> 1); small.height = tmp.height = Math.max(2, H >> 1);
    shown = false;
  }

  // 효과음 글자를 띄웁니다. kind: 'acc'(가속) | 'brk'(제동), side: -1 왼쪽 / +1 오른쪽
  function pop(kind, text, side) {
    var p = pops[kind]; if (!p) return;
    p.el.textContent = text; p.t = 0; p.side = side < 0 ? -1 : 1; p.on = true;
  }
  function clearPops() { for (var k in pops) if (pops[k].on) { pops[k].on = false; pops[k].el.style.opacity = '0'; } }
  // 튀어나오며 커졌다가(0.14) 제 크기로 돌아오고(0.28) 떨리다가 흐려집니다. 재생 시간(adv)으로만 진행합니다.
  function stepPops(o) {
    for (var k in pops) {
      var p = pops[k]; if (!p.on) continue;
      p.t += o.adv;
      var a = p.t / POP_LIFE;
      if (a >= 1 || !o.sfx) { p.on = false; p.el.style.opacity = '0'; continue; }
      var sc = a < 0.14 ? 0.35 + a / 0.14 * 0.9 : a < 0.28 ? 1.25 - (a - 0.14) / 0.14 * 0.25 : 1 + (a - 0.28) * 0.2;
      var rot = -p.side * 8 + (a < 0.6 ? Math.sin(p.t * 58) * 2.4 : 0);
      var off = Math.max(o.w * 0.18, 125) + (k === 'acc' ? a * o.w * 0.03 : 0), half = Math.min(p.el.offsetWidth * 0.62 + 10, o.w * 0.5);
      var x = clamp(o.ax + p.side * off, half, o.w - half), y = clamp(o.ay + (k === 'acc' ? -o.h * 0.13 : -o.h * 0.02), o.h * 0.18, o.h * 0.62);
      p.el.style.opacity = (a < 0.62 ? 1 : 1 - (a - 0.62) / 0.38).toFixed(2);
      p.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + rot.toFixed(2) + 'deg) skewX(-10deg) scale(' + sc.toFixed(3) + ')';
    }
  }

  // 줌 블러 + 속도선. level: 지속 세기 0..1, kick: 순간 세기 0..1, cx, cy: 소실점(화면 비율 0..1)
  function drawBlur(o) {
    if (!W) return;
    var L = clamp(o.level + o.kick * 0.6, 0, 1), i;
    if (L < 0.02) {
      streaks.length = 0; acc = 0;
      if (shown) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, W, H); shown = false; }
      return;
    }
    var cx = o.cx * W, cy = o.cy * H, R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, W, H);

    // 1) 줌 블러: 방금 그린 3D 화면을 소실점 기준으로 조금씩 키워 겹쳐 그립니다(같은 비중으로 평균).
    //    촘촘한 간격으로 한 번, 그 결과를 넓은 간격으로 한 번 더 겹쳐 계단 없이 길게 번지게 합니다(N×N 표본).
    var ok = true, sw = small.width, sh = small.height, s;
    try { sg.drawImage(o.src, 0, 0, sw, sh); } catch (e) { ok = false; }
    if (ok) {
      var d = (0.1 + 0.3 * L) / (N * N), hx = o.cx * sw, hy = o.cy * sh;
      tg.globalAlpha = 1; tg.clearRect(0, 0, sw, sh);
      for (i = 0; i < N; i++) { s = 1 + d * i; tg.globalAlpha = 1 / (i + 1); tg.drawImage(small, hx - hx * s, hy - hy * s, sw * s, sh * s); }
      for (i = 0; i < N; i++) { s = 1 + d * N * i; g.globalAlpha = 1 / (i + 1); g.drawImage(tmp, cx - cx * s, cy - cy * s, W * s, H * s); }
    }

    // 2) 가운데(차와 앞길)는 선명하게 두고 가장자리로 갈수록 번진 화면이 드러나게 가립니다
    g.globalCompositeOperation = 'destination-in'; g.globalAlpha = 1;
    var m = g.createRadialGradient(cx, cy, R * 0.17, cx, cy, R * 0.9);
    m.addColorStop(0, 'rgba(0,0,0,0)');
    m.addColorStop(0.4, 'rgba(0,0,0,' + Math.min(1, 0.95 * L).toFixed(3) + ')');
    m.addColorStop(1, 'rgba(0,0,0,' + Math.min(1, 0.45 + 0.8 * L).toFixed(3) + ')');
    g.fillStyle = m; g.fillRect(0, 0, W, H);

    // 3) 속도선: 소실점에서 바깥으로 뻗어 나가는 밝은 쐐기
    acc += (o.level * 240 + o.kick * 800) * o.dt;
    while (acc >= 1) {
      acc -= 1;
      if (streaks.length < 260) streaks.push({ a: Math.random() * 6.2832, r: 0.2 + Math.random() * 0.45, len: 0.14 + Math.random() * 0.36, w: 0.005 + Math.random() * 0.02, t: 0, life: 0.25 + Math.random() * 0.3, al: 0.45 + Math.random() * 0.55 });
    }
    g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgb(232,244,255)';
    var sA = Math.min(1, 0.4 + L);
    for (i = streaks.length - 1; i >= 0; i--) {
      var q = streaks[i];
      q.t += o.dt; q.r += q.r * (1.0 + 1.5 * L) * o.dt;
      if (q.t >= q.life || q.r > 1.3) { streaks.splice(i, 1); continue; }
      var r0 = q.r * R, r1 = (q.r + q.len * (0.7 + L)) * R;
      var u = q.t / q.life; // 빠르게 나타나서 천천히 사라짐
      g.globalAlpha = sA * q.al * (u < 0.2 ? u / 0.2 : u > 0.55 ? (1 - u) / 0.45 : 1);
      g.beginPath();
      g.moveTo(cx + Math.cos(q.a) * r0, cy + Math.sin(q.a) * r0);
      g.lineTo(cx + Math.cos(q.a - q.w) * r1, cy + Math.sin(q.a - q.w) * r1);
      g.lineTo(cx + Math.cos(q.a + q.w) * r1, cy + Math.sin(q.a + q.w) * r1);
      g.closePath(); g.fill();
    }

    // 4) 가장자리 섬광: 가속을 시작하는 순간 화면 둘레가 환하게 번쩍입니다
    var gl = Math.min(0.75, 0.16 * o.level + 0.55 * o.kick);
    if (gl > 0.01) {
      var e2 = g.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
      e2.addColorStop(0, 'rgba(205,230,255,0)'); e2.addColorStop(1, 'rgba(205,230,255,' + gl.toFixed(3) + ')');
      g.globalAlpha = 1; g.fillStyle = e2; g.fillRect(0, 0, W, H);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    shown = true;
  }

  // o: { src, level, kick, cx, cy, dt(실제 시간), adv(재생 시간), sfx(글자 표시 여부), ax, ay(차의 화면 위치 CSS px), w, h(화면 CSS px) }
  function frame(o) { drawBlur(o); stepPops(o); }

  window.FX = { init: init, resize: resize, frame: frame, pop: pop, clearPops: clearPops };
})();
