import * as THREE from "three";

/* Extensión propia de la app para los pads (mismo contenido JSON, extensión particularizada).
   La lectura es por contenido (JSON.parse), así que .vvwp/.vvw/.json se abren igual. */
const PAD_EXT = "vvwp";

/* ============ Navegación ============ */
const views=document.querySelectorAll(".view"), navBtns=document.querySelectorAll("nav button");
function show(id){ views.forEach(v=>v.classList.toggle("active",v.id===id));
  navBtns.forEach(b=>b.classList.toggle("active",b.dataset.view===id)); if(id==="v3d") onResize(); }
navBtns.forEach(b=>b.addEventListener("click",()=>show(b.dataset.view)));
window.addEventListener("keydown",e=>{
  const m={"1":"v3d","2":"vexport","3":"vdata","4":"vconfig"};
  if(/input|textarea|select/i.test(document.activeElement.tagName)) return;
  if(m[e.key]) show(m[e.key]);
  if(e.key==="f"||e.key==="F") frameAll();
  if(e.key==="m"||e.key==="M") setMeasure(!measureMode);
  if(e.key==="Escape"){ if(measurePts.length||measureMode){ clearMeasure(); setMeasure(false); } }
  if(e.key==="d"||e.key==="D"){ DBG=!DBG; document.getElementById("dbg").style.display=DBG?"block":"none"; updateDbg(); }
});
let DBG=false;

/* ============ Three.js base ============ */
const canvas=document.getElementById("c3d");
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x0d1117);
const world=new THREE.Group(); scene.add(world);
const camera=new THREE.PerspectiveCamera(45,1,1,60000);
scene.add(new THREE.HemisphereLight(0xcfe0ff,0x121820,1.5));
const dir=new THREE.DirectionalLight(0xffffff,0.85); dir.position.set(1,2,3); scene.add(dir);

/* gridGroup contiene dos grillas horizontales: superficie (TVD=0) y fondo/piso (50 m bajo lo más
   profundo). Se reconstruyen por pad en buildGrids() para adaptar la huella (N/S sigue las ramas,
   E/O ±1000 m). export3d togglea gridGroup.visible en bloque; acá controlamos cada grilla por hijo. */
const gridGroup=new THREE.Group(); world.add(gridGroup);
let surfaceGrid=null, floorGrid=null;
const axes=new THREE.AxesHelper(400); world.add(axes);
const shoesGroup=new THREE.Group(); world.add(shoesGroup);
const measureGroup=new THREE.Group(); world.add(measureGroup);   // regla medidora

let target=new THREE.Vector3(0,0,0), sph=new THREE.Spherical(3000,1.1,0.6);

/* Colores por pozo */
const WELL_COLORS=[0x4ea1d3,0x6cc04a,0xe0a83d,0xc77dff,0xff7b72,0x39c5cf];
/* OD real en pulgadas → radio base en metros, luego escalado por diamExag. */
const OD_IN={guia:13.375,intermedia1:9.625,intermedia2:7.625,produccion:5.0};
/* Colores de cañería bien diferenciables entre sí y del fondo oscuro.
   De externo a interno: guía (arena claro), int1 (celeste), int2 (lavanda), aislación (blanco cálido). */
const CASING_COLOR={guia:0xe8c96a, intermedia1:0x7fc7e0, intermedia2:0xb79fe0, produccion:0xf2ede2};
/* Punzados: turquesa que alterna claro/oscuro entre etapas consecutivas */
const PERF_LIGHT=0x6ff5e8, PERF_DARK=0x17c4b0;
/* Nombres de fase para la leyenda (sin medidas, la fase es lo estable) */
const PHASE_LABEL={guia:"Guía", intermedia1:"Intermedia 1", intermedia2:"Intermedia 2", produccion:"Aislación"};

let PAD=null, wellObjects={}, vexag=1, diamExag=40, plugCountInverted=false, perfRadiusM=20;
let odFormat="decimal";          // "decimal" (7.625") | "imperial" (7 5/8")
/* OD en pulgadas → texto. Imperial redondea a octavos (los OD de casing son fracciones de 1/8"). */
function fmtOD(od){
  if(od==null) return "";
  if(odFormat==="decimal") return `${od}"`;
  const whole=Math.floor(od);
  let num=Math.round((od-whole)*8), den=8;
  if(num===0) return `${whole}"`;
  while(num%2===0 && den%2===0){ num/=2; den/=2; }   // simplifica 4/8→1/2, 6/8→3/4…
  return `${whole} ${num}/${den}"`;
}
let autoDiam=false;              // auto-escala de diámetro según distancia de cámara
const AUTO_TARGET_PX=18;         // tamaño aparente deseado de la aislación (px de diámetro)
const AUTO_MIN=15, AUTO_MAX=1600;// límites del multiplicador efectivo
/* recalcula diamExag según la distancia de cámara para que la aislación tenga ~AUTO_TARGET_PX
   en pantalla. Regenera solo cuando el objetivo difiere >18% del actual (evita regenerar por frame). */
function updateAutoDiam(){
  const H=canvas.clientHeight||900;
  const k=H/(2*Math.tan((camera.fov*Math.PI/360)));
  const prodBaseR=(5/2)*0.0254;          // radio real aislación (m) a exageración 1×
  let want=(AUTO_TARGET_PX*sph.radius)/(2*prodBaseR*k);
  want=Math.max(AUTO_MIN, Math.min(AUTO_MAX, want));
  if(Math.abs(want-diamExag)/diamExag > 0.18){
    diamExag=want;
    const s=document.getElementById("cfg-dexag");
    document.getElementById("dexag-val").textContent=Math.round(diamExag)+"× (auto)";
    if(PAD) buildPad(PAD);
  }
}

/* ===== Modos de coloreo de la aislación (mutuamente excluyentes) =====
   "normal": color de fase (gris) · "stages": 2 verdes alternados por etapa
   · "dogleg_lateral": DLS en el tramo de etapas (última→primera), normalizado a su propio máximo
     → resalta el dogleg fino del lateral sin que lo tape el rojo de la curva.
   · "dogleg_build": DLS en el tramo de curva (superficie→última etapa) → resalta la curva de asentamiento.
   · "dogleg_total": DLS en TODA la trayectoria (superficie→fondo), un único rango normalizado
     → vista de conjunto; la curva suele dominar el rojo.
   El coloreo se hace con vertex colors sobre el MISMO tubo (sin geometría extra). */
let isoMode="normal";
const ISO_BASE=new THREE.Color(0xf2ede2);          // gris cálido casi blanco (fase produccion)
const STAGE_GREEN_A=new THREE.Color(0x18d94a);     // verde etapa par (vivo)
const STAGE_GREEN_B=new THREE.Color(0xa6ff2e);     // verde-lima etapa impar (vivo)
/* rampa dogleg SATURADA: 0→verde puro, medio→amarillo intenso, max→rojo puro.
   El máximo se pasa por parámetro: cada sub-modo usa el máximo real de SU tramo (auto-normalizado),
   así el gradiente ocupa todo el rango de color aunque los dos tramos tengan escalas muy distintas. */
const DLS_LOW=new THREE.Color(0x00e33a), DLS_MID=new THREE.Color(0xffe500), DLS_HIGH=new THREE.Color(0xff1e1e);
function dlsColor(dls, dmax){
  const t=Math.max(0,Math.min(1,(dls||0)/(dmax||8)));
  const c=new THREE.Color();
  if(t<0.5) c.lerpColors(DLS_LOW,DLS_MID,t/0.5);
  else       c.lerpColors(DLS_MID,DLS_HIGH,(t-0.5)/0.5);
  return c;
}

/* radio visual (m) de una cañería según su OD real y la exageración de diámetro */
function casingRadius(phase, od_in){
  const od=(od_in!=null?od_in:(OD_IN[phase]||5));
  return (od/2)*0.0254*diamExag;   // metros, exagerado
}

/* world transform: (x=E/O, y=N/S, tvd abajo) → three Y-up.
   El Este se mapea a -X (no +X) para que el marco sea diestro y geográficamente correcto:
   con Este=+X, Norte=+Z, Arriba=+Y el producto E×N daba "abajo" (marco zurdo) y el par E/O
   quedaba espejado — por eso, mirando desde el Sur, el pozo 1 (Oeste) aparecía a la derecha.
   Con Este=-X: mirando al Norte, el Oeste queda a la izquierda y el Este a la derecha. */
function toThree(x,y,tvd){ return new THREE.Vector3(-x, -tvd*vexag, y); }

/* ===== Etiquetas HTML overlay (tamaño fijo en pantalla, umbral de zoom + LOD) =====
   Cada etiqueta = {pos:Vector3, el:div, kind:'tpn'|'stage', wellId, visible}.
   Se proyectan a pantalla cada frame; se ocultan si la cámara está lejos o por LOD. */
const labelsLayer=document.getElementById("labels");
let LABELS=[];
function clearLabels(){ LABELS.forEach(l=>l.el.remove()); LABELS=[]; }
function addLabel(text, pos3, kind, wellId, html){
  const el=document.createElement("div");
  el.className="lbl3d "+kind; el[html?"innerHTML":"textContent"]=text;
  labelsLayer.appendChild(el);
  LABELS.push({pos:pos3.clone(), el, kind, wellId, idx:LABELS.length});
}
const escHtml=s=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const escAttr=s=>String(s??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");
/* Distancia de cámara a partir de la cual se muestran; y cada cuántas etiquetas
   mostrar según zoom (LOD por conteo, sin cálculo de colisiones). */
function labelStep(radius){
  // radius = distancia orbital de cámara. Cuanto más lejos, más salteo.
  if(radius>4500) return 0;      // muy lejos: ninguna
  if(radius>2600) return 8;      // lejos: 1 de cada 8
  if(radius>1500) return 4;
  if(radius>800)  return 2;
  return 1;                       // cerca: todas
}
const _projV=new THREE.Vector3();
function updateLabels(){
  const step=labelStep(sph.radius);
  const W=canvas.clientWidth, H=canvas.clientHeight;
  let shownStage=0, shownTpn=0;
  // Escala por zoom: a `R0` (o más cerca) las etiquetas tienen su tamaño normal (k=1); al alejarse
  // más allá de ese umbral se encogen ∝ R0/radio (se ven de lejos, pero apenas legibles). Piso 0.14.
  const R0 = Math.max(500, _sceneRadius*0.5);
  const kScale = Math.max(0.14, Math.min(1, R0/sph.radius));
  for(const l of LABELS){
    const wellVisible = wellObjects[l.wellId] ? wellObjects[l.wellId].visible : true;
    const kindOn = l.kind==="tpn" ? SHOW_TPN_LABELS : l.kind==="stage" ? SHOW_STAGE_LABELS
                 : l.kind==="short" ? SHOW_SHORT_LABELS : l.kind==="install" ? SHOW_INSTALL_LABELS
                 : l.kind==="shoetrack" ? SHOW_SHOETRACK_LABELS : l.kind==="toc" ? SHOW_TOC_LABELS
                 : l.kind==="gridnum" ? SHOW_GRIDNUMS : SHOW_SHOE_LABELS;
    // visibilidad por pozo (árbol): la etiqueta sigue al elemento de SU pozo
    const vw=VIS[l.wellId];
    const elemKey = l.kind==="tpn" ? "plug" : (l.kind==="short"||l.kind==="install"||l.kind==="shoetrack"||l.kind==="toc") ? l.kind : null;
    const elemOn = !vw || !elemKey || vw[elemKey]!==false;
    if(!wellVisible || !kindOn || !elemOn){ l.el.style.display="none"; continue; }
    // zapatos, caños cortos, instalación, shoetrack, TOC y números de grilla: siempre visibles (pocos). Etapas/tapones: LOD.
    if(l.kind!=="shoe" && l.kind!=="short" && l.kind!=="install" && l.kind!=="shoetrack" && l.kind!=="toc" && l.kind!=="gridnum"){
      if(step===0){ l.el.style.display="none"; continue; }
      const counter = l.kind==="tpn" ? shownTpn++ : shownStage++;
      if(counter % step !== 0){ l.el.style.display="none"; continue; }
    }
    _projV.copy(l.pos).project(camera);
    if(_projV.z>1){ l.el.style.display="none"; continue; }
    const x=(_projV.x*0.5+0.5)*W, y=(-_projV.y*0.5+0.5)*H;
    l.el.style.display="block";
    l.el.style.left=x+"px"; l.el.style.top=y+"px";
    l.el.style.transform=`translate(-50%,-50%) scale(${kScale})`;
  }
}
let SHOW_TPN_LABELS=false, SHOW_STAGE_LABELS=true, SHOW_SHOE_LABELS=false, SHOW_SHORT_LABELS=false, SHOW_INSTALL_LABELS=false, SHOW_SHOETRACK_LABELS=false, SHOW_TOC_LABELS=false, SHOW_CURSOR_TIP=true, SHOW_GRIDNUMS=false;

/* interpola X,Y,TVD (coords locales del pad) a un MD dado desde las stations */
function interpAtMD(st, md, wx){
  if(md<=st[0].md) return {x:wx+(st[0].ew||0), y:st[0].ns||0, tvd:st[0].tvd};
  for(let i=1;i<st.length;i++){
    if(md<=st[i].md){
      const a=st[i-1], b=st[i], t=(md-a.md)/(b.md-a.md||1);
      return {
        x: wx + ((a.ew||0)+((b.ew||0)-(a.ew||0))*t),
        y: (a.ns||0)+((b.ns||0)-(a.ns||0))*t,
        tvd: a.tvd+(b.tvd-a.tvd)*t
      };
    }
  }
  const last=st.at(-1);
  return {x:wx+(last.ew||0), y:last.ns||0, tvd:last.tvd};
}

function clearWorld(){ Object.values(wellObjects).forEach(g=>world.remove(g)); wellObjects={}; shoesGroup.clear(); clearLabels();
  if(typeof measurePts!=="undefined"){ measurePts.length=0; measureGroup.clear(); if(measureTip) measureTip.style.display="none"; } }

/* Pinta un tubo de aislación con vertex colors según isoMode.
   normal → sin vertex colors (usa el color del material). stages/dogleg → color por anillo. */
function applyIsoColors(tube){
  const iso=tube.userData.iso; if(!iso) return;
  const geo=tube.geometry, mat=tube.material;
  const ringVerts=iso.radial+1;                 // vértices por anillo (radialSegments+1)
  const nRings=iso.tubSeg+1;
  if(isoMode==="normal"){
    mat.vertexColors=false; mat.color.set(ISO_BASE); geo.deleteAttribute("color");
    mat.emissive.set(0x000000); mat.emissiveIntensity=1; mat.metalness=.15; mat.roughness=.65;
    if(mat.userData._emissivePatched){ mat.onBeforeCompile=()=>{}; mat.userData._emissivePatched=false; mat.needsUpdate=true; }
    mat.needsUpdate=true; return;
  }
  const isDogleg = isoMode==="dogleg_lateral" || isoMode==="dogleg_build" || isoMode==="dogleg_total";
  // frontera curva/lateral = MD del inicio de la primera etapa (primer cluster de la etapa más somera)
  let firstStageMD=Infinity, lastStageMD=-Infinity;
  iso.stageRanges.forEach(r=>{ firstStageMD=Math.min(firstStageMD,r.md0); lastStageMD=Math.max(lastStageMD,r.md1); });
  if(!isFinite(firstStageMD)){   // sin fracplan: usa el landing del survey como frontera curva/lateral
    firstStageMD = (iso.landingMD!=null ? iso.landingMD : iso.ringMD(iso.tubSeg));
    lastStageMD = iso.ringMD(iso.tubSeg);
  }
  // tramo activo del dogleg: build=curva, lateral=etapas, total=toda la trayectoria (sin segmentar)
  const dlsInSeg = isoMode==="dogleg_build" ? (md=>md<firstStageMD)
                 : isoMode==="dogleg_total" ? (()=>true)
                 : (md=>md>=firstStageMD);
  // para dogleg: máximo DLS DENTRO del tramo activo, para auto-normalizar el gradiente a ese tramo
  let segMax=0;
  if(isDogleg){
    for(let i=0;i<=iso.tubSeg;i++){
      const md=iso.ringMD(i);
      if(dlsInSeg(md)) segMax=Math.max(segMax, iso.dlsAtMD(md));
    }
    if(segMax<=0) segMax=1;
  }
  tube.userData.dlsSegMax = isDogleg ? segMax : null;   // lo lee el hover-tip para contexto
  const colors=new Float32Array(nRings*ringVerts*3);
  const c=new THREE.Color();
  for(let i=0;i<nRings;i++){
    const md=iso.ringMD(i);
    if(isoMode==="stages"){
      const sr=iso.stageRanges.find(r=>md>=r.md0 && md<=r.md1);
      if(sr) c.copy(sr.stage%2===0?STAGE_GREEN_A:STAGE_GREEN_B);
      else   c.copy(ISO_BASE);                  // fuera de etapas (arriba del 1er cluster)
    } else { // dogleg_lateral | dogleg_build | dogleg_total
      if(dlsInSeg(md)) c.copy(dlsColor(iso.dlsAtMD(md), segMax));
      else             c.copy(ISO_BASE);        // el otro tramo queda en gris, no compite
    }
    for(let j=0;j<ringVerts;j++){ const o=(i*ringVerts+j)*3; colors[o]=c.r; colors[o+1]=c.g; colors[o+2]=c.b; }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors,3));
  // material plano y luminoso para que el dato se lea vivo sin depender de la luz de escena:
  // emissive sigue el vertex color (emissiveIntensity>0 con vertexColors ilumina el propio color).
  mat.vertexColors=true; mat.color.set(0xffffff);
  mat.metalness=0; mat.roughness=1;
  mat.emissive.set(0x000000); mat.emissiveIntensity=1;
  // el emissive sigue el vertex color: el dato se ve vivo aunque la cara esté en sombra o de lejos.
  if(!mat.userData._emissivePatched){
    mat.userData._emissivePatched=true;
    mat.onBeforeCompile=(shader)=>{
      shader.fragmentShader=shader.fragmentShader.replace(
        "vec3 totalEmissiveRadiance = emissive;",
        "vec3 totalEmissiveRadiance = emissive + vColor * 0.6;"
      );
    };
  }
  mat.needsUpdate=true;
}
function refreshIsoColors(){
  Object.values(wellObjects).forEach(g=>g.traverse(o=>{
    if(o.userData.kind==="casing" && o.userData.phase==="produccion" && o.userData.iso) applyIsoColors(o);
  }));
}

