# Integración con Corva

Solapa **Datos → Corva**: elegís un PAD de tu cuenta y la app arma el pad desde Corva. Las credenciales
se cargan en **Configuración → Conexión a Corva**. Código: `src/corva.js` (cliente y conversión, sin
DOM) y `src/corva-ui.js` (pantallas).

## Privacidad y credenciales

- El navegador habla **directo con Corva**, sin servidores intermedios. Solo hay red cuando usás esta
  función; el resto de la app sigue funcionando offline.
- Solo lectura: a Corva únicamente se le hacen `GET`, más `POST /v1/user_token` para el login y la
  renovación del token.
- La contraseña **no se guarda**. Con "Recordar la sesión" quedan el mail y los tokens en `localStorage`
  (clave `vv-corva-v1`). Sin esa opción viven en memoria hasta cerrar la pestaña.
- `localStorage` no está cifrado. Si la app se abre desde `file://`, otras páginas locales abiertas en el
  mismo navegador pueden llegar a leerlo: no recordar la sesión en una PC compartida.
- Ni los tokens ni los costos (`total_cost`) entran en el `.vvwp`.

## Por qué esta ruta de datos

| Ruta | Datos | CORS desde `file://` o `localhost` |
|---|---|---|
| `https://data.corva.ai/api/v1/data/corva/<dataset>/` | Sí | **No** (`Disallowed CORS origin`) |
| `https://api.corva.ai/v1/data/corva/<dataset>` | Sí | **No** |
| `https://api.corva.ai/api/core/v1/data/corva/<dataset>` | Sí | **Sí** (`Access-Control-Allow-Origin: *`) |

La app usa la tercera (`DATA` en `corva.js`), que no necesita servidor ni proxy. Relevado el 2026-10-30.

**Riesgo:** el swagger de Corva marca esta ruta como *deprecated, kept only for backward compatibility*.
Si la retiran, los datos solo se podrían leer con un proxy local, o pidiéndole a Corva que habilite el
origen. El login y la lista de PADs no dependen de ella.

Esta ruta se comporta distinto de `data.corva.ai`:

- `asset_id` va como parámetro propio. `query` en JSON responde 400.
- `sort` va **sin comillas**: `{timestamp: -1}`. Con JSON válido (`{"timestamp":-1}`) responde 200 pero
  **ignora el orden**.

## De Corva al pad

Corva está en unidades de campo; todo se convierte a metros (`ft × 0,3048`). DLS: de °/100 ft a °/30 m.

| Pad | Fuente | Notas |
|---|---|---|
| Lista de PADs | `GET /v2/pads?per_page=1000` | Se ocultan los `Viewer - …` y dos PADs técnicos (`HIDDEN_PAD_IDS`): sus datos están en los pozos reales |
| Pozos, boca | `GET /v2/pads/{id}/wells` → `lon_lat` | Se omiten los `is_asset_viewer`. Offsets en metros respecto del primer pozo |
| `well.id` | `name` del pozo | `OPE.Xx.ABC-1234(h) ST01` → `ABC-1234h ST01`. `well.name` conserva el original |
| `survey` | `data.actual_survey` | De todos los registros vale **el más profundo**, y a igual fondo el más nuevo |
| `casings` | `data.casing` | Fase según el OD: ≥11" guía · ≥8,5" int. 1 · ≥6,5" int. 2 · resto aislación. Dos 7⅝": el más profundo es aislación. OD encajado al estándar (7.62 → 7.625) |
| `casing.segments` | `data.casing.components` | Tramos ubicados desde el zapato. Ver "Tramos" |
| `shoetrack` | `data.casing.components` | Piezas finales desde el zapato hacia arriba, hasta la columna de tiros o 150 m. **Posición inferida** de las longitudes |
| `short_joints` | `completion.casing-tally`, `completion.ccl-collars`, `data.casing.components` | En ese orden; `source` dice de cuál salió. Ver "Caños cortos" |
| `frac.stages` | `completion.data.stages` | **Diseño**: tapón = `plug_depth`; clusters = `perforation_clusters`. Ver "Tapones reales" |
| `stage.actual` | `completion.data.actual-stages` | Lo bombeado: arena, fluido, intensidades, presiones, caudal, ISIP, tiempo, `skipped`, `screenout` |
| `stage.plug_info` | `completion.data.plugs` | Tipo, marca, modelo y OD del tapón. Se asocia por profundidad (±1 m) porque la numeración va al revés |
| `stage.plan` | `completion.data.stages` | `sand_t`/`fluid_m3` de `proppants`/`fluids`; `length_m` = de tapón a tapón (la etapa más somera usa la mediana); intensidades calculadas con esa longitud |
| `target`, `field` | `assets` | `target_formation`, `basin` |

Comparado contra un fracplan real: tapones, clusters, arena y Prop Intensity coinciden. Dos diferencias:

- **Fluid Intensity:** la app calcula m³/m reales. El fracplan muestra casi el doble con la etiqueta `m³/m`,
  pero ese número son **bbl/ft**. Es el valor que el fracplan etiqueta mal, no un error de Corva.
- **Fluido total:** difiere menos de 1% entre Corva y el fracplan.

### Datos reales de las etapas

