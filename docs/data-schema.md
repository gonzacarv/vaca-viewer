# Esquema de datos — formato de intercambio del pad

Versión del esquema: `1`

Este documento especifica el formato JSON propio de la aplicación. Es el
formato canónico: los parsers de survey (XLS), tally (PDF) y fracplan (XLS)
convierten a esta estructura, y la app solo sabe leer esto. El export "de pad"
es un ZIP que contiene un `pad.json` con esta estructura (más, opcionalmente,
los archivos de origen adjuntos para trazabilidad).

## Principios

- Todas las profundidades en **metros**. `md` = measured depth desde el datum.
  `tvd` = true vertical depth. Ambas positivas hacia abajo.
- Diámetros en **pulgadas** (numérico, ej. `5.0`, `7.625`, `9.625`, `13.375`).
- Coordenadas de trayectoria en metros, sistema local del pad: origen en la
  boca del pozo de referencia del pad. Eje `x` = Este(+)/Oeste(-),
  `y` = Norte(+)/Sur(-), `z` = TVD (hacia abajo, +).
- Todo campo puede ser `null` si el dato no está disponible. La app muestra lo
  que hay.

## Estructura raíz

```jsonc
{
  "schema_version": 1,
  "app": "vaca-viewer",
  "generated_at": "2026-07-04T18:00:00Z",
  "pad": {
    "id": "MMo-35",            // XY del código de pozo → PAD
    "name": "Mata Mora PAD 35",
    "field": "ARC Phoenix - Mata Mora",
    "operator": "Phoenix",
    "campaign": 2,             // W del código de pozo
    "surface": {
      // separación estándar entre bocas: 10 m, línea O→E ascendente
      "wellhead_spacing_m": 10,
      "line_azimuth_deg": 90 // orientación de la línea de bocas (E)
    },
    "wells": [ /* WellObject */ ]
  }
}
```

## WellObject

```jsonc
{
  "id": "MMo-2351h",
  "name": "PET.Nq.MMo-2351(h)",
  "well_number": 1,           // Z del código
  "architecture": "horizontal", // "horizontal" | "vertical"
  "target": "cocina",         // nivel de navegación objetivo (ej. Cocina 2/3)
  "wellhead": {               // posición de la boca en coords locales del pad
    "x": 0, "y": 0,
    "rkb_elev_m": 420.85,     // datum RKB sobre nivel del mar
    "ground_elev_m": 420.85
  },

  // --- SURVEY: trayectoria real, a escala, para la vista 3D ---
  "survey": {
    "vsec_azimuth_deg": 186.402,
    "stations": [
      // md, incl(°), azim(°), tvd, ns(+N/-S), ew(+E/-W), vsec, dls(°/30m)
      { "md": 0,   "incl": 0,    "azim": 0,     "tvd": 0,   "ns": 0,    "ew": 0,    "vsec": 0,     "dls": null },
      { "md": 30,  "incl": 0.21, "azim": 196.8, "tvd": 30,  "ns": -0.05,"ew": -0.02,"vsec": 0.054, "dls": 0.21 }
      // ...
    ]
  },

  // --- CASINGS: una entrada por fase de entubado ---
  // orden de fases (de mayor a menor diámetro / más somero a más profundo):
  //   guia (13 3/8") → intermedia1 (9 5/8") → intermedia2 (7 5/8") → produccion (5")
  "casings": [
    {
      "phase": "produccion",       // "guia"|"intermedia1"|"intermedia2"|"produccion"
      "od_in": 5.0,
      "shoe_md": 6643.1,           // profundidad del zapato (set depth)
      "toc_md": null,              // tope de cemento (MD), si se conoce
      "short_joints": [           // caños cortos (<10 m) del TRAMO MEDIO. Solo en la aislación.
        // casing corto o XOVER; se ignoran los primeros y últimos 150 m (cabezal y shoetrack).
        // La app los dibuja como banda amarilla, capa "Caños cortos". `xover:true` si es un crossover.
        { "desc": "CSG W-463 CORTO R1", "xover": false, "length_m": 6.0, "top_md": 514.0, "bottom_md": 520.0 }
        // ...
      ],
      "shoetrack": {              // piezas cortas de los últimos ~150 m (zapato, collar flotador,
        // camisas, cortos). Capa violeta claro "Shoetrack", con etiqueta que lista los elementos.
        "elements": [             // ordenados de somero a profundo
          { "desc": "CASING 5\" CORTO R1", "length_m": 6.0, "top_md": 6629.0, "bottom_md": 6635.0 },
          { "desc": "ZTO RIMADOR ZAPATO", "length_m": 0.54, "top_md": 6650.0, "bottom_md": 6650.54 }
        ]
      },
      "components": [              // del tally, opcional a nivel detalle
        { "desc": "ZTO RIMADOR", "od_in": 5.0, "top_md": 6649.104, "bottom_md": 6649.644, "grade": "W461" }
        // ...
      ]
    }
  ],

  // --- FRACTURA: etapas, clusters/punzados y tapones ---
  "frac": {
    "total_stages": 30,
    "lp_md": 3390.16,            // landing point / MD 90°
    "collar_md": 6643.1,
    "horizontal_ext_m": 3252.9,
    "stages": [
      {
        "stage": 30,
        "plug_md": 3578,        // tapón que aísla esta etapa (null en la última)
        "clusters": [
          { "n": 450, "top_md": 3477, "bottom_md": 3477.3, "incl": 90, "shots": 1, "charge": "3 1/8\"_EHO 45", "phasing": 0 }
          // ...
        ]
      }
      // ...
    ],
    // vista planificado vs real: cada set de tapones/punzados puede duplicarse
    "planned_vs_actual": "planned"  // "planned" | "actual"
  },

  // --- INSTALACIÓN (opcional): TBG de producción + tapones/packers de completación ---
  // El TBG se dibuja como caño fino desde superficie hasta la punta del fracplan.
  "installation": {
    "tbg_od_in": 2.875,           // OD del tubing: 2 | 2.375 | 2.875 | 3.5
    "tbg_weight_ppf": 6.5,        // libraje API del tubing (según OD)
    "tbg_grade": "N80",           // acero API del tubing
    "tbg_md_m": 2400,             // OBLIGATORIO: MD (desde superficie) hasta donde baja la sarta de TBG
    "elements": [                 // en su MD; TPN se dibuja naranja, PKR verde
      { "type": "PKR", "md": 3200 },   // "TPN" (tapón) | "PKR" (packer)
      { "type": "TPN", "md": 3450 }
    ]
  }
}
```

