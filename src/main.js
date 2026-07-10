/*
  main.js — bootstrap de Vaca Viewer (v0.3).
  Importa el visor (efectos secundarios: escena, carga de pad, loop) y los módulos de Exportar,
  y cablea la sección "Exportar". El resto de las secciones se autoconfiguran dentro de viewer.js.
*/
import "./viewer.js";
import { initExport } from "./export-ui.js";

initExport();