`completion.data.actual-stages` tiene casi todas las etapas de diseño. Es el informe de campo: la Vista de pozo
**Frac real** y el cursor frac lo usan. El picklist **Mostrar** de la solapa elige con cuál se colorea el pad (al
cargarlo o después), igual que los botones de Vista de pozo. Si el pad no tiene datos reales, muestra el plan y avisa.

- Las intensidades reales se calculan con la misma longitud de etapa que las planificadas.
- Faltan etapas sueltas en varios pozos: se avisa, y esas etapas quedan en gris.
- Arena o fluido vacíos o en cero quedan en `null`: no es lo mismo que cero bombeado.
- **Datos mal cargados:** si lo real supera 1,8 veces el diseño, o la arena es menos del 2%, el valor queda en `null`
  y se avisa. Los casos típicos son unidades cambiadas (`ton` o `lb` que en realidad son bolsas de 100 lb) y fluido
  duplicado (cerca de 2×). Los bajos que no son error de unidad se dejan: pueden ser etapas cortadas.

### Tapones reales

**Corva no tiene una profundidad de tapón ejecutada que se pueda usar.** Se probaron todas las fuentes:

| Fuente | Resultado |
|---|---|
| `actual-stages.plug_depth` | Igual al diseño, con diferencias menores a 1 m y algún error de tipeo |
| `completion.data.plugs.top_depth` | Igual al diseño, salvo unos pocos pozos con corrimientos (de 1,3 a 48 m): se avisa y valen las etapas |
| `parameter-sheet.wireline_plug_setting_operation` | Copia del diseño |
| `parameter-sheet.milling_operation.start_depth` | Casi siempre diseño + 1,8 m fijo: no es una medición. Además no existe en todos los pozos |
| `wireline.wits.summary-1m` (máximo por corrida) | 6 a 8 m antes que el diseño, con la numeración de etapas corrida: es la herramienta, no el tapón |
| `completion.plug-setting.amplitude-events` | Casi sin datos, con corrimientos de −9 a −28 m según el pozo |

Lo mismo vale para los punzados: `actual-stages` repite `top_perforation` y `bottom_perforation` del diseño y
no trae clusters.

### Tramos

Corva lista los `components` **de arriba hacia abajo**, y el primero es un largo de relleno (un caño de
12 m). Por eso los largos no suman el pozo. Se ubican desde el zapato hacia arriba y el primero se lleva
lo que falta hasta boca de pozo.

- Se confirmó contra tallys y partes diarios: el cambio de tramo da a unos 20 m de lo informado.
- **5½":** la configuración vista es 5" 18# arriba, 5½" 23# en el medio y 5" 21.4# abajo.
- El libraje sale del **nombre** del componente (`5" 21.4# P-110`): `linear_weight` suele estar mal.
- **Sin una columna de ≥5 tiros, no hay posiciones.** Si el pozo nombra cañerías distintas, se avisa que los tramos van a mano.
- **Corva puede tener los nombres invertidos** (21.4# arriba y 18# abajo, al revés que el tally). Si el tramo de arriba pesa más, se avisa.

### Caños cortos

| Fuente | Qué es |
|---|---|
| `completion.casing-tally` | Del tally. Es la mejor fuente |
| `completion.ccl-collars` | Lo que detecta el wireline. Se usan los cortos que aparecen en ≥4 corridas y ≥15% del total. Contra un tally da los mismos, a menos de 4 m |
| `components` (`pup`, `marker_point`) | Intercalados en la columna, ubicados desde el zapato. Coinciden con el tally salvo que Corva tenga corrido el zapato |
| Ninguna | La mayoría de los pozos: no están en Corva. Se cargan con el tally o a mano en Manual, y la solapa los lista |

Los tallys en PDF casi no están en Corva. El CCL crudo de `wireline.wits` viene a 1 Hz (una muestra cada 1,6 a 1,9 m) y
pierde la mayoría de las cuplas, así que no sirve para detectar cortos.

### Lo que Corva no trae

- **TOC e instalación:** no se traen; se cargan a mano en la solapa Manual.
- **RKB:** queda vacío.
- **Tipo de carga** (`charge`): Corva da `ehd` y `shot_per_foot`; `plan.wl` queda como `2 spf · EHD 0.42"`.
- **Clusters en pozos viejos:** algunos no los tienen. Cada etapa queda con un único tramo del
  intervalo punzado, sin punzado por cluster.

### Corrimientos N/S entre bocas

El visor ubica las bocas solo por `wellhead.x`. Si Corva da un corrimiento N/S de 1 m o más (por ejemplo
un PAD con dos locaciones), se suma al `ns` de las estaciones, y `wellhead.y` guarda el valor.
En esos pozos, el survey exportado desde la app muestra el NS con ese corrimiento.

### Avisos que muestra la solapa

Los datos no se corrigen, se avisa. Se avisa cuando el survey y la cañería difieren en el fondo por más
de 50 m, cuando dos bocas tienen la misma coordenada, cuando no hay etapas o cañerías, cuando un pozo se
omite por no tener survey, y en los casos de las secciones anteriores (etapas reales, tapones, tramos y cortos).

## Cómo probarlo

`corva.js` corre en node con un stub de `localStorage` (`login`, `listPads`, `fetchPad`). Los pads resultantes
se validan con el harness de `buildWellSVG` que describe el CLAUDE.md. La verificación visual se hace en el
navegador.
