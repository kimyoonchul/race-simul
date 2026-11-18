// 서킷 월드: 기준선(등록 서킷은 실제 지도 중심선, 그 외는 GPS 주행선)에서 트랙 리본·연석·레이싱 라인·코너 표지·주변 환경을 생성
// 월드 좌표: X = 동쪽, Z = -북쪽, Y = 위
(function (root) {
  'use strict';

  var HW0 = 5.5; // 트랙 반폭(m) 기본값 — GPS 주행선 기준으로 그릴 때의 표시용 폭. 등록 서킷은 venue.hw를 씁니다

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function canvasTex(THREE, w, h, draw, repeat) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  // 중심선 점들(pts: {x,z,nx,nz})을 따라 좌우 오프셋 a..b 의 띠
  function ribbon(THREE, pts, a, b, y, opt) {
    opt = opt || {};
    var n = pts.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), col = opt.color ? new Float32Array(n * 6) : null, idx = [], i, d = 0;
    for (i = 0; i < n; i++) {
      var p = pts[i], oa = typeof a === 'function' ? a(i) : a, ob = typeof b === 'function' ? b(i) : b;
      if (i > 0) d += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      pos[i * 6] = p.x + p.nx * oa; pos[i * 6 + 1] = y; pos[i * 6 + 2] = p.z + p.nz * oa;
      pos[i * 6 + 3] = p.x + p.nx * ob; pos[i * 6 + 4] = y; pos[i * 6 + 5] = p.z + p.nz * ob;
      uv[i * 4] = 0; uv[i * 4 + 1] = d / (opt.uvLen || 10); uv[i * 4 + 2] = 1; uv[i * 4 + 3] = d / (opt.uvLen || 10);
      if (col) { var c = opt.color(i); col[i * 6] = col[i * 6 + 3] = c[0]; col[i * 6 + 1] = col[i * 6 + 4] = c[1]; col[i * 6 + 2] = col[i * 6 + 5] = c[2]; }
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function decalMat(THREE, params, order) {
    var m = new THREE.MeshLambertMaterial(Object.assign({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order * 2 }, params));
    return m;
  }
  function label(THREE, text, opt) {
    opt = opt || {};
    var tex = canvasTex(THREE, 256, 128, function (g, w, h) {
      g.fillStyle = opt.bg || 'rgba(8,12,18,0.86)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = opt.fg || '#7fd0ff'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = opt.fg || '#e9eef5'; g.font = 'italic 800 84px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 6);
    });
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(opt.w || 3.2, (opt.w || 3.2) / 2, 1);
    return s;
  }

  function build(THREE, scene, renderer, S, bestSample) {
    var R = S.ref, NR = R.n, i, VN = S.venue || null, HW = VN ? VN.hw : HW0, world = { hw: HW }, rootG = new THREE.Group();
    scene.add(rootG); world.root = rootG;
    var pts = [];
    for (i = 0; i <= NR; i++) { var m = i % NR; pts.push({ x: R.x[m], z: -R.y[m], nx: R.nx[m], nz: -R.ny[m], k: R.k[m] }); }
    world.pts = pts;
    // 구간별 반폭: 서로 다른 구간이 가까이 지나는 곳은 도로가 겹치지 않게 간격의 절반까지만 그립니다.
    // (GPS만으로 만든 기준선은 실제보다 구간끼리 붙어 나오기도 합니다. 등록 서킷은 실제 간격이라 거의 줄지 않습니다)
    var hwArr = new Float32Array(NR + 1), far = Math.round(70 / R.spacing), q0, q1;
    for (q0 = 0; q0 < NR; q0 += 4) {
      var gap2 = Infinity;
      for (q1 = 0; q1 < NR; q1 += 4) {
        var da = Math.abs(q0 - q1); if (Math.min(da, NR - da) < far) continue;
        var dq = (R.x[q0] - R.x[q1]) * (R.x[q0] - R.x[q1]) + (R.y[q0] - R.y[q1]) * (R.y[q0] - R.y[q1]); if (dq < gap2) gap2 = dq;
      }
      var hq = Math.max(2.6, Math.min(HW, Math.sqrt(gap2) / 2 - 0.6));
      for (q1 = 0; q1 < 4 && q0 + q1 < NR; q1++) hwArr[q0 + q1] = hq;
    }
    for (var sm = 0; sm < 2; sm++) { // 폭이 갑자기 바뀌지 않게 다듬되, 좁은 쪽을 넘지 않게
      var tmpW = Float32Array.from(hwArr);
      for (q0 = 0; q0 < NR; q0++) { var acc = 0; for (q1 = -12; q1 <= 12; q1++) acc += tmpW[((q0 + q1) % NR + NR) % NR]; hwArr[q0] = Math.min(tmpW[q0], acc / 25); }
    }
    hwArr[NR] = hwArr[0];
    function hwAt(q) { return hwArr[((q % NR) + NR) % NR]; }
    world.hwAt = hwAt;

    // ── 하늘·안개·조명 ───────────────────────────────────────────────
    var horizon = new THREE.Color(0xcfdfea).convertSRGBToLinear(), zenith = new THREE.Color(0x4d8fd0).convertSRGBToLinear();
    var sunDir = new THREE.Vector3(0.55, 0.62, 0.56).normalize(); // 10월 말 오전, 남동쪽
    var skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { h: { value: horizon }, z: { value: zenith }, sun: { value: sunDir } },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 h; uniform vec3 z; uniform vec3 sun; varying vec3 d; void main(){ vec3 n = normalize(d); float t = pow(clamp(n.y,0.0,1.0),0.55); vec3 c = mix(h,z,t); float s = max(dot(n,sun),0.0); c += vec3(1.0,0.93,0.8)*(pow(s,350.0)*3.0 + pow(s,12.0)*0.12); if(n.y<0.0) c = mix(h, vec3(0.07,0.10,0.06), clamp(-n.y*6.0,0.0,1.0)); gl_FragColor = vec4(c,1.0);\n#include <encodings_fragment>\n}',
    });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMat);
    sky.renderOrder = -10; rootG.add(sky); world.sky = sky;
    scene.fog = new THREE.Fog(0x000000, 350, 2600); scene.fog.color.copy(horizon);
    world.fog = scene.fog;
    try {
      var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat));
      scene.environment = pm.fromScene(envScene, 0.03).texture; pm.dispose();
    } catch (e) { /* 환경맵 없이도 동작 */ }

    rootG.add(new THREE.HemisphereLight(0xdfeeff, 0x54603f, 0.55));
    var sun = new THREE.DirectionalLight(0xfff2de, 1.55);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 10; sc.far = 160;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    rootG.add(sun); rootG.add(sun.target);
    world.sun = sun; world.sunDir = sunDir;

    // ── 지면 ─────────────────────────────────────────────────────────
    var grassTex = canvasTex(THREE, 512, 512, function (g, w, h) {
      g.fillStyle = '#5d7440'; g.fillRect(0, 0, w, h);
      var r = rng(7), k;
      for (k = 0; k < 2600; k++) {
        var tone = r(); g.fillStyle = tone < 0.4 ? 'rgba(120,128,62,0.22)' : tone < 0.75 ? 'rgba(58,84,44,0.25)' : 'rgba(150,140,80,0.16)';
        var s = 4 + r() * 22; g.beginPath(); g.ellipse(r() * w, r() * h, s, s * (0.4 + r() * 0.6), r() * 3.14, 0, 6.3); g.fill();
      }
    }, true);
    grassTex.repeat.set(140, 140);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshLambertMaterial({ map: grassTex }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; rootG.add(ground);

    // ── 트랙 ─────────────────────────────────────────────────────────
    var asphalt = canvasTex(THREE, 256, 512, function (g, w, h) {
      g.fillStyle = '#34363a'; g.fillRect(0, 0, w, h);
      var r = rng(21), k;
      for (k = 0; k < 9000; k++) { var v = 30 + r() * 50; g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',0.5)'; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
      var grd = g.createLinearGradient(0, 0, w, 0); // 주행선 러버
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.36, 'rgba(0,0,0,0.05)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.3)'); grd.addColorStop(0.64, 'rgba(0,0,0,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(15,15,17,0.35)'; g.lineWidth = 1.2;
      for (k = 0; k < 7; k++) { g.beginPath(); var x0 = r() * w; g.moveTo(x0, 0); g.bezierCurveTo(x0 + 20, h * 0.3, x0 - 20, h * 0.6, x0 + 6, h); g.stroke(); }
    }, true);
    var verge = new THREE.Mesh(ribbon(THREE, pts, function (q) { return hwAt(q) + Math.min(3.2, hwAt(q) * 0.6); }, function (q) { return -hwAt(q) - Math.min(3.2, hwAt(q) * 0.6); }, 0.012), decalMat(THREE, { color: 0x4f6638 }, 1));
    verge.receiveShadow = true; rootG.add(verge);
    var road = new THREE.Mesh(ribbon(THREE, pts, hwAt, function (q) { return -hwAt(q); }, 0.03, { uvLen: 14 }), decalMat(THREE, { map: asphalt }, 2));
    road.receiveShadow = true; rootG.add(road);
    var lineMat = decalMat(THREE, { color: 0xe8e8e2 }, 3);
    rootG.add(new THREE.Mesh(ribbon(THREE, pts, function (q) { return hwAt(q) - 0.2; }, function (q) { return hwAt(q) - 0.42; }, 0.045), lineMat));
    rootG.add(new THREE.Mesh(ribbon(THREE, pts, function (q) { return -hwAt(q) + 0.2; }, function (q) { return -hwAt(q) + 0.42; }, 0.045), lineMat));

    // 연석: 코너 안쪽에 빨강/흰색
    var kPos = [], kCol = [], kIdx = [], seg = Math.max(1, Math.round(2.2 / R.spacing));
    S.corners.forEach(function (c) {
      var a = Math.round(c.u0 * NR) - Math.round(8 / R.spacing), b = Math.round(c.u1 * NR) + Math.round(8 / R.spacing), side = c.dir === 'L' ? 1 : -1, q;
      if (b < a) b += NR;
      for (q = a; q < b; q += seg) {
        var p0 = pts[((q % NR) + NR) % NR], p1 = pts[(((q + seg) % NR) + NR) % NR], red = ((q / seg) | 0) % 2 === 0, base = kPos.length / 3, h0 = hwAt(q), h1 = hwAt(q + seg);
        if (h0 < HW - 0.8) continue; // 폭을 줄인 구간은 연석을 놓을 자리가 없음
        [[p0, h0], [p0, h0 + 1.15], [p1, h1 + 1.15], [p1, h1]].forEach(function (e) {
          kPos.push(e[0].x + e[0].nx * e[1] * side, 0.05, e[0].z + e[0].nz * e[1] * side);
          if (red) kCol.push(0.82, 0.1, 0.08); else kCol.push(0.93, 0.93, 0.9);
        });
        kIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    });
    var kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(kPos), 3));
    kg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(kCol), 3));
    kg.setIndex(kIdx); kg.computeVertexNormals();
    var kerbs = new THREE.Mesh(kg, decalMat(THREE, { vertexColors: true }, 4)); kerbs.receiveShadow = true; rootG.add(kerbs);

    // 레이싱 라인: 베스트랩의 제동(빨강)·가속(초록)·타력(노랑)
    var lineGeo = ribbon(THREE, pts, 0.28, -0.28, 0.06, {
      color: function (q) {
        var b = bestSample(Math.min(q, NR - 1) / NR);
        if (b.brk > 0.08) return [1.0, 0.16 + 0.1 * (1 - b.brk), 0.1];
        if (b.thr > 0.55) return [0.2, 0.92, 0.48];
        return [1.0, 0.78, 0.2];
      },
    });
    var racing = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10, fog: true }));
    racing.renderOrder = 1; rootG.add(racing); world.racingLine = racing;

    // 스타트/피니시: 체커 라인과 갠트리
    var p0 = pts[0], fwd = new THREE.Vector3(-p0.nz, 0, p0.nx); // 진행 방향(왼쪽 법선을 -90° 회전)
    var yawSF = Math.atan2(-fwd.z, fwd.x);
    var checker = canvasTex(THREE, 256, 32, function (g, w, h) {
      for (var a = 0; a < 16; a++) for (var b = 0; b < 2; b++) { g.fillStyle = (a + b) % 2 ? '#f2f2f2' : '#101010'; g.fillRect(a * 16, b * 16, 16, 16); }
    });
    var sfLine = new THREE.Mesh(new THREE.PlaneGeometry(1.6, HW * 2), decalMat(THREE, { map: checker }, 6));
    sfLine.geometry.rotateX(-Math.PI / 2); sfLine.geometry.rotateY(0);
    checker.center.set(0.5, 0.5); checker.rotation = Math.PI / 2;
    sfLine.position.set(p0.x, 0.062, p0.z); sfLine.rotation.y = yawSF; rootG.add(sfLine);
    var gantry = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.6 });
    [-1, 1].forEach(function (sg) { var post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7.2, 0.45), steel); post.position.set(0, 3.6, sg * (HW + 1.8)); post.castShadow = true; gantry.add(post); });
    var beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, HW * 2 + 4.2), steel); beam.position.set(0, 6.9, 0); gantry.add(beam);
    var signTex = canvasTex(THREE, 1024, 128, function (g, w, h) {
      g.fillStyle = '#0b1016'; g.fillRect(0, 0, w, h);
      for (var a = 0; a < 8; a++) for (var b = 0; b < 8; b++) { g.fillStyle = (a + b) % 2 ? '#f4f4f4' : '#0b1016'; g.fillRect(a * 16, b * 16, 16, 16); g.fillRect(w - 128 + a * 16, b * 16, 16, 16); }
      g.fillStyle = '#eef3f8'; g.font = 'italic 800 76px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('START  /  FINISH', w / 2, h / 2 + 4);
    });
    [1, -1].forEach(function (sg) {
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 3.4, 1.15), new THREE.MeshBasicMaterial({ map: signTex }));
      sign.position.set(sg * 0.27, 6.9, 0); sign.rotation.y = sg > 0 ? Math.PI / 2 : -Math.PI / 2; gantry.add(sign);
    });
    gantry.position.set(p0.x, 0, p0.z); gantry.rotation.y = yawSF; rootG.add(gantry);

    // 코너 표지(자동 검출 번호)·섹터 표지
    var signs = new THREE.Group(); rootG.add(signs); world.signs = signs;
    S.corners.forEach(function (c) {
      var p = pts[Math.round(c.uApex * NR) % NR], side = c.dir === 'L' ? -1 : 1; // 코너 바깥쪽
      var s = label(THREE, c.name, { fg: '#ffd166' });
      s.position.set(p.x + p.nx * side * (HW + 4.5), 2.6, p.z + p.nz * side * (HW + 4.5)); signs.add(s);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2), steel); pole.position.set(s.position.x, 1, s.position.z); signs.add(pole);
    });
    S.splitU.forEach(function (u, k) {
      var p = pts[Math.round(u * NR) % NR], s = label(THREE, 'S' + (k + 1) + ' ▸ S' + (k + 2), { fg: '#7fd0ff', w: 4.6 });
      s.position.set(p.x + p.nx * (HW + 3), 3.4, p.z + p.nz * (HW + 3)); signs.add(s);
      var bar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, HW * 2), decalMat(THREE, { color: 0x7fd0ff, transparent: true, opacity: 0.7 }, 6));
      bar.geometry.rotateX(-Math.PI / 2); bar.position.set(p.x, 0.062, p.z); bar.rotation.y = Math.atan2(-p.nx, -p.nz); rootG.add(bar);
    });

    // ── 진입·퇴장 도로와 패독 ────────────────────────────────────────
    var roadMat2 = decalMat(THREE, { color: 0x44474c }, 1.5);
    S.access.forEach(function (poly) {
      if (poly.length < 4) return;
      var ap = [], q;
      for (q = 0; q < poly.length; q++) {
        var a = poly[Math.max(0, q - 2)], b = poly[Math.min(poly.length - 1, q + 2)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
        ap.push({ x: poly[q][0], z: -poly[q][1], nx: -ty / tl, nz: -tx / tl });
      }
      var m2 = new THREE.Mesh(ribbon(THREE, ap, 3.4, -3.4, 0.02), roadMat2); m2.receiveShadow = true; rootG.add(m2);
    });
    var home = S.access.length ? S.access[0][0] : [0, 0];
    var realB = !!(VN && VN.buildings && VN.buildings.length); // 실제 건물 도형이 있으면 임시 패독·건물은 만들지 않음
    var pad = new THREE.Mesh(new THREE.CircleGeometry(46, 48), decalMat(THREE, { color: 0x45484d }, 1.2));
    pad.rotation.x = -Math.PI / 2; pad.position.set(home[0], 0.018, -home[1]); pad.receiveShadow = true; if (!realB) rootG.add(pad);

    // ── 등록 서킷: 지도 벡터(OpenStreetMap)의 피트 레인·부속 도로·주차장·물·건물 ──
    var blockPts = [], blockPolys = [];
    function polyPts(a) { var o = []; for (var q = 0; q + 1 < a.length; q += 2) o.push([a[q], a[q + 1]]); return o; }
    function lineRibbon(a, half, closed, y, mat) {
      var pp = polyPts(a), n = pp.length, ap = [], q;
      if (n < 2) return;
      if (closed) pp.push(pp[0]);
      for (q = 0; q < pp.length; q++) {
        var a2 = closed ? pp[(q - 1 + n) % n] : pp[Math.max(0, q - 1)], b2 = closed ? pp[(q + 1) % n] : pp[Math.min(pp.length - 1, q + 1)], tx = b2[0] - a2[0], ty = b2[1] - a2[1], tl = Math.hypot(tx, ty) || 1;
        ap.push({ x: pp[q][0], z: -pp[q][1], nx: -ty / tl, nz: -tx / tl });
        if (q > 0) { var sx = pp[q][0] - pp[q - 1][0], sy = pp[q][1] - pp[q - 1][1], sl = Math.hypot(sx, sy), ns = Math.max(1, Math.round(sl / 7)); for (var e = 0; e < ns; e++) blockPts.push([pp[q - 1][0] + sx * e / ns, pp[q - 1][1] + sy * e / ns, half + 5]); }
      }
      var m3 = new THREE.Mesh(ribbon(THREE, ap, half, -half, y), mat); m3.receiveShadow = true; rootG.add(m3);
    }
    function flatPoly(a, y, mat) {
      var pp = polyPts(a); if (pp.length < 3) return;
      var sh = new THREE.Shape(); pp.forEach(function (p, q) { if (q) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
      var m3 = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat); m3.rotation.x = -Math.PI / 2; m3.position.y = y; m3.receiveShadow = true; rootG.add(m3);
      blockPolys.push(pp);
    }
    if (VN) {
      var laneMat = decalMat(THREE, { color: 0x3b3d42 }, 1.8), svcMat = decalMat(THREE, { color: 0x4a4d52 }, 1.4);
      (VN.lanes || []).forEach(function (l) { lineRibbon(l.p, Math.min(HW, 4.2), !!l.c, 0.024, laneMat); });
      (VN.roads || []).forEach(function (rd) { lineRibbon(rd.p, rd.w / 2, false, 0.018, svcMat); });
      (VN.pads || []).forEach(function (pd) { flatPoly(pd.p, 0.016, decalMat(THREE, { color: pd.k === 'dirt' ? 0x7a6a4f : 0x36383c }, 1.3)); });
      (VN.parking || []).forEach(function (pk) { flatPoly(pk, 0.014, decalMat(THREE, { color: 0x53565b }, 1.2)); });
      (VN.water || []).forEach(function (wt) { flatPoly(wt, 0.012, decalMat(THREE, { color: 0x3f6f8f }, 1.1)); });
      // 건물: 바닥 도형을 높이만큼 세웁니다. 벽에는 층·창 무늬(가로 6m, 한 층 3.6m)
      var winTex = canvasTex(THREE, 64, 64, function (g, w, h) {
        g.fillStyle = '#e4e7ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#26323d'; g.fillRect(6, 14, w - 12, 30); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(6, 14, w - 12, 5);
      }, true);
      winTex.repeat.set(1 / 6, 1 / 3.6);
      var wallM = { main: new THREE.MeshLambertMaterial({ map: winTex }), box: new THREE.MeshLambertMaterial({ color: 0xcfd3d8 }), stand: new THREE.MeshLambertMaterial({ color: 0x8b95a1 }) };
      var roofM = { main: new THREE.MeshLambertMaterial({ color: 0xdfe3e7 }), box: new THREE.MeshLambertMaterial({ color: 0x9aa1a9 }), stand: new THREE.MeshLambertMaterial({ color: 0x5f6975 }) };
      (VN.buildings || []).forEach(function (b) {
        var pp = polyPts(b.p); if (pp.length < 3) return;
        var sh = new THREE.Shape(); pp.forEach(function (p, q) { if (q) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
        var k = wallM[b.k] ? b.k : 'box';
        var m3 = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: b.h, bevelEnabled: false }), [roofM[k], wallM[k]]);
        m3.rotation.x = -Math.PI / 2; m3.castShadow = true; m3.receiveShadow = true; rootG.add(m3);
        blockPolys.push(pp);
      });
    }
    function blocked(x, y) { // 도로·건물·주차장·물 위에는 나무를 심지 않음
      var q, a, b, inside;
      for (q = 0; q < blockPts.length; q++) if (Math.hypot(blockPts[q][0] - x, blockPts[q][1] - y) < blockPts[q][2]) return true;
      for (q = 0; q < blockPolys.length; q++) {
        var pp = blockPolys[q]; inside = false;
        for (a = 0, b = pp.length - 1; a < pp.length; b = a++) {
          if ((pp[a][1] > y) !== (pp[b][1] > y) && x < (pp[b][0] - pp[a][0]) * (y - pp[a][1]) / (pp[b][1] - pp[a][1]) + pp[a][0]) inside = !inside;
          if (Math.hypot(pp[a][0] - x, pp[a][1] - y) < 9) return true;
        }
        if (inside) return true;
      }
      return false;
    }
    // 건물: 주행 경로에서 가장 먼 방향에 배치
    var bestDir = 0, bestD = -1, a8;
    for (a8 = 0; a8 < 16; a8++) {
      var ang = a8 * Math.PI / 8, bx = home[0] + Math.cos(ang) * 62, by = home[1] + Math.sin(ang) * 62, dm = Infinity;
      S.access.forEach(function (poly) { poly.forEach(function (pp) { dm = Math.min(dm, Math.hypot(pp[0] - bx, pp[1] - by)); }); });
      for (i = 0; i < NR; i += 8) dm = Math.min(dm, Math.hypot(R.x[i] - bx, R.y[i] - by));
      if (dm > bestD) { bestD = dm; bestDir = ang; }
    }
    var bld = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.7 }), glassM = new THREE.MeshStandardMaterial({ color: 0x1c2a36, roughness: 0.15, metalness: 0.6 });
    var hall = new THREE.Mesh(new THREE.BoxGeometry(64, 9, 22), white); hall.position.y = 4.5; hall.castShadow = true; bld.add(hall);
    var band = new THREE.Mesh(new THREE.BoxGeometry(64.2, 4.2, 22.2), glassM); band.position.y = 3.2; bld.add(band);
    var roof = new THREE.Mesh(new THREE.BoxGeometry(70, 0.6, 27), white); roof.position.y = 9.4; bld.add(roof);
    bld.position.set(home[0] + Math.cos(bestDir) * 62, 0, -(home[1] + Math.sin(bestDir) * 62));
    bld.rotation.y = bestDir + Math.PI / 2; if (!realB) rootG.add(bld);

    // ── 나무(늦가을 단풍) ────────────────────────────────────────────
    var r = rng(1028), xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (i = 0; i < NR; i++) { xmin = Math.min(xmin, R.x[i]); xmax = Math.max(xmax, R.x[i]); ymin = Math.min(ymin, R.y[i]); ymax = Math.max(ymax, R.y[i]); }
    world.bounds = { xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
    function clear(x, y, d) {
      for (var q = 0; q < NR; q += 6) if (Math.hypot(R.x[q] - x, R.y[q] - y) < d) return false;
      for (var a = 0; a < S.access.length; a++) for (var b = 0; b < S.access[a].length; b += 3) if (Math.hypot(S.access[a][b][0] - x, S.access[a][b][1] - y) < d * 0.7) return false;
      if (!realB && Math.hypot(home[0] - x, home[1] - y) < 52) return false;
      if (!realB && Math.hypot(bld.position.x - x, -bld.position.z - y) < 44) return false;
      if (VN && blocked(x, y)) return false;
      return true;
    }
    var spots = [], tries = 0;
    while (spots.length < 420 && tries++ < 6000) {
      var far = spots.length >= 250, x, y;
      if (far) { var an = r() * Math.PI * 2, rad = 520 + r() * 380; x = world.bounds.cx + Math.cos(an) * rad; y = world.bounds.cy + Math.sin(an) * rad; }
      else { x = xmin - 170 + r() * (xmax - xmin + 340); y = ymin - 170 + r() * (ymax - ymin + 340); }
      if (clear(x, y, 19)) spots.push([x, y, 0.8 + r() * 0.9, r()]);
    }
    var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x4a3a2b }), spots.length);
    var crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
    var mt = new THREE.Matrix4(), q4 = new THREE.Quaternion(), col = new THREE.Color();
    var palette = [0x4f7a3a, 0x5d8a3c, 0xc98a2b, 0xd9a334, 0xb5512a, 0x8f3b22, 0x6f8f3a, 0xe0b040];
    spots.forEach(function (sp, k) {
      mt.compose(new THREE.Vector3(sp[0], 1.3 * sp[2], -sp[1]), q4, new THREE.Vector3(sp[2], sp[2], sp[2])); trunk.setMatrixAt(k, mt);
      mt.compose(new THREE.Vector3(sp[0], 4.4 * sp[2], -sp[1]), q4, new THREE.Vector3(sp[2], sp[2] * (0.9 + sp[3] * 0.5), sp[2])); crown.setMatrixAt(k, mt);
      crown.setColorAt(k, col.setHex(palette[(sp[3] * palette.length) | 0]));
    });
    crown.castShadow = true; rootG.add(trunk); rootG.add(crown);

    // 그림자 광원이 차를 따라다니도록
    world.follow = function (x, y, z) {
      sun.position.set(x + sunDir.x * 70, y + sunDir.y * 70, z + sunDir.z * 70);
      sun.target.position.set(x, y, z); sun.target.updateMatrixWorld();
      sky.position.set(x, 0, z);
    };
    world.dispose = function () {
      scene.remove(rootG);
      rootG.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(function (mm) { if (mm.map) mm.map.dispose(); mm.dispose(); }); // 건물은 재질이 배열(지붕·벽)
      });
      if (scene.environment) { scene.environment.dispose(); scene.environment = null; }
    };
    return world;
  }

  root.World = { build: build, HW: HW0 };
})(typeof self !== 'undefined' ? self : this);
