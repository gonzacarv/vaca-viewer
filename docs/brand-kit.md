# Vaca — Brand Kit

Guía portable para replicar la estética de **Vaca Viewer** en otras apps de la familia
(ej. *Vaca Planner*). Copiá lo que necesites; todo es autocontenido y offline (sin CDNs).

---

## 1. Paleta — design tokens

Van en `:root`. Son la base de TODO (fondo oscuro, panel, líneas, tinta, acento + colores de dato).

```css
:root {
  --bg:#0d1117;        /* fondo app */
  --panel:#161b22;     /* paneles / sidebar */
  --panel-2:#1c232d;   /* panel hover / inputs / botones */
  --line:#2a3441;      /* bordes y separadores */
  --ink:#e6edf3;       /* texto principal */
  --ink-dim:#8b97a6;   /* texto secundario */
  --accent:#4ea1d3;    /* acento (celeste) — foco, activo, links */
  /* colores de dato (reusables por dominio) */
  --casing:#d0d0d0; --perf:#f2a03d; --plug:#e5484d; --stage:#3fb950; --short:#ffe500;
  --mono:"SFMono-Regular",ui-monospace,"Cascadia Code",Consolas,monospace;
  --sans:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font-family:var(--sans); }
```

Colores de marca extra usados por el isotipo/wordmark:
`#eaeff4` (blanco marca) · `#9fb0bd` (gris slate claro) · `#18212e` (roca slate) ·
`#232e3b` (borde icono) · `#d7e0e8` (trazo pozo) · `#e3a94c` (ámbar / wellhead).

---

## 2. Tipografía

- **Wordmark / logotipo:** **Space Grotesk** (variable). "vaca" en 700, la 2ª palabra en 400.
- **UI general:** `--sans` (Inter/system). **Datos y labels:** `--mono`.

**Embeber Space Grotesk offline** (sin depender de Google Fonts): descargá el woff2 latino y ponelo
como `@font-face` con data-URI al principio del CSS. Ya está hecho en
`vaca-viewer/src/styles.css` (línea 1-2) — **copiá esa línea tal cual**. Para regenerarla:

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -sL -A "$UA" "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700" \
  | grep -A6 "U+0000-00FF" | grep -oE "https://[^) ]+woff2" | head -1   # → URL del woff2
curl -sL -A "$UA" "<esa-url>.woff2" -o sg.woff2
base64 -w0 sg.woff2   # pegar en el src del @font-face de abajo
```

```css
@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:400 700;
  font-display:swap;src:url(data:font/woff2;base64,<BASE64>) format('woff2');}
```

> Alternativa rápida (online): `<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">`.

---

## 3. Isotipo (icono)

Concepto: rounded-square con el **mismo fondo oscuro de la app** (se funde, sin caja que contraste),
la **roca/formación** en slate con silueta de estratos, la **trayectoria del pozo** (vertical → codo
90° → lateral) en trazo claro, y el **wellhead** como punto ámbar. SVG inline (nítido, sin assets):

```html
<svg viewBox="0 0 100 100" width="38" height="38">
  <defs><clipPath id="bm"><rect x="1.5" y="1.5" width="97" height="97" rx="25"/></clipPath></defs>
  <rect x="1.5" y="1.5" width="97" height="97" rx="25" fill="#0d1117" stroke="#232e3b" stroke-width="2"/>
  <g clip-path="url(#bm)">
    <path d="M0 60 L32 60 L32 46 L62 46 L62 60 L100 60 L100 100 L0 100 Z" fill="#18212e"/>
    <path d="M46 44 L46 70 Q46 82 59 82 L84 82" fill="none" stroke="#d7e0e8" stroke-width="6.5" stroke-linecap="round"/>
    <circle cx="46" cy="44" r="7" fill="#e3a94c"/>
  </g>
</svg>
```

**Para Vaca Planner:** mantené el **marco** (rounded-square oscuro + borde `#232e3b`), la **roca
slate** y el **ámbar** como firma. Cambiá solo el **glifo interno** por algo del dominio "planner"
(p. ej. una grilla/calendario o un timeline de etapas en `#d7e0e8`), conservando el punto ámbar como
acento. Así la familia se reconoce pero cada app tiene su símbolo.

---

## 4. Wordmark / lockup

Todo en minúscula: 1ª palabra bold `#eaeff4`, 2ª regular `#9fb0bd`, en Space Grotesk.

```html
<div class="brand">
  <span class="brandmark"> …SVG del isotipo… </span>
  <div class="brandtext">
    <div class="brandname"><span class="bn-a">vaca</span> <span class="bn-b">planner</span></div>
    <div class="sub">subsuelo · v0.1</div>
  </div>
</div>
```
```css
.brand { padding:15px 14px 14px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px; }
.brand .brandmark { flex:none; line-height:0; } .brand .brandmark svg { display:block; }
.brand .brandname { font-family:"Space Grotesk",var(--sans); font-size:21px; letter-spacing:-.01em; line-height:1; white-space:nowrap; }
.brand .brandname .bn-a { font-weight:700; color:#eaeff4; }
.brand .brandname .bn-b { font-weight:400; color:#9fb0bd; }
.brand .sub { font-family:var(--mono); font-size:10px; color:var(--ink-dim); margin-top:5px; letter-spacing:.05em; }
```
Para el README, un lockup horizontal SVG autocontenido: mirá `vaca-viewer/img/vaca-viewer-lockup.svg`
(cambiá el texto y el color/glifo).

