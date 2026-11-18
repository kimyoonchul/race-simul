// 절차적 로드스터 모델: 긴 보닛·짧은 데크, 검정 소프트탑, 카본 GT 윙.
// 차체는 길이 방향 단면을 이어 붙인 로프트 곡면(휠 아치는 옆면 아래 가장자리를 들어 올려 표현).
// 좌표: +X 전방, +Y 위, +Z 오른쪽. 원점은 휠베이스 중앙의 지면.
(function (root) {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  // 제어점을 지나는 단조 3차 곡선
  function curve(pts) {
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

  // 치수(m): 전장 4.324 · 전폭 1.864 · 전고 1.304 · 휠베이스 2.470
  var D = { nose: 2.15, tail: -2.174, axF: 1.235, axR: -1.235, rT: 0.335, arch: 0.385, trackF: 0.805, trackR: 0.808, wF: 0.255, wR: 0.275 };

  var widthBase = curve([[-2.174, 0.84], [-1.9, 0.905], [-1.3, 0.932], [-0.6, 0.9], [0, 0.89], [0.6, 0.895], [1.235, 0.915], [1.7, 0.885], [2.15, 0.78]]);
  function halfWidth(x) {
    var w = widthBase(x), e;
    if (x > D.nose - 0.5) { e = (x - (D.nose - 0.5)) / 0.5; w *= Math.pow(Math.max(0, 1 - Math.pow(e, 3.2)), 1 / 3.2); }
    if (x < D.tail + 0.3) { e = ((D.tail + 0.3) - x) / 0.3; w *= Math.pow(Math.max(0, 1 - Math.pow(e, 5)), 1 / 5); }
    return Math.max(w, 0.003);
  }
  var shoulder = curve([[-2.174, 0.8], [-1.9, 0.865], [-1.3, 0.878], [-0.7, 0.84], [0, 0.805], [0.6, 0.792], [1.235, 0.792], [1.8, 0.715], [2.15, 0.6]]);
  var topC = curve([[-2.174, 0.82], [-2.06, 0.935], [-1.7, 0.92], [-1.25, 0.905], [-0.6, 0.88], [0, 0.885], [0.5, 0.905], [1.0, 0.87], [1.5, 0.805], [1.9, 0.715], [2.15, 0.57]]);
  function lowEdge(x) {
    var base = x > 1.6 ? 0.17 + (x - 1.6) * 0.07 : (x < -1.7 ? 0.2 + (-1.7 - x) * 0.14 : 0.165);
    [D.axF, D.axR].forEach(function (a) {
      var dx = x - a;
      if (Math.abs(dx) < D.arch) base = Math.max(base, D.rT + Math.sqrt(D.arch * D.arch - dx * dx));
    });
    return base;
  }
  var S_SIDE = 0.5; // s < S_SIDE: 옆면, 그 위: 윗면
  function bodySurf(x, s, sign) {
    var W = halfWidth(x), ys = shoulder(x), yl = Math.min(lowEdge(x), ys - 0.02), yt = Math.max(topC(x), ys + 0.005), y, z;
    if (s < S_SIDE) {
      var f = s / S_SIDE; y = yl + (ys - yl) * f;
      var tuck = 0.04 * smoothstep(0.42, 0.18, y);
      var tum = 0.05 * Math.pow(clamp((y - 0.5) / Math.max(0.05, ys - 0.5), 0, 1), 2);
      z = W * (1 - tuck - tum);
    } else {
      var th = (s - S_SIDE) / (1 - S_SIDE) * Math.PI / 2;
      z = W * 0.95 * Math.pow(Math.cos(th), 0.7);
      y = ys + (yt - ys) * Math.pow(Math.sin(th), 0.85);
    }
    return [x, y, z * sign];
  }
  // 캐빈(앞유리 + 소프트탑)
  var roofY = curve([[-1.36, 0.88], [-1.2, 1.03], [-1.0, 1.185], [-0.75, 1.282], [-0.45, 1.304], [-0.2, 1.275], [0.02, 1.19], [0.3, 1.035], [0.58, 0.9]]);
  var cabinW = curve([[-1.36, 0.6], [-1.1, 0.725], [-0.6, 0.775], [0, 0.762], [0.58, 0.7]]);
  function cabinSurf(x, s, sign) {
    var wb = cabinW(x), yb = shoulder(x) - 0.03, yr = Math.max(roofY(x), yb + 0.012), th = s * Math.PI / 2;
    return [x, yb + (yr - yb) * Math.pow(Math.sin(th), 0.7), wb * Math.pow(Math.cos(th), 0.55) * sign];
  }

  function loft(THREE, surf, xs, ss) {
    var pos = [], idx = [], K = ss.length, ring = 2 * K - 1, i, j;
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < K; j++) pos.push.apply(pos, surf(xs[i], ss[j], 1));
      for (j = K - 2; j >= 0; j--) pos.push.apply(pos, surf(xs[i], ss[j], -1));
    }
    for (i = 0; i < xs.length - 1; i++) for (j = 0; j < ring - 1; j++) {
      var a = i * ring + j, b = (i + 1) * ring + j;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  // 곡면 위에 살짝 띄운 패치(램프·벤트·유리 등)
  function patch(THREE, surf, x0, x1, s0, s1, nx, ns, lift, sign) {
    var pos = [], idx = [], i, j, e = 1e-3;
    for (i = 0; i <= nx; i++) for (j = 0; j <= ns; j++) {
      var x = x0 + (x1 - x0) * i / nx, s = s0 + (s1 - s0) * j / ns;
      var p = surf(x, s, sign), px = surf(x + e, s, sign), ps = surf(x, Math.min(1, s + e), sign);
      var ax = px[0] - p[0], ay = px[1] - p[1], az = px[2] - p[2], bx = ps[0] - p[0], by = ps[1] - p[1], bz = ps[2] - p[2];
      var n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx], l = Math.hypot(n[0], n[1], n[2]) || 1;
      if (n[1] * (p[1] - 0.45) + n[2] * p[2] < 0) l = -l; // 바깥쪽으로
      pos.push(p[0] + n[0] / l * lift, p[1] + n[1] / l * lift, p[2] + n[2] / l * lift);
    }
    for (i = 0; i < nx; i++) for (j = 0; j < ns; j++) {
      var a = i * (ns + 1) + j, b = a + ns + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  function stations() {
    var xs = [], n = 124, i;
    for (i = 0; i <= n; i++) xs.push(D.tail + (D.nose - D.tail) * i / n);
    [0.002, 0.008, 0.02, 0.045, 0.085].forEach(function (d) { xs.push(D.tail + d); xs.push(D.nose - d); });
    [0.004, 0.012, 0.025, 0.05, 0.085, 0.13].forEach(function (d) { // 아치 가장자리를 매끈하게
      [D.axF, D.axR].forEach(function (a) { xs.push(a - D.arch + d); xs.push(a + D.arch - d); });
    });
    return xs.sort(function (a, b) { return a - b; }).filter(function (x, k, arr) { return k === 0 || x - arr[k - 1] > 1e-4; });
  }
  function range(a, b, n) { var r = []; for (var i = 0; i <= n; i++) r.push(a + (b - a) * i / n); return r; }

  function glowTexture(THREE, inner, outer) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, inner); grd.addColorStop(0.35, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function buildWheel(THREE, M, width, left) {
    var rootG = new THREE.Group(), spin = new THREE.Group(), face = new THREE.Group(), h = width / 2, r = D.rT, i;
    rootG.add(spin); spin.add(face);
    var prof = [[0.238, -h], [0.3, -h], [0.324, -h + 0.012], [r, -h + 0.045], [r, h - 0.045], [0.324, h - 0.012], [0.3, h], [0.238, h]]
      .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), M.tyre);
    tyre.rotation.x = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
    var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, width * 0.92, 28, 1, true), M.rimDark);
    barrel.rotation.x = Math.PI / 2; spin.add(barrel);
    if (!M.simple) {
      // 바깥면(로컬 +Z): 더블 5스포크
      var zf = h - 0.03;
      var lip = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.012, 8, 36), M.rim); lip.position.z = zf + 0.012; face.add(lip);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.05, 20), M.rim); hub.rotation.x = Math.PI / 2; hub.position.z = zf; face.add(hub);
      for (i = 0; i < 5; i++) [-0.19, 0.19].forEach(function (off) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.024, 0.022), M.rim), a = i * Math.PI * 2 / 5 + off;
        sp.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, zf - 0.006 - 0.0); sp.rotation.z = a - off * 0.55; face.add(sp);
      });
      if (left) face.rotation.y = Math.PI;
      // 디스크·캘리퍼(회전하지 않음)
      var side = left ? -1 : 1;
      var disc = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.03, 28), M.disc.clone());
      disc.rotation.x = Math.PI / 2; disc.position.z = side * (h - 0.1); rootG.add(disc);
      var cal = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.07), M.caliper);
      cal.position.set(-0.15, 0.06, side * (h - 0.1)); cal.rotation.z = -0.4; rootG.add(cal);
      rootG.userData.disc = disc;
    }
    rootG.userData.spin = spin;
    return rootG;
  }

  function build(THREE, opts) {
    opts = opts || {};
    var ghost = !!opts.ghost;
    var M;
    if (ghost) {
      var gm = new THREE.MeshBasicMaterial({ color: opts.color || 0xb57bff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      var gd = new THREE.MeshBasicMaterial({ color: opts.color || 0xb57bff, transparent: true, opacity: 0.45, depthWrite: false });
      M = { paint: gm, glass: gd, fabric: gd, trim: gd, carbon: gd, tyre: gd, rimDark: gd, rim: gd, simple: true };
    } else {
      M = {
        paint: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f6, roughness: 0.32, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.0 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e13, roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.4 }),
        fabric: new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide }),
        trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }),
        carbon: new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.38, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
        tyre: new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.92 }),
        rimDark: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide }),
        rim: new THREE.MeshStandardMaterial({ color: 0x8c8170, roughness: 0.34, metalness: 0.9 }),
        disc: new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.5, metalness: 0.75, emissive: 0xff5a14, emissiveIntensity: 0 }),
        caliper: new THREE.MeshStandardMaterial({ color: 0x1b4fd6, roughness: 0.4, metalness: 0.3 }),
        tail: new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.3, emissive: 0xff1a0c, emissiveIntensity: 0.45, side: THREE.DoubleSide }),
        head: new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.2, emissive: 0xcfe6ff, emissiveIntensity: 0.55, side: THREE.DoubleSide }),
        chrome: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.25, metalness: 0.95 }),
        plate: new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.6 }),
      };
    }

    var group = new THREE.Group(), chassis = new THREE.Group();
    group.add(chassis);
    function add(geo, mat, cast) { var m = new THREE.Mesh(geo, mat); if (cast && !ghost) m.castShadow = true; chassis.add(m); return m; }
    function box(w, h, d, mat, x, y, z, cast) { var m = add(new THREE.BoxGeometry(w, h, d), mat, cast); m.position.set(x, y, z); return m; }

    // ── 차체 ─────────────────────────────────────────────────────────
    var ss = range(0, S_SIDE, 9).concat(range(S_SIDE, 1, 11).slice(1));
    add(loft(THREE, bodySurf, stations(), ss), M.paint, true);
    // ── 캐빈: 앞유리(유리) + 소프트탑(직물) ───────────────────────────
    var cs = range(0, 1, 12);
    add(loft(THREE, cabinSurf, range(-0.2, 0.58, 14), cs), M.glass, true);
    add(loft(THREE, cabinSurf, range(-1.36, -0.2, 22), cs), M.fabric, true);
    // ── 윙 ───────────────────────────────────────────────────────────
    var wing = new THREE.Group(); chassis.add(wing);
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.028, 1.66), M.carbon); blade.position.set(-1.95, 1.165, 0); blade.rotation.z = -0.1; if (!ghost) blade.castShadow = true; wing.add(blade);
    [-1, 1].forEach(function (sg) {
      var ep = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.014), M.carbon); ep.position.set(-1.95, 1.15, sg * 0.835); wing.add(ep);
      var st = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.016), M.carbon); st.position.set(-1.9, 1.03, sg * 0.4); st.rotation.z = 0.28; wing.add(st);
    });

    var wheels = [], flames = [], tailMeshes = [], blob = null;
    if (!ghost) {
      // ── 유리·램프·트림 패치 ────────────────────────────────────────
      [-1, 1].forEach(function (sg) {
        add(patch(THREE, cabinSurf, -0.74, 0.02, 0.1, 0.5, 10, 6, 0.006, sg), M.glass);                 // 옆유리
        add(patch(THREE, bodySurf, 1.66, 2.07, 0.44, 0.62, 10, 5, 0.006, sg), M.head);                  // 헤드램프
        tailMeshes.push(add(patch(THREE, bodySurf, -2.165, -1.74, 0.37, 0.47, 12, 3, 0.006, sg), M.tail)); // 테일램프
        add(patch(THREE, bodySurf, 0.6, 0.8, 0.14, 0.4, 4, 5, 0.006, sg), M.trim);                      // 에어 브리더
        add(patch(THREE, bodySurf, -0.83, 0.83, 0.0, 0.1, 16, 2, 0.007, sg), M.trim);                   // 사이드 스커트
        add(patch(THREE, bodySurf, -2.168, -1.72, 0.0, 0.2, 10, 3, 0.007, sg), M.trim);                 // 리어 디퓨저
        add(patch(THREE, bodySurf, 1.72, 2.142, 0.0, 0.16, 10, 3, 0.007, sg), M.trim);                  // 프런트 립
      });
      add(patch(THREE, cabinSurf, -1.24, -0.98, 0.5, 1.0, 6, 6, 0.006, 1), M.glass);                     // 뒷유리
      add(patch(THREE, cabinSurf, -1.24, -0.98, 0.5, 1.0, 6, 6, 0.006, -1), M.glass);
      // 전면: 키드니 그릴·하단 흡기구
      [-1, 1].forEach(function (sg) {
        var k = box(0.06, 0.15, 0.36, M.trim, 2.105, 0.5, sg * 0.2); k.rotation.y = -sg * 0.16;
        var kf = box(0.062, 0.17, 0.38, M.chrome, 2.098, 0.5, sg * 0.2); kf.rotation.y = -sg * 0.16;
        var ai = box(0.1, 0.13, 0.3, M.trim, 2.02, 0.29, sg * 0.6); ai.rotation.y = -sg * 0.62;
        var mir = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), M.trim); mir.scale.set(1.25, 0.72, 0.95); mir.position.set(0.42, 0.945, sg * 0.9); chassis.add(mir);
        box(0.05, 0.03, 0.12, M.trim, 0.42, 0.9, sg * 0.82);
      });
      box(0.08, 0.14, 0.9, M.trim, 2.1, 0.27, 0);
      // 후면: 번호판(빈 판)·배기구·보조 제동등
      box(0.02, 0.115, 0.5, M.plate, -2.176, 0.59, 0);
      tailMeshes.push(box(0.02, 0.014, 0.36, M.tail, -2.09, 0.93, 0));
      [-1, 1].forEach(function (sg) {
        var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.12, 16, 1, true), M.chrome);
        tip.rotation.z = Math.PI / 2; tip.scale.set(1, 1, 1.5); tip.position.set(-2.15, 0.275, sg * 0.56); chassis.add(tip);
        var fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,240,200,1)', 'rgba(255,120,20,0.7)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        fl.position.set(-2.32, 0.28, sg * 0.56); fl.scale.set(0.55, 0.3, 1); chassis.add(fl); flames.push(fl);
      });
      // 바닥·휠하우스(어두운 속)
      box(3.7, 0.12, 1.44, M.trim, 0, 0.23, 0);
      [D.axF, D.axR].forEach(function (ax) {
        [-1, 1].forEach(function (sg) {
          var well = new THREE.Mesh(new THREE.CylinderGeometry(D.arch + 0.004, D.arch + 0.004, 0.36, 24, 1, true, Math.PI / 2, Math.PI), M.trim);
          well.rotation.x = Math.PI / 2; well.position.set(ax, D.rT, sg * 0.73);
          chassis.add(well);
        });
        box(0.74, 0.5, 1.1, M.trim, ax, 0.5, 0);
      });
      // 접지 그림자
      blob = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.0), new THREE.MeshBasicMaterial({ map: glowTexture(THREE, 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.5)'), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.y = 0.035; blob.renderOrder = 2; group.add(blob);
    }

    // ── 휠 ───────────────────────────────────────────────────────────
    [[D.axF, D.trackF, D.wF, true], [D.axR, D.trackR, D.wR, false]].forEach(function (a) {
      [-1, 1].forEach(function (sg) {
        var w = buildWheel(THREE, M, a[2], sg < 0);
        w.position.set(a[0], D.rT, sg * a[1]); w.userData.front = a[3];
        group.add(w); wheels.push(w);
      });
    });

    var flameT = 0;
    return {
      group: group, chassis: chassis, dims: D,
      // steer(rad, +좌), spin(rad 누적), roll/pitch(rad), brake(0..1), heat(0..1), flame(true면 점화), dt
      set: function (s) {
        chassis.rotation.x = s.roll || 0; chassis.rotation.z = s.pitch || 0;
        chassis.position.y = s.heave || 0;
        for (var i = 0; i < wheels.length; i++) {
          var w = wheels[i];
          if (w.userData.front) w.rotation.y = s.steer || 0;
          w.userData.spin.rotation.z = -(s.spin || 0);
          if (w.userData.disc) w.userData.disc.material.emissiveIntensity = (s.heat || 0) * (w.userData.front ? 2.2 : 1.1);
        }
        if (!ghost) {
          var bi = 0.45 + 2.6 * clamp((s.brake || 0) * 6, 0, 1);
          tailMeshes.forEach(function (m) { m.material.emissiveIntensity = bi; });
          if (s.flame) flameT = 0.16;
          flameT = Math.max(0, flameT - (s.dt || 0));
          flames.forEach(function (f, k) { f.material.opacity = flameT > 0 ? 0.55 + 0.45 * Math.sin((flameT * 90) + k) : 0; f.scale.x = 0.45 + flameT * 2.2; });
        }
      },
    };
  }

  root.Car = { build: build, dims: D };
})(typeof self !== 'undefined' ? self : this);