let LAST_WARN="";
function buildPad(pad){
  clearWorld(); PAD=pad;
  const wells=pad.pad.wells;
  document.getElementById("foot-pad").textContent=pad.pad.id;
  document.getElementById("foot-wells").textContent=wells.length;

  // --- guarda de cordura: coordenadas anómalas (coords absolutas del CRS sin convertir) ---
  LAST_WARN="";
  wells.forEach(w=>{
    const st=w.survey.stations;
    for(const s of st){
      if(Math.abs(s.ns||0)>1e5 || Math.abs(s.ew||0)>1e5){
        LAST_WARN=`${w.id}: coords fuera de rango (NS/EW > 100km). ¿Survey con Northing/Easting absolutos en vez de offsets locales?`;
        break;
      }
    }
  });
  if(LAST_WARN) toast("⚠ "+LAST_WARN);

  wells.forEach((w,idx)=>{
    const color=WELL_COLORS[idx%WELL_COLORS.length];
    const wx=w.wellhead.x||0, st=w.survey.stations;
    const g=new THREE.Group(); g.userData.well=w.id;

    const pts=st.map(s=>toThree(wx+(s.ew||0), s.ns||0, s.tvd));
    const curve=new THREE.CatmullRomCurve3(pts);

    const traj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(400,st.length*2))),
      new THREE.LineBasicMaterial({color}));
    traj.userData.kind="traj"; traj.userData.wellId=w.id; g.add(traj);

    (w.casings||[]).forEach(cas=>{
      if(cas.shoe_md==null) return;
      const seg=[]; for(const s of st){ if(s.md<=cas.shoe_md) seg.push(toThree(wx+(s.ew||0),s.ns||0,s.tvd)); }
      const sp=interpAtMD(st,cas.shoe_md,wx); seg.push(toThree(sp.x,sp.y,sp.tvd));
      if(seg.length<2) return;
      const c2=new THREE.CatmullRomCurve3(seg);
      const r=casingRadius(cas.phase, cas.od_in);
      const isProd=cas.phase==="produccion";
      const col=CASING_COLOR[cas.phase]||0xd0d0d0;
      // aislación: más segmentos para que el coloreo por etapa/dogleg tenga bordes nítidos
      // (cada etapa mide ~100m; con ~600 anillos sobre ~6600m hay ~8 anillos/etapa).
      const tubSeg=isProd ? Math.max(600,seg.length*3) : Math.max(80,seg.length);
      const geo=new THREE.TubeGeometry(c2, tubSeg, r, 14, false);
      const mat=new THREE.MeshStandardMaterial({color:col, metalness:.15, roughness:.65,
          transparent:!isProd, opacity:isProd?1:0.42, side:THREE.DoubleSide});
      const tube=new THREE.Mesh(geo, mat);
      tube.userData.kind="casing"; tube.userData.phase=cas.phase; tube.userData.radius=r;
      if(isProd){
        // tabla arc-length→MD: cada anillo del tubo se ubica por longitud de arco de c2.
        // Recorremos los puntos de seg acumulando distancia 3D y su MD paralelo.
        const segMDs=[]; for(const s of st){ if(s.md<=cas.shoe_md) segMDs.push(s.md); } segMDs.push(cas.shoe_md);
        const cum=[0]; for(let i=1;i<seg.length;i++) cum.push(cum[i-1]+seg[i].distanceTo(seg[i-1]));
        const total=cum.at(-1)||1;
        const ringMD=i=>{                 // MD del anillo i (0..tubSeg) por arc-length
          const d=(i/tubSeg)*total;
          let k=1; while(k<cum.length-1 && cum[k]<d) k++;
          const t=(d-cum[k-1])/((cum[k]-cum[k-1])||1);
          return segMDs[k-1]+(segMDs[k]-segMDs[k-1])*t;
        };
        // rangos MD de cada etapa (primer top al último bottom de sus clusters)
        const stageRanges=(w.frac?.stages||[]).map(s=>{
          const mds=(s.clusters||[]).flatMap(c=>[c.top_md,c.bottom_md]).filter(x=>x!=null);
          return mds.length?{stage:s.stage,md0:Math.min(...mds),md1:Math.max(...mds)}:null;
        }).filter(Boolean);
        // dls interpolable por MD desde el survey
        const dlsAtMD=md=>{
          if(md<=st[0].md) return st[0].dls||0;
          for(let i=1;i<st.length;i++) if(md<=st[i].md){
            const a=st[i-1],b=st[i],t=(md-a.md)/((b.md-a.md)||1);
            return (a.dls||0)+((b.dls||0)-(a.dls||0))*t;
          }
          return st.at(-1).dls||0;
        };
        // landing aprox: primer MD con inclinación ≥88° (o el de mayor inclinación si nunca llega).
        // Frontera curva/lateral cuando NO hay fracplan (sin él, stageRanges queda vacío y el dogleg
        // no tenía dónde cortar: la "rama" pintaba todo y la "curva" nada).
        let landingMD=null, maxIncl=-1, maxInclMD=st[0]?.md||0;
        for(const s of st){ const inc=s.incl||0;
          if(inc>maxIncl){ maxIncl=inc; maxInclMD=s.md; }
          if(landingMD==null && inc>=88) landingMD=s.md; }
        if(landingMD==null) landingMD=maxInclMD;
        tube.userData.iso={tubSeg, radial:14, ringMD, stageRanges, dlsAtMD, landingMD};
        applyIsoColors(tube);            // pinta según isoMode actual
      }
      g.add(tube);
      // caños cortos (pup joints de la aislación): banda amarilla de referencia, alternable por sí sola.
      // Son piezas de casing mucho más cortas que un tiro normal; se resaltan aunque midan pocos metros.
      (cas.short_joints||[]).forEach(sj=>{
        if(sj.top_md==null || sj.bottom_md==null) return;
        const a=interpAtMD(st,sj.top_md,wx), b=interpAtMD(st,sj.bottom_md,wx);
        const va=toThree(a.x,a.y,a.tvd), vb=toThree(b.x,b.y,b.tvd);
        const mid=va.clone().add(vb).multiplyScalar(0.5);
        const axis=vb.clone().sub(va); let h=axis.length();
        if(h<1e-6){ axis.set(0,-1,0); h=0; }
        const H=Math.max(h, r*2.5);               // alto mínimo para que sea visible pese a ser corto
        const band=new THREE.Mesh(new THREE.CylinderGeometry(r*1.18, r*1.18, H, 20),
          new THREE.MeshStandardMaterial({color:0xffe500, metalness:.2, roughness:.5, emissive:0x3a3600, emissiveIntensity:.6}));
        band.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), axis.normalize()));
        band.position.copy(mid);
        band.userData.kind="short"; band.userData.wellId=w.id; g.add(band);
        const ccLen = (sj.length_m!=null) ? ` (${sj.length_m} m)` : "";
        addLabel(`${sj.xover?"Xover":"Caño corto"} · MD ${Math.round(sj.top_md)}${ccLen}`,
          mid.clone().add(new THREE.Vector3(0, r*4, 0)), "short", w.id);
      });
      // shoetrack (últimos ~150 m de la aislación): bandas violeta claro + 1 etiqueta con la lista
      if(cas.shoetrack?.elements?.length){
        cas.shoetrack.elements.forEach(el=>{
          if(el.top_md==null || el.bottom_md==null) return;
          const a=interpAtMD(st,el.top_md,wx), b=interpAtMD(st,el.bottom_md,wx);
          const va=toThree(a.x,a.y,a.tvd), vb=toThree(b.x,b.y,b.tvd);
          const mid=va.clone().add(vb).multiplyScalar(0.5);
          const axis=vb.clone().sub(va); let h=axis.length(); if(h<1e-6){ axis.set(0,-1,0); h=0; }
          const band=new THREE.Mesh(new THREE.CylinderGeometry(r*1.16, r*1.16, Math.max(h,r*2.2), 20),
            new THREE.MeshStandardMaterial({color:0xc9a3ff, metalness:.2, roughness:.5, emissive:0x2a1f3a, emissiveIntensity:.5}));
          band.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), axis.normalize()));
          band.position.copy(mid); band.userData.kind="shoetrack"; band.userData.wellId=w.id; g.add(band);
        });
        const first=cas.shoetrack.elements[0]; const sp=interpAtMD(st,first.top_md,wx);
        let html=`<b>shoetrack</b> · MD ${Math.round(first.top_md)} · TVD ${Math.round(sp.tvd)}`;
        cas.shoetrack.elements.forEach((el,idx)=>{
          const d=escHtml(el.desc.length>28?el.desc.slice(0,28)+"…":el.desc);
          html+=`<br>${idx+1}. ${d} · ${Math.round(el.top_md)} m`;
        });
        addLabel(html, toThree(sp.x,sp.y,sp.tvd).add(new THREE.Vector3(0, r*6, 0)), "shoetrack", w.id, true);
      }
      // triángulo de zapato + leyenda MD/TVD (se completa en v0.2d con clipping; marca base acá)
      // zapato: disco sólido del color de la fase, orientado normal al eje del pozo
      const shoeTan=(function(){
        const d=5, a=interpAtMD(st,Math.max(0,cas.shoe_md-d),wx), b=interpAtMD(st,cas.shoe_md,wx);
        const va=toThree(a.x,a.y,a.tvd), vb=toThree(b.x,b.y,b.tvd);
        const t=vb.sub(va); return t.lengthSq()>1e-9?t.normalize():new THREE.Vector3(0,-1,0);
      })();
      const shoe=new THREE.Mesh(new THREE.CylinderGeometry(r*1.35, r*1.35, r*0.6, 20),
        new THREE.MeshStandardMaterial({color:col, metalness:.3, roughness:.5}));
      const sq=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), shoeTan);
      shoe.quaternion.copy(sq); shoe.position.copy(toThree(sp.x,sp.y,sp.tvd));
      shoe.userData.kind="shoe"; shoe.userData.wellId=w.id; shoesGroup.add(shoe);
      // etiqueta de zapato: OD, libraje (lb/ft) y acero  →  ej.  5" 21.4 lb/ft P110 · MD 6650 · TVD 3070
      const specs=[fmtOD(cas.od_in)];
      if(cas.weight_ppf!=null) specs.push(`${cas.weight_ppf} lb/ft`);
      if(cas.grade) specs.push(cas.grade);
      const shoeTvd=sp.tvd.toFixed(0);
      addLabel(`${specs.join(" ")} · MD ${Math.round(cas.shoe_md)} · TVD ${shoeTvd}`,
        toThree(sp.x,sp.y,sp.tvd).add(new THREE.Vector3(0, r*2, 0)), "shoe", w.id);

      // TOC (tope de cemento): cono achatado (embudo) apuntando hacia superficie — se lee claro
      // como "acá empieza el cemento", distinto de un anillo o un tapón. Color cemento (tan).
      if(cas.toc_md!=null){
        const tp=interpAtMD(st,cas.toc_md,wx);
        const ta=interpAtMD(st,Math.max(0,cas.toc_md-5),wx);
        let tocTan=toThree(tp.x,tp.y,tp.tvd).sub(toThree(ta.x,ta.y,ta.tvd));
        tocTan = tocTan.lengthSq()>1e-9?tocTan.normalize():new THREE.Vector3(0,-1,0);
        const cone=new THREE.Mesh(new THREE.ConeGeometry(r*1.9, r*3.4, 18),
          new THREE.MeshStandardMaterial({color:0xcbb78a, metalness:.1, roughness:.85, emissive:0x2a2410, emissiveIntensity:.45}));
        // apex hacia superficie (up-hole): eje +Y del cono → -tangente
        cone.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), tocTan.clone().negate()));
        cone.position.copy(toThree(tp.x,tp.y,tp.tvd));
        cone.userData.kind="toc"; cone.userData.wellId=w.id; g.add(cone);
        addLabel(`TOC · MD ${Math.round(cas.toc_md)} · TVD ${Math.round(tp.tvd)}`,
          toThree(tp.x,tp.y,tp.tvd).add(new THREE.Vector3(0, r*3.2, 0)), "toc", w.id);
      }
    });

    // helper: tangente del pozo en un MD (para orientar rayos perpendiculares al eje)
    function tangentAtMD(md){
      const d=5;
      const a=interpAtMD(st, Math.max(0,md-d), wx), b=interpAtMD(st, md+d, wx);
      const va=toThree(a.x,a.y,a.tvd), vb=toThree(b.x,b.y,b.tvd);
      const t=vb.sub(va); return t.lengthSq()>1e-9? t.normalize() : new THREE.Vector3(0,-1,0);
    }
    // dos ejes perpendiculares al eje del pozo (para el disco radial de punzados)
    function perpBasis(tan){
      let up=new THREE.Vector3(0,1,0);
      if(Math.abs(tan.dot(up))>0.95) up=new THREE.Vector3(1,0,0);
      const u=new THREE.Vector3().crossVectors(tan,up).normalize();
      const v=new THREE.Vector3().crossVectors(tan,u).normalize();
      return [u,v];
    }

    const prodR=casingRadius("produccion", 5.0);   // radio de referencia (aislación)
    const perfMatLight=new THREE.LineBasicMaterial({color:PERF_LIGHT});
    const perfMatDark=new THREE.LineBasicMaterial({color:PERF_DARK});
    const plugMat=new THREE.MeshStandardMaterial({color:0xe5484d, metalness:.2, roughness:.5});

    // numeración de tapones en orden de bajada: N°1 = más profundo.
    const stagesWithPlug=(w.frac?.stages||[]).filter(s=>s.plug_md!=null)
        .slice().sort((a,b)=>b.plug_md-a.plug_md);
    const plugNumber=new Map();
    stagesWithPlug.forEach((s,i)=>plugNumber.set(s.stage, i+1)); // 1 = más profundo

    (w.frac?.stages||[]).forEach((stg,si)=>{
      // punzados: color turquesa que alterna claro/oscuro por etapa
      const perfMat = (stg.stage % 2 === 0) ? perfMatLight : perfMatDark;
      (stg.clusters||[]).forEach(cl=>{
        const md=(cl.top_md!=null?cl.top_md:cl.bottom_md); if(md==null) return;
        const p=interpAtMD(st,md,wx); const center=toThree(p.x,p.y,p.tvd);
        const tan=tangentAtMD(md); const [u,v]=perpBasis(tan);
        const rOut=perfRadiusM, rIn=Math.min(prodR, perfRadiusM*0.2);   // radio real en metros (Configuración)
        const pos=[];
        const at=(ang,rad)=>center.clone()
          .add(u.clone().multiplyScalar(Math.cos(ang)*rad)).add(v.clone().multiplyScalar(Math.sin(ang)*rad));
        // rama de árbol: cada raíz crece hacia afuera y se bifurca al ganar distancia
        const branch=(ang,r0,r1,depth,spread)=>{
          const a=at(ang,r0), b=at(ang,r1); pos.push(a.x,a.y,a.z, b.x,b.y,b.z);
          if(depth<=0) return;
          const nr=r1+(r1-r0)*0.85;
          branch(ang-spread, r1, nr, depth-1, spread*0.7);
          branch(ang+spread, r1, nr, depth-1, spread*0.7);
        };
        const nRoots=6, step=(rOut-rIn)*0.42;
        for(let k=0;k<nRoots;k++) branch((k/nRoots)*Math.PI*2, rIn, rIn+step, 2, 0.28);
        const geo=new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos,3));
        const rays=new THREE.LineSegments(geo, perfMat);
        rays.userData.kind="perf"; rays.userData.wellId=w.id; rays.userData.stage=stg.stage; g.add(rays);
      });

      // tapones: cilindro rojo + etiqueta HTML "TPN N° x"
      if(stg.plug_md!=null){
        const p=interpAtMD(st,stg.plug_md,wx); const center=toThree(p.x,p.y,p.tvd);
        const tan=tangentAtMD(stg.plug_md);
        // tapón: anillo que sobresale 10% del casing de aislación, alto acotado (banda, no salchicha)
        const plugR=prodR*1.10, plugH=prodR*0.9;
        const plug=new THREE.Mesh(new THREE.CylinderGeometry(plugR,plugR,plugH,20), plugMat);
        const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), tan);
        plug.quaternion.copy(q); plug.position.copy(center);
        plug.userData.kind="plug"; g.add(plug);
        const num=plugCountInverted ? (stagesWithPlug.length - plugNumber.get(stg.stage) + 1)
                                    : plugNumber.get(stg.stage);
        addLabel(`TPN N° ${num} · MD ${Math.round(stg.plug_md)}`, center.clone().add(new THREE.Vector3(0, prodR*6, 0)), "tpn", w.id);
      }
    });

    // etapas: etiqueta HTML "Etapa X" en el medio de la etapa
    (w.frac?.stages||[]).forEach(stg=>{
      const cls=stg.clusters||[]; if(!cls.length) return;
      const mds=cls.map(c=>c.top_md!=null?c.top_md:c.bottom_md).filter(x=>x!=null);
      if(!mds.length) return;
      const mid=mds.reduce((a,b)=>a+b,0)/mds.length;
      const p=interpAtMD(st,mid,wx);
      addLabel(`Etapa ${stg.stage}`, toThree(p.x,p.y,p.tvd).add(new THREE.Vector3(0, prodR*9, 0)), "stage", w.id);
    });

    // --- INSTALACIÓN: TBG (caño fino desde superficie hasta su MD final) + TPN/PKR ---
    if(w.installation){
      const inst=w.installation;
      // fondo del TBG = MD final indicada (obligatoria). Fallback histórico si faltara.
      let instBottom=inst.tbg_md_m;
      if(instBottom==null){
        (w.frac?.stages||[]).forEach(s=>(s.clusters||[]).forEach(cl=>{ const m=cl.bottom_md??cl.top_md; if(m!=null) instBottom=Math.max(instBottom??0,m); }));
        if(instBottom==null){ const ais=(w.casings||[]).find(c=>c.phase==="produccion"); instBottom=ais?.shoe_md ?? st.at(-1).md; }
      }
      const tbgR=prodR*0.5;
      const seg=[]; for(const s of st){ if(s.md<=instBottom) seg.push(toThree(wx+(s.ew||0),s.ns||0,s.tvd)); }
      const bp=interpAtMD(st,instBottom,wx); seg.push(toThree(bp.x,bp.y,bp.tvd));
      if(seg.length>=2){
        const tube=new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seg), Math.max(80,seg.length), tbgR, 12, false),
          new THREE.MeshStandardMaterial({color:0x00c2d1, metalness:.2, roughness:.5, emissive:0x00343a, emissiveIntensity:.4}));
        tube.userData.kind="install"; tube.userData.wellId=w.id; g.add(tube);
        if(inst.tbg_od_in!=null){
          const tbgSpec=[`TBG ${fmtOD(inst.tbg_od_in)}`];
          if(inst.tbg_weight_ppf!=null) tbgSpec.push(`${inst.tbg_weight_ppf} lb/ft`);
          if(inst.tbg_grade) tbgSpec.push(inst.tbg_grade);
          addLabel(tbgSpec.join(" "), toThree(bp.x,bp.y,bp.tvd).add(new THREE.Vector3(0, tbgR*6, 0)), "install", w.id);
        }
      }
      (inst.elements||[]).forEach(el=>{
        if(el.md==null) return;
        const p=interpAtMD(st,el.md,wx); const center=toThree(p.x,p.y,p.tvd);
        const isPkr=el.type==="PKR"; const R2=prodR*(isPkr?1.28:1.12), H2=prodR*(isPkr?1.2:0.9);
        const mk=new THREE.Mesh(new THREE.CylinderGeometry(R2,R2,H2,20),
          new THREE.MeshStandardMaterial({color:isPkr?0x3fb950:0xf2a03d, metalness:.2, roughness:.5}));
        mk.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), tangentAtMD(el.md)));
        mk.position.copy(center); mk.userData.kind="install"; mk.userData.wellId=w.id; g.add(mk);
        addLabel(`${el.type} · MD ${Math.round(el.md)}`, center.clone().add(new THREE.Vector3(0, prodR*6, 0)), "install", w.id);
      });
    }

    world.add(g); wellObjects[w.id]=g;
  });

  // "Modo aislación" (por etapas / dogleg) solo tiene sentido con survey real: si todos los pozos
  // son verticales sintéticos (sin trayectoria cargada), se oculta el grupo.
  const hasSurvey=wells.some(w=>w.architecture!=="vertical");
  document.getElementById("grp-isomode").style.display=hasSurvey?"":"none";
  buildWellMatrix(wells); buildGrids(); applyAllToggles(); frameAll(); updateSummary();
  // re-aplica en el próximo frame: evita que, recién cargado, alguna capa quede sin estado
  // hasta que el usuario toca un toggle (visibilidad no reflejada en el primer build).
  requestAnimationFrame(applyAllToggles);
}

