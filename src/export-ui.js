/*
  export-ui.js — cablea la sección "Exportar" (v0.3): tabs, previsualización y botones de descarga
  para la Vista 3D (export3d.js) y el corte de pozo 2D (export2d.js).
*/
import * as V from "./viewer.js";
import { export3D, capture3D } from "./export3d.js";
import { buildWellSVG, export2D } from "./export2d.js";
import { rasterizeSVG, canvasToFile, canvasToPDF } from "./util.js";

const $ = id => document.getElementById(id);
function status(id, msg, err){ const el=$(id); if(el){ el.textContent=msg||""; el.style.color=err?"var(--plug)":"var(--ink-dim)"; } }

export function initExport(){
  wireTabs();
  wire3D();
  wire2D();
  // refrescar lista de pozos y preview cada vez que la sección se hace visible
  // (sirve tanto para el click en el nav como para el atajo de teclado "2").
  const sec=document.getElementById("vexport");
  if(sec){
    new MutationObserver(()=>{ if(sec.classList.contains("active")) refreshOnEnter(); })
      .observe(sec, { attributes:true, attributeFilter:["class"] });
    if(sec.classList.contains("active")) refreshOnEnter();
  }
}

function wireTabs(){
  document.querySelectorAll(".ex-tab").forEach(btn=>btn.addEventListener("click",()=>{
    const id=btn.dataset.extab;
    document.querySelectorAll(".ex-tab").forEach(b=>b.classList.toggle("active",b===btn));
    document.querySelectorAll(".ex-pane").forEach(p=>p.classList.toggle("active",p.id===id));
    if(id==="ex2d") render2D();
  }));
}

function refreshOnEnter(){
  populateWells();
  populateWellAlpha();
  if($("ex2d")?.classList.contains("active")) render2D();
}

/* ============ 3D ============ */
/* Sliders de opacidad por pozo (uno por pozo del pad), con el color de traza de la Vista 3D
   como referencia. Se repueblan al entrar a la sección conservando los valores ya movidos. */
function populateWellAlpha(){
  const box=$("ex3d-wellops"); if(!box) return;
  const wells=V.PAD?.pad?.wells||[];
  const prev={}; box.querySelectorAll(".ex3d-walpha").forEach(s=>{ prev[s.dataset.well]=s.value; });
  if(!wells.length){ box.innerHTML=`<div class="stub">Cargá un pad para listar los pozos.</div>`; return; }
  box.innerHTML=wells.map((w,i)=>{
    const col="#"+V.WELL_COLORS[i%V.WELL_COLORS.length].toString(16).padStart(6,"0");
    const v=prev[w.id]??"100";
    return `<label class="row" title="${V.escAttr(w.id)}">
      <span style="width:10px;height:10px;border-radius:50%;background:${col};flex:none"></span>
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${V.escHtml(w.id)}</span>
      <input type="range" class="ex3d-walpha" data-well="${V.escAttr(w.id)}" min="0" max="100" step="5" value="${v}"
        style="flex:1; accent-color:var(--accent)">
      <span class="meta ex3d-walpha-val">${v}%</span></label>`;
  }).join("");
}
function readWellAlpha(){
  const m={};
  document.querySelectorAll(".ex3d-walpha").forEach(s=>{ m[s.dataset.well]=parseInt(s.value,10)/100; });
  return m;
}
function read3DOpts(){
  return { view:$("ex3d-view").value, scale:parseInt($("ex3d-scale").value,10),
    bg:$("ex3d-bg").value, theme:$("ex3d-theme").value, labels:$("ex3d-labels").checked,
    diam:parseFloat($("ex3d-diam").value), wellAlpha:readWellAlpha() };
}
function wire3D(){
  $("ex3d-diam").addEventListener("input", e=>{ $("ex3d-diam-val").textContent=parseFloat(e.target.value).toFixed(1)+"×"; });
  // delegado: las filas se recrean en cada populateWellAlpha
  $("ex3d-wellops")?.addEventListener("input", e=>{
    if(!e.target.classList?.contains("ex3d-walpha")) return;
    const val=e.target.parentElement.querySelector(".ex3d-walpha-val");
    if(val) val.textContent=e.target.value+"%";
  });
  populateWellAlpha();
  $("ex3d-preview").addEventListener("click", ()=>{
    if(!V.PAD){ status("ex3d-status","No hay pad cargado.",true); return; }
    try{
      status("ex3d-status","Renderizando…");
      const cv=capture3D(read3DOpts());
      const box=$("ex3d-box"); box.innerHTML="";
      const img=new Image(); img.src=cv.toDataURL("image/png"); img.alt="preview 3D"; box.appendChild(img);
      status("ex3d-status",`Listo · ${cv.width}×${cv.height} px`);
    }catch(e){ status("ex3d-status","Error: "+e.message,true); }
  });
  document.querySelectorAll("[data-ex3d]").forEach(btn=>btn.addEventListener("click",()=>{
    if(!V.PAD){ status("ex3d-status","No hay pad cargado.",true); return; }
    const fmt=btn.dataset.ex3d;
    try{ status("ex3d-status","Generando…");
      const cv=export3D(read3DOpts(), fmt);
      const box=$("ex3d-box"); box.innerHTML=""; const img=new Image(); img.src=cv.toDataURL("image/png"); box.appendChild(img);
      status("ex3d-status",`Descargado (${fmt==="pdf"?"PDF":fmt.split("/")[1].toUpperCase()}) · ${cv.width}×${cv.height} px`);
    }catch(e){ status("ex3d-status","Error: "+e.message,true); }
  }));
}

