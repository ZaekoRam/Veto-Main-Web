/* ==========================================================================
   VETO MAIN — manifest.js
   Todo el contenido editable del sitio vive aquí. No necesitas tocar HTML
   para: redes, clips, mapas y setups ni los modelos 3D.
   ========================================================================== */
(function () {
  "use strict";

  window.__VETO__ = {
    brand: "Veto Main",

    /* ---------- REDES ------------------------------------------------------
       Cambia handle + url. `live: true` enciende el indicador EN VIVO.        */
    socials: {
      twitch: { handle: "vetomain", url: "https://twitch.tv/vetomain", followers: "12.4K", live: false, schedule: "Lun–Vie · 20:00 CDMX", scheduleEn: "Mon–Fri · 8 PM CDMX" },
      tiktok: { handle: "@vetomain", url: "https://tiktok.com/@vetomain", followers: "38.9K" },
      x:      { handle: "@vetomain", url: "https://x.com/vetomain", followers: "6.1K" }
    },

    /* ---------- ESCENARIO 3D ------------------------------------------------
       Reemplaza los .glb por tus propios modelos. Ambos deben compartir pose y
       esqueleto para que la revelación (spotlight) quede alineada.           */
    stage: {
      base: "assets/models/veto-base.glb",
      ult:  "assets/models/veto-ult.glb",
      cs:   "assets/models/veto-cs.glb?v=2",   // modelo oficial de selección de agente (con su animación) para el inicio
      armsDown: 72,          // grados: baja los brazos del T-pose (0 = T-pose)
      spotlight: 150,        // radio del spotlight en px CSS (desktop)
      exposure: 1.0,
      bloom: 0.32            // brillo de los efectos (0 = sin bloom)
    },

    /* ---------- CLIPS -------------------------------------------------------
       en: { title, tag } → versión en inglés (opcional; si falta se muestra en español)
       platform: "twitch" | "tiktok" | "x" | "youtube"
       id: ID del clip (Twitch clip slug, ID de YouTube o ID numérico de TikTok)
       src: ruta a un .mp4 local (opcional, tiene prioridad si existe)
       thumb: imagen .webp en assets/img/clips/ (opcional)                    */
    clips: [
      { title: "Interceptor se come la ejecución completa en B", platform: "twitch", id: "", url: "https://twitch.tv/vetomain", views: "48K", duration: "0:34", date: "2026-09-21", tag: "Anti-ejecución", featured: true, en: { title: "Interceptor eats the entire B execute", tag: "Anti-execute" } },
      { title: "Evolución 1v3: inmune al flash, al stun y a todo", platform: "tiktok", id: "", url: "https://tiktok.com/@vetomain", views: "212K", duration: "0:21", date: "2026-09-14", tag: "Clutch", en: { title: "Evolution 1v3: immune to flashes, stuns and everything", tag: "Clutch" } },
      { title: "Corte Transversal + Op: el peek que nadie espera", platform: "tiktok", id: "", url: "https://tiktok.com/@vetomain", views: "96K", duration: "0:17", date: "2026-09-09", tag: "Movilidad", en: { title: "Crosscut + Op: the peek nobody expects", tag: "Mobility" } },
      { title: "Asfixia en la salida de B Main — ronda gratis", platform: "twitch", id: "", url: "https://twitch.tv/vetomain", views: "22K", duration: "0:41", date: "2026-09-02", tag: "Setup", en: { title: "Chokehold on the B Main exit — free round", tag: "Setup" } },
      { title: "Cómo jugar Veto en Summit", platform: "youtube", id: "", url: "https://youtube.com", views: "31K", duration: "8:12", date: "2026-08-27", tag: "Guía", en: { title: "How to play Veto on Summit", tag: "Guide" } },
      { title: "El retake más limpio de la semana", platform: "x", id: "", url: "https://x.com/vetomain", views: "15K", duration: "0:29", date: "2026-08-20", tag: "Retake", en: { title: "The cleanest retake of the week", tag: "Retake" } }
    ],

    /* ---------- MAPAS Y SETUPS ----------------------------------------------
       Pool competitivo vigente (parche 13.04 → 13.06, sept. 2026). Riot lo
       rota cada acto: para cambiarlo, quita o agrega mapas aquí.
       uuid → minimapa y banner oficiales (media.valorant-api.com).
       callouts: [zona, nombre, x %, y %] sobre el minimapa (datos oficiales).
       Cada setup: from = dónde se para Veto, to = dónde cae la habilidad.
       Puedes usar un callout ("A Main", "Mid Top"…) o coordenadas [x, y].
       Abre el sitio con ?editor y haz clic en el mapa para copiar [x, y].
       en: { title, steps } → versión en inglés (opcional; si falta se muestra en español). */
    maps: [
      {
        id: "abyss", name: "Abyss", uuid: "224b0a95-48b9-f703-1bd8-67aca101a61f",
        callouts: [["A", "Bridge", 47.0, 3.8], ["A", "Link", 30.2, 27.3], ["A", "Lobby", 77.5, 23.7], ["A", "Main", 63.4, 19.2], ["A", "Site", 48.4, 15.2], ["A", "Tower", 49.0, 25.5], ["Mid", "Bend", 58.7, 63.8], ["B", "Link", 31.0, 66.2], ["B", "Lobby", 82.6, 79.6], ["B", "Main", 62.4, 86.0], ["B", "Nest", 67.4, 90.3], ["Mid", "Bottom", 54.7, 53.2], ["B", "Site", 40.5, 85.8], ["Mid", "Catwalk", 54.3, 45.1], ["B", "Danger", 55.7, 97.4], ["Mid", "Library", 45.1, 52.6], ["A", "Secret", 18.8, 19.4], ["A", "Security", 25.9, 10.3], ["Mid", "Top", 30.8, 43.7], ["B", "Tower", 29.8, 81.8], ["A", "Vent", 47.4, 36.2]],
        setups: [
          { id: "aby-1", title: "Interceptor contra la ejecución de A Main", ability: "E", side: "def", site: "A", diff: 1, from: "A Tower", to: [56, 17],
            steps: ["Colócalo dentro del sitio, pegado a la salida de A Main y fuera de su línea de visión.", "Actívalo con la primera granada o flash que escuches.", "Re-peekea desde Tower: la ejecución entra sin utilidad."],
            en: { title: "Interceptor vs. the A Main execute", steps: ["Place it inside the site, tight to the A Main exit and out of their line of sight.", "Activate it on the first grenade or flash you hear.", "Re-peek from Tower: the execute walks in with no utility."] } },
          { id: "aby-2", title: "Asfixia en la salida de B Main", ability: "Q", side: "def", site: "B", diff: 2, from: "B Site", to: [53, 86],
            steps: ["Desde B Site, lanza el fragmento al final de B Main.", "La trampa retiene al primero que salga: queda sordo y debilitado.", "Pelea lejos del borde: en Abyss el vacío también mata."],
            en: { title: "Chokehold on the B Main exit", steps: ["From B Site, throw the fragment to the end of B Main.", "The trap holds the first one out: deafened and weakened.", "Fight away from the edge: on Abyss the void kills too."] } },
          { id: "aby-3", title: "Corte Transversal para rotar de Mid a B", ability: "C", side: "def", site: "Mid", diff: 2, from: "Mid Top", to: "B Link",
            steps: ["Deja el vórtice en B Link durante la fase de compra.", "Juega Mid Top; si B pide ayuda, mira el vórtice y actívalo.", "Llegas al retake antes de que el rival termine de plantar."],
            en: { title: "Crosscut to rotate from Mid to B", steps: ["Drop the vortex in B Link during the buy phase.", "Play Mid Top; if B calls for help, look at the vortex and activate it.", "You reach the retake before they finish planting."] } }
        ]
      },
      {
        id: "ascent", name: "Ascent", uuid: "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319",
        callouts: [["A", "Tree", 39.8, 29.5], ["A", "Lobby", 60.3, 25.9], ["A", "Main", 48.4, 20.1], ["A", "Window", 24.1, 29.2], ["A", "Site", 35.0, 14.2], ["B", "Lobby", 71.7, 67.8], ["B", "Main", 40.5, 71.2], ["B", "Boat House", 27.0, 88.7], ["Mid", "Bottom", 39.7, 49.5], ["B", "Site", 28.5, 73.7], ["Mid", "Catwalk", 52.5, 41.1], ["Mid", "Cubby", 45.5, 33.6], ["A", "Garden", 28.5, 30.9], ["Mid", "Market", 29.8, 49.7], ["Mid", "Courtyard", 49.3, 48.8], ["Mid", "Link", 51.4, 61.7], ["Mid", "Pizza", 30.6, 44.7], ["A", "Rafters", 23.9, 14.4], ["Mid", "Top", 66.5, 38.0], ["A", "Wine", 48.6, 5.8]],
        setups: [
          { id: "asc-1", title: "Interceptor contra la ejecución de A Main", ability: "E", side: "def", site: "A", diff: 1, from: "A Rafters", to: [42, 16],
            steps: ["Colócalo detrás de la caja de A Site, cubriendo la salida de A Main.", "Actívalo al escuchar la primera utilidad.", "Juega Heaven: el rival entra sin flash ni humo."],
            en: { title: "Interceptor vs. the A Main execute", steps: ["Place it behind the box on A Site, covering the A Main exit.", "Activate it when you hear the first piece of utility.", "Play Heaven: they walk in with no flash or smoke."] } },
          { id: "asc-2", title: "Asfixia en la salida de B Main", ability: "Q", side: "def", site: "B", diff: 2, from: "B Site", to: [36, 71],
            steps: ["Desde B Site, apunta al final de B Main.", "Lanza cuando suene el primer paso en el main.", "Pre-apunta la salida: el atrapado no puede moverse."],
            en: { title: "Chokehold on the B Main exit", steps: ["From B Site, aim at the end of B Main.", "Throw it on the first footstep in main.", "Pre-aim the exit: whoever's trapped can't move."] } },
          { id: "asc-3", title: "Corte Transversal en Market para rotar a B", ability: "C", side: "def", site: "Mid", diff: 1, from: "Mid Catwalk", to: "Mid Market",
            steps: ["Deja el vórtice en Market en la fase de compra.", "Juega Catwalk; si B pide ayuda, mira el vórtice y teletranspórtate.", "Llegas antes que la rotación que el rival tiene calculada."],
            en: { title: "Crosscut in Market to rotate to B", steps: ["Drop the vortex in Market during the buy phase.", "Play Catwalk; if B calls for help, look at the vortex and teleport.", "You beat the rotation they had timed."] } },
          { id: "asc-4", title: "Asfixia para el post-plant de B", ability: "Q", side: "atk", site: "B", diff: 2, from: "B Main", to: [30, 61],
            steps: ["Planta en B y retrocede a la salida de B Main.", "Lanza la trampa hacia la entrada de Market.", "El retake que venga por ahí queda inmóvil frente a tu mira."],
            en: { title: "Chokehold for the B post-plant", steps: ["Plant on B and fall back to the B Main exit.", "Throw the trap toward the Market entrance.", "Any retake through there freezes right in your crosshair."] } }
        ]
      },
      {
        id: "haven", name: "Haven", uuid: "2bee0dc9-4ffe-519b-1cbd-7fbe763a6047",
        callouts: [["A", "Garden", 74.2, 41.0], ["A", "Link", 29.0, 32.4], ["A", "Lobby", 62.4, 38.5], ["A", "Long", 57.6, 17.7], ["A", "Sewer", 50.0, 38.4], ["A", "Site", 40.2, 17.0], ["B", "Back", 29.4, 49.5], ["B", "Site", 40.1, 50.1], ["C", "Link", 34.3, 64.9], ["C", "Lobby", 66.4, 76.6], ["C", "Long", 64.4, 89.4], ["C", "Garage", 49.3, 62.9], ["C", "Window", 41.9, 64.3], ["C", "Site", 41.8, 82.1], ["C", "Cubby", 60.1, 80.2], ["Mid", "Doors", 62.4, 63.1], ["Mid", "Courtyard", 59.0, 50.6], ["Mid", "Window", 67.6, 49.6], ["A", "Tower", 30.8, 13.9]],
        setups: [
          { id: "hav-1", title: "Interceptor contra la ejecución de C Long", ability: "E", side: "def", site: "C", diff: 1, from: "C Link", to: [50, 85],
            steps: ["Colócalo en C Site, junto a la entrada de C Long.", "Actívalo con la primera utilidad de la ejecución.", "Tu Op juega el pick limpio."],
            en: { title: "Interceptor vs. the C Long execute", steps: ["Place it on C Site, next to the C Long entrance.", "Activate it on the first utility of the execute.", "Your Op gets the clean pick."] } },
          { id: "hav-2", title: "Asfixia en la salida de Garage", ability: "Q", side: "def", site: "C", diff: 2, from: "C Window", to: "C Garage",
            steps: ["Desde C Window, apunta a la puerta de Garage.", "Lanza al primer pie que suene.", "Nadie sale sordo y debilitado de ahí."],
            en: { title: "Chokehold on the Garage exit", steps: ["From C Window, aim at the Garage door.", "Throw it on the first footstep.", "Nobody leaves there without being deafened and weakened."] } },
          { id: "hav-3", title: "Corte Transversal A ↔ B para leer la rotación", ability: "C", side: "def", site: "B", diff: 2, from: "A Tower", to: "B Site",
            steps: ["Juega A con el vórtice colocado en B.", "Si el rival fakea A, teletranspórtate a B.", "Cubres dos sitios con una sola vida."],
            en: { title: "Crosscut A ↔ B to read the rotation", steps: ["Play A with the vortex placed on B.", "If they fake A, teleport to B.", "You cover two sites with one life."] } }
        ]
      },
      {
        id: "lotus", name: "Lotus", uuid: "2fe4ed3a-450a-948b-6d6b-e89a78e680a9",
        callouts: [["A", "Top", 81.8, 25.1], ["A", "Drop", 89.3, 23.3], ["A", "Site", 85.5, 36.1], ["A", "Hut", 85.5, 34.8], ["A", "Tree", 85.5, 47.5], ["A", "Door", 82.9, 51.4], ["A", "Main", 75.4, 53.7], ["A", "Rubble", 80.9, 60.1], ["A", "Root", 69.2, 60.1], ["A", "Lobby", 66.6, 72.4], ["C", "Lobby", 34.1, 81.7], ["B", "Pillars", 50.3, 66.1], ["B", "Main", 45.1, 56.7], ["C", "Door", 32.9, 57.1], ["B", "Site", 50.3, 45.9], ["A", "Link", 60.5, 48.5], ["B", "Upper", 56.4, 36.5], ["C", "Waterfall", 31.1, 43.4], ["C", "Link", 35.6, 37.7], ["A", "Stairs", 73.3, 32.3], ["C", "Mound", 34.1, 64.0], ["C", "Main", 22.8, 53.5], ["C", "Bend", 7.5, 51.0], ["C", "Site", 14.8, 43.7], ["C", "Hall", 14.8, 34.9], ["C", "Gravel", 32.9, 27.4]],
        setups: [
          { id: "lot-1", title: "Interceptor contra la ejecución de A Main", ability: "E", side: "def", site: "A", diff: 1, from: "A Stairs", to: [81, 45],
            steps: ["Colócalo en A Site, entre Tree y la salida de A Main.", "Actívalo con la primera granada.", "El rival entra sin utilidad a tu crossfire."],
            en: { title: "Interceptor vs. the A Main execute", steps: ["Place it on A Site, between Tree and the A Main exit.", "Activate it on the first grenade.", "They walk into your crossfire with no utility."] } },
          { id: "lot-2", title: "Asfixia en la salida de C Main", ability: "Q", side: "def", site: "C", diff: 2, from: "C Site", to: [21, 50],
            steps: ["Desde C Site, apunta al final de C Main.", "Lanza al primer contacto.", "Tradea con tu segundo jugador desde Hall."],
            en: { title: "Chokehold on the C Main exit", steps: ["From C Site, aim at the end of C Main.", "Throw it on first contact.", "Trade with your second player from Hall."] } },
          { id: "lot-3", title: "Corte Transversal en A Link para rotar desde B", ability: "C", side: "def", site: "A", diff: 2, from: "B Site", to: "A Link",
            steps: ["Juega B con el vórtice en A Link.", "Cuando A pida ayuda, teletranspórtate.", "Te ahorras la puerta giratoria y el ruido."],
            en: { title: "Crosscut in A Link to rotate from B", steps: ["Play B with the vortex in A Link.", "When A calls for help, teleport.", "You skip the rotating door and its noise."] } },
          { id: "lot-4", title: "Evolución para el retake de A", ability: "X", side: "def", site: "A", diff: 3, from: "A Link", to: "A Site",
            steps: ["Junta el retake con tu equipo en A Link.", "Activa Evolución antes de cruzar.", "Inmune a los debuffs: la utilidad post-plant ya no te frena."],
            en: { title: "Evolution for the A retake", steps: ["Group up for the retake with your team in A Link.", "Pop Evolution before you cross.", "Immune to debuffs: post-plant utility can't slow you down."] } }
        ]
      },
      {
        id: "split", name: "Split", uuid: "d960549e-485c-e861-8d71-aa9d1aed12a2",
        callouts: [["A", "Back", 22.9, 12.5], ["A", "Lobby", 65.0, 16.6], ["A", "Main", 49.2, 20.8], ["A", "Rafters", 35.4, 27.4], ["A", "Ramps", 47.2, 36.0], ["A", "Screens", 15.0, 25.7], ["A", "Sewer", 65.8, 31.8], ["A", "Site", 31.5, 18.4], ["A", "Tower", 31.6, 33.6], ["B", "Alley", 21.3, 78.8], ["B", "Back", 26.4, 94.0], ["B", "Link", 65.7, 70.0], ["B", "Garage", 54.2, 86.8], ["B", "Rafters", 36.9, 74.7], ["B", "Site", 35.4, 86.7], ["B", "Stairs", 31.5, 61.5], ["B", "Tower", 43.0, 68.4], ["B", "Lobby", 68.7, 79.7], ["Mid", "Bottom", 61.6, 54.8], ["Mid", "Mail", 46.7, 60.7], ["Mid", "Top", 48.4, 54.0], ["Mid", "Vent", 42.6, 45.1]],
        setups: [
          { id: "spl-1", title: "Interceptor contra la ejecución de A Main", ability: "E", side: "def", site: "A", diff: 1, from: "A Screens", to: [40, 20],
            steps: ["Colócalo en A Site, a la vuelta de la salida de A Main.", "Actívalo con la primera utilidad.", "Juega Screens: la ejecución llega a pelo."],
            en: { title: "Interceptor vs. the A Main execute", steps: ["Place it on A Site, just around the corner from the A Main exit.", "Activate it on the first utility.", "Play Screens: the execute arrives naked."] } },
          { id: "spl-2", title: "Asfixia en la salida de B Main", ability: "Q", side: "def", site: "B", diff: 2, from: "B Site", to: [47, 86],
            steps: ["Desde B Site, apunta al final de B Main.", "Lanza cuando escuches la ejecución.", "Castiga al atrapado desde Back."],
            en: { title: "Chokehold on the B Main exit", steps: ["From B Site, aim at the end of B Main.", "Throw it when you hear the execute.", "Punish whoever's trapped from Back."] } },
          { id: "spl-3", title: "Corte Transversal en B Stairs para rotar desde Mid", ability: "C", side: "def", site: "Mid", diff: 2, from: "Mid Vent", to: "B Stairs",
            steps: ["Deja el vórtice en B Stairs en la fase de compra.", "Juega Mid Vent.", "Si cae B, teletranspórtate y entra por Heaven."],
            en: { title: "Crosscut on B Stairs to rotate from Mid", steps: ["Drop the vortex on B Stairs during the buy phase.", "Play Mid Vent.", "If B falls, teleport and come in through Heaven."] } }
        ]
      },
      {
        id: "summit", name: "Summit", uuid: "756da597-416b-c0f2-f47b-afbdf28670bc",
        callouts: [["Mid", "Bottom", 48.4, 41.6], ["Mid", "Top", 53.7, 67.7], ["A", "Lobby", 69.4, 74.1], ["A", "Main", 69.4, 56.6], ["A", "Garden", 79.2, 40.3], ["A", "Site", 91.7, 40.3], ["A", "Art", 79.2, 26.5], ["A", "Cave", 95.7, 26.5], ["A", "Hall", 69.2, 26.5], ["A", "Link", 65.1, 36.0], ["B", "Lobby", 28.9, 59.5], ["Mid", "Window", 48.4, 32.6], ["B", "Gym", 28.0, 19.0], ["B", "Trophy", 32.3, 29.8], ["B", "Tower", 15.6, 21.6], ["B", "Drop", 5.3, 24.0], ["B", "Site", 15.1, 33.8], ["B", "Link", 33.1, 41.6], ["Mid", "Fountain", 51.1, 55.3], ["Mid", "Bend", 63.6, 49.3], ["Mid", "Tiles", 36.5, 60.7], ["B", "Main", 18.6, 49.1]],
        setups: [
          { id: "sum-1", title: "Interceptor contra la ejecución por A Garden", ability: "E", side: "def", site: "A", diff: 1, from: "A Cave", to: [86, 41],
            steps: ["Colócalo en A Site, del lado de Garden.", "Actívalo con la primera utilidad.", "Juega Cave: entran sin nada."],
            en: { title: "Interceptor vs. the execute through A Garden", steps: ["Place it on A Site, on the Garden side.", "Activate it on the first utility.", "Play Cave: they walk in with nothing."] } },
          { id: "sum-2", title: "Asfixia en la salida de B Main", ability: "Q", side: "def", site: "B", diff: 2, from: "B Site", to: [17, 43],
            steps: ["Desde B Site, apunta al final de B Main.", "Lanza al primer contacto.", "Tradea desde Tower."],
            en: { title: "Chokehold on the B Main exit", steps: ["From B Site, aim at the end of B Main.", "Throw it on first contact.", "Trade from Tower."] } },
          { id: "sum-3", title: "Corte Transversal en B Link para rotar desde Mid", ability: "C", side: "def", site: "Mid", diff: 2, from: "Mid Window", to: "B Link",
            steps: ["Deja el vórtice en B Link.", "Juega Mid Window.", "Si B pide ayuda, llegas en un segundo."],
            en: { title: "Crosscut in B Link to rotate from Mid", steps: ["Drop the vortex in B Link.", "Play Mid Window.", "If B calls for help, you're there in a second."] } }
        ]
      },
      {
        id: "sunset", name: "Sunset", uuid: "92584fbe-486a-b1b2-9faa-39b0f486b498",
        callouts: [["B", "Boba", 12.6, 34.4], ["Mid", "Tiles", 53.1, 65.6], ["B", "Market", 23.5, 53.1], ["B", "Site", 11.5, 42.0], ["B", "Main", 5.9, 67.2], ["B", "Lobby", 29.7, 78.1], ["Mid", "Bottom", 34.2, 65.6], ["Mid", "Courtyard", 40.6, 56.2], ["A", "Lobby", 65.6, 65.6], ["A", "Main", 67.2, 54.7], ["A", "Link", 73.4, 34.4], ["A", "Site", 82.0, 38.0], ["A", "Elbow", 82.8, 50.0], ["A", "Alley", 78.1, 25.0], ["Mid", "Top", 34.4, 36.0]],
        setups: [
          { id: "sun-1", title: "Interceptor contra la ejecución de B Main", ability: "E", side: "def", site: "B", diff: 1, from: "B Boba", to: [10, 50],
            steps: ["Colócalo en B Site, pegado a la salida de B Main.", "Actívalo con la primera utilidad.", "Juega Boba: el rival entra sin flash."],
            en: { title: "Interceptor vs. the B Main execute", steps: ["Place it on B Site, tight to the B Main exit.", "Activate it on the first utility.", "Play Boba: they walk in with no flash."] } },
          { id: "sun-2", title: "Asfixia en la salida de A Main", ability: "Q", side: "def", site: "A", diff: 2, from: "A Site", to: [71, 50],
            steps: ["Desde A Site, apunta al final de A Main.", "Lanza al primer paso que suene.", "El atrapado queda frente a tu mira."],
            en: { title: "Chokehold on the A Main exit", steps: ["From A Site, aim at the end of A Main.", "Throw it on the first footstep you hear.", "Whoever's trapped is stuck right in your crosshair."] } },
          { id: "sun-3", title: "Corte Transversal en B Market para rotar desde Mid", ability: "C", side: "def", site: "Mid", diff: 2, from: "Mid Top", to: "B Market",
            steps: ["Deja el vórtice en Market en la fase de compra.", "Juega Mid Top.", "Si B cae, teletranspórtate al retake."],
            en: { title: "Crosscut in B Market to rotate from Mid", steps: ["Drop the vortex in Market during the buy phase.", "Play Mid Top.", "If B falls, teleport to the retake."] } }
        ]
      }
    ]
  };
})();
