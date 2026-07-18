# CLAUDE.md — Vaca Viewer

Visor web de pozos y pads no convencionales (plug-and-perf). 100% navegador, **offline**, los datos
**nunca salen del equipo**. Autor: Gonzalo Carvallo (@gonzacarv). Versión actual: **v0.4**.

## Arquitectura

Módulos ES, sin framework ni bundler. Se sirve por HTTP (usa `import` + importmap + `fetch`).

```
index.html          shell: markup + importmap(three) + <link styles.css> + <script type=module src=src/main.js>
src/
  viewer.js  (~1900) TODA la app base: escena 3D/tick, buildPad, etiquetas, árbol de capas/toggles,
                     cámara+viewcube+medir, loader, persistencia (IndexedDB + localStorage), ingesta
                     (parsers survey/tally/fracplan en navegador) y constructor de pad.
                     Exporta (live-bindings ES) lo que usan los módulos de export: scene, renderer,
                     camera, sph, target, world, gridGroup, axes, wellObjects, LABELS, VIS, PAD,
                     isoMode, vexag, diamExag, plugCountInverted, buildPad, setView, frameAll,
                     interpAtMD, fmtOD, casingRadius, setDiamExagForExport, parseStages, SHOW_*…
  export3d.js        captura de la Vista 3D (fondo blanco/oscuro, tema claro/B&N, escala, presets de
                     cámara, compositado de etiquetas HTML sobre el canvas) → PNG/JPG/PDF.
  export2d.js        corte transversal de pozo (esquema oil&gas en SVG) → PNG/JPG/PDF.
  export-ui.js       cablea la sección Exportar (tabs, preview, sliders, zoom, drag de cajas).
  util.js            helpers puros: saveDataURL, rasterizeSVG, canvasToFile, canvasToPDF, color.
  main.js            bootstrap: importa viewer + initExport().
  styles.css         estilos (incluye @font-face Space Grotesk embebida como data-URI, línea 1-2).
build.py             empaqueta src/*.js + styles.css → dist/index.html (single-file offline).
build_pad.py         parsers de survey/tally/fracplan en Python (paridad con los del navegador).
docs/data-schema.md  formato del pad (JSON). docs/brand-kit.md  sistema de marca portable.
```

### build.py (bundle offline)
Envuelve cada módulo en un IIFE con `exports` y expone cada símbolo como **getter**
(`Object.defineProperty`), replicando exactamente las live-bindings ES (clave para que export3d lea el
PAD/flags actuales). Un solo `import * as THREE`. Inlina el CSS. `dist/` está en `.gitignore`.

### Dependencias (CDN en dev, a embeber en release)
three (importmap), xlsx (SheetJS), pdf.js, jsPDF. La fuente Space Grotesk **ya está embebida** en
styles.css. El isotipo y favicon son **SVG inline** (sin assets externos).

## Formato de datos

- Extensión propia **`.vvwp`** (constante `PAD_EXT` en viewer.js). Contenido = JSON del schema; la
  lectura es por contenido, así que abre `.vvwp`/`.vvw`/`.json` indistintamente.
- `schema_version:1`. Profundidades en **metros**, diámetros en **pulgadas**, coords locales al pad
  (x=E/O, y=N/S, z=TVD↓). `survey` y `frac` son opcionales (sin survey → vertical sintético).
