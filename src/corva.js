/*
  corva.js — cliente de Corva (solo lectura) y conversión al schema del pad. Sin DOM ni THREE:
  el harness de node lo evalúa tal cual. Spec del mapeo y sus límites en docs/corva.md.

  Regla: a Corva solo se le hacen GET; la única excepción es el login/renovación de token.
*/

const API="https://api.corva.ai";
/* data.corva.ai NO habilita CORS para páginas locales (file:// ni localhost); esta ruta de la API
   core sí (Access-Control-Allow-Origin: *) y devuelve los mismos registros. El swagger la marca
   como deprecada: si Corva la retira, la app ya no puede leer datos sin un proxy. */
const DATA=API+"/api/core/v1/data/corva/";
const SESSION_KEY="vv-corva-v1";
const PARALLEL=8;                  // Corva anda bien con 8 pedidos en paralelo
const FT=0.3048, BBL=0.158987, LB_PER_T=2204.62;
const DLS_100FT_TO_30M=30/30.48;   // Corva da el DLS en °/100 ft; el schema lo usa en °/30 m
const STD_OD=[4.5,5.0,5.5,7.0,7.625,8.625,9.625,10.75,11.75,13.375,16.0,18.625,20.0];
const SHOETRACK_MAX_M=150;         // mismo criterio que la ingesta de tally: últimos ~150 m
const MAX_PAD_SPAN_M=2000;         // bocas más separadas que esto = coordenadas mal cargadas
const SURVEY_GAP_M=50;             // survey y cañería difieren en el fondo por más de esto → se avisa
const MIN_RUN_JOINTS=5;            // columna de tiros real; con menos, Corva carga un largo de relleno
const SHORT_MIN_M=4, SHORT_MAX_M=10;   // largo de un caño corto; fuera de esto, el CCL detectó otra cosa
const CCL_CLUSTER_M=8, CCL_MIN_VOTES=4, CCL_MIN_SHARE=0.15;   // cortos del CCL: ver mapCclShorts
const PLUG_MATCH_M=1;              // un tapón de data.plugs corresponde a la etapa si difiere menos que esto
const ACTUAL_MAX_RATIO=1.8, ACTUAL_MIN_SAND_RATIO=0.02;   // real/diseño fuera de esto = dato mal cargado

/* PADs de la cuenta que no son PADs: copias técnicas y visores para compañías de servicio.
   Sus datos están en los pozos reales. */
const HIDDEN_PAD_IDS=new Set(["2622","11746"]);
const isHiddenPad=(id,name)=>HIDDEN_PAD_IDS.has(String(id)) || /^viewer\b/i.test(name||"");

const num=v=>(typeof v==="number"&&isFinite(v))?v:null;
const round=(v,d=3)=>{ if(v==null) return null; const k=10**d; return Math.round(v*k)/k; };
const ftToM=v=>{ const n=num(v); return n==null?null:round(n*FT); };
const naturalCmp=(a,b)=>String(a).localeCompare(String(b),"es",{numeric:true,sensitivity:"base"});

/* ============ Sesión ============
   Se guarda el token de renovación, NUNCA la contraseña. Con remember=false queda solo en memoria. */
let session=null;
function storedSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||"null"); }catch(e){ return null; } }
function writeSession(){
  try{ if(session?.remember) localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY); }catch(e){ /* sin almacenamiento: dura lo que la pestaña */ }
}
function restoreSession(){ session=storedSession(); return sessionInfo(); }
function sessionInfo(){ return session?{email:session.email, exp:session.exp, remember:!!session.remember}:null; }
function clearSession(){ session=null; writeSession(); }

