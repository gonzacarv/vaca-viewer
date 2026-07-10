/*
  util.js — helpers puros para Exportar (v0.3). Sin dependencia de estado del visor ni de THREE.
  Se reutilizan desde export3d.js y export2d.js. Las funciones "de negocio" (interpAtMD, fmtOD,
  paletas, etc.) se reexportan desde viewer.js para no duplicarlas.
*/

/* Dispara la descarga de un dataURL (o blob URL) con un nombre de archivo. */
export function saveDataURL(url, filename){
  const a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
}
export function saveBlob(blob, filename){
  const url=URL.createObjectURL(blob);
  saveDataURL(url, filename);
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

/* Número hex (0xrrggbb) → {r,g,b} 0..255 */
export function hexToRgb(hex){
  return { r:(hex>>16)&255, g:(hex>>8)&255, b:hex&255 };
}
export function rgbToCss({r,g,b}){ return `rgb(${r|0},${g|0},${b|0})`; }

/* Luminancia perceptual (0..255) de un color hex numérico. */
export function luminance(hex){ const {r,g,b}=hexToRgb(hex); return 0.2126*r+0.7152*g+0.0722*b; }

/* Escala de grises (para modo B&N). Devuelve css. */
export function grayCss(hex){ const l=Math.round(luminance(hex)); return `rgb(${l},${l},${l})`; }

/* Oscurece un color hacia negro por factor f (0=igual, 1=negro). Devuelve css. */
export function darkenCss(hex, f){
  const {r,g,b}=hexToRgb(hex); const k=1-Math.max(0,Math.min(1,f));
  return `rgb(${Math.round(r*k)},${Math.round(g*k)},${Math.round(b*k)})`;
}

/* Serializa un <svg> (o su outerHTML string) a data URL image/svg+xml. */
export function svgToDataURL(svgString){
  // encodeURIComponent maneja acentos/°/símbolos; evita problemas de btoa con no-Latin1.
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgString);
}

/* Rasteriza un SVG string a un canvas de wPx×hPx con fondo (default blanco).
   Devuelve Promise<HTMLCanvasElement>. */
export function rasterizeSVG(svgString, wPx, hPx, bg="#ffffff", scale=1){
  return new Promise((resolve, reject)=>{
    const img=new Image();
    img.onload=()=>{
      const cv=document.createElement("canvas");
      cv.width=Math.round(wPx*scale); cv.height=Math.round(hPx*scale);
      const ctx=cv.getContext("2d");
      if(bg){ ctx.fillStyle=bg; ctx.fillRect(0,0,cv.width,cv.height); }
      ctx.drawImage(img,0,0,cv.width,cv.height);
      resolve(cv);
    };
    img.onerror=()=>reject(new Error("no se pudo rasterizar el SVG"));
    img.src=svgToDataURL(svgString);
  });
}

/* Exporta un canvas a archivo en el formato pedido. mime: image/png|image/jpeg. */
export function canvasToFile(canvas, mime, filename, quality=0.95){
  if(mime==="image/jpeg"){
    // matte blanco por si el canvas tuviera alpha
    const flat=document.createElement("canvas"); flat.width=canvas.width; flat.height=canvas.height;
    const c=flat.getContext("2d"); c.fillStyle="#ffffff"; c.fillRect(0,0,flat.width,flat.height);
    c.drawImage(canvas,0,0); canvas=flat;
  }
  saveDataURL(canvas.toDataURL(mime, quality), filename);
}

/* Coloca la imagen de un canvas en un PDF (jsPDF) ajustada a la página, y lo descarga.
   Requiere window.jspdf (UMD). Devuelve true si pudo, false si la lib no está. */
export function canvasToPDF(canvas, filename, opts={}){
  const J = window.jspdf && window.jspdf.jsPDF;
  if(!J) return false;
  const landscape = canvas.width >= canvas.height;
  const pdf = new J({ orientation: landscape?"landscape":"portrait", unit:"pt", format:"a4" });
  const pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight();
  const margin = opts.margin ?? 24;
  const availW=pw-2*margin, availH=ph-2*margin;
  const ar=canvas.width/canvas.height;
  let w=availW, h=w/ar;
  if(h>availH){ h=availH; w=h*ar; }
  const x=(pw-w)/2, y=(ph-h)/2;
  // fondo blanco explícito
  pdf.setFillColor(255,255,255); pdf.rect(0,0,pw,ph,"F");
  pdf.addImage(canvas.toDataURL("image/jpeg",0.95), "JPEG", x, y, w, h);
  pdf.save(filename);
  return true;
}
