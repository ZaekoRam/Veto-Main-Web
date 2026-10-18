/* ==========================================================================
   VETO MAIN — i18n.js  (español / English)
   - Idioma: ?lang=en|es en la URL > lo último que eligió el visitante > idioma del navegador.
   - Textos fijos del HTML: atributo data-i18n="clave" (innerHTML) y data-i18n-aria="clave" (aria-label).
     El español vive en el HTML; aquí solo va el inglés.
   - Contenido de manifest.js: cada setup o clip puede traer `en: { title, steps | tag }`.
     Si no lo trae, se muestra en español.
   ========================================================================== */
(function () {
  "use strict";
  var KEY = "vetomain.lang";
  var q = /[?&]lang=(en|es)\b/.exec(location.search);
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* almacenamiento bloqueado */ }
  var nav = (navigator.languages && navigator.languages[0]) || navigator.language || "es";
  var lang = q ? q[1] : saved === "en" || saved === "es" ? saved : (/^es\b/i.test(nav) ? "es" : "en");
  if (q) { try { localStorage.setItem(KEY, lang); } catch (e) {} }

  var EN = {
    "doc.title": "Veto Main — Veto abilities, setups and clips · VALORANT",
    "doc.desc": "A Veto main's hub: Veto's kit in 3D, setups for every map in the current pool and clips of the Sentinel who erases utility.",
    "skip": "Skip to content",
    "loader": "Syncing DNA",
    "logo.aria": "Veto Main — home",
    "menu.maps": "Maps",
    "lang.aria": "Cambiar a español",
    "hero.eyebrow": "Agent 29 · Sentinel · Senegal",
    "form.aria": "Veto's form",
    "form.ult": "Evolution",
    "hint.fine": "Hover over him · drag to rotate · <kbd>X</kbd>",
    "hint.touch": "Swipe to rotate · tap to mutate",
    "hero.desc": "The kit, map setups and clips from someone who plays Veto every ranked game. The Sentinel who erases enemy utility before it does its job.",
    "hero.right.aria": "Zero utility",
    "hero.zero": "Zero",
    "hero.utility": "Utility",
    "ix.eyebrow": "Signature · E",
    "ix.count": "Utility destroyed",
    "ix.log.aria": "Intercepted utility",
    "ix.grenade": "Grenade",
    "ix.dart": "Recon dart",
    "ix.dart.short": "Dart",
    "ix.knife": "Knife",
    "ix.drone": "Drone",
    "ix.active": "Active",
    "ix.dmg": "Utility damage",
    "ix.hp": "Health",
    "ix.cd": "Cooldown",
    "ix.hint": "Keep scrolling",
    "kit.title": "Abilities",
    "kit.aria": "Veto's abilities",
    "ab.C.name": "Crosscut",
    "ab.Q.name": "Chokehold",
    "ab.X.name": "Evolution",
    "ab.basic": "Basic · 200",
    "ab.sig": "Signature · Free",
    "ab.ult": "Ultimate · 7 pts",
    "ab.C.desc": "Place a vortex and teleport to it while you look at it. Recharges during the buy phase.",
    "ab.Q.desc": "Throw a piece of your mutation: when it hits the ground it becomes a trap that holds, deafens and weakens.",
    "ab.E.desc": "Place it and activate it: it destroys utility that would bounce off a player or that can be shot down.",
    "ab.X.desc": "Mutate instantly: combat stim, regeneration and immunity to every debuff.",
    "ab.C.stats": "2 charges · 30 m range · 20 HP",
    "ab.Q.stats": "1 charge · 4.5 s · 75 decay",
    "ab.E.stats": "9 s active · 800 dmg/s · 45 s / 20 s",
    "ab.X.stats": "40 HP/s · +10% stim · 1 s",
    "lu.title": "Setups<br>by map",
    "lu.desc": "The seven maps in the current competitive pool. Pick a map, side and ability: each pin shows where to stand and where it lands.",
    "lu.maps.aria": "Maps",
    "lu.side.aria": "Side",
    "lu.ability.aria": "Ability",
    "f.all": "All",
    "f.atk": "Attack",
    "f.def": "Defense",
    "lu.minimap": "· minimap",
    "lu.svg.aria": "Minimap with setups",
    "lu.list.aria": "Map setups",
    "clips.title": "Highlights<br>&amp; socials",
    "clips.desc": "The best of the stream and TikTok. Tap a clip to watch it here.",
    "clips.filter.aria": "Filter by platform",
    "row.tiktok": "daily clips",
    "row.x": "patches and takes",
    "footer.text": "A hub for people who take Veto seriously. Setups, clips and the kit in action, straight from ranked.",
    "footer.legal1": "3D models: “<a href=\"https://sketchfab.com/3d-models/veto-t-pose-35a9c490d5ea452d8a12eeb05513cd3e\" target=\"_blank\" rel=\"noopener\">Veto (T-pose)</a>” and “<a href=\"https://sketchfab.com/3d-models/veto-ult-form-t-pose-03ab696c374a41ba8c8b23565e929b90\" target=\"_blank\" rel=\"noopener\">Veto (Ult Form) (T-pose)</a>” by <a href=\"https://sketchfab.com/BojanV06\" target=\"_blank\" rel=\"noopener\">BojanV06</a>, <a href=\"https://creativecommons.org/licenses/by/4.0/\" target=\"_blank\" rel=\"noopener\">CC BY 4.0</a>. Optimized textures; kit animation generated in real time. Agent-select model and animation, utility models, art, icons and minimaps: Riot Games (via tracker.gg, <a href=\"https://kingdomarchives.com\" target=\"_blank\" rel=\"noopener\">Kingdom Archives</a> and <a href=\"https://valorant-api.com\" target=\"_blank\" rel=\"noopener\">valorant-api.com</a>).",
    "footer.legal2": "Fan project created under Riot Games' “Legal Jibber Jabber” policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.",
    "player.close": "Close player",
    "player.out": "Open on the platform →"
  };

  // t("texto en español", "English text"): para textos que arma el JS
  function t(es, en) { return lang === "en" && en != null ? en : es; }

  // contenido del manifest en inglés (si el setup o clip lo trae)
  var data = window.__VETO__;
  if (lang === "en" && data) {
    (data.maps || []).forEach(function (m) {
      (m.setups || []).forEach(function (s) {
        if (!s.en) return;
        if (s.en.title) s.title = s.en.title;
        if (s.en.steps) s.steps = s.en.steps;
      });
    });
    (data.clips || []).forEach(function (c) {
      if (!c.en) return;
      if (c.en.title) c.title = c.en.title;
      if (c.en.tag) c.tag = c.en.tag;
    });
    var tw = data.socials && data.socials.twitch;
    if (tw && tw.scheduleEn) tw.schedule = tw.scheduleEn;
  }

  function apply() {
    var d = document;
    d.documentElement.lang = lang;
    var btn = d.querySelector("[data-lang-toggle]");
    if (btn) {
      btn.textContent = lang === "en" ? "ES" : "EN";
      btn.setAttribute("aria-label", lang === "en" ? EN["lang.aria"] : "Switch to English");
      btn.setAttribute("lang", lang === "en" ? "es" : "en");
      btn.addEventListener("click", function () { setLang(lang === "en" ? "es" : "en"); });
    }
    if (lang !== "en") return;
    d.title = EN["doc.title"];
    var md = d.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", EN["doc.desc"]);
    Array.prototype.forEach.call(d.querySelectorAll("[data-i18n]"), function (el) {
      var v = EN[el.getAttribute("data-i18n")];
      if (v == null) return;
      el.innerHTML = v;
      if (el.hasAttribute("data-text")) el.setAttribute("data-text", el.textContent);
    });
    Array.prototype.forEach.call(d.querySelectorAll("[data-i18n-aria]"), function (el) {
      var v = EN[el.getAttribute("data-i18n-aria")];
      if (v != null) el.setAttribute("aria-label", v);
    });
    // en inglés el nombre oficial ya es el inglés: sobra la versión chica
    Array.prototype.forEach.call(d.querySelectorAll(".ab-name small"), function (el) { el.remove(); });
  }

  function setLang(l) {
    try { localStorage.setItem(KEY, l); } catch (e) {}
    if (/[?&]lang=/.test(location.search)) {
      location.replace(location.pathname + location.search.replace(/([?&])lang=(en|es)&?/, "$1").replace(/[?&]$/, "") + location.hash);
    } else location.reload();
  }

  window.VetoI18n = { lang: lang, t: t, set: setLang };
  window.t = t;
  apply();
})();
