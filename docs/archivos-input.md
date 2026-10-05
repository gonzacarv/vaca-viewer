# Archivos de entrada (ingesta)

Cómo deben ser los archivos crudos que carga el constructor de pad ("Datos → Construir pad desde
archivos crudos"). Por pozo se cargan: **Survey** (.xlsx), **Fracplan** (.xlsx), y el **Tally de
cañerías** (uno o varios). Todo se parsea **en el navegador** (SheetJS / pdf.js); los mismos parsers
están replicados en `build_pad.py`.

> **Plantillas listas para completar** en [`plantillas/`](plantillas/):
> `plantilla_survey.xlsx`, `plantilla_fracplan.xlsx`, `plantilla_tally_canerias.xlsx`.
> Se regeneran con `python3 docs/plantillas/gen_plantillas.py`.

Reglas generales:
- **Filas ocultas del Excel se IGNORAN** en todos los parsers (una fila oculta = dato "borrado").
- Las columnas se detectan por **encabezado** (texto), no por posición fija, salvo el `Punzados` del
  fracplan que usa posiciones fijas (ver abajo).
- Profundidades en **metros**, diámetros en **pulgadas**.

---

## 1. Survey (.xlsx)

Una solapa (se usa la **primera** hoja). El parser busca la **fila de encabezado** como la primera
fila cuya **columna B** empieza con `MD`; desde la fila siguiente, una **fila por estación**.

**Columnas** (se mapean por su encabezado; el orden puede variar, pero `MD` debe estar en la col. B):

| Encabezado | Significado | Obligatorio |
|---|---|---|
| `MD` | measured depth (m) | **sí** |
| `INCL` | inclinación (°) | recomendado (habilita landing/dogleg) |
| `AZIM` (o `AZIM GRID`, `AZIMUTH`) | azimut (°) | recomendado |
| `TVD` | true vertical depth (m) | recomendado |
| `VSEC` | sección vertical (m) | opcional |
| `NS` | offset Norte(+)/Sur(−) **local a la boca** (m) | recomendado |
| `EW` | offset Este(+)/Oeste(−) **local a la boca** (m) | recomendado |
| `DLS` | dogleg severity (°/30m) | opcional |

- `NS`/`EW` aceptan número con signo (`-406.13`) **o** con letra (`S 406.13`, `W 12.4`).
- ⚠️ **No** usar Northing/Easting **absolutos** del CRS (~5.700.000): son coordenadas globales, no el
  offset local; si se cuelan, el pozo se dibuja a millones de metros.
- **Vertical Section Azimuth**: si aparece una celda con ese texto (col. A o G) y su valor a la
  derecha (col. C o I), se toma como azimut de la sección vertical.
- Sin survey, el pozo se sintetiza **vertical** (TVD = MD).

---

## 2. Fracplan (.xlsx)

Dos solapas: **`Punzados`** (obligatoria) y **`Resumen`** (opcional pero necesaria para la vista
"Por fracplan" y el "cursor frac").

### Hoja `Punzados` — **posiciones fijas**
- Celda **B5** = MD 90° / LP · **B6** = Camisa/collar (m) · **B7** = Ext. horizontal (m) ·
  **B9** = `Total etapas` (¡es la cantidad **verdadera** de etapas; manda sobre lo que digan las filas!).
- **Fila 12** = encabezados. **Desde la fila 13**, una fila por **cluster**. Columnas usadas:

| Col | Campo |
|---|---|
| A (1) | `# Cluster` (debe empezar con "Cluster") |
| B (2) | Tope cluster MD (m) |
| C (3) | Fondo cluster MD (m) |
| D (4) | Inclinación (°) |
| E (5) | **N° etapa** (solo en el 1er cluster de cada etapa) |
| H (8) | N° de tiros por cluster (≈ spf) |
| I (9) | Carga (ej. `EHO 40`) |
| J (10) | Phasing (°) |
| L (12) | Plug MD (m) — tapón de la etapa |
| M (13) | Long ET (m) |

- Las **filas ocultas** (clusters/etapas "borradas", p.ej. una etapa extra al heel arriba del 1er
  plug) **no se ingieren**.

### Hoja `Resumen` — valores **por grupo de etapas**
Trae los datos planificados agrupados en columnas por rango de etapas (`Etapas 1-5`, `Etapas 6-15`,
…). Cada etapa **hereda** los valores del grupo que la contiene. Necesita **≥2 grupos**. Se leen por
**etiqueta** (texto en la col. A), robusto a reordenamientos:

| Fila (por su etiqueta en col. A) | Se toma | Va a |
|---|---|---|
| `Arena…` (unidad `tn`) | toneladas de arena por etapa | `sand_t` |
| `Prop Intensity` (`lb/ft`) | intensidad de arena | `prop_int_lbft` *(métrica del coloreo)* |
| `TOTAL` de FLUIDOS (unidad `m³`) | fluido total por etapa | `fluid_m3` |
| `Fluid Intensity` (`m³/m`) | intensidad de fluido | `fluid_int_m3m` |
| `Frac Length` (`m`) | longitud de etapa | `length_m` (LongEt) |
| `Etapas X-Y` → `Cañón 3 1/8 · 2 tiros · Carga: EHO 45` | detalle de cañón | `wl` → `Gun 3 1/8" · 2 spf · EHO 45` |

- El detalle de cañón: `N tiros` → `N spf`; `1/2 tiros` → `1-2 spf`.

---

## 3. Tally de cañerías

Da, por fase de casing (`guia`, `intermedia1`, `intermedia2`, `produccion`/aislación): **OD**,
**MD de zapato**, **peso** (lb/ft), **grado** de acero, **TOC** (opcional) y —para la aislación—
**caños cortos** y **shoetrack**. Dos formatos aceptados:

### 3a. XLSX (recomendado) — un archivo por pozo, **una solapa**, todas las fases
Se usa la primera hoja. Columnas por **encabezado**. Dos tablas:

**Tabla de fases** (encabezado con `Fase` + `OD`). Columnas: `Desde MD` y `Hasta MD` (m).

| Fase | OD (pulg) | Desde MD | Hasta MD | Peso (lb/ft) | Grado | TOC MD |
|---|---|---|---|---|---|---|
| `guia` | 13.375 | 0 | 1200 | 68 | K55 | |
| `intermedia1` | 9.625 | 0 | 3000 | 47 | P110 | |
| `intermedia2` | 7.625 | 0 | 4500 | 39 | P110 | |
| `produccion` | 5.0 | 0 | 3200 | 18.4 | N80 | 3390 |
| `produccion` | 5.0 | 3200 | 6643.1 | 21.4 | P110 | |

- **Casing telescopado**: una fase puede usar **varias filas**, una por tramo (mismo OD, distinto
  peso/grado). Cada fila = un tramo `[Desde MD, Hasta MD]`. El **zapato** de la fase = el `Hasta MD`
  más profundo; el OD/peso/grado "resumen" son los del tramo del zapato. Los tramos se guardan en
  `casing.segments` y se marca cada **xover** en la Vista 3D (etiqueta con el tramo de arriba/abajo).
- `Desde MD` es opcional: si se omite, el 1er tramo arranca en 0 y cada siguiente en el `Hasta MD` del
  anterior. Con una sola fila por fase, se comporta como antes (sin telescopado).
- Alias de fase: `guia/guía`, `int1/intermedia1`, `int2/intermedia2`, `prod/produccion/producción/aislación`.

**Tabla de piezas** (opcional; encabezado con `Tipo` + `Tope`): caños cortos y shoetrack.

| Fase | Tipo | Descripción | Tope MD (m) | Fondo MD (m) | Longitud (m) | XOVER |
|---|---|---|---|---|---|---|
| `produccion` | `corto` | Pup joint 5" | 2450 | 2455.87 | 5.87 | no |
| `produccion` | `shoetrack` | Zapato flotador | 6642 | 6643.10 | 1.10 | no |

- `Tipo`: `corto` (caño corto / xover) o `shoetrack`.
- `Longitud`: si se deja vacía, se calcula = `Fondo − Tope`. `XOVER`: si/no.

### 3b. PDF (compatibilidad)
Los tallys en **PDF** corresponden a los **"Run Tally Report"** exportados como **Drillers Tally**
desde la aplicación **OpenWells de Landmark (Halliburton)**. El parser lee la sección
`2.1 Pipe Sections` (OD, peso, grado, "Total length run" = zapato) y `2.2 Run Tally` (caños cortos y
shoetrack de la aislación, por longitud <10 m y posición). Se carga **un PDF por fase**.
