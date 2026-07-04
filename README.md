# Vaca Viewer

Visor 3D de pozos y pads para terminación no convencional (Vaca Muerta).
Aplicación web de un solo archivo: se abre con el navegador, sin instalar nada,
funciona offline, y los datos nunca salen de tu equipo.

**Autor:** Gonzalo Carvallo — © 2026. Todos los derechos reservados (ver `LICENSE`).

## Qué hace (estado v0.1)

- **Vista 3D** del pad a escala real (1:1), navegación estilo CAD (orbitar, desplazar, zoom).
- Capas activables/desactivables: por pozo y por elemento (trayectoria, cañería,
  punzados, tapones, etapas).
- Andamiaje de las secciones **Exportar**, **Datos** y **Configuración**.

Trae un pad de demostración sintético para probar la navegación. Los parsers de
survey (XLS), tally (PDF) y fracplan (XLS) y el render desde datos reales se
integran en la próxima iteración (formato ya especificado en `docs/data-schema.md`).

## Cómo se usa

Doble clic en `index.html`, o servido localmente:

```bash
# opción simple (requiere Python)
python3 -m http.server 8080
# luego abrir http://localhost:8080
```

> Servir por HTTP evita restricciones de algunos navegadores con `file://` y
> módulos ES. Para uso offline real, el navegador cachea los CDN tras la 1ra carga.

Atajos: `1`–`4` cambian de sección · rueda = zoom · arrastrar = orbitar ·
click derecho = desplazar.

## Estructura

```
index.html            la app entera
LICENSE               copyright
docs/data-schema.md   formato JSON del pad (formato de intercambio)
samples/              pads de ejemplo (json/zip)
```

## Desarrollo

Editar `index.html` directo (VS Code o `nano` por SSH). No hay build.

```bash
git clone git@github.com:gonzacarv/vaca-viewer.git
```

Los datos reales de pozos van en `data/` (ignorada por git). El repo solo lleva
código y ejemplos anonimizados.

## Roadmap corto

1. Parsers reales (survey/tally/fracplan) → carga del pad MMo-35 completo.
2. Sección Exportar: corte lateral 2D → PNG/JPG por pozo.
3. Editor de datos con copiar/pegar de tablas + export ZIP del pad.
4. Persistencia local (IndexedDB) entre sesiones.
5. Regla de medición y dogleg coloreado en 3D.