---

## 5. Favicon (SVG data-URI, self-contained)

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230d1117'/%3E%3Cpath d='M0 60 L32 60 L32 46 L62 46 L62 60 L100 60 L100 100 L0 100 Z' fill='%2318212e'/%3E%3Cpath d='M46 44 L46 70 Q46 82 59 82 L84 82' fill='none' stroke='%23d7e0e8' stroke-width='6.5' stroke-linecap='round'/%3E%3Ccircle cx='46' cy='44' r='7' fill='%23e3a94c'/%3E%3C/svg%3E">
```

---

## 6. Componentes base (CSS)

```css
/* layout: sidebar 210px + contenido */
#app { display:grid; grid-template-columns:210px 1fr; height:100vh; }
#nav { background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; }

/* botones de navegación (con nº de atajo a la derecha y barra de acento al activo) */
nav button { display:flex; align-items:center; gap:10px; width:100%; background:none; border:0;
  color:var(--ink-dim); text-align:left; padding:11px 16px; font-size:13px; cursor:pointer; border-left:2px solid transparent; }
nav button:hover { color:var(--ink); background:var(--panel-2); }
nav button.active { color:var(--ink); border-left-color:var(--accent); background:var(--panel-2); }

/* pie de sidebar: info + autor centrado abajo */
.nav-foot { padding:12px 16px; border-top:1px solid var(--line); font-family:var(--mono); font-size:10px; color:var(--ink-dim); line-height:1.5; }
.nav-author { margin-top:auto; padding:13px 16px; border-top:1px solid var(--line); font-family:"Space Grotesk",var(--sans);
  font-size:13px; font-weight:500; color:var(--ink-dim); text-align:center; text-decoration:none; cursor:pointer; }
.nav-author:hover { color:var(--accent); }

/* páginas / secciones */
.pad { padding:28px 32px; height:100%; overflow:auto; }
.pad h2 { font-size:15px; letter-spacing:.1em; text-transform:uppercase; font-weight:600; margin:0 0 4px; }
.pad .lead { color:var(--ink-dim); font-size:13px; max-width:64ch; margin:0 0 22px; line-height:1.6; }

/* tarjetas */
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px 20px; margin-bottom:16px; max-width:860px; }
.card h4 { margin:0 0 10px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-dim); }
.stub { font-family:var(--mono); font-size:12px; color:var(--ink-dim); line-height:1.7; }

/* botones */
.btn { background:var(--panel-2); color:var(--ink); border:1px solid var(--line); padding:8px 14px; border-radius:6px;
  font-size:12.5px; cursor:pointer; font-family:var(--sans); margin:0 6px 6px 0; }
.btn:hover { border-color:var(--accent); color:#fff; }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#04141f; font-weight:600; }

/* filas de control + inputs + sliders (usan accent-color para teñir el slider) */
.row { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:12.5px; cursor:pointer; }
.row input { accent-color:var(--accent); }
input[type=range] { accent-color:var(--accent); }
select, input[type=text], input[type=number] { background:var(--panel-2); color:var(--ink);
  border:1px solid var(--line); border-radius:5px; padding:6px 8px; font-size:12.5px; font-family:var(--sans); }
kbd { font-family:var(--mono); font-size:10.5px; background:var(--panel-2); border:1px solid var(--line); border-radius:3px; padding:1px 5px; }

/* tabs (sub-secciones) */
.tabs { display:flex; gap:6px; border-bottom:1px solid var(--line); }
.tab { background:none; border:0; border-bottom:2px solid transparent; color:var(--ink-dim); padding:9px 14px; font-size:12.5px; cursor:pointer; }
.tab.active { color:var(--ink); border-bottom-color:var(--accent); }
```

---

## 7. Principios

- **Oscuro por defecto**, jerarquía por `--ink` / `--ink-dim`, un solo **acento celeste**.
- **Monoespaciada para datos** (números, MD/TVD, códigos), sans para prosa.
- El **ámbar `#e3a94c`** es la firma cálida (wellhead) — usalo con moderación, como acento del icono
  o de un dato clave, nunca como color de fondo.
- Bordes de 1px `--line`, radios 6-8px, superficies `--panel` / `--panel-2`.
- Todo **self-contained / offline**: SVG inline, fuente embebida en data-URI, sin CDNs en el release.

---

## Fuente canónica de la marca

El sistema de marca completo (4 direcciones de isotipo, paleta, tipografía) vive en un proyecto de
**Claude Design**: `Vaca Viewer logo design` (projectId `c535d6a6-f2d9-447c-a175-3e93d60c4c06`,
archivo `Vaca Viewer Marca.dc.html`). Se lee con la tool **DesignSync** (`get_file`).
