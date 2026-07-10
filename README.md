<div align="center">

<img src="img/vaca-viewer-lockup.svg" alt="Vaca Viewer" width="330">

### Visor 3D de pozos y pads para terminación no convencional

*Navegá el subsuelo de tu pad a escala real, prendé y apagá lo que querés ver, y exportá esquemas listos para informes y correos.*

[![Estado](https://img.shields.io/badge/estado-v0.3_en_desarrollo-4ea1d3)]()
[![Web](https://img.shields.io/badge/100%25-web-3fb950)]()
[![Offline](https://img.shields.io/badge/sin_servidor-offline-6cc04a)]()
[![Datos privados](https://img.shields.io/badge/datos-nunca_salen_del_equipo-e5484d)]()
[![Licencia](https://img.shields.io/badge/licencia-propietaria-f2a03d)]()

</div>

---

## Qué es

**Vaca Viewer** es una app web para visualizar la geometría de subsuelo de pozos horizontales de fractura (plug-and-perf). Corre **en el navegador**, funciona **offline** y los datos operativos **nunca se suben a ningún servidor**: todo se procesa en tu máquina.

Está pensada para el flujo real de campo —survey de geonavegación, tally de entubado y fracplan de punzados/tapones— los formatos que ya exportás de OpenWells y Excel.

![captura](img/vv.png)

---

## Las cuatro secciones

| | | |
|:-:|:--|:--|
| 🧭 | **Vista 3D** | El pad completo a escala real 1:1. Orbitás, hacés zoom y desplazás como en un CAD; prendés/apagás capas por pozo y por elemento (trayectoria, cañerías, punzados, tapones, etapas, dogleg). Medís distancias entre puntos. |
| 🖼️ | **Exportar** | Imágenes de fondo blanco para documentos. **Vista 3D** (isométrica o la vista actual) y **corte de pozo 2D** (esquema oil&gas de manual: cañerías, cemento, zapatos, tapones, packers, punzados por etapa). Todo a **PNG / JPG / PDF**, en color o blanco y negro. |
| ✏️ | **Datos** | Importás survey (`.xlsx`), tally (`.pdf`) y fracplan (`.xlsx`), o cargás/editás a mano. También armás el pad desde cero y lo bajás como `pad.vvwp` (formato propio de la app). |
| ⚙️ | **Configuración** | Exageración vertical, diámetros, radios de punzado, formato de etiquetas y demás preferencias de vista. |

---

## Cómo se usa

**1. Abrí la app.** Serví la carpeta por HTTP y entrá con el navegador:

```bash
python3 -m http.server 8080     # abrí http://localhost:8080
```

> Para un único archivo portable y offline: `python3 build.py` genera `dist/index.html` con todo embebido.

**2. Cargá un pad.** En la sección **Datos**, arrastrá un `pad.vvwp` existente, o construilo cargando los archivos crudos por pozo (el survey y el fracplan son opcionales; sin survey se asume pozo vertical).

**3. Explorá en 3D.** Con el pad cargado saltás a **Vista 3D**. Usá el panel de **Capas** (arriba a la derecha) para mostrar solo lo que te interesa, la veleta de la esquina para las vistas cardinales, y `F` para encuadrar.

**4. Exportá.** En **Exportar** elegís entre la vista 3D o el corte 2D de un pozo, ajustás con los sliders y descargás la imagen.

### Atajos

| Acción | Control |
|:--|:--|
| Cambiar de sección | `1` `2` `3` `4` |
| Orbitar · desplazar · zoom | arrastrar · click derecho · rueda |
| Encuadrar todo | `F` |
| Medir | `M` |

---

## Estructura del repo

```
vaca-viewer/
├── index.html       → shell HTML (markup + libs)
├── src/             → módulos ES: viewer, export3d, export2d, export-ui, util, main + styles.css
├── build.py         → empaqueta todo en dist/index.html (single-file offline)
├── build_pad.py     → parsers de survey/tally/fracplan en Python
├── docs/data-schema.md  → especificación del formato JSON del pad
└── samples/         → pads de ejemplo
```

El formato de intercambio es un **JSON propio y versionado** (`schema_version`); profundidades en metros, diámetros en pulgadas, coordenadas locales al pad. Especificación completa en [`docs/data-schema.md`](docs/data-schema.md).

> 🔒 Los datos reales de pozos van en `data/` (ignorada por git). El repositorio solo contiene código y ejemplos anonimizados.

---

## Autor y licencia

**Gonzalo Carvallo** — 📧 [gonzacarv@gmail.com](mailto:gonzacarv@gmail.com) · 🐙 [@gonzacarv](https://github.com/gonzacarv)

© 2026 Gonzalo Carvallo. Todos los derechos reservados. Uso, reproducción o modificación solo con autorización expresa del autor; ver [`LICENSE`](LICENSE).

<div align="center">

*Hecho con 🧉 en Neuquén · Vaca Muerta*

</div>
