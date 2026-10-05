#!/usr/bin/env python3
"""
build_dist.py — genera dist/vaca-viewer.html: un ÚNICO HTML 100% offline y self-contained.

A diferencia de build.py (que deja las libs como CDN y usa ES modules + importmap → necesita
servidor HTTP e internet), esta versión:
  · embebe three (UMD → global THREE), xlsx (SheetJS), pdf.js + su worker, y jsPDF;
  · convierte el bundle de la app a un <script> normal (sin `import`, sin type=module),
    referenciando el THREE global;
  · el worker de pdf.js se arma con un Blob desde el fuente inlineado.
Resultado: se abre con DOBLE-CLICK (file://) sin servidor ni internet. Ideal para SharePoint.

Las libs se cachean en vendor/ (gitignored); si faltan, se descargan de cdnjs (requiere internet
SOLO al compilar). Uso:  python3 build_dist.py
"""
import os, re, urllib.request, build   # reusa transform/wrap/MODULE_ORDER de build.py

ROOT=os.path.dirname(os.path.abspath(__file__))
VENDOR=os.path.join(ROOT,"vendor")
CDN={
 "three.min.js":"https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js",
 "xlsx.full.min.js":"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
 "pdf.min.js":"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
 "pdf.worker.min.js":"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
 "jspdf.umd.min.js":"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
}

def lib(name):
    p=os.path.join(VENDOR,name)
    if not os.path.exists(p):
        os.makedirs(VENDOR,exist_ok=True)
        print("descargando",name,"…"); urllib.request.urlretrieve(CDN[name],p)
    src=open(p,encoding="utf-8").read()
    assert "</script" not in src, f"{name} contiene </script> (no se puede inlinear directo)"
    return re.sub(r'(?m)^\s*//#\s*sourceMappingURL=.*$', "", src)   # sin .map (evita 404 en devtools)

def app_bundle():
    parts=[]
    for name in build.MODULE_ORDER:
        src=open(os.path.join(build.SRC,name),encoding="utf-8").read()
        body,exported,_=build.transform(src)     # transform quita el `import * as THREE`
        parts.append(build.wrap(name,body,exported))
    return "const __ns = {};\n"+"\n".join(parts)  # sin `import`: THREE es global (UMD)

def s(js): return "<script>\n"+js+"\n</script>"

def main():
    css=open(os.path.join(build.SRC,"styles.css"),encoding="utf-8").read()
    html=open(os.path.join(ROOT,"index.html"),encoding="utf-8").read()
    html=html.replace('<link rel="stylesheet" href="src/styles.css">',"<style>\n"+css+"\n</style>",1)
    html=html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>',
                      s(lib("xlsx.full.min.js")),1)
    html=html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>',
                      s(lib("pdf.min.js")),1)
    # worker de pdf.js: se guarda como texto (no ejecutable) y se arma un Blob URL en runtime
    worker='<script id="__pdfworker" type="javascript/worker">\n'+lib("pdf.worker.min.js")+'\n</script>\n'+s(
        'try{var __w=document.getElementById("__pdfworker").textContent;'
        'var __u=URL.createObjectURL(new Blob([__w],{type:"application/javascript"}));'
        'if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc=__u;}catch(e){console.warn("pdf worker offline:",e);}')
    html=html.replace('<script>if(window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";</script>',
                      worker,1)
    html=html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>',
                      s(lib("jspdf.umd.min.js")),1)
    importmap=('<script type="importmap">\n'
               '{ "imports": { "three": "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js" }}\n'
               '</script>')
    html=html.replace(importmap, s(lib("three.min.js")),1)      # three UMD → global THREE
    html=html.replace('<script type="module" src="src/main.js"></script>', s(app_bundle()),1)

    # chequeo: no debe quedar NINGUNA dependencia de red al cargar (tags de script externos / módulos).
    # (Un string 'cdnjs' suelto dentro de una lib minificada —jsPDF— es inofensivo: no hace fetch.)
    for bad in ('src="https://', 'href="https://cdnjs', "importmap", 'type="module"',
                'href="src/styles.css"', 'src="src/main.js"'):
        assert bad not in html, f"quedó una referencia externa/no-inlineada: {bad!r}"
    os.makedirs(os.path.join(ROOT,"dist"),exist_ok=True)
    out=os.path.join(ROOT,"dist","vaca-viewer.html")
    open(out,"w",encoding="utf-8").write(html)
    print(f"dist/vaca-viewer.html escrito ({len(html)//1024} KB, 100% offline)")

if __name__=="__main__":
    main()