- Fases de casing (externa→interna): `guia`(13⅜) → `intermedia1`(9⅝) → `intermedia2`(7⅝) →
  `produccion`(5", aislación). Spec completa en `docs/data-schema.md`.
- Los samples reales van en `samples/` (gitignored). No commitear data operativa.

## Corte 2D (export2d.js) — REGLAS DE DISEÑO (no romper)

El usuario rechazó explícitamente seguir el survey real. Ver [[corte-2d-estilo-canonico]] en memoria.
- **Camino CANÓNICO** parametrizado por MD: tronco vertical + **cuarto de círculo agresivo** (radio
  Rm = clamp(8% TVD landing, 120–300 m), arranca donde TVD = tvdLand−Rm) + lateral horizontal. NO se
  sigue la trayectoria punto a punto. Sin líneas de "juntas" en el arco.
- Cañerías: paredes negras gruesas + interior blanco (telescopio). Cemento: patrón punteado del
  anular TOC→zapato. Zapatos: triángulos macizos hacia afuera, **tamaño fijo** (no proporcional al Ø).
  Tapones: bloque negro fino. Packers: 2 bloques por fuera del TBG. Punzados: "dientes" esquemáticos
  (NO 1:1 con los tiros). TBG con cartel propio (MD/TVD).
- Etiquetas: en el lateral SOLO los tapones (y N° de etapa sobre el caño) van rotados −90° por encima;
  TODO lo demás (TOC, TBG, PKR, zapatos, caños cortos, shoetrack) va en cajas horizontales — tronco/
  arco a la columna derecha, lateral flotando sobre el caño. Nunca solaparse ni tapar el pozo; el
  lienzo crece para contenerlas (incluye corrimiento anti-desborde superior vía `<g translate>`).
- Preview: zoom rubber-band (arrastrar rect / click resetea) y cajas arrastrables (el export usa el
  SVG del DOM para conservar cajas movidas).
- Sliders/opts: cx/cy (aspecto), margin (borde blanco extra alrededor), diam (Ø cañería), elw (ancho
  tpn/pkr), shoe (tamaño zapato), font, perfStages (filtro de etapas a punzar), rango desde/hasta,
  tema color|dogleg|bw, checkboxes por elemento.
- Temas: `color` = banda de etapa + N° blanco; `dogleg` = interior pintado por DLS (rampa verde→
  amarillo→rojo de la Vista 3D, auto-normalizada al máx del rango visible, con leyenda de escala) y
  etapas SOLO N° con halo blanco (sin banda); `bw` = solo N° en tinta. Punzados: misma geometría en
  los 3 temas (color de etapa en color/dogleg, tinta en bw). Caños cortos: cartel horizontal —
  desc/detalle + `5,87m - @2490m MD` (longitud 2 decimales con COMA, sin "L" ni "desde"). Shoetrack:
  UNA sola caja "Shoetrack" que lista sus componentes línea por línea con ese mismo formato
  (compacta, arrastrable entera).
- Regla de extensión (MD, opcional `els.extruler`): línea horizontal DEBAJO del esquema, pegada al
  pozo (justo bajo los dientes), del tope del cluster más somero a TD, con el mismo mapeo `P(md).x`
  del lateral (ticks alineados con tapones y demás elementos). No aplica a pozos verticales.

## Marca

Isotipo = rounded-square con fondo de la app (se funde), roca slate `#18212e`, trayectoria en trazo
claro `#d7e0e8`, wellhead ámbar `#e3a94c`. Wordmark "vaca viewer" (vaca 700 + viewer 400, Space
Grotesk, minúsculas). Sistema completo en `docs/brand-kit.md` y en un proyecto de Claude Design
(ver memoria [[marca-design-project]]). Paleta base en `:root` de styles.css.

## Cómo trabajar / verificar

- **No hay navegador headless** en este entorno. Verificar con: `node --check` de cada módulo y del
  bundle; y un harness node que stubbea `./viewer.js` (con `interpAtMD`, `escHtml`, `fmtOD`,
  `plugCountInverted`, `parseStages`) para ejecutar `buildWellSVG` contra un pad y chequear que el SVG
  sea XML bien formado, sin `NaN/undefined`, y que cajas/etiquetas no se salgan del lienzo.
- Tras cambios: `python3 build.py` y confirmar que el bundle pasa `node --check`.
- La verificación **visual** siempre la hace el usuario en el navegador (`python3 -m http.server`).
- Convenciones: mantener todo **self-contained/offline**; reusar los helpers exportados por viewer.js
  en vez de reimplementar; respetar las reglas del corte 2D de arriba.

## Cómo pedir cambios (subsistemas)

Para conversaciones focalizadas y eficientes, agrupar pedidos por **subsistema** (cada uno toca
básicamente un archivo y un modelo mental):
1. **Export 2D — corte de pozo** (`export2d.js`): geometría, símbolos, coloreo, reglas, etiquetas.
2. **Export 3D — captura** (`export3d.js`): vistas, tema, resolución, realce/transparencia por pozo.
3. **Vista 3D — escena** (`viewer.js`): cámara, capas, medición, coloreo isoMode/dogleg en vivo.
4. **Datos / ingesta / formato** (`viewer.js` parsers + `build_pad.py` + `data-schema.md`): parsing,
   numeración de etapas, schema.
5. **UI general / marca** (`styles.css`, `index.html`): layout, estilos, branding.
Empezar cada conversación nombrando el subsistema y adjuntando captura de esa área.
