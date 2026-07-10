/*
  export3d.js — captura de la Vista 3D para documentos (v0.3).
  Renderiza la escena a un canvas de alta resolución con fondo blanco (o oscuro), tema claro/B&N,
  compone las etiquetas HTML (que no viven en el canvas WebGL) y exporta PNG/JPG/PDF.
  Todo es síncrono: guarda estado, rinde, captura y restaura sin que el loop en vivo interfiera.
*/
import * as V from "./viewer.js";
import { canvasToFile, canvasToPDF, saveDataURL } from "./util.js";

const THREE = V.THREE;

/* Orientaciones de cámara (paridad con setView de viewer.js). */
const VIEW_DIRS = {
  iso:   { phi:1.05,          theta:0.7 },
  top:   { phi:0.001,         theta:0 },
  north: { phi:Math.PI/2,     theta:0 },
  south: { phi:Math.PI/2,     theta:Math.PI },
  east:  { phi:Math.PI/2,     theta:-Math.PI/2 },
  west:  { phi:Math.PI/2,     theta:Math.PI/2 },
};

/* Color de texto por tipo de etiqueta, legible sobre blanco. */
const LABEL_INK = {
  tpn:"#b3261e", stage:"#1a7f37", short:"#8a6d00", install:"#0b7285",
  shoetrack:"#6d28d9", shoe:"#20242a", toc:"#7a5c00",
};

function lum01(c){ return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; }

/* Aplica un tema de export a todos los materiales de los pozos y guarda los originales
   en `store` para poder restaurarlos. theme: "light" | "bw" | "asis". */
function applyTheme(theme, store){
  V.world.traverse(o=>{
    const mats = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : [];
    mats.forEach(m=>{
      if(!m || store.has(m)) return;
      store.set(m, { color:m.color?m.color.clone():null,
        emissive:m.emissive?m.emissive.clone():null, vertexColors:m.vertexColors });
      if(!m.color) return;
      if(theme==="bw"){
        const g=lum01(m.color); m.color.setRGB(g,g,g);
        if(m.vertexColors){ m.vertexColors=false; m.color.setRGB(0.5,0.5,0.5); }
        if(m.emissive) m.emissive.setRGB(0,0,0);
      } else if(theme==="light"){
        // aclarar demasiado sobre blanco = invisible: oscurecer los casi-blancos
        if(!m.vertexColors && lum01(m.color)>0.72){ m.color.multiplyScalar(0.45); }
        if(m.emissive) m.emissive.setRGB(0,0,0);   // sin glow para papel
      }
      m.needsUpdate=true;
    });
  });
}
function restoreTheme(store){
  store.forEach((orig,m)=>{
    if(orig.color && m.color) m.color.copy(orig.color);
    if(orig.emissive && m.emissive) m.emissive.copy(orig.emissive);
    m.vertexColors = orig.vertexColors; m.needsUpdate=true;
  });
}

/* Determina si una etiqueta debe verse, replicando la lógica de updateLabels() de viewer.js. */
function labelEnabled(l){
  const flags = { tpn:V.SHOW_TPN_LABELS, stage:V.SHOW_STAGE_LABELS, shoe:V.SHOW_SHOE_LABELS,
    short:V.SHOW_SHORT_LABELS, install:V.SHOW_INSTALL_LABELS, shoetrack:V.SHOW_SHOETRACK_LABELS,
    toc:V.SHOW_TOC_LABELS };
  if(!flags[l.kind]) return false;
  const g = V.wellObjects[l.wellId];
  if(g && g.visible===false) return false;
  const vw = V.VIS[l.wellId];
  const elemKey = l.kind==="tpn" ? "plug"
    : (l.kind==="short"||l.kind==="install"||l.kind==="shoetrack"||l.kind==="toc") ? l.kind : null;
  if(vw && elemKey && vw[elemKey]===false) return false;
  return true;
}

/* Dibuja el texto de una etiqueta (multilínea, se toma solo el texto, sin HTML). */
function drawLabelText(ctx, text, x, y, ink, fontPx){
  const lines = String(text).replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").split("\n");
  ctx.font = `600 ${fontPx}px ui-monospace, Consolas, monospace`;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.lineJoin="round"; ctx.lineWidth=Math.max(2, fontPx*0.28); ctx.strokeStyle="#ffffff";
  const lh=fontPx*1.28, y0=y-(lines.length-1)*lh/2;
  lines.forEach((ln,i)=>{ const yy=y0+i*lh;
    ctx.strokeText(ln, x, yy); ctx.fillStyle=ink; ctx.fillText(ln, x, yy); });
}

