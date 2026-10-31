/*
  export2d.js — corte transversal de pozo (esquema oil & gas), SVG, para documentos (v0.3).

  ESTRATEGIA: camino CANÓNICO parametrizado por MD (no se sigue el survey punto a punto).
  El dibujo es ideal —tronco perfectamente vertical + cuarto de círculo de 90° + lateral
  perfectamente horizontal— y los DATOS definen dónde cae cada elemento sobre ese camino:
  el tronco se ubica por TVD, el arco entre kick-off y landing (detectados del survey), y el
  lateral se recorre por MD. Look "de manual": cañerías de paredes negras gruesas con interior
  blanco, cemento punteado (TOC→zapato), zapatos = triángulos macizos hacia afuera, tapones =
  bloque negro, packers = bloques por fuera del TBG, punzados = rayos hacia la formación.
  Instalación (v0.6): TBG/VB por rango, fluidos (solapados = rayado alternado), TPN de cemento
  (gris con pintas), ancla, bomba (rayado cruzado), BHA (fresa ± motor) y carteles con flecha.
*/
import * as V from "./viewer.js";
import { rasterizeSVG, canvasToFile, canvasToPDF } from "./util.js";

/* ---- semiancho (px) por fase, anidados. No son OD reales: priorizan legibilidad ---- */
const HALF = { guia:34, intermedia1:26, intermedia2:19, produccion:13 };
const TBG_HALF = 6;
/* el esquema no es a escala: un cambio de OD por tramo se exagera para que se lea (5½" sobre 5" = +30%) */
const SEG_OD_GAIN = 3;
/* un TBG más fino que el mayor del pozo también se exagera (2⅜" sobre 2⅞" = −35%), con piso */
const TBG_OD_GAIN = 2, TBG_MIN_RATIO = 0.55;
/* holgura mínima (px) entre los ejes de las paredes de dos cañerías anidadas: la pared + aire visible */
const WALL_CLEAR = 7.2;
/* AJUSTE ESQUEMÁTICO: lo que queda muy junto o muy corto se separa estirando el camino (el lienzo crece),
   y lo que cae en el arco baja la curva para quedar en el tronco. La regla sigue al mismo mapeo. */
const BBA_PX = 18;                     // largo de la bomba, siempre desde su MD hacia abajo
const SCHEM_GAP = 14, SCHEM_GAP_BARE = 6, SCHEM_ARC_CLEAR = 18;
const SCHEM_MIN_LEN = { TBG:34, VB:10, TPNC:16, FLUIDO:12 };
/* varillas de bombeo: trazo fino, apenas (casi imperceptiblemente) más grueso cuanto mayor el Ø */
const VB_W = { "3/4":1.7, "7/8":1.8, "1":1.9, "1.5":2.05, vastago:2.2 };
const PHASE_ORDER = ["guia","intermedia1","intermedia2","produccion"];

const INK="#111", DIM="#6a7178", WALL_W=3.2;
const POINT_TYPES=["TPN","PKR","ANCLA","BBA","BHA"];
const STAGE_PAL = ["#1f77b4","#e07a00","#2ca02c","#c02a2a","#8a5cc0","#8c564b","#c85aa8","#0f8fa6","#9a9a1e","#5a5a5a"];

/* rampa dogleg (misma que la Vista 3D): 0→verde puro, medio→amarillo, máx→rojo.
   Se normaliza al DLS máximo del rango visible (auto-normalización, como el isoMode 3D). */
