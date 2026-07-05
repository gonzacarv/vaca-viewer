<div align="center">

# 🛢️ Vaca Viewer

### Visor 3D de pozos y pads para terminación no convencional

*Navegá el subsuelo de tu pad a escala real, activá y desactivá lo que querés ver, y exportá esquemas listos para tus programas y correos.*

[![Estado](https://img.shields.io/badge/estado-v0.2_en_desarrollo-4ea1d3)]()
[![Web](https://img.shields.io/badge/100%25-web-3fb950)]()
[![Sin servidor](https://img.shields.io/badge/sin_servidor-offline-6cc04a)]()
[![Datos privados](https://img.shields.io/badge/datos-nunca_salen_del_equipo-e5484d)]()
[![Licencia](https://img.shields.io/badge/licencia-propietaria-f2a03d)]()

</div>

---

## 🎯 Qué es

**Vaca Viewer** es una aplicación web de **un solo archivo** para visualizar la geometría de subsuelo de pozos horizontales de fractura (plug-and-perf). Se abre con el navegador, **no requiere instalar nada**, funciona **offline**, y los datos operativos **nunca se suben a ningún servidor** — todo se procesa localmente en tu máquina.

> 💡 Pensada para el flujo real de campo: survey de geonavegación, tallys de entubado, y fracplan de punzados y tapones — los formatos que ya exportás de OpenWells y Excel.

---

## ✨ Características

| | Función | Descripción |
|:-:|:--|:--|
| 🧭 | **Navegación 3D** | Orbitar, desplazar y hacer zoom estilo CAD, con el pad completo a **escala real 1:1** |
| 👁️ | **Capas activables** | Mostrar u ocultar por pozo y por elemento (trayectoria, cañería, punzados, tapones, etapas) |
| 🖼️ | **Exportar cortes 2D** | Esquema lateral por pozo, fondo blanco, para correos y documentos |
| 📥 | **Importar datos** | Survey (`.xlsx`), tally (`.pdf` de OpenWells) y fracplan (`.xlsx`) con parsers a medida |
| ✏️ | **Editar a mano** | Cargar y corregir datos, copiar y pegar campos o tablas enteras |
| 📦 | **Exportar el pad** | Formato propio en `.json` por pozo o `.zip` de pad completo (solo compatible con la app) |
| 📏 | **Medición** | Regla de distancia entre puntos en la vista 3D |

---

## 🗂️ Secciones de la app

<table>
<tr>
<td width="50">🧭</td>
<td><b>Vista 3D</b><br>La sala de control. Navegás el pad, jugás con la cámara y activás/desactivás capas. El survey se representa a escala real, con los pozos navegando en línea Norte–Sur tal como en superficie.</td>
</tr>
<tr>
<td>🖼️</td>
<td><b>Exportar</b><br>Elegís un pozo y armás su <b>corte lateral 2D</b>: tramo vertical comprimido (solo zapatos y topes de cemento) y rama horizontal escalada para maximizar legibilidad. Activás intermedias, guía, etapas, punzados y tapones, y exportás <b>PNG/JPG</b>.</td>
</tr>
<tr>
<td>✏️</td>
<td><b>Datos</b><br>Importás survey, tally y fracplan, o cargás/editás a mano. Copiar y pegar tablas enteras. Exportás por pozo o el pad completo como ZIP.</td>
</tr>
<tr>
<td>⚙️</td>
<td><b>Configuración</b><br>Colores, controles de cámara, y preferencias de vista y de exportación.</td>
</tr>
</table>

---

## 🚀 Cómo se usa

### Opción A — doble clic *(uso final, sin dependencias)*

Abrí `index.html` con tu navegador. Nada que instalar. 🎉

> ℹ️ En la versión de release las librerías van **embebidas** en el HTML, de modo que corre **offline y sin internet** en cualquier máquina, incluso sin permisos para instalar software.

### Opción B — servidor local *(desarrollo)*

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

> 📦 La app **autocarga** `samples/pad_MMo-35.json` si está presente (pad de ejemplo con 4 pozos reales).
> Si no lo encuentra, abrí la sección **Datos** y arrastrá tu propio `pad.json`.

### ⌨️ Atajos

| Acción | Control |
|:--|:--|
| Cambiar de sección | `1` `2` `3` `4` |
| Orbitar | arrastrar 🖱️ |
| Desplazar | click derecho + arrastrar |
| Zoom | rueda del mouse |

---

## 🎨 Referencia de colores

| Elemento | Color |
|:--|:--|
| 🔵 Trayectoria | Azul geonavegación |
| ⚪ Cañería / casing | Gris acero |
| 🟠 Punzados | Naranja |
| 🔴 Tapones | Rojo |
| 🟢 Etapas de fractura | Verde |

---

## 📁 Estructura del repositorio

```
vaca-viewer/
├── 📄 index.html            → la app entera (single-file)
├── 📜 LICENSE               → copyright y términos de uso
├── 📖 README.md             → este archivo
├── 📁 docs/
│   └── data-schema.md       → especificación del formato JSON del pad
└── 📁 samples/              → pads de ejemplo (json / zip)
```

> 🔒 Los datos reales de pozos van en `data/` (ignorada por git). El repositorio solo contiene código y ejemplos anonimizados.

---

## 🧬 Formato de datos

La app usa un **formato JSON propio y versionado** como formato canónico de intercambio. Los parsers de survey, tally y fracplan convierten a esta estructura, y el export de pad es un `.zip` que la contiene.

- 📐 Profundidades en **metros** · diámetros en **pulgadas**
- 🧭 Coordenadas locales del pad: `x` = E/O, `y` = N/S, `z` = TVD (hacia abajo)
- 🔁 `schema_version` garantiza que el formato sea **solo compatible consigo mismo**

Especificación completa en [`docs/data-schema.md`](docs/data-schema.md).

---

## 🗺️ Roadmap

- [x] Andamiaje de la app y navegación entre secciones
- [x] Escena 3D con navegación CAD a escala real
- [x] Esquema de datos versionado
- [x] Parsers reales: survey `.xlsx` · tally `.pdf` · fracplan `.xlsx` *(en Python; en-navegador → v0.3)*
- [x] Carga del pad completo desde datos reales (pad MMo-35: 4 pozos)
- [ ] Exportar corte lateral 2D a PNG/JPG
- [ ] Editor de datos con copiar/pegar de tablas
- [ ] Export ZIP del pad + persistencia local (IndexedDB)
- [ ] Regla de medición y dogleg coloreado en 3D
- [ ] Empaquetado final con librerías embebidas (offline total)

---

## 👤 Autor

**Gonzalo Carvallo**
📧 [gonzacarv@gmail.com](mailto:gonzacarv@gmail.com) · 🐙 [@gonzacarv](https://github.com/gonzacarv) · gonzacarv · GonXa

---

## ⚖️ Licencia

© 2026 **Gonzalo Carvallo**. Todos los derechos reservados.

Queda prohibida la reproducción, distribución, modificación o uso, total o parcial, sin autorización expresa del autor. La eliminación o alteración del aviso de autoría constituye una infracción a los derechos del autor. Ver [`LICENSE`](LICENSE) para los términos completos.

<div align="center">

---

*Hecho con 🧉 en Neuquén · Vaca Muerta*

</div>