/* ============ Toggles: árbol por pozo ============
   Cada pozo es un nodo desplegable con sus propios checkboxes de elementos, así se puede ver
   cosas distintas en pozos distintos. El nodo "TODOS" aplica el cambio a todos los pozos a la vez.
   Estado en VIS[wellId][clave] — persiste entre regeneraciones del pad (misma id de pozo). */
const q=id=>{ const el=document.getElementById(id); return el?el.checked:true; };

/* ============ Grillas de referencia (superficie + piso) ============
   Cero de la numeración = boca de pozo / centro del pad. La huella N/S sigue las ramas de todos
   los pozos; en E/O se proyecta ±1000 m (o más si algún pozo excede). El piso va 50 m bajo el
   registro más profundo. Ambas grillas se reconstruyen por pad (dependen de vexag vía toThree). */
function gridBounds(){
  const wells=(PAD&&PAD.pad&&PAD.pad.wells)||[];
  let minEW=0,maxEW=0,minNS=0,maxNS=0,maxTVD=0,any=false;
  wells.forEach(w=>{ const wx=(w.wellhead&&w.wellhead.x)||0;
    ((w.survey&&w.survey.stations)||[]).forEach(s=>{
      const ew=wx+(s.ew||0), ns=s.ns||0, tvd=s.tvd||0;
      minEW=Math.min(minEW,ew); maxEW=Math.max(maxEW,ew);
      minNS=Math.min(minNS,ns); maxNS=Math.max(maxNS,ns);
      maxTVD=Math.max(maxTVD,tvd); any=true; }); });
  return {minEW,maxEW,minNS,maxNS,maxTVD,any};
}
// grilla horizontal a una TVD dada (líneas cada `step` m; realce cada 1000 m). world X = -ew, Z = ns.
function makeGridPlane(tvd, ewMin, ewMax, nsMin, nsMax, step){
  const grp=new THREE.Group(); const y=-tvd*vexag, minor=[], major=[];
  const seg=(a,x1,z1,x2,z2)=>{ a.push(-x1,y,z1,-x2,y,z2); };
  for(let ns=Math.ceil(nsMin/step)*step; ns<=nsMax+1e-6; ns+=step) seg(Math.abs(ns)%1000<1e-6?major:minor, ewMin,ns, ewMax,ns);
  for(let ew=Math.ceil(ewMin/step)*step; ew<=ewMax+1e-6; ew+=step) seg(Math.abs(ew)%1000<1e-6?major:minor, ew,nsMin, ew,nsMax);
  const mk=(arr,col)=>{ if(!arr.length) return; const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(arr,3));
    grp.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:.6}))); };
  mk(minor,0x2a3441); mk(major,0x3d4f63);
  return grp;
}
function clearGridLabels(){ LABELS=LABELS.filter(l=>{ if(l.kind==="gridnum"){ l.el.remove(); return false; } return true; }); }
function applyGridVis(){ if(surfaceGrid) surfaceGrid.visible=q("cfg-grid"); if(floorGrid) floorGrid.visible=q("cfg-floor"); }
function buildGrids(){
  clearGridLabels();
  gridGroup.children.slice().forEach(c=>{ gridGroup.remove(c);
    c.traverse(o=>{ if(o.geometry)o.geometry.dispose(); if(o.material)o.material.dispose(); }); });
  const b=gridBounds(), step=200;
  const ewHalf=Math.max(1000, Math.ceil((Math.max(Math.abs(b.minEW),Math.abs(b.maxEW))+200)/step)*step);
  const nsMin=b.any?Math.floor((Math.min(0,b.minNS)-200)/step)*step:-1000;
  const nsMax=b.any?Math.ceil((Math.max(0,b.maxNS)+200)/step)*step:1000;
  const floorTVD=b.any?Math.ceil((b.maxTVD+50)/step)*step:0;
  surfaceGrid=makeGridPlane(0,-ewHalf,ewHalf,nsMin,nsMax,step); gridGroup.add(surfaceGrid);
  floorGrid=(b.any&&floorTVD>0)?makeGridPlane(floorTVD,-ewHalf,ewHalf,nsMin,nsMax,step):null;
  if(floorGrid) gridGroup.add(floorGrid);
  // numeración (metros, cero en boca): N/S y E/O sobre el plano de piso; profundidad en un canto vertical
  const lblTVD=floorTVD||0, mstep=500;
  for(let ns=Math.ceil(nsMin/mstep)*mstep; ns<=nsMax+1e-6; ns+=mstep)
    addLabel(ns===0?"0":`${Math.abs(ns)} ${ns>0?"N":"S"}`, toThree(ewHalf,ns,lblTVD), "gridnum", null, false);
  for(let ew=Math.ceil(-ewHalf/mstep)*mstep; ew<=ewHalf+1e-6; ew+=mstep)
    addLabel(ew===0?"0":`${Math.abs(ew)} ${ew>0?"E":"O"}`, toThree(ew,nsMax,lblTVD), "gridnum", null, false);
  if(lblTVD>0) for(let tvd=0; tvd<=lblTVD+1e-6; tvd+=mstep)
    addLabel(`${Math.round(tvd)} m`, toThree(ewHalf,nsMin,tvd), "gridnum", null, false);
  applyGridVis();
}

const ELEMS=[
  ["traj","Trayectoria","#4ea1d3"],
  ["guia","Guía","#e8c96a"],["intermedia1","Intermedia 1","#7fc7e0"],
  ["intermedia2","Intermedia 2","#b79fe0"],["produccion","Aislación","#f2ede2"],
  ["perf","Punzados","#17c4b0"],["plug","Tapones","#e5484d"],
  ["short","Caños cortos","#ffe500"],["shoetrack","Shoetrack","#c9a3ff"],
  ["install","Instalación","#00c2d1"],["toc","TOC (cemento)","#cbb78a"]];
const ELEM_DEFAULT={traj:true,guia:true,intermedia1:true,intermedia2:true,produccion:true,
  perf:false,plug:true,short:true,shoetrack:true,install:true,toc:true};
let VIS={};
function ensureVis(wid){ if(!VIS[wid]) VIS[wid]={well:true,perfStages:"",...ELEM_DEFAULT}; return VIS[wid]; }
/* "1,3,10-15,18" → Set{1,3,10..15,18}; vacío → null (todas las etapas) */
function parseStages(str){
  str=(str||"").trim(); if(!str) return null;
  const set=new Set();
  for(const part of str.split(",")){ const p=part.trim(); if(!p) continue;
    const m=p.match(/^(\d+)\s*-\s*(\d+)$/);
    if(m){ let a=+m[1],b=+m[2]; if(a>b)[a,b]=[b,a]; for(let s=a;s<=b;s++) set.add(s); }
    else if(/^\d+$/.test(p)) set.add(+p);
  }
  return set.size?set:null;
}
function applyWellVis(wid){
  const g=wellObjects[wid]; if(!g) return; const v=ensureVis(wid);
  g.visible=v.well!==false;
  let hasInstall=false;
  g.traverse(o=>{ if(o.userData.kind==="install") hasInstall=true; });
  // con la instalación visible, la aislación se vuelve traslúcida para ver el TBG adentro
  const isoTranslucent = hasInstall && v.install!==false;
  const perfFilter = parseStages(v.perfStages);   // null = todas
  g.traverse(o=>{ const k=o.userData.kind; if(!k) return;
    if(k==="casing"){ o.visible=v[o.userData.phase]!==false;
      if(o.userData.phase==="produccion" && o.material){
        o.material.transparent = isoTranslucent; o.material.opacity = isoTranslucent?0.28:1;
        o.material.needsUpdate=true;
      }
    }
    else if(k==="perf") o.visible = (v.perf!==false) && (!perfFilter || perfFilter.has(o.userData.stage));
    else if(k in ELEM_DEFAULT) o.visible=v[k]!==false;
  });
}
/* ===== Matriz pozos × elementos =====
   Columnas = pozos (colapsables a "Pozos"), filas = elementos (colapsables a "Todos").
   Celda (pozo, elemento) = VIS[pozo][elemento]. La columna "Pozos" es el maestro por elemento
   (todos los pozos) y la fila "Todos" es el maestro por pozo (todos los elementos). El cruce
   Pozos×Todos togglea todo. La cabecera de cada pozo togglea su visibilidad (VIS.well). */
function mxWids(){ return [...document.querySelectorAll("#well-matrix th.mx-well")].map(th=>th.dataset.wid); }
function buildWellMatrix(wells){
  const cont=document.getElementById("well-matrix");
  if(!wells||!wells.length){ cont.innerHTML='<div class="stub" style="padding:6px 2px">Sin pozos cargados.</div>'; return; }
  wells.forEach(w=>ensureVis(w.id));
  const wids=wells.map(w=>w.id);
  const elemAll = k => wids.every(id=>ensureVis(id)[k]!==false);
  const wellAll = id => ELEMS.every(([k])=>ensureVis(id)[k]!==false);
  const sw = c => `<span class="sw" style="background:${c}"></span>`;
  let h='<table class="wmx"><thead><tr><th class="mx-corner"></th>'
      +`<th class="mx-pozos"><label class="mxh"><input type="checkbox" class="mx-allwells" ${wids.every(id=>ensureVis(id).well)?"checked":""}><span>Pozos</span></label></th>`;
  wells.forEach((w,idx)=>{
    const col="#"+WELL_COLORS[idx%WELL_COLORS.length].toString(16).padStart(6,"0");
    h+=`<th class="mx-well" data-wid="${escAttr(w.id)}"><label class="mxh" title="${escAttr(w.id)}">${sw(col)}<span class="wname">${escHtml(w.id)}</span>`
      +`<input type="checkbox" class="mx-wellvis" ${ensureVis(w.id).well?"checked":""}></label></th>`;
  });
  h+='</tr></thead><tbody>';
  // fila "Todos" (maestro por pozo)
  h+='<tr class="mx-todos"><th class="mx-rowh">Todos</th>'
    +`<td class="mx-pozos"><input type="checkbox" class="mx-all" ${wids.every(id=>wellAll(id))?"checked":""}></td>`;
  wells.forEach(w=>{ h+=`<td class="mx-well" data-wid="${escAttr(w.id)}"><input type="checkbox" class="mx-welltodos" ${wellAll(w.id)?"checked":""}></td>`; });
  h+='</tr>';
  // una fila por elemento
  ELEMS.forEach(([k,label,col])=>{
    h+=`<tr class="mx-elem" data-el="${k}"><th class="mx-rowh">${sw(col)}${escHtml(label)}</th>`;
    h+=`<td class="mx-pozos"><input type="checkbox" class="mx-elemall" data-el="${k}" ${elemAll(k)?"checked":""}>`;
    if(k==="perf") h+=`<input type="text" class="mx-perf" data-perfall placeholder="1,3,10-15">`;
    h+='</td>';
    wells.forEach(w=>{
      h+=`<td class="mx-well" data-wid="${escAttr(w.id)}"><input type="checkbox" data-el="${k}" ${ensureVis(w.id)[k]!==false?"checked":""}>`;
      if(k==="perf") h+=`<input type="text" class="mx-perf" data-perffilter value="${escAttr(ensureVis(w.id).perfStages||"")}" placeholder="todas">`;
      h+='</td>';
    });
    h+='</tr>';
  });
  cont.innerHTML=h+'</tbody></table>';
}
// recomputa los estados "maestro" (Pozos / Todos / cruce) tras cualquier cambio de celda
function mxSyncMasters(){
  const cont=document.getElementById("well-matrix"); if(!cont) return;
  const wids=mxWids(); if(!wids.length) return;
  const elemAll = k => wids.every(id=>ensureVis(id)[k]!==false);
  const wellAll = id => ELEMS.every(([k])=>ensureVis(id)[k]!==false);
  cont.querySelectorAll("th.mx-well").forEach(th=>{ const cb=th.querySelector(".mx-wellvis"); if(cb) cb.checked=!!ensureVis(th.dataset.wid).well; });
  const aw=cont.querySelector(".mx-allwells"); if(aw) aw.checked=wids.every(id=>ensureVis(id).well);
  cont.querySelectorAll(".mx-elemall").forEach(cb=>cb.checked=elemAll(cb.dataset.el));
  cont.querySelectorAll("tr.mx-elem").forEach(tr=>{ const k=tr.dataset.el;
    tr.querySelectorAll("td.mx-well").forEach(td=>{ const cb=td.querySelector("input[data-el]"); if(cb) cb.checked=ensureVis(td.dataset.wid)[k]!==false; }); });
  cont.querySelectorAll("tr.mx-todos td.mx-well").forEach(td=>{ const cb=td.querySelector(".mx-welltodos"); if(cb) cb.checked=wellAll(td.dataset.wid); });
  const ev=cont.querySelector(".mx-all"); if(ev) ev.checked=wids.every(id=>wellAll(id));
}
document.getElementById("well-matrix").addEventListener("change",e=>{
  const t=e.target, wids=mxWids();
  if(t.classList.contains("mx-wellvis")){ const wid=t.closest("[data-wid]").dataset.wid; ensureVis(wid).well=t.checked; applyWellVis(wid); }
  else if(t.classList.contains("mx-allwells")){ wids.forEach(id=>{ ensureVis(id).well=t.checked; applyWellVis(id); }); }
  else if(t.classList.contains("mx-elemall")){ const k=t.dataset.el; wids.forEach(id=>{ ensureVis(id)[k]=t.checked; applyWellVis(id); }); }
  else if(t.classList.contains("mx-welltodos")){ const wid=t.closest("[data-wid]").dataset.wid; ELEMS.forEach(([k])=>ensureVis(wid)[k]=t.checked); applyWellVis(wid); }
  else if(t.classList.contains("mx-all")){ wids.forEach(id=>{ ELEMS.forEach(([k])=>ensureVis(id)[k]=t.checked); applyWellVis(id); }); }
  else if(t.matches("td.mx-well input[data-el]")){ const wid=t.closest("[data-wid]").dataset.wid, k=t.dataset.el; ensureVis(wid)[k]=t.checked; applyWellVis(wid); }
  else return;
  mxSyncMasters(); saveViewCfg();
});
// filtro de etapas de punzados (campo de texto por pozo / para todos)
document.getElementById("well-matrix").addEventListener("input",e=>{
  const t=e.target; if(!t.classList.contains("mx-perf")) return;
  const cont=document.getElementById("well-matrix");
  if(t.hasAttribute("data-perffilter")){ const wid=t.closest("[data-wid]").dataset.wid; ensureVis(wid).perfStages=t.value; applyWellVis(wid); }
  else if(t.hasAttribute("data-perfall")){ mxWids().forEach(id=>{ ensureVis(id).perfStages=t.value; applyWellVis(id); });
    cont.querySelectorAll("td.mx-well .mx-perf[data-perffilter]").forEach(inp=>inp.value=t.value); }
  saveViewCfg();
});
function applyAllToggles(){
  Object.keys(wellObjects).forEach(applyWellVis);
  applyGridVis(); axes.visible=q("cfg-axes"); shoesGroup.visible=q("cfg-shoes");
  SHOW_GRIDNUMS=q("cfg-gridnums");
  SHOW_STAGE_LABELS=q("lbl-stage"); SHOW_TPN_LABELS=q("lbl-tpn"); SHOW_SHOE_LABELS=q("lbl-shoe");
  SHOW_SHORT_LABELS=q("lbl-short"); SHOW_INSTALL_LABELS=q("lbl-install");
  SHOW_SHOETRACK_LABELS=q("lbl-shoetrack"); SHOW_TOC_LABELS=q("lbl-toc"); SHOW_CURSOR_TIP=q("lbl-cursor");
}
document.getElementById("lbl-stage").addEventListener("change",e=>SHOW_STAGE_LABELS=e.target.checked);
document.getElementById("lbl-tpn").addEventListener("change",e=>SHOW_TPN_LABELS=e.target.checked);
document.getElementById("lbl-short").addEventListener("change",e=>SHOW_SHORT_LABELS=e.target.checked);
document.getElementById("lbl-install").addEventListener("change",e=>SHOW_INSTALL_LABELS=e.target.checked);
document.getElementById("lbl-shoetrack").addEventListener("change",e=>SHOW_SHOETRACK_LABELS=e.target.checked);
document.getElementById("lbl-shoe").addEventListener("change",e=>SHOW_SHOE_LABELS=e.target.checked);
document.getElementById("lbl-toc").addEventListener("change",e=>SHOW_TOC_LABELS=e.target.checked);
document.querySelectorAll("input[name='isomode']").forEach(r=>r.addEventListener("change",e=>{
  if(e.target.checked){ isoMode=e.target.value; refreshIsoColors(); }
}));
document.getElementById("cfg-grid").addEventListener("change",e=>{ if(surfaceGrid) surfaceGrid.visible=e.target.checked; });
document.getElementById("cfg-floor").addEventListener("change",e=>{ if(floorGrid) floorGrid.visible=e.target.checked; });
document.getElementById("cfg-gridnums").addEventListener("change",e=>SHOW_GRIDNUMS=e.target.checked);
document.getElementById("cfg-axes").addEventListener("change",e=>axes.visible=e.target.checked);
document.getElementById("cfg-shoes").addEventListener("change",e=>shoesGroup.visible=e.target.checked);

