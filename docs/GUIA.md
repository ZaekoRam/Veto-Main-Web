# Veto Main — Hub de Veto (VALORANT)

Landing/portafolio estático: HTML + CSS + JavaScript, sin frameworks ni build. Se sube tal cual a Hostinger, Netlify, Vercel o cualquier hosting estático.

Estética tomada de las referencias oficiales de Veto: negro puro, **teal profundo + cian + verde lima** (la utilidad enemiga va en **rojo**), tipografía **Space Mono**, el arte oficial "VETO" apilado de la selección de agente, texto que se "descifra" (scramble), transiciones de **tinta líquida** y un Veto 3D vivo.

## Estructura

```
index.html            ← estructura y textos fijos
styles.css            ← diseño (tokens y curvas de animación al inicio)
main.js               ← UI: navbar, scramble, reveals, HUD del Interceptor, kit, mapas/setups, clips
lib/manifest.js       ← ★ TU CONTENIDO: redes, clips, mapas y setups, ajustes del 3D
lib/i18n.js           ← traducción al inglés (botón ES/EN de la barra)
lib/veto-stage.js     ← escenario 3D: Veto (poses, resortes, gestos), efectos de habilidades, Interceptor, bloom
lib/three.min.js      ← Three.js r147 + GLTFLoader + RoomEnvironment (locales)
lib/meshopt_decoder.js← descompresor del modelo oficial (meshoptimizer, MIT)
assets/models/        ← veto-cs.glb (modelo oficial con su animación, 0.9 MB), veto-base.glb y veto-ult.glb (~2.4 MB c/u)
assets/models/util/   ← modelos oficiales de la utilidad enemiga que rompe el Interceptor (~1.2 MB en total)
.htaccess             ← caché y tipos MIME para Hostinger/Apache (incluye .glb)
```

## Orden de la página

1. **Hero**: el modelo oficial de Veto de la selección de agente con su animación "idle" del juego (la misma de tracker.gg), con el arte "VETO" oficial detrás.
2. **Interceptor**: secuencia fija mientras bajas. El orbe (como en el juego: esfera azul jaspeada envuelta por garras negras con filo dorado) llega y se activa. Las 6 utilidades enemigas llegan de una en una con su nombre: el rayo ondulado las atrapa, se cristalizan y estallan en cristales cian con chispas eléctricas. La utilidad usa los modelos oficiales del juego: Paint Shell, Flashdrive, Recon Bolt, cuchillo de Zero/point, Incendiary y Owl Drone. El scroll controla todo: si subes, el tiempo va hacia atrás.
3. **Habilidades**: Veto en 3D a la izquierda y la lista a la derecha. Con la sección en pantalla Veto usa sus habilidades solo, en orden (C, Q, E, X); un clic en una habilidad o las teclas `C` `Q` `E` `X` la eligen y pausan la demo unos segundos.
4. **Setups por mapa**: los 7 mapas del pool competitivo con su minimapa oficial.
5. **Clips y redes**, footer.

## Qué hace Veto

**En el inicio** se usa el modelo oficial de selección de agente (`veto-cs.glb`) con su animación "idle" del juego (15 s en bucle). La forma **Evolución** copia esa animación hueso a hueso (retarget), así que el spotlight y la transformación quedan alineados aunque sean modelos distintos.

**En el kit** se usan los modelos en T-pose (`veto-base.glb` / `veto-ult.glb`) animados en tiempo real: cada hueso sigue su pose con un **resorte** propio (inercia, rebote y follow-through), así que nada se mueve "en bloque".

| Dónde | Qué pasa |
|---|---|
| Hero | La animación oficial, y además te sigue con la mirada. Pasa el mouse sobre él: el spotlight revela su forma **Evolución**. Arrastra para girarlo (vuelve solo). |
| Hero · botón *Evolución*, clic o `X` | Como en la animación de selección de agente: un dron enemigo se le acerca, Veto lo mira, el dron le dispara y explota en un destello naranja, y de la explosión sale en **Evolución** con el puño en alto y energía cian. En Evolución, `X` = vuelve a alzar el puño. |
| Kit | Respira, cambia el peso de pierna y mira a su alrededor; las venas del brazo mutado laten. |
| Kit · `C` Corte Transversal | Lanza el vórtice, lo mira, chasquea los dedos, **se disuelve en partículas** y se rematerializa en el vórtice con una columna de luz. |
| Kit · `Q` Asfixia | Arranca un fragmento de su mutación, lo lanza con el brazo mutado y brota una trampa de púas; al activarse se cierran con ondas que "ensordecen". |
| Kit · `E` Interceptor | Lanza el orbe, le muestra la palma para activarlo y su campo destruye una granada y una flash con el rayo. |
| Kit · `X` Evolución | Recoge el puño, lo dispara al cielo y la mutación se extiende desde la mano mientras brotan púas del suelo. En Evolución, `X` = rugido. |

Ajustes finos en `lib/veto-stage.js`:
- Modelo oficial y transformación del inicio: bloque "VETO OFICIAL (hero)" (`HX_FIST` es la pose del puño).
- Poses del kit: bloque "Poses" (`def("READY_BASE", …)` etc., valores en radianes).
- Tiempos de cada habilidad: bloque "Acciones".
- Secuencia del Interceptor: `IX_SHOTS`. El largo del scroll se cambia en `styles.css` → `.ix { height: 480vh }`.
- Brillo de los efectos: `stage.bloom` en `manifest.js` (0 = sin bloom).

## Mapas y setups — `lib/manifest.js → maps`

