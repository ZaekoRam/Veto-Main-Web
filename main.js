/* ==========================================================================
   VETO MAIN — main.js
   Interacciones de la página (sin dependencias). Contenido editable en
   lib/manifest.js; escenario 3D en lib/veto-stage.js.
   Imágenes oficiales (íconos, minimapas) vía media.valorant-api.com.
   ========================================================================== */
(function () {
  "use strict";
  // textos que arma el JS: T("español", "English") (lib/i18n.js)
  var T = window.t || function (es) { return es; };

  var data = window.__VETO__ || {};
  var root = document.documentElement;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------------------------------------------------------------- helpers */
  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safe(fn, name) { try { fn(); } catch (e) { if (window.console) console.warn("[" + name + "]", e); } }
  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* noop */ } }
  function isTyping(e) { var t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function setPressed(group, btn) {
    $$("button", group).forEach(function (b) { var on = b === btn; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  }

  var toastTimer = 0;
  function toast(msg) {
    var el = $("[data-toast]");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 1800);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject();
      } catch (e) { reject(e); }
    });
  }

  /* ----------------------------------------------------- texto scramble */
  var CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><";
  function rnd() { return CHARS[(Math.random() * CHARS.length) | 0]; }

  // ScrambleIn: revela de izquierda a derecha a 0.5 caracteres por frame (25 ms)
  function scrambleIn(el, delay, speed) {
    var text = el.getAttribute("data-text") || el.textContent;
    el.setAttribute("data-text", text);
    // cancela un scramble anterior sobre el mismo elemento (cambios rápidos de fase)
    clearTimeout(el._scrT); clearInterval(el._scrI);
    if (reduced) { el.textContent = text; return; }
    el.textContent = " ";
    el._scrT = setTimeout(function () {
      var p = 0;
      var id = el._scrI = setInterval(function () {
        p += speed || 0.5;
        var out = "";
        for (var i = 0; i < text.length; i++) {
          if (text[i] === " ") out += " ";
          else if (i < Math.floor(p)) out += text[i];
          else if (i < p + 3) out += rnd();
        }
        el.textContent = out || " ";
        if (p >= text.length) { clearInterval(id); el.textContent = text; }
      }, 25);
    }, delay || 0);
  }

  // ScrambleText: en hover revuelve todo y lo reconstruye a 4 frames por carácter
  function bindScrambleHover(el) {
    if (!finePointer || reduced || el.dataset.scrambleBound) return;
    el.dataset.scrambleBound = "1";
    var trigger = el.closest("a, button") || el;
    var id = 0;
    function reset() { clearInterval(id); el.textContent = el.getAttribute("data-text") || el.textContent; }
    trigger.addEventListener("mouseenter", function () {
      var text = el.getAttribute("data-text") || el.textContent;
      el.setAttribute("data-text", text);
      clearInterval(id);
      var f = 0;
      id = setInterval(function () {
        var shown = Math.floor(f / 4), out = "";
        for (var i = 0; i < text.length; i++) out += (i < shown || text[i] === " ") ? text[i] : rnd();
        el.textContent = out;
        f++;
        if (shown >= text.length) reset();
      }, 25);
    });
    trigger.addEventListener("mouseleave", reset);
  }

  /* ---------------------------------------------------------- entrada */
  function initEntrance() {
    function enter() {
      root.classList.remove("intro");
      root.classList.add("entered");
      $$(".hero [data-scramble-in]").forEach(function (el) { scrambleIn(el, +el.getAttribute("data-scramble-in") || 0); });
    }
    if (root.classList.contains("entered")) { enter(); return; }
    setTimeout(enter, reduced ? 100 : 800);
  }

  /* -------------------------------------------------------------- editor */
  function initEditorMode() {
    if (/[?&]editor\b/.test(location.search)) { root.classList.add("is-editor"); toast("Modo editor activo"); }
  }

  /* ----------------------------------------------------------------- nav */
  function initNav() {
    var menu = $("[data-menu]"), btn = $("[data-menu-btn]");
    if (!menu || !btn) return;
    function setOpen(open) {
      menu.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? T("Cerrar menú", "Close menu") : T("Abrir menú", "Open menu"));
    }
    btn.addEventListener("click", function () { setOpen(!menu.classList.contains("is-open")); });
    menu.addEventListener("click", function (e) { if (e.target.closest(".menu-links a")) setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.classList.contains("is-open")) { setOpen(false); btn.focus(); } });
    document.addEventListener("pointerdown", function (e) { if (menu.classList.contains("is-open") && !menu.contains(e.target)) setOpen(false); });

    var links = $$(".menu-links a");
    var sections = links.map(function (a) { return document.querySelector(a.getAttribute("href")); }).filter(Boolean);
    if ("IntersectionObserver" in window && sections.length) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      sections.forEach(function (s) { spy.observe(s); });
    }
  }

  /* ------------------------------------------------------ datos / redes */
  function initData() {
    var S = data.socials || {};
    $$("[data-social-link]").forEach(function (a) { var s = S[a.dataset.socialLink]; if (s && s.url) a.href = s.url; });
    $$("[data-social-card]").forEach(function (card) {
      var s = S[card.dataset.socialCard];
      if (!s) return;
      if (s.url) card.href = s.url;
      var h = $("[data-handle]", card), f = $("[data-followers]", card), sc = $("[data-schedule]", card);
      if (h && s.handle) { h.textContent = s.handle; h.setAttribute("data-text", s.handle); }
      if (f && s.followers) f.textContent = s.followers;
      if (sc && s.schedule) sc.textContent = s.schedule;
    });
    var live = !!(S.twitch && S.twitch.live);
    $$("[data-live]").forEach(function (p) {
      p.classList.toggle("is-live", live);
      var l = $("[data-live-label]", p);
      if (l) { l.textContent = live ? T("En vivo", "Live") : "Twitch"; l.setAttribute("data-text", l.textContent); }
      p.setAttribute("aria-label", live ? T("En vivo en Twitch", "Live on Twitch") : T("Canal de Twitch", "Twitch channel"));
    });
    var y = $("[data-year]");
    if (y) y.textContent = new Date().getFullYear();
    $$("[data-scramble]").forEach(bindScrambleHover);
  }

  /* ---------------------------------------------------------- reveals */
  function initReveals() {
    var els = $$("[data-reveal]");
    els.forEach(function (el) { var d = el.getAttribute("data-delay"); if (d) el.style.setProperty("--delay", d + "ms"); });
    function show(el) {
      if (el.classList.contains("is-in")) return;
      el.classList.add("is-in");
      $$("[data-scramble-view]", el).forEach(function (s) { scrambleIn(s, (+el.getAttribute("data-delay") || 0) + 150); });
      if (el.hasAttribute("data-scramble-view")) scrambleIn(el, 150);
    }
    if (!("IntersectionObserver" in window)) { els.forEach(show); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.01, rootMargin: "0px 0px -12% 0px" });
    els.forEach(function (el) { io.observe(el); });
    setTimeout(function () {
      els.forEach(function (el) { if (el.getBoundingClientRect().top < window.innerHeight) show(el); });
    }, 6000);
  }

  /* ------------------------------------ secuencia del Interceptor (HUD) */
  function initIx() {
    var sec = $("#interceptor");
    if (!sec) return;
    var countEl = $("[data-ix-count]"), fill = $("[data-ix-fill]"), ticksEl = $("[data-ix-ticks]"), hint = $("[data-ix-hint]");
    var sticky = $(".ix-sticky", sec);
    var rows = $$("[data-ix-log] li"), tags = $$("[data-ix-tag]");
    var st = stage();
    var timeline = st && st.ixTimeline && st.ixTimeline.length ? st.ixTimeline :
      [{ hit: 0.12 }, { hit: 0.24 }, { hit: 0.36 }, { hit: 0.48 }, { hit: 0.6 }, { hit: 0.72 }];
    if (ticksEl && !ticksEl.children.length) {
      ticksEl.innerHTML = timeline.map(function (t) { return '<b style="left:' + (t.hit * 100).toFixed(2) + '%"></b>'; }).join("");
    }
    var tickEls = ticksEl ? $$("b", ticksEl) : [];
    var last = { count: -1, p: -1, e: -1 };
    var hud = $(".ix-hud", sec);
    function apply(p, count, tagList, entry) {
      // el HUD aparece junto con la mancha de tinta que abre la escena
      var e = entry == null ? 1 : Math.min(1, Math.max(0, (entry - 0.35) / 0.45));
      if (hud && Math.abs(e - last.e) > 0.01) { hud.style.opacity = e.toFixed(2); last.e = e; }
      if (Math.abs(p - last.p) > 0.0005 && fill) fill.style.transform = "scaleX(" + p.toFixed(4) + ")";
      last.p = p;
      if (hint) hint.style.opacity = p < 0.035 ? "1" : "0";
      if (count !== last.count) {
        last.count = count;
        if (countEl) countEl.textContent = (count < 10 ? "0" : "") + count;
        sec.classList.toggle("is-done", count >= timeline.length);
      }
      rows.forEach(function (li, i) {
        var t = timeline[i];
        if (!t) return;
        var done = p >= t.hit, incoming = !done && p >= t.hit - 0.07;
        li.classList.toggle("is-done", done);
        li.classList.toggle("is-incoming", incoming);
        var s2 = $(".ix-log-state", li), txt = done ? T("Interceptada", "Intercepted") : incoming ? T("Entrante", "Incoming") : "—";
        if (s2 && s2.textContent !== txt) s2.textContent = txt;
      });
      tickEls.forEach(function (b, i) { b.classList.toggle("is-done", p >= timeline[i].hit); });
      if (tags.length) {
        var off = sticky ? sticky.getBoundingClientRect() : { top: 0, left: 0 };
        var shown = {};
        (tagList || []).forEach(function (t) {
          var el = tags[t.i];
          if (!el) return;
          shown[t.i] = 1;
          el.style.opacity = t.a.toFixed(3);
          el.classList.toggle("is-hit", !!t.hit);
          el.style.transform = "translate3d(" + (t.x - off.left + 18).toFixed(1) + "px," + (t.y - off.top - 34 - (t.hit ? (1 - t.a) * 24 : 0)).toFixed(1) + "px,0)";
        });
        tags.forEach(function (el, i) { if (!shown[i] && el.style.opacity !== "0") el.style.opacity = "0"; });
      }
    }
    if (st) { st.onIx(function (s3) { apply(s3.p, s3.count, s3.tags, s3.entry); }); }
    else {
      // Sin 3D: el HUD avanza igual con el scroll
      var tick = false;
      var onScroll = function () {
        if (tick) return;
        tick = true;
        requestAnimationFrame(function () {
          tick = false;
          var r = sec.getBoundingClientRect();
          var p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - window.innerHeight)));
          var c = timeline.filter(function (t) { return p >= t.hit; }).length;
          apply(p, c, []);
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  /* -------------------------------------------------- forma + kit 3D */
  var heroVisible = true, kitVisible = false;
  // Nombres oficiales (es-MX) e íconos de las habilidades (media.valorant-api.com)
  var MEDIA = "https://media.valorant-api.com";
  var AGENT = MEDIA + "/agents/92eeef5d-43b5-1d4a-8d03-b3927a09034b";
  var AB = {
    C: { name: T("Corte Transversal", "Crosscut"), slot: "grenade", color: "#8cc2ff" },
    Q: { name: T("Asfixia", "Chokehold"), slot: "ability1", color: "#d4ff4f" },
    E: { name: "Interceptor", slot: "ability2", color: "#3de7f2" },
    X: { name: T("Evolución", "Evolution"), slot: "ultimate", color: "#ffffff" }
  };
  function abIcon(k) { return AGENT + "/abilities/" + (AB[k] || AB.E).slot + "/displayicon.png"; }

  function stage() { var s = window.VetoStage; return s && !s.failed ? s : null; }

  function initForms() {
    var btns = $$("[data-form]");
    var s = stage();
    if (!s) { btns.forEach(function (b) { b.disabled = true; }); return; }
    function paint(evolved) { btns.forEach(function (b) { var on = (b.dataset.form === "ult") === evolved; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }); }
    s.onChange(paint);
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        paint(b.dataset.form === "ult");
        s.setForm(b.dataset.form);
        if (!s.ready) toast(T("Cargando el modelo 3D…", "Loading the 3D model…"));
      });
    });
    var hero = $(".hero");
    if ("IntersectionObserver" in window && hero) {
      new IntersectionObserver(function (e) { heroVisible = e[0].intersectionRatio > 0.35; }, { threshold: [0, 0.35, 0.7] }).observe(hero);
    }
  }

  function initKit() {
    var grid = $("[data-kit]");
    if (!grid) return;
    var items = $$(".ab", grid);
    var s = stage();
    function mark(key, dur) {
      items.forEach(function (it) {
        var on = it.dataset.ab === key;
        it.classList.toggle("is-active", on);
        it.setAttribute("aria-pressed", on ? "true" : "false");
        it.classList.remove("is-running");
        if (on && dur) {
          it.style.setProperty("--dur", dur + "s");
          void it.offsetWidth;
          it.classList.add("is-running");
        }
      });
    }
    function trigger(key, fromUser) {
      var st = stage();
      if (!st || !st.ready) { mark(key, 0); if (fromUser) toast(st ? T("Cargando el modelo 3D…", "Loading the 3D model…") : T("El 3D no está disponible en este navegador", "3D isn't available in this browser")); return 0; }
      if (fromUser) { auto.pausedUntil = Date.now() + 15000; auto.i = (ORDER.indexOf(key) + 1) % ORDER.length; }
      var dur = st.play(key);
      mark(key, dur);
      return dur;
    }
    items.forEach(function (it) { it.addEventListener("click", function () { trigger(it.dataset.ab, true); }); });

    // Demo: con el kit en pantalla Veto usa sus habilidades en orden (un clic o una tecla la pausan un rato)
    var ORDER = ["C", "Q", "E", "X"];
    var auto = { i: 0, timer: 0, pausedUntil: 0 };
    function autoStep() {
      clearTimeout(auto.timer);
      var st = stage();
      if (reduced || !st) return;
      if (!kitVisible || !st.ready) { auto.timer = setTimeout(autoStep, 900); return; }
      var wait = auto.pausedUntil - Date.now();
      if (wait > 0) { auto.timer = setTimeout(autoStep, wait + 60); return; }
      // antes de repetir la vuelta, regresa a la forma base
      if (auto.i === 0 && st.evolved) { st.setForm("base"); auto.timer = setTimeout(autoStep, 2400); return; }
      var key = ORDER[auto.i];
      auto.i = (auto.i + 1) % ORDER.length;
      var dur = trigger(key, false) || 2;
      auto.timer = setTimeout(autoStep, (dur + (key === "X" ? 2.4 : 1.0)) * 1000);
    }
    if (s) s.onAction(function (a) {
      var map = { crosscut: "C", chokehold: "Q", interceptor: "E", evolve: "X", roar: "X" };
      if (map[a.name] && kitVisible) mark(map[a.name], a.dur);
    });

    var kit = $("#kit");
    if ("IntersectionObserver" in window && kit) {
      new IntersectionObserver(function (e) {
        var was = kitVisible;
        kitVisible = e[0].isIntersecting && e[0].intersectionRatio > 0.25;
        if (kitVisible && !was) { clearTimeout(auto.timer); auto.timer = setTimeout(autoStep, 700); }
      }, { threshold: [0, 0.25, 0.5] }).observe(kit);
    }

    // Teclado: C/Q/E/X con el kit en pantalla · X en el hero = transformarse
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e) || $("dialog[open]")) return;
      var k = (e.key || "").toUpperCase();
      if (!/^[CQEX]$/.test(k)) return;
      if (kitVisible) trigger(k, true);
      else if (k === "X" && heroVisible && stage()) { stage().toggle(); }
    });
  }

  /* ------------------------------------------------------- mapas / setups */
  function initLineups() {
    var maps = data.maps || [];
    var tabsEl = $("[data-maps]"), svg = $("[data-board-svg]"), listEl = $("[data-lu-list]"), detailEl = $("[data-lu-detail]");
    if (!maps.length || !tabsEl || !svg || !listEl || !detailEl) return;
    var nameEl = $("[data-board-name]"), imgEl = $("[data-board-img]"), artEl = $("[data-board-art]"), board = $("[data-board]"), mapBox = $(".lu-board-map"), calloutBtn = $("[data-callouts]");
    var saved = storageGet("vetomain.callouts");
    var st = { map: maps[0], side: "all", ability: "all", sel: null, callouts: saved ? saved === "1" : window.innerWidth >= 640 };

    tabsEl.innerHTML = maps.map(function (m, i) {
      var art = m.uuid ? MEDIA + "/maps/" + m.uuid + "/listviewicon.png" : "";
      return '<button type="button" class="map-tab" role="tab" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '">' +
        (art ? '<img src="' + art + '" alt="" loading="lazy" decoding="async">' : "") +
        '<span class="map-tab-name">' + esc(m.name) + "<small>" + (m.setups || []).length + "</small></span></button>";
    }).join("");
    var mapTabs = $$(".map-tab", tabsEl);
    function chooseMap(i) {
      st.map = maps[i]; st.sel = null;
      mapTabs.forEach(function (t, j) { t.setAttribute("aria-selected", i === j ? "true" : "false"); t.tabIndex = i === j ? 0 : -1; });
      render();
    }
    mapTabs.forEach(function (t, i) {
      t.addEventListener("click", function () { chooseMap(i); });
      t.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? (i + 1) % mapTabs.length : e.key === "ArrowLeft" ? (i - 1 + mapTabs.length) % mapTabs.length : null;
        if (n !== null) { e.preventDefault(); chooseMap(n); mapTabs[n].focus(); }
      });
    });
    $$("[data-filter]").forEach(function (group) {
      $$("button", group).forEach(function (b) {
        b.addEventListener("click", function () { setPressed(group, b); st[group.dataset.filter] = b.dataset.value; st.sel = null; render(); });
      });
    });
    function paintCallouts() {
      if (board) board.classList.toggle("hide-callouts", !st.callouts);
      if (calloutBtn) { calloutBtn.classList.toggle("is-active", st.callouts); calloutBtn.setAttribute("aria-pressed", st.callouts ? "true" : "false"); }
    }
    if (calloutBtn) calloutBtn.addEventListener("click", function () { st.callouts = !st.callouts; storageSet("vetomain.callouts", st.callouts ? "1" : "0"); paintCallouts(); });
    paintCallouts();

    // "A Main", "Mid Top"… → coordenadas del callout; o [x, y] directo
    function point(m, ref) {
      if (Array.isArray(ref)) return ref;
      var key = String(ref || "").toLowerCase();
      var c = (m.callouts || []).filter(function (c) { return (c[0] + " " + c[1]).toLowerCase() === key; })[0];
      return c ? [c[2], c[3]] : [50, 50];
    }
    function filtered() {
      return (st.map.setups || []).filter(function (l) {
        return (st.side === "all" || l.side === st.side) && (st.ability === "all" || l.ability === st.ability);
      });
    }
    function curve(a, b) {
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, k = Math.min(9, len * 0.25);
      return "M" + a[0] + " " + a[1] + " Q" + (mx - dy / len * k).toFixed(2) + " " + (my + dx / len * k).toFixed(2) + " " + b[0] + " " + b[1];
    }
    function drawBoard(list) {
      var m = st.map, s = '<g class="lu-labels">';
      (m.callouts || []).forEach(function (c) {
        if (c[1] === "Site") s += '<g class="lu-site"><circle cx="' + c[2] + '" cy="' + c[3] + '" r="3.4"/><text x="' + c[2] + '" y="' + (c[3] + 0.15) + '">' + esc(c[0]) + "</text></g>";
        else s += '<text class="lu-callout" x="' + c[2] + '" y="' + c[3] + '">' + esc((c[0] === "Mid" ? "Mid " : c[0] + " ") + c[1]) + "</text>";
      });
      s += "</g>";
      list.forEach(function (l) {
        var a = point(m, l.from), b = point(m, l.to);
        var sel = st.sel && st.sel.id === l.id, col = (AB[l.ability] || AB.E).color;
        s += '<g class="lu-group' + (sel ? " is-selected" : st.sel ? " is-dim" : "") + '" data-lu="' + esc(l.id) + '" style="--c:' + col + '">' +
          '<path class="lu-path' + (sel ? " is-drawing" : "") + '" d="' + curve(a, b) + '"/>' +
          '<circle class="lu-pin-hit" cx="' + b[0] + '" cy="' + b[1] + '" r="4"/>' +
          (sel ? '<circle class="lu-pulse" cx="' + b[0] + '" cy="' + b[1] + '" r="1.8"/>' : "") +
          '<circle class="lu-pin-to" cx="' + b[0] + '" cy="' + b[1] + '" r="1.4"/>' +
          '<circle class="lu-pin-hit" cx="' + a[0] + '" cy="' + a[1] + '" r="4"/>' +
          '<circle class="lu-pin-from" cx="' + a[0] + '" cy="' + a[1] + '" r="2.6"/>' +
          '<image class="lu-pin-icon" href="' + abIcon(l.ability) + '" x="' + (a[0] - 1.7) + '" y="' + (a[1] - 1.7) + '" width="3.4" height="3.4"/></g>';
      });
      svg.innerHTML = s;
      var drawing = $(".lu-path.is-drawing", svg);
      if (drawing && drawing.getTotalLength) drawing.style.setProperty("--len", drawing.getTotalLength().toFixed(2));
      $$(".lu-group", svg).forEach(function (g) {
        g.addEventListener("click", function () {
          var l = (st.map.setups || []).filter(function (x) { return x.id === g.dataset.lu; })[0];
          if (l) { st.sel = l; render(true); }
        });
      });
    }
    function sideLabel(s) { return s === "atk" ? T("Ataque", "Attack") : s === "def" ? T("Defensa", "Defense") : "—"; }
    function refLabel(r) { return Array.isArray(r) ? "" : esc(r); }
    function diff(n) {
      var out = '<span class="diff" aria-label="' + T("Dificultad ", "Difficulty ") + n + T(" de 3", " of 3") + '">';
      for (var i = 1; i <= 3; i++) out += '<i class="' + (i <= n ? "on" : "") + '"></i>';
      return out + "</span>";
    }
    function mediaMarkup(src) {
      if (/youtu\.?be/.test(src)) {
        var id = (src.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/) || [])[1];
        return id ? '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) + '" title="' + T("Video del setup", "Setup video") + '" allowfullscreen loading="lazy"></iframe>' : "";
      }
      return '<video src="' + esc(src) + '" controls muted playsinline preload="metadata"></video>';
    }
    var lastMap = null;
    function render(fromClick) {
      var m = st.map, list = filtered();
      if (!st.sel || list.indexOf(st.sel) < 0) st.sel = list[0] || null;
      if (nameEl) nameEl.textContent = m.name;
      if (lastMap !== m) {
        lastMap = m;
        if (imgEl) {
          if (mapBox) mapBox.classList.remove("is-loaded");
          imgEl.onload = function () { if (mapBox) mapBox.classList.add("is-loaded"); };
          imgEl.src = m.minimap || (m.uuid ? MEDIA + "/maps/" + m.uuid + "/displayicon.png" : "");
          if (imgEl.complete && imgEl.naturalWidth && mapBox) mapBox.classList.add("is-loaded");
        }
        if (artEl) artEl.style.backgroundImage = m.uuid ? 'url("' + MEDIA + "/maps/" + m.uuid + '/listviewicon.png")' : "";
      }
      drawBoard(list);
      listEl.innerHTML = list.length ? list.map(function (l) {
        var on = st.sel && st.sel.id === l.id;
        return '<li><button type="button" class="lu-item' + (on ? " is-active" : "") + '" data-id="' + esc(l.id) + '" aria-pressed="' + on + '" style="--c:' + (AB[l.ability] || AB.E).color + '">' +
          '<img class="lu-item-icon" src="' + abIcon(l.ability) + '" alt="' + esc(l.ability) + '" width="128" height="128" loading="lazy">' +
          '<span><span class="lu-item-title">' + esc(l.title) + '</span><span class="lu-item-meta">' + sideLabel(l.side) + T(" · Sitio ", " · Site ") + esc(l.site) + "</span></span>" +
          diff(l.diff || 1) + "</button></li>";
      }).join("") : '<li class="lu-empty">' + T("Sin setups con este filtro en ", "No setups with this filter on ") + esc(m.name) + ".</li>";
      $$(".lu-item", listEl).forEach(function (b) {
        b.addEventListener("click", function () { st.sel = list.filter(function (x) { return x.id === b.dataset.id; })[0] || null; render(true); });
      });
      var l = st.sel;
      if (!l) { detailEl.innerHTML = ""; detailEl.hidden = true; return; }
      detailEl.hidden = false;
      var where = (refLabel(l.from) ? T("<span>Desde <b>", "<span>From <b>") + refLabel(l.from) + "</b></span>" : "") + (refLabel(l.to) ? T("<span>Hacia <b>", "<span>To <b>") + refLabel(l.to) + "</b></span>" : "");
      detailEl.innerHTML =
        '<p class="lu-detail-kicker"><img src="' + abIcon(l.ability) + '" alt="" width="128" height="128">' + esc(l.ability) + " · " + esc((AB[l.ability] || {}).name || "") + " · " + esc(m.name) + "</p>" +
        "<h3>" + esc(l.title) + "</h3>" +
        '<p class="lu-detail-meta"><span>' + T("Lado", "Side") + ' <b>' + sideLabel(l.side) + "</b></span><span>" + T("Sitio", "Site") + " <b>" + esc(l.site) + "</b></span><span>" + T("Dificultad", "Difficulty") + " <b>" + (l.diff || 1) + "/3</b></span>" + where + "</p>" +
        '<ol class="lu-steps">' + (l.steps || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
        (l.video ? '<div class="lu-media">' + mediaMarkup(l.video) + "</div>" : "");
      if (fromClick) { detailEl.classList.remove("is-entering"); void detailEl.offsetWidth; detailEl.classList.add("is-entering"); }
    }
    if (board && root.classList.contains("is-editor")) {
      board.addEventListener("click", function (e) {
        if (e.target.closest(".lu-group, button")) return;
        var r = svg.getBoundingClientRect();
        var txt = "[" + ((e.clientX - r.left) / r.width * 100).toFixed(1) + ", " + ((e.clientY - r.top) / r.height * 100).toFixed(1) + "]";
        copyText(txt).then(function () { toast(T("Copiado ", "Copied ") + txt); }, function () { toast(txt); });
      });
    }
    render();
  }

  /* -------------------------------------------------------------- clips */
  var PLATFORM = {
    twitch: { label: "Twitch", icon: "i-twitch" },
    tiktok: { label: "TikTok", icon: "i-tiktok" },
    x: { label: "X", icon: "i-x" },
    youtube: { label: "YouTube", icon: "i-youtube" }
  };
  var clipList = [];
  function formatDate(d) { var p = String(d || "").split("-"); return p.length === 3 ? p[2] + "." + p[1] + "." + p[0].slice(2) : (d || ""); }

  function initClips() {
    clipList = (data.clips || []).slice();
    var grid = $("[data-clip-grid]");
    if (grid && !grid.children.length) {
      grid.innerHTML = clipList.map(function (c, i) {
        var P = PLATFORM[c.platform] || PLATFORM.twitch;
        return '<button type="button" class="clip' + (c.featured ? " clip--featured" : "") + '" data-platform="' + esc(c.platform) + '" data-play-clip="' + i + '" data-reveal data-delay="' + (i % 4) * 60 + '" aria-label="' + T("Reproducir: ", "Play: ") + esc(c.title) + '">' +
          '<span class="clip-thumb"><span class="clip-art">' + (c.thumb ? '<img src="' + esc(c.thumb) + '" alt="" loading="lazy" decoding="async">' : '<svg class="clip-mark" aria-hidden="true"><use href="#i-mark"/></svg>') + "</span>" +
          '<span class="clip-num" aria-hidden="true">' + (i + 1 < 10 ? "0" : "") + (i + 1) + "</span>" +
          '<span class="clip-badge"><svg aria-hidden="true"><use href="#' + P.icon + '"/></svg>' + P.label + "</span>" +
          (c.duration ? '<span class="clip-dur">' + esc(c.duration) + "</span>" : "") +
          '<span class="clip-play" aria-hidden="true"><svg><use href="#i-play"/></svg></span></span>' +
          '<span class="clip-body"><span class="clip-tag">' + esc(c.tag || P.label) + '</span><span class="clip-title">' + esc(c.title) + "</span>" +
          '<span class="clip-meta">' + (c.views ? esc(c.views) + T(" vistas", " views") : "") + (c.date ? " · " + formatDate(c.date) : "") + "</span></span></button>";
      }).join("");
    }
    var filters = $("[data-clip-filters]");
    if (filters && grid) {
      $$("button", filters).forEach(function (b) {
        b.addEventListener("click", function () {
          setPressed(filters, b);
          var v = b.dataset.value, shown = 0;
          $$(".clip", grid).forEach(function (card) { var on = v === "all" || card.dataset.platform === v; card.classList.toggle("is-hidden", !on); if (on) shown++; });
          if (!shown) toast(T("Aún no hay clips de ", "No clips from ") + b.textContent + T("", " yet"));
        });
      });
    }
    initPlayer();
  }

  function initPlayer() {
    var dlg = $("[data-player]");
    if (!dlg) return;
    var frame = $("[data-player-frame]", dlg), title = $("[data-player-title]", dlg), meta = $("[data-player-meta]", dlg), out = $("[data-player-out]", dlg);
    var lastTrigger = null;
    function embedFor(c) {
      var host = location.hostname;
      if (c.src) return { html: '<video src="' + esc(c.src) + '" controls autoplay playsinline></video>' };
      if (!c.id) return null;
      if (c.platform === "twitch" && host) return { html: '<iframe src="https://clips.twitch.tv/embed?clip=' + encodeURIComponent(c.id) + "&parent=" + encodeURIComponent(host) + '&autoplay=true" allowfullscreen title="' + esc(c.title) + '"></iframe>' };
      if (c.platform === "youtube") return { html: '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(c.id) + '?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="' + esc(c.title) + '"></iframe>' };
      if (c.platform === "tiktok") return { html: '<iframe src="https://www.tiktok.com/embed/v2/' + encodeURIComponent(c.id) + '" allow="encrypted-media" allowfullscreen title="' + esc(c.title) + '"></iframe>', vertical: true };
      return null;
    }
    function open(i, trigger) {
      var c = clipList[i];
      if (!c) return;
      lastTrigger = trigger || null;
      var P = PLATFORM[c.platform] || PLATFORM.twitch;
      title.textContent = c.title;
      meta.textContent = [P.label, c.duration, c.views ? c.views + " vistas" : ""].filter(Boolean).join(" · ");
      var em = embedFor(c);
      frame.classList.toggle("is-vertical", !!(em && em.vertical));
      frame.innerHTML = em ? em.html :
        '<div class="player-empty"><p>' + T("Este clip se reproduce en ", "This clip plays on ") + P.label + ".</p>" +
        (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener"><svg aria-hidden="true"><use href="#' + P.icon + '"/></svg>' + T("Ver en ", "Watch on ") + P.label + "</a>" : "") + "</div>";
      if (c.url) { out.href = c.url; out.hidden = false; } else out.hidden = true;
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    }
    function close() { if (typeof dlg.close === "function" && dlg.open) dlg.close(); else dlg.removeAttribute("open"); }
    dlg.addEventListener("close", function () { frame.innerHTML = ""; if (lastTrigger && lastTrigger.focus) lastTrigger.focus(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });
    $("[data-player-close]", dlg).addEventListener("click", close);
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-play-clip]");
      if (t) open(parseInt(t.dataset.playClip, 10) || 0, t);
    });
  }

  /* --------------------------------------------------------------- boot */
  function boot() {
    safe(initEditorMode, "initEditorMode");
    safe(initData, "initData");
    safe(initEntrance, "initEntrance");
    safe(initNav, "initNav");
    safe(initClips, "initClips");
    safe(initReveals, "initReveals");
    safe(initIx, "initIx");
    safe(initForms, "initForms");
    safe(initKit, "initKit");
    safe(initLineups, "initLineups");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