/* ---- Apariencia de etiquetas: tamaño, tipografía, formato de OD ---- */
const LABEL_FONTS={
  mono:'"SFMono-Regular",ui-monospace,Consolas,monospace',
  sans:'"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  serif:'Georgia,"Times New Roman",serif',
  cond:'"Arial Narrow","Roboto Condensed","Segoe UI",sans-serif'
};
const labelsEl=document.getElementById("labels"), hoverEl=document.getElementById("hover-tip");
function setLabelSize(px){ labelsEl.style.setProperty("--lbl-size",px+"px"); hoverEl.style.setProperty("--lbl-size",px+"px");
  document.getElementById("lblsize-val").textContent=px+" px"; }
function setLabelFont(key){ const f=LABEL_FONTS[key]||LABEL_FONTS.mono;
  labelsEl.style.setProperty("--lbl-font",f); hoverEl.style.setProperty("--lbl-font",f); }
document.getElementById("cfg-lblsize").addEventListener("input",e=>setLabelSize(parseInt(e.target.value,10)));
document.getElementById("cfg-font").addEventListener("change",e=>setLabelFont(e.target.value));
document.querySelectorAll("input[name='odfmt']").forEach(r=>r.addEventListener("change",e=>{
  if(e.target.checked){ odFormat=e.target.value; if(PAD) buildPad(PAD); renderWellCards(); }   // reetiqueta zapatos 3D y picklists del constructor
}));
setLabelSize(11); setLabelFont("mono");
document.getElementById("lbl-cursor").addEventListener("change",e=>{ SHOW_CURSOR_TIP=e.target.checked;
  if(!SHOW_CURSOR_TIP) document.getElementById("hover-tip").style.display="none"; });

/* ---- Cuadros flotantes: colapsar (por cuadro y, en Pozos, en X/Y) + arrastrar + persistir ---- */
const PANELS_KEY="vv-panels-v1";
function savePanels(){
  try{
    const st={};
    document.querySelectorAll("#panels .panel").forEach(p=>{
      st[p.id]={ left:p.style.left||"", top:p.style.top||"", right:p.style.right||"", collapsed:p.classList.contains("collapsed"),
        x:p.classList.contains("x-collapsed"), y:p.classList.contains("y-collapsed") };
    });
    localStorage.setItem(PANELS_KEY, JSON.stringify(st));
  }catch(e){}
}
function loadPanels(){
  let st=null; try{ st=JSON.parse(localStorage.getItem(PANELS_KEY)||"null"); }catch(e){}
  if(!st) return;
  document.querySelectorAll("#panels .panel").forEach(p=>{
    const s=st[p.id]; if(!s) return;
    if(s.left){ p.style.left=s.left; p.style.right="auto"; p.style.bottom="auto"; }
    if(s.top) p.style.top=s.top;
    p.classList.toggle("collapsed",!!s.collapsed);
    p.classList.toggle("x-collapsed",!!s.x);
    p.classList.toggle("y-collapsed",!!s.y);
  });
}
document.querySelectorAll("#panels .panel").forEach(panel=>{
  const head=panel.querySelector(".panel-head");
  // botones: colapsar cuadro; en Pozos, colapso independiente en X (pozos) e Y (elementos)
  panel.querySelector(".panel-collapse")?.addEventListener("click",e=>{
    e.stopPropagation(); panel.classList.toggle("collapsed"); savePanels(); });
  panel.querySelector(".mx-xtog")?.addEventListener("click",e=>{
    e.stopPropagation(); panel.classList.toggle("x-collapsed"); savePanels(); });
  panel.querySelector(".mx-ytog")?.addEventListener("click",e=>{
    e.stopPropagation(); panel.classList.toggle("y-collapsed"); savePanels(); });
  // arrastrar por el header (a cualquier parte del área 3D)
  let drag=false,ox=0,oy=0;
  head.addEventListener("mousedown",e=>{
    if(e.target.closest(".panel-btn")) return;
    drag=true; panel.classList.add("dragging");
    const r=panel.getBoundingClientRect(); ox=e.clientX-r.left; oy=e.clientY-r.top;
    const mainR=document.querySelector("main").getBoundingClientRect();
    panel.style.right="auto"; panel.style.bottom="auto";
    panel.style.left=(r.left-mainR.left)+"px"; panel.style.top=(r.top-mainR.top)+"px";
    e.preventDefault();
  });
  window.addEventListener("mousemove",e=>{ if(!drag) return;
    const mainR=document.querySelector("main").getBoundingClientRect();
    let x=e.clientX-ox-mainR.left, y=e.clientY-oy-mainR.top;
    x=Math.max(0,Math.min(mainR.width-60,x)); y=Math.max(0,Math.min(mainR.height-32,y));
    panel.style.left=x+"px"; panel.style.top=y+"px";
  });
  window.addEventListener("mouseup",()=>{ if(drag){ drag=false; panel.classList.remove("dragging"); savePanels(); } });
});
loadPanels();

/* ---- Mouse-over MD/TVD en vivo ----
   raycast a las trayectorias; del punto de hit se recupera el MD proyectando sobre los
   segmentos de station del pozo (mínima distancia), y el TVD por interpolación de ese MD. */
const _hray=new THREE.Raycaster();
const hoverTip=document.getElementById("hover-tip");
const _vA=new THREE.Vector3(), _vB=new THREE.Vector3(), _vP=new THREE.Vector3(), _vAB=new THREE.Vector3(), _vAP=new THREE.Vector3();
/* etapa que contiene un MD dado (rango top→bottom de los clusters de la etapa) */
function stageAtMD(w, md){
  for(const s of (w.frac?.stages||[])){
    const mds=(s.clusters||[]).flatMap(c=>[c.top_md,c.bottom_md]).filter(x=>x!=null);
    if(mds.length && md>=Math.min(...mds) && md<=Math.max(...mds)) return s.stage;
  }
  return null;
}
function mdFromPoint(wellId, pt){
  const w=PAD?.pad.wells.find(x=>x.id===wellId); if(!w) return null;
  const st=w.survey.stations, wx=w.wellhead.x||0;
  let best=Infinity, bestMD=null, bestTVD=null, bestDLS=null;
  for(let i=1;i<st.length;i++){
    const a=st[i-1], b=st[i];
    _vA.copy(toThree(wx+(a.ew||0),a.ns||0,a.tvd));
    _vB.copy(toThree(wx+(b.ew||0),b.ns||0,b.tvd));
    _vAB.subVectors(_vB,_vA); _vAP.subVectors(pt,_vA);
    const len2=_vAB.lengthSq()||1; let t=_vAP.dot(_vAB)/len2; t=Math.max(0,Math.min(1,t));
    _vP.copy(_vA).addScaledVector(_vAB,t);
    const d=_vP.distanceToSquared(pt);
    if(d<best){ best=d; bestMD=a.md+(b.md-a.md)*t; bestTVD=a.tvd+(b.tvd-a.tvd)*t;
      // dogleg: interpola si ambas estaciones lo traen; si no, usa la que exista (o null)
      bestDLS=(a.dls!=null&&b.dls!=null)?a.dls+(b.dls-a.dls)*t:(b.dls!=null?b.dls:a.dls);
    }
  }
  return bestMD==null?null:{md:bestMD,tvd:bestTVD,dls:bestDLS,stage:stageAtMD(w,bestMD),well:wellId};
}
canvas.addEventListener("mousemove",e=>{
  if(!SHOW_CURSOR_TIP || !PAD || dragging!==null){ hoverTip.style.display="none"; return; }
  camera.updateMatrixWorld();
  const rect=canvas.getBoundingClientRect();
  const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -(((e.clientY-rect.top)/rect.height)*2-1));
  _hray.setFromCamera(ndc,camera);
  _hray.params.Line.threshold=sph.radius*0.015;
  const trajs=[]; Object.values(wellObjects).forEach(g=>{ if(!g.visible) return;
    g.traverse(o=>{ if(o.userData.kind==="traj"&&o.visible) trajs.push(o); }); });
  const hits=_hray.intersectObjects(trajs,false);
  if(!hits.length){ hoverTip.style.display="none"; return; }
  const wellId=hits[0].object.userData.wellId;
  const info=mdFromPoint(wellId, hits[0].point);
  if(!info){ hoverTip.style.display="none"; return; }
  const stageTxt = info.stage!=null ? ` · <span class="s">E${info.stage}</span>` : "";
  const dlsTxt = info.dls!=null ? `<br><span class="d">dogleg</span> <span class="dl">${info.dls.toFixed(2)}</span> °/30m` : "";
  hoverTip.innerHTML=`<span class="w">${info.well}</span>${stageTxt}<br>MD <b>${Math.round(info.md)}</b> m · TVD <b>${Math.round(info.tvd)}</b> m${dlsTxt}`;
  hoverTip.style.display="block";
  hoverTip.style.left=(e.clientX-rect.left)+"px";
  hoverTip.style.top=(e.clientY-rect.top)+"px";
});
canvas.addEventListener("mouseleave",()=>hoverTip.style.display="none");

document.getElementById("cfg-vexag").addEventListener("input",e=>{
  vexag=parseFloat(e.target.value); document.getElementById("vexag-val").textContent=vexag.toFixed(1)+"×";
  if(PAD) buildPad(PAD);
});
document.getElementById("cfg-dexag").addEventListener("input",e=>{
  if(autoDiam) return;             // gobernado por zoom
  diamExag=parseFloat(e.target.value); document.getElementById("dexag-val").textContent=diamExag+"×";
  if(PAD) buildPad(PAD);
});
document.getElementById("cfg-autodiam").addEventListener("change",e=>{
  autoDiam=e.target.checked;
  document.getElementById("cfg-dexag").disabled=autoDiam;
  if(autoDiam){ updateAutoDiam(); }
  else { diamExag=parseFloat(document.getElementById("cfg-dexag").value);
    document.getElementById("dexag-val").textContent=diamExag+"×"; if(PAD) buildPad(PAD); }
});
document.getElementById("cfg-pluginv").addEventListener("change",e=>{
  plugCountInverted=e.target.checked; if(PAD) buildPad(PAD);
});
document.getElementById("cfg-perfradius").addEventListener("input",e=>{
  perfRadiusM=parseFloat(e.target.value); document.getElementById("perfradius-val").textContent=perfRadiusM+" m";
  if(PAD) buildPad(PAD);
});

/* ============ Cámara CAD ============ */
function frameAll(){
  // encuadre robusto: solo trayectorias, ignorando puntos absurdos (>100km) o NaN
  const box=new THREE.Box3();
  Object.values(wellObjects).forEach(g=>g.traverse(o=>{
    if(o.userData.kind!=="traj"||!o.geometry) return;
    const p=o.geometry.attributes.position; if(!p) return;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      if(!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
      if(Math.abs(x)>1e5||Math.abs(y)>1e5||Math.abs(z)>1e5) continue;
      box.expandByPoint(new THREE.Vector3(x,y,z));
    }
  }));
  if(box.isEmpty()){ target.set(0,-1500,-1500); sph.radius=5000; _sceneRadius=8000; return; }
  const c=box.getCenter(new THREE.Vector3()), size=box.getSize(new THREE.Vector3());
  _sceneRadius=Math.max(size.x,size.y,size.z,500);
  target.copy(c); sph.radius=_sceneRadius*1.1+500;
}
/* Vistas cardinales. Sistema three: x=Este, z=Norte, y=arriba (-TVD).
   sph.theta = azimut (0 = mirando desde +Z/Norte), sph.phi = inclinación desde arriba. */
function setView(name){
  const eps=0.001;
  const V={
    top:    {phi:eps,        theta:0},           // desde arriba, mirando abajo
    bottom: {phi:Math.PI-eps,theta:0},           // desde abajo
    north:  {phi:Math.PI/2,  theta:0},           // desde el Norte (+Z)
    south:  {phi:Math.PI/2,  theta:Math.PI},     // desde el Sur (rama navegando)
    east:   {phi:Math.PI/2,  theta:-Math.PI/2},  // desde el Este (Este = -X en mundo)
    west:   {phi:Math.PI/2,  theta:Math.PI/2},   // desde el Oeste (Oeste = +X en mundo)
    iso:    {phi:1.05,       theta:0.7},         // isométrica
  };
  const v=V[name]||V.iso;
  sph.phi=v.phi;
  if(name==="top"||name==="bottom"){
    // arriba/abajo: NO forzar el azimut — snap al múltiplo de 90° más cercano del actual.
    // Así, si venís mirando desde el Sur (Norte arriba de pantalla), la vista superior conserva
    // el Norte arriba en vez de invertirlo.
    sph.theta=Math.round(sph.theta/(Math.PI/2))*(Math.PI/2);
  } else {
    sph.theta=v.theta;
  }
  frameAll();  // reencuadra manteniendo la nueva orientación
  document.getElementById("hud-cam").textContent="vista: "+name;
}
document.querySelectorAll("[data-view3d]").forEach(b=>
  b.addEventListener("click",()=>setView(b.dataset.view3d)));

let dragging=null,px=0,py=0;
canvas.addEventListener("mousedown",e=>{
  if(gizmoHitTest(e.clientX,e.clientY)) return;   // dentro del ViewCube: no orbitar (se resuelve en click)
  if(measureMode && e.button===0) return;         // modo medir: el click izquierdo pincha, no orbita
  dragging=e.button;px=e.clientX;py=e.clientY;});
canvas.addEventListener("click",e=>{
  const h=gizmoHitTest(e.clientX,e.clientY); if(h){ applyGizmoHit(h); return; }
  if(measureMode && e.button===0) measurePick(e.clientX,e.clientY);
});

/* ============ Regla medidora ============
   Modo "colocar punto": M/botón arma UN click. Al colocar, se desarma solo → se navega normal.
   Se vuelve a armar con M/botón para el 2° punto (o iniciar de nuevo). Esc borra la medición. */