function jwtExp(jwt){
  try{ const b=jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(b)).exp||0; }catch(e){ return 0; }
}
async function postToken(auth){
  let r;
  try{ r=await fetch(API+"/v1/user_token",{method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"}, body:JSON.stringify({auth})}); }
  catch(e){ throw new Error("Sin conexión con Corva"); }
  const body=await r.json().catch(()=>null);
  if(r.status===401) throw Object.assign(new Error("Corva rechazó el login: revisá mail, contraseña y código"),{status:401});
  if(!r.ok || !body?.jwt) throw Object.assign(new Error(body?.message||body?.error||`Corva rechazó el login (HTTP ${r.status})`),{status:r.status});
  return body;
}
function adoptTokens(body, email, remember){
  session={email, jwt:body.jwt, exp:jwtExp(body.jwt), refresh:body.refresh_token||session?.refresh||null, remember};
  writeSession();
}
async function login(email, password, {mode="", code="", remember=true}={}){
  const auth={email,password};
  if(mode){ auth.verification_mode=mode; auth.verification_code=code; }
  adoptTokens(await postToken(auth), email, remember);
  return sessionInfo();
}
async function renew(){
  if(!session?.refresh) throw new Error("Sesión de Corva vencida: volvé a conectarte en Configuración");
  try{ adoptTokens(await postToken({refresh_token:session.refresh}), session.email, session.remember); }
  catch(e){ if(e.status) throw new Error("Sesión de Corva vencida: volvé a conectarte en Configuración"); throw e; }
}
async function freshToken(){
  if(!session) throw new Error("Sin conexión a Corva: cargá tus credenciales en Configuración");
  if(session.exp-Date.now()/1000<300) await renew();
  return session.jwt;
}

/* GET autenticado; si Corva rechaza el token, renueva una vez y reintenta. */
async function get(url){
  for(let retry=true;;retry=false){
    const jwt=await freshToken();
    let r;
    try{ r=await fetch(url,{headers:{"Authorization":"Bearer "+jwt,"Accept":"application/json"}}); }
    catch(e){ throw new Error("Sin conexión con Corva"); }
    if((r.status===401||r.status===403) && retry){ await renew(); continue; }
    if(!r.ok){ const b=await r.json().catch(()=>null);
      throw Object.assign(new Error(b?.message||`Corva respondió HTTP ${r.status}`),{status:r.status}); }
    return r.json();
  }
}
function dataset(name, params){
  return get(DATA+name+"?"+new URLSearchParams(params));
}

async function listPads(){
  const body=await get(API+"/v2/pads?per_page=1000");
  return (body.data||[]).map(p=>({id:String(p.id), name:p.attributes?.name||String(p.id)}))
    .filter(p=>!isHiddenPad(p.id,p.name)).sort((a,b)=>naturalCmp(a.name,b.name));
}

/* ============ Registros de Corva → schema del pad (funciones puras) ============ */

/* "OPE.Xx.ABC-1234(h) ST01" → "ABC-1234h ST01" (operador.provincia. afuera, sin paréntesis) */
function wellShortId(name){
  return String(name||"").replace(/^[A-Z]{2,4}\.[A-Za-z]{2}\./,"").replace(/[()]/g,"").replace(/\s+/g," ").trim();
}
/* El nombre del pad es texto libre y termina en nombres de archivo: sin separadores de ruta */
function padSafeId(name){ return String(name||"PAD").replace(/[\\/:*?"<>|]+/g,"-").replace(/\s+/g," ").trim(); }

/* De los registros (más nuevo primero) vale el más profundo, y a igual fondo el más nuevo: el más
   nuevo a veces es parcial (el último puede quedar miles de metros antes que el anterior). */
function pickSurvey(records){
  const fondo=r=>Math.max(0,...(r.data?.stations||[]).map(s=>num(s.measured_depth)??0));
  let best=null, bestMD=-1;
  for(const r of records||[]){ const d=fondo(r); if(d>bestMD+1){ best=r; bestMD=d; } }
  return best;
}
function mapSurvey(rec, nsOffset=0){
  const raw=rec?.data?.stations; if(!Array.isArray(raw)) return null;
  const seen=new Set(), stations=[];
  raw.filter(s=>num(s.measured_depth)!=null).sort((a,b)=>a.measured_depth-b.measured_depth).forEach(s=>{
    const md=ftToM(s.measured_depth); if(seen.has(md)) return; seen.add(md);    // MD repetida rompe la curva 3D
    const ns=ftToM(s.northing);
    stations.push({md, incl:num(s.inclination), azim:num(s.azimuth), tvd:ftToM(s.tvd),
      ns:ns==null?null:round(ns+nsOffset), ew:ftToM(s.easting), vsec:ftToM(s.vertical_section),
      dls:num(s.dls)==null?null:round(s.dls*DLS_100FT_TO_30M)});
  });
  if(stations.length<2) return null;
  return {vsec_azimuth_deg:num(rec.data.vertical_section_azimuth), stations};
}

/* Corva da 7.62/7.626 para el 7 5/8": se encaja al OD estándar más cercano */
function normOD(od){
  const n=num(od); if(n==null) return null;
  const hit=STD_OD.find(s=>Math.abs(s-n)<0.02);
  return hit??n;
}
function normGrade(g){ return g?String(g).trim().replace(/(^|\s)([A-Z])-(\d)/g,"$1$2$3"):null; }   // N-80 → N80

/* Fase por OD. Corva carga los tramos de cada pozo en cualquier orden, y puede faltar alguna fase. */
function phaseForOD(od){
  if(od>=11) return "guia";
  if(od>=8.5) return "intermedia1";
  if(od>=6.5) return "intermedia2";
  return "produccion";
}
/* Piezas al fondo de la aislación, de abajo hacia arriba a partir del zapato. Los `components` de
   Corva son un resumen (no suman la longitud del casing), así que solo sirve el tramo final. */
function shoetrackFromComponents(components, shoeMD){
  const comps=[...(components||[])].sort((a,b)=>(a.order??0)-(b.order??0));
  const els=[]; let bottom=shoeMD;
  for(let i=comps.length-1;i>=0;i--){
    const c=comps[i], len=ftToM(c.length); if(len==null) break;
    if(c.family==="casing_joints" && (c.number_of_joints??1)>2) break;   // llegó a la columna de tiros
    if(shoeMD-(bottom-len)>SHOETRACK_MAX_M) break;
    els.unshift({desc:String(c.name||c.family||"elemento").trim(), family:c.family, length_m:len,
      top_md:round(bottom-len), bottom_md:round(bottom)});
    bottom-=len;
  }
  return els;
}
const shortInRange=(top,bottom,shoeMD)=>top>SHOETRACK_MAX_M && bottom<shoeMD-SHOETRACK_MAX_M;   // igual que en el tally
function mapShortJoints(tallyRec, shoeMD){
  return (tallyRec?.data?.short_joints||[]).map(j=>{
    const top_md=ftToM(j.start_depth), bottom_md=ftToM(j.end_depth);
    return {desc:"Caño corto", xover:false, length_m:round(bottom_md-top_md,2), top_md, bottom_md, source:"tally"};
  }).filter(j=>j.top_md!=null && j.bottom_md!=null && shortInRange(j.top_md,j.bottom_md,shoeMD))
    .sort((a,b)=>a.top_md-b.top_md);
}
/* Cortos detectados por wireline: cada corrida (`completion.ccl-collars`) marca los suyos y también
   ruido. Vale el que se repite en muchas corridas. Contra un tally da los mismos cortos,
   a menos de 4 m. */
function mapCclShorts(runs, shoeMD){
  const pts=[];
  (runs||[]).forEach(r=>(r.data?.short_joints||[]).forEach(j=>{
    const a=ftToM(j.start_depth), b=ftToM(j.end_depth); if(a==null||b==null) return;
    if(b-a>=SHORT_MIN_M && b-a<=SHORT_MAX_M) pts.push({a,len:b-a}); }));
  pts.sort((x,y)=>x.a-y.a);
  const groups=[];
  pts.forEach(p=>{ const g=groups.at(-1);
    if(g && p.a-g.at(-1).a<CCL_CLUSTER_M) g.push(p); else groups.push([p]); });
  const minVotes=Math.max(CCL_MIN_VOTES,(runs||[]).length*CCL_MIN_SHARE);
  const avg=(g,f)=>g.reduce((s,p)=>s+p[f],0)/g.length;
  return groups.filter(g=>g.length>=minVotes).map(g=>{
    const top_md=round(avg(g,"a"),1), len=round(avg(g,"len"),1);
    return {desc:"Caño corto (CCL)", xover:false, length_m:len, top_md, bottom_md:round(top_md+len,1), source:"ccl"};
  }).filter(j=>shortInRange(j.top_md,j.bottom_md,shoeMD));
}

/* Corva lista los `components` de arriba hacia abajo, y el primero es un largo de relleno (1 caño de
   12 m) que no llega a superficie: los largos solo cierran contando desde el zapato. Ese primero se
   lleva lo que falta hasta boca de pozo. Validado contra tallys y partes diarios. Sin una columna de tiros real, o si no entra en el pozo, no hay posiciones confiables: null. */
function layoutComponents(components, shoeMD){
  const comps=[...(components||[])].sort((a,b)=>(a.order??0)-(b.order??0));
  if(!comps.some(c=>c.family==="casing_joints" && (c.number_of_joints??1)>=MIN_RUN_JOINTS)) return null;
  const out=[]; let bottom=shoeMD;
  for(let i=comps.length-1;i>=1;i--){
    const len=ftToM(comps[i].length); if(len==null||bottom-len<0) return null;
    out.unshift({c:comps[i], top_md:round(bottom-len), bottom_md:round(bottom)});
    bottom-=len;
  }
  out.unshift({c:comps[0], top_md:0, bottom_md:round(bottom)});
  return out;
}
/* OD/libraje/grado de un componente. El nombre manda: `linear_weight` suele estar mal cargado
   (`5" 21.4# P-110` figura con 17.4 o 18). */
function componentSpec(c){
  const m=String(c.name||"").match(/^\s*([\d.]+)\s*"\s*([\d.]+)\s*#\s*([A-Z]-?\d{2,3})?/);
  return { od_in:normOD(m?parseFloat(m[1]):c.outer_diameter),
    weight_ppf:round(m?parseFloat(m[2]):num(c.linear_weight),2), grade:normGrade(m?.[3]||c.grade) };
}
const sameSpec=(a,b)=>a.od_in===b.od_in && a.weight_ppf===b.weight_ppf && a.grade===b.grade;
const specTxt=s=>`${s.od_in}" ${s.weight_ppf}#`;
/* Tramos = columnas de tiros consecutivas con distinta especificación; el XO queda en el tramo de arriba */
function segmentsFromLayout(layout, shoeMD){
  const segs=[];
  layout.forEach((p,i)=>{
    if(p.c.family!=="casing_joints" || (i>0 && (p.c.number_of_joints??1)<MIN_RUN_JOINTS)) return;
    const sp=componentSpec(p.c);
    if(segs.length && sameSpec(segs.at(-1),sp)) return;
    segs.push({top_md:p.top_md, bottom_md:null, ...sp});
  });
  segs.forEach((s,i)=>{ s.bottom_md=segs[i+1]?.top_md??round(shoeMD); });
  if(segs[0]) segs[0].top_md=0;
  return segs.length>1?segs:null;
}
/* Corto intercalado en la columna (pup/marker), lejos del cabezal y del shoetrack */
function layoutShorts(layout, shoeMD){
  return layout.filter((p,i)=>i>0 && (p.c.family==="pup"||p.c.family==="marker_point"))
    .filter(p=>shortInRange(p.top_md,p.bottom_md,shoeMD))
    .map(p=>({desc:`${String(p.c.name||"Caño corto").trim()} (inferido)`, xover:false,
      length_m:round(p.bottom_md-p.top_md,2), top_md:p.top_md, bottom_md:p.bottom_md, source:"componentes"}));
}
function mapCasings(records, tallyRec, cclRuns, warn=()=>{}){
  const strings=(records||[]).map(r=>r.data||{}).filter(c=>num(c.bottom_depth)!=null)
    .map(c=>({od:normOD(c.outer_diameter), shoe:ftToM(c.bottom_depth), weight:round(num(c.linear_weight),2),
      grade:normGrade(c.grade), components:c.components}))
    .filter(c=>c.od!=null).sort((a,b)=>a.shoe-b.shoe);
  const byPhase={};
  strings.forEach(c=>{
    let ph=phaseForOD(c.od);
    // dos 7 5/8": el más profundo es la aislación del pozo 
    if(byPhase[ph] && ph==="intermedia2") ph="produccion";
    byPhase[ph]=c;   // en orden de profundidad: si se repite, queda el más profundo
  });
  const order=["guia","intermedia1","intermedia2","produccion"];
  return order.filter(ph=>byPhase[ph]).map(ph=>{
    const c=byPhase[ph];
    const cas={phase:ph, od_in:c.od, shoe_md:c.shoe, toc_md:null, weight_ppf:c.weight, grade:c.grade};
    const layout=layoutComponents(c.components,c.shoe);
    const segs=layout?segmentsFromLayout(layout,c.shoe):null;
    if(segs){ const deep=segs.at(-1);
      Object.assign(cas,{segments:segs, od_in:deep.od_in, weight_ppf:deep.weight_ppf??cas.weight_ppf, grade:deep.grade??cas.grade}); }
    if(ph==="produccion"){
      if(!layout){
        const specs=(c.components||[]).filter(x=>x.family==="casing_joints").map(componentSpec);
        const distinct=specs.filter((s,i)=>specs.findIndex(x=>sameSpec(x,s))===i);
        if(distinct.length>1) warn(`Corva nombra ${distinct.map(specTxt).join(" y ")} pero no dónde cambia: cargá los tramos a mano`);
      }
      // Lo normal es 18# arriba y 21.4# abajo. A veces Corva lo tiene al revés que el tally.
      if(segs && segs[0].od_in===segs.at(-1).od_in && segs[0].weight_ppf>segs.at(-1).weight_ppf)
        warn(`el tramo de arriba (${specTxt(segs[0])}) figura más pesado que el de abajo (${specTxt(segs.at(-1))}): revisalo contra el tally`);
      let shorts=mapShortJoints(tallyRec,c.shoe);
      if(!shorts.length) shorts=mapCclShorts(cclRuns,c.shoe);
      if(!shorts.length && layout) shorts=layoutShorts(layout,c.shoe);
      if(shorts.length) cas.short_joints=shorts;
      const els=shoetrackFromComponents(c.components,c.shoe); if(els.length) cas.shoetrack={elements:els};
    }
    return cas;
  });
}

function sandLb(proppants){
  const k={lb:1,lbs:1,"100lb":100,sack:100,kg:2.20462,t:LB_PER_T,tn:LB_PER_T,ton:LB_PER_T};
  return (proppants||[]).reduce((s,p)=>s+(num(p.amount)||0)*(k[p.unit]??0),0);
}
function fluidM3(fluids){
  const k={bbl:BBL,m3:1,gal:0.00378541,l:0.001};
  return (fluids||[]).reduce((s,f)=>s+(num(f.amount)||0)*(k[f.unit]??0),0);
}
function inclAt(stations, md){
  if(!stations?.length) return null;
  let best=stations[0];
  for(const s of stations) if(Math.abs(s.md-md)<Math.abs(best.md-md)) best=s;
  return best.incl;
}
const median=a=>{ const s=[...a].sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:null; };
const orNull=v=>(v>0?v:null);   // sin arena/fluido informado no es lo mismo que cero

/* completion.data.actual-stages → stage.actual. La geometría (tapón, punzados) de ese dataset es copia
   del diseño, así que solo aporta lo bombeado. Arena o fluido fuera de rango contra el diseño son datos
   mal cargados en Corva (unidad cambiada, volumen duplicado): quedan en null y se avisa con `doubtful`. */
function mapActual(d, plan, len){
  let sand=orNull(sandLb(d.proppants)/LB_PER_T), m3=orNull(fluidM3(d.fluids)), doubtful=false;
  if(sand!=null && plan?.sand_t>0){ const k=sand/plan.sand_t;
    if(k>ACTUAL_MAX_RATIO||k<ACTUAL_MIN_SAND_RATIO){ sand=null; doubtful=true; } }
  if(m3!=null && plan?.fluid_m3>0 && m3/plan.fluid_m3>ACTUAL_MAX_RATIO){ m3=null; doubtful=true; }
  const actual={ sand_t:round(sand,1), fluid_m3:round(m3,1),
    prop_int_lbft:(sand!=null&&len>0)?round(sand*LB_PER_T/(len/FT),1):null,
    fluid_int_m3m:(m3!=null&&len>0)?round(m3/len,2):null,
    tp_avg_psi:num(d.average_treating_pressure), tp_max_psi:num(d.max_treating_pressure??d.maximum_treating_pressure),
    rate_avg_bpm:num(d.average_pumping_rate), rate_max_bpm:num(d.max_pumping_rate??d.maximum_pumping_rate),
    isip_psi:num(d.end_isip??d.end_of_job_isip), pump_time_min:num(d.total_pump_time) };
  if(d.skipped) actual.skipped=true;
  if(d.screenout) actual.screenout=true;
  return {actual, doubtful};
}
const cleanNA=v=>(v==null||/^n\/?a$/i.test(String(v).trim()))?null:v;
/* completion.data.plugs: misma profundidad que el diseño, numerada al revés. Aporta tipo, marca y OD. */
function plugInfoFor(plugs, plugMD){
  if(plugMD==null||!plugs?.length) return {info:null, off:false};
  const best=plugs.reduce((b,p)=>Math.abs(p.md-plugMD)<Math.abs(b.md-plugMD)?p:b);
  if(Math.abs(best.md-plugMD)>PLUG_MATCH_M) return {info:null, off:true};
  const info={type:cleanNA(best.type), make:cleanNA(best.make), model:cleanNA(best.model), od_in:num(best.outside_diameter)};
  return {info:Object.values(info).some(v=>v!=null)?info:null, off:false};
}

/* completion.data.stages (diseño) → frac del pad. Mismo orden que el fracplan: etapas de somera a
   profunda, clusters de somero a profundo, y N° de cluster corrido desde el fondo. */
function mapFrac(records, survey, casings, actualRecs, plugRecs, warn=()=>{}){
  const raw=(records||[]).map(r=>r.data||{}).filter(d=>num(d.stage_number)!=null);
  if(!raw.length) return {total_stages:0, stages:[]};
  const byStage=new Map(); raw.forEach(d=>byStage.set(d.stage_number,d));     // etapa repetida: vale la última
  const deepFirst=[...byStage.values()].sort((a,b)=>a.stage_number-b.stage_number);
  // longitud de etapa = de tapón a tapón; la más somera no tiene tapón arriba → mediana de las demás
  const lengths=new Map();
  deepFirst.forEach((d,i)=>{ const next=deepFirst[i+1];
    const from=ftToM(d.plug_depth??d.bottom_perforation), to=next?ftToM(next.plug_depth):null;
    if(from!=null && to!=null && from>to) lengths.set(d.stage_number,from-to); });
  const medLen=median([...lengths.values()]);
  const actualBy=new Map((actualRecs||[]).map(r=>r.data||{}).filter(d=>num(d.stage_number)!=null).map(d=>[d.stage_number,d]));
  const plugs=(plugRecs||[]).map(r=>r.data||{}).filter(d=>num(d.top_depth)!=null).map(d=>({...d, md:ftToM(d.top_depth)}));
  let n=0, nDoubtful=0, nPlugOff=0;
  const stages=deepFirst.map(d=>{
    const st=survey?.stations;
    let cls=(d.perforation_clusters||[]).filter(c=>num(c.top_md)!=null)
      .sort((a,b)=>b.top_md-a.top_md).map(c=>({
        n:++n, top_md:ftToM(c.top_md), bottom_md:ftToM(c.bottom_md),
        incl:inclAt(st,ftToM(c.top_md)), shots:num(c.cluster_shots), charge:null, phasing:num(c.perforation_phasing) }));
    // pozos viejos sin clusters en Corva: un único tramo con el intervalo punzado de la etapa
    if(!cls.length && num(d.top_perforation)!=null && num(d.bottom_perforation)!=null){
      cls=[{n:++n, top_md:ftToM(d.top_perforation), bottom_md:ftToM(d.bottom_perforation),
        incl:inclAt(st,ftToM(d.top_perforation)), shots:num(d.total_shots), charge:null, phasing:null}];
    }
    const stage={stage:d.stage_number, plug_md:ftToM(d.plug_depth), clusters:cls.reverse()};
    const lb=sandLb(d.proppants), m3=fluidM3(d.fluids);
    let len=lengths.get(d.stage_number)??medLen;
    if(len==null && num(d.perforated_length)!=null) len=d.perforated_length*FT;
    if((lb>0||m3>0) && len>0){
      const spf=num(d.shot_per_foot), ehd=num(d.ehd);
      stage.plan={ sand_t:round(lb/LB_PER_T,1), fluid_m3:round(m3,1),
        prop_int_lbft:round(lb/(len/FT),1), fluid_int_m3m:round(m3/len,2), length_m:round(len,2),
        wl:[spf!=null?`${spf} spf`:null, ehd!=null?`EHD ${ehd}"`:null].filter(Boolean).join(" · ")||null };
    }
    const realRec=actualBy.get(d.stage_number);
    if(realRec){ const {actual,doubtful}=mapActual(realRec,stage.plan,len); stage.actual=actual; if(doubtful) nDoubtful++; }
    const {info,off}=plugInfoFor(plugs,stage.plug_md);
    if(info) stage.plug_info=info;
    if(off) nPlugOff++;
    return stage;
  }).filter(s=>s.clusters.length||s.plug_md!=null).sort((a,b)=>b.stage-a.stage);
  const nReal=stages.filter(s=>s.actual).length;
  if(nReal && nReal<stages.length) warn(`Corva tiene datos reales de ${nReal} de ${stages.length} etapas`);
  if(nDoubtful) warn(`${nDoubtful} etapa(s) con arena o fluido real dudoso en Corva: ese valor no se usa`);
  if(nPlugOff) warn(`${nPlugOff} tapón(es) a más de ${PLUG_MATCH_M} m entre las etapas y completion.data.plugs: se usan los de las etapas`);
  const lp=survey?.stations.find(s=>(s.incl??0)>=89);
  const prod=casings.find(c=>c.phase==="produccion");
  const toe=(prod?.shoetrack?.elements||[]).find(el=>el.family==="toe_sleeve");
  const lp_md=lp?lp.md:null, collar_md=toe?toe.top_md:null;
  return { total_stages:stages.length, lp_md, collar_md,
    horizontal_ext_m:(lp_md!=null&&collar_md!=null)?round(collar_md-lp_md,1):null,
    planned_vs_actual:"planned", stages };
}

/* Bocas en metros respecto del primer pozo. Sin coordenadas, o con un pozo a kilómetros (dato mal
   cargado), se cae a la línea estándar cada 10 m. */
function wellheadOffsets(lonLats){
  const line=lonLats.map((_,i)=>({x:i*10,y:0}));
  if(lonLats.some(p=>num(p?.longitude)==null||num(p?.latitude)==null)) return line;
  const {longitude:lon0,latitude:lat0}=lonLats[0], kx=111320*Math.cos(lat0*Math.PI/180), ky=110540;
  const pts=lonLats.map(p=>({x:round((p.longitude-lon0)*kx,1), y:round((p.latitude-lat0)*ky,1)}));
  const span=Math.max(...pts.map(p=>Math.hypot(p.x,p.y)));
  return span>MAX_PAD_SPAN_M?line:pts;
}
function wellSummary(w){
  const nSt=w.survey.stations.length, nCas=w.casings.length, nEt=w.frac.stages.length;
  const nReal=w.frac.stages.filter(s=>s.actual).length;
  const prod=w.casings.find(c=>c.phase==="produccion");
  const parts=[`${nSt} estaciones`,`${nCas} cañerías`,`${nEt} etapas`];
  if(nReal) parts.push(`${nReal} con datos reales`);
  if(prod?.segments) parts.push(`${prod.segments.length} tramos`);
  if(prod?.short_joints) parts.push(`${prod.short_joints.length} caños cortos`);
  return `${w.id}: ${parts.join(" · ")}`;
}

/* raws: [{attrs, asset, survey, casing, stages, actual, plugs, tally, ccl}] → pad del schema + avisos por pozo */
function buildPadObject(padId, padName, raws){
  const warnings=[], usable=raws.filter(r=>{
    if(r.survey?.data?.stations?.length) return true;
    warnings.push(`${wellShortId(r.attrs.name)}: sin survey en Corva, se omite`); return false; });
  if(!usable.length) throw new Error("Corva no tiene surveys para los pozos de este pad");
  usable.sort((a,b)=>naturalCmp(wellShortId(a.attrs.name),wellShortId(b.attrs.name)));
  const heads=wellheadOffsets(usable.map(r=>r.attrs.lon_lat));
  const wells=usable.map((r,i)=>{
    const head=heads[i];
    // el visor ubica cada boca solo por x: el corrimiento N/S real se suma a las estaciones
    const survey=mapSurvey(r.survey, Math.abs(head.y)>=1?head.y:0);
    const id=wellShortId(r.attrs.name)||String(r.attrs.asset_id);
    const warn=msg=>warnings.push(`${id}: ${msg}`);
    const casings=mapCasings(r.casing, r.tally, r.ccl, warn);
    const frac=mapFrac(r.stages, survey, casings, r.actual, r.plugs, warn);
    casings.forEach(c=>c.shoetrack?.elements.forEach(el=>delete el.family));
    if(!casings.length) warnings.push(`${id}: sin cañerías en Corva`);
    if(!frac.stages.length) warnings.push(`${id}: sin etapas de fractura en Corva`);
    const td=survey.stations.at(-1).md, deepest=Math.max(0,...casings.map(c=>c.shoe_md));
    if(deepest>0 && Math.abs(deepest-td)>SURVEY_GAP_M) warnings.push(`${id}: el survey llega a ${Math.round(td)} m y la cañería a ${Math.round(deepest)} m`);
    const twin=heads.findIndex((h,k)=>k<i && h.x===head.x && h.y===head.y);
    if(twin>=0) warnings.push(`${id}: misma coordenada de boca que ${wellShortId(usable[twin].attrs.name)} en Corva`);
    return { id, name:r.attrs.name, well_number:i+1, architecture:"horizontal",
      target:r.asset?.target_formation||null,
      wellhead:{x:head.x, y:head.y, rkb_elev_m:null, ground_elev_m:null},
      survey, casings, frac };
  });
  const noShorts=wells.filter(w=>{ const p=w.casings.find(c=>c.phase==="produccion"); return p && !p.short_joints; }).map(w=>w.id);
  if(noShorts.length) warnings.push(`Sin caños cortos en Corva: ${noShorts.join(", ")}. Se cargan con el tally o a mano en Manual`);
  // separación estándar (la usa el constructor Manual): la menor en E/O, para no contar pozos de otra locación
  const gaps=heads.slice(1).map((h,i)=>Math.abs(h.x-heads[i].x)).filter(g=>g>=1);
  return { warnings, pad:{ schema_version:1, app:"vaca-viewer", generated_at:new Date().toISOString(),
    pad:{ id:padSafeId(padName), name:padName, field:usable[0].asset?.basin||null, operator:null, campaign:null,
      source:{provider:"corva", pad_id:String(padId)},
      surface:{wellhead_spacing_m:gaps.length?round(Math.min(...gaps),1):10, line_azimuth_deg:90}, wells } } };
}

/* ============ Traer un pad completo ============ */
async function pool(tasks, size){
  const out=new Array(tasks.length); let next=0;
  await Promise.all(Array.from({length:Math.min(size,tasks.length)},async()=>{
    while(next<tasks.length){ const i=next++; out[i]=await tasks[i](); }
  }));
  return out;
}
/* Esta ruta quiere el sort SIN comillas: con JSON válido responde 200 pero ignora el orden */
const SORT_OLD={sort:"{timestamp: 1}"}, SORT_NEW={sort:"{timestamp: -1}"};
/* Solo los campos que se usan: pumping_schedule y components por etapa pesan mucho */
const STAGE_FIELDS=["stage_number","plug_depth","top_perforation","bottom_perforation","perforated_length",
  "total_shots","shot_per_foot","ehd","perforation_clusters","proppants","fluids"].map(f=>"data."+f).join(",");
const ACTUAL_FIELDS=["stage_number","proppants","fluids","average_treating_pressure","max_treating_pressure",
  "maximum_treating_pressure","average_pumping_rate","max_pumping_rate","maximum_pumping_rate","end_isip",
  "end_of_job_isip","total_pump_time","skipped","screenout"].map(f=>"data."+f).join(",");

async function fetchPad(padId, padName, onProgress=()=>{}){
  onProgress("Pidiendo los pozos del pad…");
  const body=await get(`${API}/v2/pads/${encodeURIComponent(padId)}/wells`);
  const wells=(body.data||[]).map(w=>w.attributes||{}).filter(a=>a.asset_id!=null && !a.custom_properties?.is_asset_viewer);
  if(!wells.length) throw new Error("Corva no lista pozos para este pad");
  const failures=[]; let done=0, total=0;
  /* un dataset que falla no tira el pad; sí corta si ya no hay conexión o sesión (sin .status) */
  const fetchDs=(a,name,params)=>async()=>{
    try{ return await dataset(name,{asset_id:a.asset_id,...params}); }
    catch(e){ if(!e.status) throw e; failures.push(`${wellShortId(a.name)}: ${name} no disponible (${e.message})`); return null; }
    finally{ done++; onProgress(`Leyendo datos de ${wells.length} pozos… ${done}/${total}`); }
  };
  const tasks=[], slot=[];
  wells.forEach((a,w)=>{
    const add=(key,name,params)=>{ slot.push([w,key]); tasks.push(fetchDs(a,name,params)); };
    add("survey","data.actual_survey",{...SORT_NEW,limit:20});
    add("casing","data.casing",{...SORT_OLD,limit:50});
    add("stages","completion.data.stages",{...SORT_OLD,limit:500,fields:STAGE_FIELDS});
    add("actual","completion.data.actual-stages",{...SORT_OLD,limit:500,fields:ACTUAL_FIELDS});
    add("plugs","completion.data.plugs",{...SORT_OLD,limit:500});
    add("tally","completion.casing-tally",{...SORT_NEW,limit:1});
    add("ccl","completion.ccl-collars",{...SORT_OLD,limit:500,fields:"data.short_joints"});
    add("asset","assets",{...SORT_OLD,limit:1});
  });
  total=tasks.length;
  const results=await pool(tasks,PARALLEL);
  const raws=wells.map(attrs=>({attrs}));
  results.forEach((res,i)=>{ const [w,key]=slot[i], list=Array.isArray(res)?res:[];
    raws[w][key]=(key==="survey")?pickSurvey(list):((key==="asset"||key==="tally")?(list[0]||null):list); });
  const {pad,warnings}=buildPadObject(padId,padName,raws);
  return {pad, warnings:[...failures,...warnings], summary:pad.pad.wells.map(wellSummary)};
}

export { restoreSession, sessionInfo, clearSession, login, listPads, fetchPad,
  wellShortId, padSafeId, pickSurvey, mapSurvey, mapCasings, mapFrac, mapActual, mapCclShorts, layoutComponents,
  segmentsFromLayout, componentSpec, wellheadOffsets, buildPadObject, isHiddenPad };
