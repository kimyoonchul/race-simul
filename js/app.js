// 재생 루프·카메라·이벤트 연출·차량 전환·파일 열기
(function () {
  'use strict';
  var T = window.Telemetry, HZ = T.HZ, G = T.G;
  var $ = function (id) { return document.getElementById(id); };
  var appEl = $('app'), canvas = $('gl');
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function damp(a, b, rate, dt) { return a + wrapPi(b - a) * (1 - Math.exp(-rate * dt)); }

  var S, raw, spec, renderer, scene, camera, world, car, ghost, marker, gmarker, tvCams = [];
  var st = { t: 0, playing: true, rate: 1, cam: 'chase', ghost: true, line: true, sound: false, hud: true, car: 'z4' };
  var cs = { yaw: 0, drag: 0, zoom: 1, oYaw: 0.9, oPitch: 0.32, oDist: 8.5, topH: 78, topYaw: 0, tv: -1, snap: true, dragging: false, lg: 0 };
  var cur = {}, gcur = {}, events = [], evPtr = 0, spin = 0, steer = 0, wall = 0, last = 0, prevGear = 0, prevThr = 0;
  // 가속 연출 상태: b 지속 세기(0..1), kick 가속을 시작하는 순간의 한 방(1에서 사그라듦), kickS 카메라용으로 다듬은 kick
  // bk 강한 제동을 시작하는 순간의 흔들림, sfxN 효과음 글자를 좌우 번갈아 띄우기 위한 횟수
  var fxs = { b: 0, kick: 0, kickS: 0, armed: true, bk: 0, brkArmed: true, sfxN: 0 }, fxOn = false, fxV = null, reduceMotion = false, vw = 1, vh = 1;
  function sfxPop(kind, text) { if (fxOn && !reduceMotion && st.cam !== 'map') FX.pop(kind, text, fxs.sfxN++ % 2 ? 1 : -1); }
  var CAMS = ['chase', 'onboard', 'tv', 'top', 'orbit', 'map'];

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
      var ka = Math.ceil(l.t0 * HZ), kb = Math.floor(l.t1 * HZ), km = ka, k; // 스피드 트랩(랩 최고속 지점)
      for (k = ka; k <= kb; k++) if (S.v[k] > S.v[km]) km = k;
      events.push({ t: km / HZ + 0.4, fn: function () { HUD.callout('<b>' + l.vmax.toFixed(0) + '</b> km/h<br>스피드 트랩 · LAP ' + l.n); } });
      S.corners.forEach(function (c) { // 코너 탈출 시 최저속 비교
        var m = c.min[j], ref = c.min[S.best]; if (!(m === m) || c.u1 < c.u0) return;
        events.push({ t: lapTimeAtU(l, Math.min(1, c.u1 + 0.004)), fn: function () {
          var d = m - ref, tag = j === S.best ? '' : (Math.abs(d) < 0.5 ? '베스트랩과 동일' : '베스트랩 대비 ' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(0));
          HUD.callout('<b class="' + (m >= c.bestMin - 0.01 ? 'best' : d >= 0 ? 'up' : 'down') + '">' + c.name + ' · ' + m.toFixed(0) + '</b> km/h<br>' + (tag || '코너 최저속'));
        } });
      });
    });
    events.push({ t: S.tTop, fn: function () { var li = S.lapIdx[Math.round(S.tTop * HZ)]; HUD.banner('top', 'TOP SPEED', '세션 최고 속도', li >= 0 ? 'LAP ' + (li + 1) : '', S.topSpeed.toFixed(0) + ' km/h', 3400); } });
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
  function seek(t) { st.t = clamp(t, 0, S.duration - 0.05); cs.snap = true; syncEvents(); HUD.clearBanner(); HUD.callout(''); }
  function seekLap(j) { j = clamp(j, 0, S.laps.length - 1); seek(Math.max(0, S.laps[j].t0 - 3)); setPlaying(true); }
  function setCam(m) {
    st.cam = m; cs.snap = true; cs.drag = 0;
    Array.prototype.forEach.call($('cams').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.cam === m)); });
    if (marker) marker.visible = m === 'map';
    if (world) { world.fog.near = m === 'map' ? 4000 : m === 'top' ? 900 : 350; world.fog.far = m === 'map' ? 14000 : m === 'top' ? 4500 : 2600; }
  }
  function toggle(id, key, fn) { st[key] = !st[key]; $(id).setAttribute('aria-pressed', String(st[key])); if (fn) fn(st[key]); }
  function sheet(id, open) {
    var el = $(id); el.hidden = open === undefined ? !el.hidden : !open;
    $(id === 'report' ? 'tReport' : 'tHelp').setAttribute('aria-pressed', String(!el.hidden));
  }

  // ── 세션·차량 적재 ───────────────────────────────────────────────
  // 처리에 실패하면 예외를 던지고 기존 화면은 그대로 둡니다.
  function loadSession(newRaw, carId, keepTime) {
    var newSpec = Car.SPECS[carId] || Car.SPECS.z4;
    var S2 = T.process(newRaw, { car: newSpec.drive });
    S = S2; raw = newRaw; spec = newSpec; st.car = newSpec.id;
    if (world) world.dispose();
    if (car) { scene.remove(car.group); car.dispose(); scene.remove(ghost.group); ghost.dispose(); }
    world = World.build(THREE, scene, renderer, S, bestSample);
    world.racingLine.visible = st.line;
    car = Car.build(THREE, spec); scene.add(car.group);
    ghost = Car.build(THREE, spec, { ghost: true }); scene.add(ghost.group);
    buildTvCams(); buildEvents();
    HUD.init(S, { seekLap: seekLap }, spec);
    if (!keepTime) { var startLap = S.laps.length > 1 ? S.laps[1] : S.laps[0]; st.t = Math.max(0, startLap.t0 - 6); }
    st.t = clamp(st.t, 0, S.duration - 0.05);
    cs.tv = -1; setCam(st.cam); syncEvents(); HUD.clearBanner(); HUD.callout('');
    try { localStorage.setItem('race-simul-car', spec.id); } catch (e) { /* 저장 불가 환경은 무시 */ }
    window.__replay = { st: st, S: S, seek: seek, setCam: setCam, setCar: setCar, openText: openText, cur: cur, cs: cs, fx: fxs, frame: frame, scene: scene, car: car, world: world, renderer: renderer, camera: camera, advance: function (sec) { for (var i = 0; i < sec * 30; i++) frame(1 / 30); } };
  }
  function setCar(id) { if (id !== st.car && Car.SPECS[id]) loadSession(raw, id, true); }
  function openText(text, name) {
    try {
      var r = Parse.parse(text, name);
      loadSession(r, st.car, false);
      setPlaying(true);
      HUD.banner('up', '내 주행 불러옴', S.meta.venue + ' · ' + S.laps.length + '랩', name + ' — 이 브라우저 안에서만 처리했습니다', HUD.fmtLap(S.laps[S.best].time), 4600);
    } catch (e) {
      HUD.banner('push', '파일을 열 수 없습니다', e.message || String(e), name, '', 6000);
    }
  }
  function openFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () { openText(String(fr.result), file.name); };
    fr.onerror = function () { HUD.banner('push', '파일을 읽지 못했습니다', file.name, '', '', 5000); };
    fr.readAsText(file);
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
    // 가감속 반응: 가속하면 차가 앞으로 치고 나가고(카메라가 처지고 화각이 넓어짐), 감속하면 카메라가 차에 붙습니다
    var lgT = clamp(cur.aLong, -1.1, 0.8);
    cs.lg = snap ? lgT : cs.lg + (lgT - cs.lg) * (1 - Math.exp(-3.2 * dt));
    var pos = Math.max(0, cs.lg), dive = Math.min(0, cs.lg);
    // 가속 흔들림: 세기에 비례하고, 가속을 시작하는 순간 크게 한 번 흔들립니다
    // shA는 카메라 위치(m), shR은 시선 각도(rad). 시선까지 흔들어야 화면 전체가 흔들립니다.
    // 위치만 흔들면 lookAt이 반대로 돌아 상쇄되므로 시선은 같은 방향(음수)으로 더 돌립니다
    var shA = reduceMotion ? 0 : fxs.b * 0.07 + fxs.kick * 0.22 + fxs.bk * 0.16, shR = reduceMotion ? 0 : fxs.b * 0.004 + fxs.kick * 0.014 + fxs.bk * 0.01;
    var n1 = Math.sin(wall * 52.3) * 0.6 + Math.sin(wall * 87.1 + 1.7) * 0.4, n2 = Math.sin(wall * 61.7 + 0.9) * 0.6 + Math.sin(wall * 97.3 + 2.3) * 0.4, n3 = Math.sin(wall * 44.9 + 0.4);
    if (st.cam === 'chase') {
      cs.yaw = snap ? h : damp(cs.yaw, h, 4.2, dt);
      if (!cs.dragging) cs.drag *= Math.exp(-2.2 * dt);
      var base = 6.6 + cur.v * 0.022, kd = 1 + (dive * 1.5 + pos * 3.4 + fxs.kickS * 1.6) / base;
      var yaw = cs.yaw + cs.drag, back = base * kd * cs.zoom, ht = (2.1 + cur.v * 0.005) * kd * cs.zoom;
      camera.position.set(px - Math.cos(yaw) * back - Math.sin(yaw) * shA * n1, ht + shA * 0.7 * n2, pz + Math.sin(yaw) * back - Math.cos(yaw) * shA * n1);
      // 감속으로 카메라가 붙을 때 차가 계기판 뒤로 내려가지 않도록 시선을 차 쪽으로 당깁니다
      camera.lookAt(px + fx * (2.6 + dive * 2.0), 0.8 + dive * 0.45, pz + fz * (2.6 + dive * 2.0));
      camera.rotateX(-shR * n2); camera.rotateY(-shR * n1); camera.rotateZ(shA * 0.09 * n3);
      fov = 55 + Math.min(21, cur.v * 0.37) + dive * 5 + pos * 13 + fxs.kickS * 9;
    } else if (st.cam === 'onboard') {
      var e = spec.eye, lx = -Math.sin(h), lz = -Math.cos(h), shake = cur.v * 0.00012, shO = shA * 0.25;
      var eyeX = e[0] - cs.lg * 0.05; // 감속하면 몸이 앞으로 쏠림
      camera.position.set(px + fx * eyeX + lx * (e[2] + shO * n1), e[1] + Math.sin(wall * 41) * shake + shO * n2, pz + fz * eyeX + lz * (e[2] + shO * n1));
      camera.lookAt(px + fx * 40 + lx * (e[2] + cur.aLat * 5), 0.9 + cs.lg * 0.7, pz + fz * 40 + lz * (e[2] + cur.aLat * 5));
      camera.rotateX(-shR * 2.5 * n2); camera.rotateY(-shR * 2.5 * n1); camera.rotateZ(-cur.aLat * 0.035 + shA * 0.07 * n3);
      fov = 68 + Math.min(10, cur.v * 0.16) + dive * 5 + pos * 11 + fxs.kickS * 8;
    } else if (st.cam === 'tv') {
      var ax = px + fx * 22, az = pz + fz * 22, bi = 0, bd = Infinity, i;
      for (i = 0; i < tvCams.length; i++) { var d = Math.hypot(tvCams[i].x - ax, tvCams[i].z - az); if (d < bd) { bd = d; bi = i; } }
      if (cs.tv < 0 || cs.tv >= tvCams.length || snap || bd < Math.hypot(tvCams[cs.tv].x - ax, tvCams[cs.tv].z - az) * 0.8) cs.tv = bi;
      var c = tvCams[cs.tv], dist = Math.hypot(c.x - px, c.z - pz);
      camera.position.copy(c); camera.lookAt(px + fx * 1.2, 0.8, pz + fz * 1.2);
      fov = clamp(2 * Math.atan(7.5 / Math.max(6, dist)) * 180 / Math.PI, 5, 46);
    } else if (st.cam === 'top') {
      cs.topYaw = snap ? h : damp(cs.topYaw, h, 2.2, dt);
      camera.position.set(px, cs.topH, pz); camera.up.set(Math.cos(cs.topYaw), 0, -Math.sin(cs.topYaw));
      camera.lookAt(px, 0, pz);
      fov = 46;
    } else if (st.cam === 'orbit') {
      if (!cs.dragging) cs.oYaw += dt * 0.14;
      var cp = Math.cos(cs.oPitch);
      camera.position.set(px + cs.oDist * cp * Math.cos(cs.oYaw), 0.5 + cs.oDist * Math.sin(cs.oPitch), pz + cs.oDist * cp * Math.sin(cs.oYaw));
      camera.lookAt(px, 0.72, pz); fov = 42;
    } else { // map
      var b = world.bounds, asp = camera.aspect, ex = b.xmax - b.xmin + 150, ey = b.ymax - b.ymin + 150, land = (asp > 1) === (ey > ex);
      fov = 30;
      var tan = Math.tan(fov * Math.PI / 360), H = (land ? Math.max(ex / 2, ey / 2 / asp) : Math.max(ey / 2, ex / 2 / asp)) / tan * 1.12;
      camera.position.set(b.cx, H, -b.cy);
      if (land) camera.up.set(1, 0, 0); else camera.up.set(0, 0, -1);
      camera.lookAt(b.cx, 0, -b.cy);
    }
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = snap ? fov : camera.fov + (fov - camera.fov) * (1 - Math.exp(-6 * dt)); camera.updateProjectionMatrix(); }
    cs.snap = false;
  }

  function resize() {
    var w = appEl.clientWidth, h = appEl.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    vw = w; vh = h; if (fxOn) FX.resize(w, h);
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
    // 프레임이 낮아도 실제 시간대로 재생. __replay.hold는 점검용: 시간을 멈춘 채 화면만 다시 그립니다
    frame(window.__replay && window.__replay.hold ? 0 : Math.min(0.25, (now - last) / 1000 || 0.016)); last = now;
  }
  function frame(dt) {
    wall += dt;
    if (st.playing) {
      st.t += dt * st.rate;
      if (st.t >= S.duration - 0.05) { st.t = S.duration - 0.05; setPlaying(false); sheet('report', true); }
      fireEvents();
    }
    sample(st.t, cur);
    var px = cur.x, pz = -cur.y, adv = st.playing ? dt * st.rate : 0;

    // 가속 연출 세기: 속도가 늘어나는 정도(종가속도)를 따르고, 고속에서 전개 중이면 절반까지 유지합니다.
    // 감속·정지·일시정지·빨리감기에서는 0. 가속을 막 시작하는 순간에만 kick이 한 번 터집니다.
    var fxLive = st.playing && st.rate <= 2;
    var bRaw = Math.max(clamp((cur.aLong - 0.12) / 0.45, 0, 1), cur.aLong > 0.04 ? 0.5 * clamp((cur.thr - 0.55) / 0.4, 0, 1) : 0), bT = fxLive ? bRaw : 0;
    if (cs.snap) { fxs.b = bT; fxs.kick = fxs.kickS = fxs.bk = 0; fxs.armed = bRaw < 0.08; fxs.brkArmed = cur.aLong > -0.15; if (fxOn) FX.clearPops(); }
    else {
      fxs.b += (bT - fxs.b) * (1 - Math.exp(-(bT > fxs.b ? 7 : 4) * dt));
      if (bT > 0.4 && fxs.armed) { fxs.kick = 1; fxs.armed = false; sfxPop('acc', cur.v < 21 ? '부아앙~' : '부웅~'); } else if (bRaw < 0.08) fxs.armed = true; // 일시정지했다 이어 재생할 때 다시 터지지 않도록 실제 가속 여부로 판단
      // 강한 제동(0.4g 이상)을 시작하는 순간: 끼익~ 글자와 짧은 흔들림
      if (fxLive && cur.aLong < -0.4 && fxs.brkArmed) { fxs.bk = 1; fxs.brkArmed = false; sfxPop('brk', cur.v > 42 ? '끼이익~' : '끼익~'); } else if (cur.aLong > -0.15) fxs.brkArmed = true;
      fxs.kick *= Math.exp(-3.2 * dt); fxs.bk *= Math.exp(-5 * dt);
      fxs.kickS += (fxs.kick - fxs.kickS) * (1 - Math.exp(-14 * dt));
    }

    // 차량 자세
    spin += cur.v * adv / spec.D.rT;
    var kappa = cur.v > 2.5 ? cur.aLat * G / (cur.v * cur.v) : 0;
    steer += (clamp(Math.atan(S.car.wb * kappa) * 1.25, -0.55, 0.55) - steer) * (1 - Math.exp(-10 * dt));
    var flame = false;
    if (st.playing && st.rate <= 2) {
      if (cur.gear > prevGear && prevGear > 0 && cur.rpm > 4300 && cur.thr > 0.5) flame = true;
      if (prevThr > 0.7 && cur.thr < 0.18 && cur.rpm > 4600) flame = true;
    }
    prevGear = cur.gear; prevThr += (cur.thr - prevThr) * (1 - Math.exp(-6 * dt));
    if (flame) Engine.pop();
    car.group.position.set(px, 0, pz); car.group.rotation.y = cur.hd;
    car.set({ steer: steer, spin: spin, roll: cur.aLat * 0.045, pitch: cur.aLong * 0.04, brake: cur.brk, heat: clamp((cur.brakeT - 280) / 240, 0, 1), flame: flame, boost: fxs.b, kick: fxs.kick, dt: dt });
    world.follow(px, 0, pz);

    // 고스트(베스트랩)
    var gst = null;
    if (st.ghost && cur.lap >= 0 && cur.lap !== S.best) {
      var tau = st.t - S.laps[cur.lap].t0, bl = S.laps[S.best];
      if (tau <= bl.time) {
        sample(bl.t0 + tau, gcur);
        ghost.group.position.set(gcur.x, 0, -gcur.y); ghost.group.rotation.y = gcur.hd;
        ghost.set({ steer: 0, spin: spin, roll: gcur.aLat * 0.045, pitch: gcur.aLong * 0.04 });
        gst = gcur;
      }
    }
    ghost.group.visible = !!gst && st.cam !== 'onboard';
    marker.position.set(px, 1.5, pz);
    gmarker.visible = st.cam === 'map' && !!gst; if (gst) gmarker.position.set(gst.x, 1.5, -gst.y);

    updateCamera(dt, px, pz);
    renderer.render(scene, camera);
    if (fxOn) {
      // 화면 효과는 차를 따라가는 시점(추적·온보드)에서만. 소실점은 차 앞쪽 먼 지점을 화면에 투영해 잡습니다.
      var fxK = (st.cam === 'chase' || st.cam === 'onboard') && !reduceMotion ? 1 : 0;
      fxV.set(px + Math.cos(cur.hd) * 90, 1.2, pz - Math.sin(cur.hd) * 90).project(camera);
      var fwd = fxV.z < 1, fcx = fwd ? clamp(fxV.x * 0.5 + 0.5, 0.25, 0.75) : 0.5, fcy = fwd ? clamp(0.5 - fxV.y * 0.5, 0.2, 0.6) : 0.42;
      // 효과음 글자는 차 옆에 띄웁니다(온보드는 화면 가운데 기준, 전체 지도에서는 띄우지 않음)
      var ax = vw * 0.5, ay = vh * 0.5;
      if (st.cam !== 'onboard') { fxV.set(px, 0.9, pz).project(camera); if (fxV.z < 1) { ax = (fxV.x * 0.5 + 0.5) * vw; ay = (0.5 - fxV.y * 0.5) * vh; } }
      FX.frame({ src: canvas, level: fxs.b * fxK, kick: fxs.kick * fxK, cx: fcx, cy: fcy, dt: dt, adv: adv, sfx: st.cam !== 'map' && st.rate <= 2, ax: ax, ay: ay, w: vw, h: vh, tint: spec.jet ? spec.jet[0] : null });
    }

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
    $('cars').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setCar(b.dataset.car); });
    $('rate').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; st.rate = +b.dataset.rate;
      Array.prototype.forEach.call($('rate').children, function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
    $('tGhost').addEventListener('click', function () { toggle('tGhost', 'ghost'); });
    $('tLine').addEventListener('click', function () { toggle('tLine', 'line', function (v) { world.racingLine.visible = v; }); });
    $('tSound').addEventListener('click', function () { toggle('tSound', 'sound', function (v) { if (v) { if (!Engine.start()) { st.sound = false; $('tSound').setAttribute('aria-pressed', 'false'); } } else Engine.stop(); }); });
    $('tReport').addEventListener('click', function () { sheet('report'); });
    $('tHelp').addEventListener('click', function () { sheet('help'); });
    $('tFile').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', function () { openFile(this.files[0]); this.value = ''; });
    Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (s) {
      s.addEventListener('click', function (e) { if (e.target === s || e.target.hasAttribute('data-close')) sheet(s.id, false); });
    });

    // 끌어다 놓기
    var depth = 0;
    appEl.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { depth++; $('drop').hidden = false; e.preventDefault(); } });
    appEl.addEventListener('dragover', function (e) { if (!$('drop').hidden) e.preventDefault(); });
    appEl.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) $('drop').hidden = true; });
    appEl.addEventListener('drop', function (e) { depth = 0; $('drop').hidden = true; if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files[0]); } });

    var tlEl = $('timeline'), scrub = false;
    function tlSeek(e) { var r = tlEl.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width, 0, 1) * S.duration); }
    tlEl.addEventListener('pointerdown', function (e) { scrub = true; tlEl.setPointerCapture(e.pointerId); tlSeek(e); });
    tlEl.addEventListener('pointermove', function (e) { if (scrub) tlSeek(e); });
    tlEl.addEventListener('pointerup', function () { scrub = false; });
    tlEl.addEventListener('pointercancel', function () { scrub = false; });

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
      else if (k === 'v' || k === 'V') setCar(Car.ORDER[(Car.ORDER.indexOf(st.car) + 1) % Car.ORDER.length]);
      else if (k === 'g' || k === 'G') $('tGhost').click();
      else if (k === 'l' || k === 'L') $('tLine').click();
      else if (k === 'm' || k === 'M') $('tSound').click();
      else if (k === 'o' || k === 'O') $('tFile').click();
      else if (k === 'r' || k === 'R') sheet('report');
      else if (k === '?' || k === '/') sheet('help');
      else if (k === 'h' || k === 'H') { st.hud = !st.hud; appEl.classList.toggle('hud-off', !st.hud); }
      else if (k === 'Escape') { sheet('report', false); sheet('help', false); }
    });
    window.addEventListener('resize', resize);
  }

  // ── 시작 ─────────────────────────────────────────────────────────
  function boot() {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(56, 1, 0.3, 9000);
    marker = ringSprite('#ffffff'); marker.visible = false; scene.add(marker);
    gmarker = ringSprite('#b98aff'); gmarker.visible = false; scene.add(gmarker);
    fxV = new THREE.Vector3(); fxOn = !!(window.FX && $('fxc') && FX.init($('fxc'), $('sfx')));
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var saved = null; try { saved = localStorage.getItem('race-simul-car'); } catch (e) { /* 무시 */ }
    loadSession(window.SESSION_RAW, Car.SPECS[saved] ? saved : 'z4', false);
    bindInput(); resize();
    setPlaying(!reduceMotion);
    $('loading').classList.add('done');
    requestAnimationFrame(tick);
  }

  if (!window.THREE) { $('loading').textContent = '3D 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인하세요.'; return; }
  try { boot(); } catch (e) { $('loading').textContent = '시작 중 오류: ' + e.message; throw e; }
})();