/* Captura síncrona → devuelve un canvas 2D listo para exportar. */
export function capture3D(opts){
  const { view="iso", scale=2, bg="white", theme="light", labels=true } = opts||{};
  const renderer=V.renderer, scene=V.scene, camera=V.camera, sph=V.sph, target=V.target;

  // --- guardar estado ---
  const size=renderer.getSize(new THREE.Vector2());
  const baseW=Math.max(2, Math.round(size.x)), baseH=Math.max(2, Math.round(size.y));
  const prevPR=renderer.getPixelRatio();
  const prevBg=scene.background;
  const prevAspect=camera.aspect, prevNear=camera.near, prevFar=camera.far;
  const savedSph={phi:sph.phi, theta:sph.theta, radius:sph.radius};
  const savedTarget=target.clone();
  const savedGrid=V.gridGroup.visible, savedAxes=V.axes.visible;
  const savedDiam=V.diamExag;
  const doBoost = opts.diam && Math.abs(opts.diam-1)>0.01 && V.PAD;
  const store=new Map();

  const W=Math.round(baseW*scale), H=Math.round(baseH*scale);
  const bgHex = bg==="white" ? 0xffffff : 0x0d1117;

  try{
    // --- engordar cañerías para la foto (rebuild ANTES del tema, que guarda los materiales) ---
    if(doBoost) V.setDiamExagForExport(savedDiam*opts.diam);
    // --- tema + fondo ---
    scene.background = new THREE.Color(bgHex);
    if(bg==="white"){ V.gridGroup.visible=false; V.axes.visible=false; }
    applyTheme(bg==="white"?theme:(theme==="bw"?"bw":"asis"), store);

    // --- cámara ---
    // el rebuild del boost llama frameAll y mueve sph/target: restaurar la vista guardada primero
    sph.phi=savedSph.phi; sph.theta=savedSph.theta; sph.radius=savedSph.radius; target.copy(savedTarget);
    if(view!=="current" && VIEW_DIRS[view]){
      sph.phi=VIEW_DIRS[view].phi; sph.theta=VIEW_DIRS[view].theta;
      V.frameAll();   // reencuadra a la nueva orientación (modifica target/sph.radius; se restaura luego)
    }
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect=W/H;
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(target);
    camera.near=Math.max(0.05, sph.radius*0.0015);
    camera.far=sph.radius + 60000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);

    // --- componer sobre canvas 2D ---
    const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
    const ctx=cv.getContext("2d");
    ctx.fillStyle = bg==="white" ? "#ffffff" : "#0d1117";
    ctx.fillRect(0,0,W,H);
    ctx.drawImage(renderer.domElement, 0, 0, W, H);

    if(labels){
      const fontPx=Math.round(12*scale);
      const _p=new THREE.Vector3();
      for(const l of V.LABELS){
        if(!labelEnabled(l)) continue;
        _p.copy(l.pos).project(camera);
        if(_p.z>1 || _p.x<-1.05 || _p.x>1.05 || _p.y<-1.05 || _p.y>1.05) continue;
        const sx=(_p.x*0.5+0.5)*W, sy=(-_p.y*0.5+0.5)*H;
        const ink = bg==="white" ? (LABEL_INK[l.kind]||"#20242a") : "#e6edf3";
        drawLabelText(ctx, l.el.textContent, sx, sy, ink, fontPx);
      }
    }
    return cv;
  } finally {
    // --- restaurar SIEMPRE ---
    restoreTheme(store);
    if(doBoost) V.setDiamExagForExport(savedDiam);   // rebuild al diámetro original
    scene.background=prevBg;
    V.gridGroup.visible=savedGrid; V.axes.visible=savedAxes;
    sph.phi=savedSph.phi; sph.theta=savedSph.theta; sph.radius=savedSph.radius;
    target.copy(savedTarget);
    renderer.setPixelRatio(prevPR);
    renderer.setSize(baseW, baseH, false);
    camera.aspect=prevAspect; camera.near=prevNear; camera.far=prevFar;
    camera.updateProjectionMatrix();
  }
}

/* Exporta a archivo. fmt: "image/png" | "image/jpeg" | "pdf". Devuelve el canvas usado. */
export function export3D(opts, fmt){
  const cv=capture3D(opts);
  const pad = V.PAD ? V.PAD.pad.id : "pad";
  const stamp = new Date().toISOString().slice(0,10);
  const base = `${pad}_3D_${opts.view||"iso"}_${stamp}`;
  if(fmt==="pdf"){
    if(!canvasToPDF(cv, base+".pdf")) throw new Error("jsPDF no está disponible");
  } else {
    canvasToFile(cv, fmt, base+(fmt==="image/jpeg"?".jpg":".png"));
  }
  return cv;
}