> `survey` y `frac` son **opcionales**. Sin `survey`, la app asume un pozo **vertical
> perfecto** (`architecture: "vertical"`, TVD=MD, ns=ew=0) hasta el punto más profundo conocido.
> Los datos de cañería (OD/libraje/acero/MD) se autocompletan del tally y quedan editables, o se
> eligen a mano por picklists API.

## Notas de parsing por origen

- **Survey XLS (OpenWells "Actual Working Survey"):** metadata en filas ~5-21,
  tabla desde fila 23. Columnas fijas: MD, Incl, Azim Grid, TVD, VSEC, NS, EW,
  Closure, Closure Az, DLS, TF. NS/EW vienen como texto "S 0.05" / "E 1.71" →
  parsear signo por la letra (N/E = +, S/W = -).
- **Tally PDF (Driller's Running Pipe Tally):** sección "2.1 Pipe Sections" =
  catálogo (desc, size, grade). Sección "2.2 Run Tally" = filas con
  N°, N° Tally, Longitud, Cum.Length, Set Depth, centralizador, Desc.
  Filtrar cabeceras repetidas y pies "OpenWells". El zapato = Set Depth mayor.
  Los **caños cortos** (`short_joints`) salen de esta tabla: son las filas con Longitud
  muy por debajo de la mediana de tiros (pup joints de pocos metros). Solo se registran
  para la fase de aislación.
- **Fracplan XLS (hoja "Punzados"):** cabecera con LP, collar, ext. horizontal,
  total etapas. Tabla desde fila ~13: # Cluster, Tope MD, Fondo MD, Incl,
  Número etapa (solo en la 1ra fila de cada etapa), separación, altura, tiros,
  carga, phasing, temp, Plug MD (solo en la última fila de cada etapa).
  Un archivo puede traer varios pozos (bloques/hojas separados).

## Versionado

`schema_version` se incrementa ante cambios incompatibles. La app rechaza (con
mensaje claro) versiones que no reconoce. Esto garantiza que el formato sea
"solo compatible consigo mismo", como se requirió.