let measureMode=false; const measurePts=[]; const _mray=new THREE.Raycaster();
const measureTip=document.createElement("div"); measureTip.id="measure-tip";
document.getElementById("v3d").appendChild(measureTip);
function setMeasure(on){
  measureMode=on;
  document.getElementById("hud-measure").classList.toggle("on",on);
  canvas.style.cursor=on?"crosshair":"";
  document.getElementById("hud-cam").textContent = on
    ? (measurePts.length===1 ? "medir: click en el 2° punto" : "medir: click en el 1° punto")
    : "orbit · pan · zoom";
}
function clearMeasure(){ measurePts.length=0; measureGroup.clear(); measureTip.style.display="none"; }
function measurePick(cx,cy){
  camera.updateMatrixWorld();
  const rect=canvas.getBoundingClientRect();
  const ndc=new THREE.Vector2(((cx-rect.left)/rect.width)*2-1, -(((cy-rect.top)/rect.height)*2-1));
  _mray.setFromCamera(ndc,camera); _mray.params.Line.threshold=sph.radius*0.02;
  const trajs=[]; Object.values(wellObjects).forEach(g=>{ if(!g.visible) return;
    g.traverse(o=>{ if(o.userData.kind==="traj"&&o.visible) trajs.push(o); }); });
  const hits=_mray.intersectObjects(trajs,false);
  if(!hits.length){ toast("Medir: hacé click sobre una trayectoria"); return; }   // sigue armado
  if(measurePts.length>=2) clearMeasure();     // medición completa → arranca una nueva
  const pt=hits[0].point.clone(); measurePts.push(pt);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(sph.radius*0.009,10,10),
    new THREE.MeshBasicMaterial({color:0x4ea1d3, depthTest:false}));
  dot.position.copy(pt); dot.renderOrder=3; measureGroup.add(dot);
  if(measurePts.length===2){
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(measurePts),
      new THREE.LineDashedMaterial({color:0x4ea1d3, dashSize:sph.radius*0.02, gapSize:sph.radius*0.012, depthTest:false}));
    line.computeLineDistances(); line.renderOrder=3; measureGroup.add(line);
  }
  updateMeasure();
  setMeasure(false);          // un solo punto por activación → vuelve la navegación normal
}
function updateMeasure(){
  if(measurePts.length<2){ measureTip.style.display="none"; return; }
  const [a,b]=measurePts;
  const dE=-(b.x-a.x), dN=(b.z-a.z), dT=-(b.y-a.y)/vexag;    // mundo→real (Este=-X, TVD=-Y/vexag)
  const dist=Math.hypot(dE,dN,dT), horiz=Math.hypot(dE,dN);
  // altura firmada respecto al origen (1er punto): 2° más somero ⇒ negativo; más profundo ⇒ positivo
  const alt=dT;
  measureTip.innerHTML=`<b>${dist.toFixed(1)} m</b><br>`
    +`<span class="d">N/S</span> ${dN>=0?"N":"S"}${Math.abs(dN).toFixed(1)} · `
    +`<span class="d">E/O</span> ${dE>=0?"E":"O"}${Math.abs(dE).toFixed(1)}<br>`
    +`<span class="d">altura</span> ${alt>=0?"+":"−"}${Math.abs(alt).toFixed(1)} · <span class="d">horiz</span> ${horiz.toFixed(1)}`;
  const mid=a.clone().add(b).multiplyScalar(0.5).project(camera);
  const W=canvas.clientWidth,H=canvas.clientHeight;
  measureTip.style.display = mid.z<1 ? "block":"none";
  measureTip.style.left=((mid.x*0.5+0.5)*W)+"px"; measureTip.style.top=((-mid.y*0.5+0.5)*H)+"px";
}
document.getElementById("hud-measure").addEventListener("click",()=>setMeasure(!measureMode));
window.addEventListener("mouseup",()=>dragging=null);
window.addEventListener("mousemove",e=>{
  if(dragging===null) return;
  const dx=e.clientX-px,dy=e.clientY-py; px=e.clientX; py=e.clientY;
  if(dragging===0){ sph.theta-=dx*0.005; sph.phi-=dy*0.005; sph.phi=Math.max(0.05,Math.min(Math.PI-0.05,sph.phi)); }
  else if(dragging===2){
    // pan proporcional al tamaño en pantalla: 1px de mouse = 1px de escena a la distancia del target.
    // Usa el FOV y la altura del viewport, así el pan "se siente" igual a toda distancia (estilo CAD).
    const h=canvas.clientHeight||1;
    const worldPerPx=(2*Math.tan((camera.fov*Math.PI/180)/2)*sph.radius)/h;
    const pX=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0).multiplyScalar(-dx*worldPerPx);
    const pY=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1).multiplyScalar(dy*worldPerPx);
    target.add(pX).add(pY);
  }
});
canvas.addEventListener("contextmenu",e=>e.preventDefault());
/* Zoom al centro (target fijo, estable, sin deriva). El paso es multiplicativo y parejo a
   toda distancia. Para inspeccionar un punto puntual (ej. un zapato en vista Sur), doble-click
   ahí reubica el target y después el zoom siempre avanza hacia ese punto. */
canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  let d=e.deltaY;
  if(e.deltaMode===1) d*=16; else if(e.deltaMode===2) d*=100;
  let f=Math.exp(d*0.0011);
  f=Math.max(0.5, Math.min(1.7, f));
  sph.radius=Math.max(2, Math.min(300000, sph.radius*f));
},{passive:false});
/* Doble-click: reubica el target sobre el punto de escena bajo el cursor (raycast a las
   trayectorias, que son las líneas maestras). Así "acercarse a los zapatos" siempre funciona. */
const _ray=new THREE.Raycaster(); _ray.params.Line.threshold=undefined;
canvas.addEventListener("dblclick",e=>{
  camera.updateMatrixWorld();
  const rect=canvas.getBoundingClientRect();
  const ndc=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -(((e.clientY-rect.top)/rect.height)*2-1));
  _ray.setFromCamera(ndc, camera);
  // umbral de línea proporcional a la distancia para que "enganche" trayectorias finas
  _ray.params.Line.threshold=sph.radius*0.02;
  const trajs=[]; Object.values(wellObjects).forEach(g=>{ if(!g.visible) return;
    g.traverse(o=>{ if(o.userData.kind==="traj"&&o.visible) trajs.push(o); }); });
  const hits=_ray.intersectObjects(trajs, false);
  if(hits.length){
    target.copy(hits[0].point);
    sph.radius=Math.max(60, sph.radius*0.5);   // acerca al reubicar
    document.getElementById("hud-cam").textContent="target reubicado (doble-click)";
  } else {
    toast("Doble-click sobre una trayectoria para centrar ahí");
  }
});

/* ============ Loader de JSON ============ */
/* ============ Persistencia local (IndexedDB) ============ */
const IDB={ db:null,
  open(){ return new Promise((res,rej)=>{
    const rq=indexedDB.open("vaca-viewer",1);
    rq.onupgradeneeded=()=>rq.result.createObjectStore("pads",{keyPath:"id"});
    rq.onsuccess=()=>{ this.db=rq.result; res(); };
    rq.onerror=()=>rej(rq.error);
  }); },
  save(pad){ if(!this.db) return;
    const tx=this.db.transaction("pads","readwrite");
    tx.objectStore("pads").put({id:"current", pad, ts:Date.now()});
  },
  load(){ return new Promise(res=>{ if(!this.db) return res(null);
    const rq=this.db.transaction("pads","readonly").objectStore("pads").get("current");
    rq.onsuccess=()=>res(rq.result?rq.result.pad:null); rq.onerror=()=>res(null);
  }); },
  clear(){ if(!this.db) return; this.db.transaction("pads","readwrite").objectStore("pads").delete("current"); }
};

/* ============ Loader + autocarga con persistencia ============ */
function loadPadObject(obj, persist=true){
  if(!obj||obj.schema_version!==1||!obj.pad){ toast("JSON no compatible (se esperaba schema_version 1)"); return; }
  buildPad(obj); if(persist) IDB.save(obj);
  syncBuilderFromPad(obj);   // el constructor refleja el pad cargado: picklists, MDs, metadata (editable)
  toast(`Pad ${obj.pad.id} cargado · ${obj.pad.wells.length} pozos`); show("v3d");
}
/* Pad → constructor: llena metadata, picklists y cajas con lo cargado (JSON o generado), para
   poder EDITAR cualquier dato y re-aplicarlo con "Generar y ver pad". La tabla es el resumen. */
function syncBuilderFromPad(pad){
  const p=pad.pad, setv=(id,v)=>{ document.getElementById(id).value=(v??""); };
  setv("b-name",p.name); setv("b-id",p.id); setv("b-field",p.field); setv("b-operator",p.operator);
  setv("b-campaign",p.campaign); setv("b-spacing",p.surface?.wellhead_spacing_m??10);
  setv("b-rkb",p.wells[0]?.wellhead?.rkb_elev_m);
  const n=Math.min(p.wells.length,8);   // el selector soporta hasta 8; más pozos → solo los primeros en el form
  document.getElementById("b-nwells").value=String(Math.max(n,1));
  ING.wells=p.wells.slice(0,8).map(w=>{
    const casings={};
    (w.casings||[]).forEach(c=>{ casings[c.phase]={od_in:c.od_in??null, shoe_md:c.shoe_md??null,
      toc_md:c.toc_md??null, weight_ppf:c.weight_ppf??null, grade:c.grade??null,
      short_joints:c.short_joints||undefined}; });
    const inst=w.installation ? {enabled:true, tbg_od:w.installation.tbg_od_in??null,
        tbg_weight:w.installation.tbg_weight_ppf??null, tbg_grade:w.installation.tbg_grade??null,
        tbg_md:w.installation.tbg_md_m??null,
        elements:(w.installation.elements||[]).map(el=>({type:el.type, md:el.md}))}
      : {enabled:false, tbg_od:null, tbg_weight:null, tbg_grade:null, tbg_md:null, elements:[]};
    const prod=(w.casings||[]).find(c=>c.phase==="produccion");
    const stEls=prod?.shoetrack?.elements||[];
    const shoetrack = stEls.length ? {enabled:true, elements:stEls.map(el=>({desc:el.desc,
        top_md:el.top_md, length_m:el.length_m??((el.bottom_md!=null&&el.top_md!=null)?+(el.bottom_md-el.top_md).toFixed(3):null)}))}
      : {enabled:false, elements:[]};
    const frac=(w.frac&&(w.frac.stages||[]).length)?w.frac:null;
    return { id:w.id||"",
      survey:(w.architecture==="vertical")?null:(w.survey||null),   // vertical sintético: no lo importo, se re-sintetiza
      frac, fracEnabled:!!frac, fracRows:null, casings, install:inst, shoetrack };
  });
  renderWellCards();
}

/* ============ Persistencia de la vista (localStorage) ============
   La app recuerda SIEMPRE la configuración de vista: capas por pozo (VIS), etiquetas, referencia,
   modo aislación, formato de OD, exageraciones, numeración de TPN y apariencia de etiquetas. */
const VIEWCFG_KEY="vv-viewcfg-v1";
function saveViewCfg(){
  try{
    const cfg={ VIS, isoMode, odFormat, vexag, diamExag, autoDiam, perfRadiusM,
      plugInv:plugCountInverted,
      lblSize:parseInt(document.getElementById("cfg-lblsize").value,10),
      font:document.getElementById("cfg-font").value, checks:{} };
    ["lbl-stage","lbl-tpn","lbl-short","lbl-install","lbl-shoetrack","lbl-shoe","lbl-toc","lbl-cursor",
     "cfg-grid","cfg-floor","cfg-gridnums","cfg-axes","cfg-shoes","cfg-autodiam"].forEach(id=>cfg.checks[id]=document.getElementById(id).checked);
    localStorage.setItem(VIEWCFG_KEY, JSON.stringify(cfg));
  }catch(e){ /* almacenamiento no disponible: la vista simplemente no persiste */ }
}
function loadViewCfg(){
  let cfg=null; try{ cfg=JSON.parse(localStorage.getItem(VIEWCFG_KEY)||"null"); }catch(e){}
  if(!cfg) return;
  if(cfg.VIS && typeof cfg.VIS==="object") VIS=cfg.VIS;
  Object.entries(cfg.checks||{}).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.checked=!!val; });
  if(cfg.isoMode){ isoMode=cfg.isoMode;
    const r=document.querySelector(`input[name='isomode'][value='${cfg.isoMode}']`); if(r) r.checked=true; }
  if(cfg.odFormat){ odFormat=cfg.odFormat;
    const r=document.querySelector(`input[name='odfmt'][value='${cfg.odFormat}']`); if(r) r.checked=true; }
  if(typeof cfg.vexag==="number"){ vexag=cfg.vexag;
    document.getElementById("cfg-vexag").value=cfg.vexag;
    document.getElementById("vexag-val").textContent=vexag.toFixed(1)+"×"; }
  autoDiam=!!cfg.autoDiam; document.getElementById("cfg-dexag").disabled=autoDiam;
  if(typeof cfg.diamExag==="number" && !autoDiam){ diamExag=cfg.diamExag;
    document.getElementById("cfg-dexag").value=cfg.diamExag;
    document.getElementById("dexag-val").textContent=Math.round(diamExag)+"×"; }
  if(typeof cfg.lblSize==="number"){ document.getElementById("cfg-lblsize").value=cfg.lblSize; setLabelSize(cfg.lblSize); }
  if(cfg.font){ document.getElementById("cfg-font").value=cfg.font; setLabelFont(cfg.font); }
  if(cfg.plugInv!=null){ plugCountInverted=!!cfg.plugInv; document.getElementById("cfg-pluginv").checked=plugCountInverted; }
  if(typeof cfg.perfRadiusM==="number"){ perfRadiusM=cfg.perfRadiusM;
    document.getElementById("cfg-perfradius").value=cfg.perfRadiusM;
    document.getElementById("perfradius-val").textContent=perfRadiusM+" m"; }
  applyAllToggles();
}
// cualquier cambio en el panel de capas o en Configuración guarda la vista
document.getElementById("panels").addEventListener("change",saveViewCfg);
document.getElementById("vconfig").addEventListener("change",saveViewCfg);
loadViewCfg();

IDB.open().then(()=>IDB.load()).then(saved=>{
  if(saved){ loadPadObject(saved, false); toast("Pad restaurado de sesión anterior"); return; }
  // sin pad guardado: intentar el de ejemplo (solo funciona servido por HTTP)
  fetch("samples/pad_MMo-35.json").then(r=>{ if(!r.ok) throw 0; return r.json(); })
    .then(o=>loadPadObject(o))
    .catch(()=>{ toast("Cargá un pad.vvwp desde la sección Datos (3)"); show("vdata"); });
}).catch(()=>{
  fetch("samples/pad_MMo-35.json").then(r=>r.json()).then(o=>loadPadObject(o))
    .catch(()=>{ toast("Cargá un pad.vvwp desde Datos"); show("vdata"); });
});
function readFile(file){
  const r=new FileReader();
  r.onload=()=>{ try{ loadPadObject(JSON.parse(r.result)); }catch(err){ toast("Error leyendo JSON: "+err.message); } };
  r.readAsText(file);
}
document.getElementById("file-json").addEventListener("change",e=>{ if(e.target.files[0]) readFile(e.target.files[0]); });
const drop=document.getElementById("drop");
["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("hot");}));
["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("hot");}));
drop.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) readFile(f); });

