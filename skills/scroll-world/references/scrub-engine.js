/* ============================================================================
   scroll-world — portable scroll-scrubbed depth-parallax engine (WebGL)
   ----------------------------------------------------------------------------
   Framework-agnostic. Vanilla JS + WebGL, zero dependencies. It builds its own
   DOM and injects its own (namespaced) CSS into a container you give it, so it
   drops into plain HTML, Next.js (call from a ref/useEffect), Vue (onMounted), a
   server-rendered page, anything.

   Instead of scrubbing pre-rendered video, the camera move is SYNTHESIZED at
   runtime from a depth map: each section supplies a `still` image + a `depth`
   grayscale map (white = near, black = far). A full-screen-quad fragment shader
   displaces the still by its depth map as a function of scroll progress — a
   push-in zoom plus depth parallax around the scene's `focal` — and crossfades to
   the next scene across a fixed seam band. One continuous connected flight, no
   cuts, no video files.

   USAGE
     mountScrollWorld(document.getElementById('world'), {
       brand: { name: 'Pearl & Co.', href: '#top' },
       scrollPer: 1.3,   // viewport-heights of scroll per scene
       depth: 0.06,      // parallax strength (fraction of frame; keep <= ~0.08)
       zoom: 0.18,       // how far the camera pushes in across a scene
       crossfade: 0.14,  // seam dissolve width (viewport-heights)
       hint: 'scroll to fly in',
       nav: true,         // show the top section nav
       atmosphere: true,  // subtle gradient + drifting particles behind the canvas
       sections: [
         { id, label, still, depth, accent,
           focal:[0.5,0.42],  // where the camera dives toward (UV, y from top); optional
           scroll: 1.6,   // optional per-section override of scrollPer — more scroll
                          // distance = a slower, longer dwell in this scene
           linger: 0.5,   // optional 0..1 — remaps progress so the camera settles
                          // mid-scene (exactly where the copy peaks) and moves quicker at
                          // the edges. 0 = linear (default). Keep <= 0.6; 1 = full pause.
           eyebrow, title, body, tags:[…],
           cta:{ primary:{label,href}, secondary:{label,href} } }, // last section only
         … ]
     });

   MOBILE (always on, no separate assets)
     The engine is phone-aware out of the box: on a coarse-pointer / <=860px viewport it
       - dials `depth` down (~40%) so a small screen doesn't smear the parallax,
       - drops the drifting particles,
       - ignores URL-bar-only resizes (no scroll jump),
     and otherwise serves the exact same still+depth pair as desktop — there is no second
     render or encode to wire.

   THEME (CSS custom properties; set on the container or :root to override)
     --sw-bg         page background (match your scene bg for seamless posters)
     --sw-ink        primary text
     --sw-ink-soft   secondary text
     --sw-accent     default accent (each section overrides via its `accent`)
     --sw-font-display / --sw-font-body

   REQUIREMENTS ON YOUR ASSETS
     - `still`  : a still image (webp/png), any generator. 3:2 reads best.
     - `depth`  : a grayscale map, white = near / black = far, SAME convention for
                  every scene (see depth-map.py). This is what makes the seams hold.
     The engine loads each pair as a WebGL texture (lazy, near the active scroll) and
     displaces it in the shader; it does NOT depend on HTTP byte-range support.
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phone detection. `coarse` is captured once (input type doesn't change mid-session);
  // the <=860px query is read live via isMobile() so a desktop resize/DevTools toggle
  // switches behaviour without a reload.
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  const SECTIONS = config.sections || [];
  const N = SECTIONS.length;
  if (!N) return;

  const SCROLL_PER = config.scrollPer || 1.3;
  const ZOOM = config.zoom != null ? config.zoom : 0.18;          // push-in amount
  const CROSSFADE = config.crossfade != null ? config.crossfade : 0.14; // seam band (vh)
  let DEPTH_AMT = config.depth != null ? config.depth : 0.06;     // parallax strength
  if (isMobile()) DEPTH_AMT *= 0.4;                                // lighter on phones

  injectCSS();
  container.classList.add('sw-root');

  // ---- build the segment chain: one segment per section (no connectors) ----
  const SEGMENTS = SECTIONS.map((s, i) => ({
    si: i, still: s.still, depth: s.depth, accent: s.accent,
    focal: s.focal || [0.5, 0.42],
    w: s.scroll || SCROLL_PER, linger: s.linger || 0,
    tex: null, depthTex: null, iw: 0, ih: 0,
    loaded: false, loading: false,
    cur: 0, target: 0, visible: false,
    el: null, img: null,
  }));

  // ---- DOM (chrome) ----
  const sky = el('div', 'sw-sky');
  if (config.atmosphere !== false) {
    sky.appendChild(el('div', 'sw-sky__grad'));
    sky.appendChild(el('div', 'sw-sky__glow'));
  }
  const particles = el('div', 'sw-particles'); sky.appendChild(particles);

  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);

  const topbar = el('div', 'sw-topbar');
  if (config.brand) {
    const brand = el('a', 'sw-brand'); brand.href = (config.brand.href || '#');
    brand.appendChild(el('span', 'sw-brand__mark'));
    const nm = el('span', 'sw-brand__name'); nm.textContent = config.brand.name || ''; brand.appendChild(nm);
    topbar.appendChild(brand);
  }
  const nav = el('nav', 'sw-nav'); if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta && config.cta.label) {
    const c = el('a', 'sw-topcta'); c.href = config.cta.href || '#'; c.textContent = config.cta.label;
    topbar.appendChild(c);
  }

  const stage = el('div', 'sw-stage');
  // Posters: the still shown behind the canvas until its WebGL texture is ready (and the
  // only visual under prefers-reduced-motion). One per segment, faded by scroll distance.
  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene'); scene.style.setProperty('--sw-accent', s.accent || '');
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy';
    if (s.still) img.src = s.still;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img;
  });
  // The WebGL canvas sits above the posters.
  const canvas = document.createElement('canvas');
  canvas.className = 'sw-stage__gl';
  stage.appendChild(canvas);

  const copylayer = el('div', 'sw-copylayer');
  const route = el('div', 'sw-route');
  const hint = el('div', 'sw-hint');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  const track = el('div', 'sw-track');

  [sky, scrollbar, topbar, stage, copylayer, route, hint, track].forEach(n => container.appendChild(n));

  // per-section copy / route / nav
  const copies = [], dots = [];
  SECTIONS.forEach((s, i) => {
    const c = el('article', 'sw-copy'); c.style.setProperty('--sw-accent', s.accent || '');
    c.innerHTML =
      `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` +
      (s.eyebrow ? `<span class="sw-copy__eyebrow">${esc(s.eyebrow)}</span>` : '') +
      (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : '') +
      (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : '') +
      (s.tags && s.tags.length ? `<ul class="sw-copy__tags">${s.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
      (s.cta ? `<div class="sw-copy__cta">${ctaBtns(s.cta)}</div>` : '');
    copylayer.appendChild(c); copies.push(c);

    const dot = el('button', 'sw-route__dot'); dot.style.setProperty('--sw-accent', s.accent || '');
    dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
    dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);

    if (config.nav !== false) {
      const b = el('button', 'sw-nav__item'); b.textContent = s.label || '';
      b.addEventListener('click', () => jumpTo(i)); nav.appendChild(b);
    }
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  // Per-section dwell: monotone remap of scroll→progress so the camera settles mid-scene
  // (where the copy peaks) and moves quicker near the seams. L=0 linear, L=1 full
  // mid-scene pause. f(0)=0, f(1)=1 always, so seam progress is untouched.
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  let vh = window.innerHeight, totalH = 0, activeIndex = -1, ticking = false;
  let laidOutW = window.innerWidth;   // width the current layout was computed at

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    let off = 0;
    SEGMENTS.forEach(s => { s.start = off * vh; off += s.w; s.end = off * vh; });
    totalH = off;
    track.style.height = (totalH * vh + vh) + 'px';   // +1vh so the last flight completes
    read();
  }

  function jumpTo(i) {
    const seg = SEGMENTS[i];
    window.scrollTo({ top: seg.start + (seg.end - seg.start) * 0.5, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- WebGL (skipped entirely under prefers-reduced-motion) ----
  let gl = null, prog = null, U = {}, quad = null;
  if (!reduce) {
    gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
    if (gl) { prog = buildProgram(gl); if (prog) cacheUniforms(); }
    if (!gl || !prog) {
      // Graceful fallback: behave as if reduced-motion (posters only, no shader).
      gl = null;
      console.warn('scroll-world: WebGL unavailable — falling back to static stills.');
    }
  }

  function cacheUniforms() {
    U.uStill = gl.getUniformLocation(prog, 'uStill');
    U.uDepth = gl.getUniformLocation(prog, 'uDepth');
    U.uCover = gl.getUniformLocation(prog, 'uCover');
    U.uFocal = gl.getUniformLocation(prog, 'uFocal');
    U.uProgress = gl.getUniformLocation(prog, 'uProgress');
    U.uDepthAmt = gl.getUniformLocation(prog, 'uDepthAmt');
    U.uZoom = gl.getUniformLocation(prog, 'uZoom');
    U.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
  }

  function resizeCanvas() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The canvas is 100% of the fixed viewport-height stage, so size the drawing
    // buffer from its own CSS box (fall back to the window if not yet laid out).
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const W = Math.max(1, Math.floor(w * dpr));
    const H = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }

  function makeTexture(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!gl) { reject(new Error('no gl')); return; }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        tex._w = img.naturalWidth; tex._h = img.naturalHeight;
        resolve(tex);
      };
      img.onerror = () => reject(new Error('load ' + url));
      img.src = url;
    });
  }

  function loadScene(s) {
    if (s.loading || s.loaded || !s.still || !s.depth || !gl) return;
    s.loading = true;
    Promise.all([makeTexture(s.still), makeTexture(s.depth)])
      .then(([t, d]) => { s.tex = t; s.depthTex = d; s.iw = t._w; s.ih = t._h; s.loaded = true; s.el.classList.add('has-tex'); read(); })
      .catch(() => { s.loading = false; });
  }

  // cover: UV sub-rect scale so the still fills the canvas (object-fit: cover).
  function coverScale(iw, ih, cw, ch) {
    const ir = iw / ih, cr = cw / ch;
    if (cr > ir) return [1.0, ir / cr];
    return [cr / ir, 1.0];
  }

  function drawScene(s, p, alpha) {
    if (!s.loaded || !gl) return;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.uniform1i(U.uStill, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, s.depthTex); gl.uniform1i(U.uDepth, 1);
    const cs = coverScale(s.iw, s.ih, canvas.width, canvas.height);
    gl.uniform2f(U.uCover, cs[0], cs[1]);
    gl.uniform2f(U.uFocal, s.focal[0], 1 - s.focal[1]);   // shader UV is y-up
    gl.uniform1f(U.uProgress, p);
    gl.uniform1f(U.uDepthAmt, DEPTH_AMT);
    gl.uniform1f(U.uZoom, 1 + ZOOM);
    gl.uniform1f(U.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    if (!gl) return;
    resizeCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const y = window.scrollY || window.pageYOffset || 0;
    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= SEGMENTS[i].start) ci = i;
    const seg = SEGMENTS[ci];
    let p = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
    if (seg.linger) p = lingerEase(p, seg.linger);
    // lerp the rendered progress toward the scroll target for buttery motion
    seg.cur += (p - seg.cur) * 0.2;

    drawScene(seg, seg.cur, 1.0);

    // Crossfade to the next scene across the seam band: next is held at its WIDE pose
    // (progress 0) and faded in. Its pose is identical on both sides of the seam, so the
    // hand-off is continuous — the only thing changing is which scene is on top.
    const band = CROSSFADE * vh;
    if (ci < N - 1 && (seg.end - y) < band) {
      const a = clamp((seg.end - y) / band, 0, 1);   // 1 at band start -> 0 at seam
      drawScene(SEGMENTS[ci + 1], 0.0, 1 - a);
    }
  }

  // ---- read(): scroll -> segment progress + chrome (copy, route, posters) ----
  function read() {
    const y = window.scrollY || window.pageYOffset || 0;
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < N; i++) if (y >= SEGMENTS[i].start) ci = i;

    for (let i = 0; i < N; i++) {
      const s = SEGMENTS[i];
      // lazy-load textures for segments near the viewport
      if (!reduce && gl) { if (y > s.start - 1.6 * vh && y < s.end + 1.6 * vh) loadScene(s); }
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      s.target = s.linger ? lingerEase(local, s.linger) : local;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      const op = smooth(1 - outside / fade);
      // When there's no shader (reduced-motion OR WebGL unavailable) the posters ARE the
      // visual, so fade them by scroll distance. Otherwise the canvas covers a loaded
      // poster, and an unloaded poster shows at `op` until its texture arrives.
      const noShader = reduce || !gl;
      s.img.style.opacity = noShader ? op : (s.loaded ? 0 : op);
      s.el.style.opacity = noShader ? op : 1;
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      s.visible = op > 0.001;
    }

    for (let i = 0; i < N; i++) {
      const seg = SEGMENTS[i];
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);            // greets on landing
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);       // holds CTA at the end
      else cop = (before || after) ? 0 : smooth(1 - Math.abs(pr - 0.5) / 0.5);
      const c = copies[i];
      c.style.opacity = cop;
      c.style.transform = reduce ? 'none' : `translateY(${(0.5 - pr) * 4}vh)`;
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';
    }

    const cur = SEGMENTS[ci];
    const near = clamp(ci, 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === near));
      nav.querySelectorAll('.sw-nav__item').forEach((n, k) => n.classList.toggle('is-active', k === near));
      container.style.setProperty('--sw-accent', SECTIONS[near].accent || '');
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalH * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    if (particles) particles.style.transform = `translate3d(0, ${-y * 0.05}px, 0)`;

    if (!reduce && gl) render();
    ticking = false;
  }

  // continuous rAF only while the user is scrolling/settling, to keep it cheap
  function raf() {
    const y = window.scrollY || window.pageYOffset || 0;
    // keep lerping until the rendered progress catches up to the target
    let moving = false;
    for (let i = 0; i < N; i++) {
      const s = SEGMENTS[i];
      if (Math.abs(s.cur - s.target) > 0.001) { s.cur += (s.target - s.cur) * 0.2; moving = true; }
    }
    if (!reduce && gl) render();
    if (moving) requestAnimationFrame(raf);
    else ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(read); }
    if (!reduce && gl) requestAnimationFrame(raf);
  }, { passive: true });

  // Mobile browsers fire `resize` every time the URL bar slides in/out. Re-running
  // layout() there rebuilds the track height and yanks the scroll position, so on
  // touch we ignore height-only changes and only relayout when the width actually
  // changes (rotation still comes through orientationchange).
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);
  layout();
  if (!reduce && gl) requestAnimationFrame(raf);

  // ---- WebGL helpers ----
  function buildProgram(gl) {
    const vs = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;
    const fs = `
      precision highp float;
      uniform sampler2D uStill;
      uniform sampler2D uDepth;
      uniform vec2 uCover;
      uniform vec2 uFocal;
      uniform float uProgress;
      uniform float uDepthAmt;
      uniform float uZoom;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        // 1) cover-fit the still into the canvas (object-fit: cover)
        vec2 uv = (vUv - 0.5) * uCover + 0.5;
        // 2) push-in zoom around the focal point (progress 0 -> wide, 1 -> deep)
        float s = mix(1.0, uZoom, uProgress);
        uv = (uv - uFocal) / s + uFocal;
        // 3) depth parallax: sample depth in image space, displace near(white) more
        float d = texture2D(uDepth, uv).r;          // 0 far .. 1 near (white = near)
        uv -= (uv - uFocal) * (d - 0.5) * uDepthAmt * uProgress;
        vec4 c = texture2D(uStill, uv);
        gl_FragColor = vec4(c.rgb, c.a * uAlpha);
      }`;
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('scroll-world: link failed', gl.getProgramInfoLog(p));
      return null;
    }
    // full-screen quad (two triangles)
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return p;
  }
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('scroll-world: shader compile failed', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  // ---- generic helpers ----
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"\/]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '/': '&#47;' }[c])); }
  function ctaBtns(cta) {
    let h = '';
    if (cta.primary) h += `<a class="sw-btn sw-btn--primary" href="${esc(cta.primary.href || '#')}">${esc(cta.primary.label)}</a>`;
    if (cta.secondary) h += `<a class="sw-btn sw-btn--ghost" href="${esc(cta.secondary.href || '#')}">${esc(cta.secondary.label)}</a>`;
    return h;
  }
}

function seedParticles(host, reduce) {
  if (!host || reduce) return;
  const kinds = ['dot', 'dot', 'ring'];
  const seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91, 5, 38, 55, 69, 82, 97];
  for (let k = 0; k < 20; k++) {
    const s = document.createElement('span');
    s.className = 'sw-pt sw-pt--' + kinds[k % kinds.length];
    s.style.left = seeds[k % seeds.length] + 'vw';
    s.style.top = ((seeds[(k * 3) % seeds.length] * 1.3) % 100) + 'vh';
    s.style.setProperty('--sw-sc', (0.5 + ((seeds[(k * 5) % seeds.length] % 60) / 60) * 1.1).toFixed(2));
    const dur = 14 + (seeds[(k * 7) % seeds.length] % 22);
    s.style.animationDuration = dur + 's';
    s.style.animationDelay = (-(seeds[(k * 2) % seeds.length] % dur)) + 's';
    host.appendChild(s);
  }
}

function injectCSS() {
  if (document.getElementById('sw-css')) return;
  const css = `
  .sw-root{--sw-bg:#F5EDE0;--sw-ink:#241d2b;--sw-ink-soft:#6a6072;--sw-accent:#8a7bb5;
    --sw-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
    --sw-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#F5EDE0);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 12%,var(--sw-bg)) 0%,var(--sw-bg) 55%,color-mix(in srgb,var(--sw-accent) 6%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--sw-accent) 22%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 45%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 60%,#000),#000 82%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.5}88%{opacity:.45}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:24px;height:28px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--sw-accent),color-mix(in srgb,var(--sw-accent) 60%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--sw-accent) 40%,transparent);}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.1rem;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 55%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--sw-accent) 16%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.82rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink);} .sw-nav__item.is-active{color:#fff;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--sw-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;background:var(--sw-bg);}
  .sw-stage__gl{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:2;}
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;z-index:1;}
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--sw-ink-soft);}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}
  .sw-btn--primary{color:#fff;background:var(--sw-ink);} .sw-btn--primary:hover{transform:translateY(-2px);}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-ink) 25%,transparent);} .sw-btn--ghost:hover{transform:translateY(-2px);}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(42vw,460px);opacity:0;will-change:opacity,transform;}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:var(--sw-accent);opacity:.28;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;}
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--sw-accent) 40%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.25);background:var(--sw-accent);}
  .sw-route__dot.is-active i{background:var(--sw-accent);transform:scale(1.4);box-shadow:0 0 0 5px color-mix(in srgb,var(--sw-accent) 22%,transparent);}
  .sw-route__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--sw-ink);background:color-mix(in srgb,#fff 85%,transparent);backdrop-filter:blur(6px);padding:5px 11px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sw-ink-soft);transition:opacity .3s;}
  .sw-hint i{width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--sw-ink) 28%,transparent);position:relative;}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--sw-accent);transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    .sw-nav{display:none;}
    .sw-copylayer::before{width:100%;height:60%;top:auto;bottom:0;background:linear-gradient(0deg,var(--sw-bg) 8%,color-mix(in srgb,var(--sw-bg) 70%,transparent) 46%,transparent 100%);}
    .sw-copy{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:clamp(64px,14vh,120px);transform:none;width:auto;max-width:560px;}
    .sw-copy{bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));}
    .sw-copy__title{font-size:clamp(1.9rem,7.5vw,2.7rem);}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem);} .sw-scene__still{object-position:center 46%;}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom));}
    .sw-route{gap:16px;right:6px;} .sw-route__label{display:none;}
  }
  @media (max-width:860px) and (orientation:portrait){
    .sw-scene__still{object-position:center 44%;}
  }
  @media (hover:none) and (pointer:coarse){
    .sw-route{padding:14px 6px;}
    .sw-route__dot{width:28px;height:28px;}
    .sw-btn{padding:15px 26px;}
  }
  @media (prefers-reduced-motion:reduce){ .sw-hint i::after{animation:none;} .sw-pt{display:none;} .sw-stage__gl{display:none;} }
  `;
  // Wrap in a cascade layer so the page's own theme tokens (unlayered
  // :root / .sw-root { --sw-bg / --sw-ink / --sw-accent … }) always win over
  // these defaults, regardless of injection order. Enables clean dark themes.
  const style = document.createElement('style'); style.id = 'sw-css';
  style.textContent = '@layer sw {\n' + css + '\n}';
  document.head.appendChild(style);
}

// Expose for module + global use.
if (typeof module !== 'undefined' && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== 'undefined') window.mountScrollWorld = mountScrollWorld;
