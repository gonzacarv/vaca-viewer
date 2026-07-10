#!/usr/bin/env python3
"""
build.py — genera dist/index.html: un único HTML autocontenido para uso offline.

Inlina src/styles.css en un <style> y empaqueta los módulos ES de src/ (viewer, util, export*)
en un solo <script type="module">. Las librerías de CDN (three via importmap, xlsx, pdf.js, jsPDF)
se dejan como <script src=...> (para embeberlas de verdad, descargalas y pegalas a mano; acá se
mantiene la referencia CDN, igual que en index.html).

El bundle envuelve cada módulo en un IIFE con un objeto `exports` y expone cada símbolo exportado
como getter (Object.defineProperty), replicando exactamente las "live bindings" de ES modules
(clave para que export3d.js lea el PAD/flags actuales del visor). No usa ningún bundler externo.

Uso:  python3 build.py
"""
import os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")

# Orden de evaluación (dependencias primero). main.js va último (arranca la app).
MODULE_ORDER = ["util.js", "viewer.js", "export3d.js", "export2d.js", "export-ui.js", "main.js"]

def transform(src):
    """Devuelve (cuerpo_transformado, nombres_exportados, usa_three)."""
    exported = []
    uses_three = bool(re.search(r'^\s*import\s+\*\s+as\s+THREE\s+from\s+"three";', src, re.M))

    # quitar `import * as THREE from "three";`
    src = re.sub(r'^\s*import\s+\*\s+as\s+THREE\s+from\s+"three";\s*$', "", src, flags=re.M)
    # `import * as V from "./x.js";`  -> const V = __ns["./x.js"];
    src = re.sub(r'^\s*import\s+\*\s+as\s+(\w+)\s+from\s+"(\.\/[^"]+)";\s*$',
                 lambda m: f'const {m.group(1)} = __ns["{m.group(2)}"];', src, flags=re.M)
    # `import { a, b } from "./x.js";` -> const { a, b } = __ns["./x.js"];
    src = re.sub(r'^\s*import\s+\{([^}]*)\}\s+from\s+"(\.\/[^"]+)";\s*$',
                 lambda m: f'const {{{m.group(1)}}} = __ns["{m.group(2)}"];', src, flags=re.M)
    # `import "./x.js";` (efecto secundario) -> nada (ya evaluado por orden)
    src = re.sub(r'^\s*import\s+"(\.\/[^"]+)";\s*$', "", src, flags=re.M)

    # `export { a, b, c };`  (posible multilínea)
    def _collect_block(m):
        for name in m.group(1).split(","):
            n = name.strip().split(" as ")[0].strip()
            if n: exported.append(n)
        return ""
    src = re.sub(r'^\s*export\s*\{([^}]*)\};', _collect_block, src, flags=re.M | re.S)

    # `export function NAME` / `export async function NAME`
    for m in re.finditer(r'^\s*export\s+(?:async\s+)?function\s+(\w+)', src, flags=re.M):
        exported.append(m.group(1))
    # `export const/let/var NAME`
    for m in re.finditer(r'^\s*export\s+(?:const|let|var)\s+(\w+)', src, flags=re.M):
        exported.append(m.group(1))
    # quitar el keyword `export ` de las declaraciones
    src = re.sub(r'^(\s*)export\s+(async\s+function|function|const|let|var)\b',
                 r'\1\2', src, flags=re.M)

    exported = list(dict.fromkeys(exported))  # dedupe conservando orden
    return src, exported, uses_three

def wrap(mod_key, body, exported):
    getters = "\n".join(
        f'  Object.defineProperty(exports, "{n}", {{ get:()=>{n}, enumerable:true }});'
        for n in exported)
    return (f'/* ===== {mod_key} ===== */\n'
            f'__ns["./{mod_key}"] = (function(){{\n'
            f'  "use strict";\n  const exports = {{}};\n'
            f'{body}\n'
            f'{getters}\n'
            f'  return exports;\n}})();\n')

def build():
    any_three = False
    parts = []
    for name in MODULE_ORDER:
        src = open(os.path.join(SRC, name), encoding="utf-8").read()
        body, exported, uses_three = transform(src)
        any_three = any_three or uses_three
        parts.append(wrap(name, body, exported))

    bundle = ""
    if any_three:
        bundle += 'import * as THREE from "three";\n'
    bundle += "const __ns = {};\n" + "\n".join(parts)

    css = open(os.path.join(SRC, "styles.css"), encoding="utf-8").read()
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

    html = html.replace('<link rel="stylesheet" href="src/styles.css">',
                        "<style>\n" + css + "\n</style>", 1)
    html = html.replace('<script type="module" src="src/main.js"></script>',
                        '<script type="module">\n' + bundle + '\n</script>', 1)
    # el logo/isotipo es SVG inline en index.html → no hay assets externos que incrustar

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "index.html")
    open(out, "w", encoding="utf-8").write(html)
    print(f"dist/index.html escrito ({len(html)} bytes, {len(MODULE_ORDER)} módulos)")

if __name__ == "__main__":
    build()