document.getElementById("ex-json").addEventListener("click",()=>{
  if(!PAD){ toast("No hay pad cargado"); return; }
  const blob=new Blob([JSON.stringify(PAD)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`pad_${PAD.pad.id}.${PAD_EXT}`; a.click(); URL.revokeObjectURL(a.href);
});
document.getElementById("forget").addEventListener("click",()=>{
  IDB.clear();
  // reset completo: gráfico, tabla, pie de página y formulario del constructor
  PAD=null; clearWorld();
  document.getElementById("summary-body").innerHTML="—";
  document.getElementById("foot-pad").textContent="—"; document.getElementById("foot-wells").textContent="—";
  document.getElementById("well-matrix").innerHTML=""; buildGrids();
  ING.wells=[];
  ["b-name","b-id","b-field","b-operator","b-campaign","b-rkb"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("b-spacing").value=10;
  renderWellCards();
  toast("Pad olvidado: gráfico, tabla y formulario reseteados");
});

/* ============================================================================
   INGESTA EN NAVEGADOR — parsers de survey/tally/fracplan (puerto de build_pad.py)
   XLS con SheetJS, PDF con pdf.js. Mantener la lógica en paridad con build_pad.py.
   ============================================================================ */
const round3=x=>x==null?null:Math.round(x*1000)/1000;
const mostCommon=arr=>{ if(!arr.length) return null; const m=new Map();
  for(const v of arr) m.set(v,(m.get(v)||0)+1);
  return [...m.entries()].sort((a,b)=>b[1]-a[1])[0][0]; };
/* ODs estándar de casing (pulg) y OD esperado por fase — para "encajar" candidatos y descartar ruido */
const STD_OD=[4.5,5.0,5.5,7.0,7.625,8.625,9.625,10.75,11.75,13.375];
const PHASE_OD_EXP={guia:13.375, intermedia1:9.625, intermedia2:7.625, produccion:5.0};
/* matriz 1-indexada tipo openpyxl ws.cell(r,c): preserva filas en blanco (a diferencia de sheet_to_json) */
function sheetMatrix(ws){
  const ref=ws && ws["!ref"]; if(!ref) return [];
  const range=XLSX.utils.decode_range(ref); const rows=[];
  for(let R=range.s.r; R<=range.e.r; R++){ const row=[];
    for(let C=range.s.c; C<=range.e.c; C++){ const cell=ws[XLSX.utils.encode_cell({r:R,c:C})]; row.push(cell?cell.v:null); }
    rows.push(row);
  }
  return rows;
}

function parseSurveyXLS(buf){
  if(!window.XLSX) throw new Error("SheetJS no cargó (sin internet?)");
  const wb=XLSX.read(new Uint8Array(buf),{type:"array"}); const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=sheetMatrix(ws); const maxCol=rows.length?rows[0].length:0;
  const cell=(r,c)=>{ const row=rows[r-1]; return row?(row[c-1]??null):null; };   // 1-indexado
  let hdr=null;
  for(let r=1;r<=40;r++){ const v=cell(r,2);
    if(typeof v==="string" && v.trim().toUpperCase().startsWith("MD")){ hdr=r; break; } }
  if(hdr==null) hdr=23;
  const col={};
  for(let c=1;c<=maxCol;c++){ const h=cell(hdr,c);
    if(typeof h==="string") col[h.trim().toUpperCase().split("\n")[0].trim()]=c; }
  const find=(...names)=>{ for(const n of names) if(n in col) return col[n]; return null; };
  const c_md=find("MD"), c_incl=find("INCL"), c_az=find("AZIM GRID","AZIM","AZIMUTH"),
    c_tvd=find("TVD"), c_vsec=find("VSEC"), c_ns=find("NS"), c_ew=find("EW"), c_dls=find("DLS");
  const num=x=>{ if(x==null) return null; if(typeof x==="number") return x;
    const m=String(x).replace(/,/g,"").match(/-?[\d.]+/); return m?parseFloat(m[0]):null; };
  const signed=x=>{ if(x==null) return null; if(typeof x==="number") return x;
    const m=String(x).trim().match(/([NSEW])\s*([\d.]+)/);
    if(m){ const v=parseFloat(m[2]); return (m[1]==="S"||m[1]==="W")?-v:v; } return num(x); };
  let vsec_az=null;
  for(let r=5;r<=21;r++){ for(const [lc,vc] of [[1,3],[7,9]]){ const lab=cell(r,lc);
    if(typeof lab==="string" && lab.includes("Vertical Section Azimuth")){
      const mm=String(cell(r,vc)).match(/[\d.]+/); vsec_az=mm?parseFloat(mm[0]):null; } } }
  const stations=[];
  for(let r=hdr+1;r<=rows.length;r++){
    const md=c_md?cell(r,c_md):null; if(typeof md!=="number") continue;
    stations.push({ md:round3(md),
      incl:c_incl?num(cell(r,c_incl)):null, azim:c_az?num(cell(r,c_az)):null,
      tvd:c_tvd?round3(num(cell(r,c_tvd))||0):null, vsec:c_vsec?num(cell(r,c_vsec)):null,
      ns:c_ns?signed(cell(r,c_ns)):null, ew:c_ew?signed(cell(r,c_ew)):null,
      dls:c_dls?num(cell(r,c_dls)):null });
  }
  if(!stations.length) throw new Error("no se encontraron estaciones (revisá el layout)");
  return {vsec_azimuth_deg:vsec_az, stations};
}

function parseFracplanXLS(buf){
  if(!window.XLSX) throw new Error("SheetJS no cargó (sin internet?)");
  const wb=XLSX.read(new Uint8Array(buf),{type:"array"}); const ws=wb.Sheets["Punzados"];
  if(!ws) throw new Error('falta la hoja "Punzados"');
  const rows=sheetMatrix(ws);
  const c=(r,col)=>{ const row=rows[r-1]; return row?(row[col-1]??null):null; };
  const hdr={lp_md:c(5,2),collar_md:c(6,2),horizontal_ext_m:c(7,2),total_stages:c(9,2)};
  const stages={}, order=[]; let cur=null;
  for(let r=13;r<=rows.length;r++){
    const name=c(r,1); if(!(typeof name==="string" && name.startsWith("Cluster"))) continue;
    const nm=name.match(/(\d+)/); const n=nm?parseInt(nm[1],10):null;
    const stg=c(r,5), plug=c(r,12);
    if(stg!=null){ cur=parseInt(stg,10);
      if(!(cur in stages)){ stages[cur]={stage:cur,plug_md:null,clusters:[]}; order.push(cur); } }
    if(cur==null) continue;
    stages[cur].clusters.push({n, top_md:c(r,2), bottom_md:c(r,3), incl:c(r,4),
      shots:c(r,8), charge:c(r,9), phasing:c(r,10)});
    if(plug!=null) stages[cur].plug_md=plug;
  }
  return { total_stages: hdr.total_stages?parseInt(hdr.total_stages,10):order.length,
    lp_md:hdr.lp_md, collar_md:hdr.collar_md, horizontal_ext_m:hdr.horizontal_ext_m,
    planned_vs_actual:"planned", stages:order.map(s=>stages[s]) };
}

/* pdf.js: reconstruye líneas agrupando ítems de texto por su coordenada y (arriba→abajo) */
/* Reconstruye texto de un PDF con pdf.js imitando a pdfplumber: agrupa ítems por línea (y)
   y, dentro de la línea, inserta espacio SOLO cuando hay un hueco real entre columnas.
   Unir todo con " " a ciegas rompía números ("13.375"→"13. 375") y títulos de sección
   ("2.2 Run Tally"), lo que dejaba el OD en "?" y no detectaba los caños cortos. */
async function pdfText(buf){
  if(!window.pdfjsLib) throw new Error("pdf.js no cargó (sin internet?)");
  const pdf=await pdfjsLib.getDocument({data:buf}).promise; let out="";
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p); const tc=await page.getTextContent();
    const lines=new Map();
    for(const it of tc.items){ if(!it.str) continue;
      const y=Math.round(it.transform[5]);
      if(!lines.has(y)) lines.set(y,[]);
      lines.get(y).push({x:it.transform[4], w:it.width||0, h:Math.abs(it.height)||8, s:it.str}); }
    const ys=[...lines.keys()].sort((a,b)=>b-a);
    for(const y of ys){
      const items=lines.get(y).sort((a,b)=>a.x-b.x);
      let line="", prevEnd=null, prevH=8;
      for(const it of items){
        if(prevEnd!=null && (it.x-prevEnd) > Math.max(1, prevH*0.3)) line+=" ";
        line+=it.s; prevEnd=it.x+it.w; prevH=it.h||prevH;
      }
      out+=line+"\n";
    }
  }
  return out;
}
async function parseTallyPDF(buf, phase){
  const text=await pdfText(buf);
  const m=text.match(/2\.1\s+Pipe\s+Sections([\s\S]*?)2\.2\s+Run\s+Tally/i);
  // fallback: si no aisla la sección 2.1, usa el catálogo del principio del doc igual sirve
  const block=m?m[1]:text.slice(0,4000);
  // OD: junta candidatos decimales de TODO el texto y "encaja" cada uno al OD estándar más
  // cercano (±0.07"). Así descarta las longitudes de tiro (~12 m) que caen en 4–13.5 y hacían
  // ganar un valor equivocado (o ninguno). Si se conoce la fase, prioriza su OD esperado.
  const cands=[...text.matchAll(/\b(\d{1,2}\.\d{1,3})\b/g)].map(x=>parseFloat(x[1]));
  let snapped=[];
  for(const v of cands){ let best=null,bd=0.07;
    for(const s of STD_OD){ const d=Math.abs(v-s); if(d<bd){ bd=d; best=s; } }
    if(best!=null) snapped.push(best); }
  if(phase && PHASE_OD_EXP[phase]!=null) snapped=snapped.filter(v=>Math.abs(v-PHASE_OD_EXP[phase])<1.6);
  const od=mostCommon(snapped);
  // peso (lb/ft): >=14 excluye longitudes de tiro (~12 m); el casing de estas medidas pesa más
  const wts=[...block.matchAll(/\b(\d{2,3}\.\d{1,2})\b/g)].map(x=>parseFloat(x[1])).filter(w=>w>=14&&w<=120);
  const weight=mostCommon(wts);
  const txt2=block+text.slice(0,3000);
  const grades=[...txt2.matchAll(/\b([KNPL])[\s-]?(\d{2,3})Q?\b/g)]
    .filter(g=>+g[2]>=50 && +g[2]<=140).map(g=>g[1]+g[2]);
  const grade=mostCommon(grades);
  const mt=text.match(/Total\s+length\s+run\s+([\d,]+\.\d+)/i);
  const shoe=mt?parseFloat(mt[1].replace(/,/g,"")):null;
  const rt = phase==="produccion" ? parseRunTally(text) : {shorts:[], shoetrack:null};
  return {od_in:od, shoe_md:shoe, weight_ppf:weight, grade, short_joints:rt.shorts, shoetrack:rt.shoetrack};
}
/* Lee el "2.2 Run Tally" y separa piezas cortas (<10 m; los caños normales miden >10 m) en:
   - caños cortos: casing corto / XOVER del TRAMO MEDIO. Se ignoran los primeros y últimos `edgeM`
     metros (cabezal/colgador arriba, shoetrack abajo).
   - shoetrack: piezas cortas de los últimos `edgeM` m (zapato, collar flotador, camisas, cortos).
   Cada fila trae 3 decimales consecutivos = Longitud, Cum.Length, Set Depth (con/sin comas de miles).
   OJO: la fila corta NO trae "N° Tally", por eso ubicamos los 3 decimales sin asumir cuántos enteros
   van antes. Set Depth = MD del TOPE de la pieza (≈ TD − Cum.Length) ⇒ bottom = Set Depth + Longitud. */
function parseRunTally(text, maxLen=10.0, edgeM=150){
  const m=text.match(/2\.2\s+Run\s+Tally([\s\S]*?)(?:\n\s*2\.3|\n\s*3\.|$)/i);
  const block=m?m[1]:text;
  const dec=String.raw`\d+(?:,\d{3})*\.\d+`;
  const re=new RegExp(`(${dec})\\s+(${dec})\\s+(${dec})`);
  const rows=[];
  for(const line of block.split("\n")){
    if(!/^\s*\d/.test(line)) continue;                 // fila de tally: empieza con el N° de junta
    const mm=line.match(re); if(!mm) continue;
    const length=parseFloat(mm[1].replace(/,/g,"")), setd=parseFloat(mm[3].replace(/,/g,""));
    if(!(length>0) || !(setd>0) || length>30) continue;
    rows.push({length, setd, desc:line.slice(mm.index+mm[0].length).trim()});
  }
  if(!rows.length) return {shorts:[], shoetrack:null};
  const maxMD=Math.max(...rows.map(r=>r.setd+r.length));   // fondo de la sarta (≈ zapato)
  const shorts=[], stEls=[];
  for(const r of rows){
    if(r.length>=maxLen) continue;                     // caño normal
    const top=round3(r.setd), bottom=round3(r.setd+r.length);
    if(top<edgeM) continue;                            // primeros 150 m (cabezal/colgador): se ignora
    if(bottom>maxMD-edgeM){                            // últimos 150 m: shoetrack
      stEls.push({desc:r.desc||"elemento", length_m:round3(r.length), top_md:top, bottom_md:bottom});
      continue;
    }
    const isXO=/\bXO\b|X-?OVER|CROSS/i.test(r.desc);    // xover vs casing corto
    shorts.push({desc:r.desc||"caño corto", xover:isXO, length_m:round3(r.length), top_md:top, bottom_md:bottom});
  }
  shorts.sort((a,b)=>a.top_md-b.top_md);
  stEls.sort((a,b)=>a.top_md-b.top_md);                // somero → profundo
  return {shorts, shoetrack: stEls.length?{elements:stEls}:null};
}

/* ---- Estado + UI del constructor ---- */
const PHASES=[["guia","Guía"],["intermedia1","Intermedia 1"],["intermedia2","Intermedia 2"],["produccion","Aislación"]];
// OD API (5–30"), librajes API por OD (lb/ft) y aceros API comunes; TBG de instalación
const API_OD=[5.0,5.5,6.625,7.0,7.625,8.625,9.625,10.75,11.75,13.375,16.0,18.625,20.0,24.0,30.0];
const API_WT={
 5.0:[11.5,13,15,18,21.4,23.2], 5.5:[14,15.5,17,20,23,26,29,32,35,38.5,40.5,43.1],
 6.625:[20,24,28,32], 7.0:[17,20,23,26,29,32,35,38,42.7], 7.625:[24,26.4,29.7,33.7,39],
 8.625:[24,28,32,36,40,44,49], 9.625:[32.3,36,40,43.5,47,53.5,58.4,61.1],
 10.75:[32.75,40.5,45.5,51,55.5,60.7,65.7], 11.75:[42,47,54,60], 13.375:[48,54.5,61,68,72],
 16.0:[65,75,84,97,109], 18.625:[87.5], 20.0:[94,106.5,133], 24.0:[100.46,140.68], 30.0:[157,196,234]};
const API_GRADE=["J55","K55","N80","L80","C90","T95","P110","Q125"];
const TBG_OD=[2.0,2.375,2.875,3.5];
// librajes API de tubing (lb/ft) por OD
const TBG_WT={2.0:[3.4,4.0,4.6], 2.375:[4.6,4.7,5.8,5.95], 2.875:[6.4,6.5,7.8,7.9,8.6,8.7],
  3.5:[7.7,9.2,9.3,10.2,12.7,12.95]};
const ING={wells:[]};
const bnum=id=>{ const v=parseFloat(document.getElementById(id).value); return isFinite(v)?v:null; };
const bstr=id=>document.getElementById(id).value.trim();
// opción API más cercana (para autollenar desde el tally, que puede dar 7.62, 21.3, etc.)
function nearestOD(od){ if(od==null) return null; let best=null,bd=0.12;
  for(const s of API_OD){ const d=Math.abs(s-od); if(d<bd){bd=d;best=s;} } return best; }
function nearestWT(od,wt){ if(wt==null||od==null||!API_WT[od]) return null; let best=null,bd=1.6;
  for(const s of API_WT[od]){ const d=Math.abs(s-wt); if(d<bd){bd=d;best=s;} } return best; }
const opt=(v,txt,sel)=>`<option value="${v}"${v===sel?" selected":""}>${txt}</option>`;
/* si el valor cargado (de JSON/tally) no está en el catálogo API, se agrega igual al picklist
   para que el dato se VEA y siga siendo editable (no se pierde información del pad) */
const withSel=(list,sel)=>(sel!=null && !list.includes(sel)) ? [...list,sel].sort((a,b)=>a-b) : list;
const odOptions=sel=>`<option value="">—</option>`+withSel(API_OD,sel).map(o=>opt(o,fmtOD(o),sel)).join("");
const wtOptions=(od,sel)=>`<option value="">—</option>`+withSel(((od&&API_WT[od])||[]).slice(),sel).map(w=>opt(w,w,sel)).join("");
const grOptions=sel=>`<option value="">—</option>`+((sel&&!API_GRADE.includes(sel))?[...API_GRADE,sel]:API_GRADE).map(g=>opt(g,g,sel)).join("");
const tbgOptions=sel=>`<option value="">—</option>`+withSel(TBG_OD,sel).map(o=>opt(o,fmtOD(o),sel)).join("");
const tbgWtOptions=(od,sel)=>`<option value="">—</option>`+withSel(((od&&TBG_WT[od])||[]).slice(),sel).map(w=>opt(w,w,sel)).join("");
function stset(sel,txt,cls){ const el=document.querySelector(`[data-st="${sel}"]`); if(!el) return;
  el.textContent=txt; el.className="st"+(cls?" "+cls:""); }
function fmtCasingStatus(c){
  if(!c) return "—";
  let s=`${c.od_in!=null?fmtOD(c.od_in):"?"} @ ${c.shoe_md!=null?Math.round(c.shoe_md):"?"}`;
  if(c.grade) s+=" "+c.grade;
  if(c.short_joints?.length) s+=` · ${c.short_joints.length} caño(s) corto(s)`;
  return s;
}
function phaseBlock(i,ph,label,c){ c=c||{};
  return `<div class="phase-row"><span class="tag">${label}</span>
    <span class="btn filebtn">Tally .pdf<input type="file" accept=".pdf" data-w="${i}" data-kind="tally" data-phase="${ph}"></span>
    <span class="st" data-st="tally-${ph}-${i}">${(c.od_in!=null||c.shoe_md!=null)?fmtCasingStatus(c):"—"}</span>
    <div class="cas-grid">
      <label>OD<select data-w="${i}" data-ph="${ph}" data-c="od">${odOptions(c.od_in)}</select></label>
      <label>lb/ft<select data-w="${i}" data-ph="${ph}" data-c="wt">${wtOptions(c.od_in,c.weight_ppf)}</select></label>
      <label>Acero<select data-w="${i}" data-ph="${ph}" data-c="gr">${grOptions(c.grade)}</select></label>
      <label>Zapato MD<input type="number" data-w="${i}" data-ph="${ph}" data-c="md" value="${c.shoe_md??""}"></label>
      <label>TOC MD<input type="number" data-w="${i}" data-ph="${ph}" data-c="toc" value="${c.toc_md??""}"></label>
    </div></div>`;
}
function instBlock(i,w){
  const ins=w.install||{};
  const els=(ins.elements||[]).map((el,k)=>`<div class="inst-el">
      <select data-w="${i}" data-ie="${k}" data-if="type">
        ${opt("TPN","TPN (tapón)",el.type)}${opt("PKR","PKR (packer)",el.type)}</select>
      <input type="number" data-w="${i}" data-ie="${k}" data-if="md" value="${el.md??""}" placeholder="MD (m)">
      <button class="btn" data-w="${i}" data-ie="${k}" data-iact="del">✕</button></div>`).join("");
  return `<div class="inst-wrap collapsed">
    <div class="inst-head"><span class="caret">▸</span><span class="inst-title">Instalación</span>
      <span class="inst-sub">completación · dentro de la aislación</span>
      <label class="inst-en"><input type="checkbox" data-w="${i}" data-iact="enable" ${ins.enabled?"checked":""}> activar</label></div>
    <div class="inst-body${ins.enabled?"":" disabled"}">
      <div class="cas-grid" style="margin-left:0">
        <label>TBG OD<select data-w="${i}" data-iact="tbg-od">${tbgOptions(ins.tbg_od)}</select></label>
        <label>lb/ft<select data-w="${i}" data-iact="tbg-wt">${tbgWtOptions(ins.tbg_od,ins.tbg_weight)}</select></label>
        <label>Acero<select data-w="${i}" data-iact="tbg-gr">${grOptions(ins.tbg_grade)}</select></label>
        <label>MD final (m) *<input type="number" data-w="${i}" data-iact="tbg-md" value="${ins.tbg_md??""}"></label>
      </div>
      <div class="stub" style="font-size:10px">* profundidad (MD desde superficie) hasta donde baja la sarta de TBG. Obligatorio.</div>
      <div class="inst-list">${els}</div>
      <div><button class="btn" data-w="${i}" data-iact="add-TPN">+ TPN</button>
        <button class="btn" data-w="${i}" data-iact="add-PKR">+ PKR</button></div>
    </div></div>`;
}
function shoetrackBlock(i,w){
  const s=w.shoetrack||{enabled:false,elements:[]};
  const els=(s.elements||[]).map((el,k)=>`<div class="inst-el">
      <input type="text" data-w="${i}" data-se="${k}" data-sf="desc" value="${escAttr(el.desc)}" placeholder="descripción" style="width:150px">
      <input type="number" data-w="${i}" data-se="${k}" data-sf="top" value="${el.top_md??""}" placeholder="tope MD">
      <input type="number" data-w="${i}" data-se="${k}" data-sf="len" value="${el.length_m??""}" placeholder="largo m">
      <button class="btn" data-w="${i}" data-se="${k}" data-sact="del">✕</button></div>`).join("");
  return `<div class="inst-wrap collapsed">
    <div class="inst-head"><span class="caret">▸</span><span class="inst-title">Shoetrack</span>
      <span class="inst-sub">zapato, collar, camisas, cortos · autocarga del tally</span>
      <label class="inst-en"><input type="checkbox" data-w="${i}" data-sact="enable" ${s.enabled?"checked":""}> activar</label></div>
    <div class="inst-body${s.enabled?"":" disabled"}">
      <div class="inst-list">${els}</div>
      <div><button class="btn" data-w="${i}" data-sact="add">+ elemento</button></div>
    </div></div>`;
}
/* Fracplan: ver/editar tapones (TPN) y punzados (PERF) del pozo. Rango en una sola caja "xx-yy"
   (top-bottom); un solo número ⇒ "desde" y 1 m (caso TPN). Cuerpo colapsado y renderizado
   perezosamente al expandir (puede tener cientos de elementos). */
function fracBlock(i,w){
  const n=w.frac?(w.frac.stages||[]).length:0;
  const enabled = w.fracEnabled!==false && n>0 ? true : !!w.fracEnabled;
  return `<div class="inst-wrap collapsed" data-fracwrap="${i}">
    <div class="inst-head"><span class="caret">▸</span><span class="inst-title">Fracplan</span>
      <span class="inst-sub">${n} etapa(s) · tapones y punzados</span>
      <label class="inst-en"><input type="checkbox" data-w="${i}" data-fact="enable" ${enabled?"checked":""}> activar</label></div>
    <div class="inst-body${enabled?"":" disabled"}" data-fracbody="${i}"></div></div>`;
}
function fracRowsFromFrac(f){
  const rows=[];
  (f?.stages||[]).forEach(s=>{
    if(s.plug_md!=null) rows.push({type:"TPN", stage:s.stage, range:String(Math.round(s.plug_md))});
    (s.clusters||[]).forEach(c=>{ const a=c.top_md, b=c.bottom_md;
      if(a!=null) rows.push({type:"PERF", stage:s.stage, range:(b!=null&&b!==a)?`${round3(a)}-${round3(b)}`:String(round3(a))}); });
  });
  return rows;
}
function fillFracBody(i){
  const body=document.querySelector(`[data-fracbody="${i}"]`); if(!body || body.dataset.filled) return;
  const w=ING.wells[i]; if(!w.fracRows) w.fracRows=fracRowsFromFrac(w.frac);
  const rowsHtml=w.fracRows.map((r,k)=>`<div class="inst-el">
      <select data-w="${i}" data-fe="${k}" data-ff="type">${opt("PERF","Punzado",r.type)}${opt("TPN","Tapón",r.type)}</select>
      <input type="number" data-w="${i}" data-fe="${k}" data-ff="stage" value="${r.stage??""}" placeholder="etapa" style="width:64px">
      <input type="text" data-w="${i}" data-fe="${k}" data-ff="range" value="${escAttr(r.range)}" placeholder="xx-yy (o xx)" style="width:110px">
      <button class="btn" data-w="${i}" data-fe="${k}" data-fact="del">✕</button></div>`).join("");
  body.innerHTML=`<div class="stub" style="font-size:10px">Rango MD "xx-yy" (tope-fondo). Un número ⇒ desde, 1 m (tapón).</div>
    <div class="inst-list">${rowsHtml}</div>
    <div><button class="btn" data-w="${i}" data-fact="add-PERF">+ Punzado</button>
      <button class="btn" data-w="${i}" data-fact="add-TPN">+ Tapón</button></div>`;
  body.dataset.filled="1";
}
function parseRange(str){ str=(str||"").trim(); if(!str) return null;
  const m=str.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if(m) return {from:+m[1], to:+m[2]};
  if(/^\d+(?:\.\d+)?$/.test(str)){ const v=+str; return {from:v, to:v+1}; }   // 1 número ⇒ 1 m
  return null;
}
function fracFromRows(rows){
  const stages={}, order=[];
  for(const r of rows){ const st=parseInt(r.stage,10); if(!(st>=0)) continue;
    const rg=parseRange(r.range); if(!rg) continue;
    if(!stages[st]){ stages[st]={stage:st, plug_md:null, clusters:[]}; order.push(st); }
    if(r.type==="TPN") stages[st].plug_md=rg.from;
    else stages[st].clusters.push({n:null, top_md:rg.from, bottom_md:rg.to, incl:null, shots:null, charge:null, phasing:null});
  }
  order.sort((a,b)=>a-b);
  return {total_stages:order.length, lp_md:null, collar_md:null, horizontal_ext_m:null,
    planned_vs_actual:"planned", stages:order.map(s=>stages[s])};
}
function renderWellCards(){
  const n=parseInt(document.getElementById("b-nwells").value,10)||0;
  const cont=document.getElementById("b-wells");
  while(ING.wells.length<n) ING.wells.push({id:"", survey:null, frac:null, casings:{}, install:{enabled:false,tbg_od:null,elements:[]}, shoetrack:{enabled:false,elements:[]}});
  ING.wells.length=n;
  cont.innerHTML="";
  for(let i=0;i<n;i++){
    const w=ING.wells[i]; if(!w.install) w.install={enabled:false,tbg_od:null,elements:[]};
    if(!w.shoetrack) w.shoetrack={enabled:false,elements:[]}; if(!w.casings) w.casings={};
    if(w.fracEnabled==null) w.fracEnabled=!!(w.frac&&(w.frac.stages||[]).length);
    const card=document.createElement("div"); card.className="well-card";
    const survSt=w.survey?`MD ${Math.round(w.survey.stations.at(-1).md)} · ${w.survey.stations.length} est`:"— (vertical)";
    const fracSt=w.frac?`${w.frac.total_stages} etapas`:"— (opcional)";
    card.innerHTML=`<h5>Pozo ${i+1}</h5>
      <label style="max-width:280px; margin-bottom:8px">ID del pozo
        <input type="text" data-w="${i}" data-f="id" value="${w.id||""}"></label>
      <div class="file-row"><span class="tag">Survey</span>
        <span class="btn filebtn">Cargar .xlsx<input type="file" accept=".xlsx,.xls" data-w="${i}" data-kind="survey"></span>
        <span class="st" data-st="survey-${i}">${survSt}</span></div>
      <div class="file-row"><span class="tag">Fracplan</span>
        <span class="btn filebtn">Cargar .xlsx<input type="file" accept=".xlsx,.xls" data-w="${i}" data-kind="frac"></span>
        <span class="st" data-st="frac-${i}">${fracSt}</span></div>
      ${PHASES.map(([ph,label])=>phaseBlock(i,ph,label,w.casings[ph])+(ph==="produccion"?instBlock(i,w)+shoetrackBlock(i,w)+fracBlock(i,w):"")).join("")}`;
    cont.appendChild(card);
  }
}
document.getElementById("b-nwells").addEventListener("change",renderWellCards);

function onWellField(e){
  const t=e.target, i=+t.dataset.w; if(!(i>=0)) return; const w=ING.wells[i]; if(!w) return;
  if(t.dataset.f==="id"){ w.id=t.value.trim(); return; }
  if(t.dataset.c){
    const cas=w.casings[t.dataset.ph]||(w.casings[t.dataset.ph]={}); const f=t.dataset.c, v=t.value;
    if(f==="od"){ cas.od_in=v===""?null:parseFloat(v);
      const wtSel=t.closest(".cas-grid").querySelector('[data-c="wt"]');
      if(wtSel){ wtSel.innerHTML=wtOptions(cas.od_in,null); } cas.weight_ppf=null; }
    else if(f==="wt") cas.weight_ppf=v===""?null:parseFloat(v);
    else if(f==="gr") cas.grade=v||null;
    else if(f==="md") cas.shoe_md=v===""?null:parseFloat(v);
    else if(f==="toc") cas.toc_md=v===""?null:parseFloat(v);
    return;
  }
  if(t.dataset.if){ const el=w.install.elements[+t.dataset.ie]; if(!el) return;
    if(t.dataset.if==="type") el.type=t.value; else if(t.dataset.if==="md") el.md=t.value===""?null:parseFloat(t.value);
    return; }
  const ia=t.dataset.iact;
  if(ia==="tbg-od"){ w.install.tbg_od=t.value===""?null:parseFloat(t.value);
    const wtSel=t.closest(".cas-grid").querySelector('[data-iact="tbg-wt"]');
    if(wtSel){ wtSel.innerHTML=tbgWtOptions(w.install.tbg_od,null); } w.install.tbg_weight=null; return; }
  if(ia==="tbg-wt"){ w.install.tbg_weight=t.value===""?null:parseFloat(t.value); return; }
  if(ia==="tbg-gr"){ w.install.tbg_grade=t.value||null; return; }
  if(ia==="tbg-md"){ w.install.tbg_md=t.value===""?null:parseFloat(t.value); return; }
  if(t.dataset.sf){ if(!w.shoetrack) return; const el=w.shoetrack.elements[+t.dataset.se]; if(!el) return;
    if(t.dataset.sf==="desc") el.desc=t.value;
    else if(t.dataset.sf==="top") el.top_md=t.value===""?null:parseFloat(t.value);
    else if(t.dataset.sf==="len") el.length_m=t.value===""?null:parseFloat(t.value);
    return; }
  if(t.dataset.ff){ const el=(w.fracRows||[])[+t.dataset.fe]; if(!el) return;
    if(t.dataset.ff==="type") el.type=t.value;
    else if(t.dataset.ff==="stage") el.stage=t.value===""?null:parseInt(t.value,10);
    else if(t.dataset.ff==="range") el.range=t.value;
    w.frac=fracFromRows(w.fracRows);          // el 3D usa w.frac: se rearma al editar
    return; }
}
document.getElementById("b-wells").addEventListener("input",onWellField);
document.getElementById("b-wells").addEventListener("change",onWellField);
document.getElementById("b-wells").addEventListener("click",e=>{
  const ti=e.target.closest("[data-iact]"), ts=e.target.closest("[data-sact]");
  if(ti){ const i=+ti.dataset.w, w=ING.wells[i]; if(!w) return; const act=ti.dataset.iact;
    if(act==="enable"){ w.install.enabled=e.target.checked;
      const body=ti.closest(".inst-wrap").querySelector(".inst-body");
      if(body) body.classList.toggle("disabled",!e.target.checked); return; }   // visible pero no editable
    if(act==="add-TPN"||act==="add-PKR"){ w.install.elements.push({type:act.slice(4), md:null}); renderWellCards(); return; }
    if(act==="del"){ w.install.elements.splice(+ti.dataset.ie,1); renderWellCards(); return; }
  } else if(ts){ const i=+ts.dataset.w, w=ING.wells[i]; if(!w) return; if(!w.shoetrack) w.shoetrack={enabled:false,elements:[]};
    const act=ts.dataset.sact;
    if(act==="enable"){ w.shoetrack.enabled=e.target.checked;
      const body=ts.closest(".inst-wrap").querySelector(".inst-body");
      if(body) body.classList.toggle("disabled",!e.target.checked); return; }
    if(act==="add"){ w.shoetrack.elements.push({desc:"",top_md:null,length_m:null}); renderWellCards(); return; }
    if(act==="del"){ w.shoetrack.elements.splice(+ts.dataset.se,1); renderWellCards(); return; }
    return;
  }
  const tf=e.target.closest("[data-fact]");
  if(tf){ const i=+tf.dataset.w, w=ING.wells[i]; if(!w) return; if(!w.fracRows) w.fracRows=fracRowsFromFrac(w.frac);
    const act=tf.dataset.fact;
    if(act==="enable"){ w.fracEnabled=e.target.checked;
      const body=tf.closest(".inst-wrap").querySelector(".inst-body");
      if(body) body.classList.toggle("disabled",!e.target.checked); return; }
    if(act==="add-PERF"||act==="add-TPN"){ w.fracRows.push({type:act.slice(4), stage:null, range:""});
      w.frac=fracFromRows(w.fracRows); refillFrac(i); return; }
    if(act==="del"){ w.fracRows.splice(+tf.dataset.fe,1); w.frac=fracFromRows(w.fracRows); refillFrac(i); return; }
    return;
  }
  // colapsar/expandir bloques (instalación / shoetrack / fracplan) al hacer click en el encabezado
  const head=e.target.closest(".inst-head");
  if(head && !e.target.closest(".inst-en")){       // el checkbox "activar" no colapsa
    const wrap=head.parentElement;
    const collapsed=wrap.classList.toggle("collapsed");   // la clase oculta el cuerpo por CSS
    if(!collapsed && wrap.dataset.fracwrap!=null) fillFracBody(+wrap.dataset.fracwrap);   // fracplan perezoso
  }
});
function refillFrac(i){ const body=document.querySelector(`[data-fracbody="${i}"]`);
  if(body){ body.dataset.filled=""; fillFracBody(i); } }
document.getElementById("b-wells").addEventListener("change",async e=>{
  const t=e.target; if(t.type!=="file" || !t.files[0]) return;
  const i=+t.dataset.w, kind=t.dataset.kind, file=t.files[0];
  const key = kind==="tally" ? `tally-${t.dataset.phase}-${i}` : `${kind}-${i}`;
  stset(key,"leyendo…","wait");
  try{
    const buf=await file.arrayBuffer();
    if(kind==="survey"){ const s=parseSurveyXLS(buf); ING.wells[i].survey=s;
      stset(key, `MD ${Math.round(s.stations.at(-1).md)} · ${s.stations.length} est`); }
    else if(kind==="frac"){ const f=parseFracplanXLS(buf); ING.wells[i].frac=f;
      ING.wells[i].fracEnabled=true; ING.wells[i].fracRows=null;   // se re-arma el editor al expandir
      stset(key, `${f.total_stages} etapas`); }
    else if(kind==="tally"){ const ph=t.dataset.phase; const c=await parseTallyPDF(buf, ph);
      const cas=ING.wells[i].casings[ph]||(ING.wells[i].casings[ph]={});
      const od=nearestOD(c.od_in); if(od!=null) cas.od_in=od;
      const wt=nearestWT(cas.od_in, c.weight_ppf); if(wt!=null) cas.weight_ppf=wt;
      if(c.grade) cas.grade=c.grade;
      if(c.shoe_md!=null) cas.shoe_md=c.shoe_md;
      cas.short_joints = c.short_joints?.length ? c.short_joints : undefined;
      // shoetrack autodetectado → estado editable a mano
      if(c.shoetrack?.elements?.length){
        ING.wells[i].shoetrack = {enabled:true,
          elements:c.shoetrack.elements.map(el=>({desc:el.desc, top_md:el.top_md, length_m:el.length_m}))};
      }
      renderWellCards();                       // refleja el autollenado en los picklists (editable)
      stset(key, fmtCasingStatus(cas)); }
  }catch(err){ stset(key, "error: "+err.message, "err"); }
  t.value="";
});

// sin survey: pozo vertical perfecto (TVD=MD, ns=ew=0) hasta el punto más profundo conocido
function synthVertical(w){
  let td=0;
  Object.values(w.casings||{}).forEach(c=>{ if(c.shoe_md) td=Math.max(td,c.shoe_md); if(c.toc_md) td=Math.max(td,c.toc_md); });
  (w.install?.elements||[]).forEach(el=>{ if(el.md) td=Math.max(td,el.md); });
  (w.frac?.stages||[]).forEach(s=>(s.clusters||[]).forEach(cl=>{ const m=cl.bottom_md??cl.top_md; if(m) td=Math.max(td,m); }));
  if(td<=0) td=1000;
  const stations=[]; for(let md=0; md<td; md+=100) stations.push({md, incl:0, azim:0, tvd:md, ns:0, ew:0, vsec:md, dls:0});
  stations.push({md:td, incl:0, azim:0, tvd:td, ns:0, ew:0, vsec:td, dls:0});
  return {vsec_azimuth_deg:0, stations};
}
function assemblePad(){
  const spacing=bnum("b-spacing")??10, rkb=bnum("b-rkb")??0;
  const id=bstr("b-id")||"PAD", name=bstr("b-name")||id;
  const wells=[]; let err=null;
  ING.wells.forEach((w,i)=>{
    if(err) return;
    const anyCas=PHASES.some(([ph])=>{ const c=w.casings[ph];
      return c && (c.od_in!=null||c.shoe_md!=null||c.weight_ppf!=null||c.grade||c.toc_md!=null); });
    if(!(w.survey||w.frac||anyCas||w.install?.enabled)) return;   // pozo totalmente vacío: se omite
    const survey=w.survey||synthVertical(w); const vertical=!w.survey;
    const casings=[];
    PHASES.forEach(([ph])=>{ const c=w.casings[ph];
      if(!c || !(c.od_in!=null||c.shoe_md!=null||c.weight_ppf!=null||c.grade||c.toc_md!=null)) return;
      const cas={phase:ph, od_in:c.od_in??null, shoe_md:c.shoe_md??null, toc_md:c.toc_md??null,
        weight_ppf:c.weight_ppf??null, grade:c.grade??null};
      if(c.short_joints?.length) cas.short_joints=c.short_joints;
      casings.push(cas);
    });
    // shoetrack (manual o autodetectado) → va en la aislación (produccion)
    if(w.shoetrack?.enabled){
      const els=(w.shoetrack.elements||[]).filter(el=>el.top_md!=null).map(el=>({
        desc:el.desc||"elemento", length_m:el.length_m??null,
        top_md:el.top_md, bottom_md:el.top_md+(el.length_m||0)}));
      if(els.length){
        let pc=casings.find(c=>c.phase==="produccion");
        if(!pc){ pc={phase:"produccion",od_in:null,shoe_md:null,toc_md:null,weight_ppf:null,grade:null}; casings.push(pc); }
        pc.shoetrack={elements:els};
      }
    }
    const wobj={ id:w.id||`W${i+1}`, name:w.id||`Pozo ${i+1}`, well_number:i+1,
      architecture:vertical?"vertical":"horizontal",
      wellhead:{x:i*spacing, y:0, rkb_elev_m:rkb, ground_elev_m:rkb},
      survey, casings, frac:(w.fracEnabled===false)?{total_stages:0,stages:[]}:(w.frac||{total_stages:0, stages:[]}) };
    if(w.install?.enabled && (w.install.tbg_od!=null || w.install.tbg_md!=null || (w.install.elements||[]).some(el=>el.md!=null))){
      if(w.install.tbg_md==null){ toast(`Indicá la MD final del TBG en el pozo ${w.id||i+1}`); err=1; return; }
      wobj.installation={ tbg_od_in:w.install.tbg_od??null, tbg_weight_ppf:w.install.tbg_weight??null,
        tbg_grade:w.install.tbg_grade??null, tbg_md_m:w.install.tbg_md,
        elements:(w.install.elements||[]).filter(el=>el.md!=null).map(el=>({type:el.type, md:el.md})) };
    }
    wells.push(wobj);
  });
  if(err) return null;
  if(!wells.length){ toast("Agregá al menos un pozo con algún dato"); return null; }
  return { schema_version:1, app:"vaca-viewer", generated_at:new Date().toISOString(),
    pad:{ id, name, field:bstr("b-field")||null, operator:bstr("b-operator")||null,
      campaign:bnum("b-campaign"),
      surface:{wellhead_spacing_m:spacing, line_azimuth_deg:90}, wells } };
}
document.getElementById("b-generate").addEventListener("click",()=>{
  const pad=assemblePad(); if(!pad) return;
  loadPadObject(pad);
  document.getElementById("b-status").textContent=`✓ ${pad.pad.wells.length} pozo(s) generados`;
});
document.getElementById("b-download").addEventListener("click",()=>{
  const pad=assemblePad(); if(!pad) return;
  const blob=new Blob([JSON.stringify(pad)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`pad_${pad.pad.id||"nuevo"}.${PAD_EXT}`; a.click(); URL.revokeObjectURL(a.href);
});
renderWellCards();

function updateSummary(){
  if(!PAD) return;
  let out="";
  PAD.pad.wells.forEach(w=>{
    const cas=w.casings||[]; const mdf=Math.round((w.survey?.stations.at(-1).md)||0);
    const rws=[];   // filas del pozo: {cls, c} donde c = celdas (sin la de Pozo)
    cas.forEach(c=>{
      rws.push({cls:"", c:`<td>${PHASE_LABEL[c.phase]||c.phase}</td><td>${c.od_in!=null?fmtOD(c.od_in):"—"}</td>`
        +`<td class="num">${c.shoe_md!=null?Math.round(c.shoe_md):"—"}</td><td class="num">${c.toc_md!=null?Math.round(c.toc_md):"—"}</td>`
        +`<td class="num">${c.weight_ppf!=null?c.weight_ppf:"—"}</td><td>${c.grade||"—"}</td>`});
      (c.short_joints||[]).forEach((sj,k)=>{ const len=sj.length_m!=null?`${sj.length_m} m`:"";
        rws.push({cls:"cc", c:`<td>↳ ${sj.xover?"xover":"caño corto"} ${k+1}</td><td>—</td>`
          +`<td class="num">${Math.round(sj.top_md)}–${Math.round(sj.bottom_md)} m</td>`
          +`<td colspan="3" class="dim">${len}${sj.desc?" · "+sj.desc:""}</td>`}); });
      const st=c.shoetrack?.elements||[];
      if(st.length){
        rws.push({cls:"cc", c:`<td>↳ shoetrack</td><td>—</td>`
          +`<td class="num">desde ${Math.round(st[0].top_md)} m</td>`
          +`<td colspan="3" class="dim">${st.length} elemento(s), somero→profundo</td>`});
        st.forEach((el,k)=>rws.push({cls:"cc", c:`<td>&nbsp;&nbsp;${k+1}.</td><td>—</td>`
          +`<td class="num">${Math.round(el.top_md)}–${Math.round(el.bottom_md)} m</td>`
          +`<td colspan="3" class="dim">${el.length_m!=null?el.length_m+" m":""}${el.desc?" · "+el.desc:""}</td>`}));
      }
    });
    if(w.installation){ const ins=w.installation;
      const tbgTxt=[ins.tbg_od_in!=null?"TBG "+fmtOD(ins.tbg_od_in):"—",
        ins.tbg_weight_ppf!=null?ins.tbg_weight_ppf+" lb/ft":null, ins.tbg_grade,
        ins.tbg_md_m!=null?"MD "+Math.round(ins.tbg_md_m)+" m":null].filter(Boolean).join(" · ");
      rws.push({cls:"inst", c:`<td>Instalación</td><td colspan="2">${tbgTxt}</td>`
        +`<td colspan="3" class="dim">${(ins.elements||[]).length} elemento(s)</td>`});
      (ins.elements||[]).forEach(el=>rws.push({cls:"inst", c:`<td>↳ ${el.type}</td><td>—</td>`
        +`<td class="num">${Math.round(el.md)} m</td><td colspan="3" class="dim">${el.type==="PKR"?"packer":"tapón"}</td>`}));
    }
    if(!rws.length) rws.push({cls:"dim", c:`<td colspan="6">sin cañerías cargadas</td>`});
    const meta=`${mdf} m · ${w.frac?.total_stages||0} et${w.architecture==="vertical"?" · vert":""}`;
    out+=`<tr><td rowspan="${rws.length}">${w.id}<br><span class="dim">${meta}</span></td>${rws[0].c}</tr>`;
    for(let k=1;k<rws.length;k++) out+=`<tr class="${rws[k].cls}">${rws[k].c}</tr>`;
  });
  const p=PAD.pad;
  const meta=[p.name||p.id, p.field, p.operator, p.campaign!=null?`campaña ${p.campaign}`:null]
    .filter(Boolean).join(" · ");
  document.getElementById("summary-body").innerHTML=
    `<div class="stub" style="margin-bottom:8px"><b style="color:var(--ink)">${p.id}</b>${meta?" — "+meta:""}</div>`
    +`<table class="tbl"><tr><th>Pozo</th><th>Fase</th><th>OD</th><th>Zapato MD</th><th>TOC MD</th><th>lb/ft</th><th>Grado</th></tr>${out}</table>`;
}

/* ============ Debug panel ============ */
function updateDbg(){
  if(!DBG) return;
  const box=new THREE.Box3().setFromObject(world);
  const c=box.isEmpty()?null:box.getCenter(new THREE.Vector3());
  const sz=box.isEmpty()?null:box.getSize(new THREE.Vector3());
  let nObj=0; world.traverse(()=>nObj++);
  const hasNaN=c&&(isNaN(c.x)||isNaN(c.y)||isNaN(c.z));
  const wells=PAD?PAD.pad.wells.length:0;
  const lines=[
    `PAD: ${PAD?PAD.pad.id:"—"}  pozos:${wells}  objetos:${nObj}`,
    `vexag:${vexag}×`,
    `bbox center: ${c?`${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)}`:"—"}`,
    `bbox size:   ${sz?`${sz.x.toFixed(0)} × ${sz.y.toFixed(0)} × ${sz.z.toFixed(0)}`:"—"}`,
    `cam target:  ${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)}`,
    `cam radius:  ${sph.radius.toFixed(0)}`,
    hasNaN?"⚠ NaN en bounding box — geometría inválida":"",
    LAST_WARN?("⚠ "+LAST_WARN):"",
    `[D] cierra este panel · [F] encuadra`
  ].filter(Boolean);
  document.getElementById("dbg").textContent=lines.join("\n");
}

/* ============ Toast ============ */
let toastT=null;
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2600); }

