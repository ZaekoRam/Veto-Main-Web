/* ==========================================================================
   VETO MAIN — veto-stage.js  (Three.js r147, sin módulos)

   Un solo canvas fijo con tres "regiones" que siguen al scroll:
     · hero  → el modelo oficial de selección de agente con su animación "idle"
               del juego; la forma Evolución copia esa pose (retarget) para el
               spotlight y la transformación (dron → explosión → Evolución)
     · ix    → secuencia del Interceptor: el orbe queda fijo mientras bajas,
               le lanzan utilidad y la destruye con su rayo (scrub por scroll)
     · kit   → Veto ejecuta cada habilidad (C, Q, E, X) con sus efectos

   Animación: poses procedurales sobre el esqueleto + un resorte por hueso
   (inercia, follow-through), capas de respiración, peso y mirada, gestos.
   Render: HDR → composición (spotlight, mutación, tinta) → bloom → ACES.

   API: VetoStage.setForm("base"|"ult"), .toggle(), .play("C"|"Q"|"E"|"X"),
        .onChange(fn), .onAction(fn), .onIx(fn), .ixTimeline
   ========================================================================== */
(function () {
  "use strict";

  var data = window.__VETO__ || {};
  var CFG = Object.assign({
    base: "assets/models/veto-base.glb",
    ult: "assets/models/veto-ult.glb",
    cs: "assets/models/veto-cs.glb",
    armsDown: 72,
    spotlight: 150,
    exposure: 1.0,
    bloom: 0.32
  }, data.stage || {});

  var root = document.documentElement;
  var host = document.querySelector("[data-stage]");
  var backdrop = document.querySelector("[data-stage-backdrop]");
  var reticle = document.querySelector("[data-reticle]");
  var reticleLabel = document.querySelector("[data-reticle-label]");
  var pctEl = document.querySelector("[data-stage-pct]");
  function anchorFor(key) {
    var el = document.querySelector('[data-stage-anchor="' + key + '"]');
    return el ? { key: key, el: el, section: el.closest("section") || el.parentElement } : null;
  }
  var A = { hero: anchorFor("hero"), kit: anchorFor("kit"), ix: anchorFor("ix") };
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var subs = { change: [], action: [], ix: [] };
  function emit(type, payload) { subs[type].forEach(function (fn) { try { fn(payload); } catch (e) { /* noop */ } }); }

  var state = { target: false, evolved: false };
  var api = window.VetoStage = {
    ready: false, ultReady: false, failed: false, modelFailed: false, evolved: false,
    durations: {}, ixTimeline: [],
    setForm: function (form) { requestForm(form === "ult"); },
    toggle: function () { requestForm(!state.target); },
    play: function (key) { return playKey(key); },
    onChange: function (fn) { subs.change.push(fn); },
    onAction: function (fn) { subs.action.push(fn); },
    onIx: function (fn) { subs.ix.push(fn); }
  };

  function fail(reason) {
    api.failed = true;
    if (host) host.classList.add("is-failed");
    root.classList.add("no-3d");
    if (window.console) console.info("[VetoStage] 3D desactivado:", reason);
  }
  if (!host || !(A.hero || A.kit || A.ix)) return;
  if (!window.THREE || !THREE.GLTFLoader) { fail("Three.js no cargó"); return; }

  var V3 = THREE.Vector3, Q4 = THREE.Quaternion;
  var clamp = THREE.MathUtils.clamp;
  var PI = Math.PI;
  var C_CYAN = 0x3de7f2, C_LIME = 0xd4ff4f, C_RED = 0xff3b4e, C_GOLD = 0xd4a94f;

  /* ================================================================ RENDER */
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" }); }
  catch (e) { fail("WebGL no disponible"); return; }

  var isGL2 = renderer.capabilities.isWebGL2;
  // en celular/tablet (puntero táctil) se dibuja a menos resolución: la diferencia no se nota y ahorra GPU y batería
  var coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  var maxDpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.4 : 1.75), perfCap = maxDpr, dpr = maxDpr;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CFG.exposure;
  renderer.setClearColor(0x000000, 0);
  host.insertBefore(renderer.domElement, host.firstChild);

  // Todo se dibuja en HDR lineal; el tono (ACES) se aplica una sola vez al final
  var HDR = isGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
  function target(samples) {
    return new THREE.WebGLRenderTarget(2, 2, { samples: samples || 0, type: HDR, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!samples });
  }
  var rtBase = target(isGL2 ? 4 : 0), rtUlt = target(isGL2 ? 4 : 0);
  rtBase.depthBuffer = rtUlt.depthBuffer = true;
  var rtComp = target(0);
  var bloomOn = isGL2 && CFG.bloom > 0;
  var rtDown = [], rtUp = [];
  for (var bi = 0; bi < 5; bi++) { rtDown.push(target(0)); if (bi < 4) rtUp.push(target(0)); }

  var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  var ixCam = new THREE.PerspectiveCamera(32, 1, 0.1, 140);
  var pmrem = new THREE.PMREMGenerator(renderer);
  var envTex = THREE.RoomEnvironment ? pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture : null;

  /* ---- utilidades gráficas ---- */
  function canvasTex(draw, size) {
    var c = document.createElement("canvas");
    c.width = c.height = size || 128;
    draw(c.getContext("2d"), c.width);
    return new THREE.CanvasTexture(c);
  }
  var TEX_GLOW = canvasTex(function (g, s) {
    var gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.2, "rgba(255,255,255,0.6)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.14)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  var TEX_RING = canvasTex(function (g, s) {
    g.strokeStyle = "rgba(255,255,255,1)"; g.lineWidth = s * 0.04;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, PI * 2); g.stroke();
  });
  // Columna de luz (llegada del teletransporte): gaussiana horizontal que se apaga hacia arriba
  var TEX_BEAM = canvasTex(function (g, s) {
    var gr = g.createLinearGradient(0, 0, s, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.38, "rgba(255,255,255,0.22)"); gr.addColorStop(0.5, "rgba(255,255,255,1)");
    gr.addColorStop(0.62, "rgba(255,255,255,0.22)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    var v = g.createLinearGradient(0, 0, 0, s);
    v.addColorStop(0, "rgba(0,0,0,1)"); v.addColorStop(0.6, "rgba(0,0,0,0.1)"); v.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = v; g.fillRect(0, 0, s, s);
  });
  function addBlend(m) {
    m.transparent = true; m.depthWrite = false;
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; m.blendEquation = THREE.AddEquation;
    return m;
  }
  function additive(color, opacity) {
    return new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }
  function sprite(color, size, opacity) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_GLOW, color: color, transparent: true, opacity: opacity == null ? 1 : opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(size);
    return s;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s += 0x6D2B79F5; var t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function bez(out, a, c, b, u) {
    var iu = 1 - u;
    out.set(iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x, iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y, iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z);
    return out;
  }
  function bezTan(out, a, c, b, u) {
    out.set(2 * (1 - u) * (c.x - a.x) + 2 * u * (b.x - c.x), 2 * (1 - u) * (c.y - a.y) + 2 * u * (b.y - c.y), 2 * (1 - u) * (c.z - a.z) + 2 * u * (b.z - c.z));
    return out.normalize();
  }
  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
  function noise1(x, s) { return Math.sin(x + s) * 0.55 + Math.sin(x * 2.31 + s * 1.7) * 0.3 + Math.sin(x * 4.13 + s * 2.9) * 0.15; }

  var EASE = {
    lin: function (x) { return x; },
    out: function (x) { return 1 - Math.pow(1 - x, 3); },
    inn: function (x) { return x * x * x; },
    inOut: function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
    back: function (x) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  };
  function seg(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }

  var GLSL_NOISE = [
    "float vh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
    "float vn3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(vh3(i), vh3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vh3(i + vec3(0.0, 1.0, 0.0)), vh3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),",
    "             mix(mix(vh3(i + vec3(0.0, 0.0, 1.0)), vh3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vh3(i + vec3(0.0, 1.0, 1.0)), vh3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }",
    "float vh2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float vn2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(vh2(i), vh2(i + vec2(1.0, 0.0)), f.x), mix(vh2(i + vec2(0.0, 1.0)), vh2(i + vec2(1.0, 1.0)), f.x), f.y); }"
  ].join("\n");
  var VS_UV = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  var VS_FRES = "varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }";

  /* ---- Partículas: color/tamaño por vértice, color HDR para el bloom ---- */
  function makeParticles(n) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 4);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 4));
    var mat = addBlend(new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: "attribute float aSize; attribute vec4 aColor; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, aSize * uScale / -mv.z); gl_Position = aColor.a > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }",
      fragmentShader: "varying vec4 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; float a = 1.0 - d; a *= a; float core = exp(-d * 10.0); gl_FragColor = vec4(vC.rgb * (a + core * 1.4) * vC.a, a * vC.a); }"
    }));
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    return { points: pts, pos: pos, size: size, col: col, n: n, mat: mat, geo: geo };
  }
  function flushParticles(P) {
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.aSize.needsUpdate = true;
    P.geo.attributes.aColor.needsUpdate = true;
  }

  // Emisor con física simple (arrastre, gravedad, rebote en el suelo)
  function Pool(scene, n) {
    this.P = makeParticles(n); this.P.points.visible = true; scene.add(this.P.points);
    this.n = n; this.i = 0;
    this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.s0 = new Float32Array(n); this.c0 = new Float32Array(n * 3); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.grow = new Float32Array(n);
    this.swirl = new Float32Array(n * 4);
  }
  Pool.prototype.emit = function (x, y, z, vx, vy, vz, life, size, col, drag, grav, grow) {
    var i = this.i, k = i * 3, P = this.P;
    this.i = (i + 1) % this.n;
    P.pos[k] = x; P.pos[k + 1] = y; P.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size;
    this.c0[k] = col[0]; this.c0[k + 1] = col[1]; this.c0[k + 2] = col[2];
    this.drag[i] = drag || 0; this.grav[i] = grav || 0; this.grow[i] = grow || 0;
    this.swirl[i * 4 + 3] = 0;
    return i;
  };
  // remolino alrededor de un eje vertical (vórtice): centro x,z + velocidad angular
  Pool.prototype.setSwirl = function (i, cx, cz, w) { var s = this.swirl; s[i * 4] = cx; s[i * 4 + 1] = cz; s[i * 4 + 2] = w; s[i * 4 + 3] = 1; };
  Pool.prototype.clear = function () {
    for (var i = 0; i < this.n; i++) { this.life[i] = 0; this.P.col[i * 4 + 3] = 0; }
    flushParticles(this.P);
  };
  Pool.prototype.update = function (dt) {
    var P = this.P, any = false;
    for (var i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      var a = (this.age[i] += dt), L = this.life[i], k = i * 3;
      if (a >= L) { this.life[i] = 0; P.col[i * 4 + 3] = 0; continue; }
      any = true;
      var dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      if (this.swirl[i * 4 + 3] > 0) {
        var sx = P.pos[k] - this.swirl[i * 4], sz = P.pos[k + 2] - this.swirl[i * 4 + 1], w = this.swirl[i * 4 + 2] * dt;
        P.pos[k] = this.swirl[i * 4] + sx * Math.cos(w) - sz * Math.sin(w);
        P.pos[k + 2] = this.swirl[i * 4 + 1] + sx * Math.sin(w) + sz * Math.cos(w);
      }
      P.pos[k] += this.vel[k] * dt; P.pos[k + 1] += this.vel[k + 1] * dt; P.pos[k + 2] += this.vel[k + 2] * dt;
      if (P.pos[k + 1] < 0.004 && this.grav[i] > 0) { P.pos[k + 1] = 0.004; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.55; this.vel[k + 2] *= 0.55; }
      var u = a / L, fade = u < 0.08 ? u / 0.08 : 1 - (u - 0.08) / 0.92;
      P.col[i * 4] = this.c0[k]; P.col[i * 4 + 1] = this.c0[k + 1]; P.col[i * 4 + 2] = this.c0[k + 2]; P.col[i * 4 + 3] = fade * fade;
      P.size[i] = this.s0[i] * (1 + this.grow[i] * u);
    }
    flushParticles(P);
    return any;
  };

  // Rayo del Interceptor (como en el juego): látigo ondulado de dos hebras, núcleo blanco,
  // filo dorado delgado y halo del color del dueño. gold = 0 para rayos que no son del orbe.
  function makeBeam(color, gold) {
    var m = addBlend(new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uGold: { value: gold == null ? 1 : gold } },
      vertexShader: VS_UV,
      fragmentShader: [
        "uniform float uI; uniform float uT; uniform vec3 uColor; uniform float uGold; varying vec2 vUv;",
        "void main(){",
        "  float x = (vUv.x - 0.5) * 2.0, y = vUv.y;",
        "  float env = pow(max(sin(3.14159 * y), 0.0), 0.8);",
        "  float ph = y * 8.0 - uT * 16.0;",
        "  float w1 = (sin(ph) * 0.34 + sin(ph * 2.3 + 1.0) * 0.07) * env;",
        "  float w2 = (sin(ph + 2.4) * 0.28 + sin(ph * 3.1 - uT * 6.0) * 0.06) * env;",
        "  float d1 = x - w1, d2 = x - w2;",
        "  float core = exp(-d1 * d1 * 900.0) * 1.9 + exp(-d2 * d2 * 1500.0) * 1.1;",
        "  float rim = exp(-d1 * d1 * 220.0) * 0.9 + exp(-d2 * d2 * 320.0) * 0.55;",
        "  float halo = exp(-d1 * d1 * 40.0) * 0.4 + exp(-x * x * 5.0) * 0.08;",
        "  float tip = smoothstep(0.0, 0.025, y) * smoothstep(1.0, 0.975, y);",
        "  vec3 c = vec3(2.3, 2.4, 2.3) * core + mix(uColor * 1.5, vec3(2.0, 1.35, 0.35), uGold) * rim + uColor * 1.4 * halo;",
        "  float a = clamp(core + rim * 0.7 + halo, 0.0, 4.0) * uI * tip;",
        "  gl_FragColor = vec4(c * uI * tip, a);",
        "}"].join("\n")
    }));
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }
  var _bm = new THREE.Matrix4(), _b1 = new V3(), _b2 = new V3(), _b3 = new V3(), _b4 = new V3();
  function orientBeam(mesh, a, b, cam, width) {
    _b1.subVectors(b, a); var len = _b1.length(); _b1.normalize();
    _b4.addVectors(a, b).multiplyScalar(0.5);
    _b2.subVectors(cam.position, _b4).normalize();
    _b3.crossVectors(_b1, _b2).normalize();
    _b2.crossVectors(_b3, _b1).normalize();
    _bm.makeBasis(_b3, _b1, _b2);
    mesh.position.copy(_b4);
    mesh.quaternion.setFromRotationMatrix(_bm);
    mesh.scale.set(width, len, 1);
  }

  // Anillo en el suelo (ondas de choque, radios): borde nítido + estela suave hacia dentro
  function ringMat(color, inten) {
    return addBlend(new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: 0 }, uW: { value: 0.12 }, uI: { value: inten || 2.0 } },
      vertexShader: VS_UV,
      fragmentShader: "uniform vec3 uC; uniform float uA; uniform float uW; uniform float uI; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; if (r > 1.0) discard; float d = (1.0 - r) / max(uW, 0.001); float e = (1.0 - r) * 140.0; float band = exp(-d * d * 2.5) * 0.7 + exp(-e * e); float a = band * uA; gl_FragColor = vec4(uC * a * uI, a); }"
    }));
  }
  function makeRing(color, inten) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMat(color, inten));
    m.rotation.x = -PI / 2;
    m.visible = false;
    return m;
  }

  // Púa orgánica (las de la mutación): cono curvado en el vertex shader
  var SPIKE_GEO = (function () { var g = new THREE.ConeGeometry(1, 1, 10, 16, true); g.translate(0, 0.5, 0); return g; })();
  function spikeMat(tip, base) {
    return new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uGrow: { value: 0 }, uBend: { value: 0.35 }, uR: { value: 0.07 }, uH: { value: 0.8 }, uFlash: { value: 0 }, uSeed: { value: 0 }, uTip: { value: new THREE.Color(tip) }, uBase: { value: new THREE.Color(base) } },
      vertexShader: [
        "uniform float uT; uniform float uGrow; uniform float uBend; uniform float uR; uniform float uH; uniform float uSeed; varying float vH; varying vec3 vN; varying vec3 vV;",
        "void main(){",
        "  vec3 p = position; float h = p.y; vH = h;",
        "  float w = sin(uT * 3.1 + uSeed * 6.28 + h * 5.0) * 0.05 * h + sin(uT * 7.0 + uSeed * 3.0) * 0.015 * h;",
        "  p.xz *= uR * (0.35 + 0.65 * uGrow);",
        "  p.y = h * uH * uGrow;",
        "  p.x += (uBend * h * h + w) * uH * uGrow;",
        "  vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv;",
        "}"].join("\n"),
      fragmentShader: [
        "uniform float uFlash; uniform vec3 uTip; uniform vec3 uBase; varying float vH; varying vec3 vN; varying vec3 vV;",
        "void main(){",
        "  vec3 n = normalize(vN);",
        "  float fr = pow(1.0 - abs(dot(n, normalize(vV))), 2.0);",
        "  float lit = 0.35 + 0.65 * max(dot(n, normalize(vec3(-0.4, 0.75, 0.55))), 0.0);",
        "  float tip = smoothstep(0.5, 1.0, vH);",
        "  vec3 c = uBase * lit * (0.3 + 0.7 * vH) + uTip * (tip * tip * 2.4 + fr * (0.12 + 0.45 * vH)) + uTip * uFlash * 1.4 * vH;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"].join("\n")
    });
  }
  function makeSpike(tip, base, ang, rad, h, r, bend, seed) {
    var m = new THREE.Mesh(SPIKE_GEO, spikeMat(tip, base));
    m.frustumCulled = false;
    m.userData = { ang: ang, rad: rad, h: h, r: r, bend: bend, seed: seed };
    m.material.uniforms.uH.value = h; m.material.uniforms.uR.value = r; m.material.uniforms.uBend.value = bend; m.material.uniforms.uSeed.value = seed;
    m.rotation.y = -ang;
    m.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
    return m;
  }

  /* ---- Orbe del Interceptor (como en el juego): esfera azul jaspeada y brillante,
         envuelta por garras negras curvas con el filo interior dorado que giran a su alrededor ---- */
  // Garra: cuerno curvo y aplanado que abraza la esfera; aIn = 1 en el filo que mira al núcleo
  function clawGeo(r0, W, span, hook) {
    var NS = 30, NC = 12, pos = [], ain = [], idx = [], i, j;
    for (i = 0; i <= NS; i++) {
      var s = i / NS, th = span * (s - 0.35), R = r0 + hook * Math.pow(s, 2.2);
      // nunca llega a 0 exacto: anillos degenerados dan normales nulas → NaN → rayas negras en el bloom
      var taper = Math.max(0.03, Math.sqrt(Math.min(1, s / 0.07)) * Math.pow(1 - s, 0.85));
      var wr = W * taper, wz = W * 0.62 * taper, cx = Math.cos(th), sy = Math.sin(th);
      for (j = 0; j <= NC; j++) {
        var ph = j / NC * PI * 2, cr = Math.cos(ph), sz = Math.sin(ph);
        var rr = R + cr * wr;
        pos.push(cx * rr, sy * rr, sz * wz);
        ain.push(-cr);
      }
    }
    for (i = 0; i < NS; i++) for (j = 0; j < NC; j++) {
      var a = i * (NC + 1) + j, b = a + NC + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aIn", new THREE.Float32BufferAttribute(ain, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  var CLAW_GEO = clawGeo(0.27, 0.074, 1.6, 0.12);
  var CLAW_MAT = new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: 0 } },
    transparent: true, // se pinta después de la cúpula aditiva (si no, la tiñe)
    vertexShader: "attribute float aIn; varying float vIn; varying vec3 vN; varying vec3 vV; varying vec3 vC; void main(){ vIn = aIn; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; vC = normalMatrix * -position; gl_Position = projectionMatrix * mv; }",
    fragmentShader: [
      "uniform float uPulse; varying float vIn; varying vec3 vN; varying vec3 vV; varying vec3 vC;",
      "void main(){",
      "  vec3 n = vN / max(length(vN), 1e-5); vec3 v = normalize(vV); vec3 r = reflect(-v, n);",
      "  float fr = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 3.0);",
      "  float spec = pow(max(dot(r, normalize(vec3(0.35, 0.85, 0.4))), 0.0), 36.0);",
      "  float band = smoothstep(0.1, 0.9, r.y) * 0.18;",
      "  float core = max(dot(n, vC / max(length(vC), 1e-5)), 0.0);",
      "  vec3 black = vec3(0.012, 0.014, 0.022) + vec3(0.6, 0.7, 0.9) * band + vec3(1.8) * spec + vec3(0.05, 0.3, 0.8) * core * (0.5 + uPulse) + vec3(0.1, 0.25, 0.45) * fr;",
      "  float g = smoothstep(0.3, 0.55, vIn);",
      "  vec3 gold = mix(vec3(0.75, 0.42, 0.06), vec3(1.7, 1.15, 0.3), smoothstep(-0.3, 0.8, r.y)) * (1.0 + uPulse * 0.8) + vec3(2.0, 1.7, 1.0) * spec;",
      "  gl_FragColor = vec4(mix(black, gold, g), 1.0);",
      "}"].join("\n")
  });
  function makeOrb() {
    var g = new THREE.Group();
    var coreMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uPulse: { value: 0 } },
      transparent: true,
      vertexShader: "varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }",
      fragmentShader: [
        "uniform float uT; uniform float uPulse; varying vec3 vN; varying vec3 vV; varying vec3 vP;",
        GLSL_NOISE,
        "void main(){",
        "  vec3 p = normalize(vP);",
        "  vec3 q = p * 2.0 + vec3(vn3(p * 2.6 + uT * 0.25), vn3(p * 2.6 + 7.1 - uT * 0.2), vn3(p * 2.6 + 3.3 + uT * 0.15)) * 1.6;",
        "  float m = sin(q.y * 5.0 + q.x * 2.0 + vn3(q * 2.2 + uT * 0.3) * 6.0 + uT * 0.9);",
        "  float m2 = vn3(q * 4.0 - uT * 0.4);",
        "  vec3 deep = vec3(0.015, 0.09, 0.42), mid = vec3(0.07, 0.38, 1.05), lite = vec3(0.3, 1.05, 1.35);",
        "  vec3 c = mix(deep, mid, smoothstep(-0.7, 0.2, m));",
        "  c = mix(c, lite, smoothstep(0.45, 0.95, m) * (0.6 + 0.4 * m2));",
        "  vec3 n = vN / max(length(vN), 1e-5); vec3 v = normalize(vV);",
        "  float face = abs(dot(n, v));",
        "  float spec = pow(max(dot(reflect(-v, n), normalize(vec3(-0.35, 0.75, 0.55))), 0.0), 48.0);",
        "  c *= 0.75 + 0.35 * face;",
        "  c += vec3(0.25, 0.75, 1.3) * pow(clamp(1.0 - face, 0.0, 1.0), 2.5) * 0.9;",
        "  c += vec3(1.6, 1.8, 1.9) * spec;",
        "  c *= 1.0 + uPulse * 0.9;",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"].join("\n")
    });
    var core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 32), coreMat);
    core.renderOrder = 20;
    // 7 garras en planos distintos (puntos de Fibonacci): parecen una jaula alrededor de la esfera
    var claws = new THREE.Group(), list = [], Z = new V3(0, 0, 1);
    for (var i = 0; i < 7; i++) {
      var y = 1 - (i + 0.5) / 7 * 2, rad = Math.sqrt(1 - y * y), th = i * 2.39996;
      var nrm = new V3(Math.cos(th) * rad, y, Math.sin(th) * rad);
      var m = new THREE.Mesh(CLAW_GEO, CLAW_MAT);
      m.renderOrder = 20;
      m.scale.setScalar(0.9 + (i % 3) * 0.08);
      m.userData = { q0: new THREE.Quaternion().setFromUnitVectors(Z, nrm), a0: i * 1.7, w: (i % 2 ? 1 : -1) * (0.35 + (i % 3) * 0.12) };
      claws.add(m); list.push(m);
    }
    // halo detrás del orbe (si queda encima, el aditivo deslava las garras)
    var glow = sprite(0x2f8dff, 1.3, 0.5);
    glow.onBeforeRender = function (r, sc, cam) {
      g.worldToLocal(glow.position.setFromMatrixPosition(cam.matrixWorld)).normalize().multiplyScalar(-0.45);
      glow.updateMatrixWorld();
    };
    var light = new THREE.PointLight(0x4aa8ff, 2, 3.5, 2);
    g.add(core, claws, glow, light);
    g.userData = { coreMat: coreMat, claws: claws, list: list, glow: glow, light: light };
    return g;
  }
  var _clq = new THREE.Quaternion(), _clz = new V3(0, 0, 1);
  function animateOrb(o, t, pulse, spin, open) {
    var u = o.userData;
    u.coreMat.uniforms.uT.value = t;
    u.coreMat.uniforms.uPulse.value = pulse;
    CLAW_MAT.uniforms.uPulse.value = pulse;
    // cerradas abrazan la esfera; activas se separan un poco y cada una gira en su plano
    u.claws.scale.setScalar(0.8 + 0.14 * open);
    u.claws.rotation.set(Math.sin(t * 0.3) * 0.4, t * 0.25 * spin, Math.cos(t * 0.23) * 0.3);
    for (var i = 0; i < u.list.length; i++) {
      var m = u.list[i], d = m.userData;
      m.quaternion.copy(d.q0).multiply(_clq.setFromAxisAngle(_clz, d.a0 + t * d.w * (0.4 + 0.6 * open) * spin));
    }
    u.glow.material.opacity = 0.3 + pulse * 0.45;
    u.glow.scale.setScalar(1.1 + pulse * 0.9);
    u.light.intensity = 0.9 + pulse * 3;
  }

  /* ---- Utilidad enemiga (roja) ---- */
  var M_RED = new THREE.MeshStandardMaterial({ color: 0x1a0306, emissive: 0xff2438, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.35 });
  var M_DARK = new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0.85, roughness: 0.3 });
  var M_HOT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 1.6) });
  function makeProjectile(kind) {
    var g = new THREE.Group(), i, m;
    if (kind === "grenade") {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), M_DARK));
      m = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 32), M_RED); m.rotation.x = PI / 2; g.add(m);
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12), M_RED); m.position.y = 0.11; g.add(m);
      m = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), M_DARK); m.position.set(0.04, 0.145, 0); g.add(m);
    } else if (kind === "flash") {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1), M_HOT));
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.25, 0.3), wireframe: true })));
    } else if (kind === "dart") {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8), M_DARK));
      m = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 10), M_RED); m.position.y = 0.27; g.add(m);
      for (i = 0; i < 3; i++) { m = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.09, 0.07), M_RED); m.rotation.y = i * PI * 2 / 3; m.position.y = -0.17; m.translateZ(0.032); g.add(m); }
      g.userData.align = true;
    } else if (kind === "knife") {
      var sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.035, 0.02); sh.lineTo(0.03, 0.2); sh.lineTo(0, 0.29); sh.lineTo(-0.012, 0.2); sh.lineTo(-0.012, 0.02); sh.lineTo(0, 0);
      m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false }), M_RED); m.position.z = -0.004; g.add(m);
      m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.02), M_DARK); m.position.y = -0.05; g.add(m);
      g.userData.align = true; g.userData.roll = true;
    } else if (kind === "molotov") {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0x2a0c05, emissive: 0xff5a1f, emissiveIntensity: 1.2, roughness: 0.2 })));
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.08, 10), M_DARK); m.position.y = 0.11; g.add(m);
      m = sprite(0xff7a2a, 0.3, 0.9); m.position.y = 0.18; g.add(m);
    } else {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), M_DARK); m.scale.y = 0.6; g.add(m);
      m = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M_RED); m.position.z = 0.06; g.add(m);
      for (i = 0; i < 4; i++) {
        var aa = i * PI / 2 + PI / 4;
        m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.018), M_DARK); m.rotation.y = -aa; g.add(m);
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 16), M_RED); m.position.set(Math.cos(aa) * 0.08, 0.012, Math.sin(aa) * 0.08); g.add(m);
      }
    }
    // lo procedural queda en "body" hasta que carga el modelo real de esa utilidad
    var body = new THREE.Group();
    while (g.children.length) body.add(g.children[0]);
    g.add(body);
    g.userData.body = body;
    var glow = sprite(C_RED, 0.55, 0.7);
    g.userData.glow = glow;
    g.add(glow);
    g.visible = false;
    utilQueue.push([g, kind]);
    return g;
  }

  /* ---- Utilidad real (modelos de Kingdom Archives, recursos de Riot) ----
         grenade → Paint Shell · flash → FLASH/drive · dart → Recon Bolt
         knife → ZERO/point · molotov → Incendiary · drone → Owl Drone */
  var UTIL_DIR = "assets/models/util/";
  var UTIL = {
    grenade: { id: "paintshell", len: 0.3 }, flash: { id: "flashdrive", len: 0.3 }, dart: { id: "recon-bolt", len: 0.62, align: true },
    knife: { id: "zeropoint", len: 0.48, align: true }, molotov: { id: "incendiary-shell", len: 0.32 }, drone: { id: "owl-drone", len: 0.62, level: true }
  };
  var utilQueue = [], utilCache = {};
  function utilTex(url, srgb) {
    var t = new THREE.TextureLoader().load(url);
    t.flipY = false;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function utilAsset(id) {
    if (utilCache[id]) return utilCache[id];
    var dir = UTIL_DIR + id + "/";
    utilCache[id] = fetch(dir + id + ".glb").then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(function (buf) {
      var df = utilTex(dir + "df.webp", true), orm = utilTex(dir + "orm.webp", false), nm = utilTex(dir + "nm.webp", false);
      return {
        buf: buf,
        mat: new THREE.MeshStandardMaterial({ map: df, normalMap: nm, roughnessMap: orm, metalnessMap: orm, metalness: 1, roughness: 1, envMapIntensity: 1.4, toneMapped: false })
      };
    });
    return utilCache[id];
  }
  function upgradeProjectile(g, kind) {
    var u = UTIL[kind];
    if (!u) return;
    utilAsset(u.id).then(function (a) {
      loader.parse(a.buf.slice(0), "", function (gltf) {
        var model = gltf.scene;
        model.traverse(function (o) {
          if (!o.isMesh) return;
          var name = (o.material && o.material.name) || "";
          if (/Overlay/i.test(name)) { o.visible = false; return; }
          o.material = a.mat;
          o.frustumCulled = false;
        });
        var wrap = new THREE.Group();
        wrap.add(model);
        wrap.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(model), size = box.getSize(new V3()), c = box.getCenter(new V3());
        model.position.sub(c);
        // el eje largo apunta a +Y (dirección de vuelo) en lo que se lanza "de punta"
        if (u.align) { if (size.x >= size.y && size.x >= size.z) wrap.rotation.z = -PI / 2; else if (size.z >= size.y) wrap.rotation.x = PI / 2; }
        var holder = new THREE.Group();
        holder.add(wrap);
        holder.scale.setScalar(u.len / Math.max(size.x, size.y, size.z, 0.001));
        var body = g.userData.body;
        while (body.children.length) body.remove(body.children[0]);
        body.add(holder);
        g.userData.glow.material.opacity = 0.2;
        g.userData.glow.scale.setScalar(0.4);
        if (u.level) g.userData.level = true;
      }, function () {});
    }).catch(function () { /* se queda la versión procedural */ });
  }

  /* ---- Disparo: proyectil → el rayo lo atrapa → se cristaliza → estalla en cristales (determinista en x) ---- */
  var TRAIL = 18, BOOM = 46, NCRYS = 8, HOLD = 0.3;
  var CRYS_GEO = (function () { var g = new THREE.OctahedronGeometry(1, 0); g.scale(0.3, 0.62, 0.3); g.translate(0, 0.42, 0); return g; })();
  var CRYS_MAT = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    uniforms: { uFlash: { value: 0 } },
    vertexShader: "varying vec3 vV; varying float vY; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }",
    fragmentShader: [
      "varying vec3 vV; varying float vY;",
      "void main(){",
      "  vec3 n = cross(dFdx(vV), dFdy(vV)); n /= max(length(n), 1e-8); vec3 v = normalize(vV);",
      "  float face = abs(dot(n, v));",
      "  float glint = pow(max(dot(reflect(-v, n), normalize(vec3(0.3, 0.8, 0.5))), 0.0), 18.0);",
      "  vec3 c = mix(vec3(0.02, 0.16, 0.55), vec3(0.18, 0.85, 1.25), pow(clamp(1.0 - face, 0.0, 1.0), 1.3));",
      "  c += vec3(0.2, 0.75, 1.1) * smoothstep(0.6, 1.05, vY) * 0.6 + vec3(1.3, 1.6, 1.8) * glint;",
      "  gl_FragColor = vec4(c, 1.0);",
      "}"].join("\n")
  });
  // Destello eléctrico (rayos azules en estrella) mirando a cámara
  function makeZap() {
    var m = addBlend(new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 }, uT: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: VS_UV,
      fragmentShader: [
        "uniform float uI; uniform float uT; uniform float uSeed; varying vec2 vUv;",
        "float zh(float n){ return fract(sin(n) * 43758.5453); }",
        "float zn(float x){ float i = floor(x); float f = fract(x); return mix(zh(i), zh(i + 1.0), f) * 2.0 - 1.0; }",
        "void main(){",
        "  vec2 q = (vUv - 0.5) * 2.0; float r = length(q), a = atan(q.y, q.x);",
        "  float k = floor(uT * 26.0) * 1.37 + uSeed;",
        "  float u = a / 6.28318 * 9.0 + zh(k) * 9.0; float cell = floor(u + 0.5);",
        "  float wob = zn(r * 14.0 + cell * 7.1 + k) * 0.07 * r + zn(r * 31.0 + cell * 3.3 + k) * 0.025 * r;",
        "  float d = abs((u - cell) * 6.28318 / 9.0 * r - wob);",
        "  float len = 0.45 + 0.55 * zh(cell * 5.7 + k);",
        "  float ray = exp(-d * d * 2600.0) * (1.0 - smoothstep(len * 0.7, len, r));",
        "  float core = exp(-r * r * 22.0);",
        "  vec3 c = vec3(0.35, 0.85, 2.4) * (ray * 1.6 + core * 0.9) + vec3(2.2) * ray * exp(-r * 3.0) + vec3(1.6, 1.9, 2.2) * exp(-r * r * 120.0);",
        "  float al = (ray + core) * uI;",
        "  gl_FragColor = vec4(c * uI, al);",
        "}"].join("\n")
    }));
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }
  var _sv = new V3(), _st = new V3(), _up = new V3(0, 1, 0);
  function Shot(scene, kind, seed, beamColor) {
    this.kind = kind;
    this.mesh = makeProjectile(kind); scene.add(this.mesh);
    this.trail = makeParticles(TRAIL); scene.add(this.trail.points);
    this.boom = makeParticles(BOOM); scene.add(this.boom.points);
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_RING, color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.ring.visible = false; scene.add(this.ring);
    this.flash = sprite(0xbfe8ff, 1, 1); this.flash.visible = false; scene.add(this.flash);
    this.zap = makeZap(); scene.add(this.zap);
    this.beam = makeBeam(beamColor || C_CYAN); scene.add(this.beam);
    this.S = new V3(); this.C = new V3(); this.E = new V3(); this.src = new V3();
    var r = rng(seed);
    this.zap.material.uniforms.uSeed.value = r() * 100;
    this.dirs = []; this.spd = []; this.cyan = [];
    for (var k = 0; k < BOOM; k++) {
      var th = r() * PI * 2, ph = Math.acos(2 * r() - 1);
      this.dirs.push(new V3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.8 + 0.2, Math.sin(ph) * Math.sin(th)));
      this.spd.push(0.5 + r() * 1.4);
      this.cyan.push(r() < 0.75);
    }
    // cristales: cada uno crece hacia fuera desde el punto de impacto y luego sale volando
    this.crys = [];
    for (var c = 0; c < NCRYS; c++) {
      var ct = r() * PI * 2, cp = Math.acos(2 * r() - 1);
      var dir = new V3(Math.sin(cp) * Math.cos(ct), Math.cos(cp), Math.sin(cp) * Math.sin(ct));
      var cm = new THREE.Mesh(CRYS_GEO, CRYS_MAT);
      cm.visible = false; cm.frustumCulled = false; scene.add(cm);
      cm.userData = { dir: dir, q: new THREE.Quaternion().setFromUnitVectors(_up, dir), len: 0.2 + r() * 0.16, spd: 0.7 + r() * 0.9, rot: new V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), delay: r() * 0.08 };
      this.crys.push(cm);
    }
    this.spin = new V3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    this.launch = 0; this.hit = 1; this.life = 1; this.pre = 0.01; this.post = 0.02; this.scale = 1;
  }
  Shot.prototype.set = function (S, E, launch, hit, life, pre, post, arc) {
    this.S.copy(S); this.E.copy(E);
    this.C.addVectors(S, E).multiplyScalar(0.5); this.C.y += arc;
    this.launch = launch; this.hit = hit; this.life = life; this.pre = pre; this.post = post;
  };
  var _cq = new THREE.Quaternion();
  Shot.prototype.update = function (x, cam, t) {
    var u = (x - this.launch) / (this.hit - this.launch), k, i;
    var tau = (x - this.hit) / this.life;
    var flying = u >= 0 && u < 1;
    var held = tau >= 0 && tau < HOLD;
    this.mesh.visible = flying || held;
    this.trail.points.visible = flying;
    if (flying) {
      // sale rápido y frena al entrar al campo (el Interceptor lo "agarra")
      var ue = 1 - Math.pow(1 - u, 1.7);
      bez(this.mesh.position, this.S, this.C, this.E, ue);
      this.mesh.scale.setScalar(this.scale);
      if (this.mesh.userData.align) {
        bezTan(_st, this.S, this.C, this.E, ue);
        this.mesh.quaternion.setFromUnitVectors(_up, _st);
        if (this.mesh.userData.roll) this.mesh.rotateY(ue * 22);
      } else {
        if (this.mesh.userData.level) { bezTan(_st, this.S, this.C, this.E, ue); this.mesh.rotation.set(0, Math.atan2(_st.x, _st.z), 0); }
        else this.mesh.quaternion.setFromAxisAngle(this.spin, ue * 10);
      }
      for (k = 0; k < TRAIL; k++) {
        var uu = Math.max(0, ue - k * 0.018);
        bez(_sv, this.S, this.C, this.E, uu);
        this.trail.pos[k * 3] = _sv.x; this.trail.pos[k * 3 + 1] = _sv.y; this.trail.pos[k * 3 + 2] = _sv.z;
        var f = 1 - k / TRAIL;
        this.trail.size[k] = 0.15 * f * this.scale;
        this.trail.col[k * 4] = 2.2; this.trail.col[k * 4 + 1] = 0.35 + 0.4 * f; this.trail.col[k * 4 + 2] = 0.4; this.trail.col[k * 4 + 3] = f * f * 0.8;
      }
      flushParticles(this.trail);
    } else if (held) {
      // atrapado: tiembla mientras los cristales lo cubren
      var hk = tau / HOLD, j = 0.025 * this.scale * (0.4 + hk);
      this.mesh.position.set(this.E.x + Math.sin(t * 71) * j, this.E.y + Math.sin(t * 83 + 1) * j, this.E.z + Math.sin(t * 67 + 2) * j);
      this.mesh.scale.setScalar(this.scale * (1 - 0.2 * hk));
    }
    // rayo: conecta mientras llega y lo sostiene mientras se cristaliza
    var bw = 0, hEnd = this.hit + HOLD * this.life, fEnd = hEnd + 0.06 * this.life;
    if (x >= this.hit - this.pre && x <= fEnd) {
      bw = x < this.hit ? (x - (this.hit - this.pre)) / this.pre : x < hEnd ? 1 : 1 - (x - hEnd) / (fEnd - hEnd);
      bw = clamp(bw, 0, 1) * (0.85 + 0.15 * Math.sin(t * 50));
    }
    this.beam.visible = bw > 0.01;
    if (this.beam.visible) {
      orientBeam(this.beam, this.src, this.mesh.visible ? this.mesh.position : this.E, cam, 0.42 * this.scale);
      this.beam.material.uniforms.uI.value = bw;
      this.beam.material.uniforms.uT.value = t;
    }
    // cristales: crecen sobre la utilidad y, al romperse, salen disparados
    var live = tau >= 0 && tau < 1;
    for (i = 0; i < NCRYS; i++) {
      var cm = this.crys[i], d = cm.userData;
      cm.visible = live;
      if (!live) continue;
      var gk = EASE.back(clamp((tau - d.delay) / 0.2, 0, 1));
      if (tau < HOLD) {
        cm.position.copy(this.E);
        cm.quaternion.copy(d.q);
        cm.scale.setScalar(Math.max(0.001, gk * d.len * this.scale));
      } else {
        var sk = (tau - HOLD) / (1 - HOLD), tr = (1 - Math.pow(1 - sk, 2)) * d.spd * this.scale;
        cm.position.set(this.E.x + d.dir.x * tr, this.E.y + d.dir.y * tr - sk * sk * 0.9 * this.scale, this.E.z + d.dir.z * tr);
        cm.quaternion.copy(d.q).premultiply(_cq.setFromAxisAngle(d.rot, sk * 7));
        cm.scale.setScalar(Math.max(0.001, d.len * this.scale * (1 - sk) * (1 - sk * 0.3)));
      }
    }
    // estallido al romperse (tb: tiempo desde que se rompe)
    var tb = (tau - HOLD) / (1 - HOLD);
    var boom = tb >= 0 && tb < 1;
    this.boom.points.visible = boom; this.ring.visible = boom; this.flash.visible = boom && tb < 0.2;
    if (boom) {
      var e = 1 - tb;
      for (k = 0; k < BOOM; k++) {
        var dd = this.dirs[k], s = this.spd[k] * this.scale;
        var travel = (1 - Math.pow(1 - tb, 2.2)) * s;
        this.boom.pos[k * 3] = this.E.x + dd.x * travel;
        this.boom.pos[k * 3 + 1] = this.E.y + dd.y * travel - tb * tb * 0.6 * this.scale;
        this.boom.pos[k * 3 + 2] = this.E.z + dd.z * travel;
        this.boom.size[k] = (0.07 + 0.06 * (1 - tb)) * this.scale;
        if (this.cyan[k]) { this.boom.col[k * 4] = 0.45; this.boom.col[k * 4 + 1] = 1.5; this.boom.col[k * 4 + 2] = 2.4; }
        else { var hot = Math.max(0, 1 - tb * 3); this.boom.col[k * 4] = 2.4; this.boom.col[k * 4 + 1] = 0.3 + 1.4 * hot; this.boom.col[k * 4 + 2] = 0.35 + 1.2 * hot; }
        this.boom.col[k * 4 + 3] = Math.pow(e, 1.4);
      }
      flushParticles(this.boom);
      this.ring.position.copy(this.E);
      this.ring.scale.setScalar((0.2 + EASE.out(tb) * 1.5) * this.scale);
      this.ring.material.opacity = e * 0.7;
      this.flash.position.copy(this.E);
      this.flash.scale.setScalar(Math.max(0.001, 1.2 - tb * 5) * this.scale);
    }
    // chispas eléctricas: chisporrotea mientras lo sostiene y revienta al romperse
    var zi = 0;
    if (held) zi = 0.25 + 0.35 * (tau / HOLD) * (0.5 + 0.5 * Math.sin(t * 40));
    if (tb >= 0 && tb < 0.45) zi = Math.max(zi, 1.6 * (1 - tb / 0.45));
    this.zap.visible = zi > 0.01;
    if (this.zap.visible) {
      this.zap.position.copy(this.E);
      this.zap.quaternion.copy(cam.quaternion);
      this.zap.scale.setScalar((held && tb < 0 ? 0.6 : 0.6 + EASE.out(clamp(tb / 0.3, 0, 1)) * 0.7) * this.scale);
      this.zap.material.uniforms.uI.value = zi;
      this.zap.material.uniforms.uT.value = t;
    }
    return { beam: bw, tau: tau, flying: flying, held: held };
  };
  Shot.prototype.hide = function () {
    this.mesh.visible = this.trail.points.visible = this.boom.points.visible = this.ring.visible = this.flash.visible = this.beam.visible = this.zap.visible = false;
    this.crys.forEach(function (c) { c.visible = false; });
  };

  /* ================================================================ ESCENAS VETO */
  function makeScene(ult) {
    var s = new THREE.Scene();
    s.environment = envTex;
    s.add(new THREE.HemisphereLight(0xe8f6ff, 0x0c1416, 0.45));
    var key = new THREE.DirectionalLight(0xfff0e0, 1.75); key.position.set(-2.4, 3.4, 3.6);
    var fill = new THREE.DirectionalLight(0x9fd8ff, 0.35); fill.position.set(2.8, 1.0, 3.0);
    var rimA = new THREE.DirectionalLight(C_CYAN, ult ? 2.2 : 2.0); rimA.position.set(2.8, 2.6, -2.8);
    var rimB = new THREE.DirectionalLight(ult ? C_LIME : 0xe3a444, ult ? 1.4 : 1.2); rimB.position.set(-3.0, 1.4, -2.4);
    var fist = new THREE.PointLight(ult ? 0xb8ff6a : C_CYAN, 0, 1.6, 2);   // luz del puño mutado
    var fx = new THREE.PointLight(C_CYAN, 0, 4.5, 2);                        // luz de las habilidades
    s.add(key, fill, rimA, rimB, fist, fx);
    s.userData = { fist: fist, fx: fx };
    return s;
  }
  var sceneBase = makeScene(false), sceneUlt = makeScene(true), sceneFx = new THREE.Scene();
  sceneFx.environment = envTex;
  sceneFx.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.1));

  function glowDisc(color, size, strength) {
    var m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: strength } },
      vertexShader: VS_UV,
      fragmentShader: "uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * uA; gl_FragColor = vec4(uColor * a, a); }"
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    mesh.rotation.x = -PI / 2;
    return mesh;
  }
  function makePlatform(color) {
    var g = new THREE.Group();
    var r1 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.63, 96), additive(color, 0.3));
    var r2 = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.784, 96, 1, 0, PI * 1.4), additive(color, 0.16));
    [r1, r2].forEach(function (m) { m.rotation.x = -PI / 2; m.position.y = 0.004; g.add(m); });
    g.add(glowDisc(color, 1.6, 0.09));
    g.userData.spin = r2;
    return g;
  }
  var platBase = makePlatform(C_CYAN), platUlt = makePlatform(C_LIME);
  sceneBase.add(platBase); sceneUlt.add(platUlt);

  /* ================================================================ COMPOSICIÓN */
  var cyanL = new THREE.Color(C_CYAN).convertSRGBToLinear();
  var limeL = new THREE.Color(C_LIME).convertSRGBToLinear();
  var U = {
    tBase: { value: rtBase.texture }, tUlt: { value: rtUlt.texture },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVeto: { value: new THREE.Vector4(0, 0, 0, 0) }, uIxR: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHover: { value: new THREE.Vector2(-9999, -9999) }, uHoverR: { value: 0 },
    uSweepC: { value: new THREE.Vector2(0, 0) }, uSweepR: { value: 0 },
    uInkA: { value: new THREE.Vector4(0, 0, 0, 0) }, uInkAC: { value: new THREE.Vector2(0, 0) }, uInkAR: { value: 1e5 },
    uInkB: { value: new THREE.Vector4(0, 0, 0, 0) }, uInkBC: { value: new THREE.Vector2(0, 0) }, uInkBR: { value: 1e5 },
    uTime: { value: 0 }, uIntro: { value: 0 }, uUlt: { value: 0 },
    uGlitch: { value: 0 }, uFlash: { value: 0 }, uFlashC: { value: cyanL.clone() }, uFlashP: { value: new THREE.Vector2(-9999, -9999) }, uFlashR: { value: 1 }, uCyan: { value: cyanL }, uLime: { value: limeL }
  };
  var VS_POST = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  var compMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, uniforms: U,
    vertexShader: VS_POST,
    fragmentShader: [
      "uniform sampler2D tBase; uniform sampler2D tUlt; uniform vec2 uRes;",
      "uniform vec4 uVeto; uniform vec4 uIxR;",
      "uniform vec2 uHover; uniform float uHoverR; uniform vec2 uSweepC; uniform float uSweepR;",
      "uniform vec4 uInkA; uniform vec2 uInkAC; uniform float uInkAR; uniform vec4 uInkB; uniform vec2 uInkBC; uniform float uInkBR;",
      "uniform float uTime; uniform float uIntro; uniform float uUlt; uniform float uGlitch; uniform float uFlash; uniform vec3 uFlashC; uniform vec2 uFlashP; uniform float uFlashR; uniform vec3 uCyan; uniform vec3 uLime;",
      "varying vec2 vUv;",
      "float hash(float n){ return fract(sin(n) * 43758.5453); }",
      "float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
      "float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y); }",
      "float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }",
      "float inRect(vec2 p, vec4 r){ return step(r.x, p.x) * step(p.x, r.z) * step(r.y, p.y) * step(p.y, r.w); }",
      "float circleMask(vec2 p, vec2 c, float r, out float band){",
      "  vec2 d = p - c; float dist = length(d); float ang = atan(d.y, d.x);",
      "  float wob = sin(ang * 5.0 + uTime * 1.6) * 0.035 + sin(ang * 13.0 - uTime * 2.3) * 0.018;",
      "  float R = max(r, 0.001) * (1.0 + wob); float on = step(0.5, r);",
      "  band = smoothstep(R * 0.5, R * 0.8, dist) * (1.0 - smoothstep(R * 0.8, R * 1.04, dist)) * on;",
      "  return (1.0 - smoothstep(R * 0.6, R, dist)) * on;",
      "}",
      // Tinta líquida: borde orgánico + trazo blanco + salpicaduras cian/lima
      "float ink(vec2 p, vec4 rect, vec2 c, float r, out float edge, out vec3 ecol){",
      "  edge = 0.0; ecol = vec3(0.0);",
      "  if (inRect(p, rect) < 0.5) return 1.0;",
      "  if (r < 0.5) return 0.0;",
      "  if (r > 5.0e4) return 1.0;",
      "  vec2 d = p - c; float dist = length(d); float ang = atan(d.y, d.x);",
      "  vec2 q = vec2(cos(ang), sin(ang));",
      "  float n = fbm(q * 2.2 + 7.3 + uTime * 0.04);",
      "  float n2 = fbm(q * 6.0 + dist * 0.002);",
      "  float R = r * (0.74 + 0.5 * n);",
      "  float mask = 1.0 - smoothstep(R - 1.5, R + 1.5, dist);",
      "  float t1 = max(3.0, r * 0.055 * (0.25 + n2));",
      "  float s1 = smoothstep(R, R + 1.5, dist) * (1.0 - smoothstep(R + t1, R + t1 + 1.5, dist));",
      "  float g = t1 * 0.9; float t2 = t1 * 0.5;",
      "  float s2 = smoothstep(R + t1 + g, R + t1 + g + 1.5, dist) * (1.0 - smoothstep(R + t1 + g + t2, R + t1 + g + t2 + 1.5, dist)) * step(0.52, n2);",
      "  vec2 cell = floor(p / 22.0); float h = hash2(cell);",
      "  vec2 cp = (cell + 0.5 + (vec2(hash2(cell + 3.1), hash2(cell + 7.7)) - 0.5) * 0.7) * 22.0;",
      "  float near = 1.0 - smoothstep(0.0, t1 * 3.5, abs(dist - (R + t1 * (1.5 + 3.0 * h))));",
      "  float splat = step(h, 0.22) * (1.0 - smoothstep(1.5 + 5.0 * h, 2.5 + 5.0 * h, length(p - cp))) * near;",
      "  edge = max(max(s1, s2 * 0.9), splat);",
      "  float tint = fract(n * 9.0 + n2 * 3.0);",
      "  ecol = mix(vec3(0.85, 0.9, 0.87), mix(uCyan, uLime, step(0.5, fract(n2 * 5.0))), step(0.55, tint) * max(s2, splat));",
      "  return mask;",
      "}",
      "void main(){",
      "  vec2 base = vUv * uRes;",
      "  vec2 uv = vUv;",
      "  float gk = floor(uTime * 24.0);",
      "  if (uGlitch > 0.001) {",
      "    float row = floor(uv.y * 46.0);",
      "    float on = step(1.0 - uGlitch * 0.85, hash(row + gk));",
      "    uv.x += (hash(row * 1.7 + gk) - 0.5) * 0.12 * uGlitch * on;",
      "  }",
      "  vec2 px = uv * uRes;",
      "  float inV = inRect(base, uVeto); float inI = inRect(base, uIxR);",
      "  float bh; float bs;",
      "  float h = circleMask(px, uHover, uHoverR, bh) * inV;",
      "  float s = circleMask(px, uSweepC, uSweepR, bs) * inV;",
      "  float m = clamp(s + h - 2.0 * s * h, 0.0, 1.0) * uUlt;",
      "  float band = max(bh, bs) * uUlt * inV;",
      "  vec4 a = texture2D(tBase, uv); vec4 b = texture2D(tUlt, uv);",
      "  float ca = band * 6.0 + uGlitch * 10.0;",
      "  if (ca > 0.01) {",
      "    vec2 dir = normalize(px - (bh > bs ? uHover : uSweepC) + 0.001);",
      "    if (uGlitch > 0.01) dir = vec2(1.0, 0.0);",
      "    vec2 off = dir * ca / uRes;",
      "    a.r = texture2D(tBase, uv + off).r; b.r = texture2D(tUlt, uv + off).r;",
      "    a.b = texture2D(tBase, uv - off).b; b.b = texture2D(tUlt, uv - off).b;",
      "  }",
      "  vec4 col = mix(a, b, m);",
      "  float alpha = max(a.a, b.a);",
      "  vec2 fd = (px - uFlashP) / max(uFlashR, 1.0); float fl = exp(-dot(fd, fd));",
      "  col.rgb += mix(uCyan, uLime, 0.65) * band * 0.9 * alpha + uFlashC * uFlash * (0.7 * alpha + 1.4 * fl) * inV;",
      "  if (uGlitch > 0.001) col *= 1.0 - uGlitch * 0.6 * step(0.72, hash(floor(uv.y * 90.0) + gk * 1.3));",
      "  col *= clamp(inV + inI, 0.0, 1.0);",
      // intro (solo Veto)
      "  float scan = uIntro * 1.3 - 0.15;",
      "  float vis = mix(1.0, 1.0 - smoothstep(scan - 0.035, scan, vUv.y), inV);",
      "  float sedge = (1.0 - smoothstep(0.0, 0.01, abs(vUv.y - scan))) * col.a * step(uIntro, 0.999) * inV;",
      "  col *= vis;",
      "  col.rgb += uCyan * sedge * 3.0; col.a = max(col.a, sedge);",
      // entradas con tinta
      "  float eA; vec3 cA; float eB; vec3 cB;",
      "  float kA = ink(base, uInkA, uInkAC, uInkAR, eA, cA);",
      "  float kB = ink(base, uInkB, uInkBC, uInkBR, eB, cB);",
      "  col *= kA * kB;",
      "  float e = max(eA, eB); vec3 ec = eA > eB ? cA : cB;",
      "  col.rgb = mix(col.rgb, ec, e); col.a = max(col.a, e);",
      "  gl_FragColor = col;",
      "}"
    ].join("\n")
  });

  // Bloom (filtro dual): umbral suave → 5 reducciones → 4 ampliaciones acumuladas
  var downMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPre: { value: 0 }, uThr: { value: 1.35 }, uKnee: { value: 0.5 } },
    vertexShader: VS_POST,
    fragmentShader: [
      "uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPre; uniform float uThr; uniform float uKnee; varying vec2 vUv;",
      "void main(){",
      "  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;",
      "  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;",
      "  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;",
      "  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;",
      "  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;",
      "  c *= 0.125;",
      "  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = clamp(c, vec3(0.0), vec3(60.0));",
      "  if (uPre > 0.5) { float br = max(c.r, max(c.g, c.b)); float rq = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 0.0001); c *= max(rq, br - uThr) / max(br, 0.0001); }",
      "  gl_FragColor = vec4(min(c, vec3(40.0)), 1.0);",
      "}"].join("\n")
  });
  var upMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: VS_POST,
    fragmentShader: [
      "uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; varying vec2 vUv;",
      "void main(){",
      "  vec2 h = uTexel;",
      "  vec3 c = texture2D(tLow, vUv + vec2(-2.0, 0.0) * h).rgb + texture2D(tLow, vUv + vec2(2.0, 0.0) * h).rgb + texture2D(tLow, vUv + vec2(0.0, -2.0) * h).rgb + texture2D(tLow, vUv + vec2(0.0, 2.0) * h).rgb;",
      "  c += (texture2D(tLow, vUv + vec2(-1.0, -1.0) * h).rgb + texture2D(tLow, vUv + vec2(1.0, -1.0) * h).rgb + texture2D(tLow, vUv + vec2(-1.0, 1.0) * h).rgb + texture2D(tLow, vUv + vec2(1.0, 1.0) * h).rgb) * 2.0;",
      "  gl_FragColor = vec4(c / 12.0 + texture2D(tHigh, vUv).rgb, 1.0);",
      "}"].join("\n")
  });
  var finalMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { tComp: { value: rtComp.texture }, tBloom: { value: rtComp.texture }, uBloom: { value: bloomOn ? CFG.bloom : 0 } },
    vertexShader: VS_POST,
    fragmentShader: [
      "uniform sampler2D tComp; uniform sampler2D tBloom; uniform float uBloom; varying vec2 vUv;",
      "void main(){",
      "  vec4 c = texture2D(tComp, vUv);",
      "  vec3 b = uBloom > 0.0 ? texture2D(tBloom, vUv).rgb * uBloom : vec3(0.0);",
      "  gl_FragColor = vec4(c.rgb + b, c.a);",
      "  #include <tonemapping_fragment>",
      "  #include <encodings_fragment>",
      "}"].join("\n")
  });
  var postScene = new THREE.Scene();
  var postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);
  var postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function pass(mat, rt) { postQuad.material = mat; renderer.setRenderTarget(rt); renderer.render(postScene, postCam); }

  /* ================================================================ MODELOS */
  var MODEL_H = 2.0;
  var models = { base: null, ult: null };
  var fit = null;
  var legs = { T: 0.45, S: 0.45 };

  // Uniformes compartidos por los materiales de Veto: venas de la mutación + disolución (teletransporte)
  var VU = {
    uVTime: { value: 0 },
    uDiss: { value: new THREE.Vector4(10, 0.07, 1, 0) },
    uDissCol: { value: new THREE.Color(0.5, 1.9, 2.2) },
    uVein: { value: 0.8 }, uVeinUlt: { value: 0.5 }
  };
  var ARM_RE = /^L_(Elbow|Hand|Thumb|Index|Middle|Ring|Pinky)/;
  var LEG_RE = /^(L_|R_)(Hip|Knee|Foot|Toe|Leg)|^Pelvis/;
  // Índices del esqueleto para la máscara de venas: base = brazo mutado (incluir) · Evolución = todo menos piernas (excluir)
  function boneMask(mesh, ult) {
    var out = [];
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.bones.forEach(function (b, i) {
      if (/_end/.test(b.name)) return;
      if (ult ? LEG_RE.test(b.name) : ARM_RE.test(b.name)) out.push(i);
    });
    while (out.length < 32) out.push(-10);
    return out.slice(0, 32);
  }
  var ARM_GLSL = [
    "#ifdef USE_SKINNING",
    "  float vArmAcc = 0.0;",
    "  for (int ai = 0; ai < 32; ai++) {",
    "    float bI = uArm[ai];",
    "    vArmAcc += skinWeight.x * (1.0 - step(0.5, abs(skinIndex.x - bI)));",
    "    vArmAcc += skinWeight.y * (1.0 - step(0.5, abs(skinIndex.y - bI)));",
    "    vArmAcc += skinWeight.z * (1.0 - step(0.5, abs(skinIndex.z - bI)));",
    "    vArmAcc += skinWeight.w * (1.0 - step(0.5, abs(skinIndex.w - bI)));",
    "  }",
    "  vArmAcc = clamp(vArmAcc, 0.0, 1.0);",
    "  vVArm = uArmMode > 0.5 ? 1.0 - vArmAcc : vArmAcc;",
    "#else",
    "  vVArm = 0.0;",
    "#endif"
  ].join("\n");
  var VEIN_GLSL = [
    "float vDn = vn3(vVW * 11.0 + vec3(0.0, uVTime * 0.6, 0.0)) * 0.6 + vn3(vVW * 23.0) * 0.4;",
    "float vDh = (vVW.y - uDiss.x) * uDiss.z + (vDn - 0.5) * 0.16;",
    "if (uDiss.w > 0.5 && vDh > 0.0) discard;",
    "float vDe = uDiss.w * (1.0 - smoothstep(0.0, uDiss.y, -vDh));",
    "float vLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
    "float vBlue = mix(1.0, smoothstep(0.0, 0.06, diffuseColor.b - diffuseColor.r) * smoothstep(0.03, 0.15, vLum), uArmMode);",
    "vec3 vq = vVO * uNoiseK;",
    "float vR1 = 1.0 - abs(vn3(vq) * 2.0 - 1.0);",
    "float vR2 = 1.0 - abs(vn3(vq * 2.3 + 5.3) * 2.0 - 1.0);",
    "float vVeins = smoothstep(0.9, 0.985, vR1) + smoothstep(0.93, 0.99, vR2) * 0.6;",
    "float vFlow = 0.4 + 0.6 * sin(uVTime * 2.4 - vq.y * 1.4 + vn3(vq * 0.5) * 5.0);",
    "vec3 vVeinGlow = uVeinCol * vVeins * vFlow * vVArm * vBlue * uVein;"
  ].join("\n");
  var OUT_GLSL = [
    "float vetoRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);",
    "outgoingLight += uRimColor * vetoRim * uRimStrength;",
    "outgoingLight += vVeinGlow * 1.6;",
    "outgoingLight = mix(outgoingLight, uDissCol * 2.5, vDe * 0.85);"
  ].join("\n");

  function tuneMaterial(m, ult, mask, noiseK) {
    if (!m) return;
    m.toneMapped = false;
    m.envMapIntensity = 0.85;
    if ("specularIntensity" in m && m.specularIntensity === 0) m.specularIntensity = 0.18;
    var rimColor = new THREE.Color(C_CYAN);
    var veinCol = ult ? new THREE.Color(0.9, 1.7, 0.45) : new THREE.Color(0.3, 1.5, 1.9);
    m.onBeforeCompile = function (shader) {
      shader.uniforms.uRimColor = { value: rimColor };
      shader.uniforms.uRimStrength = { value: ult ? 0.26 : 0.12 };
      shader.uniforms.uRimPower = { value: ult ? 2.4 : 3.2 };
      shader.uniforms.uArm = { value: mask };
      shader.uniforms.uArmMode = { value: ult ? 1 : 0 };
      shader.uniforms.uNoiseK = { value: noiseK };
      shader.uniforms.uVeinCol = { value: veinCol };
      shader.uniforms.uVein = ult ? VU.uVeinUlt : VU.uVein;
      shader.uniforms.uVTime = VU.uVTime;
      shader.uniforms.uDiss = VU.uDiss;
      shader.uniforms.uDissCol = VU.uDissCol;
      shader.vertexShader = "uniform float uArm[32]; uniform float uArmMode; varying vec3 vVW; varying vec3 vVO; varying float vVArm;\n" +
        shader.vertexShader
          .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n" + ARM_GLSL)
          .replace("#include <project_vertex>", "#include <project_vertex>\nvVW = (modelMatrix * vec4(transformed, 1.0)).xyz; vVO = position;");
      shader.fragmentShader = "uniform float uArmMode; uniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower; uniform float uNoiseK; uniform vec3 uVeinCol; uniform float uVein; uniform float uVTime; uniform vec4 uDiss; uniform vec3 uDissCol; varying vec3 vVW; varying vec3 vVO; varying float vVArm;\n" +
        GLSL_NOISE + "\n" +
        shader.fragmentShader
          .replace("#include <map_fragment>", "#include <map_fragment>\n" + VEIN_GLSL)
          .replace("#include <output_fragment>", OUT_GLSL + "\n#include <output_fragment>");
    };
    m.customProgramCacheKey = function () { return "veto-v2-" + (ult ? "u" : "b"); };
    m.needsUpdate = true;
  }
  function collectBones(obj) {
    var bones = {};
    obj.traverse(function (o) { if (o.isBone) { var k = o.name.replace(/_\d+$/, ""); if (!bones[k]) bones[k] = o; } });
    return bones;
  }
  function rotateWorld(bone, qWorld) {
    var pq = new Q4(); bone.parent.getWorldQuaternion(pq);
    bone.quaternion.premultiply(pq.clone().invert().multiply(qWorld).multiply(pq));
    bone.updateMatrixWorld(true);
  }
  function aimToward(bone, child, dirTarget, amount) {
    var p0 = bone.getWorldPosition(new V3()), p1 = child.getWorldPosition(new V3());
    var dir = p1.sub(p0).normalize();
    rotateWorld(bone, new Q4().setFromUnitVectors(dir, dir.clone().lerp(dirTarget, amount).normalize()));
  }
  function relaxPose(pack) {
    var b = pack.bones, r = pack.root;
    r.updateMatrixWorld(true);
    var fwd = new V3(0, 0, 1);
    if (b.Head && b.L_Eyeball && b.L_Eyeball.getWorldPosition(new V3()).z < b.Head.getWorldPosition(new V3()).z) fwd.set(0, 0, -1);
    pack.forward = fwd;
    var ang = THREE.MathUtils.degToRad(CFG.armsDown);
    ["L", "R"].forEach(function (side) {
      var sh = b[side + "_Shoulder"], el = b[side + "_Elbow"], hand = b[side + "_Hand"];
      if (!sh || !el) return;
      r.updateMatrixWorld(true);
      var dir = el.getWorldPosition(new V3()).sub(sh.getWorldPosition(new V3())).normalize();
      rotateWorld(sh, new Q4().setFromAxisAngle(new V3().crossVectors(dir, new V3(0, -1, 0)).normalize(), ang));
      if (hand) { aimToward(sh, el, fwd, 0.1); aimToward(el, hand, fwd, 0.2); }
    });
    r.updateMatrixWorld(true);
  }
  function skinnedBox(obj) {
    obj.updateMatrixWorld(true);
    var box = new THREE.Box3(), v = new V3();
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      var pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 2500));
      for (var i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i); // boneTransform (r147) espera la posición ya cargada
        if (o.isSkinnedMesh && o.boneTransform) o.boneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
      }
    });
    return box;
  }

  /* ---- Rig ---- */
  var JOINTS = ["Pelvis", "Spine1", "Spine2", "Spine3", "Spine4", "Neck", "Head"];
  ["L", "R"].forEach(function (s) {
    ["Clavicle", "Shoulder", "Elbow", "Hand", "Hip", "Knee", "Foot"].forEach(function (n) { JOINTS.push(s + "_" + n); });
    ["Index", "Middle", "Ring", "Pinky"].forEach(function (f) { [1, 2, 3].forEach(function (i) { JOINTS.push(s + "_" + f + i); }); });
    JOINTS.push(s + "_Thumb1", s + "_Thumb2");
  });
  var JI = {};
  JOINTS.forEach(function (n, i) { JI[n] = i; });
  var NJ = JOINTS.length;
  function makeRig(pack) {
    var X = new V3(1, 0, 0), Y = new V3(0, 1, 0), Z = pack.forward.clone();
    var rig = [];
    JOINTS.forEach(function (name, i) {
      var bone = pack.bones[name];
      if (!bone) return;
      var inv = bone.getWorldQuaternion(new Q4()).invert();
      rig.push({ i: i, bone: bone, rest: bone.quaternion.clone(),
        ax: X.clone().applyQuaternion(inv).normalize(), ay: Y.clone().applyQuaternion(inv).normalize(), az: Z.clone().applyQuaternion(inv).normalize() });
    });
    pack.rig = rig;
  }
  var qx = new Q4(), qy = new Q4(), qz = new Q4();
  function applyPose(pack, P) {
    for (var k = 0; k < pack.rig.length; k++) {
      var j = pack.rig[k], o = j.i * 3;
      qy.setFromAxisAngle(j.ay, P[o + 1]); qx.setFromAxisAngle(j.ax, P[o]); qz.setFromAxisAngle(j.az, P[o + 2]);
      j.bone.quaternion.copy(j.rest).multiply(qy).multiply(qx).multiply(qz);
    }
  }

  /* ---- Poses: [pitch(X), yaw(Y), roll(Z)] en ejes de mundo del reposo (brazos ya bajados).
         Pitch + = inclinar hacia delante / mirar abajo · Yaw + = girar hacia su izquierda
         Roll + en el brazo izquierdo = abrirlo hacia fuera (en el derecho, roll −).
         "*X" = L y R espejando yaw/roll. "Finger" = 4 dedos × 3 falanges. ---- */
  var FINGERS = ["Index", "Middle", "Ring", "Pinky"];
  function P(def) {
    var out = new Float32Array(NJ * 3);
    function put(name, v, mirror) {
      var i = JI[name];
      if (i === undefined) return;
      out[i * 3] += v[0]; out[i * 3 + 1] += mirror ? -v[1] : v[1]; out[i * 3 + 2] += mirror ? -v[2] : v[2];
    }
    function apply(side, base, v, mirror) {
      if (base === "Finger") { FINGERS.forEach(function (f) { [1, 2, 3].forEach(function (n) { put(side + "_" + f + n, v, mirror); }); }); return; }
      if (base === "Thumb") { put(side + "_Thumb1", v, mirror); put(side + "_Thumb2", v, mirror); return; }
      put(side + "_" + base, v, mirror);
    }
    Object.keys(def).forEach(function (k) {
      var v = def[k];
      if (k.charAt(0) === "*") { apply("L", k.slice(1), v, false); apply("R", k.slice(1), v, true); }
      else if (/^[LR]_(Finger|Thumb)$/.test(k)) apply(k.charAt(0), k.slice(2), v, false);
      else put(k, v, false);
    });
    return out;
  }
  function addP(a, b) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] + b[i]; return o; }
  function addPose(out, src, k) { for (var i = 0; i < out.length; i++) out[i] += src[i] * k; }
  var ZERO = new Float32Array(NJ * 3);

  var POSES = {};
  function def(name, d) { POSES[name] = P(d); }
  function defFrom(name, base, d) { POSES[name] = addP(POSES[base], P(d)); }

  // Retrato oficial: piernas abiertas, puño mutado en alto, mirada por encima del hombro
  def("HERO_BASE", {
    Pelvis: [0, 0.04, 0.02],
    "*Hip": [-0.02, 0.1, 0.1], "*Knee": [0.05, 0, 0], "*Foot": [-0.03, 0, -0.1], R_Knee: [0.06, 0, 0],
    Spine1: [-0.02, 0.02, 0], Spine2: [-0.05, 0.05, -0.02], Spine3: [-0.04, 0.04, -0.01], Spine4: [-0.01, 0.02, 0],
    Neck: [-0.04, 0.06, 0.02], Head: [0.03, 0.16, -0.05],
    L_Clavicle: [0, 0, 0.08], L_Shoulder: [-0.2, 0, 1.05], L_Elbow: [0, 0, 1.5], L_Hand: [0, 0, -0.08], L_Finger: [0, 0, -1.22], L_Thumb: [0, 0, -0.5],
    R_Clavicle: [0, 0, -0.03], R_Shoulder: [0.04, 0, -0.14], R_Elbow: [-0.24, 0, 0], R_Hand: [-0.06, 0.2, 0], R_Finger: [0, 0, 0.4], R_Thumb: [0, 0, 0.2]
  });
  // Kit: listo para usar habilidades, puño a la altura del pecho
  def("READY_BASE", {
    "*Hip": [-0.08, 0.1, 0.09], "*Knee": [0.16, 0, 0], "*Foot": [-0.08, 0, -0.09],
    Spine2: [0.04, 0.04, 0], Spine3: [0.03, 0.03, 0], Neck: [-0.02, 0.02, 0], Head: [0.03, 0.06, 0],
    L_Shoulder: [-0.32, 0, 0.2], L_Elbow: [-1.2, 0, 0.12], L_Finger: [0, 0, -1.0], L_Thumb: [0, 0, -0.4],
    R_Shoulder: [-0.08, 0, -0.12], R_Elbow: [-0.38, 0, 0], R_Finger: [0, 0, 0.35], R_Thumb: [0, 0, 0.15]
  });
  // Evolución: postura de depredador, garras abiertas
  def("ULT", {
    Pelvis: [0.06, 0, 0],
    "*Hip": [-0.24, 0.14, 0.16], "*Knee": [0.48, 0, 0], "*Foot": [-0.24, 0, -0.15],
    Spine1: [0.06, 0, 0], Spine2: [0.16, 0.03, 0], Spine3: [0.13, 0.02, 0], Spine4: [0.05, 0, 0],
    Neck: [-0.16, 0, 0], Head: [-0.16, -0.08, 0.04],
    "*Clavicle": [0, 0, 0.1], "*Shoulder": [-0.62, 0, 0.2], "*Elbow": [-0.9, 0, -0.06], "*Hand": [-0.15, 0, 0.1],
    "*Finger": [0, 0, -0.62], "*Thumb": [0, 0, -0.3],
    L_Shoulder: [-0.16, 0, 0.06], L_Elbow: [-0.12, 0, 0], R_Elbow: [0.12, 0, 0]
  });

  // X · Evolución: recoge el puño, lo dispara al cielo (la mutación sale de ahí) y cae en postura de garras
  def("EV_COIL", {
    "*Hip": [-0.22, 0.1, 0.12], "*Knee": [0.46, 0, 0], "*Foot": [-0.22, 0, -0.12],
    Spine2: [0.24, -0.1, 0], Spine3: [0.18, -0.06, 0], Neck: [0.1, 0, 0], Head: [0.26, 0.2, 0],
    L_Clavicle: [0, 0, 0.02], L_Shoulder: [-0.42, 0, 0.12], L_Elbow: [-1.4, 0, -0.55], L_Hand: [0.1, 0, 0], L_Finger: [0, 0, -1.4], L_Thumb: [0, 0, -0.6],
    R_Shoulder: [-0.2, 0, -0.32], R_Elbow: [-0.95, 0, 0], R_Finger: [0, 0, 0.75]
  });
  def("EV_THRUST", {
    "*Hip": [-0.04, 0.12, 0.13], "*Knee": [0.08, 0, 0], "*Foot": [-0.04, 0, -0.13],
    Spine1: [-0.04, 0, 0], Spine2: [-0.16, 0.08, -0.04], Spine3: [-0.12, 0.06, -0.03], Neck: [-0.1, 0.1, 0], Head: [-0.32, 0.3, 0.02],
    L_Clavicle: [0, 0, 0.2], L_Shoulder: [-0.3, 0, 2.45], L_Elbow: [0, 0, 0.35], L_Hand: [0, 0, -0.1], L_Finger: [0, 0, -1.35], L_Thumb: [0, 0, -0.55],
    R_Shoulder: [0.25, 0, -0.55], R_Elbow: [-0.3, 0, 0], R_Finger: [0, 0, 0.9]
  });
  defFrom("EV_THRUST_H", "EV_THRUST", { Head: [-0.04, 0.02, 0], L_Shoulder: [0, 0, 0.08], Spine2: [-0.03, 0, 0] });
  def("EV_SLAM", {
    Pelvis: [0.08, 0, 0],
    "*Hip": [-0.42, 0.14, 0.2], "*Knee": [0.86, 0, 0], "*Foot": [-0.42, 0, -0.18],
    Spine1: [0.1, 0, 0], Spine2: [0.24, 0, 0], Spine3: [0.16, 0, 0], Spine4: [0.05, 0, 0], Neck: [-0.14, 0, 0], Head: [-0.26, 0, 0],
    "*Clavicle": [0, 0, 0.16], "*Shoulder": [-0.55, 0, 0.42], "*Elbow": [-0.7, 0, 0], "*Hand": [-0.25, 0, 0.1], "*Finger": [0, 0, -0.45], "*Thumb": [0, 0, -0.2]
  });
  // Volver a la forma base: exhala y se sacude
  def("EXHALE", {
    "*Hip": [-0.1, 0.08, 0.08], "*Knee": [0.2, 0, 0], "*Foot": [-0.1, 0, -0.08],
    Spine2: [0.24, 0, 0], Spine3: [0.15, 0, 0], Neck: [0.05, 0, 0], Head: [0.32, 0, 0],
    "*Shoulder": [0.05, 0, 0.02], "*Elbow": [-0.15, 0, 0], "*Finger": [0, 0, -0.2], L_Elbow: [-0.3, 0, 0.2]
  });
  // X en Evolución: rugido
  defFrom("CROUCH_ROAR", "ULT", { Spine2: [0.14, 0, 0], Spine3: [0.12, 0, 0], Head: [0.3, 0, 0], "*Shoulder": [-0.2, 0.12, -0.3], "*Elbow": [-0.5, 0, 0], "*Finger": [0, 0, -0.35], "*Hip": [-0.1, 0, 0], "*Knee": [0.2, 0, 0], "*Foot": [-0.1, 0, 0] });
  defFrom("ROAR", "ULT", { Spine2: [-0.3, 0, 0], Spine3: [-0.26, 0, 0], Neck: [-0.1, 0, 0], Head: [-0.3, 0, 0], "*Clavicle": [0, 0, 0.08], "*Shoulder": [0.02, 0, 0.45], "*Elbow": [0.15, 0, 0], "*Finger": [0, 0, 0.15], "*Hip": [0.12, 0, 0], "*Knee": [-0.2, 0, 0], "*Foot": [0.08, 0, 0] });

  // C · Corte Transversal: lanza el vórtice (mano derecha), lo mira, chasquea y se teletransporta
  def("CC_WIND", {
    "*Hip": [-0.16, 0.08, 0.1], "*Knee": [0.32, 0, 0], "*Foot": [-0.16, 0, -0.1],
    Spine2: [0.12, -0.18, 0], Spine3: [0.08, -0.12, 0], Head: [0.12, 0.12, 0],
    R_Shoulder: [0.55, 0, -0.22], R_Elbow: [-0.35, 0, 0], R_Finger: [0, 0, 0.45],
    L_Shoulder: [-0.3, 0, 0.25], L_Elbow: [-1.05, 0, 0.12], L_Finger: [0, 0, -1.05]
  });
  def("CC_TOSS", {
    "*Hip": [-0.1, 0.08, 0.1], "*Knee": [0.2, 0, 0], "*Foot": [-0.1, 0, -0.1],
    Spine2: [0.05, 0.14, 0], Spine3: [0.04, 0.1, 0], Head: [0.12, 0.02, 0],
    R_Shoulder: [-1.05, 0, -0.18], R_Elbow: [-0.15, 0, 0], R_Hand: [-0.2, 0, 0], R_Finger: [0, 0, -0.15],
    L_Shoulder: [0.08, 0, 0.22], L_Elbow: [-0.75, 0, 0.1], L_Finger: [0, 0, -0.95]
  });
  def("CC_AIM", {
    "*Hip": [-0.06, 0.08, 0.1], "*Knee": [0.1, 0, 0], "*Foot": [-0.05, 0, -0.1],
    Spine2: [0.03, 0.05, 0], Head: [0.16, 0, 0],
    R_Shoulder: [-1.3, 0, -0.28], R_Elbow: [-0.55, 0, 0], R_Hand: [-0.35, 0, 0], R_Finger: [0, 0, -0.3], R_Thumb: [0, 0, -0.1],
    L_Shoulder: [-0.3, 0, 0.2], L_Elbow: [-1.15, 0, 0.1], L_Finger: [0, 0, -1.1]
  });
  defFrom("CC_SNAP", "CC_AIM", { R_Elbow: [-0.2, 0, 0], R_Hand: [0.2, 0, 0], R_Finger: [0, 0, 1.15], R_Thumb: [0, 0, 0.45], Head: [0.04, 0, 0] });
  def("LAND", {
    "*Hip": [-0.42, 0.08, 0.12], "*Knee": [0.86, 0, 0], "*Foot": [-0.42, 0, -0.12],
    Spine2: [0.26, 0, 0], Spine3: [0.15, 0, 0], Head: [0.02, 0, 0],
    "*Shoulder": [-0.25, 0, 0.3], "*Elbow": [-0.5, 0, 0], L_Finger: [0, 0, -1.0], R_Finger: [0, 0, 0.6]
  });

  // Q · Asfixia: arranca un fragmento de su mutación y lo lanza con el brazo mutado
  def("CH_GRAB", {
    "*Hip": [-0.12, 0.08, 0.1], "*Knee": [0.24, 0, 0], "*Foot": [-0.12, 0, -0.1],
    Spine2: [0.12, 0.06, 0], Head: [0.26, 0.16, 0],
    L_Shoulder: [-0.9, 0, 0.3], L_Elbow: [-1.2, 0, 0.2], L_Hand: [-0.3, 0, 0], L_Finger: [0, 0, -0.3], L_Thumb: [0, 0, -0.1],
    R_Shoulder: [-0.2, 0, -0.2], R_Elbow: [-0.6, 0, 0], R_Finger: [0, 0, 0.5]
  });
  def("CH_WIND", {
    L_Hip: [0.08, 0, 0.08], L_Knee: [0.2, 0, 0], R_Hip: [-0.22, -0.1, -0.1], R_Knee: [0.15, 0, 0], R_Foot: [0.05, 0, 0.1],
    Spine2: [-0.08, 0.3, 0], Spine3: [-0.06, 0.22, 0], Head: [-0.04, -0.22, 0],
    L_Shoulder: [-2.3, 0, 0.32], L_Elbow: [-1.3, 0, 0], L_Finger: [0, 0, -0.8],
    R_Shoulder: [-0.6, 0, -0.15], R_Elbow: [-0.5, 0, 0], R_Finger: [0, 0, 0.4]
  });
  def("CH_REL", {
    L_Hip: [0, 0, 0.1], L_Knee: [0.14, 0, 0], R_Hip: [-0.34, 0, -0.1], R_Knee: [0.44, 0, 0], R_Foot: [-0.1, 0, 0.1],
    Spine2: [0.26, -0.26, 0], Spine3: [0.18, -0.2, 0], Head: [0.14, 0.12, 0],
    L_Shoulder: [-0.75, 0, -0.08], L_Elbow: [-0.12, 0, 0], L_Finger: [0, 0, 0.15], L_Thumb: [0, 0, 0.1],
    R_Shoulder: [0.2, 0, -0.1], R_Elbow: [-0.3, 0, 0], R_Finger: [0, 0, 0.3]
  });
  def("CH_WATCH", {
    "*Hip": [-0.1, 0.1, 0.1], "*Knee": [0.2, 0, 0], "*Foot": [-0.1, 0, -0.1],
    Spine2: [0.08, 0.1, 0], Head: [0.2, 0.25, 0],
    L_Shoulder: [-0.4, 0, 0.3], L_Elbow: [-1.3, 0, 0.2], L_Finger: [0, 0, -0.6],
    R_Shoulder: [-0.1, 0, -0.15], R_Elbow: [-0.4, 0, 0], R_Finger: [0, 0, 0.4]
  });
  defFrom("CH_CLENCH", "CH_WATCH", { L_Finger: [0, 0, -0.8], L_Thumb: [0, 0, -0.45], L_Elbow: [-0.25, 0, 0.05], L_Shoulder: [-0.15, 0, 0.05], Spine2: [0.06, 0, 0], Head: [-0.08, 0, 0] });

  // E · Interceptor: lo lanza por debajo, le muestra la palma para activarlo y vigila
  def("KI_WIND", {
    "*Hip": [-0.22, 0.06, 0.1], "*Knee": [0.45, 0, 0], "*Foot": [-0.22, 0, -0.1],
    Spine2: [0.16, -0.12, 0], Spine3: [0.1, -0.08, 0], Head: [0.2, -0.05, 0],
    R_Shoulder: [0.45, 0, -0.1], R_Elbow: [-0.5, 0, 0], R_Finger: [0, 0, 0.5],
    L_Shoulder: [-0.25, 0, 0.3], L_Elbow: [-1.0, 0, 0.1], L_Finger: [0, 0, -1.0]
  });
  def("KI_TOSS", {
    "*Hip": [-0.1, 0.06, 0.1], "*Knee": [0.2, 0, 0], "*Foot": [-0.1, 0, -0.1],
    Spine2: [0.06, 0.1, 0], Head: [0.04, 0.05, 0],
    R_Shoulder: [-1.2, 0, -0.1], R_Elbow: [-0.25, 0, 0], R_Finger: [0, 0, -0.2],
    L_Shoulder: [-0.2, 0, 0.3], L_Elbow: [-0.9, 0, 0.1], L_Finger: [0, 0, -1.0]
  });
  def("KI_PALM", {
    "*Hip": [-0.06, 0.08, 0.1], "*Knee": [0.12, 0, 0], "*Foot": [-0.06, 0, -0.1],
    Spine2: [0.02, -0.08, 0], Head: [0.06, -0.12, 0],
    R_Shoulder: [-1.35, 0, -0.32], R_Elbow: [-0.2, 0, 0], R_Hand: [-0.6, 0, 0], R_Finger: [0, 0, -0.35], R_Thumb: [0, 0, -0.2],
    L_Shoulder: [-0.3, 0, 0.25], L_Elbow: [-1.15, 0, 0.1], L_Finger: [0, 0, -1.15]
  });
  def("KI_GUARD", {
    "*Hip": [-0.12, 0.1, 0.1], "*Knee": [0.24, 0, 0], "*Foot": [-0.12, 0, -0.1],
    Spine2: [0.08, -0.05, 0], Head: [0.08, -0.2, 0],
    R_Shoulder: [-0.3, 0, -0.2], R_Elbow: [-0.7, 0, 0], R_Finger: [0, 0, 0.5],
    L_Shoulder: [-0.45, 0, 0.3], L_Elbow: [-1.35, 0, 0.15], L_Finger: [0, 0, -1.2]
  });

  // Evolución en el hero (sobre la animación oficial): puño mutado en alto junto a la cabeza
  def("HX_FIST", {
    Spine3: [-0.05, 0.06, 0], Spine4: [-0.02, 0.03, 0], Neck: [-0.06, 0.06, 0], Head: [-0.06, 0.2, -0.05],
    L_Clavicle: [0, 0, 0.1], L_Shoulder: [-0.25, 0, 1.08], L_Elbow: [0, 0, 1.55], L_Hand: [0, 0, -0.1], L_Finger: [0, 0, -1.25], L_Thumb: [0, 0, -0.5]
  });

  // Gestos (se suman a la postura): mirar el puño y apretarlo, crujir el cuello, gruñido
  def("G_LOOK", { Head: [0.16, 0.38, 0.06], Neck: [0.06, 0.14, 0], L_Finger: [0, 0, 0.95], L_Thumb: [0, 0, 0.4], L_Hand: [0, 0, 0.18], L_Elbow: [0, 0, 0.06] });
  def("G_FIST", { Head: [0.12, 0.36, 0.04], Neck: [0.05, 0.14, 0], L_Finger: [0, 0, -0.22], L_Hand: [0, 0, -0.14], L_Elbow: [0, 0, 0.12], Spine3: [0.02, 0.04, 0] });
  def("G_NECK_L", { Head: [0.1, -0.3, -0.16], Neck: [0.05, -0.12, -0.06], "*Clavicle": [0, 0, 0.05] });
  def("G_NECK_R", { Head: [0.06, 0.28, 0.16], Neck: [0.02, 0.12, 0.06], "*Clavicle": [0, 0, -0.02] });
  def("G_GROWL", { Spine2: [0.06, 0, 0], Head: [0.1, 0, 0.06], "*Shoulder": [-0.06, 0, 0.1], "*Elbow": [-0.12, 0, 0], "*Finger": [0, 0, -0.45], "*Clavicle": [0, 0, 0.08] });

  /* ---- Acciones ----
     mode "set": la pose sustituye a la postura (con fundido de entrada/salida)
     mode "add": la pose se suma (gestos pequeños) */
  var ACTIONS = {
    evolve: { dur: 2.3, fin: 0.3, fout: 0.55, stiff: 1.35, shake: [0.5, 1.05], mode: "set",
      keys: [[0, "EV_COIL"], [0.34, "EV_COIL"], [0.5, "EV_THRUST", "out"], [1.02, "EV_THRUST_H", "lin"], [1.3, "EV_SLAM", "out"], [1.75, "EV_SLAM", "lin"]],
      events: [[0.5, function () { commitForm(true); evolveFx(true); }]] },
    devolve: { dur: 1.4, fin: 0.3, fout: 0.55, mode: "set",
      keys: [[0, "EXHALE"], [0.9, "EXHALE"]],
      events: [[0.14, function () { commitForm(false); flash(0.3); }]] },
    roar: { dur: 1.6, fin: 0.28, fout: 0.5, stiff: 1.3, shake: [0.34, 0.8], mode: "set",
      keys: [[0, "CROUCH_ROAR"], [0.3, "CROUCH_ROAR"], [0.46, "ROAR", "back"], [0.95, "ROAR", "lin"]],
      events: [[0.44, function () { evolveFx(false); }]] },
    crosscut: { dur: 2.5, fin: 0.22, fout: 0.55, stiff: 1.4, mode: "set",
      turn: function (t) { return t < 1.42 ? -0.55 : 0; },
      keys: [[0, "CC_WIND"], [0.28, "CC_WIND"], [0.42, "CC_TOSS", "out"], [0.72, "CC_TOSS", "lin"], [0.98, "CC_AIM", "inOut"], [1.08, "CC_SNAP", "out"], [1.42, "CC_SNAP", "lin"], [1.5, "LAND", "lin"], [1.9, "LAND", "lin"]],
      events: [[0.4, function () { ccThrow(); }], [1.08, function () { ccGo(); }]] },
    chokehold: { dur: 2.9, fin: 0.2, fout: 0.6, stiff: 1.45, mode: "set",
      turn: function (t) { return t < 2.4 ? 0.42 : 0; },
      keys: [[0, "CH_GRAB"], [0.25, "CH_GRAB", "out"], [0.45, "CH_WIND", "inOut"], [0.56, "CH_REL", "out"], [0.9, "CH_REL", "lin"], [1.25, "CH_WATCH", "inOut"], [1.7, "CH_WATCH", "lin"], [1.82, "CH_CLENCH", "out"], [2.3, "CH_CLENCH", "lin"]],
      events: [[0.12, function () { chForm(); }], [0.53, function () { chThrow(); }]] },
    interceptor: { dur: 3.4, fin: 0.22, fout: 0.6, stiff: 1.4, mode: "set",
      turn: function (t) { return t < 3 ? -0.32 : 0; },
      keys: [[0, "KI_WIND"], [0.28, "KI_WIND"], [0.42, "KI_TOSS", "out"], [0.75, "KI_TOSS", "lin"], [1.05, "KI_PALM", "inOut"], [1.4, "KI_PALM", "lin"], [1.75, "KI_GUARD", "inOut"], [3.0, "KI_GUARD", "lin"]],
      events: [[0.38, function () { kiToss(); }], [1.15, function () { kiActivate(); }]] },
    flex: { dur: 2.8, fin: 0.5, fout: 0.7, mode: "add",
      keys: [[0, "G_LOOK"], [0.8, "G_LOOK"], [1.2, "G_FIST", "out"], [1.6, "G_LOOK", "inOut"], [1.9, "G_FIST", "out"], [2.2, "G_FIST", "lin"]],
      events: [[1.2, function () { flare = Math.max(flare, 1.4); }], [1.9, function () { flare = Math.max(flare, 1.8); }]] },
    neck: { dur: 1.9, fin: 0.35, fout: 0.5, mode: "add",
      keys: [[0, "G_NECK_L"], [0.5, "G_NECK_L"], [1.05, "G_NECK_R", "inOut"], [1.3, "G_NECK_R", "lin"]] },
    growl: { dur: 2.2, fin: 0.4, fout: 0.7, mode: "add",
      keys: [[0, "G_GROWL"], [1.4, "G_GROWL"]] }
  };
  Object.keys(ACTIONS).forEach(function (k) { api.durations[k] = ACTIONS[k].dur; });

  var act = null, clock = 0, carry = null, carryT = 0;
  var actPose = new Float32Array(NJ * 3);
  var attract = { t: 0, next: 6 };
  function sampleKeys(out, keys, t) {
    var k = 1;
    while (k < keys.length - 1 && keys[k][0] <= t) k++;
    var a = keys[k - 1], b = keys[k] || a;
    var u = b === a ? 1 : clamp((t - a[0]) / Math.max(0.0001, b[0] - a[0]), 0, 1);
    var e = (EASE[b[2]] || EASE.inOut)(u);
    var pa = POSES[a[1]] || ZERO, pb = POSES[b[1]] || ZERO;
    for (var i = 0; i < out.length; i++) out[i] = pa[i] + (pb[i] - pa[i]) * e;
  }
  function startAction(name) {
    var def = ACTIONS[name];
    if (!def) return 0;
    attract.t = 0;
    if (act) { carry = pose.slice(); carryT = 0.28; }
    act = { name: name, def: def, t0: clock, fired: [] };
    emit("action", { name: name, dur: def.dur });
    return def.dur;
  }
  function envelope(def, t) {
    var w = 1;
    if (t < def.fin) w = EASE.inOut(t / def.fin);
    else if (t > def.dur - def.fout) w = EASE.inOut(clamp((def.dur - t) / def.fout, 0, 1));
    return w;
  }

  function requestForm(ult) {
    if (ult === state.target) {
      if (ult && api.ready) { if (csMode) startHX("roar"); else if (models.base) startAction("roar"); }
      return;
    }
    state.target = ult;
    emit("change", ult);
    if (!api.ready) { commitForm(ult); return; }
    if (csMode) {
      if (ult) startHX("evolve");
      else { hxClear(); commitForm(false); flash(0.35); }
      return;
    }
    if (!models.base) { commitForm(ult); return; }
    startAction(ult ? "evolve" : "devolve");
  }
  function commitForm(ult, instant) {
    state.evolved = ult;
    api.evolved = ult;
    if (instant) { sweep = sweepFrom = sweepTo = ult ? 1 : 0; lastEvolved = ult; fb = ult ? 1 : 0; }
    root.classList.toggle("is-evolved", ult);
    var tt = window.t || function (es) { return es; };
    if (reticleLabel) reticleLabel.textContent = ult ? tt("Forma base", "Base form") : (api.ultReady ? tt("Evolución", "Evolution") : tt("Sincronizando", "Syncing"));
  }
  function playKey(key) {
    key = String(key || "").toUpperCase();
    if (!api.ready || !models.base) return 0;
    if (key === "X") { if (state.target) { startAction("roar"); return ACTIONS.roar.dur; } requestForm(true); return ACTIONS.evolve.dur; }
    if (key === "C" && CC.busy) return 0;
    var map = { C: "crosscut", Q: "chokehold", E: "interceptor" };
    return map[key] ? startAction(map[key]) : 0;
  }

  /* ---- Resortes por hueso: inercia y follow-through ---- */
  var pose = new Float32Array(NJ * 3), cur = new Float32Array(NJ * 3), vel = new Float32Array(NJ * 3);
  var SPR_W = new Float32Array(NJ), SPR_Z = new Float32Array(NJ), springReady = false;
  JOINTS.forEach(function (n, i) {
    var f = 4.5, z = 0.65;
    if (/Hip|Knee|Foot|Pelvis/.test(n)) { f = 6.5; z = 1.0; }
    else if (/Spine1|Spine2/.test(n)) { f = 4.2; z = 0.9; }
    else if (/Spine3|Spine4/.test(n)) { f = 3.8; z = 0.85; }
    else if (/Neck/.test(n)) { f = 3.4; z = 0.8; }
    else if (/Head/.test(n)) { f = 3.1; z = 0.72; }
    else if (/Clavicle/.test(n)) { f = 3.6; z = 0.8; }
    else if (/Shoulder/.test(n)) { f = 3.0; z = 0.7; }
    else if (/Elbow/.test(n)) { f = 2.9; z = 0.62; }
    else if (/Hand/.test(n)) { f = 2.7; z = 0.58; }
    SPR_W[i] = 2 * PI * f; SPR_Z[i] = z;
  });
  // [hijo, padre, arrastre]: el hijo se queda atrás cuando el padre se mueve rápido
  var DRAG = [["L_Elbow", "L_Shoulder", 0.035], ["L_Hand", "L_Elbow", 0.045], ["R_Elbow", "R_Shoulder", 0.035], ["R_Hand", "R_Elbow", 0.045],
    ["Head", "Neck", 0.03], ["Neck", "Spine4", 0.025], ["Spine4", "Spine3", 0.02]].map(function (d) { return [JI[d[0]], JI[d[1]], d[2]]; });
  function integrate(dt, mul) {
    var n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
    for (var d = 0; d < DRAG.length; d++) {
      var c = DRAG[d][0] * 3, p = DRAG[d][1] * 3, k = DRAG[d][2];
      pose[c] -= vel[p] * k; pose[c + 1] -= vel[p + 1] * k; pose[c + 2] -= vel[p + 2] * k;
    }
    for (var s = 0; s < n; s++) {
      for (var j = 0; j < NJ; j++) {
        var w = SPR_W[j] * mul, kk = w * w, cc = 2 * SPR_Z[j] * w;
        for (var a = 0; a < 3; a++) {
          var i = j * 3 + a;
          vel[i] += (kk * (pose[i] - cur[i]) - cc * vel[i]) * h;
          cur[i] += vel[i] * h;
        }
      }
    }
    for (var q = 0; q < cur.length; q++) if (!isFinite(cur[q]) || !isFinite(vel[q])) { cur.set(pose); vel.fill(0); break; }
  }

  /* ================================================================ FX (kit) */
  var pool = new Pool(sceneFx, 1600);
  var COL = {
    cyan: [0.35, 1.7, 2.0], hot: [1.4, 2.8, 3.0], white: [2.4, 2.6, 2.6], blue: [0.3, 0.75, 2.6],
    lime: [1.7, 2.6, 0.55], limeHot: [2.6, 3.2, 1.2], teal: [0.1, 0.9, 1.0]
  };
  var fxL = { i: 0, c: new THREE.Color(), p: new V3() };
  function fxLight(color, intensity, pos) { if (intensity > fxL.i) { fxL.i = intensity; fxL.c.set(color); fxL.p.copy(pos); } }
  var _h = new V3();
  function boneWorld(name, out) {
    // en el hero: el modelo oficial, o la forma Evolución (que copia su pose) cuando ya mutó
    var pk = csMode && csPack ? (state.evolved && models.ult && RT.ready ? models.ult : csPack) : models.base;
    var b = pk && pk.bones[name];
    if (b) return b.getWorldPosition(out);
    return out.set(tele.x, 1.2, tele.z);
  }
  var tele = { x: 0, z: 0 };
  // en pantallas verticales los efectos se acercan a Veto para que entren en cuadro
  function spread() { return view.w / view.h < 0.8 ? 0.7 : 1; }
  var punch = 0, flashV = 0, flare = 0;
  // destello: color + centro en pantalla (punto del mundo o el pecho de Veto)
  var _fp = new V3();
  function flash(v, color, at) {
    if (v >= flashV * 0.6) {
      U.uFlashC.value.set(color || C_CYAN).convertSRGBToLinear();
      _fp.copy(at || _fp.set(tele.x, MODEL_H * 0.6, tele.z)).project(camera);
      U.uFlashP.value.set((_fp.x * 0.5 + 0.5) * view.w * dpr, (_fp.y * 0.5 + 0.5) * view.h * dpr);
      U.uFlashR.value = (at ? 0.32 : 0.45) * view.h * dpr;
    }
    flashV = Math.max(flashV, v);
  }

  /* -- C · Corte Transversal: vórtice en el suelo + teletransporte con disolución -- */
  var vortexMat = addBlend(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uA: { value: 0 }, uOpen: { value: 0 } },
    vertexShader: VS_UV,
    fragmentShader: [
      "uniform float uT; uniform float uA; uniform float uOpen; varying vec2 vUv;", GLSL_NOISE,
      "void main(){",
      "  vec2 p = (vUv - 0.5) * 2.0; float r = length(p) / max(uOpen, 0.001);",
      "  if (r > 1.15) discard;",
      "  float a = atan(p.y, p.x); float lr = log(max(r, 0.03));",
      "  float sp = sin(a * 3.0 - lr * 5.0 + uT * 6.0); float sp2 = sin(a * 5.0 - lr * 8.0 + uT * 9.0 + 1.3);",
      "  float n = vn2(vec2(a * 1.9 + uT * 1.2, lr * 3.0 - uT * 3.0));",
      "  float arms = smoothstep(0.1, 1.0, sp * 0.6 + sp2 * 0.3 + n * 0.5);",
      "  float body = smoothstep(1.0, 0.7, r);",
      "  float rd = (r - 0.97) * 22.0; float rim = exp(-rd * rd);",
      "  float eye = exp(-r * r * 26.0);",
      "  vec3 c = mix(vec3(0.01, 0.05, 0.2), vec3(0.16, 0.9, 1.35), arms) * body + vec3(0.35, 1.2, 1.5) * rim + vec3(1.2, 2.2, 2.4) * eye;",
      "  float al = clamp(body * (0.5 + 0.5 * arms) + rim + eye, 0.0, 1.0) * uA;",
      "  gl_FragColor = vec4(c * uA, al);",
      "}"].join("\n")
  }));
  var funnelMat = addBlend(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: VS_FRES,
    fragmentShader: [
      "uniform float uT; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;", GLSL_NOISE,
      "void main(){",
      "  float n = vn2(vec2(vUv.x * 10.0 + vUv.y * 4.0 - uT * 1.4, vUv.y * 3.0 - uT * 2.2));",
      "  float m = vn2(vec2(vUv.x * 22.0 - uT * 2.0, vUv.y * 7.0 - uT * 4.0));",
      "  float streak = smoothstep(0.55, 0.95, n * 0.7 + m * 0.5);",
      "  float fade = smoothstep(0.0, 0.1, vUv.y) * pow(1.0 - vUv.y, 1.6);",
      "  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);",
      "  float a = streak * fade * (0.35 + fr) * uA;",
      "  gl_FragColor = vec4(mix(vec3(0.15, 0.6, 1.6), vec3(1.0, 2.4, 2.6), streak) * a, a * 0.5);",
      "}"].join("\n")
  }));
  var ccDisc = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), vortexMat);
  ccDisc.rotation.x = -PI / 2; ccDisc.position.y = 0.006;
  var ccFunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.44, 0.85, 48, 1, true), funnelMat);
  ccFunnel.position.y = 0.425;
  var ccGroup = new THREE.Group();
  ccGroup.add(ccDisc, ccFunnel);
  ccGroup.visible = false;
  sceneFx.add(ccGroup);
  var ccPuck = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2.2, 2.6) }));
  ccPuck.visible = false; sceneFx.add(ccPuck);
  var ccRing = makeRing(0x6fe0ff, 1.3); sceneFx.add(ccRing);
  var ccPillar = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_BEAM, color: new THREE.Color(0.6, 1.9, 2.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ccPillar.center.set(0.5, 0); ccPillar.visible = false; sceneFx.add(ccPillar);
  var CC = { busy: false, phase: 0, t0: 0, from: new V3(), to: new V3(), ctrl: new V3(), open: 0, outT: -1, inT: -1, closeT: -1, moved: false };
  function ccThrow() {
    boneWorld("R_Hand", CC.from);
    CC.to.set(tele.x - 1.05 * spread(), 0, tele.z - 0.1);
    CC.ctrl.addVectors(CC.from, CC.to).multiplyScalar(0.5); CC.ctrl.y += 0.6;
    CC.t0 = clock; CC.phase = 1; CC.busy = true; CC.open = 0; CC.outT = CC.inT = CC.closeT = -1; CC.moved = false;
    ccPuck.visible = true;
  }
  function ccGo() { if (CC.phase >= 2) CC.outT = clock; }
  function updateCC(dt) {
    if (!CC.busy) return false;
    var t = clock - CC.t0, i;
    if (CC.phase === 1) {
      var u = Math.min(1, t / 0.4);
      bez(ccPuck.position, CC.from, CC.ctrl, CC.to, u);
      ccPuck.position.y += 0.03;
      for (i = 0; i < 3; i++) pool.emit(ccPuck.position.x, ccPuck.position.y, ccPuck.position.z, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0.35, 0.035, COL.cyan, 2, 0, -0.5);
      if (u >= 1) {
        CC.phase = 2; CC.landT = clock; ccPuck.visible = false;
        ccGroup.position.set(CC.to.x, 0, CC.to.z); ccGroup.visible = true;
        ccRing.position.set(CC.to.x, 0.01, CC.to.z); ccRing.userData.t0 = clock; ccRing.visible = true;
        for (i = 0; i < 40; i++) { var a = Math.random() * PI * 2, s = 0.6 + Math.random() * 1.2; pool.emit(CC.to.x, 0.03, CC.to.z, Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s, 0.5 + Math.random() * 0.4, 0.03, Math.random() < 0.3 ? COL.white : COL.cyan, 3, 2.5, 0); }
        flash(0.12);
      }
    }
    if (CC.phase >= 2) {
      var lt = clock - CC.landT;
      var target = CC.closeT >= 0 ? 1 - EASE.inn(seg(clock, CC.closeT, CC.closeT + 0.32)) : 1;
      CC.open = lt < 0.4 ? EASE.back(seg(lt, 0, 0.4)) * target : target;
      vortexMat.uniforms.uT.value = clock; vortexMat.uniforms.uOpen.value = Math.max(0.001, CC.open); vortexMat.uniforms.uA.value = Math.min(1, CC.open * 1.2);
      funnelMat.uniforms.uT.value = clock; funnelMat.uniforms.uA.value = CC.open;
      ccFunnel.scale.set(Math.max(0.001, CC.open), Math.max(0.001, CC.open), Math.max(0.001, CC.open));
      // partículas que giran hacia el ojo del vórtice
      if (CC.open > 0.2 && Math.random() < 0.9) {
        var aa = Math.random() * PI * 2, rr = 0.32 + Math.random() * 0.22;
        var idx = pool.emit(CC.to.x + Math.cos(aa) * rr, 0.02 + Math.random() * 0.1, CC.to.z + Math.sin(aa) * rr, -Math.cos(aa) * 0.5, 0.25 + Math.random() * 0.5, -Math.sin(aa) * 0.5, 0.9, 0.025, Math.random() < 0.25 ? COL.white : COL.cyan, 0.6, 0, 0);
        pool.setSwirl(idx, CC.to.x, CC.to.z, 4.5);
      }
      fxLight(0x58e6ff, 1.6 * CC.open, _h.set(CC.to.x, 0.35, CC.to.z));
    }
    // disolución de salida (de arriba a abajo) → mover → materializarse (de abajo a arriba)
    if (CC.outT >= 0) {
      var ot = clock - CC.outT;
      if (ot < 0.38) {
        var thr = 2.3 - EASE.inn(ot / 0.38) * 2.45;
        VU.uDiss.value.set(thr, 0.075, 1, 1);
        for (i = 0; i < 9; i++) {
          var ox = tele.x + (Math.random() - 0.5) * 0.5, oz = tele.z + (Math.random() - 0.5) * 0.3;
          var dx = CC.to.x - ox, dz = CC.to.z - oz;
          pool.emit(ox, Math.max(0.05, thr + (Math.random() - 0.5) * 0.06), oz, dx * (1.4 + Math.random()) + (Math.random() - 0.5) * 0.3, -thr * 0.6 + (Math.random() - 0.5) * 0.4, dz * (1.4 + Math.random()), 0.55 + Math.random() * 0.35, 0.026, Math.random() < 0.3 ? COL.white : COL.cyan, 1.2, 0, -0.3);
        }
        fxLight(0x58e6ff, 1.2, _h.set(tele.x, thr, tele.z + 0.3));
        platScale = 1 - EASE.inOut(ot / 0.38);
      } else if (!CC.moved) {
        CC.moved = true;
        tele.x = CC.to.x; tele.z = CC.to.z;
        CC.inT = clock;
        VU.uDiss.value.set(-0.2, 0.075, 1, 1);
        ccPillar.position.set(CC.to.x, 0, CC.to.z); ccPillar.visible = true;
        U.uGlitch.value = 0;
        punch = Math.max(punch, reduced ? 0.2 : 0.6);
        flash(0.25);
      }
    }
    if (CC.inT >= 0) {
      var it = clock - CC.inT;
      if (it < 0.44) {
        var thr2 = -0.2 + EASE.out(it / 0.44) * 2.55;
        VU.uDiss.value.set(thr2, 0.09, 1, 1);
        for (i = 0; i < 6; i++) { var a2 = Math.random() * PI * 2; pool.emit(tele.x + Math.cos(a2) * 0.3, thr2, tele.z + Math.sin(a2) * 0.2, -Math.cos(a2) * 0.3, 0.2 + Math.random() * 0.4, -Math.sin(a2) * 0.3, 0.5, 0.026, COL.hot, 1.5, 0, -0.4); }
        platScale = EASE.out(it / 0.44);
      } else if (VU.uDiss.value.w > 0) {
        VU.uDiss.value.set(10, 0.07, 1, 0);
        platScale = 1;
        CC.closeT = clock;
        ccRing.userData.t0 = clock; ccRing.visible = true; ccRing.position.set(tele.x, 0.01, tele.z);
      }
      var pa = 1 - seg(it, 0.05, 0.6);
      ccPillar.scale.set(0.55 + (1 - pa) * 0.6, 3.2 * (0.3 + 0.7 * EASE.out(seg(it, 0, 0.12))), 1);
      ccPillar.material.opacity = pa;
      if (pa <= 0) ccPillar.visible = false;
      fxLight(0x9ff3ff, 2.4 * pa, _h.set(tele.x, 1.0, tele.z + 0.4));
    }
    if (ccRing.visible) {
      var rt = (clock - ccRing.userData.t0) / 0.7;
      if (rt >= 1) ccRing.visible = false;
      else { ccRing.scale.setScalar(0.25 + EASE.out(rt) * 1.3); ccRing.material.uniforms.uA.value = (1 - rt) * 0.7; ccRing.material.uniforms.uW.value = 0.07; }
    }
    // termina cuando también se apagó el anillo (si no, se quedaba congelado a media opacidad)
    if (CC.closeT >= 0 && clock - CC.closeT > 0.34 && !ccPillar.visible && !ccRing.visible) {
      ccGroup.visible = false; CC.busy = false; CC.phase = 0;
    }
    return true;
  }

  /* -- Q · Asfixia: fragmento viscoso → salpicadura → púas que atrapan -- */
  var gooMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uWob: { value: 1 } },
    vertexShader: GLSL_NOISE + "\nuniform float uT; uniform float uWob; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec3 p = position; float n = vn3(p * 30.0 + uT * 3.0); p += normal * (n - 0.5) * 0.04 * uWob; vP = p; vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }",
    fragmentShader: GLSL_NOISE + "\nuniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); float v = 1.0 - abs(vn3(vP * 60.0 + uT) * 2.0 - 1.0); v = pow(v, 6.0); vec3 c = vec3(0.02, 0.14, 0.17) + vec3(0.3, 1.6, 1.9) * fr * 1.6 + vec3(1.4, 2.2, 0.5) * v * 1.6; gl_FragColor = vec4(c, 1.0); }"
  });
  var goo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 3), gooMat);
  goo.visible = false; sceneFx.add(goo);
  var splatMat = addBlend(new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uA: { value: 0 }, uR: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: VS_UV,
    fragmentShader: [
      "uniform float uT; uniform float uA; uniform float uR; uniform float uPulse; varying vec2 vUv;", GLSL_NOISE,
      "void main(){",
      "  vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float a = atan(p.y, p.x);",
      "  float edge = uR * (0.72 + 0.22 * vn2(vec2(a * 1.6 + 3.0, 1.7)) + 0.06 * sin(a * 9.0 + 1.0));",
      "  float body = 1.0 - smoothstep(edge - 0.05, edge, r);",
      "  float ridge = pow(1.0 - abs(vn2(p * 6.0 + vec2(uT * 0.25, 0.0)) * 2.0 - 1.0), 7.0);",
      "  float rim = smoothstep(edge - 0.14, edge - 0.03, r) * body;",
      "  vec3 c = vec3(0.0, 0.04, 0.05) * body + vec3(0.25, 1.3, 1.6) * ridge * body * (0.8 + uPulse * 2.5) + vec3(1.2, 1.9, 0.45) * rim * 1.2;",
      "  float al = (body * 0.4 + ridge * body + rim) * uA;",
      "  gl_FragColor = vec4(c * uA, al);",
      "}"].join("\n")
  }));
  var splat = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), splatMat);
  splat.rotation.x = -PI / 2; splat.position.y = 0.008; splat.visible = false;
  sceneFx.add(splat);
  var trap = new THREE.Group(); trap.visible = false; sceneFx.add(trap);
  var trapSpikes = [];
  (function () {
    var r = rng(7);
    for (var i = 0; i < 9; i++) {
      var ang = i / 9 * PI * 2 + (r() - 0.5) * 0.4;
      var s = makeSpike(i % 3 === 0 ? 0xc9ff6a : 0x6ff3ff, 0x0d4a52, ang, 0.18 + r() * 0.1, 0.4 + r() * 0.28, 0.045 + r() * 0.025, 0.32 + r() * 0.22, r());
      trap.add(s); trapSpikes.push(s);
    }
  })();
  var chRings = [makeRing(0x9fefff, 1.5), makeRing(0x9fefff, 1.5), makeRing(0xd4ff4f, 1.5)];
  chRings.forEach(function (m) { sceneFx.add(m); });
  var CH = { phase: 0, t0: 0, from: new V3(), to: new V3(), ctrl: new V3(), hitT: -1, trigT: -1 };
  function chForm() {
    CH.phase = 1; CH.t0 = clock; CH.rung = false; goo.visible = true; flare = Math.max(flare, 1.6);
    splat.visible = trap.visible = false; chRings.forEach(function (m) { m.visible = false; });
  }
  function chThrow() {
    boneWorld("L_Hand", CH.from);
    CH.to.set(tele.x + 0.95 * spread(), 0, tele.z + 0.35);
    CH.ctrl.addVectors(CH.from, CH.to).multiplyScalar(0.5); CH.ctrl.y += 0.75;
    CH.phase = 2; CH.t0 = clock; goo.visible = true;
  }
  function updateCH(dt) {
    if (!CH.phase) return false;
    var t = clock - CH.t0, i;
    gooMat.uniforms.uT.value = clock;
    if (CH.phase === 1) {
      boneWorld("L_Hand", goo.position);
      goo.position.y += 0.03;
      goo.scale.setScalar(Math.max(0.001, EASE.back(seg(t, 0, 0.3))) * 0.9);
      if (Math.random() < 0.5) pool.emit(goo.position.x, goo.position.y, goo.position.z, (Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3, 0.4, 0.02, COL.lime, 2, 1.5, 0);
      fxLight(0x9ff36a, 0.8, goo.position);
    } else if (CH.phase === 2) {
      var u = Math.min(1, t / 0.42);
      bez(goo.position, CH.from, CH.ctrl, CH.to, u);
      goo.scale.setScalar(0.9 + Math.sin(t * 30) * 0.08);
      goo.rotation.set(t * 9, t * 7, 0);
      for (i = 0; i < 2; i++) pool.emit(goo.position.x, goo.position.y, goo.position.z, (Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3, 0.6, 0.024 + Math.random() * 0.02, Math.random() < 0.5 ? COL.lime : COL.cyan, 1, 3, 0);
      fxLight(0x9ff36a, 0.9, goo.position);
      if (u >= 1) {
        CH.phase = 3; CH.hitT = clock; CH.trigT = clock + 0.85; goo.visible = false;
        splat.position.set(CH.to.x, 0.008, CH.to.z); splat.visible = true;
        trap.position.set(CH.to.x, 0, CH.to.z); trap.visible = true;
        for (i = 0; i < 60; i++) { var a = Math.random() * PI * 2, s = 0.5 + Math.random() * 1.4; pool.emit(CH.to.x, 0.04, CH.to.z, Math.cos(a) * s, 0.5 + Math.random() * 1.2, Math.sin(a) * s, 0.5 + Math.random() * 0.5, 0.025 + Math.random() * 0.02, Math.random() < 0.55 ? COL.lime : COL.teal, 2.2, 4, 0); }
        flash(0.12);
      }
    }
    if (CH.phase === 3) {
      var ht = clock - CH.hitT, tt = clock - CH.trigT;
      var decay = seg(ht, 2.55, 3.1);
      splatMat.uniforms.uT.value = clock;
      splatMat.uniforms.uR.value = EASE.back(seg(ht, 0, 0.3)) * 0.9;
      splatMat.uniforms.uA.value = 1 - decay;
      var trig = tt >= 0 ? 1 : 0;
      var snap = tt >= 0 ? EASE.back(seg(tt, 0, 0.16)) : 0;
      splatMat.uniforms.uPulse.value = trig * (1 - seg(tt, 0, 1.2)) + (0.3 + 0.3 * Math.sin(clock * 6)) * (1 - decay);
      trapSpikes.forEach(function (s, k) {
        var d = s.userData, m = s.material.uniforms;
        var grow = EASE.back(seg(ht, 0.04 + k * 0.035, 0.3 + k * 0.035)) * (1 - EASE.inn(decay));
        m.uT.value = clock + (tt >= 0 && tt < 1 ? Math.sin(clock * 40 + k) * 0.05 : 0);
        m.uGrow.value = Math.max(0.0001, grow * (1 + 0.25 * snap));
        m.uBend.value = d.bend * (1 - snap) - 0.55 * snap;   // al activarse se cierran hacia el centro
        m.uFlash.value = trig * Math.max(0, 1 - tt * 2.5);
      });
      if (tt >= 0 && !CH.rung) {
        CH.rung = true;
        chRings.forEach(function (rg, k) { rg.position.set(CH.to.x, 0.35 + k * 0.42, CH.to.z); rg.userData.t0 = clock + k * 0.08; rg.visible = true; });
        for (i = 0; i < 80; i++) { var b = Math.random() * PI * 2, sp = 0.3 + Math.random() * 1.0; pool.emit(CH.to.x + Math.cos(b) * 0.15, 0.1 + Math.random() * 0.6, CH.to.z + Math.sin(b) * 0.15, Math.cos(b) * sp, 1.2 + Math.random() * 1.6, Math.sin(b) * sp, 0.5 + Math.random() * 0.5, 0.025, Math.random() < 0.5 ? COL.hot : COL.lime, 2.5, 2, 0); }
        punch = Math.max(punch, reduced ? 0.2 : 0.5);
        flash(0.25);
      }
      chRings.forEach(function (rg) {
        if (!rg.visible) return;
        var r2 = (clock - rg.userData.t0) / 0.75;
        if (r2 < 0) { rg.material.uniforms.uA.value = 0; return; }
        if (r2 >= 1) { rg.visible = false; return; }
        rg.scale.setScalar(0.15 + EASE.out(r2) * 1.5); rg.material.uniforms.uA.value = (1 - r2) * 0.9; rg.material.uniforms.uW.value = 0.08;
      });
      fxLight(tt >= 0 ? 0xc6ff7a : 0x58e6ff, (1.1 + trig * 2.2 * Math.max(0, 1 - tt * 1.5)) * (1 - decay), _h.set(CH.to.x, 0.5, CH.to.z));
      if (decay >= 1) { CH.phase = 0; CH.rung = false; splat.visible = false; trap.visible = false; }
    }
    return true;
  }

  /* -- E · Interceptor del kit: orbe + radio + rayo contra utilidad entrante -- */
  var kiOrb = makeOrb();
  kiOrb.visible = false; sceneFx.add(kiOrb);
  // borde del campo en el suelo: fino y tenue (desde la cámara baja del kit se ve como una elipse enorme)
  var kiField = makeRing(C_CYAN, 0.9); sceneFx.add(kiField);
  var kiShock = makeRing(C_CYAN, 2.2); sceneFx.add(kiShock);
  var kiDomeMat = addBlend(new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 }, uHit: { value: 0 }, uT: { value: 0 } },
    vertexShader: VS_FRES,
    fragmentShader: "uniform float uA; uniform float uHit; uniform float uT; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); float lat = 1.0 - smoothstep(0.0, 0.04, abs(fract(vUv.y * 6.0 - uT * 0.3) - 0.5)); float a = (fr * 0.16 + lat * 0.025) * uA + fr * uHit * 0.45; vec3 c = mix(vec3(0.3, 1.5, 1.7), vec3(1.4, 2.2, 0.6), uHit); gl_FragColor = vec4(c * a, a); }"
  }));
  var kiDome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), kiDomeMat);
  kiDome.visible = false; sceneFx.add(kiDome);
  var kiShots = [new Shot(sceneFx, "grenade", 91, C_CYAN), new Shot(sceneFx, "flash", 57, C_CYAN)];
  kiShots.forEach(function (s) { s.scale = 0.75; });
  var KI_R = 0.62;
  var KI = { phase: 0, t0: 0, from: new V3(), pos: new V3(), ctrl: new V3(), act: -1 };
  function kiToss() {
    boneWorld("R_Hand", KI.from);
    KI.pos.set(tele.x - 0.64 * spread(), 1.12, tele.z + 0.5);
    KI.ctrl.addVectors(KI.from, KI.pos).multiplyScalar(0.5); KI.ctrl.y += 0.45;
    KI.phase = 1; KI.t0 = clock; KI.act = -1;
    kiOrb.visible = true; kiField.visible = kiDome.visible = kiShock.visible = false;
    kiShots.forEach(function (s) { s.hide(); s.launch = 1e9; s.hit = 1e9 + 1; });
  }
  function kiActivate() {
    if (!KI.phase) return;
    KI.act = clock;
    var o = KI.pos;
    var S1 = new V3(o.x - 3.4, o.y + 1.2, o.z - 1.6), S2 = new V3(o.x - 2.8, o.y + 1.5, o.z + 1.4);
    var E1 = o.clone().add(S1.clone().sub(o).normalize().multiplyScalar(KI_R * 0.85));
    var E2 = o.clone().add(S2.clone().sub(o).normalize().multiplyScalar(KI_R * 0.85));
    kiShots[0].set(S1, E1, clock + 0.35, clock + 0.82, 0.6, 0.07, 0.22, 0.7);
    kiShots[1].set(S2, E2, clock + 0.95, clock + 1.36, 0.6, 0.07, 0.22, 0.6);
    kiShock.position.set(o.x, 0.01, o.z); kiShock.userData.t0 = clock; kiShock.visible = true;
    kiField.position.set(o.x, 0.012, o.z); kiField.visible = true;
    kiDome.position.copy(o); kiDome.visible = true;
    for (var i = 0; i < 50; i++) { var th = Math.random() * PI * 2, ph = Math.acos(2 * Math.random() - 1), s = 0.8 + Math.random() * 1.6; pool.emit(o.x, o.y, o.z, Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s, Math.sin(ph) * Math.sin(th) * s, 0.4 + Math.random() * 0.4, 0.022, Math.random() < 0.4 ? COL.white : COL.cyan, 3, 0, 0); }
    flash(0.2);
  }
  function updateKI(dt) {
    if (!KI.phase) return false;
    var t = clock - KI.t0, pulse = 0, open = 0;
    var fly = EASE.out(Math.min(1, t / 0.46));
    if (fly < 1) bez(kiOrb.position, KI.from, KI.ctrl, KI.pos, fly);
    else kiOrb.position.copy(KI.pos);
    kiOrb.position.y += Math.sin(clock * 1.8) * 0.02 * fly;
    var end = KI.act >= 0 ? seg(clock, KI.act + 3.0, KI.act + 3.5) : 0;
    if (KI.act >= 0) {
      var at = clock - KI.act;
      open = EASE.back(seg(at, 0, 0.4)) * (1 - end);
      kiField.scale.setScalar(Math.max(0.001, EASE.back(seg(at, 0, 0.45)) * KI_R * (1 - end)));
      kiField.material.uniforms.uA.value = 0.45 * (1 - end); kiField.material.uniforms.uW.value = 0.02;
      kiDome.position.copy(kiOrb.position);
      kiDome.scale.setScalar(Math.max(0.001, EASE.back(seg(at, 0, 0.45)) * KI_R * (1 - end)));
      if (kiShock.visible) {
        var st = (clock - kiShock.userData.t0) / 0.6;
        if (st >= 1) kiShock.visible = false;
        else { kiShock.scale.setScalar(0.2 + EASE.out(st) * 1.3); kiShock.material.uniforms.uA.value = (1 - st) * 0.6; kiShock.material.uniforms.uW.value = 0.07; }
      }
      kiShots.forEach(function (s) { s.src.copy(kiOrb.position); var r = s.update(clock, camera, clock); pulse = Math.max(pulse, r.beam); if (r.beam > 0.5) fxLight(0xaef6ff, 2.6 * r.beam, s.E); });
      kiDomeMat.uniforms.uA.value = 1 - end; kiDomeMat.uniforms.uHit.value = pulse; kiDomeMat.uniforms.uT.value = clock;
    }
    kiOrb.scale.setScalar(0.4 * Math.max(0.001, 1 - end) * (0.5 + 0.5 * fly));
    animateOrb(kiOrb, clock, pulse, 1 + pulse * 3 + (fly < 1 ? 6 : 0), open);
    fxLight(C_CYAN, (0.9 + pulse * 2) * (1 - end) * fly, kiOrb.position);
    if (end >= 1) { KI.phase = 0; kiOrb.visible = kiField.visible = kiDome.visible = kiShock.visible = false; kiShots.forEach(function (s) { s.hide(); }); }
    return true;
  }

  /* -- X · Evolución: púas que brotan del suelo + ondas + chispas lima/cian -- */
  var evGroup = new THREE.Group(); evGroup.visible = false; sceneFx.add(evGroup);
  var evSpikes = [];
  (function () {
    var r = rng(29);
    for (var i = 0; i < 14; i++) {
      var ang = i / 14 * PI * 2 + (r() - 0.5) * 0.3;
      var s = makeSpike(i % 2 ? 0xd4ff4f : 0x5ff0ff, 0x0d4a52, ang, 0.8 + r() * 0.35, 0.45 + r() * 0.55, 0.06 + r() * 0.045, 0.3 + r() * 0.3, r());
      s.userData.delay = r() * 0.12;
      evGroup.add(s); evSpikes.push(s);
    }
  })();
  var evShockA = makeRing(C_LIME, 1.3), evShockB = makeRing(C_CYAN, 1.3);
  sceneFx.add(evShockA, evShockB);
  var EV = { t0: -1, big: true, k: 1 };
  function evolveFx(big) {
    EV.t0 = clock; EV.big = big; EV.k = big ? 1 : 0.62;
    evGroup.position.set(tele.x, 0, tele.z); evGroup.visible = true; evGroup.scale.set(EV.k, 1, EV.k);
    [evShockA, evShockB].forEach(function (s, i) { s.position.set(tele.x, 0.012 + i * 0.002, tele.z); s.userData.t0 = clock + i * 0.1; s.visible = true; });
    var o = boneWorld(big ? "L_Hand" : "Spine4", new V3());
    var n = big ? 240 : 140;
    for (var i = 0; i < n; i++) {
      var th = Math.random() * PI * 2, ph = Math.acos(2 * Math.random() - 1), s = (big ? 1.2 : 0.9) + Math.random() * 1.8;
      pool.emit(o.x + (Math.random() - 0.5) * 0.12, o.y + (Math.random() - 0.5) * 0.12, o.z + (Math.random() - 0.5) * 0.12,
        Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s * 0.9 + 0.4, Math.sin(ph) * Math.sin(th) * s,
        0.7 + Math.random() * 0.9, 0.025 + Math.random() * 0.035, Math.random() < 0.55 ? COL.limeHot : (Math.random() < 0.5 ? COL.cyan : COL.white), 1.6, 1.4, 0);
    }
    punch = reduced ? 0.3 : 1;
    flare = Math.max(flare, 2.6);
    flash(big ? 0.5 : 0.35);
  }
  function updateEV(dt) {
    if (EV.t0 < 0) return false;
    var t = clock - EV.t0;
    evSpikes.forEach(function (s) {
      var d = s.userData, m = s.material.uniforms;
      var up = EASE.back(seg(t, d.delay, d.delay + 0.16)), down = EASE.inn(seg(t, 0.7 + d.delay, 1.05 + d.delay));
      m.uGrow.value = Math.max(0.0001, up * (1 - down));
      m.uT.value = clock; m.uFlash.value = Math.max(0, 1 - t * 3);
    });
    [evShockA, evShockB].forEach(function (s) {
      if (!s.visible) return;
      var r = (clock - s.userData.t0) / 0.9;
      if (r < 0) { s.material.uniforms.uA.value = 0; return; }
      if (r >= 1) { s.visible = false; return; }
      s.scale.setScalar((0.3 + EASE.out(r) * 2.6) * EV.k); s.material.uniforms.uA.value = (1 - r) * 0.85; s.material.uniforms.uW.value = 0.1;
    });
    // brasas de mutación subiendo por el cuerpo
    if (t < 1.3 && Math.random() < 0.85) {
      var a = Math.random() * PI * 2;
      pool.emit(tele.x + Math.cos(a) * 0.3, 0.1 + Math.random() * 1.8, tele.z + Math.sin(a) * 0.22, Math.cos(a) * 0.12, 0.35 + Math.random() * 0.6, Math.sin(a) * 0.12, 0.9 + Math.random() * 0.7, 0.022 + Math.random() * 0.02, Math.random() < 0.6 ? COL.lime : COL.cyan, 0.8, -0.1, 0);
    }
    fxLight(0xc9ff5a, 4.5 * Math.max(0, 1 - t / 0.9), boneWorld(EV.big ? "L_Hand" : "Spine4", _h));
    if (t > 1.6) { EV.t0 = -1; evGroup.visible = false; }
    return true;
  }

  /* ================================================================ VETO OFICIAL (hero)
     Modelo de selección de agente con su animación "idle" del juego (15 s).
     La forma Evolución (modelo TP) copia esa pose hueso a hueso (retarget en
     espacio de mundo desde una pose de referencia común) para que el spotlight
     y la transformación queden alineados. */
  var csPack = null, csMode = false, CS_YAW = 0;
  var RT = { ready: false, dirty: false, order: [], csRef: {}, csPos: {}, tpRef: {}, inv: {}, parent: {}, pname: {}, stamp: {}, frame: 1, split: null, snap: null };
  var RT_NAMES = ["Pelvis", "Spine1", "Spine2", "Spine3", "Spine4", "Neck", "Head"];
  var RT_PAIRS = [["Spine1", "Spine2"], ["Spine2", "Spine3"], ["Spine3", "Spine4"], ["Spine4", "Neck"], ["Neck", "Head"]];
  ["L", "R"].forEach(function (sd) {
    RT_NAMES.push(sd + "_Clavicle", sd + "_Shoulder", sd + "_Elbow", sd + "_Hand");
    RT_PAIRS.push([sd + "_Clavicle", sd + "_Shoulder"], [sd + "_Shoulder", sd + "_Elbow"], [sd + "_Elbow", sd + "_Hand"], [sd + "_Hand", sd + "_Middle1"]);
    FINGERS.forEach(function (f) {
      [1, 2, 3].forEach(function (i) { RT_NAMES.push(sd + "_" + f + i); });
      RT_PAIRS.push([sd + "_" + f + "1", sd + "_" + f + "2"], [sd + "_" + f + "2", sd + "_" + f + "3"]);
    });
    RT_NAMES.push(sd + "_Thumb1", sd + "_Thumb2", sd + "_Thumb3", sd + "_Hip", sd + "_Knee", sd + "_Foot", sd + "_Toe");
    RT_PAIRS.push([sd + "_Thumb1", sd + "_Thumb2"], [sd + "_Thumb2", sd + "_Thumb3"], [sd + "_Hip", sd + "_Knee"], [sd + "_Knee", sd + "_Foot"], [sd + "_Foot", sd + "_Toe"]);
  });

  function mountCS(gltf) {
    var obj = gltf.scene, clip = (gltf.animations || [])[0];
    if (!obj || !clip) return null;
    var bones = {};
    obj.traverse(function (o) {
      if (o.isBone && !bones[o.name]) bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          m.toneMapped = false;
          if (m.color) m.color.multiplyScalar(1.2);
          // el alfa de sus texturas guarda otros datos: el modelo debe salir opaco sobre la página
          m.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <output_fragment>", "diffuseColor.a = 1.0;\n#include <output_fragment>"); };
          m.customProgramCacheKey = function () { return "veto-cs-opaque"; };
          m.needsUpdate = true;
        });
      }
    });
    if (!bones.Head || !bones.L_Hand) return null;
    var fix = new THREE.Group(), pivot = new THREE.Group();
    fix.add(obj); pivot.add(fix); sceneBase.add(pivot);
    pivot.updateMatrixWorld(true);
    // que mire a +Z (de la cabeza hacia los ojos)
    if (bones.L_Eyeball && bones.R_Eyeball) {
      var hp = bones.Head.getWorldPosition(new V3());
      var f = bones.L_Eyeball.getWorldPosition(new V3()).add(bones.R_Eyeball.getWorldPosition(new V3())).multiplyScalar(0.5).sub(hp);
      f.y = 0;
      if (f.lengthSq() > 1e-8) fix.rotation.y = -Math.atan2(f.x, f.z);
    }
    pivot.updateMatrixWorld(true);
    // misma altura que los otros modelos y pies en el suelo
    var box = skinnedBox(obj), sc = MODEL_H / Math.max(0.001, box.max.y - box.min.y), c = box.getCenter(new V3());
    fix.scale.setScalar(sc);
    fix.position.set(-c.x * sc, -box.min.y * sc, -c.z * sc);
    pivot.updateMatrixWorld(true);
    // referencia para el retarget: su pose por defecto (antes de animar)
    RT_NAMES.concat(["Splitter"]).forEach(function (n) { var b = bones[n]; if (b) { RT.csRef[n] = b.getWorldQuaternion(new Q4()); RT.csPos[n] = b.getWorldPosition(new V3()); } });
    var mixer = new THREE.AnimationMixer(obj);
    var action = mixer.clipAction(clip);
    action.play();
    // la animación lo coloca donde estaba en la escena de selección de agente: lo centramos con la posición media de la cadera
    if (bones.Splitter && RT.csPos.Splitter) {
      var acc = new V3(), nS = 16;
      for (var i = 0; i < nS; i++) { mixer.setTime(clip.duration * i / nS); pivot.updateMatrixWorld(true); acc.add(bones.Splitter.getWorldPosition(new V3())); }
      acc.multiplyScalar(1 / nS).sub(RT.csPos.Splitter);
      acc.y = 0;
      fix.position.sub(acc);
    }
    mixer.setTime(0);
    pivot.visible = false;
    csPack = { root: obj, fix: fix, pivot: pivot, bones: bones, mixer: mixer, action: action, clip: clip };
    return csPack;
  }

  // La forma Evolución se lleva a la pose de referencia del modelo oficial (dirección de cada hueso)
  function setupRetarget() {
    var ult = models.ult;
    if (!csPack || !ult || !ult.rig) return;
    var tb = ult.bones, pv = ult.pivot, sp = pv.position.clone(), sr = pv.rotation.y;
    applyPose(ult, ZERO);
    RT.snap = {};
    RT_NAMES.concat(["Splitter"]).forEach(function (n) { var b = tb[n]; if (b) RT.snap[n] = { q: b.quaternion.clone(), p: b.position.clone() }; });
    pv.position.set(0, 0, 0); pv.rotation.set(0, 0, 0); pv.updateMatrixWorld(true);
    RT_PAIRS.forEach(function (pr) {
      var ta = tb[pr[0]], tc = tb[pr[1]], ca = RT.csPos[pr[0]], cc = RT.csPos[pr[1]];
      if (!ta || !tc || !ca || !cc) return;
      var d0 = tc.getWorldPosition(new V3()).sub(ta.getWorldPosition(new V3())).normalize();
      var d1 = cc.clone().sub(ca).normalize();
      rotateWorld(ta, new Q4().setFromUnitVectors(d0, d1));
    });
    ult.root.updateMatrixWorld(true);
    RT.order = RT_NAMES.filter(function (n) { return tb[n] && csPack.bones[n] && RT.csRef[n]; });
    RT.order.forEach(function (n) {
      RT.tpRef[n] = tb[n].getWorldQuaternion(new Q4());
      RT.inv[n] = RT.csRef[n].clone().invert();
      RT.parent[n] = tb[n].parent;
      RT.pname[n] = tb[n].parent.name.replace(/_\d+$/, "");
    });
    if (tb.Splitter && RT.csPos.Splitter) RT.split = { tp: tb.Splitter.getWorldPosition(new V3()), cs: RT.csPos.Splitter.clone() };
    restoreUlt();
    pv.position.copy(sp); pv.rotation.y = sr; pv.updateMatrixWorld(true);
    RT.ready = RT.order.length > 20;
  }
  function restoreUlt() {
    var tb = models.ult && models.ult.bones;
    if (tb && RT.snap) Object.keys(RT.snap).forEach(function (n) { if (tb[n]) { tb[n].quaternion.copy(RT.snap[n].q); tb[n].position.copy(RT.snap[n].p); } });
    RT.dirty = false;
  }
  var _r1 = new Q4(), _r2 = new Q4(), _r3 = new Q4(), _r4 = new Q4(), _rv = new V3(), RTW = {};
  function retarget() {
    var u = models.ult, tb = u.bones;
    csPack.pivot.updateMatrixWorld(true);
    u.pivot.updateMatrixWorld(true);
    var qc = csPack.pivot.getWorldQuaternion(_r1).invert(), qt = u.pivot.getWorldQuaternion(_r2).invert();
    // cadera (movimiento del cuerpo) en el espacio de cada pivot
    if (RT.split && csPack.bones.Splitter && tb.Splitter) {
      var cp = csPack.pivot.worldToLocal(csPack.bones.Splitter.getWorldPosition(_rv));
      cp.sub(RT.split.cs).add(RT.split.tp);
      u.pivot.localToWorld(cp);
      tb.Splitter.parent.worldToLocal(cp);
      tb.Splitter.position.copy(cp);
      tb.Splitter.updateMatrixWorld(true);
    }
    var fr = RT.frame++;
    for (var k = 0; k < RT.order.length; k++) {
      var n = RT.order[k];
      var w = RTW[n] || (RTW[n] = new Q4());
      w.copy(qc).multiply(csPack.bones[n].getWorldQuaternion(_r3)).multiply(RT.inv[n]).multiply(RT.tpRef[n]);
      var pn = RT.pname[n];
      if (RT.stamp[pn] === fr) _r3.copy(RTW[pn]);
      else _r3.copy(qt).multiply(RT.parent[n].getWorldQuaternion(_r4));
      tb[n].quaternion.copy(_r3.invert().multiply(w));
      RT.stamp[n] = fr;
    }
    RT.dirty = true;
  }
  // Gesto procedural encima de la pose copiada (puño de Evolución)
  var OVERLAY_RE = /^(L_(Clavicle|Shoulder|Elbow|Hand|Index|Middle|Ring|Pinky|Thumb)|Neck|Head|Spine3|Spine4)/;
  var _ox = new Q4(), _oy = new Q4(), _oz = new Q4(), _oq = new Q4();
  function poseOverlay(pack, PZ, w) {
    for (var k = 0; k < pack.rig.length; k++) {
      var j = pack.rig[k];
      if (!OVERLAY_RE.test(JOINTS[j.i])) continue;
      var o = j.i * 3;
      _oy.setFromAxisAngle(j.ay, PZ[o + 1]); _ox.setFromAxisAngle(j.ax, PZ[o]); _oz.setFromAxisAngle(j.az, PZ[o + 2]);
      _oq.copy(j.rest).multiply(_oy).multiply(_ox).multiply(_oz);
      j.bone.quaternion.slerp(_oq, w);
    }
  }
  // Mirada sobre la animación oficial (cuello + cabeza, en ejes del pivot)
  var _lq = new Q4(), _lp = new Q4(), _lw = new Q4(), _le = new THREE.Euler(0, 0, 0, "YXZ");
  function lookCS(ly, lp) {
    var pq = csPack.pivot.getWorldQuaternion(_lp);
    // Head y Head_CS (ojos, párpados, mandíbula) son hermanos bajo Neck: giran juntos o la cara se separa
    [["Neck", 1]].forEach(function (e) {
      var b = csPack.bones[e[0]];
      if (!b) return;
      _le.set(lp * e[1], ly * e[1], 0);
      _lq.setFromEuler(_le);
      _lw.copy(pq).multiply(_lq).multiply(_r1.copy(pq).invert());
      rotateWorld(b, _lw);
    });
  }
  function heroCS(dt, ly, lp, yaw) {
    var c = csPack;
    c.mixer.update(dt * (reduced ? 0.7 : 1));
    c.pivot.position.set(tele.x, 0, tele.z);
    c.pivot.rotation.y = yaw;
    c.pivot.updateMatrixWorld(true);
    // la animación oficial ya mueve la cabeza y el cuello: no le sumamos giros (deforman la malla)
    var u = models.ult;
    if (u && RT.ready) {
      u.pivot.position.set(tele.x, 0, tele.z);
      u.pivot.rotation.y = yaw;
      retarget();
      if (HX.w > 0.001) poseOverlay(u, POSES.HX_FIST, HX.w);
    }
  }

  /* -- Transformación en el hero (como la animación de selección de agente):
        un dron enemigo se le acerca, le apunta y explota; de la explosión
        sale Veto en Evolución con el puño en alto y energía cian -- */
  var hxDrone = makeProjectile("drone");
  hxDrone.scale.setScalar(1.0);
  var hxEye = sprite(0xff3b4e, 0.3, 0.9);
  hxEye.position.z = 0.09;
  hxDrone.add(hxEye);
  sceneFx.add(hxDrone);
  var hxBeam = makeBeam(C_RED, 0); sceneFx.add(hxBeam);
  var hxRing = makeRing(0xffb04a, 2.2); sceneFx.add(hxRing);
  var HX = { t0: -1, kind: "", init: false, boom: false, w: 0, look: 0, ly: 0, lp: 0, from: new V3(), hover: new V3(), ctrl: new V3() };
  var _hx1 = new V3(), _hx2 = new V3(), _hx3 = new V3();
  var COL_FIRE = [[3.2, 1.5, 0.35], [3.0, 2.3, 0.9], [2.6, 2.6, 2.4], [2.8, 0.7, 0.2]];
  // corta la cinemática a medias: sin esto el dron y su rayo se quedaban flotando
  function hxClear() {
    HX.t0 = -1; HX.w = 0; HX.look = 0;
    hxDrone.visible = false; hxBeam.visible = false; hxRing.visible = false;
    evShockA.visible = evShockB.visible = false;
  }
  function startHX(kind) {
    hxDrone.visible = false; hxBeam.visible = false;
    HX.t0 = clock; HX.kind = kind; HX.init = false; HX.boom = false; HX.w = 0; HX.look = 0;
    emit("action", { name: kind === "evolve" ? "evolve" : "roar", dur: kind === "evolve" ? 3.3 : 1.9 });
    return kind === "evolve" ? 3.3 : 1.9;
  }
  function endHX() {
    if (HX.kind === "evolve" && !HX.boom) commitForm(true, true);
    HX.t0 = -1; HX.w = 0; HX.look = 0; hxDrone.visible = false; hxBeam.visible = false;
  }
  function armSwirl(t) {
    var e = boneWorld("L_Elbow", _hx2), h = boneWorld("L_Hand", _hx3);
    for (var i = 0; i < 3; i++) {
      var u = Math.random(), a = Math.random() * PI * 2, rr = 0.06 + Math.random() * 0.08;
      var x = e.x + (h.x - e.x) * u + Math.cos(a) * rr, y = e.y + (h.y - e.y) * u + (Math.random() - 0.3) * 0.05, z = e.z + (h.z - e.z) * u + Math.sin(a) * rr;
      var idx = pool.emit(x, y, z, -Math.sin(a) * 0.4, 0.5 + Math.random() * 0.6, Math.cos(a) * 0.4, 0.5 + Math.random() * 0.5, 0.02 + Math.random() * 0.025, Math.random() < 0.7 ? COL.cyan : COL.white, 1.2, -0.2, 0.4);
      pool.setSwirl(idx, x - Math.cos(a) * rr, z - Math.sin(a) * rr, 9);
    }
  }
  // anillo y ondas de la transformación: siguen apagándose aunque la cinemática ya terminó
  function updateHXRings() {
    if (hxRing.visible) {
      var r = (clock - hxRing.userData.t0) / 0.8;
      if (r >= 1) hxRing.visible = false;
      else { hxRing.scale.setScalar(0.3 + EASE.out(r) * 2.4); hxRing.material.uniforms.uA.value = (1 - r) * 0.9; hxRing.material.uniforms.uW.value = 0.12; }
    }
    if (evShockA.visible || evShockB.visible) {
      [evShockA, evShockB].forEach(function (s2) {
        if (!s2.visible) return;
        var r2 = (clock - s2.userData.t0) / 0.9;
        if (r2 < 0) { s2.material.uniforms.uA.value = 0; return; }
        if (r2 >= 1) { s2.visible = false; return; }
        s2.scale.setScalar((0.3 + EASE.out(r2) * 2.6) * EV.k); s2.material.uniforms.uA.value = (1 - r2) * 0.85; s2.material.uniforms.uW.value = 0.1;
      });
    }
    return hxRing.visible || evShockA.visible || evShockB.visible;
  }
  function updateHX(dt) {
    var rings = updateHXRings();
    if (HX.t0 < 0) return rings;
    if (!csMode) { endHX(); return false; }
    var t = clock - HX.t0, i;
    var head = boneWorld("Head", _hx1);
    if (HX.kind === "evolve") {
      if (!HX.init) {
        HX.init = true;
        HX.from.set(tele.x + 2.8, head.y + 0.7, tele.z + 1.6);
        HX.hover.set(tele.x + 0.62, head.y + 0.05, tele.z + 0.62);
        HX.ctrl.set((HX.from.x + HX.hover.x) / 2 + 0.3, HX.hover.y + 0.6, (HX.from.z + HX.hover.z) / 2);
        hxDrone.visible = true; hxEye.material.opacity = 0.7;
      }
      if (t < 1.32) {
        var u = EASE.out(seg(t, 0, 0.85));
        bez(hxDrone.position, HX.from, HX.ctrl, HX.hover, u);
        hxDrone.position.y += Math.sin(clock * 5) * 0.022 * u;
        hxDrone.rotation.set(Math.sin(clock * 3) * 0.12, -0.9 + (1 - u) * 1.4, Math.sin(clock * 4) * 0.08);
        var charge = seg(t, 0.9, 1.2);
        hxEye.material.opacity = 0.55 + 0.45 * charge;
        hxEye.scale.setScalar(0.3 + charge * 0.5 + Math.sin(clock * 30) * 0.05 * charge);
        // Veto lo mira
        HX.look = EASE.inOut(seg(t, 0.2, 0.6));
        var dir = _hx2.subVectors(hxDrone.position, head).applyAxisAngle(_up, -csPack.pivot.rotation.y);
        HX.ly = clamp(Math.atan2(dir.x, dir.z), -0.9, 0.9);
        HX.lp = clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.45, 0.45);
        fxLight(C_RED, 0.5 + charge * 2.2, hxDrone.position);
        hxBeam.visible = t > 1.17;
        if (hxBeam.visible) {
          orientBeam(hxBeam, hxDrone.position, _hx3.set(head.x - 0.02, head.y - 0.42, head.z + 0.12), camera, 0.22);
          hxBeam.material.uniforms.uI.value = 1.5 * (1 - seg(t, 1.17, 1.32));
          hxBeam.material.uniforms.uT.value = clock;
        }
      } else if (!HX.boom) {
        HX.boom = true;
        hxDrone.visible = false; hxBeam.visible = false;
        var p = hxDrone.position;
        for (i = 0; i < 240; i++) {
          var th = Math.random() * PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 0.8 + Math.random() * 2.6;
          pool.emit(p.x, p.y, p.z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.8 + 0.3, Math.sin(ph) * Math.sin(th) * sp, 0.45 + Math.random() * 0.8, 0.03 + Math.random() * 0.05, COL_FIRE[(Math.random() * 4) | 0], 2.4, 0.8, 0.6);
        }
        hxRing.position.set(tele.x, 0.012, tele.z); hxRing.userData.t0 = clock; hxRing.visible = true;
        flash(1, 0xffb347, p);
        punch = reduced ? 0.3 : 1;
        flare = Math.max(flare, 2.8);
        commitForm(true, true);
        [evShockA, evShockB].forEach(function (s2, k2) { s2.position.set(tele.x, 0.012 + k2 * 0.002, tele.z); s2.userData.t0 = clock + 0.12 + k2 * 0.1; s2.visible = true; });
        EV.k = 1;
      }
      if (t >= 1.32) {
        fxLight(t < 1.6 ? 0xffb347 : 0x9ff3ff, 5 * Math.max(0, 1 - (t - 1.32) / 0.6) + 1.2 * HX.w, head);
        HX.look = Math.max(0, HX.look - dt * 3);
      }
      HX.w = t < 1.32 ? 0 : t < 1.62 ? EASE.out(seg(t, 1.32, 1.62)) : 1 - EASE.inOut(seg(t, 2.55, 3.2));
      if (t > 1.35 && t < 2.7 && !reduced) armSwirl(t);
      if (t > 3.3) { endHX(); }
    } else {
      // rugido en Evolución: vuelve a alzar el puño con energía
      if (!HX.boom && t > 0.18) {
        HX.boom = true;
        [evShockA, evShockB].forEach(function (s2, k2) { s2.position.set(tele.x, 0.012 + k2 * 0.002, tele.z); s2.userData.t0 = clock + k2 * 0.1; s2.visible = true; });
        EV.k = 0.75; flash(0.3, C_LIME); punch = reduced ? 0.2 : 0.6; flare = Math.max(flare, 2);
      }
      HX.w = t < 0.3 ? EASE.out(seg(t, 0, 0.3)) : 1 - EASE.inOut(seg(t, 1.2, 1.8));
      if (t > 0.15 && t < 1.3 && !reduced) armSwirl(t);
      fxLight(0x9ff3ff, 1.6 * HX.w, head);
      if (t > 1.9) endHX();
    }
    return true;
  }

  // Al pasar del kit al inicio (o al revés) se apaga todo efecto a medias: comparten escena
  // y si no, la habilidad del kit aparecía encima del Veto del inicio.
  function stopAllFx() {
    CC.busy = false; CC.phase = 0; CC.inT = CC.outT = CC.closeT = -1;
    ccGroup.visible = ccPuck.visible = ccRing.visible = ccPillar.visible = false;
    VU.uDiss.value.set(10, 0.07, 1, 0); U.uGlitch.value = 0; platScale = 1;
    CH.phase = 0; CH.rung = false; goo.visible = splat.visible = trap.visible = false;
    chRings.forEach(function (m) { m.visible = false; });
    KI.phase = 0; kiOrb.visible = kiField.visible = kiDome.visible = kiShock.visible = false;
    kiShots.forEach(function (s) { s.hide(); s.launch = 1e9; s.hit = 1e9 + 1; });
    EV.t0 = -1; evGroup.visible = false; evShockA.visible = evShockB.visible = false;
    if (HX.t0 >= 0) endHX();
    hxRing.visible = false;
    pool.clear();
    // el Corte Transversal lo movió: vuelve al centro de su escenario
    tele.x = tele.z = 0; camFollow.ready = false;
  }

  var platScale = 1;
  function updateFx(dt) {
    var any = false;
    any = updateCC(dt) || any;
    any = updateCH(dt) || any;
    any = updateKI(dt) || any;
    any = updateEV(dt) || any;
    any = updateHX(dt) || any;
    any = pool.update(dt) || any;
    punch = Math.max(0, punch - dt * 2.2);
    flashV = Math.max(0, flashV - dt * 2.4);
    U.uFlash.value = flashV;
    return any;
  }

  /* ================================================================ ESCENA INTERCEPTOR */
  var sceneIx = new THREE.Scene();
  sceneIx.environment = envTex;
  var ORB_POS = new V3(0, 1.45, 0), R_FIELD = 2.3, R_HIT = 1.75;
  sceneIx.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec3 vP; void main(){ float y = vP.y; vec3 c = vec3(0.0015, 0.006, 0.008) * smoothstep(-0.05, 0.6, y); gl_FragColor = vec4(c, 1.0); }"
  })));
  var ixFloorMat = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    uniforms: { uAct: { value: 0 }, uT: { value: 0 }, uR: { value: R_FIELD }, uHit: { value: 0 } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: [
      "uniform float uAct; uniform float uT; uniform float uR; uniform float uHit; varying vec3 vW;",
      "float grid(vec2 p, float s, float w){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w); return 1.0 - min(min(g.x, g.y), 1.0); }",
      "void main(){",
      "  float d = length(vW.xz); float fade = exp(-d * 0.2) * (1.0 - smoothstep(9.0, 18.0, d));",
      "  vec3 cy = vec3(0.12, 0.72, 0.78);",
      "  vec3 c = cy * (grid(vW.xz, 0.5, 1.0) * 0.16 + grid(vW.xz, 2.5, 1.4) * 0.34) * fade * 0.5;",
      "  float ring = 1.0 - smoothstep(0.0, 0.035, abs(d - uR));",
      "  float ang = atan(vW.z, vW.x);",
      "  float ticks = step(0.55, fract(ang * 36.0 / 6.28318 - uT * 0.08)) * (1.0 - smoothstep(0.0, 0.05, abs(d - uR * 1.07)));",
      "  float inner = (1.0 - smoothstep(0.0, uR, d)) * 0.05;",
      "  c += (vec3(0.6, 1.0, 0.95) * ring * 1.6 + vec3(0.8, 1.0, 0.9) * ticks * 0.5 + cy * inner) * uAct;",
      "  c += vec3(0.9, 1.0, 0.35) * uHit * (1.0 - smoothstep(0.0, uR, d)) * 0.08;",
      "  gl_FragColor = vec4(c, 1.0);",
      "}"].join("\n")
  });
  var ixFloor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), ixFloorMat);
  ixFloor.rotation.x = -PI / 2;
  sceneIx.add(ixFloor);
  var domeMat = addBlend(new THREE.ShaderMaterial({
    uniforms: { uAct: { value: 0 }, uHit: { value: 0 } },
    vertexShader: VS_FRES,
    fragmentShader: "uniform float uAct; uniform float uHit; varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); float lat = 1.0 - smoothstep(0.0, 0.03, abs(fract(vUv.y * 7.0) - 0.5)); float a = (fr * 0.045 + lat * 0.009) * uAct + fr * uHit * 0.12; vec3 c = mix(vec3(0.24, 0.9, 0.95), vec3(0.83, 1.0, 0.31), uHit * 0.6); gl_FragColor = vec4(c * a, a); }"
  }));
  var ixDome = new THREE.Mesh(new THREE.SphereGeometry(R_FIELD, 48, 24, 0, PI * 2, 0, PI / 2), domeMat);
  sceneIx.add(ixDome);
  sceneIx.add(new THREE.HemisphereLight(0xd8f6ff, 0x061012, 0.6));
  var ixKey = new THREE.DirectionalLight(0xffffff, 1.4); ixKey.position.set(-3, 5, 4); sceneIx.add(ixKey);
  var ixRim = new THREE.DirectionalLight(C_LIME, 0.8); ixRim.position.set(4, 2, -4); sceneIx.add(ixRim);
  var ixOrb = makeOrb();
  ixOrb.scale.setScalar(1.35);
  sceneIx.add(ixOrb);
  var ixHalo = sprite(0x0f5d66, 9, 0.5);
  ixHalo.material.depthTest = false;
  ixHalo.renderOrder = -1;
  sceneIx.add(ixHalo);
  var orbTrail = makeParticles(TRAIL);
  sceneIx.add(orbTrail.points);
  var ORB_START = new V3(-4.2, 0.3, 3.2), ORB_CTRL = new V3(-2.2, 3.2, 2.0);

  // S = de dónde la lanzan · D = dirección (desde el orbe) del punto donde la intercepta
  var IX_SHOTS = [
    { name: "Granada", kind: "grenade", S: [-7, 3.4, 2.6], D: [-1, 0.1, 0.45], launch: 0.05 },
    { name: "Flash", kind: "flash", S: [6.8, 4.4, -1.4], D: [1, 0.35, 0.15], launch: 0.17 },
    { name: "Dardo de reconocimiento", kind: "dart", S: [-3.6, 6.8, -7], D: [-0.35, 0.55, -0.75], launch: 0.29 },
    { name: "Cuchillo", kind: "knife", S: [7.2, 2.1, 3.6], D: [1, -0.25, 0.6], launch: 0.41 },
    { name: "Molly", kind: "molotov", S: [-6.8, 4.2, -1.2], D: [-1, 0.05, -0.2], launch: 0.53 },
    { name: "Dron", kind: "drone", S: [5.6, 1.1, 5.2], D: [0.75, -0.15, 0.9], launch: 0.65 }
  ];
  // una utilidad a la vez: vuela, el rayo la atrapa, se cristaliza y estalla antes de que llegue la siguiente
  var IX_FLIGHT = 0.07, IX_LIFE = 0.075;
  var ixShots = IX_SHOTS.map(function (d, i) {
    var s = new Shot(sceneIx, d.kind, 17 + i * 101, C_CYAN);
    var S = new V3(d.S[0], d.S[1], d.S[2]);
    var E = ORB_POS.clone().add(new V3(d.D[0], d.D[1], d.D[2]).normalize().multiplyScalar(R_HIT));
    s.set(S, E, d.launch, d.launch + IX_FLIGHT, IX_LIFE, 0.014, 0.02, 1.2 + Math.abs(d.S[0]) * 0.08);
    s.scale = 2;
    return s;
  });
  api.ixTimeline = IX_SHOTS.map(function (d) { return { name: d.name, hit: d.launch + IX_FLIGHT }; });

  var ix = { p: 0, e: 0, init: false, punch: 0, orbScreen: { x: 0, y: 0 } };
  var _ov = new V3();
  function project(v, cam) {
    _ov.copy(v).project(cam);
    return { x: (_ov.x * 0.5 + 0.5) * view.w, y: (1 - (_ov.y * 0.5 + 0.5)) * view.h, front: _ov.z < 1 };
  }
  function frameIx(rect, p) {
    var mobile = view.w < 768;
    var fx = mobile ? 0.5 : 0.62, fy = mobile ? 0.46 : 0.5;
    var cx = rect.left + (rect.right - rect.left) * fx;
    var cy = rect.raw.top + rect.raw.height * fy;
    var th = -0.45 + 0.9 * p + (ptr.x > -9000 ? (ptr.x / view.w - 0.5) * 0.08 : 0);
    // en vertical el ancho visible manda: cámara más lejos y más abierta para que entren los impactos
    var narrow = view.w / view.h < 0.8;
    var dist = (narrow ? 12 : mobile ? 9 : 6.4) - 0.6 * p;
    // que quepan los impactos del lado derecho (radio del campo + cristales) aunque la pantalla no sea muy ancha
    if (!mobile) dist = Math.max(dist, 2.6 / ((1 - fx) * 2 * Math.tan(THREE.MathUtils.degToRad(16)) * (view.w / view.h)));
    dist *= dbg.ixZoom || 1;
    var hgt = (narrow ? 2.8 : 2.3) - 0.35 * p;
    ixCam.position.set(Math.sin(th) * dist, hgt, Math.cos(th) * dist);
    ixCam.lookAt(0, 1.3, 0);
    ixCam.aspect = view.w / view.h;
    ixCam.fov = (narrow ? 40 : 32) * (1 - 0.05 * ix.punch);
    ixCam.setViewOffset(view.w, view.h, -(cx - view.w / 2), -(cy - view.h / 2), view.w, view.h);
    ixCam.updateProjectionMatrix();
    ixCam.updateMatrixWorld();
  }
  function particleScale(cam) { return view.h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)); }

  function updateIx(dt) {
    var sec = A.ix.section.getBoundingClientRect();
    var raw = clamp(-sec.top / Math.max(1, sec.height - view.h), 0, 1);
    var e = clamp((view.h - sec.top) / view.h, 0, 1);
    if (dbg.ixP != null) { raw = dbg.ixP; e = dbg.ixE != null ? dbg.ixE : 1; }
    if (!ix.init) { ix.p = raw; ix.init = true; }
    ix.p = damp(ix.p, raw, reduced ? 20 : 8, dt);
    ix.e = e;
    var p = ix.p, t = clock;
    frameIx(vis.ixRect, p);
    ixOrb.scale.setScalar(view.w / view.h < 0.8 ? 1.8 : 1.35);
    // el orbe llega lanzado mientras entra la sección
    var f = EASE.out(clamp((e - 0.25) / 0.7, 0, 1));
    bez(ixOrb.position, ORB_START, ORB_CTRL, ORB_POS, f);
    ixOrb.position.y += Math.sin(t * 1.6) * 0.04 * f;
    orbTrail.points.visible = f > 0.01 && f < 0.99;
    if (orbTrail.points.visible) {
      for (var k = 0; k < TRAIL; k++) {
        bez(_sv, ORB_START, ORB_CTRL, ORB_POS, Math.max(0, f - k * 0.02));
        orbTrail.pos[k * 3] = _sv.x; orbTrail.pos[k * 3 + 1] = _sv.y; orbTrail.pos[k * 3 + 2] = _sv.z;
        var ff = 1 - k / TRAIL;
        orbTrail.size[k] = 0.2 * ff;
        orbTrail.col[k * 4] = 0.4; orbTrail.col[k * 4 + 1] = 1.6; orbTrail.col[k * 4 + 2] = 2.0; orbTrail.col[k * 4 + 3] = ff * ff * (1 - f);
      }
      flushParticles(orbTrail);
    }
    var open = EASE.out(clamp(p / 0.06, 0, 1)) * f;
    var actv = EASE.out(clamp((p - 0.01) / 0.07, 0, 1)) * f;
    var pulse = 0, count = 0, tags = [];
    ixShots.forEach(function (s, i) {
      s.src.copy(ixOrb.position);
      var r = s.update(p, ixCam, t);
      pulse = Math.max(pulse, r.beam);
      if (p >= s.hit) count++;
      // etiqueta con el nombre: sigue a la utilidad en vuelo y se marca al destruirla
      if (r.flying || r.held) {
        var fp = project(s.mesh.position, ixCam);
        tags.push({ i: i, x: fp.x, y: fp.y, a: r.flying ? clamp((p - s.launch) / 0.012, 0, 1) : 1, hit: !r.flying });
      } else if (r.tau >= 0 && r.tau < 1.4) {
        var sp = project(s.E, ixCam);
        tags.push({ i: i, x: sp.x, y: sp.y, a: 1 - clamp((r.tau - HOLD) / (1.4 - HOLD), 0, 1), hit: true });
      }
    });
    ix.punch = Math.max(ix.punch - dt * 3, pulse * (reduced ? 0.3 : 1));
    animateOrb(ixOrb, t, pulse, 1 + pulse * 3, open);
    ixHalo.position.copy(ixOrb.position).addScaledVector(_st.subVectors(ixOrb.position, ixCam.position).normalize(), 4);
    ixHalo.material.opacity = (0.3 + 0.2 * actv + pulse * 0.3) * f;
    ixFloorMat.uniforms.uAct.value = actv; ixFloorMat.uniforms.uT.value = t; ixFloorMat.uniforms.uHit.value = pulse;
    domeMat.uniforms.uAct.value = actv * 0.9; domeMat.uniforms.uHit.value = pulse;
    ixDome.scale.setScalar(0.001 + actv);
    var ps = particleScale(ixCam);
    ixShots.forEach(function (s) { s.trail.mat.uniforms.uScale.value = ps; s.boom.mat.uniforms.uScale.value = ps; });
    orbTrail.mat.uniforms.uScale.value = ps;
    var os = project(ixOrb.position, ixCam);
    ix.orbScreen.x = os.x; ix.orbScreen.y = os.y;
    emit("ix", { p: p, count: count, total: ixShots.length, tags: tags, entry: e });
  }

  // Sin mapeo de tono en las escenas: todo queda en HDR lineal hasta el pase final
  function linearScene(s) {
    s.traverse(function (o) { var m = o.material; if (!m) return; (Array.isArray(m) ? m : [m]).forEach(function (mm) { mm.toneMapped = false; }); });
  }
  [sceneBase, sceneUlt, sceneFx, sceneIx].forEach(linearScene);
  [M_RED, M_DARK, M_HOT].forEach(function (m) { m.toneMapped = false; });

  /* ================================================================ CARGA */
  function mount(gltf, kind) {
    var obj = gltf.scene, ult = kind === "ult";
    var pack = { root: obj, bones: collectBones(obj) };
    relaxPose(pack);
    if (!fit) {
      var box = skinnedBox(obj), size = box.getSize(new V3()), c = box.getCenter(new V3());
      var s = MODEL_H / (size.y || 1);
      fit = { scale: s, offset: new V3(-c.x * s, -box.min.y * s, -c.z * s), width: size.x * s };
    }
    // escala del ruido de las venas: unidades de la pose de enlace → ~15 celdas por metro
    var geoBox = new THREE.Box3();
    obj.traverse(function (o) { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); geoBox.union(o.geometry.boundingBox); } });
    var noiseK = 15 * MODEL_H / Math.max(0.001, geoBox.max.y - geoBox.min.y);
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      var mask = boneMask(o, ult);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { tuneMaterial(m, ult, mask, noiseK); });
    });
    var wrap = new THREE.Group();
    wrap.add(obj);
    wrap.scale.setScalar(fit.scale);
    wrap.position.copy(fit.offset);
    var pivot = new THREE.Group();
    pivot.add(wrap);
    pack.pivot = pivot;
    (ult ? sceneUlt : sceneBase).add(pivot);
    pivot.updateMatrixWorld(true);
    makeRig(pack);
    if (kind === "base" && pack.bones.L_Hip && pack.bones.L_Knee && pack.bones.L_Foot) {
      var h = pack.bones.L_Hip.getWorldPosition(new V3()), k = pack.bones.L_Knee.getWorldPosition(new V3()), ft = pack.bones.L_Foot.getWorldPosition(new V3());
      legs.T = h.distanceTo(k); legs.S = k.distanceTo(ft);
    }
    models[kind] = pack;
    return pack;
  }

  var loader = new THREE.GLTFLoader();
  setTimeout(function () { utilQueue.forEach(function (q) { upgradeProjectile(q[0], q[1]); }); utilQueue = []; }, 0);
  // el modelo oficial viene comprimido con meshopt (lib/meshopt_decoder.js)
  if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
  function load(url, onProgress) {
    return new Promise(function (resolve, reject) {
      loader.load(url, resolve, function (e) { if (e && e.total) onProgress(e.loaded / e.total); }, reject);
    });
  }
  function setProgress(p) {
    var pc = Math.round(Math.min(1, p) * 100);
    if (pctEl) pctEl.textContent = (pc < 10 ? "0" : "") + pc + "%";
  }

  var introT = 0, ultFade = 0;
  function markReady() {
    if (api.ready) return;
    setProgress(1);
    resize();
    api.ready = true;
    host.classList.add("is-ready");
    if (state.target) commitForm(true);
    kick();
  }
  var csLoad = CFG.cs ? load(CFG.cs, setProgress).then(function (gltf) {
    if (mountCS(gltf)) { renderer.compile(sceneBase, camera); markReady(); }
  }).catch(function (err) {
    if (window.console) console.info("[VetoStage] Sin modelo oficial, uso el modelo base:", err && err.message ? err.message : err);
  }) : Promise.resolve();
  csLoad.then(function () {
    return load(CFG.base, csPack ? function () {} : setProgress);
  }).then(function (gltf) {
    mount(gltf, "base");
    if (csPack) models.base.pivot.visible = false;
    renderer.compile(sceneBase, camera);
    markReady();
    return load(CFG.ult, function () {});
  }).then(function (gltf) {
    mount(gltf, "ult");
    renderer.compile(sceneUlt, camera);
    setupRetarget();
    api.ultReady = true;
    commitForm(state.evolved);
    setTimeout(function () { warm(sceneFx, camera); warm(sceneIx, ixCam); }, 400);
  }).catch(function (err) {
    if (!api.ready) {
      api.modelFailed = true;
      host.classList.add("is-failed");
      root.classList.add("no-model");
      if (window.console) console.info("[VetoStage] Modelos no disponibles:", err && err.message ? err.message : err);
    } else if (window.console) console.warn("[VetoStage] No cargó un modelo:", err);
  });

  /* ================================================================ LAYOUT */
  var view = { w: 1, h: 1, cx: 0.5, cy: 0.55, spot: CFG.spotlight, active: null };
  var vis = { veto: null, vetoRect: null, ixRect: null };
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    dpr = Math.min(perfCap, Math.max(1, Math.sqrt((coarse ? 1.6e6 : 4.2e6) / (w * h))));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    rtBase.setSize(bw, bh); rtUlt.setSize(bw, bh); rtComp.setSize(bw, bh);
    for (var i = 0; i < rtDown.length; i++) {
      var dw = Math.max(1, bw >> (i + 1)), dh = Math.max(1, bh >> (i + 1));
      rtDown[i].setSize(dw, dh);
      if (rtUp[i]) rtUp[i].setSize(dw, dh);
    }
    U.uRes.value.set(bw, bh);
    view.w = w; view.h = h;
    view.spot = CFG.spotlight * (w < 480 ? 0.6 : w < 768 ? 0.75 : 1);
    if (reticle) reticle.style.setProperty("--r", view.spot + "px");
  }
  window.addEventListener("resize", function () { resize(); kick(); }, { passive: true });

  function visRect(el) {
    var r = el.getBoundingClientRect();
    var t = Math.max(0, r.top), b = Math.min(view.h, r.bottom), l = Math.max(0, r.left), rr = Math.min(view.w, r.right);
    return (b - t > 1 && rr - l > 1) ? { top: t, bottom: b, left: l, right: rr, raw: r } : null;
  }
  function scan() {
    var h = A.hero && visRect(A.hero.section), k = A.kit && visRect(A.kit.section);
    var hv = h ? h.bottom - h.top : 0, kv = k ? k.bottom - k.top : 0;
    if (h && hv >= kv) { vis.veto = A.hero; vis.vetoRect = h; }
    else if (k) { vis.veto = A.kit; vis.vetoRect = k; }
    else { vis.veto = null; vis.vetoRect = null; }
    vis.ixRect = A.ix ? visRect(A.ix.el) : null;
    view.active = vis.veto;
    return !!(vis.veto || vis.ixRect);
  }
  function toBuf(r) {
    var x = Math.floor(r.left * dpr), y = Math.floor((view.h - r.bottom) * dpr);
    return [x, y, Math.ceil((r.right - r.left) * dpr), Math.ceil((r.bottom - r.top) * dpr)];
  }
  function rectUniform(u, r) {
    if (!r) { u.set(0, 0, 0, 0); return; }
    var b = toBuf(r);
    u.set(b[0], b[1], b[0] + b[2], b[1] + b[3]);
  }

  // Encuadre: hero en contrapicado (como el retrato), kit desde arriba para ver el suelo
  var SHOTS = {
    hero: { fov: 26, camY: 1.15, lookY: 1.08, yaw: -0.22 },
    kit: { fov: 30, camY: 1.6, lookY: 0.85, yaw: -0.12 }
  };
  var camFollow = { x: 0, z: 0, ready: false };
  var _pp = new V3();
  function projPx(x, y, z) { _pp.set(x, y, z).project(camera); return [(_pp.x * 0.5 + 0.5) * view.w, (1 - (_pp.y * 0.5 + 0.5)) * view.h]; }
  function frame(a, dt) {
    var ar = a.el.getBoundingClientRect();
    var kit = a.key === "kit", S = kit ? SHOTS.kit : SHOTS.hero;
    if (!ar.width || !ar.height || !(fit || (!kit && csPack))) return false;
    var ratio = fit ? fit.width / MODEL_H : 0.47;
    var targetPx = kit ? Math.min(ar.height * 1.06, view.h * 0.66) : ar.height * 0.97;
    targetPx = Math.min(targetPx, ar.width * (kit ? 1.1 : 0.96) / ratio);
    if (kit) targetPx = Math.min(targetPx, ar.width * (spread() < 1 ? 0.92 : 1.4));   // espacio para los efectos a los lados
    // escritorio (Veto en su columna): más chico y un poco a la derecha, para que el vórtice y el orbe quepan a su lado
    var col = kit && ar.width < view.w * 0.7;
    if (col) targetPx = Math.min(targetPx, view.h * 0.54);
    if (!camFollow.ready) { camFollow.x = tele.x; camFollow.z = tele.z; camFollow.ready = true; }
    camFollow.x = damp(camFollow.x, tele.x, kit ? 2.6 : 12, dt);
    camFollow.z = damp(camFollow.z, tele.z, kit ? 2.6 : 12, dt);
    var fx = camFollow.x, fz = camFollow.z;
    camera.fov = S.fov * (1 - 0.045 * EASE.out(Math.min(1, punch)));
    camera.aspect = view.w / view.h;
    var dist = (MODEL_H * view.h / targetPx / 2) / Math.tan(THREE.MathUtils.degToRad(S.fov) / 2);
    var t = clock, dx = 0, dy = 0, sh = 0;
    if (!reduced) {
      dx = Math.sin(t * 0.21) * 0.03 + Math.sin(t * 0.13 + 1) * 0.02;
      dy = Math.sin(t * 0.17 + 2) * 0.02;
      if (punch > 0) sh = (Math.random() - 0.5) * 0.035 * punch;
    }
    for (var it = 0; it < 3; it++) {
      camera.position.set(fx + dx + sh, S.camY + dy + sh * 0.5, fz + dist);
      camera.lookAt(fx + dx * 0.3, S.lookY, fz);
      camera.clearViewOffset();
      camera.updateMatrixWorld();
      var top = projPx(fx, MODEL_H, fz)[1], bot = projPx(fx, 0, fz)[1];
      var s = targetPx / Math.max(1, bot - top);
      if (!isFinite(s) || Math.abs(s - 1) < 0.01) break;
      dist /= s;
    }
    var ref = kit ? projPx(fx, 0, fz) : projPx(fx, MODEL_H * 0.5, fz);
    var ax = ar.left + ar.width * (col ? 0.58 : 0.5), ay = col ? ar.top + (ar.height + targetPx) / 2 + 20 : kit ? ar.bottom - 10 : ar.top + ar.height / 2;
    if (isFinite(ref[0]) && isFinite(ref[1])) camera.setViewOffset(view.w, view.h, ref[0] - ax, ref[1] - ay, view.w, view.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return true;
  }

  /* ================================================================ PUNTERO */
  var ptr = { x: -9999, y: -9999, active: false, touchTimer: 0, moved: -10, down: false, dragging: false, sx: 0, lx: 0 };
  var smooth = { x: -9999, y: -9999, r: 0 };
  var spin = { target: 0, yaw: 0, release: 0 };
  var suppressClick = false;

  function nearModel(cx, cy) {
    if (!vis.veto) return false;
    var ar = vis.veto.el.getBoundingClientRect();
    var mx = ar.width * 0.12, my = vis.veto.key === "kit" ? ar.height * 0.2 : 0;
    return cx > ar.left - mx && cx < ar.right + mx && cy > ar.top - my && cy < ar.bottom + my;
  }
  function inHero(cy) {
    if (!A.hero) return false;
    var r = A.hero.section.getBoundingClientRect();
    return cy >= r.top && cy <= r.bottom;
  }
  function setPointer(cx, cy) {
    ptr.x = cx; ptr.y = cy; ptr.moved = clock;
    ptr.active = nearModel(cx, cy);
    if (smooth.x < -9000) { smooth.x = cx; smooth.y = cy; }
  }
  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if (!vis.veto || vis.veto.key !== "hero" || !nearModel(e.clientX, e.clientY)) return;
    if (e.target.closest && e.target.closest("a, button, input, label, select, textarea, .nav")) return;
    ptr.down = true; ptr.dragging = false; ptr.sx = ptr.lx = e.clientX;
  }, { passive: true });
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    if (ptr.down) {
      if (!ptr.dragging && Math.abs(e.clientX - ptr.sx) > 6) { ptr.dragging = true; root.classList.add("is-spinning"); }
      if (ptr.dragging) spin.target += (e.clientX - ptr.lx) / view.w * PI * 1.6;
      ptr.lx = e.clientX;
    }
    attract.t = Math.min(attract.t, attract.next - 3);
    setPointer(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener("pointerup", function () {
    if (ptr.dragging) { suppressClick = true; setTimeout(function () { suppressClick = false; }, 50); spin.release = clock; }
    ptr.down = false; ptr.dragging = false; root.classList.remove("is-spinning");
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", function () { ptr.active = false; });
  window.addEventListener("scroll", function () { if (ptr.x > -9000) ptr.active = nearModel(ptr.x, ptr.y); kick(); }, { passive: true });

  var touch = { x: 0, y: 0 };
  window.addEventListener("touchstart", function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    touch.x = t.clientX; touch.y = t.clientY;
    clearTimeout(ptr.touchTimer);
    setPointer(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    if (vis.veto && vis.veto.key === "hero" && Math.abs(t.clientX - touch.x) > Math.abs(t.clientY - touch.y)) {
      spin.target += (t.clientX - touch.x) / view.w * PI * 1.4;
      spin.release = clock;
    }
    touch.x = t.clientX; touch.y = t.clientY;
    setPointer(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchend", function () { ptr.touchTimer = setTimeout(function () { ptr.active = false; }, 900); }, { passive: true });

  document.addEventListener("click", function (e) {
    if (suppressClick || !api.ready || !vis.veto) return;
    if (e.target.closest("a, button, input, label, summary, select, textarea, dialog, .nav, [data-kit]")) return;
    if (nearModel(e.clientX, e.clientY)) api.toggle();
  });

  /* ================================================================ LOOP */
  var running = false, raf = 0, last = 0, fb = 0;
  var perf = { frames: 0, acc: 0, level: 0 };
  var sweep = 0, sweepFrom = 0, sweepTo = 0, sweepStart = 0, lastEvolved = false;
  var projV = new V3(), handV = new V3(), headV = new V3();
  var gaze = { yaw: 0, pitch: 0, next: 1.2 };
  var breath = 0, turn = { v: 0 }, clench = { t: -1, next: 4 };
  function screenOf(v) {
    projV.copy(v).project(camera);
    return [(projV.x * 0.5 + 0.5) * view.w, (1 - (projV.y * 0.5 + 0.5)) * view.h];
  }
  function J(name, x, y, z) { var i = JI[name] * 3; pose[i] += x; pose[i + 1] += y; pose[i + 2] += z; }

  function updateVeto(dt) {
    var a = vis.veto, t = clock, hero = a.key === "hero";
    introT = Math.min(1, introT + dt / (reduced ? 0.6 : 1.8));
    U.uIntro.value = EASE.inOut(introT);
    if (api.ultReady) ultFade = Math.min(1, ultFade + dt / 0.6);
    U.uUlt.value = ultFade;
    if (!frame(a, dt)) return false;

    // barrido de mutación desde el puño mutado (izquierdo)
    if (state.evolved !== lastEvolved) { lastEvolved = state.evolved; sweepFrom = sweep; sweepTo = state.evolved ? 1 : 0; sweepStart = t; }
    var k = Math.min(1, (t - sweepStart) / 1.3);
    sweep = sweepFrom + (sweepTo - sweepFrom) * EASE.inOut(k);
    var hs = screenOf(boneWorld("L_Hand", handV));
    var cs = screenOf(projV.set(tele.x, MODEL_H * 0.62, tele.z));
    var hd = screenOf(boneWorld("Head", headV));
    var cover = view.h * 0.75, diag = Math.hypot(view.w, view.h) * 1.1;
    var sr = sweep < 0.85 ? (sweep / 0.85) * cover : cover + (sweep - 0.85) / 0.15 * (diag - cover);
    U.uSweepR.value = api.ultReady && isFinite(sr) ? sr * dpr : 0;
    if (isFinite(hs[0]) && isFinite(hs[1])) U.uSweepC.value.set(hs[0] * dpr, (view.h - hs[1]) * dpr);
    if (isFinite(cs[0]) && isFinite(cs[1])) {
      var gx = (cs[0] / view.w * 100).toFixed(2) + "%", gy = (cs[1] / view.h * 100).toFixed(2) + "%";
      host.style.setProperty("--gx", gx); host.style.setProperty("--gy", gy);
      if (backdrop) { backdrop.style.setProperty("--gx", gx); backdrop.style.setProperty("--gy", (cs[1] / view.h * 100 + 8).toFixed(2) + "%"); }
    }

    // entrada con tinta en el kit (desde el pecho de Veto)
    if (a.key === "kit") {
      var kr = A.kit.section.getBoundingClientRect();
      var ek = clamp((view.h - kr.top) / (view.h * 0.85), 0, 1);
      rectUniform(U.uInkB.value, vis.vetoRect);
      U.uInkBC.value.set(cs[0] * dpr, (view.h - cs[1]) * dpr);
      U.uInkBR.value = ek >= 1 ? 1e5 : inkRadius(ek, cs[0], cs[1], vis.vetoRect);
    } else { U.uInkB.value.set(0, 0, 0, 0); U.uInkBR.value = 1e5; }

    // spotlight
    smooth.x = damp(smooth.x, ptr.x, 12, dt);
    smooth.y = damp(smooth.y, ptr.y, 12, dt);
    if (!isFinite(smooth.x) || !isFinite(smooth.y)) { smooth.x = ptr.x; smooth.y = ptr.y; }
    root.classList.toggle("is-grab", hero && ptr.active && !ptr.dragging && api.ready);
    var targetR = ptr.active && api.ultReady && !ptr.dragging ? view.spot : 0;
    smooth.r = damp(smooth.r, targetR, ptr.active ? 7 : 5, dt);
    if (!isFinite(smooth.r) || (smooth.r < 0.5 && !ptr.active)) smooth.r = 0;
    U.uHover.value.set(smooth.x * dpr, (view.h - smooth.y) * dpr);
    U.uHoverR.value = smooth.r * dpr;
    if (reticle) {
      var on = ptr.active && smooth.r > 4;
      reticle.classList.toggle("is-on", on);
      if (on) reticle.style.transform = "translate3d(" + smooth.x.toFixed(1) + "px," + smooth.y.toFixed(1) + "px,0) scale(" + Math.max(0.2, smooth.r / view.spot).toFixed(3) + ")";
    }

    // mirada: al cursor si se mueve cerca; si no, vistazos propios
    var S = hero ? SHOTS.hero : SHOTS.kit;
    var live = ptr.x > -9000 && clock - ptr.moved < 3.5 && isFinite(hd[0]);
    var ly = 0, lp = 0;
    if (live) {
      ly = clamp((ptr.x - hd[0]) / (view.w * 0.45), -1, 1) * 0.55;
      lp = clamp((ptr.y - hd[1]) / (view.h * 0.5), -1, 1) * 0.32;
      gaze.next = 1.5;
    } else {
      gaze.next -= dt;
      if (gaze.next <= 0) {
        var r = Math.random();
        if (r < 0.45) { gaze.yaw = 0; gaze.pitch = 0.02; }
        else { gaze.yaw = (Math.random() * 2 - 1) * 0.45; gaze.pitch = (Math.random() * 2 - 1) * 0.12; }
        gaze.next = reduced ? 6 : 1.6 + Math.random() * 3.2;
      }
      ly = gaze.yaw; lp = gaze.pitch;
    }
    // compensar el giro del cuerpo para que "mirar al frente" sea mirar a cámara
    var useCS = hero && !!csPack;
    var bodyYaw = (useCS ? CS_YAW : S.yaw) + turn.v + spin.yaw;
    ly = clamp(ly - bodyYaw * 0.8, -0.85, 0.85);

    fb = damp(fb, state.evolved ? 1 : 0, 3, dt);
    var amp = reduced ? 0.4 : 1, cl = 0, yaw;
    // arrastre del usuario (vuelve solo) y giro leve hacia el cursor
    if (!ptr.down && clock - spin.release > 1.4) spin.target = damp(spin.target, 0, 2.2, dt);
    spin.yaw = damp(spin.yaw, spin.target, 9, dt);
    var toward = live && hero ? clamp((ptr.x - cs[0]) / (view.w * 0.5), -1, 1) * 0.22 : 0;
    var wasCS = csMode;
    csMode = useCS;
    if (csPack) csPack.pivot.visible = csMode;
    if (models.base) models.base.pivot.visible = !csMode;
    if (csMode) {
      // una acción procedural que quedó a medias (kit) termina sus eventos
      if (act) { if (act.def.events) act.def.events.forEach(function (ev, j) { if (!act.fired[j]) { act.fired[j] = 1; ev[1](); } }); act = null; }
      if (!wasCS) stopAllFx();
      turn.v = damp(turn.v, toward, 2.5, dt);
      yaw = CS_YAW + turn.v + spin.yaw;
      heroCS(dt, ly, lp, yaw);
    } else {
      if (wasCS && csPack) stopAllFx();
      if (RT.dirty) restoreUlt();
      // postura (forma base: retrato en el hero, lista en el kit)
      pose.set(hero ? POSES.HERO_BASE : POSES.READY_BASE);
      for (var i = 0; i < pose.length; i++) pose[i] = pose[i] * (1 - fb) + POSES.ULT[i] * fb;

      // respiración (más profunda y rápida en Evolución) + cambio de peso + micro-ruido
      breath += dt * 2 * PI / (fb > 0.5 ? 2.5 : 3.8);
      var b = Math.sin(breath) * amp, deep = 1 + fb * 0.9;
      J("Spine2", -0.016 * b * deep, 0, 0); J("Spine3", -0.013 * b * deep, 0, 0); J("Spine4", -0.006 * b * deep, 0, 0);
      J("L_Clavicle", 0, 0, 0.02 * b * deep); J("R_Clavicle", 0, 0, -0.02 * b * deep);
      J("Neck", 0.008 * b, 0, 0); J("Head", 0.012 * b, 0, 0);
      J("L_Shoulder", 0, 0, 0.01 * b); J("R_Shoulder", 0, 0, -0.01 * b);
      var w = Math.sin(t * 2 * PI / 9) * amp, w2 = Math.sin(t * 2 * PI / 13 + 1.3) * amp;
      J("Pelvis", 0, 0.018 * w2, 0.028 * w); J("L_Hip", 0, 0, -0.028 * w); J("R_Hip", 0, 0, -0.028 * w);
      J("Spine2", 0, -0.012 * w2, -0.016 * w); J("Spine3", 0, 0, -0.012 * w);
      J(w > 0 ? "L_Knee" : "R_Knee", 0.05 * Math.abs(w), 0, 0);
      J("Head", noise1(t * 0.37, 1) * 0.025 * amp, noise1(t * 0.29, 2) * 0.035 * amp, noise1(t * 0.23, 3) * 0.015 * amp);
      J("Neck", noise1(t * 0.31, 4) * 0.012 * amp, noise1(t * 0.27, 5) * 0.015 * amp, 0);
      J("R_Hand", noise1(t * 0.5, 6) * 0.04 * amp, 0, noise1(t * 0.43, 7) * 0.04 * amp);
      J("R_Elbow", noise1(t * 0.33, 8) * 0.03 * amp, 0, 0);
      FINGERS.forEach(function (f, n) { J("R_" + f + "2", 0, 0, (0.5 + 0.5 * Math.sin(t * 0.9 + n * 0.7)) * 0.08 * amp); });
      // el puño mutado late: se aprieta de vez en cuando y las venas brillan
      if (!reduced && fb < 0.5) { clench.next -= dt; if (clench.next <= 0 && !act) { clench.t = t; clench.next = 5 + Math.random() * 4; } }
      cl = clench.t >= 0 ? Math.sin(PI * seg(t, clench.t, clench.t + 1.3)) : 0;
      if (cl > 0) { FINGERS.forEach(function (f) { J("L_" + f + "1", 0, 0, -0.16 * cl); J("L_" + f + "2", 0, 0, -0.12 * cl); }); J("L_Hand", -0.08 * cl, 0, -0.05 * cl); J("L_Elbow", 0, 0, 0.04 * cl); }
      if (fb > 0.5 && !reduced) FINGERS.forEach(function (f, n) { J("L_" + f + "2", 0, 0, -(0.5 + 0.5 * Math.sin(t * 2.2 + n)) * 0.1); J("R_" + f + "2", 0, 0, (0.5 + 0.5 * Math.sin(t * 2.0 + n * 1.3)) * 0.1); });

      // gestos espontáneos en el hero
      if (hero && !act && !reduced && api.ready) {
        attract.t += dt;
        if (attract.t > attract.next) { attract.next = 8 + Math.random() * 5; startAction(fb > 0.5 ? (Math.random() > 0.5 ? "growl" : "neck") : (Math.random() > 0.4 ? "flex" : "neck")); }
      }

      // acción en curso
      var w8 = 0, stiff = 1, turnT = 0;
      if (act) {
        var at = clock - act.t0, def = act.def;
        if (def.events) def.events.forEach(function (ev, j) { if (!act.fired[j] && at >= ev[0]) { act.fired[j] = 1; ev[1](); } });
        if (act && at >= def.dur) act = null;
        if (act) {
          sampleKeys(actPose, def.keys, at);
          w8 = envelope(def, at);
          if (def.mode === "add") addPose(pose, actPose, w8);
          else for (var q = 0; q < pose.length; q++) pose[q] = pose[q] + (actPose[q] - pose[q]) * w8 * 0.94;
          stiff = 1 + ((def.stiff || 1) - 1) * w8;
          if (def.turn) turnT = def.turn(at) * w8;
          if (def.shake && at > def.shake[0] && at < def.shake[1] && !reduced) {
            J("Head", (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04, 0);
            J("Spine3", 0, 0, (Math.random() - 0.5) * 0.02);
            J("L_Shoulder", (Math.random() - 0.5) * 0.03, 0, 0); J("R_Shoulder", (Math.random() - 0.5) * 0.03, 0, 0);
          }
        }
      }
      if (carry && carryT > 0) {
        var cf = EASE.out(1 - carryT / 0.28);
        for (var c2 = 0; c2 < pose.length; c2++) pose[c2] = carry[c2] + (pose[c2] - carry[c2]) * cf;
        carryT -= dt;
      }
      // mirada (repartida entre pecho, cuello y cabeza; menos durante acciones grandes)
      var lw = act && act.def.mode === "set" ? 0.35 : 1;
      J("Spine3", 0, ly * 0.12 * lw, 0); J("Spine4", 0, ly * 0.1 * lw, 0);
      J("Neck", lp * 0.35 * lw, ly * 0.3 * lw, 0); J("Head", lp * 0.5 * lw, ly * 0.42 * lw, 0);
      if (dbg.poseOff) pose.fill(0);
      if (dbg.only) { pose.fill(0); dbg.only(pose, JI); }
      for (var z = 0; z < pose.length; z++) if (!isFinite(pose[z])) pose[z] = 0;

      // resortes
      if (!springReady) { cur.set(pose); vel.fill(0); springReady = true; }
      integrate(dt, stiff);

      // giro del cuerpo: un poco hacia el cursor + giro de la acción
      turn.v = damp(turn.v, toward + turnT, act ? 5 : 2.5, dt);

      function legDrop(side) {
        var hp = cur[JI[side + "_Hip"] * 3], kn = cur[JI[side + "_Knee"] * 3], rl = cur[JI[side + "_Hip"] * 3 + 2];
        var aa = -hp;
        return (legs.T + legs.S) - (legs.T * Math.cos(aa) + legs.S * Math.cos(aa - kn)) * Math.cos(rl);
      }
      var drop = Math.max(0, Math.min(legDrop("L"), legDrop("R")));
      yaw = S.yaw + turn.v + spin.yaw;
      ["base", "ult"].forEach(function (key) {
        var pack = models[key];
        if (!pack) return;
        applyPose(pack, cur);
        pack.pivot.rotation.y = yaw;
        pack.pivot.position.set(tele.x, -drop + Math.sin(breath) * 0.003 * amp, tele.z);
      });
    }
    platBase.position.set(tele.x, 0, tele.z); platUlt.position.set(tele.x, 0, tele.z);
    platBase.scale.setScalar(Math.max(0.001, platScale)); platUlt.scale.setScalar(Math.max(0.001, platScale));
    platBase.userData.spin.rotation.z = t * 0.25;
    platUlt.userData.spin.rotation.z = -t * 0.35;

    // venas: pulso de fondo + apretón + destellos (habilidades / Evolución)
    flare = Math.max(0, flare - dt * 1.6);
    VU.uVein.value = (0.6 + 0.3 * Math.sin(t * 2.2) * Math.sin(t * 0.7 + 1)) * (reduced ? 0.8 : 1) + cl * 1.2 + flare;
    VU.uVeinUlt.value = 0.42 + 0.18 * Math.sin(t * 1.7) + flare * 0.5;
    if (dbg.vein != null) { VU.uVein.value *= dbg.vein; VU.uVeinUlt.value *= dbg.vein; }
    var hand = boneWorld("L_Hand", _h);
    var fistB = sceneBase.userData.fist, fistU = sceneUlt.userData.fist;
    fistB.position.set(hand.x, hand.y + 0.05, hand.z + 0.12); fistU.position.copy(fistB.position);
    fistB.intensity = (0.35 + VU.uVein.value * 0.45) * platScale; fistU.intensity = (0.3 + VU.uVeinUlt.value * 0.5) * platScale;
    // motas que suben del puño
    if (!reduced && fb < 0.5 && platScale > 0.9 && Math.random() < dt * (6 + cl * 20 + flare * 10)) {
      pool.emit(hand.x + (Math.random() - 0.5) * 0.08, hand.y + 0.04, hand.z + (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06, 0.12 + Math.random() * 0.2, (Math.random() - 0.5) * 0.06, 1.2 + Math.random(), 0.012 + Math.random() * 0.01, COL.cyan, 0.4, -0.02, -0.4);
    }

    var ps = particleScale(camera);
    pool.P.mat.uniforms.uScale.value = ps;
    kiShots.forEach(function (s2) { s2.trail.mat.uniforms.uScale.value = ps; s2.boom.mat.uniforms.uScale.value = ps; });
    fxL.i = 0;
    var anyFx = updateFx(dt);
    [sceneBase.userData.fx, sceneUlt.userData.fx].forEach(function (L) { L.color.copy(fxL.c); L.intensity = fxL.i; L.position.copy(fxL.p); });
    return anyFx || true;
  }

  // Radio de la mancha de tinta: crece con la entrada hasta cubrir la esquina más lejana de la región
  function inkRadius(e, cx, cy, r) {
    if (!r) return 1e5;
    var far = Math.max(Math.hypot(r.left - cx, r.top - cy), Math.hypot(r.right - cx, r.top - cy), Math.hypot(r.left - cx, r.bottom - cy), Math.hypot(r.right - cx, r.bottom - cy));
    return Math.pow(e, 1.6) * far * 1.45 * dpr;
  }

  function renderRegion(rt, sc, scene, cam) {
    rt.scissor.set(sc[0], sc[1], sc[2], sc[3]);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  }
  function renderBloom() {
    var src = rtComp;
    for (var i = 0; i < rtDown.length; i++) {
      downMat.uniforms.tSrc.value = src.texture;
      downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      downMat.uniforms.uPre.value = i === 0 ? 1 : 0;
      pass(downMat, rtDown[i]);
      src = rtDown[i];
    }
    var low = rtDown[rtDown.length - 1];
    for (var j = rtUp.length - 1; j >= 0; j--) {
      upMat.uniforms.tLow.value = low.texture;
      upMat.uniforms.tHigh.value = rtDown[j].texture;
      upMat.uniforms.uTexel.value.set(0.5 / low.width, 0.5 / low.height);
      pass(upMat, rtUp[j]);
      low = rtUp[j];
    }
    finalMat.uniforms.tBloom.value = rtUp[0].texture;
  }
  function render(fxOn) {
    renderer.autoClear = false;
    rtBase.scissorTest = false;
    renderer.setRenderTarget(rtBase);
    renderer.clear(true, true, true);
    var vetoOn = vis.veto && api.ready;
    if (vetoOn) {
      var sc = toBuf(vis.vetoRect);
      renderRegion(rtBase, sc, sceneBase, camera);
      if (fxOn) renderRegion(rtBase, sc, sceneFx, camera);
    }
    if (vis.ixRect) renderRegion(rtBase, toBuf(vis.ixRect), sceneIx, ixCam);
    var needUlt = vetoOn && api.ultReady && (U.uHoverR.value > 0.5 || U.uSweepR.value > 0.5);
    if (needUlt) {
      rtUlt.scissorTest = false;
      renderer.setRenderTarget(rtUlt);
      renderer.clear(true, true, true);
      var sc2 = toBuf(vis.vetoRect);
      renderRegion(rtUlt, sc2, sceneUlt, camera);
      if (fxOn) renderRegion(rtUlt, sc2, sceneFx, camera);
    }
    rtBase.scissorTest = false; rtUlt.scissorTest = false;
    rectUniform(U.uVeto.value, vetoOn ? vis.vetoRect : null);
    rectUniform(U.uIxR.value, vis.ixRect);
    pass(compMat, rtComp);
    if (bloomOn) renderBloom();
    pass(finalMat, null);
    renderer.autoClear = true;
  }

  // compila de una vez los shaders de lo que aún está oculto (efectos, cristales…): evita tirones en celular
  function warm(scene, cam) {
    var hidden = [];
    scene.traverse(function (o) { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { renderer.compile(scene, cam); } catch (e) { /* no pasa nada: se compilará al usarse */ }
    for (var i = 0; i < hidden.length; i++) hidden[i].visible = false;
  }
  function setOn(on) {
    host.classList.toggle("is-on", on);
    if (backdrop) backdrop.classList.toggle("is-on", on && !!vis.veto);
  }
  function step(dt) {
    clock += dt;
    U.uTime.value = clock;
    VU.uVTime.value = clock;
    var fxOn = false;
    if (vis.veto && api.ready) fxOn = updateVeto(dt);
    else { U.uHoverR.value = 0; U.uSweepR.value = 0; if (reticle) reticle.classList.remove("is-on"); U.uInkBR.value = 1e5; }
    if (vis.ixRect) {
      updateIx(dt);
      rectUniform(U.uInkA.value, vis.ixRect);
      U.uInkAC.value.set(ix.orbScreen.x * dpr, (view.h - ix.orbScreen.y) * dpr);
      U.uInkAR.value = ix.e >= 1 ? 1e5 : inkRadius(clamp(ix.e / 0.95, 0, 1), ix.orbScreen.x, ix.orbScreen.y, vis.ixRect);
    } else { U.uInkA.value.set(0, 0, 0, 0); U.uInkAR.value = 1e5; }
    return fxOn;
  }
  function tick(now) {
    if (!scan() || document.hidden) { running = false; setOn(false); return; }
    raf = requestAnimationFrame(tick);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    setOn(true);
    if (!api.ready && !vis.ixRect) return;
    render(step(dt));
    // calidad adaptativa: si va lento, baja resolución por pasos y al final apaga el bloom
    if (clock > 2.5 && perf.level < 4) {
      perf.frames++; perf.acc += dt;
      if (perf.frames >= 75) {
        if (perf.acc / perf.frames > 1 / 44) {
          perf.level++;
          if (dpr > 1.05) { perfCap = Math.max(1, dpr * 0.8); resize(); }
          else if (bloomOn) { bloomOn = false; finalMat.uniforms.uBloom.value = 0; perf.level = 4; }
        }
        perf.frames = 0; perf.acc = 0;
      }
    }
  }
  function kick() {
    if (running) return;
    if (!scan()) { setOn(false); return; }
    running = true;
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });

  // Depuración: VetoStage._debug.advance(1.5) simula 1.5 s de animación
  var dbg = { poseOff: false, only: null, ixP: null, ixE: null, vein: null, ixZoom: null };
  api._debug = {
    renderer: renderer, camera: camera, ixCam: ixCam, models: models, U: U, VU: VU, view: view, vis: vis, spin: spin, ptr: ptr, flags: dbg, ix: ix,
    poses: POSES, P: P, shots: SHOTS, tele: tele, actions: ACTIONS, final: finalMat, scenes: { base: sceneBase, ult: sceneUlt, fx: sceneFx, ix: sceneIx },
    def: function (name, d) { POSES[name] = P(d); return name; },
    cs: function () { return csPack; }, rt: RT, hx: HX, startHX: function (k) { return startHX(k || "evolve"); },
    start: function (n) { return startAction(n); },
    commit: function (u) { state.target = u; commitForm(u); sweep = sweepFrom = sweepTo = u ? 1 : 0; lastEvolved = u; fb = u ? 1 : 0; },
    settle: function () { springReady = false; },
    advance: function (sec, x, y) {
      if (view.w <= 1) resize();
      if (!scan()) return "sin sección 3D visible";
      setOn(true);
      if (typeof x === "number") { ptr.x = x; ptr.y = y; ptr.moved = clock; ptr.active = nearModel(x, y); }
      var fx = false;
      for (var i = 0, n = Math.max(1, Math.round((sec || 0) * 60)); i < n; i++) fx = step(1 / 60) || fx;
      render(fx);
      return { clock: +clock.toFixed(2), action: act && act.name, evolved: state.evolved, veto: vis.veto && vis.veto.key, ix: !!vis.ixRect, ixP: +ix.p.toFixed(3) };
    }
  };

  resize();
  kick();
})();