- El pool incluido es el competitivo vigente: **Abyss, Ascent, Haven, Lotus, Split, Summit y Sunset** (parche 13.04 a 13.06, septiembre 2026). Riot lo rota cada acto: para cambiarlo, quita o agrega mapas en `maps`.
- Cada mapa usa su `uuid` para cargar el **minimapa y el banner oficiales** desde `media.valorant-api.com`. `callouts` trae los nombres oficiales con su posición en el minimapa.
- Cada setup tiene `from` (dónde se para Veto) y `to` (dónde cae la habilidad). Puedes escribir un callout (`"A Main"`, `"Mid Top"`…) o coordenadas `[x, y]` en %.
- **Modo editor:** abre `http://localhost:8765/?editor` y haz clic en el minimapa para copiar coordenadas `[x, y]`.
- `video`: un link de YouTube o un `.mp4` propio se muestra debajo de los pasos.
- Los setups incluidos son de ejemplo: reemplázalos por los tuyos.

Para agregar un mapa nuevo: busca su `uuid` y sus callouts en `https://valorant-api.com/v1/maps`.

## Verlo en tu PC

Los `.glb` **no cargan con doble clic en `index.html`** (el navegador bloquea `file://`); el resto sí, incluida la secuencia del Interceptor. Para todo el 3D:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

y abre `http://localhost:8765`.

## Editar contenido (sin tocar HTML) — `lib/manifest.js`

| Qué | Dónde |
|---|---|
| Handles, URLs, seguidores, horario, **EN VIVO** | `socials` (`live: true` enciende el punto rojo del botón Twitch) |
| Clips | `clips`: `platform` + `id` para reproducir dentro del sitio, `src` para un `.mp4` propio, `thumb` para miniatura |
| Mapas y setups | `maps` (ver arriba) |
| Modelos, exposición, bloom | `stage` |

**IDs de clips:** Twitch = slug del clip (el embed necesita dominio real); YouTube = ID del video; TikTok = número del video. X no permite embeber: el reproductor muestra un botón a la publicación.

## Modelos 3D

- Reemplaza los `.glb` en `assets/models/` (o cambia las rutas en `manifest.js → stage`). Ambos deben **compartir esqueleto y pose**.
- `stage.armsDown` baja los brazos del T-pose (grados). Ponlo en `0` si tu modelo ya viene en pose.
- Optimizar un `.glb` nuevo:
  ```bash
  npx @gltf-transform/cli optimize entrada.glb salida.glb --texture-compress webp --simplify false --compress false
  ```
- Consola del navegador: `VetoStage.setForm("ult")`, `VetoStage.play("Q")`.

## Imágenes oficiales

El arte "VETO" del hero y del footer, los íconos de habilidades, los minimapas y los banners de mapas se cargan desde `media.valorant-api.com` (la API comunitaria que sirve los recursos del juego). Si algún día quieres que todo viva en tu hosting, descarga esas imágenes a `assets/img/` y cambia las URLs (en `index.html`, `styles.css` y `main.js` → `MEDIA`).

## Idiomas (español / inglés)

- El botón **EN / ES** de la barra cambia el idioma y lo recuerda. También sirve `?lang=en` o `?lang=es` en la URL. Si el visitante no ha elegido, se usa el idioma de su navegador.
- Los textos fijos están en español en `index.html` y en inglés en `lib/i18n.js` (busca la clave de `data-i18n`).
- En `manifest.js`, cada setup o clip puede llevar `en: { title, steps }` / `en: { title, tag }`. Si no lo pones, se muestra en español.

## Celular y rendimiento

- En pantallas táctiles el 3D se dibuja a menos resolución; si aun así va lento, baja la resolución por pasos y al final apaga el brillo (bloom).
- Los shaders de los efectos se preparan al cargar para que no haya tirones la primera vez que aparecen.
- El 3D se pausa cuando no está en pantalla o la pestaña está oculta.

## Subir a Hostinger

La carpeta `public_html/` (y `public_html.zip`) ya trae solo lo necesario, con `.htaccess` incluido.

1. hPanel → **Administrador de archivos** → entra a `public_html`.
2. Sube `public_html.zip` y usa **Extraer** ahí mismo (o sube el contenido de la carpeta `public_html/`). `index.html` debe quedar directamente en `public_html`, no dentro de otra carpeta.
3. Si tu dominio tiene SSL, activa **Forzar HTTPS** en hPanel.
4. En cada actualización cambia el `?v=…` de `index.html` y vuelve a generar la carpeta y el zip con:
   ```bash
   python build_public_html.py
   ```

## Créditos y licencias (no los quites)

- Modelos: "Veto (T-pose)" y "Veto (Ult Form) (T-pose)" por **BojanV06** (Sketchfab), **CC BY 4.0** (atribución en el footer).
- Modelo y animación de selección de agente: Riot Games (tomados del CDN de tracker.gg). Decodificador: meshoptimizer (MIT).
- Modelos de utilidad (`assets/models/util/`): Riot Games, vía el visor de Kingdom Archives.
- Proyecto de fans bajo la política "Legal Jibber Jabber" de Riot Games (aviso en el footer). Arte, íconos y minimapas: Riot Games, vía valorant-api.com.
- Datos de habilidades: wiki oficial de VALORANT (parche 13.01). Pool de mapas: notas del parche 13.04 (18.08.2026), sin cambios en 13.05 y 13.06.
- Referencias visuales: tráiler "NO LES DEN NADA", presentación de jugabilidad y short de habilidades del canal oficial de VALORANT; retrato oficial de Veto; animación de selección de agente (video de MetaSCREAM en YouTube).