/* ============ ViewCube (veleta cúbica 3D, estilo Onshape) ============ */
/* Cubo translúcido atravesado por dos ejes (N-S y E-O) con las etiquetas cardinales en las
   puntas (siempre visibles). Se renderiza en un recuadro de la esquina con una cámara que copia
   la orientación de la principal, así se inclina como el terreno. Click en una CARA → vista plana;
   click en un VÉRTICE → vista isométrica de ese octante. Fondo transparente (no pinta color).
   Este=-X, Norte=+Z, Arriba=+Y (paridad con toThree). */
const gizmoScene=new THREE.Scene();
const gizmoCam=new THREE.OrthographicCamera(-1.85,1.85,1.85,-1.85,0.1,100);
const gizmoPick=[], gizmoVerts=[]; let gizmoRect=null, gizmoFaceHi=null;
const _gray=new THREE.Raycaster(), _gv=new THREE.Vector3();
function makeCardSprite(txt,color){
  const c=document.createElement("canvas"); c.width=c.height=64;
  const x=c.getContext("2d"); x.fillStyle=color; x.font="bold 46px ui-monospace,Consolas,monospace";
  x.textAlign="center"; x.textBaseline="middle"; x.fillText(txt,32,36);
  const t=new THREE.CanvasTexture(c); t.anisotropy=4;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t, depthTest:false, depthWrite:false, transparent:true}));
  s.scale.set(0.9,0.9,1); return s;
}
(function buildCube(){
  const s=0.6;
  const cube=new THREE.Mesh(new THREE.BoxGeometry(s*2,s*2,s*2),
    new THREE.MeshBasicMaterial({color:0x2b3542, transparent:true, opacity:0.26, depthWrite:false}));
  cube.userData.gizmo="face"; gizmoScene.add(cube); gizmoPick.push(cube);
  gizmoScene.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({color:0x5a6b7d})));
  // resaltador de cara (se posiciona sobre la cara bajo el cursor)
  gizmoFaceHi=new THREE.Mesh(new THREE.PlaneGeometry(s*1.9,s*1.9),
    new THREE.MeshBasicMaterial({color:0x4ea1d3, transparent:true, opacity:0.4, side:THREE.DoubleSide, depthTest:false, depthWrite:false}));
  gizmoFaceHi.visible=false; gizmoFaceHi.renderOrder=2; gizmoScene.add(gizmoFaceHi);
  const L=1.12;   // ejes que sobresalen del cubo
  gizmoScene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0,0,-L),new THREE.Vector3(0,0,L),
    new THREE.Vector3(-L,0,0),new THREE.Vector3(L,0,0)]),
    new THREE.LineBasicMaterial({color:0x8b97a6})));
  const R=1.3;
  const cards={N:[0,0,1,"#4ea1d3"], S:[0,0,-1,"#8b97a6"], E:[-1,0,0,"#8b97a6"], W:[1,0,0,"#8b97a6"]};
  for(const k in cards){ const [dx,,dz,col]=cards[k];
    const sp=makeCardSprite(k==="W"?"O":k, col); sp.position.set(dx*R,0,dz*R); gizmoScene.add(sp); }
  // vértices clickeables → vistas isométricas
  const vg=new THREE.SphereGeometry(0.11,12,12);
  for(const sx of [-1,1]) for(const sy of [-1,1]) for(const sz of [-1,1]){
    const v=new THREE.Mesh(vg, new THREE.MeshBasicMaterial({color:0x4ea1d3, transparent:true, opacity:0.55}));
    v.position.set(sx*s,sy*s,sz*s); v.userData.gizmo="vertex"; v.userData.dir=new THREE.Vector3(sx,sy,sz);
    gizmoScene.add(v); gizmoPick.push(v); gizmoVerts.push(v);
  }
})();
/* resalte al pasar el mouse: cara → cuadro celeste sobre la cara; vértice → esfera más grande y opaca */
function gizmoHover(clientX,clientY){
  const hit=(dragging===null)?gizmoHitTest(clientX,clientY):null;
  if(gizmoFaceHi) gizmoFaceHi.visible=false;
  gizmoVerts.forEach(v=>{ v.material.opacity=0.55; v.scale.setScalar(1); });
  canvas.style.cursor = hit ? "pointer" : "";
  if(!hit) return;
  if(hit.object.userData.gizmo==="vertex"){ hit.object.material.opacity=1; hit.object.scale.setScalar(1.5); return; }
  const n=hit.face.normal, off=0.6*1.02;
  gizmoFaceHi.position.set(n.x*off, n.y*off, n.z*off);
  if(Math.abs(n.x)>0.5) gizmoFaceHi.rotation.set(0,Math.PI/2,0);
  else if(Math.abs(n.y)>0.5) gizmoFaceHi.rotation.set(Math.PI/2,0,0);
  else gizmoFaceHi.rotation.set(0,0,0);
  gizmoFaceHi.visible=true;
}
canvas.addEventListener("mousemove",e=>gizmoHover(e.clientX,e.clientY));
function renderGizmo(){
  _gv.setFromSpherical(new THREE.Spherical(6, sph.phi, sph.theta));
  gizmoCam.position.copy(_gv); gizmoCam.up.set(0,1,0); gizmoCam.lookAt(0,0,0);
  const W=canvas.clientWidth, H=canvas.clientHeight, S=112, m=12;
  gizmoRect={x:W-S-m, yTop:H-S-m, S};              // en coords de pantalla (top-left) para el picking
  renderer.autoClear=false;                         // no pintar fondo → transparente sobre la escena
  renderer.setScissorTest(true);
  renderer.setViewport(W-S-m, m, S, S); renderer.setScissor(W-S-m, m, S, S);
  renderer.clearDepth();
  renderer.render(gizmoScene, gizmoCam);
  renderer.setScissorTest(false); renderer.setViewport(0,0,W,H); renderer.autoClear=true;
}
function gizmoHitTest(clientX,clientY){
  if(!gizmoRect) return null;
  const rect=canvas.getBoundingClientRect(); const cx=clientX-rect.left, cy=clientY-rect.top;
  if(cx<gizmoRect.x || cx>gizmoRect.x+gizmoRect.S || cy<gizmoRect.yTop || cy>gizmoRect.yTop+gizmoRect.S) return null;
  const nx=((cx-gizmoRect.x)/gizmoRect.S)*2-1, ny=-(((cy-gizmoRect.yTop)/gizmoRect.S)*2-1);
  _gray.setFromCamera({x:nx,y:ny}, gizmoCam);
  const hits=_gray.intersectObjects(gizmoPick,false); return hits.length?hits[0]:null;
}
function setViewFromDir(dir){
  const s=new THREE.Spherical().setFromVector3(dir.clone().normalize());
  sph.phi=Math.max(0.05,Math.min(Math.PI-0.05,s.phi)); sph.theta=s.theta;
  frameAll(); document.getElementById("hud-cam").textContent="vista: esquina (iso)";
}
function applyGizmoHit(hit){
  const o=hit.object;
  if(o.userData.gizmo==="vertex"){ setViewFromDir(o.userData.dir); return; }
  const n=hit.face.normal; let name;
  if(Math.abs(n.y)>=Math.abs(n.x) && Math.abs(n.y)>=Math.abs(n.z)) name=n.y>0?"top":"bottom";
  else if(Math.abs(n.z)>=Math.abs(n.x)) name=n.z>0?"north":"south";
  else name=n.x>0?"west":"east";     // Este=-X ⇒ cara +X es Oeste
  setView(name);
}