/* ============ 2D ============ */
function populateWells(){
  const sel=$("ex2d-well"); if(!sel) return;
  const prev=sel.value;
  const wells=V.PAD?.pad?.wells||[];
  sel.innerHTML = wells.map(w=>`<option value="${w.id}">${w.id}${w.architecture==="vertical"?" (vertical)":""}</option>`).join("");
  if(wells.some(w=>w.id===prev)) sel.value=prev;
}
function currentWell(){ const id=$("ex2d-well")?.value; return V.PAD?.pad?.wells?.find(w=>w.id===id)||null; }
function read2DOpts(){
  const el=k=>document.querySelector(`[data-ex2d-el="${k}"]`)?.checked;
  return { cx:parseFloat($("ex2d-cx").value), cy:parseFloat($("ex2d-cy").value),
    diam:parseFloat($("ex2d-diam").value), elw:parseFloat($("ex2d-elw").value),
    shoe:parseFloat($("ex2d-shoe").value), margin:parseFloat($("ex2d-margin").value),
    font:parseFloat($("ex2d-font").value), perfStages:$("ex2d-perfstages").value,
    from: $("ex2d-from").value===""?null:parseFloat($("ex2d-from").value),
    to: $("ex2d-to").value===""?null:parseFloat($("ex2d-to").value),
    theme: $("ex2d-theme").value,
    els:{ casings:el("casings"), cement:el("cement"), shoes:el("shoes"), plugs:el("plugs"),
      tbg:el("tbg"), instel:el("instel"), stages:el("stages"), perf:el("perf"),
      shorts:el("shorts"), shoetrack:el("shoetrack"), ruler:el("ruler"), extruler:el("extruler"),
      labels:el("labels") } };
}
function render2D(){
  const w=currentWell(); const box=$("ex2d-box"); if(!box) return;
  if(!w){ box.innerHTML=`<div class="ex-empty">Cargá un pad y elegí un pozo.</div>`; return; }
  try{ const { svg }=buildWellSVG(w, read2DOpts()); box.innerHTML=svg; }
  catch(e){ box.innerHTML=`<div class="ex-empty">Error: ${e.message}</div>`; }
}
function wire2D(){
  populateWells();
  ["ex2d-well","ex2d-from","ex2d-to","ex2d-theme"].forEach(id=>{
    const el=$(id); el?.addEventListener("input",()=>{ if(id==="ex2d-well") syncRangePlaceholders(); render2D(); });
    el?.addEventListener("change",render2D);
  });
  ["ex2d-cx","ex2d-cy","ex2d-diam","ex2d-shoe"].forEach(id=>$(id)?.addEventListener("input",e=>{
    $(id+"-val").textContent=parseFloat(e.target.value).toFixed(id==="ex2d-diam"||id==="ex2d-shoe"?1:2)+"×"; render2D();
  }));
  $("ex2d-elw")?.addEventListener("input",e=>{ $("ex2d-elw-val").textContent=e.target.value+" px"; render2D(); });
  $("ex2d-margin")?.addEventListener("input",e=>{ $("ex2d-margin-val").textContent=e.target.value+" px"; render2D(); });
  $("ex2d-font")?.addEventListener("input",e=>{ $("ex2d-font-val").textContent=e.target.value+" px"; render2D(); });
  $("ex2d-perfstages")?.addEventListener("input",render2D);
  document.querySelectorAll("[data-ex2d-el]").forEach(cb=>cb.addEventListener("change",render2D));
  document.querySelectorAll("[data-ex2d]").forEach(btn=>btn.addEventListener("click",async()=>{
    const w=currentWell(); if(!w){ status("ex2d-status","Elegí un pozo.",true); return; }
    try{ status("ex2d-status","Generando…"); await export2DCurrent(w, btn.dataset.ex2d);
      status("ex2d-status",`Descargado (${btn.dataset.ex2d==="pdf"?"PDF":btn.dataset.ex2d.split("/")[1].toUpperCase()}).`);
    }catch(e){ status("ex2d-status","Error: "+e.message,true); }
  }));
  syncRangePlaceholders();
  wireZoom("ex2d-box");
  wireBoxDrag("ex2d-box");
}

