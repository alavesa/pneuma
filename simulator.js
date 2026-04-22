(() => {
  const canvas = document.getElementById('stage');
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    document.body.innerHTML =
      '<div style="color:#fff;padding:40px;font-family:sans-serif">WebGL2 is required.</div>';
    return;
  }

  const ext = gl.getExtension('EXT_color_buffer_float');

  // ---------- Shaders ----------

  const updateVS = `#version 300 es
  precision highp float;

  in vec2 a_pos;
  in vec2 a_vel;
  in float a_life;

  uniform float u_dt;
  uniform float u_time;
  uniform float u_speed;
  uniform float u_noiseScale;
  uniform vec2 u_mouse;
  uniform vec2 u_mouseVel;
  uniform float u_mouseForce;
  uniform float u_aspect;

  uniform float u_bass;
  uniform float u_mid;
  uniform float u_treble;
  uniform float u_energy;
  uniform float u_breathe;   // -1 = exhale, 0 = held/neutral, +1 = inhale
  uniform float u_breatheAmp;

  out vec2 v_pos;
  out vec2 v_vel;
  out float v_life;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash2(i + vec2(0,0)), f - vec2(0,0)),
          dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
      mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
          dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x),
      u.y);
  }

  vec2 curl(vec2 p) {
    float e = 0.01;
    float n1 = noise(p + vec2(0.0, e));
    float n2 = noise(p - vec2(0.0, e));
    float n3 = noise(p + vec2(e, 0.0));
    float n4 = noise(p - vec2(e, 0.0));
    return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
  }

  void main() {
    vec2 p = a_pos;
    vec2 v = a_vel;
    float life = a_life;

    // flow field: mid adds turbulence, bass adds timescale
    float flowBoost = 1.0 + u_mid * 1.3;
    float timeShift = u_time * (0.05 + u_bass * 0.15);
    vec2 np = p * u_noiseScale + vec2(timeShift, timeShift * 0.8);
    vec2 flow = curl(np) * 0.22 * flowBoost;

    // audio-driven radial pulse from center (kicks on bass hits)
    float r = length(p);
    vec2 radialDir = p / (r + 1e-4);
    vec2 pulse = radialDir * u_bass * 1.2;

    // breathing: inhale pulls to center, exhale pushes outward
    vec2 breatheAcc = -radialDir * u_breathe * u_breatheAmp * 1.6;

    // mouse force
    vec2 toMouse = u_mouse - p;
    float d = length(toMouse) + 1e-4;
    float falloff = exp(-d * 2.5);
    vec2 dir = toMouse / d;
    vec2 radialAcc = dir * u_mouseForce * falloff * 12.0;
    vec2 swipeAcc = u_mouseVel * falloff * 6.0;
    vec2 mouseAcc = radialAcc + swipeAcc;

    float speedScale = u_speed * (1.0 + u_energy * 0.6);

    v += (flow * speedScale + mouseAcc + pulse + breatheAcc) * u_dt;
    v *= 0.985 - u_treble * 0.01;

    // clamp velocity so high audio energy cannot tunnel particles off-screen
    float vLen = length(v);
    float vMax = 4.0;
    if (vLen > vMax) v *= vMax / vLen;

    p += v * u_dt * speedScale;

    life -= u_dt * (0.25 + u_treble * 0.6);
    if (life <= 0.0) {
      vec2 h = hash2(p * 97.0 + u_time);
      p = h;
      p.x *= u_aspect;
      v = vec2(0.0);
      life = 1.0;
    }

    // modulo wrap — handles any position, not just near-boundary
    p.x = mod(p.x + u_aspect, 2.0 * u_aspect) - u_aspect;
    p.y = mod(p.y + 1.0, 2.0) - 1.0;

    v_pos = p;
    v_vel = v;
    v_life = life;
  }`;

  const updateFS = `#version 300 es
  precision highp float;
  out vec4 o;
  void main() { o = vec4(0.0); }`;

  const drawVS = `#version 300 es
  precision highp float;

  in vec2 a_pos;
  in vec2 a_vel;
  in float a_life;

  uniform float u_aspect;
  uniform float u_bass;

  out float v_speed;
  out float v_life;

  void main() {
    vec2 p = a_pos;
    p.x /= u_aspect;
    gl_Position = vec4(p, 0.0, 1.0);
    gl_PointSize = 1.5 + u_bass * 1.8;
    v_speed = length(a_vel);
    v_life = a_life;
  }`;

  const drawFS = `#version 300 es
  precision highp float;

  in float v_speed;
  in float v_life;
  out vec4 outColor;

  uniform float u_hue;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_treble;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    float s = clamp(v_speed * 0.8, 0.0, 1.0);
    float hue = u_hue / 360.0 + s * 0.15 + u_bass * 0.08 - u_treble * 0.06;
    float sat = 0.8 + u_mid * 0.15;
    float light = 0.5 + s * 0.25 + u_treble * 0.25;
    vec3 col = hsl2rgb(vec3(hue, sat, light));
    float alpha = (0.32 + u_bass * 0.3) * v_life;
    outColor = vec4(col * alpha, alpha);
  }`;

  const fadeVS = `#version 300 es
  precision highp float;
  const vec2 verts[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  out vec2 v_uv;
  void main() {
    vec2 p = verts[gl_VertexID];
    v_uv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  const fadeFS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tex;
  uniform float u_fade;
  out vec4 outColor;
  void main() {
    vec4 c = texture(u_tex, v_uv);
    outColor = c * u_fade;
  }`;

  const blitVS = fadeVS;
  const blitFS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tex;
  out vec4 outColor;
  void main() {
    vec4 c = texture(u_tex, v_uv);
    vec3 col = c.rgb;
    col += pow(max(col - 0.5, 0.0), vec3(2.0)) * 0.6;
    outColor = vec4(col, 1.0);
  }`;

  // ---------- GL helpers ----------

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh), src);
      throw new Error('shader compile failed');
    }
    return sh;
  }

  function program(vsSrc, fsSrc, tfVaryings) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    if (tfVaryings) {
      gl.transformFeedbackVaryings(p, tfVaryings, gl.INTERLEAVED_ATTRIBS);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      throw new Error('program link failed');
    }
    return p;
  }

  const updateProg = program(updateVS, updateFS, ['v_pos', 'v_vel', 'v_life']);
  const drawProg = program(drawVS, drawFS);
  const fadeProg = program(fadeVS, fadeFS);
  const blitProg = program(blitVS, blitFS);

  // ---------- Particle buffers ----------

  let particleCount = 150000;
  let buffers = [gl.createBuffer(), gl.createBuffer()];
  let vaos = [gl.createVertexArray(), gl.createVertexArray()];
  let readIdx = 0;

  const STRIDE = 5 * 4;

  function seedParticles(count) {
    const data = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) {
      const o = i * 5;
      data[o + 0] = (Math.random() * 2 - 1) * 1.5;
      data[o + 1] = Math.random() * 2 - 1;
      data[o + 2] = 0;
      data[o + 3] = 0;
      data[o + 4] = Math.random();
    }
    for (let b = 0; b < 2; b++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[b]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);

      gl.bindVertexArray(vaos[b]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers[b]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 16);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    particleCount = count;
  }

  gl.bindAttribLocation(updateProg, 0, 'a_pos');
  gl.bindAttribLocation(updateProg, 1, 'a_vel');
  gl.bindAttribLocation(updateProg, 2, 'a_life');
  gl.bindAttribLocation(drawProg, 0, 'a_pos');
  gl.bindAttribLocation(drawProg, 1, 'a_vel');
  gl.bindAttribLocation(drawProg, 2, 'a_life');
  gl.linkProgram(updateProg);
  gl.linkProgram(drawProg);

  seedParticles(particleCount);

  // ---------- Ping-pong framebuffers (can't read + write same texture) ----------

  const fbs = [null, null];
  const texs = [null, null];
  let pingIdx = 0;
  let fbW = 0, fbH = 0;

  function createFBO(w, h) {
    for (let i = 0; i < 2; i++) {
      if (texs[i]) gl.deleteTexture(texs[i]);
      if (fbs[i]) gl.deleteFramebuffer(fbs[i]);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const internal = ext ? gl.RGBA16F : gl.RGBA;
      const type = ext ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);

      texs[i] = t;
      fbs[i] = f;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbW = w;
    fbH = h;
  }

  function clearBothFBOs() {
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[i]);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      createFBO(w, h);
      clearBothFBOs();
    }
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- Input ----------

  const mouse = {
    x: 0, y: 0, prevX: 0, prevY: 0, velX: 0, velY: 0,
    inside: false, down: false, pullKey: false,
  };
  let mouseForce = 0;

  const cursor = document.getElementById('cursor');

  function updateMouseFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return; // canvas not laid out yet
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    mouse.x = (nx * 2 - 1) * (r.width / r.height);
    mouse.y = -(ny * 2 - 1);
    if (cursor) cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  }

  function setCursorClass() {
    if (!cursor) return;
    cursor.classList.remove('push', 'pull');
    if (mouse.pullKey) cursor.classList.add('pull');
    else if (mouse.down) cursor.classList.add('push');
  }

  canvas.addEventListener('pointermove', updateMouseFromEvent);
  canvas.addEventListener('pointerenter', (e) => {
    mouse.inside = true; updateMouseFromEvent(e);
    mouse.prevX = mouse.x; mouse.prevY = mouse.y;
    if (cursor) cursor.style.opacity = '1';
  });
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false; mouse.down = false;
    if (cursor) cursor.style.opacity = '0';
    setCursorClass();
  });
  canvas.addEventListener('pointerdown', (e) => {
    mouse.down = true; canvas.setPointerCapture(e.pointerId); setCursorClass();
  });
  canvas.addEventListener('pointerup', () => { mouse.down = false; setCursorClass(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
      mouse.pullKey = true; setCursorClass(); e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { mouse.pullKey = false; setCursorClass(); }
  });

  // ---------- Slider bindings ----------

  const state = {
    speed: 1.0,
    noiseScale: 1.2,
    trail: 0.965,
    hue: 200,
    paused: false,
    sensitivity: 1.4,
    mode: 'off',
  };

  function bind(id, key, fmt = (v) => v.toFixed(2)) {
    const el = document.getElementById(id);
    const lbl = document.getElementById(id + 'Val');
    const sync = () => {
      state[key] = parseFloat(el.value);
      if (lbl) lbl.textContent = fmt(state[key]);
    };
    el.addEventListener('input', sync);
    sync();
  }

  bind('speed', 'speed');
  bind('noise', 'noiseScale');
  bind('trail', 'trail', (v) => v.toFixed(3));
  bind('hue', 'hue', (v) => Math.round(v) + '°');
  bind('sens', 'sensitivity');

  const countEl = document.getElementById('count');
  const countLbl = document.getElementById('countVal');
  countEl.addEventListener('change', () => {
    const n = parseInt(countEl.value, 10);
    seedParticles(n);
    countLbl.textContent = (n / 1000).toFixed(0) + 'k';
  });
  countLbl.textContent = (parseInt(countEl.value, 10) / 1000).toFixed(0) + 'k';

  document.getElementById('reset').addEventListener('click', () => {
    seedParticles(particleCount);
    clearBothFBOs();
  });

  const pauseBtn = document.getElementById('pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? 'Play' : 'Pause';
  });

  // ---------- Mode switcher ----------

  const audioPanel = document.getElementById('audioPanel');
  const breathePanel = document.getElementById('breathePanel');
  const modeButtons = document.querySelectorAll('.mode-btn');

  function setMode(mode) {
    state.mode = mode;
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    audioPanel.hidden = mode !== 'audio';
    breathePanel.hidden = mode !== 'breathe';
    if (mode !== 'breathe') stopBreathing();
  }
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ---------- Audio analysis ----------

  let audioCtx = null;
  let analyser = null;
  let freqData = null;
  let micStream = null;
  let micSource = null;
  let fileSource = null;

  const audio = {
    bass: 0, mid: 0, treble: 0, energy: 0,
    smoothBass: 0, smoothMid: 0, smoothTreble: 0, smoothEnergy: 0,
  };

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  const micBtn = document.getElementById('micBtn');
  const fileBtn = document.getElementById('fileBtn');
  const fileInput = document.getElementById('fileInput');
  const trackInfo = document.getElementById('trackInfo');
  const audioEl = document.getElementById('audioEl');

  async function enableMic() {
    try {
      ensureAudioCtx();
      if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
      }
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (micSource) micSource.disconnect();
      if (fileSource) { fileSource.disconnect(); }
      audioEl.pause();
      micSource = audioCtx.createMediaStreamSource(micStream);
      micSource.connect(analyser);
      // no connection to destination to avoid feedback
      trackInfo.textContent = 'Microphone live';
      trackInfo.classList.add('active');
      micBtn.classList.add('active');
      fileBtn.classList.remove('active');
    } catch (err) {
      trackInfo.textContent = 'Mic access denied';
      console.error(err);
    }
  }

  function loadFile(file) {
    ensureAudioCtx();
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (micSource) { micSource.disconnect(); micSource = null; }
    audioEl.src = URL.createObjectURL(file);
    if (!fileSource) {
      fileSource = audioCtx.createMediaElementSource(audioEl);
    }
    fileSource.disconnect();
    fileSource.connect(analyser);
    fileSource.connect(audioCtx.destination);
    audioEl.play().catch(() => {});
    trackInfo.textContent = file.name;
    trackInfo.classList.add('active');
    fileBtn.classList.add('active');
    micBtn.classList.remove('active');
  }

  micBtn.addEventListener('click', enableMic);
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  // band ranges as fractions of frequencyBinCount (0-1)
  // with fftSize 2048 @ 48kHz: each bin ≈ 23.4Hz
  // bass ~ 40-250Hz  -> bins 2..11
  // mid ~ 250-2000Hz -> bins 11..85
  // treble ~ 2k-8kHz -> bins 85..340
  function analyzeAudio() {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    const bins = freqData.length;

    const avg = (lo, hi) => {
      let s = 0;
      const loI = Math.max(0, Math.floor(lo));
      const hiI = Math.min(bins, Math.floor(hi));
      const n = Math.max(1, hiI - loI);
      for (let i = loI; i < hiI; i++) s += freqData[i];
      return s / n / 255;
    };

    const sens = state.sensitivity;
    const rawB = Math.min(1, avg(2, 11) * sens * 1.1);
    const rawM = Math.min(1, avg(11, 85) * sens);
    const rawT = Math.min(1, avg(85, 340) * sens * 1.2);
    const rawE = Math.min(1, avg(2, 340) * sens);

    // slow rising, faster falling — keeps meters punchy without jitter
    const chase = (cur, tgt, up, down) => cur + (tgt - cur) * (tgt > cur ? up : down);
    audio.smoothBass   = chase(audio.smoothBass,   rawB, 0.45, 0.08);
    audio.smoothMid    = chase(audio.smoothMid,    rawM, 0.35, 0.1);
    audio.smoothTreble = chase(audio.smoothTreble, rawT, 0.4,  0.15);
    audio.smoothEnergy = chase(audio.smoothEnergy, rawE, 0.35, 0.08);

    audio.bass = audio.smoothBass;
    audio.mid = audio.smoothMid;
    audio.treble = audio.smoothTreble;
    audio.energy = audio.smoothEnergy;
  }

  const barBass = document.getElementById('barBass');
  const barMid = document.getElementById('barMid');
  const barTreble = document.getElementById('barTreble');

  function updateMeters() {
    barBass.style.width = (audio.bass * 100).toFixed(0) + '%';
    barMid.style.width = (audio.mid * 100).toFixed(0) + '%';
    barTreble.style.width = (audio.treble * 100).toFixed(0) + '%';
  }

  // ---------- Breathing ----------

  const breatheGuide = document.getElementById('breatheGuide');
  const breatheRing = breatheGuide.querySelector('.breathe-ring');
  const breatheCue = document.getElementById('breatheCue');
  const breatheCount = document.getElementById('breatheCount');
  const breathePatternEl = document.getElementById('breathePattern');
  const breatheCyclesEl = document.getElementById('breatheCycles');
  const breatheCyclesLbl = document.getElementById('breatheCyclesVal');
  const breatheStart = document.getElementById('breatheStart');
  const breatheDesc = document.getElementById('breatheDesc');

  const PATTERNS = {
    box:       { name: 'Box breathing',    steps: [['inhale', 4], ['hold', 4], ['exhale', 4], ['hold', 4]], desc: 'Equal four-count phases. Steadies focus under pressure.' },
    calm:      { name: '4·7·8',            steps: [['inhale', 4], ['hold', 7], ['exhale', 8]],              desc: 'Long exhale triggers a parasympathetic shift. Good before sleep.' },
    lengthen:  { name: 'Lengthen · 4·4·8', steps: [['inhale', 4], ['hold', 4], ['exhale', 8]],              desc: 'Researcher-recommended. Pursed-lip exhale slows the breath out.' },
    resonant:  { name: 'Resonant · 5·5',   steps: [['inhale', 5], ['exhale', 5]],                           desc: 'Six breaths per minute — balances heart-rate variability.' },
    energize:  { name: 'Energize',         steps: [['inhale', 6], ['hold', 2], ['exhale', 4], ['hold', 2]], desc: 'Longer inhale for a gentle lift without hyperventilation.' },
  };

  let breathing = {
    active: false,
    stepIdx: 0,
    stepStart: 0,
    cyclesLeft: 0,
    phase: 0,       // continuous -1..+1 driving shader
    amp: 0,         // ramps in/out
    pattern: 'calm',
    cycles: 6,
  };

  function updateBreatheDesc() {
    const p = PATTERNS[breathePatternEl.value];
    breatheDesc.textContent = p ? p.desc : '';
  }
  breathePatternEl.addEventListener('change', updateBreatheDesc);
  updateBreatheDesc();

  breatheCyclesEl.addEventListener('input', () => {
    breatheCyclesLbl.textContent = breatheCyclesEl.value;
  });
  breatheCyclesLbl.textContent = breatheCyclesEl.value;

  breatheStart.addEventListener('click', () => {
    if (breathing.active) stopBreathing();
    else startBreathing();
  });

  function startBreathing() {
    breathing.pattern = breathePatternEl.value;
    breathing.cycles = parseInt(breatheCyclesEl.value, 10);
    breathing.cyclesLeft = breathing.cycles;
    breathing.stepIdx = 0;
    breathing.stepStart = performance.now();
    breathing.active = true;
    breatheStart.textContent = 'Stop';
    breatheGuide.classList.add('visible');
  }

  function stopBreathing() {
    breathing.active = false;
    breatheStart.textContent = 'Start';
    breatheGuide.classList.remove('visible', 'inhale', 'hold', 'exhale');
    breatheCue.textContent = 'Ready';
    breatheCount.textContent = '';
  }

  function updateBreathing(now) {
    if (!breathing.active) {
      breathing.amp += (0 - breathing.amp) * 0.08;
      breathing.phase += (0 - breathing.phase) * 0.08;
      return;
    }
    const pat = PATTERNS[breathing.pattern];
    const steps = pat.steps;
    const step = steps[breathing.stepIdx];
    const [kind, dur] = step;
    const elapsed = (now - breathing.stepStart) / 1000;

    // phase target: inhale → +1 (converge inward), exhale → -1 (expand outward), hold → stay
    let target;
    if (kind === 'inhale') target = 1;
    else if (kind === 'exhale') target = -1;
    else target = breathing.phase;

    breathing.phase += (target - breathing.phase) * 0.06;
    breathing.amp += (1 - breathing.amp) * 0.05;

    // update UI cue
    breatheCue.textContent = kind.toUpperCase();
    breatheCount.textContent = Math.max(0, Math.ceil(dur - elapsed)).toString();

    breatheGuide.classList.remove('inhale', 'hold', 'exhale');
    breatheGuide.classList.add(kind);

    // ring scale: 0.4 (exhaled) to 1.0 (inhaled)
    const scale = 0.4 + ((breathing.phase + 1) / 2) * 0.6;
    breatheRing.style.transform = `scale(${scale.toFixed(3)})`;

    if (elapsed >= dur) {
      breathing.stepIdx++;
      breathing.stepStart = now;
      if (breathing.stepIdx >= steps.length) {
        breathing.stepIdx = 0;
        breathing.cyclesLeft--;
        if (breathing.cyclesLeft <= 0) {
          // done
          breatheCue.textContent = 'DONE';
          breatheCount.textContent = '✓';
          setTimeout(stopBreathing, 1800);
          breathing.active = false;
        }
      }
    }
  }

  // ---------- Uniforms ----------

  const U = {
    update: {
      dt: gl.getUniformLocation(updateProg, 'u_dt'),
      time: gl.getUniformLocation(updateProg, 'u_time'),
      speed: gl.getUniformLocation(updateProg, 'u_speed'),
      noiseScale: gl.getUniformLocation(updateProg, 'u_noiseScale'),
      mouse: gl.getUniformLocation(updateProg, 'u_mouse'),
      mouseVel: gl.getUniformLocation(updateProg, 'u_mouseVel'),
      mouseForce: gl.getUniformLocation(updateProg, 'u_mouseForce'),
      aspect: gl.getUniformLocation(updateProg, 'u_aspect'),
      bass: gl.getUniformLocation(updateProg, 'u_bass'),
      mid: gl.getUniformLocation(updateProg, 'u_mid'),
      treble: gl.getUniformLocation(updateProg, 'u_treble'),
      energy: gl.getUniformLocation(updateProg, 'u_energy'),
      breathe: gl.getUniformLocation(updateProg, 'u_breathe'),
      breatheAmp: gl.getUniformLocation(updateProg, 'u_breatheAmp'),
    },
    draw: {
      aspect: gl.getUniformLocation(drawProg, 'u_aspect'),
      hue: gl.getUniformLocation(drawProg, 'u_hue'),
      bass: gl.getUniformLocation(drawProg, 'u_bass'),
      mid: gl.getUniformLocation(drawProg, 'u_mid'),
      treble: gl.getUniformLocation(drawProg, 'u_treble'),
    },
    fade: {
      tex: gl.getUniformLocation(fadeProg, 'u_tex'),
      fade: gl.getUniformLocation(fadeProg, 'u_fade'),
    },
    blit: { tex: gl.getUniformLocation(blitProg, 'u_tex') },
  };

  const quadVAO = gl.createVertexArray();

  // ---------- Loop ----------

  let lastT = performance.now();
  let fpsSmooth = 60;
  const fpsEl = document.getElementById('fps');

  let frameErrorCount = 0;

  function frame() {
    // schedule next frame FIRST so an exception below can't kill the loop
    requestAnimationFrame(frame);

    if (contextLost) return;

    try {
      renderFrame();
    } catch (err) {
      frameErrorCount++;
      if (frameErrorCount < 3) console.error('[pneuma] frame error:', err);
    }
  }

  function renderFrame() {
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 1 / 30);

    fpsSmooth = fpsSmooth * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;
    fpsEl.textContent = fpsSmooth.toFixed(0);

    // mouse force target
    let target = 0;
    if (mouse.inside) {
      if (mouse.pullKey) target = 1.8;
      else if (mouse.down) target = -1.8;
      else target = 0.15;
    }
    mouseForce += (target - mouseForce) * 0.3;

    const vx = (mouse.x - mouse.prevX) / Math.max(dt, 1e-4);
    const vy = (mouse.y - mouse.prevY) / Math.max(dt, 1e-4);
    mouse.velX = mouse.velX * 0.75 + vx * 0.25;
    mouse.velY = mouse.velY * 0.75 + vy * 0.25;
    const vMax = 6.0;
    mouse.velX = Math.max(-vMax, Math.min(vMax, mouse.velX));
    mouse.velY = Math.max(-vMax, Math.min(vMax, mouse.velY));
    mouse.prevX = mouse.x; mouse.prevY = mouse.y;

    // mode-driven reactive values
    let bass = 0, mid = 0, treble = 0, energy = 0;
    let breathe = 0, breatheAmp = 0;

    if (state.mode === 'audio') {
      analyzeAudio();
      updateMeters();
      bass = audio.bass;
      mid = audio.mid;
      treble = audio.treble;
      energy = audio.energy;
    } else {
      // decay meters visually
      barBass.style.width = '0%';
      barMid.style.width = '0%';
      barTreble.style.width = '0%';
    }

    if (state.mode === 'breathe') {
      updateBreathing(now);
      breathe = breathing.phase;
      breatheAmp = breathing.amp;
      // faint synthetic energy so the field still has gentle pulse
      const phaseAbs = Math.abs(breathing.phase);
      energy = Math.max(energy, phaseAbs * 0.25);
      mid = Math.max(mid, phaseAbs * 0.12);
    } else {
      updateBreathing(now);
    }

    const aspect = canvas.width / canvas.height;

    if (!state.paused) {
      gl.useProgram(updateProg);
      gl.uniform1f(U.update.dt, dt);
      gl.uniform1f(U.update.time, now / 1000);
      gl.uniform1f(U.update.speed, state.speed);
      gl.uniform1f(U.update.noiseScale, state.noiseScale);
      gl.uniform2f(U.update.mouse, mouse.x, mouse.y);
      gl.uniform2f(U.update.mouseVel, mouse.velX, mouse.velY);
      gl.uniform1f(U.update.mouseForce, mouseForce);
      gl.uniform1f(U.update.aspect, aspect);
      gl.uniform1f(U.update.bass, bass);
      gl.uniform1f(U.update.mid, mid);
      gl.uniform1f(U.update.treble, treble);
      gl.uniform1f(U.update.energy, energy);
      gl.uniform1f(U.update.breathe, breathe);
      gl.uniform1f(U.update.breatheAmp, breatheAmp);

      const writeIdx = 1 - readIdx;
      gl.bindVertexArray(vaos[readIdx]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers[writeIdx]);

      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, particleCount);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);

      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindVertexArray(null);
      readIdx = writeIdx;
    }

    // ping-pong: read from srcTex, write to dstFbo (avoids sampling same texture we render to)
    const srcTex = texs[pingIdx];
    const dstFbo = fbs[1 - pingIdx];
    const dstTex = texs[1 - pingIdx];

    // fade previous frame into destination
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.viewport(0, 0, fbW, fbH);
    gl.disable(gl.BLEND);
    gl.useProgram(fadeProg);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(U.fade.tex, 0);
    const trailBoost = state.mode === 'breathe' ? 0.01 : 0;
    gl.uniform1f(U.fade.fade, Math.min(0.998, state.trail + trailBoost));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // draw particles additively into the destination FBO
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(drawProg);
    gl.uniform1f(U.draw.aspect, aspect);
    gl.uniform1f(U.draw.hue, state.hue);
    gl.uniform1f(U.draw.bass, bass);
    gl.uniform1f(U.draw.mid, mid);
    gl.uniform1f(U.draw.treble, treble);
    gl.bindVertexArray(vaos[readIdx]);
    gl.drawArrays(gl.POINTS, 0, particleCount);
    gl.bindVertexArray(null);

    // blit destination to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(blitProg);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dstTex);
    gl.uniform1i(U.blit.tex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // swap for next frame
    pingIdx = 1 - pingIdx;
  }

  // ---------- WebGL context loss handling ----------

  let contextLost = false;

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    console.warn('[pneuma] WebGL context lost — attempting restore');
  });

  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[pneuma] WebGL context restored — re-seeding');
    contextLost = false;
    // full reload is the cheapest correct recovery: programs, buffers, textures all need recreation
    location.reload();
  });

  requestAnimationFrame(frame);
})();