/* ============ Loop ============ */
function onResize(){
  const w=canvas.clientWidth||canvas.parentElement.clientWidth, h=canvas.clientHeight||canvas.parentElement.clientHeight;
  if(!w||!h) return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix();
}
window.addEventListener("resize",onResize);
let dbgFrame=0;
let _sceneRadius=8000;   // radio aprox de la escena, se actualiza en frameAll
function tick(){ camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
  camera.lookAt(target);
  // near chico y far amplio, basados en distancia de cámara + tamaño de escena.
  // Evita recorte al acercarse (near fijo bajo) y al alejarse (far cubre toda la escena).
  const camDist=sph.radius;
  camera.near=Math.max(0.05, camDist*0.0015);
  camera.far=camDist + _sceneRadius*4 + 20000;
  camera.updateProjectionMatrix();
  if(autoDiam) updateAutoDiam();
  renderer.render(scene,camera);
  renderGizmo();
  updateLabels();
  if(measurePts.length===2) updateMeasure();
  if(DBG && (dbgFrame++ %15===0)) updateDbg();
  requestAnimationFrame(tick); }
onResize(); tick();

/* Setter puntual del factor de diámetro para el export 3D (engorda cañerías en la foto).
   Reconstruye el pad con el nuevo diamExag; el llamador restaura el valor original después. */
function setDiamExagForExport(v){ diamExag=v; if(PAD) buildPad(PAD); }

/* ============ Exports para módulos de Exportar (v0.3) ============
   Live bindings ES: PAD/isoMode/vexag/SHOW_* reflejan el valor actual al reasignarse arriba. */
export {
  THREE, scene, renderer, camera, sph, target, world, gridGroup, axes,
  wellObjects, LABELS, VIS,
  PAD, isoMode, vexag, diamExag, plugCountInverted, odFormat,
  SHOW_TPN_LABELS, SHOW_STAGE_LABELS, SHOW_SHOE_LABELS, SHOW_SHORT_LABELS,
  SHOW_INSTALL_LABELS, SHOW_SHOETRACK_LABELS, SHOW_TOC_LABELS,
  buildPad, setView, frameAll, toThree, interpAtMD, fmtOD, casingRadius,
  setDiamExagForExport, parseStages,
  escHtml, escAttr, onResize,
  WELL_COLORS, OD_IN, CASING_COLOR, PHASE_LABEL, PERF_LIGHT, PERF_DARK,
};
