# CLAUDE.md — Vaca Viewer

Visor web de pozos y pads no convencionales (plug-and-perf). 100% navegador, **offline**, los datos
**nunca salen del equipo**. Autor: Gonzalo Carvallo (@gonzacarv). Versión actual: **v0.5**.

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
build.py             empaqueta src/*.js + styles.css → dist/index.html (libs por CDN → necesita servidor+internet).
build_dist.py        dist/vaca-viewer.html: single-file 100% OFFLINE (three UMD+xlsx+pdf.js+worker+jsPDF embebidos).
build_pad.py         parsers de survey/tally/fracplan en Python (paridad con los del navegador).
docs/data-schema.md  formato del pad (JSON). docs/archivos-input.md  qué debe cumplir cada .xlsx/.pdf de ingesta.
docs/plantillas/     .xlsx modelo (survey/fracplan/tally) + gen_plantillas.py. docs/brand-kit.md  marca.
```

### build.py / build_dist.py (bundles)
Envuelven cada módulo en un IIFE con `exports` y exponen cada símbolo como **getter**
(`Object.defineProperty`), replicando las live-bindings ES (clave para que export3d lea el PAD/flags
actuales). Inlinan el CSS. `dist/` y `vendor/` están en `.gitignore`.
- **build.py**: un `import * as THREE` + libs por CDN + `type=module` → requiere HTTP e internet.
- **build_dist.py** (release/distribución): three como **UMD global** (sin `import`, sin `type=module`),
  worker de pdf.js vía Blob desde el fuente inlineado; libs cacheadas en `vendor/` (descarga de cdnjs
  al compilar si faltan). Chequea que no quede NINGUNA dependencia de red. Abre con doble-click (file://).

### Dependencias
three, xlsx (SheetJS), pdf.js, jsPDF. En dev van por CDN; `build_dist.py` las **embebe**. Space Grotesk
ya está embebida en styles.css. Isotipo y favicon = **SVG inline**.

## Formato de datos

- Extensión propia **`.vvwp`** (constante `PAD_EXT` en viewer.js). Contenido = JSON del schema; la
  lectura es por contenido, así que abre `.vvwp`/`.vvw`/`.json` indistintamente.
- `schema_version:1`. Profundidades en **metros**, diámetros en **pulgadas**, coords locales al pad
  (x=E/O, y=N/S, z=TVD↓). `survey` y `frac` son opcionales (sin survey → vertical sintético).
- Fases de casing (externa→interna): `guia`(13⅜) → `intermedia1`(9⅝) → `intermedia2`(7⅝) →
  `produccion`(5", aislación). Spec completa en `docs/data-schema.md`.
- **`stage.plan`** (opcional, de la hoja *Resumen* del fracplan): `sand_t, fluid_m3, prop_int_lbft,
  fluid_int_m3m, length_m, wl`. Habilita la Vista de pozo "Fracplan" y el "cursor frac".
- **`casing.segments`** (opcional): casing telescopado — tramos `{top_md,bottom_md,od_in,weight_ppf,
  grade}`. shoe/od/peso/grado "resumen" = tramo más profundo; cada xover se etiqueta en 3D.
- Los samples reales van en `samples/` (gitignored). No commitear data operativa.

## Vista de pozo (isoMode) e ingesta — v0.5

- **isoMode** (panel "Vista de pozo"): `normal`(Cañería) · `fracplan`(intensidad de arena `prop_int_lbft`,
  rampa verde→rojo auto-normalizada a pozos visibles) · `stages`(par de colores configurable, `STAGE_PAIRS`)
  · `dogleg_lateral|build|total`. El coloreo se aplica al tubo de `produccion` en `applyIsoColors`.
- **Cursor**: "cursor slim" (MD/TVD/dogleg) + "cursor frac" dependiente (agrega AS/Fluido/LongEt/PropInt/
  FluidInt/WL de la etapa en hover).
- **Ingesta** (parsers en `viewer.js` + gemelos en `build_pad.py`, MISMA lógica): survey `.xlsx`,
  fracplan `.xlsx` (`Punzados` posición fija + `Resumen` por grupo de etapas), tally `.pdf` (Run Tally de
  OpenWells/Landmark) **o** `.xlsx` (una solapa, todas las fases, con telescopado desde/hasta MD).
  **Las filas OCULTAS del Excel se ignoran** (dato borrado, ej. "etapa 29"). Ver `docs/archivos-input.md`
  y [[ingestor-filas-ocultas]].
- **Exportar ingesta**: botón ⤓ por pozo (Survey/Fracplan/Tally) → `.xlsx` con formato de plantilla y los
  datos cargados, editable y recargable (`surveyAOA`/`fracplanSheets`/`tallyAOA` + `dlXlsx`).
- **Planos envolventes**: la "espalda" (grilla de profundidad) se ubica siempre detrás de los heels según
  la orientación dominante del lateral (`lateralAxisInfo`); el plano lateral sigue a la cámara.

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
- Tras cambios: `python3 build.py` y confirmar que el bundle pasa `node --check`. Para release offline:
  `python3 build_dist.py` (chequea que no queden dependencias de red).
- Ingesta: validar los parsers Python contra los `.xlsx` reales de `samples/` y contra `docs/plantillas/`
  (round-trip). La verificación **visual** siempre la hace el usuario en el navegador (`python3 -m http.server`).
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
