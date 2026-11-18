// 절차적 차량 모델 3종(로드스터·왜건·패스트백). 차체는 길이 방향 단면을 이어 붙인 로프트 곡면이고,
// 휠 아치는 옆면 아래 가장자리를 들어 올려 만듭니다. 로고·엠블럼은 넣지 않습니다.
// 좌표: +X 전방, +Y 위, +Z 오른쪽. 원점은 휠베이스 중앙의 지면.
(function (root) {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function curve(pts) { // 제어점을 지나는 단조 3차 곡선
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), n = xs.length, d = [], i;
    for (i = 0; i < n; i++) {
      if (i === 0) d.push((ys[1] - ys[0]) / (xs[1] - xs[0]));
      else if (i === n - 1) d.push((ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]));
      else { var a = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]), b = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]); d.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b)); }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var k = 0; while (x > xs[k + 1]) k++;
      var h = xs[k + 1] - xs[k], f = (x - xs[k]) / h, f2 = f * f, f3 = f2 * f;
      return (2 * f3 - 3 * f2 + 1) * ys[k] + (f3 - 2 * f2 + f) * h * d[k] + (-2 * f3 + 3 * f2) * ys[k + 1] + (f3 - f2) * h * d[k + 1];
    };
  }
  function range(a, b, n) { var r = []; for (var i = 0; i <= n; i++) r.push(a + (b - a) * i / n); return r; }

  // ── 차량 제원 ─────────────────────────────────────────────────────
  // drive: 추정 채널(RPM·기어·스로틀·하중) 계산용. 기어비·종감속·타이어는 공개 제원, 질량(운전자 포함)·출력·공기저항·무게중심은 가정값.
  var ZF8 = [5.25, 3.36, 2.172, 1.72, 1.316, 1.0, 0.822, 0.64];
  function tyreCirc(w, ar, rim) { return Math.PI * (rim * 0.0254 + 2 * w / 1000 * ar / 100) * 0.97; }
  var SPECS = {
    z4: {
      id: 'z4', name: 'Z4 M40i', brand: ['Z4', 'M40i'], cluster: 'z4', body: '로드스터 · 흰색 · GT 윙',
      paint: { color: 0xf2f4f6, metalness: 0.0, roughness: 0.32 }, caliper: 0x1b4fd6, rim: 0x8c8170,
      D: { nose: 2.15, tail: -2.174, axF: 1.235, axR: -1.235, rT: 0.335, arch: 0.385, trackF: 0.805, trackR: 0.808, wF: 0.255, wR: 0.275, noseR: [0.5, 3.2], tailR: [0.3, 5] },
      width: [[-2.174, 0.84], [-1.9, 0.905], [-1.3, 0.932], [-0.6, 0.9], [0, 0.89], [0.6, 0.895], [1.235, 0.915], [1.7, 0.885], [2.15, 0.78]],
      shoulder: [[-2.174, 0.8], [-1.9, 0.865], [-1.3, 0.878], [-0.7, 0.84], [0, 0.805], [0.6, 0.792], [1.235, 0.792], [1.8, 0.715], [2.15, 0.6]],
      top: [[-2.174, 0.82], [-2.06, 0.935], [-1.7, 0.92], [-1.25, 0.905], [-0.6, 0.88], [0, 0.885], [0.5, 0.905], [1.0, 0.87], [1.5, 0.805], [1.9, 0.715], [2.15, 0.57]],
      cabin: { type: 'soft', x0: -1.36, x1: 0.58, split: -0.2,
        roof: [[-1.36, 0.88], [-1.2, 1.03], [-1.0, 1.185], [-0.75, 1.282], [-0.45, 1.304], [-0.2, 1.275], [0.02, 1.19], [0.3, 1.035], [0.58, 0.9]],
        width: [[-1.36, 0.6], [-1.1, 0.725], [-0.6, 0.775], [0, 0.762], [0.58, 0.7]] },
      glass: [[-0.74, 0.02, 0.1, 0.5], [-1.24, -0.98, 0.5, 1.0]],
      head: [0.49, 0.08, 0.44, 0.62], tail: [0.009, 0.434, 0.37, 0.47],
      front: 'kidney', grilleY: 0.5, exhaust: [0.56], mirror: [0.42, 0.945, 0.9], wing: true, brakeBar: [-2.09, 0.93],
      eye: [-0.5, 1.13, 0.36],
      drive: { gears: ZF8, finalDrive: 3.154, tyreCirc: tyreCirc(275, 35, 19), redline: 7000, idle: 750, massKg: 1700, powerW: 285e3, cdA: 0.62, crr: 0.012, mu: 1.0, driveEff: 0.9, traction: 0.55, wb: 2.47, track: 1.61, hcg: 0.47, torqueNm: 500 },
    },
    m340i: {
      id: 'm340i', name: 'M340i Touring', brand: ['M340i', 'Touring'], cluster: 'm340i', body: '왜건 · 파랑',
      paint: { color: 0x0f3a8c, metalness: 0.55, roughness: 0.3 }, caliper: 0x1b4fd6, rim: 0x4b4e53,
      D: { nose: 2.2255, tail: -2.4835, axF: 1.4255, axR: -1.4255, rT: 0.332, arch: 0.385, trackF: 0.787, trackR: 0.784, wF: 0.225, wR: 0.255, noseR: [0.5, 3.4], tailR: [0.28, 5.5] },
      width: [[-2.4835, 0.8], [-2.2, 0.875], [-1.4255, 0.9135], [-0.6, 0.895], [0, 0.89], [0.7, 0.895], [1.4255, 0.905], [1.9, 0.87], [2.2255, 0.76]],
      shoulder: [[-2.4835, 0.84], [-2.25, 0.93], [-1.43, 0.965], [-0.6, 0.95], [0, 0.935], [0.8, 0.9], [1.4255, 0.815], [1.95, 0.72], [2.2255, 0.62]],
      top: [[-2.4835, 0.86], [-2.38, 0.975], [-1.43, 0.985], [-0.6, 0.97], [0, 0.955], [0.8, 0.975], [1.2, 0.93], [1.7, 0.84], [2.05, 0.74], [2.2255, 0.6]],
      cabin: { type: 'hard', x0: -2.4, x1: 0.86,
        roof: [[-2.4, 0.96], [-2.3, 1.13], [-2.12, 1.345], [-1.95, 1.405], [-1.0, 1.44], [-0.25, 1.435], [0.1, 1.37], [0.45, 1.19], [0.86, 0.965]],
        width: [[-2.4, 0.7], [-2.0, 0.755], [-1.0, 0.775], [0.3, 0.765], [0.86, 0.73]] },
      glass: [[0.16, 0.8, 0.5, 1.0], [-0.42, 0.42, 0.1, 0.38], [-1.28, -0.5, 0.1, 0.38], [-1.92, -1.36, 0.12, 0.38], [-2.33, -2.12, 0.35, 1.0]],
      head: [0.5, 0.07, 0.42, 0.6], tail: [0.01, 0.42, 0.38, 0.5],
      front: 'kidney', grilleY: 0.57, grilleH: 0.2, exhaust: [0.52], mirror: [0.62, 1.0, 0.95], rails: [-1.75, -0.15, 1.452, 0.6], brakeBar: [-2.1, 1.36],
      eye: [-0.1, 1.2, 0.37],
      drive: { gears: ZF8, finalDrive: 2.813, tyreCirc: tyreCirc(255, 35, 19), redline: 7000, idle: 700, massKg: 1890, powerW: 285e3, cdA: 0.68, crr: 0.012, mu: 1.0, driveEff: 0.88, traction: 0.92, wb: 2.851, track: 1.57, hcg: 0.53, torqueNm: 500 },
    },
    stinger: {
      id: 'stinger', name: 'Stinger 3.3T', brand: ['Stinger', '3.3T'], cluster: 'stinger', body: '패스트백 · 그린 · 빨간 캘리퍼',
      paint: { color: 0x0d3a26, metalness: 0.55, roughness: 0.3 }, caliper: 0xd3121c, rim: 0x6c6f73,
      D: { nose: 2.2825, tail: -2.5475, axF: 1.4525, axR: -1.4525, rT: 0.335, arch: 0.39, trackF: 0.798, trackR: 0.81, wF: 0.225, wR: 0.255, noseR: [0.52, 3.3], tailR: [0.3, 5] },
      width: [[-2.5475, 0.8], [-2.25, 0.89], [-1.4525, 0.935], [-0.6, 0.915], [0, 0.91], [0.7, 0.915], [1.4525, 0.925], [1.95, 0.885], [2.2825, 0.76]],
      shoulder: [[-2.5475, 0.84], [-2.3, 0.94], [-1.45, 0.965], [-0.6, 0.94], [0, 0.92], [0.8, 0.885], [1.4525, 0.805], [2.0, 0.71], [2.2825, 0.6]],
      top: [[-2.5475, 0.86], [-2.44, 1.0], [-2.2, 1.015], [-1.45, 0.985], [-0.6, 0.96], [0, 0.94], [0.8, 0.955], [1.2, 0.915], [1.75, 0.825], [2.1, 0.72], [2.2825, 0.58]],
      cabin: { type: 'hard', x0: -2.26, x1: 0.86,
        roof: [[-2.26, 1.0], [-1.95, 1.12], [-1.45, 1.27], [-0.9, 1.375], [-0.3, 1.4], [0.1, 1.345], [0.45, 1.17], [0.86, 0.95]],
        width: [[-2.26, 0.6], [-1.9, 0.7], [-1.0, 0.77], [0.2, 0.765], [0.86, 0.73]] },
      glass: [[0.16, 0.8, 0.5, 1.0], [-0.42, 0.42, 0.1, 0.38], [-1.25, -0.5, 0.1, 0.38], [-1.72, -1.32, 0.12, 0.36], [-2.0, -1.2, 0.5, 1.0]],
      head: [0.52, 0.08, 0.42, 0.58], tail: [0.01, 0.5, 0.38, 0.48],
      front: 'tiger', grilleY: 0.56, exhaust: [0.42, 0.6], mirror: [0.62, 0.98, 0.96], hoodVents: true, lightBar: true, brakeBar: [-2.0, 1.12],
      eye: [-0.1, 1.17, 0.38],
      drive: { gears: [3.665, 2.396, 1.61, 1.19, 1.0, 0.826, 0.643, 0.556], finalDrive: 3.538, tyreCirc: tyreCirc(255, 35, 19), redline: 6500, idle: 700, massKg: 1900, powerW: 274e3, cdA: 0.7, crr: 0.012, mu: 1.0, driveEff: 0.88, traction: 0.92, wb: 2.905, track: 1.62, hcg: 0.54, torqueNm: 510 },
    },
  };

  function makeShape(sp) {
    var D = sp.D, widthBase = curve(sp.width), shoulder = curve(sp.shoulder), topC = curve(sp.top), roofY = curve(sp.cabin.roof), cabinW = curve(sp.cabin.width);
    function halfWidth(x) {
      var w = widthBase(x), e;
      if (x > D.nose - D.noseR[0]) { e = (x - (D.nose - D.noseR[0])) / D.noseR[0]; w *= Math.pow(Math.max(0, 1 - Math.pow(e, D.noseR[1])), 1 / D.noseR[1]); }
      if (x < D.tail + D.tailR[0]) { e = ((D.tail + D.tailR[0]) - x) / D.tailR[0]; w *= Math.pow(Math.max(0, 1 - Math.pow(e, D.tailR[1])), 1 / D.tailR[1]); }
      return Math.max(w, 0.003);
    }
    function lowEdge(x) {
      var xf = D.axF + 0.365, xr = D.axR - 0.465;
      var base = x > xf ? 0.17 + (x - xf) * 0.07 : (x < xr ? 0.2 + (xr - x) * 0.14 : 0.165);
      [D.axF, D.axR].forEach(function (a) { var dx = x - a; if (Math.abs(dx) < D.arch) base = Math.max(base, D.rT + Math.sqrt(D.arch * D.arch - dx * dx)); });
      return base;
    }
    var S_SIDE = 0.5;
    function body(x, s, sign) {
      var W = halfWidth(x), ys = shoulder(x), yl = Math.min(lowEdge(x), ys - 0.02), yt = Math.max(topC(x), ys + 0.005), y, z;
      if (s < S_SIDE) {
        var f = s / S_SIDE; y = yl + (ys - yl) * f;
        z = W * (1 - 0.04 * smoothstep(0.42, 0.18, y) - 0.05 * Math.pow(clamp((y - 0.5) / Math.max(0.05, ys - 0.5), 0, 1), 2));
      } else {
        var th = (s - S_SIDE) / (1 - S_SIDE) * Math.PI / 2;
        z = W * 0.95 * Math.pow(Math.cos(th), 0.7); y = ys + (yt - ys) * Math.pow(Math.sin(th), 0.85);
      }
      return [x, y, z * sign];
    }
    function cabin(x, s, sign) {
      var wb = cabinW(x), yb = shoulder(x) - 0.03, yr = Math.max(roofY(x), yb + 0.012), th = s * Math.PI / 2;
      return [x, yb + (yr - yb) * Math.pow(Math.sin(th), 0.7), wb * Math.pow(Math.cos(th), 0.55) * sign];
    }
    function stations() {
      var xs = [], n = 128, i;
      for (i = 0; i <= n; i++) xs.push(D.tail + (D.nose - D.tail) * i / n);
      [0.002, 0.008, 0.02, 0.045, 0.085].forEach(function (d) { xs.push(D.tail + d); xs.push(D.nose - d); });
      [0.004, 0.012, 0.025, 0.05, 0.085, 0.13].forEach(function (d) { [D.axF, D.axR].forEach(function (a) { xs.push(a - D.arch + d); xs.push(a + D.arch - d); }); });
      return xs.sort(function (a, b) { return a - b; }).filter(function (x, k, arr) { return k === 0 || x - arr[k - 1] > 1e-4; });
    }
    return { body: body, cabin: cabin, stations: stations, shoulder: shoulder, topC: topC, S_SIDE: S_SIDE };
  }

  function loft(THREE, surf, xs, ss) {
    var pos = [], idx = [], K = ss.length, ring = 2 * K - 1, i, j;
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < K; j++) pos.push.apply(pos, surf(xs[i], ss[j], 1));
      for (j = K - 2; j >= 0; j--) pos.push.apply(pos, surf(xs[i], ss[j], -1));
    }
    for (i = 0; i < xs.length - 1; i++) for (j = 0; j < ring - 1; j++) { var a = i * ring + j, b = (i + 1) * ring + j; idx.push(a, b, b + 1, a, b + 1, a + 1); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // 곡면 위에 살짝 띄운 패치(램프·벤트·유리)
  function patch(THREE, surf, x0, x1, s0, s1, nx, ns, lift, sign) {
    var pos = [], idx = [], i, j, e = 1e-3;
    for (i = 0; i <= nx; i++) for (j = 0; j <= ns; j++) {
      var x = x0 + (x1 - x0) * i / nx, s = s0 + (s1 - s0) * j / ns;
      var p = surf(x, s, sign), px = surf(x + e, s, sign), ps = surf(x, Math.min(1, s + e), sign);
      var ax = px[0] - p[0], ay = px[1] - p[1], az = px[2] - p[2], bx = ps[0] - p[0], by = ps[1] - p[1], bz = ps[2] - p[2];
      var n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx], l = Math.hypot(n[0], n[1], n[2]) || 1;
      if (n[1] * (p[1] - 0.45) + n[2] * p[2] < 0) l = -l;
      pos.push(p[0] + n[0] / l * lift, p[1] + n[1] / l * lift, p[2] + n[2] / l * lift);
    }
    for (i = 0; i < nx; i++) for (j = 0; j < ns; j++) {
      var a = i * (ns + 1) + j, b = a + ns + 1;
      if (sign > 0) idx.push(a, b, b + 1, a, b + 1, a + 1); else idx.push(a, b + 1, b, a, a + 1, b + 1); // 좌우 모두 바깥이 앞면
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function glowTexture(THREE, inner, outer) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, inner); grd.addColorStop(0.35, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function buildWheel(THREE, M, D, width, left) {
    var rootG = new THREE.Group(), spin = new THREE.Group(), face = new THREE.Group(), h = width / 2, r = D.rT, i;
    rootG.add(spin); spin.add(face);
    var prof = [[0.238, -h], [0.3, -h], [r - 0.011, -h + 0.012], [r, -h + 0.045], [r, h - 0.045], [r - 0.011, h - 0.012], [0.3, h], [0.238, h]]
      .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), M.tyre);
    tyre.rotation.x = Math.PI / 2; if (!M.simple) tyre.castShadow = true; spin.add(tyre);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, width * 0.92, 28, 1, true), M.rimDark);
    barrel.rotation.x = Math.PI / 2; spin.add(barrel);
    if (!M.simple) {
      var zf = h - 0.03; // 바깥면(로컬 +Z): 더블 5스포크
      var lip = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.012, 8, 36), M.rim); lip.position.z = zf + 0.012; face.add(lip);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.05, 20), M.rim); hub.rotation.x = Math.PI / 2; hub.position.z = zf; face.add(hub);
      for (i = 0; i < 5; i++) [-0.19, 0.19].forEach(function (off) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.024, 0.022), M.rim), a = i * Math.PI * 2 / 5 + off;
        sp.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, zf - 0.006); sp.rotation.z = a - off * 0.55; face.add(sp);
      });
      if (left) face.rotation.y = Math.PI;
      var side = left ? -1 : 1; // 디스크·캘리퍼(회전하지 않음)
      var disc = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.03, 28), M.disc.clone());
      disc.rotation.x = Math.PI / 2; disc.position.z = side * (h - 0.1); rootG.add(disc);
      var cal = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.07), M.caliper);
      cal.position.set(-0.15, 0.06, side * (h - 0.1)); cal.rotation.z = -0.4; rootG.add(cal);
      rootG.userData.disc = disc;
    }
    rootG.userData.spin = spin;
    return rootG;
  }

  function build(THREE, spec, opts) {
    spec = spec || SPECS.z4; opts = opts || {};
    var ghost = !!opts.ghost, D = spec.D, sh = makeShape(spec), M;
    if (ghost) {
      var gm = new THREE.MeshBasicMaterial({ color: 0xb98aff, transparent: true, opacity: 0.3, depthWrite: false });
      var gd = new THREE.MeshBasicMaterial({ color: 0xb98aff, transparent: true, opacity: 0.45, depthWrite: false });
      M = { paint: gm, glass: gd, fabric: gd, trim: gd, carbon: gd, tyre: gd, rimDark: gd, rim: gd, simple: true };
    } else {
      M = {
        // r128에서는 clearcoat와 DoubleSide를 같이 쓰면 검게 나오므로 단면 렌더링
        paint: new THREE.MeshPhysicalMaterial({ color: spec.paint.color, roughness: spec.paint.roughness, metalness: spec.paint.metalness, clearcoat: 1.0, clearcoatRoughness: 0.06 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e13, roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.1 }),
        fabric: new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide }),
        trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }),
        carbon: new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.38, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
        tyre: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.92 }),
        rimDark: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide }),
        rim: new THREE.MeshStandardMaterial({ color: spec.rim, roughness: 0.34, metalness: 0.9 }),
        disc: new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.5, metalness: 0.75, emissive: 0xff5a14, emissiveIntensity: 0 }),
        caliper: new THREE.MeshStandardMaterial({ color: spec.caliper, roughness: 0.4, metalness: 0.3 }),
        tail: new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.3, emissive: 0xff1a0c, emissiveIntensity: 0.45, side: THREE.DoubleSide }),
        head: new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.2, emissive: 0xcfe6ff, emissiveIntensity: 0.55, side: THREE.DoubleSide }),
        chrome: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.25, metalness: 0.95 }),
        plate: new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.6 }),
      };
    }

    var group = new THREE.Group(), chassis = new THREE.Group();
    group.add(chassis);
    function add(geo, mat, cast) { var m = new THREE.Mesh(geo, mat); if (cast && !ghost) m.castShadow = true; chassis.add(m); return m; }
    function box(w, h, d, mat, x, y, z) { var m = add(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

    // ── 차체·캐빈 ────────────────────────────────────────────────────
    add(loft(THREE, sh.body, sh.stations(), range(0, sh.S_SIDE, 9).concat(range(sh.S_SIDE, 1, 11).slice(1))), M.paint, true);
    var cb = spec.cabin, cs = range(0, 1, 12);
    if (cb.type === 'soft') {
      add(loft(THREE, sh.cabin, range(cb.split, cb.x1, 14), cs), M.glass, true);
      add(loft(THREE, sh.cabin, range(cb.x0, cb.split, 22), cs), M.fabric, true);
    } else add(loft(THREE, sh.cabin, range(cb.x0, cb.x1, 48), cs), M.paint, true);

    if (spec.wing) {
      var blade = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.028, 1.66), M.carbon); blade.position.set(-1.95, 1.165, 0); blade.rotation.z = -0.1; if (!ghost) blade.castShadow = true; chassis.add(blade);
      [-1, 1].forEach(function (sg) {
        box(0.34, 0.17, 0.014, M.carbon, -1.95, 1.15, sg * 0.835);
        box(0.15, 0.3, 0.016, M.carbon, -1.9, 1.03, sg * 0.4).rotation.z = 0.28;
      });
    }

    var wheels = [], flames = [], steerWheel = null;
    if (!ghost) {
      // ── 유리·램프·트림 패치 ────────────────────────────────────────
      [-1, 1].forEach(function (sg) {
        spec.glass.forEach(function (g) { add(patch(THREE, sh.cabin, g[0], g[1], g[2], g[3], 12, 6, 0.006, sg), M.glass); });
        add(patch(THREE, sh.body, D.nose - spec.head[0], D.nose - spec.head[1], spec.head[2], spec.head[3], 10, 5, 0.006, sg), M.head);
        add(patch(THREE, sh.body, D.tail + spec.tail[0], D.tail + spec.tail[1], spec.tail[2], spec.tail[3], 12, 3, 0.006, sg), M.tail);
        add(patch(THREE, sh.body, D.axF - 0.635, D.axF - 0.435, 0.14, 0.4, 4, 5, 0.006, sg), M.trim);            // 펜더 벤트
        add(patch(THREE, sh.body, D.axR + 0.405, D.axF - 0.405, 0.0, 0.1, 16, 2, 0.007, sg), M.trim);            // 사이드 스커트
        add(patch(THREE, sh.body, D.tail + 0.006, D.tail + 0.454, 0.0, 0.2, 10, 3, 0.007, sg), M.trim);          // 리어 디퓨저
        add(patch(THREE, sh.body, D.nose - 0.43, D.nose - 0.008, 0.0, 0.16, 10, 3, 0.007, sg), M.trim);          // 프런트 립
        if (spec.hoodVents) add(patch(THREE, sh.body, D.axF - 0.3, D.axF - 0.05, 0.8, 0.9, 5, 3, 0.006, sg), M.trim);
        var mir = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), M.trim); mir.scale.set(1.25, 0.72, 0.95); mir.position.set(spec.mirror[0], spec.mirror[1], sg * spec.mirror[2]); chassis.add(mir);
        box(0.05, 0.03, 0.12, M.trim, spec.mirror[0], spec.mirror[1] - 0.045, sg * (spec.mirror[2] - 0.08));
        box(0.1, 0.13, 0.3, M.trim, D.nose - 0.13, 0.29, sg * 0.6).rotation.y = -sg * 0.62;
        if (spec.front === 'kidney') {
          var gh = spec.grilleH || 0.15;
          box(0.062, gh + 0.02, 0.38, M.chrome, D.nose - 0.052, spec.grilleY, sg * 0.2).rotation.y = -sg * 0.16;
          box(0.06, gh, 0.36, M.trim, D.nose - 0.045, spec.grilleY, sg * 0.2).rotation.y = -sg * 0.16;
        } else box(0.07, 0.15, 0.5, M.trim, D.nose - 0.06, spec.grilleY, sg * 0.25).rotation.y = -sg * 0.2;
        if (spec.rails) box(spec.rails[1] - spec.rails[0], 0.025, 0.03, M.trim, (spec.rails[0] + spec.rails[1]) / 2, spec.rails[2], sg * spec.rails[3]);
        spec.exhaust.forEach(function (ez) {
          var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.12, 16, 1, true), M.chrome);
          tip.rotation.z = Math.PI / 2; tip.scale.set(1, 1, 1.4); tip.position.set(D.tail + 0.024, 0.275, sg * ez); chassis.add(tip);
        });
        var fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,240,200,1)', 'rgba(255,120,20,0.7)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        fl.position.set(D.tail - 0.15, 0.28, sg * spec.exhaust[0]); fl.scale.set(0.55, 0.3, 1); chassis.add(fl); flames.push(fl);
      });
      if (spec.front === 'tiger') box(0.07, 0.13, 0.36, M.trim, D.nose - 0.045, spec.grilleY - 0.012, 0);
      box(0.08, 0.14, 0.9, M.trim, D.nose - 0.05, 0.27, 0);
      box(0.02, 0.115, 0.5, M.plate, D.tail - 0.002, 0.59, 0);                                   // 번호판(빈 판)
      box(0.02, 0.014, 0.36, M.tail, spec.brakeBar[0], spec.brakeBar[1], 0);                      // 보조 제동등
      if (spec.lightBar) box(0.02, 0.03, 1.2, M.tail, D.tail + 0.004, 0.87, 0);
      // 바닥·휠하우스·실내(어두운 속)
      box(D.nose - D.tail - 0.62, 0.12, 1.44, M.trim, (D.nose + D.tail) / 2, 0.23, 0);
      [D.axF, D.axR].forEach(function (ax) {
        [-1, 1].forEach(function (sg) {
          var well = new THREE.Mesh(new THREE.CylinderGeometry(D.arch + 0.004, D.arch + 0.004, 0.36, 24, 1, true, Math.PI / 2, Math.PI), M.trim);
          well.rotation.x = Math.PI / 2; well.position.set(ax, D.rT, sg * 0.73); chassis.add(well);
        });
        box(0.74, 0.5, 1.1, M.trim, ax, 0.5, 0);
      });
      var ex = spec.eye[0], belt = sh.shoulder(ex);
      box(cb.x1 - cb.x0 - 0.5, 0.42, 1.36, M.trim, (cb.x0 + cb.x1) / 2 - 0.1, belt - 0.27, 0);    // 실내 바닥
      box(0.42, 0.1, 1.42, M.trim, cb.x1 - 0.34, sh.shoulder(cb.x1 - 0.3), 0);                    // 대시보드
      steerWheel = new THREE.Group();
      steerWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 8, 28), M.trim));
      steerWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.02), M.trim));
      var spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), M.trim); spoke2.position.y = -0.085; steerWheel.add(spoke2);
      var pivot = new THREE.Group(); pivot.position.set(ex + 0.47, spec.eye[1] - 0.2, -spec.eye[2]); pivot.rotation.y = Math.PI / 2; pivot.rotateX(0.35);
      pivot.add(steerWheel); chassis.add(pivot);
      // 접지 그림자
      var blob = new THREE.Mesh(new THREE.PlaneGeometry((D.nose - D.tail) * 1.3, 3.0), new THREE.MeshBasicMaterial({ map: glowTexture(THREE, 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.5)'), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.set((D.nose + D.tail) / 2, 0.035, 0); blob.renderOrder = 2; group.add(blob);
    }

    [[D.axF, D.trackF, D.wF, true], [D.axR, D.trackR, D.wR, false]].forEach(function (a) {
      [-1, 1].forEach(function (sg) {
        var w = buildWheel(THREE, M, D, a[2], sg < 0);
        w.position.set(a[0], D.rT, sg * a[1]); w.userData.front = a[3];
        group.add(w); wheels.push(w);
      });
    });

    var flameT = 0;
    return {
      group: group, chassis: chassis, spec: spec,
      // steer(rad, +좌), spin(rad 누적), roll/pitch(rad), brake(0..1), heat(0..1), flame, dt
      set: function (s) {
        chassis.rotation.x = s.roll || 0; chassis.rotation.z = s.pitch || 0;
        for (var i = 0; i < wheels.length; i++) {
          var w = wheels[i];
          if (w.userData.front) w.rotation.y = s.steer || 0;
          w.userData.spin.rotation.z = -(s.spin || 0);
          if (w.userData.disc) w.userData.disc.material.emissiveIntensity = (s.heat || 0) * (w.userData.front ? 2.2 : 1.1);
        }
        if (!ghost) {
          M.tail.emissiveIntensity = 0.45 + 2.6 * clamp((s.brake || 0) * 6, 0, 1);
          steerWheel.rotation.z = -(s.steer || 0) * 13;
          if (s.flame) flameT = 0.16;
          flameT = Math.max(0, flameT - (s.dt || 0));
          flames.forEach(function (f, k) { f.material.opacity = flameT > 0 ? 0.55 + 0.45 * Math.sin((flameT * 90) + k) : 0; f.scale.x = 0.45 + flameT * 2.2; });
        }
      },
      dispose: function () {
        group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      },
    };
  }

  root.Car = { build: build, SPECS: SPECS, ORDER: ['z4', 'm340i', 'stinger'] };
})(typeof self !== 'undefined' ? self : this);
