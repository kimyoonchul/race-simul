// 재생 루프·카메라·이벤트 연출
(function () {
  'use strict';
  var T = window.Telemetry, HZ = T.HZ, G = T.G;
  var $ = function (id) { return document.getElementById(id); };
  var appEl = $('app'), canvas = $('gl');
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function damp(a, b, rate, dt) { return a + wrapPi(b - a) * (1 - Math.exp(-rate * dt)); }

  var S, renderer, scene, camera, world, car, ghost, marker, gmarker, tvCams = [];
  var st = { t: 0, playing: true, rate: 1, cam: 'chase', ghost: true, line: true, sound: false, hud: true };
  var cs = { yaw: 0, drag: 0, zoom: 1, oYaw: 0.9, oPitch: 0.32, oDist: 8.5, topH: 78, topYaw: 0, tv: -1, snap: true, dragging: false };
  var cur = {}, gcur = {}, events = [], evPtr = 0, spin = 0, steer = 0, wall = 0, last = 0, prevGear = 0, prevThr = 0;
  var CAMS = ['chase', 'onboard', 'tv', 'top', 'orbit', 'map'];
  var v3a, v3b;

  function sample(t, o) {
    var f = clamp(t * HZ, 0, S.count - 1), a = Math.floor(f), b = Math.min(S.count - 1, a + 1), w = f - a;
    function L(arr) { return arr[a] + (arr[b] - arr[a]) * w; }
    o.t = t; o.k = a; o.x = L(S.x); o.y = L(S.y); o.hd = L(S.hd); o.v = L(S.v); o.aLat = L(S.aLat); o.aLong = L(S.aLong);
    o.thr = L(S.thr); o.brk = L(S.brk); o.rpm = L(S.rpm); o.gear = S.gear[a]; o.brakeT = L(S.brakeT); o.w = S.w[a];
    o.lap = S.lapIdx[a]; o.u = S.lapIdx[a] === S.lapIdx[b] ? L(S.u) : S.u[a];
    return o;
  }
  function lapTimeAtU(l, u) {
    var NQ = l.tAtU.length - 1, f = clamp(u, 0, 1) * NQ, i0 = Math.floor(f), i1 = Math.min(NQ, i0 + 1);
    return l.t0 + l.tAtU[i0] + (l.tAtU[i1] - l.tAtU[i0]) * (f - i0);
  }
  function bestSample(u) {
    var k = Math.min(S.count - 1, Math.round(lapTimeAtU(S.laps[S.best], u) * HZ));
    return { thr: S.thr[k], brk: S.brk[k], v: S.v[k] };
  }

  // ── 이벤트(배너·콜아웃) ──────────────────────────────────────────
  function buildEvents() {
    events = [];
    var fmt = HUD.fmtLap, bl = S.laps[S.best];
    function secStr(l) { return l.sectors.map(function (x, i) { return 'S' + (i + 1) + ' ' + x.toFixed(2); }).join('  ·  '); }
    S.laps.forEach(function (l, j) {
      events.push({ t: l.t1, fn: function () {
        if (j === S.best) HUD.banner('best', 'SESSION BEST · LAP ' + l.n, '오늘의 베스트 랩' + (l.prevBest != null ? ' — 이전 기록보다 ' + (l.prevBest - l.time).toFixed(2) + '초 단축' : ''), secStr(l), fmt(l.time), 5600);
        else if (l.prevBest == null) HUD.banner('', 'LAP ' + l.n, '첫 기록', secStr(l), fmt(l.time));
        else if (l.newBest) HUD.banner('best', 'NEW BEST LAP · LAP ' + l.n, '이전 기록보다 ' + (l.prevBest - l.time).toFixed(2) + '초 단축', secStr(l), fmt(l.time), 4600);
        else HUD.banner(l.time < S.laps[j - 1].time ? 'up' : '', 'LAP ' + l.n, '베스트 대비 +' + (l.time - l.prevBest).toFixed(2) + '초', secStr(l), fmt(l.time));
      } });
      events.push({ t: l.t0 + 4.3, fn: function () {
        var prev = j > 0 ? S.laps[j - 1].kind : 'out';
        if (l.kind === prev) return;
        if (l.kind === 'cool') HUD.banner('cool', 'COOL DOWN', '쿨다운 랩 — 브레이크와 타이어를 식힙니다', '디스크 온도는 열모델 추정값', Math.round(cur.brakeT / 10) * 10 + '°C', 4200);
        else if (l.kind === 'push') HUD.banner('push', 'PUSH LAP', '어택 시작', l.prevBest != null ? '현재 베스트 ' + fmt(l.prevBest) : '', 'ATTACK', 3200);
        else HUD.banner('top', 'WARM UP', '웜업 랩 — 타이어에 열을 넣는 중', '', 'LAP ' + l.n, 3000);
      } });
      // 스피드 트랩(랩 최고속 지점)
      var ka = Math.ceil(l.t0 * HZ), kb = Math.floor(l.t1 * HZ), km = ka, k;
      for (k = ka; k <= kb; k++) if (S.v[k] > S.v[km]) km = k;
      events.push({ t: km / HZ + 0.4, fn: function () { HUD.callout('<b>' + l.vmax.toFixed(0) + '</b> km/h<br>스피드 트랩 · LAP ' + l.n); } });
      // 코너 탈출 시 최저속 비교
      S.corners.forEach(function (c) {
        var m = c.min[j], ref = c.min[S.best]; if (!(m === m) || c.u1 < c.u0) return;
        events.push({ t: lapTimeAtU(l, Math.min(1, c.u1 + 0.004)), fn: function () {
          var d = m - ref, tag = j === S.best ? '' : (Math.abs(d) < 0.5 ? '베스트랩과 동일' : '베스트랩 대비 ' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(0));
          HUD.callout('<b class="' + (m >= c.bestMin - 0.01 ? 'best' : d >= 0 ? 'up' : 'down') + '">' + c.name + ' · ' + m.toFixed(0) + '</b> km/h<br>' + (tag || '코너 최저속'));
        } });
      });
    });
    events.push({ t: S.tTop, fn: function () { HUD.banner('top', 'TOP SPEED', '세션 최고 속도', 'LAP ' + (S.lapIdx[Math.round(S.tTop * HZ)] + 1), S.topSpeed.toFixed(0) + ' km/h', 3400); } });
    events.push({ t: S.tJoin + 1.5, fn: function () { HUD.banner('top', 'OUT LAP', '트랙 진입', '', 'GO', 2600); } });
    events.push({ t: S.laps[S.laps.length - 1].t1 + 4.3, fn: function () { HUD.banner('cool', 'IN LAP', '주행 종료 — 피트로 복귀합니다', '', 'BOX', 3600); } });
    events.push({ t: S.tExit + 2, fn: function () { HUD.banner('', 'SESSION COMPLETE', S.laps.length + '랩 · 최고 ' + S.topSpeed.toFixed(0) + ' km/h', '리포트 버튼(R)에서 전체 기록을 볼 수 있습니다', fmt(bl.time), 6000); } });
    events.sort(function (a, b) { return a.t - b.t; });
  }
  function syncEvents() { evPtr = 0; while (evPtr < events.length && events[evPtr].t <= st.t) evPtr++; }
  function fireEvents() { while (evPtr < events.length && events[evPtr].t <= st.t) { events[evPtr].fn(); evPtr++; } }

  // ── 재생 제어 ────────────────────────────────────────────────────
  function setPlaying(p) {
    st.playing = p;
    $('playIcon').setAttribute('d', p ? 'M3 1h4v14H3zM9 1h4v14H9z' : 'M3 1l11 7-11 7z');
  }
  function seek(t) {
    st.t = clamp(t, 0, S.duration - 0.01); cs.snap = true; syncEvents(); HUD.clearBanner(); HUD.callout('');
    if (st.t < S.duration - 0.5 && !st.playing && seek.autoplay) setPlaying(true);
  }
  function seekLap(j) { j = clamp(j, 0, S.laps.length - 1); seek(Math.max(0, S.laps[j].t0 - 3)); setPlaying(true); }
  function setCam(m) {
    st.cam = m; cs.snap = true; cs.drag = 0;
    Array.prototype.forEach.call($('cams').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.cam === m)); });
    if (marker) { marker.visible = m === 'map'; }
    world.fog.near = m === 'map' ? 4000 : m === 'top' ? 900 : 350; world.fog.far = m === 'map' ? 14000 : m === 'top' ? 4500 : 2600;
  }
  function toggle(id, key, fn) {
    st[key] = !st[key]; $(id).setAttribute('aria-pressed', String(st[key])); if (fn) fn(st[key]);
  }
  function sheet(id, open) {
    var el = $(id); el.hidden = open === undefined ? !el.hidden : !open;
    $(id === 'report' ? 'tReport' : 'tHelp').setAttribute('aria-pressed', String(!el.hidden));
  }

  // ── 카메라 ───────────────────────────────────────────────────────
  function buildTvCams() {
    var R = S.ref, n = Math.max(6, Math.round(R.len / 165)), i;
    tvCams = [];
    for (i = 0; i < n; i++) {
      var m = Math.round((i + 0.5) / n * R.n) % R.n, k = R.k[m];
      var side = Math.abs(k) > 0.004 ? (k > 0 ? -1 : 1) : (i % 2 ? 1 : -1), off = World.HW + 9 + (i % 3) * 3;
      tvCams.push(new THREE.Vector3(R.x[m] + R.nx[m] * side * off, 2.2 + (i % 4) * 1.5, -(R.y[m] + R.ny[m] * side * off)));
    }
  }
  function updateCamera(dt, px, pz) {
    var h = cur.hd, fx = Math.cos(h), fz = -Math.sin(h), fov = 56, snap = cs.snap;
    camera.up.set(0, 1, 0);
    if (st.cam === 'chase') {
      cs.yaw = snap ? h : damp(cs.yaw, h, 4.2, dt);
      if (!cs.dragging) cs.drag *= Math.exp(-2.2 * dt);
      var yaw = cs.yaw + cs.drag, back = (6.4 + cur.v * 0.022) * cs.zoom, ht = (2.05 + cur.v * 0.005) * cs.zoom;
      camera.position.set(px - Math.cos(yaw) * back, ht, pz + Math.sin(yaw) * back);
      camera.lookAt(px + fx * 2.6, 0.95, pz + fz * 2.6);
      fov = 55 + Math.min(21, cur.v * 0.37);
    } else if (st.cam === 'onboard') {
      var lx = -Math.sin(h), lz = -Math.cos(h), shake = cur.v * 0.00012;
      camera.position.set(px - fx * 0.5 + lx * 0.36, 1.13 + Math.sin(wall * 41) * shake, pz - fz * 0.5 + lz * 0.36);
      camera.lookAt(px + fx * 40 + lx * (0.36 + cur.aLat * 5), 0.9, pz + fz * 40 + lz * (0.36 + cur.aLat * 5));
      camera.rotateZ(-cur.aLat * 0.035);
      fov = 68 + Math.min(10, cur.v * 0.16);
    } else if (st.cam === 'tv') {
      var ax = px + fx * 22, az = pz + fz * 22, bi = 0, bd = Infinity, i;
      for (i = 0; i < tvCams.length; i++) { var d = Math.hypot(tvCams[i].x - ax, tvCams[i].z - az); if (d < bd) { bd = d; bi = i; } }
      if (cs.tv < 0 || snap || bd < Math.hypot(tvCams[cs.tv].x - ax, tvCams[cs.tv].z - az) * 0.8) cs.tv = bi;
      var c = tvCams[cs.tv], dist = Math.hypot(c.x - px, c.z - pz);
      camera.position.copy(c); camera.lookAt(px + fx * 1.2, 0.8, pz + fz * 1.2);
      fov = clamp(2 * Math.atan(7.5 / Math.max(6, dist)) * 180 / Math.PI, 5, 46);
    } else if (st.cam === 'top') {
      cs.topYaw = snap ? h : damp(cs.topYaw, h, 2.2, dt);
      camera.position.set(px, cs.topH, pz); camera.up.set(Math.cos(cs.topYaw), 0, -Math.sin(cs.topYaw));
      camera.lookAt(px + Math.cos(cs.topYaw) * 0.01, 0, pz - Math.sin(cs.topYaw) * 0.01);
      fov = 46;
    } else if (st.cam === 'orbit') {
      if (!cs.dragging) cs.oYaw += dt * 0.14;
      var cp = Math.cos(cs.oPitch);
      camera.position.set(px + cs.oDist * cp * Math.cos(cs.oYaw), 0.5 + cs.oDist * Math.sin(cs.oPitch), pz + cs.oDist * cp * Math.sin(cs.oYaw));
      camera.lookAt(px, 0.72, pz); fov = 42;
    } else { // map
      var b = world.bounds, asp = camera.aspect, ex = b.xmax - b.xmin + 150, ey = b.ymax - b.ymin + 150, land = asp > 1;
      fov = 30;
      var tan = Math.tan(fov * Math.PI / 360), H = land ? Math.max(ex / 2, ey / 2 / asp) / tan : Math.max(ey / 2, ex / 2 / asp) / tan;
      H *= 1.12;
      camera.position.set(b.cx, H, -b.cy);
      if (land) camera.up.set(1, 0, 0); else camera.up.set(0, 0, -1);
      camera.lookAt(b.cx, 0, -b.cy + 0.001 * (land ? 0 : 0));
    }
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = snap ? fov : camera.fov + (fov - camera.fov) * (1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
    cs.snap = false;
  }

  function resize() {
    var w = appEl.clientWidth, h = appEl.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function ringSprite(color) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
    g.strokeStyle = color; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 22, 0, 6.3); g.stroke(); g.fillStyle = color; g.beginPath(); g.arc(32, 32, 9, 0, 6.3); g.fill();
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true }));
    s.scale.set(0.05, 0.05, 1); s.renderOrder = 10; return s;
  }

  // ── 프레임 ───────────────────────────────────────────────────────
  function tick(now) {
    requestAnimationFrame(tick);
    frame(Math.min(0.1, (now - last) / 1000 || 0.016)); last = now;
  }
  function frame(dt) {
    wall += dt;
    if (st.playing) {
      st.t += dt * st.rate;
      if (st.t >= S.duration - 0.02) { st.t = S.duration - 0.02; setPlaying(false); sheet('report', true); }
      fireEvents();
    }
    sample(st.t, cur);
    var px = cur.x, pz = -cur.y, adv = st.playing ? dt * st.rate : 0;

    // 차량 자세
    spin += cur.v * adv / Car.dims.rT;
    var kappa = cur.v > 2.5 ? cur.aLat * G / (cur.v * cur.v) : 0;
    steer += (clamp(Math.atan(2.47 * kappa) * 1.25, -0.55, 0.55) - steer) * (1 - Math.exp(-10 * dt));
    var flame = false;
    if (st.playing && st.rate <= 2) {
      if (cur.gear > prevGear && prevGear > 0 && cur.rpm > 4300 && cur.thr > 0.5) flame = true;
      if (prevThr > 0.7 && cur.thr < 0.18 && cur.rpm > 4600) flame = true;
    }
    prevGear = cur.gear; prevThr += (cur.thr - prevThr) * (1 - Math.exp(-6 * dt));
    if (flame) Engine.pop();
    car.group.position.set(px, 0, pz); car.group.rotation.y = cur.hd;
    car.set({ steer: steer, spin: spin, roll: cur.aLat * 0.045, pitch: cur.aLong * 0.028, brake: cur.brk, heat: clamp((cur.brakeT - 280) / 240, 0, 1), flame: flame, dt: dt });
    world.follow(px, 0, pz);

    // 고스트(베스트랩)
    var gst = null;
    if (st.ghost && cur.lap >= 0 && cur.lap !== S.best) {
      var tau = st.t - S.laps[cur.lap].t0, bl = S.laps[S.best];
      if (tau <= bl.time) {
        sample(bl.t0 + tau, gcur);
        ghost.group.position.set(gcur.x, 0, -gcur.y); ghost.group.rotation.y = gcur.hd;
        ghost.set({ steer: 0, spin: spin, roll: gcur.aLat * 0.045, pitch: gcur.aLong * 0.028 });
        gst = gcur;
      }
    }
    ghost.group.visible = !!gst && st.cam !== 'onboard';
    marker.position.set(px, 1.5, pz);
    gmarker.visible = st.cam === 'map' && !!gst; if (gst) gmarker.position.set(gst.x, 1.5, -gst.y);
    car.group.visible = true;

    updateCamera(dt, px, pz);
    renderer.render(scene, camera);

    var delta = 0;
    if (cur.lap >= 0) delta = (st.t - S.laps[cur.lap].t0) - (lapTimeAtU(S.laps[S.best], cur.u) - S.laps[S.best].t0);
    var sweep = wall < 1.7 ? S.car.redline * Math.sin(clamp(wall / 1.7, 0, 1) * Math.PI) : 0;
    HUD.frame({ t: st.t, wall: wall, v: cur.v, rpm: Math.max(cur.rpm, sweep), gear: cur.gear, thr: cur.thr, brk: cur.brk, aLat: cur.aLat, aLong: cur.aLong, brakeT: cur.brakeT, lap: cur.lap, u: cur.u, w: cur.w, delta: delta, x: cur.x, y: cur.y, hd: cur.hd, ghost: gst });
    Engine.update(cur.rpm, cur.thr, cur.v, st.playing && st.rate <= 2);
  }

  // ── 입력 ─────────────────────────────────────────────────────────
  function bindInput() {
    $('play').addEventListener('click', function () { if (!st.playing && st.t >= S.duration - 0.5) seek(0); setPlaying(!st.playing); });
    $('cams').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setCam(b.dataset.cam); });
    $('rate').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; st.rate = +b.dataset.rate;
      Array.prototype.forEach.call($('rate').children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    $('tGhost').addEventListener('click', function () { toggle('tGhost', 'ghost'); });
    $('tLine').addEventListener('click', function () { toggle('tLine', 'line', function (v) { world.racingLine.visible = v; }); });
    $('tSound').addEventListener('click', function () { toggle('tSound', 'sound', function (v) { if (v) { if (!Engine.start()) { st.sound = false; $('tSound').setAttribute('aria-pressed', 'false'); } } else Engine.stop(); }); });
    $('tReport').addEventListener('click', function () { sheet('report'); });
    $('tHelp').addEventListener('click', function () { sheet('help'); });
    Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (s) {
      s.addEventListener('click', function (e) { if (e.target === s || e.target.hasAttribute('data-close')) sheet(s.id, false); });
    });

    var tlEl = $('timeline'), scrub = false;
    function tlSeek(e) { var r = tlEl.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width, 0, 1) * S.duration); }
    tlEl.addEventListener('pointerdown', function (e) { scrub = true; tlEl.setPointerCapture(e.pointerId); tlSeek(e); });
    tlEl.addEventListener('pointermove', function (e) { if (scrub) tlSeek(e); });
    tlEl.addEventListener('pointerup', function () { scrub = false; });

    var lastX = 0, lastY = 0;
    canvas.addEventListener('pointerdown', function (e) { cs.dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      if (!cs.dragging) return; var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      if (st.cam === 'orbit') { cs.oYaw += dx * 0.006; cs.oPitch = clamp(cs.oPitch + dy * 0.005, 0.04, 1.45); }
      else if (st.cam === 'chase') cs.drag = clamp(cs.drag + dx * 0.006, -3.1, 3.1);
      else if (st.cam === 'top') cs.topH = clamp(cs.topH * (1 + dy * 0.004), 25, 400);
    });
    function endDrag() { cs.dragging = false; }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); var f = Math.exp(e.deltaY * 0.0012);
      if (st.cam === 'orbit') cs.oDist = clamp(cs.oDist * f, 4.5, 60);
      else if (st.cam === 'chase') cs.zoom = clamp(cs.zoom * f, 0.6, 3.5);
      else if (st.cam === 'top') cs.topH = clamp(cs.topH * f, 25, 400);
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (k === ' ') { e.preventDefault(); $('play').click(); }
      else if (k === 'ArrowLeft') seek(st.t - 5);
      else if (k === 'ArrowRight') seek(st.t + 5);
      else if (k === '[' || k === ']') {
        var j = cur.lap >= 0 ? cur.lap : (st.t < S.laps[0].t0 ? -1 : S.laps.length);
        seekLap(k === ']' ? j + 1 : (st.t - (cur.lap >= 0 ? S.laps[cur.lap].t0 : 0) > 6 ? j : j - 1));
      }
      else if (k === 'b' || k === 'B') seekLap(S.best);
      else if (k >= '1' && k <= '6') setCam(CAMS[+k - 1]);
      else if (k === 'c' || k === 'C') setCam(CAMS[(CAMS.indexOf(st.cam) + 1) % CAMS.length]);
      else if (k === 'g' || k === 'G') $('tGhost').click();
      else if (k === 'l' || k === 'L') $('tLine').click();
      else if (k === 'm' || k === 'M') $('tSound').click();
      else if (k === 'r' || k === 'R') sheet('report');
      else if (k === '?' || k === '/') sheet('help');
      else if (k === 'h' || k === 'H') { st.hud = !st.hud; appEl.classList.toggle('hud-off', !st.hud); }
      else if (k === 'Escape') { sheet('report', false); sheet('help', false); }
    });
    window.addEventListener('resize', resize);
  }

  // ── 시작 ─────────────────────────────────────────────────────────
  function boot() {
    S = T.process(window.SESSION_RAW);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(56, 1, 0.3, 9000);
    v3a = new THREE.Vector3(); v3b = new THREE.Vector3();
    world = World.build(THREE, scene, renderer, S, bestSample);
    car = Car.build(THREE); scene.add(car.group);
    ghost = Car.build(THREE, { ghost: true }); scene.add(ghost.group);
    marker = ringSprite('#ffffff'); marker.visible = false; scene.add(marker);
    gmarker = ringSprite('#b98aff'); gmarker.visible = false; scene.add(gmarker);
    buildTvCams(); buildEvents();
    HUD.init(S, { seekLap: seekLap });
    bindInput(); resize();

    // 첫 플라잉 랩 직전에서 시작
    var startLap = S.laps.length > 1 ? S.laps[1] : S.laps[0];
    st.t = Math.max(0, startLap.t0 - 6); syncEvents();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setPlaying(!reduce);
    window.__replay = { st: st, S: S, seek: seek, setCam: setCam, cur: cur, cs: cs, frame: frame, scene: scene, car: car, world: world, renderer: renderer, camera: camera, advance: function (sec) { for (var i = 0; i < sec * 30; i++) frame(1 / 30); } };
    $('loading').classList.add('done');
    requestAnimationFrame(tick);
  }

  if (!window.THREE) { $('loading').textContent = '3D 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인하세요.'; return; }
  try { boot(); } catch (e) { $('loading').textContent = '시작 중 오류: ' + e.message; throw e; }
})();