const DLS_LOW=[0,227,58], DLS_MID=[255,229,0], DLS_HIGH=[255,30,30];
function dlsColor(t){
  t=Math.max(0,Math.min(1,t||0));
  const mix=(a,b,u)=>a.map((v,i)=>Math.round(v+(b[i]-v)*u));
  const c=t<0.5?mix(DLS_LOW,DLS_MID,t/0.5):mix(DLS_MID,DLS_HIGH,(t-0.5)/0.5);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const esc = V.escHtml;
const f1 = n => Math.round(n*10)/10;

function sampleMD(st, md){ const p = V.interpAtMD(st, md, 0); return { tvd:p.tvd, h:Math.hypot(p.x, p.y) }; }

/* landing: donde el avance pasa a ser más horizontal que vertical (lateral) */
function findLanding(st){
  const tvd=i=>st[i].tvd||0, h=i=>Math.hypot(st[i].ew||0, st[i].ns||0);
  for(let i=1;i<st.length;i++){
    const dTvd=tvd(i)-tvd(i-1), dH=h(i)-h(i-1);
    if(h(i)>80 && dH>dTvd && dH>2) return st[i-1].md;
  }
  return st.at(-1).md;
}
/* kick-off canónico: el arco es un cuarto de círculo "agresivo" de radio Rm (en metros TVD).
   Empieza recién donde la TVD alcanza tvdLand−Rm, así el KOP dibujado no se adelanta por el
   drift/tortuosidad del survey y los zapatos someros quedan claramente en el tramo vertical. */
function findKick(st, landingMD, tvdLand, Rm){
  const target=tvdLand-Rm;
  let prev=st[0];
  for(const s of st){
    if(s.md>=landingMD) break;
    if((s.tvd||0)>=target){
      const t=(target-(prev.tvd||0))/(((s.tvd||0)-(prev.tvd||0))||1);
      return prev.md+(s.md-prev.md)*t;
    }
    prev=s;
  }
  return Math.max(0, landingMD-1);
}

/* ============ construcción del SVG ============ */
export function buildWellSVG(w, opts={}){
  const o = { cx:1, cy:1, diam:1, elw:6, shoe:1, font:10.5, margin:0, perfStages:"", from:null, to:null, theme:"color",
    els:{ casings:true, cement:true, shoes:true, plugs:true, tbg:true, instel:true, stages:true,
          perf:true, shorts:false, xovers:true, shoetrack:false, ruler:true, extruler:false, labels:true,
          fluids:true, cemplug:true, rods:true, bha:true, notes:true, schem:true }, ...opts };
  const bw = o.theme==="bw";
  const dg = o.theme==="dogleg";
  const FS = Math.max(6, o.font||10.5);                  // tamaño de letra base (px)
  const stageFilter = V.parseStages(o.perfStages);       // null = todas las etapas punzadas
  const st = w.survey?.stations || [];
  if(st.length<2) return emptySVG(`Sin survey para ${esc(w.id)}`);

  const TD = st.at(-1).md;
  const hMaxFull = Math.max(...st.map(s=>Math.hypot(s.ew||0,s.ns||0)));
  const isVerticalWell = (w.architecture==="vertical") || hMaxFull<40;
  const landingMD = isVerticalWell ? TD : findLanding(st);
  // radio del arco esquemático (m TVD): ~8% de la TVD de landing, acotado — curva "agresiva"
  const tvdLandFull = isVerticalWell ? 0 : sampleMD(st, landingMD).tvd;
  const Rm = Math.min(300, Math.max(120, tvdLandFull*0.08));
  const kickMD = isVerticalWell ? TD : findKick(st, landingMD, tvdLandFull, Rm);
  const fromMD = Math.max(0, Math.min(o.from==null?0:o.from, TD-1));
  const toMD   = Math.max(fromMD+1, Math.min(o.to==null?TD:o.to, TD));

  const casings=(w.casings||[]).slice().sort((a,b)=>PHASE_ORDER.indexOf(a.phase)-PHASE_ORDER.indexOf(b.phase));
  const tbgHalf = TBG_HALF * o.diam;
  // relación de un tramo respecto de la cañería, y su rango en todos los tramos
  const odRatio = (c,od) => (!od || !c.od_in || od===c.od_in) ? 1 : Math.max(0.5, 1+(od/c.od_in-1)*SEG_OD_GAIN);
  const ratioRange = c => { const rs=[1, ...(c?.segments||[]).map(s=>odRatio(c,s.od_in))]; return [Math.min(...rs), Math.max(...rs)]; };
  // semianchos anidados, de adentro hacia afuera: el MÍNIMO de cada cañería deja WALL_CLEAR sobre el MÁXIMO
  // de la que lleva adentro, en cualquier tramo y con cualquier Ø del slider. Si no entra, crece la externa.
  const halves={};
  let maxHalf=tbgHalf;
  for(const ph of PHASE_ORDER.slice().reverse()){
    const [rMin,rMax]=ratioRange(casings.find(c=>c.phase===ph));
    halves[ph]=Math.max((HALF[ph]||13)*o.diam, (maxHalf+WALL_CLEAR)/rMin);
    maxHalf=halves[ph]*rMax;
  }
  const HW = ph => halves[ph]??halves.produccion;
  const prodHalf = HW("produccion");
  const minHalfOf = c => HW(c.phase)*ratioRange(c)[0];
  const maxHalfOf = c => HW(c.phase)*ratioRange(c)[1];
  // semiancho de una cañería en un MD, según su tramo
  const halfAt = (c,md) => HW(c.phase)*odRatio(c, V.casingSegAt(c,md)?.od_in);
  const covering = md => casings.filter(c=>c.shoe_md!=null && c.shoe_md>=md-1e-6);
  const innerHalf = md => { const c=covering(md).at(-1); return (c?halfAt(c,md):prodHalf)-WALL_W/2; };

  const tvdAt = md => sampleMD(st, md).tvd;
  // DLS interpolado por MD desde el survey (misma idea que dlsAtMD de la Vista 3D)
  const dlsAt = md => {
    if(md<=st[0].md) return st[0].dls||0;
    for(let i=1;i<st.length;i++) if(md<=st[i].md){
      const a=st[i-1], b=st[i], t=(md-a.md)/((b.md-a.md)||1);
      return (a.dls||0)+((b.dls||0)-(a.dls||0))*t;
    }
    return st.at(-1).dls||0;
  };
  const tvdFrom = tvdAt(fromMD);
  const tvdKick = tvdAt(Math.min(kickMD, toMD));
  const tvdLand = tvdAt(Math.min(landingMD, toMD));

  // --- escalas: auto-fit del rango visible, moduladas por sliders ---
  const trunkVisible = fromMD < landingMD;
  const vertSpan = trunkVisible ? Math.max(tvdLand - tvdFrom, 1) : 1;
  const latVisMD = Math.max(Math.min(toMD,TD) - Math.max(landingMD,fromMD), 0);
  const yScale = trunkVisible ? (660/vertSpan)*o.cy : 1;
  const xScale = latVisMD>0 ? (720/Math.max(latVisMD,1))*o.cx : 1;

  // ---------- instalación: elementos (copia), con los que comparten MD apenas corridos para que no se pisen ----------
  const inst = V.normInstallation(w)?.elements || [];
  const instOf = t => inst.filter(e=>e.type===t);
  inst.forEach(el=>{ if(el.md!=null) el.md_real=el.md; });
  { const pts=inst.filter(el=>POINT_TYPES.includes(el.type)&&el.md!=null).sort((a,b)=>a.md-b.md);
    for(let i=1;i<pts.length;i++) if(pts[i].md-pts[i-1].md<0.05) pts[i].md=pts[i-1].md+0.05;
    // la bomba cuelga hacia abajo: un TBG que termina justo en su MD termina después de ella
    instOf("BBA").forEach(b=>{ if(b.md==null) return;
      instOf("TBG").forEach(t=>{ if(t.bottom_md!=null && Math.abs(t.bottom_md-b.md)<0.05) t.bottom_md=b.md+0.05; }); }); }
  const tbgOn = o.els.tbg ? instOf("TBG").filter(el=>el.top_md!=null&&el.bottom_md!=null) : [];
  const tbgOdMax = Math.max(0, ...tbgOn.map(el=>el.od_in||0));
  const tbgHalfOf = el => (!el?.od_in||!tbgOdMax) ? tbgHalf : tbgHalf*Math.max(TBG_MIN_RATIO, 1+(el.od_in/tbgOdMax-1)*TBG_OD_GAIN);
  const tbgAt = md => tbgOn.filter(el=>md>=Math.min(el.top_md,el.bottom_md)&&md<=Math.max(el.top_md,el.bottom_md)).at(-1);
  const tbgHalfAt = md => tbgHalfOf(tbgAt(md));
  const sideHalfH = md => Math.max(9, o.elw*1.6, Math.max(4, innerHalf(md)-tbgHalfAt(md)-0.6)*1.5)/2;
  const plugHalfH = md => Math.max(8, o.elw*1.4, innerHalf(md)*0.35)/2;
  const bhaHalf = md => Math.max(4, innerHalf(md)*0.84);

  // ---------- ajuste esquemático: cuánto hay que estirar el camino para que cada cosa se lea ----------
  const trunkRealPx = (a,b) => Math.abs(tvdAt(b)-tvdAt(a))*yScale;
  let arcStart=kickMD;                                   // MD donde arranca el arco dibujado
  const stretch=[];                                      // [md, px agregados hasta ese md]
  if(o.els.schem!==false && inst.length){
    const evs=[], add=(md,up=0,down=0)=>{ if(md!=null && md>=fromMD && md<=toMD) evs.push({md,up,down}); };
    const ranges=[];
    const addRange=el=>{ const a=Math.min(el.top_md,el.bottom_md), b=Math.max(el.top_md,el.bottom_md);
      add(a); add(b); if(a>=fromMD&&b<=toMD) ranges.push({a,b,min:SCHEM_MIN_LEN[el.type]||0}); };
    inst.forEach(el=>{ const t=el.type;
      if(["TPN","PKR","ANCLA"].includes(t)&&o.els.instel&&el.md!=null){ const h=t==="TPN"?plugHalfH(el.md):sideHalfH(el.md); add(el.md,h,h); }
      else if(t==="BBA"&&o.els.rods&&el.md!=null) add(el.md,0,BBA_PX);
      else if(t==="BHA"&&o.els.bha&&el.md!=null) add(el.md,bhaHalf(el.md)*(el.mdf?5.7:2.5),0);
      else if(el.top_md!=null&&el.bottom_md!=null){
        if((t==="TBG"&&o.els.tbg)||(t==="VB"&&o.els.rods)||(t==="TPNC"&&o.els.cemplug)) addRange(el);
        // un fluido largo no pide nada: solo se ajusta si queda tan corto que no se lee
        else if(t==="FLUIDO"&&o.els.fluids&&el.bottom_md<=kickMD&&trunkRealPx(el.top_md,el.bottom_md)<SCHEM_MIN_LEN.FLUIDO) addRange(el);
      }
    });
    // lo que cae dentro del arco baja la curva y queda en el tronco
    if(!isVerticalWell && evs.length){
      const inArc=evs.filter(e=>e.md>kickMD&&e.md<landingMD).map(e=>e.md);
      if(inArc.length) arcStart=Math.min(Math.max(...inArc)+2, landingMD-0.25);
      add(arcStart,SCHEM_ARC_CLEAR,0);
    }
    evs.sort((a,b)=>a.md-b.md);
    const ev=[];                                         // los del mismo MD son un solo evento
    for(const e of evs){ const l=ev.at(-1);
      if(l&&e.md-l.md<0.01){ l.up=Math.max(l.up,e.up); l.down=Math.max(l.down,e.down); } else ev.push({...e}); }
    const isTrunk=md=>isVerticalWell||md<=arcStart;
    const realPx=(a,b)=>isTrunk(b)?trunkRealPx(a,b):(a>=landingMD?(b-a)*xScale:Infinity);
    const gaps=ev.map((e,i)=>{ if(!i) return 0; const p=ev[i-1], g=p.down+e.up;
      return Math.max(realPx(p.md,e.md), g+(g>0?SCHEM_GAP:SCHEM_GAP_BARE)); });
    const idxOf=md=>ev.findIndex(e=>Math.abs(e.md-md)<0.011);
    ranges.forEach(r=>{ const i0=idxOf(r.a), i1=idxOf(r.b); if(i0<0||i1<=i0) return;
      const len=gaps.slice(i0+1,i1+1).reduce((x,y)=>x+y,0);
      if(isFinite(len)&&len<r.min) gaps[i1]+=r.min-len; });
    let acc=0;
    ev.forEach((e,i)=>{ if(i){ const real=realPx(ev[i-1].md,e.md); if(isFinite(real)) acc+=Math.max(0,gaps[i]-real); } stretch.push([e.md,acc]); });
  }
  // px agregados al camino hasta un MD
  const extraAt = md => {
    if(!stretch.length||md<=stretch[0][0]) return 0;
    for(let i=1;i<stretch.length;i++) if(md<=stretch[i][0]){ const [a,ea]=stretch[i-1], [b,eb]=stretch[i];
      return ea+(eb-ea)*(md-a)/((b-a)||1); }
    return stretch.at(-1)[1];
  };

  // --- camino canónico (coords "crudas", luego se trasladan) ---
  // tronco: x=0, y=tvd*yScale. arco: cuarto de círculo de radio R (px) = build TVD * yScale.
  // lateral: y=cte, x avanza por MD.
  // Con ajuste esquemático, el tronco llega hasta arcStart (TVD real + lo estirado) y el arco sigue desde ahí.
  const R = isVerticalWell ? 0 : Math.max((tvdLand-tvdKick)*yScale, 24);
  const Ykick = tvdAt(arcStart)*yScale+extraAt(arcStart), Yland = Ykick+R;
  const Xland = R;
  const extraLand = extraAt(landingMD);
  const pos = md => {
    if(md<=arcStart || isVerticalWell){
      return { x:0, y:tvdAt(md)*yScale+extraAt(md), tx:0, ty:1, nx:-1, ny:0 };
    }
    if(md>=landingMD){
      return { x:Xland+(md-landingMD)*xScale+extraAt(md)-extraLand, y:Yland, tx:1, ty:0, nx:0, ny:1 };
    }
    const t=(md-arcStart)/Math.max(landingMD-arcStart,1e-3);
    const phi=Math.PI - (Math.PI/2)*t;                    // 180° → 90°
    const cx=R, cy=Ykick;                                 // centro del arco
    const x=cx+R*Math.cos(phi), y=cy+R*Math.sin(phi);
    const tx=Math.sin(phi), ty=-Math.cos(phi);            // tangente (down→right)
    return { x, y, tx, ty, nx:-ty, ny:tx };
  };

  // --- bounding box del contenido visible → traslación a márgenes ---
  const mdSamples=[fromMD,toMD];
  for(const s of st) if(s.md>fromMD&&s.md<toMD) mdSamples.push(s.md);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const md of mdSamples){ const p=pos(md);
    minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); }
  // etiquetas del lateral van ARRIBA del caño (rotadas): reservar techo si el tronco visible es corto
  const hasLanes = o.els.labels && latVisMD>0 && !!(w.frac?.stages?.length);
  const laneSpace = Math.round(185*(FS/10.5));           // alto reservado para las etiquetas rotadas
  const trunkPix = Math.max(0,(tvdLand - tvdFrom))*yScale;
  const leftMargin=104, topMargin=Math.max(64, hasLanes ? laneSpace+30-trunkPix : 64);
  const dx=leftMargin+maxHalf - minX, dy=topMargin - minY;
  const P0=pos; const P=(md)=>{ const p=P0(md); return {...p, x:p.x+dx, y:p.y+dy}; };

  const YlandF = Yland+dy;
  const boxColX = Xland+dx+maxHalf+46;                  // columna de cajas: a la DERECHA del arco
  const teethLen = prodHalf*3.2+12;                      // alcance de los dientes de punzado
  const trunkBoxLimit = latVisMD>0 ? YlandF-teethLen-12 : Infinity;  // que no tapen el lateral
  const laneBase = YlandF-teethLen-14;                   // base de las etiquetas rotadas (suben)
  const latBoxTop = laneBase-(hasLanes?laneSpace-20:8);  // techo de la caja del zapato lateral
  const rulerBottomTvd = tvdLand+100;                    // la regla sigue 100 m debajo del fondo
  // la regla usa el mismo mapeo que el camino: en lo estirado, los ticks quedan más separados
  const tvdArc = isVerticalWell ? Infinity : tvdAt(arcStart);
  const mdAtTvd = d => { let p=st[0];
    for(const s of st){ if((s.tvd||0)>=d) return p.md+(s.md-p.md)*(d-(p.tvd||0))/(((s.tvd||0)-(p.tvd||0))||1); p=s; }
    return TD; };
  const rulerY = d => d<=tvdArc ? d*yScale+extraAt(mdAtTvd(d))
    : tvdLand>tvdArc && d<=tvdLand ? Ykick+(Yland-Ykick)*(d-tvdArc)/(tvdLand-tvdArc)
    : (tvdLand>tvdArc ? Yland+(d-tvdLand)*yScale : Ykick+(d-tvdArc)*yScale);

  const S=[];                                            // fragmentos SVG
  const boxes=[];                                        // cajas de etiqueta (tronco/arco)
  const lanes=[];                                        // etiquetas rotadas (lateral)

  // patrón de cemento (punteado estilo "manual")
  S.push(`<defs><pattern id="cem" width="7" height="7" patternUnits="userSpaceOnUse">`+
    `<rect width="7" height="7" fill="#ececec"/>`+
    `<circle cx="1.6" cy="1.8" r="0.9" fill="#8f8f8f"/><circle cx="4.9" cy="4.2" r="0.8" fill="#a5a5a5"/>`+
    `<circle cx="3.1" cy="6.1" r="0.6" fill="#8f8f8f"/><circle cx="6.2" cy="1.2" r="0.6" fill="#b0b0b0"/>`+
    `</pattern>`+
    // TPN de cemento: sombreado gris con pintas más oscuras (más denso/oscuro que el cemento del anular)
    cemPattern("cemplug", V.INST_DEFCOLOR.TPNC)+`</defs>`);

  // banda (polígono cerrado) entre offsets ±w a lo largo del camino [a..b]
  // el arco siempre bien muestreado: con muestras parejas por MD, una curva cerrada queda poligonal
  const ARC_N=48;
  const bandPts=(a,b,n=90)=>{ const ms=[]; for(let i=0;i<=n;i++) ms.push(a+(b-a)*i/n);
    const p=Math.max(a,arcStart), q=Math.min(b,landingMD);
    if(!isVerticalWell && q>p){ const k=Math.max(2,Math.round(ARC_N*(q-p)/Math.max(landingMD-arcStart,1e-3)));
      for(let i=0;i<=k;i++) ms.push(p+(q-p)*i/k); ms.sort((x,y)=>x-y); }
    return ms.map(P); };
  const sideLine=(pts,sgn,w)=>pts.map(p=>({x:p.x+p.nx*sgn*w, y:p.y+p.ny*sgn*w}));
  const polyPath=pts=>"M "+pts.map(p=>`${f1(p.x)},${f1(p.y)}`).join(" L ");
  const bandPath=(pts,w)=>polyPath(sideLine(pts,1,w))+" L "+sideLine(pts,-1,w).reverse().map(p=>`${f1(p.x)},${f1(p.y)}`).join(" L ")+" Z";
  const ringPath=(pts,wIn,wOut,sgn)=>polyPath(sideLine(pts,sgn,wIn))+" L "+sideLine(pts,sgn,wOut).reverse().map(p=>`${f1(p.x)},${f1(p.y)}`).join(" L ")+" Z";

  // ---------- cañerías (de externa a interna): cemento → interior blanco → paredes → zapato ----------
  casings.forEach(c=>{
    if(c.shoe_md==null) return;
    const half=minHalfOf(c);
    const a=fromMD, b=Math.min(c.shoe_md,toMD); if(b<=a) return;
    const pts=bandPts(a,b);
    // cemento del anular (TOC→zapato) — punteado
    if(o.els.cement && c.toc_md!=null && c.toc_md<b){
      const idx=PHASE_ORDER.indexOf(c.phase);
      const ext=idx>0 && casings.find(x=>x.phase===PHASE_ORDER[idx-1]);
      const outer=idx>0 ? (ext?minHalfOf(ext):HW(PHASE_ORDER[idx-1]))-WALL_W/2 : maxHalfOf(c)+12*o.diam;
      const ca=Math.max(c.toc_md,a), cpts=bandPts(ca,b,70);
      for(const sgn of [1,-1]) S.push(`<path d="${ringPath(cpts,half,outer,sgn)}" fill="url(#cem)" stroke="#9a9a9a" stroke-width="0.6"/>`);
      // cielo de cemento (línea en el TOC) + etiqueta
      const ft=P(ca);
      for(const sgn of [1,-1]) S.push(`<line x1="${f1(ft.x+ft.nx*sgn*half)}" y1="${f1(ft.y+ft.ny*sgn*half)}" x2="${f1(ft.x+ft.nx*sgn*outer)}" y2="${f1(ft.y+ft.ny*sgn*outer)}" stroke="#777" stroke-width="1.6"/>`);
      if(o.els.labels) queueLabel(ft, [`TOC ${V.fmtOD(c.od_in)}`, `${Math.round(c.toc_md)} m`], "#666", outer, ca);
    }
    if(!o.els.casings) return;
    // un trozo por tramo (sin tramos, uno solo): interior blanco que tapa el cemento y las paredes de la
    // fase externa + paredes gruesas
    const cuts=(c.segments||[]).map(s=>s.top_md).filter(m=>m!=null&&m>a&&m<b).sort((x,y)=>x-y);
    const marks=[a,...cuts,b];
    for(let i=1;i<marks.length;i++){ const p=marks[i-1], q=marks[i], hw=halfAt(c,(p+q)/2);
      const sp=bandPts(p,q,Math.max(8,Math.round(90*(q-p)/(b-a))));
      S.push(`<path d="${bandPath(sp,hw)}" fill="#ffffff"/>`);
      for(const sgn of [1,-1]) S.push(`<path d="${polyPath(sideLine(sp,sgn,hw))}" fill="none" stroke="${INK}" stroke-width="${WALL_W}"/>`);
    }
    // cambio de tramo: hombro si cambia el OD, marca hacia afuera si solo cambia libraje o grado
    cuts.forEach(m=>{ const up=V.casingSegAt(c,m-0.01), down=V.casingSegAt(c,m+0.01), f=P(m);
      const h0=halfAt(c,m-0.01), h1=halfAt(c,m+0.01), inner=Math.min(h0,h1), outer=Math.max(Math.max(h0,h1),inner+5);
      for(const sgn of [1,-1]) S.push(`<line x1="${f1(f.x+f.nx*sgn*inner)}" y1="${f1(f.y+f.ny*sgn*inner)}" x2="${f1(f.x+f.nx*sgn*outer)}" y2="${f1(f.y+f.ny*sgn*outer)}" stroke="${INK}" stroke-width="${WALL_W}"/>`);
      if(o.els.labels && o.els.xovers && up && down){
        const spec=sg=>[V.fmtOD(sg.od_in??c.od_in), sg.weight_ppf!=null?`${sg.weight_ppf}#`:null, sg.grade!==(up.grade)||sg.grade!==(down.grade)?sg.grade:null].filter(Boolean).join(" ");
        queueLabel(f, [`XO ${spec(up)} → ${spec(down)}`, `${Math.round(m)} m · TVD ${Math.round(tvdAt(m))} m`], INK, outer, m);
      }
    });
  });
  const prodCas = casings.find(c=>c.phase==="produccion");
  const prodHalfAt = md => prodCas?halfAt(prodCas,md):prodHalf;

  // ---------- coloreo por dogleg: interior del pozo pintado con la rampa verde→rojo ----------
  // Normalizado al DLS máximo del rango visible (auto-normalización, como el isoMode de la Vista 3D).
  let dlsMax=0;
  if(dg){
    for(const s of st) if(s.md>=fromMD&&s.md<=toMD) dlsMax=Math.max(dlsMax, s.dls||0);
    dlsMax=Math.max(dlsMax, dlsAt(fromMD), dlsAt(toMD));
    if(dlsMax>0){
      const n=240;
      for(let i=0;i<n;i++){
        const a=fromMD+(toMD-fromMD)*i/n, b=fromMD+(toMD-fromMD)*(i+1)/n;
        const col=dlsColor(dlsAt((a+b)/2)/dlsMax);
        S.push(`<path d="${bandPath(bandPts(a,b,3),prodHalfAt((a+b)/2)-WALL_W/2)}" fill="${col}" stroke="${col}" stroke-width="0.5"/>`);
      }
      // leyenda de escala (barra 0→máx) bajo el título
      S.push(`<defs><linearGradient id="dlsg" x1="0" y1="0" x2="1" y2="0">`+
        `<stop offset="0" stop-color="rgb(0,227,58)"/><stop offset="0.5" stop-color="rgb(255,229,0)"/>`+
        `<stop offset="1" stop-color="rgb(255,30,30)"/></linearGradient></defs>`);
      const gx=leftMargin, gy=37, gw=120;
      S.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="8" fill="url(#dlsg)" stroke="#999" stroke-width="0.5"/>`
        +`<text x="${gx}" y="${f1(gy+8+FS)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.85)}" fill="${DIM}">0</text>`
        +`<text x="${gx+gw}" y="${f1(gy+8+FS)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.85)}" fill="${DIM}" text-anchor="end">${f1(dlsMax)}</text>`
        +`<text x="${gx+gw+8}" y="${f1(gy+7.5)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.85)}" fill="${DIM}">dogleg (°/30m)</text>`);
    }
  }

  // ---------- INSTALACIÓN: helpers ----------
  const clipR = el => [Math.max(Math.min(el.top_md,el.bottom_md),fromMD), Math.min(Math.max(el.top_md,el.bottom_md),toMD)];
  const inRange = el => { if(el.top_md==null||el.bottom_md==null) return false; const [a,b]=clipR(el); return b>a; };
  const inPt = el => el.md!=null && el.md>=fromMD && el.md<=toMD;
  const rngTxt = el => `${Math.round(el.top_md)}–${Math.round(el.bottom_md)} m`;
  // cañería más interna / más externa que cubre md (casings va de externa a interna)
  const outerHalf = md => { const c=covering(md)[0]; return c?halfAt(c,md):prodHalf; };
  const nSeg = (a,b,max=120) => Math.max(3, Math.min(max, Math.round((b-a)/Math.max(toMD-fromMD,1)*240)));
  // relleno del interior de la cañería entre a y b, cortado en cada zapato y tramo (cambia el ID)
  const fillInterior = (a,b,fill,extra="") => {
    const cuts=[...new Set([a,b,...casings.flatMap(c=>[c.shoe_md,...(c.segments||[]).map(s=>s.top_md)]).filter(m=>m!=null&&m>a&&m<b)])].sort((x,y)=>x-y);
    let g="";
    for(let i=1;i<cuts.length;i++){ const p=cuts[i-1], q=cuts[i];
      g+=`<path d="${bandPath(bandPts(p,q,nSeg(p,q)), innerHalf((p+q)/2))}" fill="${fill}"${extra}/>`; }
    return g;
  };
  // un cartel en el mismo MD (±1 m) que un elemento puntual reemplaza su etiqueta automática
  const notes = o.els.notes&&o.els.labels ? instOf("CARTEL").filter(el=>el.md!=null&&el.text) : [];
  const hasNote = el => notes.some(n=>Math.abs(n.md-(el.md_real??el.md))<=1);
  const mdTxt = el => `${Math.round(el.md_real??el.md)} m`;
  // color elegido por elemento (o el default del corte). En B&N: trazos en tinta, rellenos en gris.
  const baseOf = el => V.instColor(el) || V.INST_DEFCOLOR[el.type] || INK;
  const inkOf  = el => bw ? INK : baseOf(el);
  const fillOf = el => bw ? grayOf(baseOf(el)) : baseOf(el);
  const cemPats = new Map();                             // TPN de cemento con color propio → su patrón
  const cemFill = el => { const c=V.instColor(el); if(bw||!c) return "url(#cemplug)";
    const id="cemplug-"+c.slice(1).toLowerCase(); if(!cemPats.has(id)) cemPats.set(id, cemPattern(id,c));
    return `url(#${id})`; };

  // ---------- TBG (por rango desde/hasta): interior blanco ahora, paredes después de los fluidos ----------
  const tbgs = tbgOn.filter(inRange);
  tbgs.forEach(el=>{ const [a,b]=clipR(el); S.push(`<path d="${bandPath(bandPts(a,b,nSeg(a,b,90)),tbgHalfOf(el))}" fill="#ffffff"/>`); });

  // rango MD visible de una etapa (tope del primer cluster → fondo del último), o null
  const stageRange = stg => {
    const mds=(stg.clusters||[]).flatMap(c=>[c.top_md,c.bottom_md]).filter(x=>x!=null);
    if(!mds.length) return null;
    const a=Math.max(Math.min(...mds),fromMD), b=Math.min(Math.max(...mds),toMD);
    return b>a ? {md0:a, md1:b} : null;
  };

  // ---------- etapas: banda de color en el interior + N° centrado ----------
  const stageNums=[];                                    // N° de etapa: se emiten después de la instalación
  // Banda solo en tema "color". En dogleg NO se pinta banda (no debe pisar el coloreo por DLS):
  // queda solo el N°, con halo blanco para leerse sobre la rampa. En B&N, solo el N° sobre blanco.
  if(o.els.stages && w.frac?.stages?.length){
    w.frac.stages.forEach(stg=>{
      const r=stageRange(stg); if(!r) return;
      const col=STAGE_PAL[(stg.stage||0)%STAGE_PAL.length];
      if(!bw && !dg){
        const pts=bandPts(r.md0,r.md1,24);
        S.push(`<path d="${bandPath(pts,prodHalfAt((r.md0+r.md1)/2)-WALL_W/2)}" fill="${col}" fill-opacity="0.85"/>`);
      }
      if(o.els.labels){       // el N° se dibuja más abajo, por encima de la instalación (fluidos, TBG…)
        const f=P((r.md0+r.md1)/2);
        const efs=Math.min(FS*0.85, prodHalf*0.78);
        const fill=(bw||dg)?"#111":"#ffffff";
        const halo=dg?` stroke="#ffffff" stroke-width="${f1(Math.max(1.6,efs*0.3))}" stroke-linejoin="round" paint-order="stroke"`:"";
        const rot=(r.md0+r.md1)/2>=landingMD ? ` transform="rotate(-90 ${f1(f.x)} ${f1(f.y)})"` : "";
        stageNums.push(`<text x="${f1(f.x)}" y="${f1(f.y+efs*0.36)}" font-family="Arial,Helvetica,sans-serif" font-size="${f1(efs)}" font-weight="bold" fill="${fill}"${halo} text-anchor="middle"${rot}>E${stg.stage}</text>`);
      }
    });
  }

  // ---------- fluidos: llenan el ID de la cañería; donde se solapan, rayado alternando sus colores ----------
  if(o.els.fluids){
    const fl=instOf("FLUIDO").filter(inRange);
    const colOf=fillOf;
    const xs=[...new Set(fl.flatMap(clipR))].sort((a,b)=>a-b);
    const pats=new Map();
    for(let i=1;i<xs.length;i++){
      const a=xs[i-1], b=xs[i], m=(a+b)/2;
      const act=fl.map((el,k)=>({el,k})).filter(({el})=>{ const [p,q]=clipR(el); return m>p && m<q; });
      if(!act.length) continue;
      let fill;
      if(act.length===1) fill=colOf(act[0].el);
      else{
        const id="flm-"+act.map(x=>x.k).join("-"), sw=5;
        if(!pats.has(id)) pats.set(id, `<pattern id="${id}" width="${sw*act.length}" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
          +act.map((x,j)=>`<rect x="${j*sw}" width="${sw}" height="10" fill="${colOf(x.el)}"/>`).join("")+`</pattern>`);
        fill=`url(#${id})`;
      }
      S.push(fillInterior(a,b,fill,` stroke="${fill}" stroke-width="0.5"`));
    }
    if(pats.size) S.push(`<defs>${[...pats.values()].join("")}</defs>`);
    if(o.els.labels) fl.forEach(el=>{
      const [a,b]=clipR(el), m=(a+b)/2, v=V.instVolume(w,el);
      queueLabel(P(m), [[el.name||"Fluido", el.density_gcm3!=null?`${V.fmtDec(el.density_gcm3)} g/cm³`:null].filter(Boolean).join(" · "),
        [rngTxt(el), v!=null?V.fmtVol(v):null].filter(Boolean).join(" · ")], INK, innerHalf(m), m, {swatch:colOf(el)});
    });
  }

  // ---------- TPN de cemento: interior gris con pintas + tope/base marcados ----------
  if(o.els.cemplug) instOf("TPNC").filter(inRange).forEach(el=>{
    const [a,b]=clipR(el), fill=cemFill(el), edge=bw?"#4a4a4a":shade(baseOf(el),0.4);
    S.push(fillInterior(a,b,fill,` stroke="${bw?"#8a8a8a":shade(baseOf(el),0.75)}" stroke-width="0.5"`));
    for(const m of [el.top_md, el.bottom_md]){ if(m<fromMD||m>toMD) continue;
      const f=P(m), h=innerHalf(m);
      S.push(`<line x1="${f1(f.x+f.nx*h)}" y1="${f1(f.y+f.ny*h)}" x2="${f1(f.x-f.nx*h)}" y2="${f1(f.y-f.ny*h)}" stroke="${edge}" stroke-width="1.4"/>`); }
    if(o.els.labels){ const m=(a+b)/2, v=V.instVolume(w,el);
      queueLabel(P(m), ["TPN cemento", [rngTxt(el), v!=null?V.fmtVol(v):null].filter(Boolean).join(" · ")],
        "#444", innerHalf(m), m, {swatch:fill}); }
  });
  if(cemPats.size) S.push(`<defs>${[...cemPats.values()].join("")}</defs>`);

  // ---------- TBG: paredes (por encima de fluidos/cemento) + cartel de specs al pie ----------
  tbgs.forEach(el=>{
    const [a,b]=clipR(el), pts=bandPts(a,b,nSeg(a,b,90)), hw=tbgHalfOf(el);
    for(const sgn of [1,-1]) S.push(`<path d="${polyPath(sideLine(pts,sgn,hw))}" fill="none" stroke="${inkOf(el)}" stroke-width="1.6"/>`);
    // hombro contra el TBG que sigue, si cambia el diámetro (2⅞" → cola de 2⅜")
    const nx=tbgs.find(x=>x!==el&&Math.abs(Math.min(x.top_md,x.bottom_md)-el.bottom_md)<=1), hn=nx?tbgHalfOf(nx):hw;
    if(nx&&hn!==hw){ const f=P(el.bottom_md);
      for(const sgn of [1,-1]) S.push(`<line x1="${f1(f.x+f.nx*sgn*hw)}" y1="${f1(f.y+f.ny*sgn*hw)}" x2="${f1(f.x+f.nx*sgn*hn)}" y2="${f1(f.y+f.ny*sgn*hn)}" stroke="${inkOf(el)}" stroke-width="1.6"/>`); }
    if(o.els.labels && el.bottom_md<=toMD){
      const specs=[el.od_in!=null?`TBG ${V.fmtOD(el.od_in)}`:"TBG"];
      if(el.weight_ppf!=null) specs.push(`${el.weight_ppf}#/ft`);
      if(el.grade) specs.push(el.grade);
      const where = el.top_md>0.5 ? rngTxt(el) : `${Math.round(el.bottom_md)} m`;
      queueLabel(P(el.bottom_md), [specs.join(" "), `${where} · TVD ${Math.round(tvdAt(el.bottom_md))} m`],
        bw?INK:(V.instColor(el)||"#0b6b76"), hw+6, el.bottom_md);
    }
  });

  // ---------- varillas de bombeo (VB): línea sólida fina por el centro; CC = centralizadores ----------
  if(o.els.rods) instOf("VB").filter(inRange).forEach(el=>{
    const [a,b]=clipR(el), pts=bandPts(a,b,nSeg(a,b));
    S.push(`<path d="${polyPath(pts)}" fill="none" stroke="${inkOf(el)}" stroke-width="${VB_W[el.diam]??1.85}"/>`);
    if(el.cc){
      let lenPx=0; for(let i=1;i<pts.length;i++) lenPx+=Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
      const n=Math.floor(lenPx/22);
      for(let k=1;k<n;k++) S.push(drawCentralizer(P(a+(b-a)*k/n), Math.max(2.6, tbgHalf*0.62), 3.2, inkOf(el)));
    }
    if(o.els.labels && el.bottom_md<=toMD)
      queueLabel(P(el.bottom_md), [["VB", el.diam?V.vbDiamLabel(el.diam):null, el.cc?"c/ CC":null].filter(Boolean).join(" "),
        el.top_md>0.5?rngTxt(el):`${Math.round(el.bottom_md)} m`], INK, 3, el.bottom_md);
  });

  // ---------- bomba (BBA): tramo corto del Ø del TBG, siempre desde su MD hacia abajo, con anillos transversales ----------
  // (pieza mecánica: se distingue del cemento —pintas— y de los fluidos —rayado diagonal—)
  if(o.els.rods) instOf("BBA").filter(inPt).forEach(el=>{
    const f=P(el.md), hw=tbgHalfAt(el.md)+0.8;
    S.push(drawPump(f, BBA_PX, hw, bw?"#e2e2e2":fillOf(el), bw?INK:shade(baseOf(el),0.45)));
    if(o.els.labels&&!hasNote(el)) queueLabel({...f, x:f.x+f.tx*BBA_PX/2, y:f.y+f.ty*BBA_PX/2}, ["BBA", mdTxt(el)], INK, hw+1, el.md);
  });

  // ---------- punzados: "dientes" esquemáticos hacia la formación (no 1:1 con los tiros reales) ----------
  // Misma geometría y solidez en TODOS los temas: color de etapa en "color"/"dogleg", tinta en B&N.
  if(o.els.perf && w.frac?.stages?.length){
    w.frac.stages.forEach(stg=>{
      if(stageFilter && !stageFilter.has(stg.stage)) return;
      const r=stageRange(stg); if(!r) return;
      const col=bw?INK:STAGE_PAL[(stg.stage||0)%STAGE_PAL.length];
      S.push(drawTeeth(P, r.md0, r.md1, prodHalfAt((r.md0+r.md1)/2), col, teethLen));
    });
  }

  // ---------- tapones: bloque negro macizo ----------
  if(o.els.plugs && w.frac?.stages?.length){
    const withPlug=w.frac.stages.filter(s=>s.plug_md!=null).slice().sort((a,b)=>b.plug_md-a.plug_md);
    const num=new Map(); withPlug.forEach((s,i)=>num.set(s.stage,i+1));
    w.frac.stages.forEach(stg=>{
      if(stg.plug_md==null||stg.plug_md<fromMD||stg.plug_md>toMD) return;
      const f=P(stg.plug_md);
      const hp=prodHalfAt(stg.plug_md);
      S.push(blockAcross(f, hp, o.elw, INK));
      if(o.els.labels){ const n=V.plugCountInverted?(withPlug.length-num.get(stg.stage)+1):num.get(stg.stage);
        if(stg.plug_md>=landingMD) lanes.push({ f, text:`TPN N° ${n} · ${Math.round(stg.plug_md)} m`, color:INK });
        else queueLabel(f, [`TPN N° ${n}`, `${Math.round(stg.plug_md)} m`], INK, hp, stg.plug_md);
      }
    });
  }

  S.push(...stageNums);

  // ---------- packers / TPN / anclas de instalación (checkbox propio) ----------
  // Cartel SIEMPRE horizontal (caja): en el lateral solo los tapones de frac van rotados.
  if(o.els.instel) inst.filter(el=>["TPN","PKR","ANCLA"].includes(el.type) && inPt(el)).forEach(el=>{
    const f=P(el.md);
    const hw=tbgHalfAt(el.md);
    S.push(el.type==="TPN" ? drawPlugX(f, innerHalf(el.md), o.elw, inkOf(el))
         : drawSideBoxes(f, hw, innerHalf(el.md), o.elw, inkOf(el), el.type==="PKR"?"x":"wedge"));
    if(o.els.labels&&!hasNote(el)) queueLabel(f, [el.type==="ANCLA"?"Ancla":el.type, mdTxt(el)], INK, hw+8, el.md);
  });

  // ---------- BHA: fresa (± motor de fondo), punta en el MD apuntando hacia donde avanza el pozo ----------
  if(o.els.bha) instOf("BHA").filter(inPt).forEach(el=>{
    const f=P(el.md), H=Math.max(4, innerHalf(el.md)*0.84);
    S.push(drawBHA(f, H, !!el.mdf, inkOf(el)));
    if(o.els.labels&&!hasNote(el)) queueLabel(f, [el.mdf?"BHA c/ MDF":"BHA (fresa)", mdTxt(el)], INK, H, el.md);
  });

  // ---------- carteles libres: texto en caja con flecha apuntando al MD ----------
  notes.filter(inPt).forEach(el=>{
    const bg=V.instColor({color:el.bg});
    queueLabel(P(el.md), String(el.text).split(/\n/), inkOf(el), outerHalf(el.md)+1, el.md,
      {arrow:inkOf(el), note:true, bg:bg&&bw?(bg.toLowerCase()==="#ffffff"?null:grayOf(bg)):bg});
  });

  // ---------- zapatos: triángulos macizos hacia afuera ----------
  if(o.els.shoes){
    casings.forEach(c=>{
      if(c.shoe_md==null||c.shoe_md<fromMD||c.shoe_md>toMD) return;
      const half=HW(c.phase); const f=P(c.shoe_md);
      S.push(drawShoe(f, half, prodHalf*o.shoe));
      if(o.els.labels){
        const specs=[`CSG ${V.fmtOD(c.od_in)}`]; if(c.grade) specs.push(c.grade);
        if(c.weight_ppf!=null) specs.push(`${c.weight_ppf}#/ft`);
        queueLabel(f, [specs.filter(Boolean).join(" "), `Zpto: ${Math.round(c.shoe_md)} m · TVD ${Math.round(tvdAt(c.shoe_md))} m`], INK, half, c.shoe_md);
      }
    });
  }

  // ---------- caños cortos / shoetrack ----------
  // Cartel SIEMPRE horizontal (caja, nunca rotado). Formato de longitud/posición: "5,87m - @2490m MD"
  // (2 decimales con coma, sin "L" ni "desde"). El shoetrack es "una sola cosa": UNA caja "Shoetrack"
  // que lista sus componentes línea por línea (compacto) — al ser una caja, se arrastra entera.
  if(o.els.shorts||o.els.shoetrack){
    const lenOf=x=>x.length_m!=null?x.length_m:(x.bottom_md!=null&&x.top_md!=null?x.bottom_md-x.top_md:null);
    const lenPos=x=>{
      const L=lenOf(x);
      return [L!=null?`${L.toFixed(2).replace(".",",")}m`:null, `@${Math.round(x.top_md)}m MD`].filter(Boolean).join(" - ");
    };
    casings.forEach(c=>{
      if(o.els.shorts)(c.short_joints||[]).forEach(sj=>{ if(sj.top_md==null||sj.top_md<fromMD||sj.top_md>toMD) return;
        const f=P(sj.top_md);
        const hs=prodHalfAt(sj.top_md);
        S.push(blockAcross(f, hs, 4, bw?"#666":"#d9b800"));
        if(o.els.labels) queueLabel(f, [sj.desc||(sj.xover?"XOVER":"Caño corto"), lenPos(sj)],
          bw?INK:"#8a6d00", hs, sj.top_md); });
      if(o.els.shoetrack){
        const els=(c.shoetrack?.elements||[]).filter(el=>el.top_md!=null&&el.top_md>=fromMD&&el.top_md<=toMD);
        if(els.length){
          els.forEach(el=>S.push(blockAcross(P(el.top_md), prodHalf, 4, bw?"#888":"#9a6cff")));
          if(o.els.labels){
            const md0=Math.min(...els.map(e=>e.top_md));
            const md1=Math.max(...els.map(e=>e.bottom_md??e.top_md));
            const lines=["Shoetrack", ...els.map(el=>`${el.desc||"—"} · ${lenPos(el)}`)];
            queueLabel(P((md0+md1)/2), lines, bw?INK:"#7a4fd6", prodHalf, (md0+md1)/2);
          }
        }
      }
    });
  }

  // ---------- regla TVD densa (tronco) ----------
  if(o.els.ruler && trunkVisible && vertSpan>40){
    const step=niceStep(vertSpan/30);
    const rx=leftMargin-30;
    const y0v=tvdFrom, y1v=rulerBottomTvd;               // sigue 100 m debajo del fondo
    S.push(`<line x1="${rx}" y1="${f1(rulerY(y0v)+dy)}" x2="${rx}" y2="${f1(rulerY(y1v)+dy)}" stroke="${DIM}" stroke-width="1"/>`);
    let lastY=-Infinity;                                 // sin encimar números si el tramo quedó comprimido
    for(let d=Math.ceil(y0v/step)*step; d<=y1v+0.5; d+=step){
      const y=rulerY(d)+dy;
      S.push(`<line x1="${rx-5}" y1="${f1(y)}" x2="${rx}" y2="${f1(y)}" stroke="${DIM}" stroke-width="1"/>`);
      if(y-lastY<FS){ continue; } lastY=y;
      S.push(`<text x="${rx-8}" y="${f1(y+3)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.9)}" fill="${DIM}" text-anchor="end">${Math.round(d)}</text>`);
    }
    S.push(`<text x="${rx-8}" y="${f1(rulerY(y0v)+dy-12)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.95)}" fill="${DIM}" text-anchor="end">TVD (m)</text>`);
  }

  // ---------- regla de extensión (MD) DEBAJO del esquema ----------
  // Usa el mismo mapeo P(md).x del camino canónico, así cada tapón/elemento del lateral queda
  // alineado verticalmente con su MD en la regla. Rango: tope del cluster más somero → TD.
  let extBottom=0, extRight=0;
  if(o.els.extruler && !isVerticalWell && latVisMD>0){
    const tops=(w.frac?.stages||[]).flatMap(s=>(s.clusters||[]).map(c=>c.top_md)).filter(x=>x!=null);
    const mdA=Math.max(fromMD, kickMD, tops.length?Math.min(...tops):landingMD);
    const mdB=toMD;
    if(mdB>mdA+1){
      const yR=maxY+dy+teethLen+14;                        // pegada al pozo: justo bajo los dientes
      const x0=P(mdA).x, x1=P(mdB).x;
      const pxPerM=(x1-x0)/(mdB-mdA);
      const step=niceStep(58/Math.max(pxPerM,1e-6));       // ticks "lindos" sin encimarse (~58 px)
      const tick=(m,x,strong)=>{
        S.push(`<line x1="${f1(x)}" y1="${f1(yR)}" x2="${f1(x)}" y2="${f1(yR+6)}" stroke="${DIM}" stroke-width="1"/>`
          +`<text x="${f1(x)}" y="${f1(yR+8+FS*0.95)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.9)}" fill="${DIM}" text-anchor="middle"${strong?' font-weight="bold"':''}>${Math.round(m)}</text>`);
      };
      S.push(`<line x1="${f1(x0)}" y1="${f1(yR)}" x2="${f1(x1)}" y2="${f1(yR)}" stroke="${DIM}" stroke-width="1"/>`);
      tick(mdA, x0, true); tick(mdB, x1, true);            // extremos exactos (tope somero y TD)
      for(let m=Math.ceil(mdA/step)*step; m<mdB; m+=step){
        const x=P(m).x;
        if(x-x0>34 && x1-x>34) tick(m, x, false);          // no pisar las puntas
      }
      S.push(`<text x="${f1(x1+10)}" y="${f1(yR+4)}" font-family="ui-monospace,monospace" font-size="${f1(FS*0.95)}" fill="${DIM}">MD (m)</text>`);
      extBottom=yR+10+FS*1.9; extRight=x1+10+FS*0.6*7;
    }
  }

  // ---------- etiquetas ----------
  let boxRight=0, boxBottom=0, labelTop=Infinity;
  if(o.els.labels){
    // zona ocupada por las etiquetas rotadas: las cajas no deben pisarla
    const laneZone = lanes.length ? { x0:Math.min(...lanes.map(L=>L.f.x))-10,
      y0:laneBase-laneSpace+10, y1:laneBase+6 } : null;
    // el pozo (tronco + arco) como obstáculo para las cajas del lateral
    const pipeObs=[];
    if(trunkVisible){ const mdB=Math.min(landingMD,toMD), a=P(fromMD), b=P(mdB);
      const n=Math.max(4, Math.min(400, Math.round((Math.abs(b.y-a.y)+Math.abs(b.x-a.x))/12)));
      for(let i=0;i<=n;i++){ const f=P(fromMD+(mdB-fromMD)*i/n);
        pipeObs.push({x:f.x-maxHalf-4, y:f.y-maxHalf-4, w:2*maxHalf+8, h:2*maxHalf+8}); } }
    const minX=(trunkVisible && o.els.ruler) ? leftMargin-16 : 6;    // no pisar la regla TVD
    const rl=renderLanes(lanes, laneBase, FS);                         // antes: las cajas usan su tope real
    const rb=renderBoxes(boxes, boxColX, trunkBoxLimit, latBoxTop, FS, laneZone, pipeObs, minX, rl.top,
      maxX+dx+maxHalf+teethLen+6);
    S.push(rb.svg); boxRight=rb.right; boxBottom=rb.bottom; labelTop=rb.top;
    S.push(rl.svg); labelTop=Math.min(labelTop, rl.top);
    S.push(rb.notes);                                    // los carteles van siempre por encima del resto
  }

  // ---------- anti-desborde superior ----------
  // En la vista "solo lateral" (desde-MD ≥ landing) el tronco no reserva altura y las cajas
  // laterales / etiquetas rotadas, que se apilan hacia ARRIBA, pueden quedar en y<0. El lienzo
  // nunca recorta: se corre TODO el contenido hacia abajo y la altura crece en la misma medida.
  let shift=0;
  if(labelTop<38){
    shift=Math.round(38-labelTop);
    const inner=S.join(""); S.length=0;
    S.push(`<g transform="translate(0 ${shift})">${inner}</g>`);
  }

  // ---------- título ----------
  S.unshift(`<text x="${leftMargin}" y="30" font-family="Arial,Helvetica,sans-serif" font-size="${f1(Math.max(15,FS*1.6))}" font-weight="bold" fill="${INK}">${esc(w.id||"pozo")}</text>`);

  // ---------- margen blanco extra (aire para reordenar cajas y editar tras exportar) ----------
  const M=Math.max(0, Math.round(o.margin||0));
  if(M>0){ const inner=S.join(""); S.length=0; S.push(`<g transform="translate(${M} ${M})">${inner}</g>`); }

  // ---------- dimensiones del lienzo: crecen para contener TODO (cajas incluidas, sin recortes) ----------
  const width  = Math.round(Math.max(maxX+dx+maxHalf+teethLen+24, boxRight+18, extRight+12, 460)+2*M);
  const height = Math.round(Math.max(maxY+dy+maxHalf+teethLen+26, rulerY(rulerBottomTvd)+dy+28, boxBottom+18, extBottom+12)+shift+2*M);

  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`+
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`+S.join("")+`</svg>`;
  return { svg, width, height };

  /* etiqueta en caja: en el tronco/arco va a la columna derecha; en el lateral, arriba del caño.
     La clasificación es por MD (no por tangente): un zapato en pleno arco sigue siendo "tronco".
     En pozo vertical NUNCA hay lateral (el fondo del pozo va a la columna, no a caja flotante). */
  function queueLabel(f, lines, color, half=maxHalf, md=null, extra={}){
    const key=lines.join("|");                           // identifica la caja si el usuario la elimina
    if(o.hiddenLabels?.has(key)) return;
    boxes.push({ f, lines, color, half, key, ...extra,
      lateral: !isVerticalWell && (md!=null ? md>=landingMD : Math.abs(f.tx)>Math.abs(f.ty)) });
  }
}

/* ============ cajas de etiqueta (estilo "manual": recuadro con texto centrado) ============
   Tronco/arco: columna a la derecha del arco; si no entran todas en el alto disponible, se reparten
   intercaladas en varias columnas (cada una conserva el orden vertical). Lateral: cada caja busca el
   lugar libre más cercano por encima de su ancla (desplazándose en x y luego hacia arriba), sin pisar
   otras cajas ni el pozo (`obstacles`). Los líderes se dibujan antes que las cajas (quedan debajo). */
function renderBoxes(list, colX, trunkLimitY, latBoxTop, FS=10.5, laneZone=null, obstacles=[], minX=6, laneTop=Infinity, xSoft=Infinity){
  if(!list.length) return { svg:"", notes:"", right:0, bottom:0, top:Infinity };
  const fs=FS, lh=FS*1.33, padX=FS*0.95, padY=FS*0.57, TOP=38, GAP=10;
  const swW=L=>L.swatch?fs*1.5:0;                         // muestra de color (fluido / cemento)
  const measure=L=>({ w:Math.max(...L.lines.map(t=>t.length))*fs*0.6+2*padX+swW(L), h:L.lines.length*lh+2*padY });
  // ---- tronco/arco ----
  const trunk=list.filter(L=>!L.lateral).sort((a,b)=>a.f.y-b.f.y).map(L=>({L, ...measure(L), x:colX, y:0}));
  const lim=isFinite(trunkLimitY)?trunkLimitY:1e9, laneFloor=laneZone?laneZone.y0-6:Infinity;
  // reparte en `ncol` columnas y devuelve cuánto se mete la pila (empujada por el margen superior)
  // en el lateral o en el TEXTO real de las etiquetas rotadas (laneTop)
  const layout=ncol=>{
    const cols=Array.from({length:ncol},()=>[]); trunk.forEach((p,i)=>cols[i%ncol].push(p));
    let cx=colX, over=0;
    for(const col of cols){
      const cw=Math.max(0,...col.map(p=>p.w)), onLanes=!!laneZone && cx+cw>laneZone.x0;
      // de abajo hacia arriba: cada caja lo más cerca posible de su ancla, sin pisar la de abajo,
      // ni invadir el lateral (trunkLimitY), ni la zona de etiquetas rotadas (laneZone)
      let floor=Math.min(lim, onLanes ? laneFloor : Infinity);
      for(let i=col.length-1;i>=0;i--){ const p=col[i]; p.x=cx; p.y=Math.min(p.L.f.y-p.h/2, floor-p.h); floor=p.y-GAP; }
      // de arriba hacia abajo: nada por encima del margen superior — si la pila se desbordó del lienzo,
      // se empuja hacia abajo (el lienzo crece con `bottom`, nunca se recorta)
      let top=TOP; for(const p of col){ p.y=Math.max(p.y, top); top=p.y+p.h+GAP; }
      const hard=Math.min(lim, onLanes ? laneTop-4 : Infinity);
      if(col.length) over=Math.max(over, col.at(-1).y+col.at(-1).h-hard);
      cx+=cw+14;
    }
    return over;
  };
  for(let n=1;n<=4;n++) if(layout(n)<=0.5 || n===4) break;   // 1 columna salvo que realmente choque
  // ---- lateral: arriba del caño, por ENCIMA de las etiquetas rotadas ----
  // Pueden subir hasta y<0: el llamador corre todo el contenido hacia abajo con `top`.
  const occ=[...obstacles, ...trunk];
  const hit=(x,y,w,h)=>occ.some(r=>x<r.x+r.w+6 && x+w+6>r.x && y<r.y+r.h+6 && y+h+6>r.y);
  const lat=[];
  for(const L of list.filter(L=>L.lateral).sort((a,b)=>a.f.x-b.f.x)){
    const {w,h}=measure(L), x0=Math.max(minX, L.f.x-w-14), y0=latBoxTop-h;
    let best=null;
    for(let r=0;r<=80;r++){ const dy=r*12; if(best && 1.6*dy>=best.cost) break;
      for(let k=0;k<=120;k++){ const dx=(k%2?-1:1)*Math.ceil(k/2)*16, x=x0+dx; if(x<minX) continue;
        // ensanchar el lienzo más allá del pozo se penaliza: antes que eso, la caja sube
        const cost=Math.abs(dx)+1.6*dy+3*Math.max(0, x+w-Math.max(xSoft, x0+w));
        if(best && cost>=best.cost) continue;
        if(!hit(x,y0-dy,w,h)) best={x, y:y0-dy, cost};
      }
    }
    const b=best||{x:x0, y:y0};
    const p={L, w, h, x:b.x, y:b.y}; occ.push(p); lat.push(p);
  }
  let leads="", out="", noteLeads="", noteOut="", vbid=0, right=0, bottom=0, top=Infinity;
  const arrowCols=new Set();
  const emit=(p,ax,ay)=>{
    const {x,y,w,h,L}=p, id=vbid++;
    // carteles: líder más marcado con flecha en la punta que toca el pozo (x1,y1 = ancla)
    const ac=L.arrow===true?"#333":L.arrow; if(ac) arrowCols.add(ac);
    const st=ac?`stroke="${ac}" stroke-width="1" marker-start="url(#arw-${ac.slice(1)})"`:`stroke="#aaa" stroke-width="0.8"`;
    const ex=ax<x+w/2?x:x+w;                             // el líder llega al lado más cercano de la caja
    const lead=`<line class="vlead" data-vb="${id}" x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(ex)}" y2="${f1(y+h/2)}" ${st}/>`;
    const g=`<g class="vbox" data-vb="${id}" data-key="${V.escAttr(L.key||"")}" data-x="${f1(x)}" data-y="${f1(y)}" data-w="${f1(w)}" data-h="${f1(h)}" style="cursor:move">`
      +box(x, y, w, h, L.lines, L.color, fs, lh, padY, L.swatch, L.bg)+`</g>`;
    if(L.note){ noteLeads+=lead; noteOut+=g; } else { leads+=lead; out+=g; }
    right=Math.max(right, x+w); bottom=Math.max(bottom, y+h); top=Math.min(top, y);
  };
  // el líder sale de la pared del lado de la caja, sobre la NORMAL del camino: en el arco la pared no está
  // al costado del eje sino girada con la curva
  for(const p of [...trunk, ...lat]) emit(p, p.L.f.x-p.L.f.nx*p.L.half, p.L.f.y-p.L.f.ny*p.L.half);
  // flecha de los carteles, del color de cada uno (un <marker> por color usado)
  const defs=arrowCols.size?`<defs>${[...arrowCols].map(c=>`<marker id="arw-${c.slice(1)}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}</defs>`:"";
  return { svg:defs+leads+out, notes:noteLeads+noteOut, right, bottom, top };
}
function box(x,y,w,h,lines,color,fs,lh,padY,swatch,bg){
  let g=`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${bg||"#ffffff"}" stroke="#555" stroke-width="0.9"/>`;
  let x0=x;                                             // con muestra: cuadradito a la izquierda, texto corrido
  if(swatch){ const q=fs*0.95; x0=x+fs*1.5;
    g+=`<rect x="${f1(x+fs*0.6)}" y="${f1(y+h/2-q/2)}" width="${f1(q)}" height="${f1(q)}" fill="${swatch}" stroke="#555" stroke-width="0.6"/>`; }
  lines.forEach((t,i)=>{ g+=`<text x="${f1((x0+x+w)/2)}" y="${f1(y+padY+lh*(i+0.72))}" font-family="Arial,Helvetica,sans-serif" font-size="${f1(fs)}" fill="${color}" text-anchor="middle">${esc(t)}</text>`; });
  return g;
}

/* etiquetas del lateral: rotadas −90° (leen hacia arriba), POR ENCIMA del caño.
   Dos carriles: etapas (cortas) pegadas al caño, tapones (largas) arrancan más arriba.
   Anti-solape en x por carril: si dos caen muy juntas, se empuja a la derecha con líder. */
function renderLanes(list, baseY, FS=10.5){
  if(!list.length) return { svg:"", top:Infinity };
  const fsS=FS*0.86, fsB=FS*0.9;
  const lanes={ small:{y:baseY, prev:-Infinity, gap:fsS*1.35, fs:fsS},
                big:{y:baseY-FS*2.8, prev:-Infinity, gap:fsB*1.55, fs:fsB} };
  let out="", top=Infinity;
  for(const L of list.slice().sort((a,b)=>a.f.x-b.f.x)){
    const lane=L.small?lanes.small:lanes.big;
    const x=Math.max(L.f.x, lane.prev+lane.gap); lane.prev=x;
    out+=`<line x1="${f1(L.f.x)}" y1="${f1(L.f.y-14)}" x2="${f1(x)}" y2="${f1(lane.y+3)}" stroke="#c4c9cf" stroke-width="0.6"/>`;
    out+=`<text x="${f1(x)}" y="${f1(lane.y)}" font-family="ui-monospace,monospace" font-size="${f1(lane.fs)}" fill="${L.color}" text-anchor="start" transform="rotate(-90 ${f1(x)} ${f1(lane.y)})">${esc(L.text)}</text>`;
    top=Math.min(top, lane.y-(L.text.length*lane.fs*0.62+4));  // extremo superior del texto rotado
  }
  return { svg:out, top };
}

/* ============ símbolos ============ */
/* zapato: triángulo rectángulo macizo hacia AFUERA en cada pared, cateto sobre la pared.
   TAMAÑO FIJO para todas las fases (las dimensiones del zapato de 5"): solo la posición de la
   base sigue el semiancho de cada cañería. */
function drawShoe(f, half, size){
  const len=size*0.95+9, out=size*0.55+7;
  let g="";
  for(const sgn of [1,-1]){
    const Wx=f.x+f.nx*sgn*half, Wy=f.y+f.ny*sgn*half;             // punta de la pared
    const Bx=Wx-f.tx*len,      By=Wy-f.ty*len;                     // hacia arriba/atrás
    const Ox=Wx+f.nx*sgn*out,  Oy=Wy+f.ny*sgn*out;                 // hacia afuera
    g+=`<polygon points="${f1(Bx)},${f1(By)} ${f1(Wx)},${f1(Wy)} ${f1(Ox)},${f1(Oy)}" fill="${INK}"/>`;
  }
  return g;
}
/* bloque macizo cruzando el caño (tapón / banda), espesor `th` px a lo largo del MD */
function blockAcross(f, half, th, color){
  const t=Math.max(2,th)/2;
  const p=(sx,sy)=>`${f1(f.x+f.nx*half*sx+f.tx*t*sy)},${f1(f.y+f.ny*half*sx+f.ty*t*sy)}`;
  return `<polygon points="${p(1,1)} ${p(-1,1)} ${p(-1,-1)} ${p(1,-1)}" fill="${color}"/>`;
}
/* PKR y ANCLA: a cada lado, por fuera del TBG, un recuadro que llena el anular TBG–cañería.
   PKR = recuadro con X (ambas diagonales); ANCLA = recuadro con cuña ">" (base sobre el TBG, vértice
   hacia la cañería). Alto mínimo para que el dibujo interior se lea. */
function drawSideBoxes(f, tbgHalf, inner, elw, ink, mode){
  const wr=Math.max(4, inner-tbgHalf-0.6);
  const h=Math.max(9, elw*1.6, wr*1.5)/2;
  let g="";
  for(const sgn of [1,-1]){
    const p=(rad,u)=>`${f1(f.x+f.nx*sgn*rad+f.tx*u)},${f1(f.y+f.ny*sgn*rad+f.ty*u)}`;
    const a=tbgHalf, b=tbgHalf+wr;
    g+=`<polygon points="${p(a,-h)} ${p(b,-h)} ${p(b,h)} ${p(a,h)}" fill="#ffffff" stroke="${ink}" stroke-width="1.2"/>`;
    g+= mode==="x"
      ? `<path d="M${p(a,-h)} L${p(b,h)} M${p(b,-h)} L${p(a,h)}" fill="none" stroke="${ink}" stroke-width="1.1"/>`
      : `<polyline points="${p(a,-h)} ${p(b,0)} ${p(a,h)}" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
  }
  return g;
}
/* TPN de instalación: rectángulo que cruza todo el ID de la cañería, con X (ambas diagonales) */
function drawPlugX(f, inner, elw, ink){
  const h=Math.max(8, elw*1.4, inner*0.35)/2;           // ~6:1 en cañerías anchas, legible en finas
  const p=(v,u)=>`${f1(f.x+f.nx*v+f.tx*u)},${f1(f.y+f.ny*v+f.ty*u)}`;
  return `<polygon points="${p(-inner,-h)} ${p(inner,-h)} ${p(inner,h)} ${p(-inner,h)}" fill="#ffffff" stroke="${ink}" stroke-width="1.3"/>`
    +`<path d="M${p(-inner,-h)} L${p(inner,h)} M${p(inner,-h)} L${p(-inner,h)}" fill="none" stroke="${ink}" stroke-width="1.1"/>`;
}
/* BHA: símbolo rígido en el marco local del MD (u = a lo largo del pozo, + hacia el fondo; v = a lo
   ancho), así en el lateral queda "acostado" con la punta hacia el toe. La fresa (campana con tres
   dientes redondeados) termina justo en el MD. Con MDF: anillo + cuerpo recto largo arriba (motor). */
function drawBHA(f, H, mdf, col){
  const pt=(u,v)=>`${f1(f.x+f.tx*u+f.nx*v)},${f1(f.y+f.ty*u+f.ny*v)}`;
  const u0=-2.45*H, u1=-0.62*H, r=H/3;
  const pts=[[u0,-0.7*H],[u0,0.7*H]];
  for(let k=1;k<=6;k++){ const s=k/6; pts.push([u0+(u1-u0)*s, 0.7*H+0.3*H*Math.pow(s,0.6)]); }   // flanco derecho
  pts.push([-r,H]);
  for(const c of [2*H/3, 0, -2*H/3])                                    // tres dientes (der → izq)
    for(let k=0;k<=10;k++){ const ph=Math.PI*k/10; pts.push([-r+r*Math.sin(ph), c+r*Math.cos(ph)]); }
  pts.push([u1,-H]);
  for(let k=5;k>=0;k--){ const s=k/6; pts.push([u0+(u1-u0)*s, -(0.7*H+0.3*H*Math.pow(s,0.6))]); } // flanco izquierdo
  let g=`<polygon points="${pts.map(([u,v])=>pt(u,v)).join(" ")}" fill="${col}"/>`;
  if(mdf){
    const rect=(ua,ub,hv)=>`<polygon points="${pt(ua,-hv)} ${pt(ua,hv)} ${pt(ub,hv)} ${pt(ub,-hv)}" fill="${col}"/>`;
    const b1=u0-0.19*H, b0=b1-0.5*H;                                   // anillo (sub) sobre la fresa
    g+=rect(b0,b1,0.81*H)+rect(b0-3.0*H,b0,0.42*H);                     // + cuerpo del motor
  }
  return g;
}
/* bomba: símbolo rígido en el marco local del MD, desde el MD hacia el fondo (u = 0..len), con anillos */
function drawPump(f, len, hw, fill, ink){
  const pt=(u,v)=>`${f1(f.x+f.tx*u+f.nx*v)},${f1(f.y+f.ty*u+f.ny*v)}`;
  let g=`<polygon points="${pt(0,-hw)} ${pt(0,hw)} ${pt(len,hw)} ${pt(len,-hw)}" fill="${fill}" stroke="${ink}" stroke-width="1.3"/>`;
  const n=Math.max(3, Math.round(len/4.2));
  for(let k=1;k<n;k++){ const u=len*k/n; g+=`<path d="M${pt(u,-hw)} L${pt(u,hw)}" fill="none" stroke="${ink}" stroke-width="0.9"/>`; }
  return g;
}
/* centralizador de varilla: rombo chico centrado en la varilla */
function drawCentralizer(f, hw, hl, ink=INK){
  const p=(u,v)=>`${f1(f.x+f.tx*u+f.nx*v)},${f1(f.y+f.ty*u+f.ny*v)}`;
  return `<polygon points="${p(-hl,0)} ${p(0,hw)} ${p(hl,0)} ${p(0,-hw)}" fill="${ink}"/>`;
}
/* patrón de TPN de cemento sobre un color base: pintas = el mismo color oscurecido */
function cemPattern(id, base){
  const dots=[[1.5,2,1,0.585],[5.6,4.4,0.9,0.66],[3,6.8,0.75,0.51],[6.8,1,0.6,0.72],[4.2,2.6,0.45,0.55]];
  return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${base}"/>`
    +dots.map(([x,y,r,k])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${shade(base,k)}"/>`).join("")+`</pattern>`;
}
/* "#rrggbb" × k (k<1 oscurece) → rgb() */
function shade(hex, k){
  const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex||""); if(!m) return INK;
  const [r,g,b]=[1,2,3].map(i=>Math.round(parseInt(m[i],16)*k)); return `rgb(${r},${g},${b})`;
}
/* color de fluido → gris (tema B&N), conservando la luminancia relativa */
function grayOf(hex){
  const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex||"");
  if(!m) return "#bbbbbb";
  const [r,g,b]=[1,2,3].map(i=>parseInt(m[i],16)), l=(0.2126*r+0.7152*g+0.0722*b)/255;
  const v=Math.round(150+l*90); return `rgb(${v},${v},${v})`;
}
/* punzados: "dientes" largos y puntiagudos (conos de punzado) saliendo de ambas paredes hacia la
   formación, SUPERANDO el anular de cemento. Espaciado fijo en px, solapados tipo zigzag —
   representación esquemática, NO 1:1 con la cantidad real de tiros. */
function drawTeeth(P, md0, md1, half, col, reach){
  const a=P(md0), b=P(md1);
  const distPx=Math.hypot(b.x-a.x, b.y-a.y);
  const len=Math.max(14, (reach||half*3.2+12)-half);      // largo del cono: pasa el cemento
  const base=8, step=6.5;                                 // base fina + paso menor ⇒ zigzag denso
  const n=Math.max(2, Math.round(distPx/step));
  let g="";
  for(let i=0;i<=n;i++){
    const f=P(md0+(md1-md0)*i/n);
    for(const sgn of [1,-1]){
      const bx=f.x+f.nx*sgn*half, by=f.y+f.ny*sgn*half;    // base del diente sobre la pared
      const ax=bx+f.nx*sgn*len,  ay=by+f.ny*sgn*len;       // ápice bien afuera, en la formación
      g+=`<polygon points="${f1(bx-f.tx*base/2)},${f1(by-f.ty*base/2)} ${f1(ax)},${f1(ay)} ${f1(bx+f.tx*base/2)},${f1(by+f.ty*base/2)}" fill="${col}" fill-opacity="0.9"/>`;
    }
  }
  return g;
}
function niceStep(raw){ const p=Math.pow(10,Math.floor(Math.log10(Math.max(raw,1)))); const n=raw/p;
  const m = n<1.5?1 : n<3.5?2 : n<7.5?5 : 10; return m*p; }
function emptySVG(msg){ return { svg:`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><rect width="320" height="80" fill="#fff"/><text x="12" y="44" font-family="monospace" font-size="13">${msg}</text></svg>`, width:320, height:80 }; }

/* ============ export a archivo ============ */
export async function export2D(w, opts, fmt){
  const { svg, width, height } = buildWellSVG(w, opts);
  const canvas = await rasterizeSVG(svg, width, height, "#ffffff", 2);
  const stamp = new Date().toISOString().slice(0,10);
  const base = `${(w.id||"pozo").replace(/[^\w.-]+/g,"_")}_corte_${stamp}`;
  if(fmt==="pdf"){ if(!canvasToPDF(canvas, base+".pdf")) throw new Error("jsPDF no está disponible"); }
  else canvasToFile(canvas, fmt, base+(fmt==="image/jpeg"?".jpg":".png"));
}
