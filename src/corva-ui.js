/*
  corva-ui.js — cablea las solapas de Datos (Manual / Corva) y las credenciales en Configuración.
  El cliente y la conversión viven en corva.js (sin DOM).
*/
import { restoreSession, sessionInfo, clearSession, login, listPads, fetchPad } from "./corva.js";
import { loadRemotePad, show, escHtml, setIsoMode } from "./viewer.js";

const $=id=>document.getElementById(id);
let padsLoaded=false, busy=false;

function setMsg(el, text, kind=""){ el.textContent=text; el.classList.toggle("cv-ok",kind==="ok"); el.classList.toggle("cv-err",kind==="err"); }

/* ---- Configuración: credenciales ---- */
function renderAccount(){
  const s=sessionInfo();
  $("cv-account").style.display=s?"block":"none";
  $("cv-login").style.display=s?"none":"block";
  if(s){
    const until=s.exp?new Date(s.exp*1000).toLocaleDateString("es-AR"):"—";
    $("cv-who").textContent=s.email;
    $("cv-exp").textContent=until;
    $("cv-keep").textContent=s.remember?"Guardada en este navegador":"Solo hasta cerrar la pestaña";
  }
  renderPadPicker();
}
async function connect(e){
  e.preventDefault();
  const email=$("cv-email").value.trim(), pass=$("cv-pass").value, mode=$("cv-mfa").value, code=$("cv-code").value.trim();
  if(!email||!pass){ setMsg($("cv-auth-status"),"Completá mail y contraseña","err"); return; }
  if(mode&&!code){ setMsg($("cv-auth-status"),"Completá el código de verificación","err"); return; }
  setMsg($("cv-auth-status"),"Validando con Corva…");
  $("cv-connect").disabled=true;
  try{
    await login(email,pass,{mode,code,remember:$("cv-remember").checked});
    const pads=await listPads();     // valida de punta a punta: el token sirve para leer
    $("cv-pass").value=""; $("cv-code").value="";
    fillPads(pads);
    renderAccount();
    setMsg($("cv-auth-status"),`✓ Conexión válida · ${pads.length} PADs disponibles`,"ok");
  }catch(err){
    clearSession(); renderAccount();
    setMsg($("cv-auth-status"),err.message,"err");
  }finally{ $("cv-connect").disabled=false; }
}
async function validate(){
  setMsg($("cv-auth-status"),"Validando con Corva…");
  try{ const pads=await listPads(); fillPads(pads); renderAccount();
    setMsg($("cv-auth-status"),`✓ Conexión válida · ${pads.length} PADs disponibles`,"ok"); }
  catch(err){ renderAccount(); setMsg($("cv-auth-status"),err.message,"err"); }
}
function disconnect(){
  clearSession(); padsLoaded=false;
  $("cv-pad").innerHTML="";
  setMsg($("cv-auth-status"),""); setMsg($("cv-status"),""); $("cv-log").innerHTML="";
  renderAccount();
}

/* ---- Solapa Corva: picklist y carga ---- */
function fillPads(pads){
  const sel=$("cv-pad"), prev=sel.value;
  sel.innerHTML=`<option value="">Elegí un pad…</option>`+pads.map(p=>`<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join("");
  if(pads.some(p=>p.id===prev)) sel.value=prev;
  padsLoaded=true;
  syncLoadBtn();
}
function syncLoadBtn(){ $("cv-load").disabled=busy||!$("cv-pad").value; }
function renderPadPicker(){
  const on=!!sessionInfo();
  $("cv-noauth").style.display=on?"none":"block";
  $("cv-picker").style.display=on?"block":"none";
}
async function refreshPads(){
  setMsg($("cv-status"),"Pidiendo la lista de PADs…");
  try{ const pads=await listPads(); fillPads(pads); setMsg($("cv-status"),`${pads.length} PADs disponibles`); }
  catch(err){ setMsg($("cv-status"),err.message,"err"); }
}
/* picklist Frac plan / real: colorea el pad cargado. Sin datos reales, cae al plan y lo devuelve como aviso. */
function applyFracView(){
  const want=$("cv-frac").value;
  if(setIsoMode(want)) return null;
  if(want==="fracreal" && setIsoMode("fracplan")){ $("cv-frac").value="fracplan";
    return "Este pad no tiene datos reales de fractura: se muestra el plan."; }
  return null;
}
async function loadPad(){
  const sel=$("cv-pad"), id=sel.value; if(!id||busy) return;
  const name=sel.options[sel.selectedIndex].textContent;
  busy=true; syncLoadBtn();
  $("cv-log").innerHTML="";
  setMsg($("cv-status"),"Conectando…");
  try{
    const {pad,warnings,summary}=await fetchPad(id,name,txt=>setMsg($("cv-status"),txt));
    $("cv-log").innerHTML=summary.map(s=>`<div>${escHtml(s)}</div>`).join("")
      +warnings.map(s=>`<div class="cv-warn">⚠ ${escHtml(s)}</div>`).join("");
    setMsg($("cv-status"),`✓ ${name} cargado desde Corva`,"ok");
    loadRemotePad(pad);
    const note=applyFracView();
    if(note) $("cv-log").insertAdjacentHTML("beforeend",`<div class="cv-warn">⚠ ${escHtml(note)}</div>`);
  }catch(err){ setMsg($("cv-status"),err.message,"err"); }
  finally{ busy=false; syncLoadBtn(); }
}

function wireTabs(){
  document.querySelectorAll(".sub-tab").forEach(btn=>btn.addEventListener("click",()=>{
    const id=btn.dataset.dtab;
    document.querySelectorAll(".sub-tab").forEach(b=>b.classList.toggle("active",b===btn));
    document.querySelectorAll(".sub-pane").forEach(p=>p.classList.toggle("active",p.id===id));
    if(id==="dt-corva" && sessionInfo() && !padsLoaded) refreshPads();
  }));
}

export function initCorva(){
  wireTabs();
  restoreSession();
  renderAccount();
  $("cv-form").addEventListener("submit",connect);
  $("cv-mfa").addEventListener("change",e=>{ $("cv-code-row").style.display=e.target.value?"flex":"none"; });
  $("cv-validate").addEventListener("click",validate);
  $("cv-disconnect").addEventListener("click",disconnect);
  $("cv-pad").addEventListener("change",syncLoadBtn);
  $("cv-frac").addEventListener("change",()=>{ const note=applyFracView(); if(note) setMsg($("cv-status"),note,"err"); });
  // la Vista de pozo también elige plan o real: el picklist la acompaña
  document.querySelectorAll("input[name='isomode']").forEach(r=>{
    const sync=()=>{ if(r.checked && (r.value==="fracplan"||r.value==="fracreal")) $("cv-frac").value=r.value; };
    r.addEventListener("change",sync); sync(); });
  $("cv-load").addEventListener("click",loadPad);
  $("cv-refresh").addEventListener("click",refreshPads);
  $("cv-goconfig").addEventListener("click",()=>show("vconfig"));
  syncLoadBtn();
}
