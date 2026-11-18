// 엔진 사운드 합성(직렬 6기통 느낌): 점화 주파수 톱니파 + 저음 + 바람 소리. 버튼을 눌러야 시작됩니다.
(function (root) {
  'use strict';
  var ctx = null, nodes = null, on = false;

  function start() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      var master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 1.2;
      var shaper = ctx.createWaveShaper(), curve = new Float32Array(256);
      for (var i = 0; i < 256; i++) { var x = i / 128 - 1; curve[i] = Math.tanh(x * 2.4); }
      shaper.curve = curve;
      var eng = ctx.createGain(); eng.gain.value = 0.5;
      shaper.connect(lp); lp.connect(eng); eng.connect(master);
      function osc(type, gain) { var o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; g.gain.value = gain; o.connect(g); g.connect(shaper); o.start(); return o; }
      var o1 = osc('sawtooth', 0.5), o2 = osc('sawtooth', 0.38), o3 = osc('square', 0.12), o4 = osc('triangle', 0.3);
      // 바람·노면 소음
      var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
      for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
      var wind = ctx.createGain(); wind.gain.value = 0;
      noise.connect(bp); bp.connect(wind); wind.connect(master); noise.start();
      // 배기 팝
      var pop = ctx.createGain(); pop.gain.value = 0;
      var pbp = ctx.createBiquadFilter(); pbp.type = 'bandpass'; pbp.frequency.value = 260; pbp.Q.value = 1.5;
      noise.connect(pbp); pbp.connect(pop); pop.connect(master);
      nodes = { master: master, lp: lp, eng: eng, o1: o1, o2: o2, o3: o3, o4: o4, wind: wind, bp: bp, pop: pop };
    }
    ctx.resume(); on = true;
    return true;
  }
  function stop() { on = false; if (nodes) nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.08); }

  // rpm, 스로틀(0..1), 속도(m/s), 재생 중 여부
  function update(rpm, thr, v, playing) {
    if (!on || !nodes) return;
    var t = ctx.currentTime, f = Math.max(22, rpm / 20); // 6기통 4행정 점화 주파수 = rpm/60 × 3
    nodes.o1.frequency.setTargetAtTime(f, t, 0.03);
    nodes.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    nodes.o3.frequency.setTargetAtTime(f * 2.005, t, 0.03);
    nodes.o4.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    nodes.lp.frequency.setTargetAtTime(260 + rpm * 0.2 + thr * 1500, t, 0.05);
    nodes.eng.gain.setTargetAtTime(0.16 + 0.5 * thr + rpm / 30000, t, 0.05);
    nodes.wind.gain.setTargetAtTime(Math.min(0.5, v * v / 9000), t, 0.1);
    nodes.bp.frequency.setTargetAtTime(500 + v * 22, t, 0.1);
    nodes.master.gain.setTargetAtTime(playing ? 0.2 : 0, t, 0.12);
  }
  function pop() {
    if (!on || !nodes) return;
    var t = ctx.currentTime, g = nodes.pop.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0, t);
    for (var i = 0; i < 3; i++) { var a = t + i * 0.07 + Math.random() * 0.02; g.setValueAtTime(1.4 - i * 0.3, a); g.exponentialRampToValueAtTime(0.01, a + 0.05); }
    g.setValueAtTime(0, t + 0.3);
  }

  root.Engine = { start: start, stop: stop, update: update, pop: pop, isOn: function () { return on; } };
})(typeof self !== 'undefined' ? self : this);