/* exporta el SVG tal como está en la preview (conserva cajas movidas a mano); si hay zoom
   activo lo descarta (se exporta la vista completa). Fallback: regenerar desde opts. */
async function export2DCurrent(w, fmt){
  const svgEl=$("ex2d-box")?.querySelector("svg");
  if(!svgEl){ await export2D(w, read2DOpts(), fmt); return; }
  const clone=svgEl.cloneNode(true);
  if(svgEl.dataset.vb0) clone.setAttribute("viewBox", svgEl.dataset.vb0);
  const W=parseFloat(svgEl.getAttribute("width")), H=parseFloat(svgEl.getAttribute("height"));
  const str=new XMLSerializer().serializeToString(clone);
  const canvas=await rasterizeSVG(str, W, H, "#ffffff", 2);
  const stamp=new Date().toISOString().slice(0,10);
  const base=`${(w.id||"pozo").replace(/[^\w.-]+/g,"_")}_corte_${stamp}`;
  if(fmt==="pdf"){ if(!canvasToPDF(canvas, base+".pdf")) throw new Error("jsPDF no está disponible"); }
  else canvasToFile(canvas, fmt, base+(fmt==="image/jpeg"?".jpg":".png"));
}

/* ---- zoom con rectángulo (rubber-band): arrastrar = zoom al área; click = volver a vista total ---- */
function wireZoom(boxId){
  const box=$(boxId); if(!box) return;
  box.style.position="relative";
  let start=null, marquee=null;
  const svgOf=()=>box.querySelector("svg");
  box.addEventListener("pointerdown",e=>{
    if(e.button!==0 || e.target.closest(".vbox")) return;   // el drag de cajas tiene prioridad
    if(!svgOf()) return;
    start={x:e.clientX, y:e.clientY};
    marquee=document.createElement("div");
    marquee.style.cssText="position:absolute; border:1.5px dashed #4ea1d3; background:rgba(78,161,211,.12); pointer-events:none; z-index:5";
    box.appendChild(marquee);
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove",e=>{
    if(!start||!marquee) return;
    const r=box.getBoundingClientRect();
    marquee.style.left=(Math.min(start.x,e.clientX)-r.left+box.scrollLeft)+"px";
    marquee.style.top=(Math.min(start.y,e.clientY)-r.top+box.scrollTop)+"px";
    marquee.style.width=Math.abs(e.clientX-start.x)+"px";
    marquee.style.height=Math.abs(e.clientY-start.y)+"px";
  });
  box.addEventListener("pointerup",e=>{
    if(!start) return;
    const s=start; start=null;
    if(marquee){ marquee.remove(); marquee=null; }
    const svg=svgOf(); if(!svg) return;
    const dx=Math.abs(e.clientX-s.x), dy=Math.abs(e.clientY-s.y);
    if(dx<8 && dy<8){                                       // click: volver a la vista completa
      if(svg.dataset.vb0){ svg.setAttribute("viewBox", svg.dataset.vb0); delete svg.dataset.vb0; }
      return;
    }
    const ctm=svg.getScreenCTM(); if(!ctm) return;
    const inv=ctm.inverse(), pt=svg.createSVGPoint();
    const toSvg=(cx,cy)=>{ pt.x=cx; pt.y=cy; return pt.matrixTransform(inv); };
    const p1=toSvg(Math.min(s.x,e.clientX), Math.min(s.y,e.clientY));
    const p2=toSvg(Math.max(s.x,e.clientX), Math.max(s.y,e.clientY));
    let x=p1.x, y=p1.y, w=p2.x-p1.x, h=p2.y-p1.y;
    if(w<2||h<2) return;
    if(!svg.dataset.vb0) svg.dataset.vb0=svg.getAttribute("viewBox");
    // el lado "más grande" del rectángulo manda: se expande el otro a la proporción de la imagen
    const [,,vw,vh]=svg.dataset.vb0.split(/\s+/).map(Number);
    const ar=vw/vh;
    if(w/h>ar){ const nh=w/ar; y-=(nh-h)/2; h=nh; } else { const nw=h*ar; x-=(nw-w)/2; w=nw; }
    svg.setAttribute("viewBox", `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  });
}

/* ---- cajas de etiqueta arrastrables: mouse-over muestra el puntero, drag las mueve y el líder sigue.
   El shoetrack es UNA caja (lista sus componentes), así que el pack se mueve entero con este drag. ---- */
function wireBoxDrag(boxId){
  const box=$(boxId); if(!box) return;
  let drag=null;
  box.addEventListener("pointerdown",e=>{
    const g=e.target.closest(".vbox"); if(!g) return;
    const svg=box.querySelector("svg"); if(!svg) return;
    const ctm=svg.getScreenCTM(); if(!ctm) return;
    const inv=ctm.inverse(), pt=svg.createSVGPoint();
    const toSvg=(cx,cy)=>{ pt.x=cx; pt.y=cy; return pt.matrixTransform(inv); };
    drag={ g, svg, toSvg, p0:toSvg(e.clientX,e.clientY),
      tx0:parseFloat(g.dataset.tx||"0"), ty0:parseFloat(g.dataset.ty||"0") };
    g.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  box.addEventListener("pointermove",e=>{
    if(!drag) return;
    const p=drag.toSvg(e.clientX,e.clientY);
    const tx=drag.tx0+p.x-drag.p0.x, ty=drag.ty0+p.y-drag.p0.y;
    drag.g.dataset.tx=tx; drag.g.dataset.ty=ty;
    drag.g.setAttribute("transform",`translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
    const lead=drag.svg.querySelector(`.vlead[data-vb="${drag.g.dataset.vb}"]`);
    if(lead){
      const bx=parseFloat(drag.g.dataset.x)+tx, by=parseFloat(drag.g.dataset.y)+ty;
      const bw=parseFloat(drag.g.dataset.w), bh=parseFloat(drag.g.dataset.h);
      const ax=parseFloat(lead.getAttribute("x1"));
      lead.setAttribute("x2", (ax < bx+bw/2 ? bx : bx+bw).toFixed(1));
      lead.setAttribute("y2", (by+bh/2).toFixed(1));
    }
  });
  box.addEventListener("pointerup",()=>{ drag=null; });
}
function syncRangePlaceholders(){
  const w=currentWell(); if(!w) return;
  const td=w.survey?.stations?.at(-1)?.md;
  if(td!=null){ $("ex2d-to").placeholder=String(Math.round(td)); $("ex2d-from").placeholder="0"; }
}
