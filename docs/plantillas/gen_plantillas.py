#!/usr/bin/env python3
"""Genera las 3 plantillas .xlsx de ingesta (survey, fracplan, tally de cañerías).
Los layouts coinciden EXACTAMENTE con los parsers (parseSurveyXLS / parseFracplanXLS /
parseTallyXLS en src/viewer.js y sus gemelos en build_pad.py). Ver docs/archivos-input.md.

Uso:  python3 docs/plantillas/gen_plantillas.py
"""
import openpyxl, os
from openpyxl.styles import Font, PatternFill, Alignment

HERE=os.path.dirname(os.path.abspath(__file__))
BOLD=Font(bold=True)
HEAD=Font(bold=True, color="FFFFFF")
HFILL=PatternFill("solid", fgColor="2A3441")
NOTE=Font(italic=True, color="808080")

def _hrow(ws, r, values, c0=1):
    for i, v in enumerate(values):
        cell=ws.cell(r, c0+i, v); cell.font=HEAD; cell.fill=HFILL; cell.alignment=Alignment(horizontal="center")

# ---------------------------------------------------------------- SURVEY
def survey(path):
    wb=openpyxl.Workbook(); ws=wb.active; ws.title="Survey"
    ws.cell(1,1,"PLANTILLA SURVEY — una fila por estación. La columna B del encabezado DEBE decir 'MD'.").font=NOTE
    ws.cell(3,1,"Pozo:").font=BOLD; ws.cell(3,2,"MMo-XXXXh")
    ws.cell(5,1,"Vertical Section Azimuth (deg):").font=BOLD; ws.cell(5,3,180.0)
    ws.cell(7,1,"NS/EW = offset LOCAL a la boca (m). Signo: +N/+E, −S/−O. NO usar Northing/Easting absolutos del CRS.").font=NOTE
    # encabezado en fila 10 (MD en col B); columnas se mapean por texto
    _hrow(ws, 10, ["N°","MD","INCL","AZIM","TVD","VSEC","NS","EW","DLS"])
    demo=[  # md, incl, azim, tvd, vsec, ns, ew, dls
        (0,0,0,0,0,0,0,0),(500,0,0,500,0,0,0,0),(1500,0,0,1500,0,0,0,0),
        (2500,15,180,2480,60,-60,0,3.0),(3000,60,180,2830,330,-330,0,5.5),
        (3300,90,180,2950,600,-600,0,6.0),(4300,90,180,2960,1600,-1600,0,0.3),
        (5300,90,180,2965,2600,-2600,0,0.2),(6300,90,180,2968,3600,-3600,0,0.2)]
    for k,(md,inc,az,tvd,vs,ns,ew,dls) in enumerate(demo):
        ws.cell(11+k,1,k+1); ws.cell(11+k,2,md); ws.cell(11+k,3,inc); ws.cell(11+k,4,az)
        ws.cell(11+k,5,tvd); ws.cell(11+k,6,vs); ws.cell(11+k,7,ns); ws.cell(11+k,8,ew); ws.cell(11+k,9,dls)
    for col,w in zip("ABCDEFGHI",[6,9,8,8,9,9,9,9,7]): ws.column_dimensions[col].width=w
    wb.save(path)

# ---------------------------------------------------------------- FRACPLAN
def fracplan(path):
    wb=openpyxl.Workbook()
    # --- hoja Punzados (posiciones FIJAS: ver parser) ---
    pz=wb.active; pz.title="Punzados"
    pz.cell(1,1,"Pozo:").font=BOLD; pz.cell(1,2,"MMo-XXXXh")
    pz.cell(5,1,"MD 90° (LP)").font=BOLD; pz.cell(5,2,3300)         # lp_md  -> c(5,2)
    pz.cell(6,1,"Camisa (m)").font=BOLD;  pz.cell(6,2,6300)         # collar -> c(6,2)
    pz.cell(7,1,"Ext. Horizontal").font=BOLD; pz.cell(7,2,3000)     # hz ext -> c(7,2)
    pz.cell(9,1,"Total etapas").font=BOLD; pz.cell(9,2,4)           # total  -> c(9,2)  (¡es la verdad!)
    _hrow(pz, 12, ["# Cluster","Tope MD (m)","Fondo MD (m)","Incl (°)","N° etapa",
                   "Sep (m)","Altura (m)","N° tiros","Carga","Phasing","Temp (°C)","Plug MD (m)","Long ET (m)"])
    # 4 etapas × 2 clusters (stage solo en la 1ª fila de cada etapa; plug en la última)
    row=13; cl=8
    stages=[(1,6206,"EHO 45",2,6280),(2,6100,"EHO 45",2,6180),(3,4300,"EHO 40",1,4380),(4,3371,"EHO 40",2,3469)]
    for stg,base,carga,tiros,plug in stages:
        for j in range(2):
            top=base+j*7; pz.cell(row,1,f"Cluster {cl}"); cl-=1
            pz.cell(row,2,top); pz.cell(row,3,round(top+0.3,1)); pz.cell(row,4,90)
            if j==0: pz.cell(row,5,stg)                 # N° etapa solo en el 1er cluster
            pz.cell(row,6,7); pz.cell(row,7,0.3); pz.cell(row,8,tiros); pz.cell(row,9,carga); pz.cell(row,10,0)
            pz.cell(row,11,130); pz.cell(row,13,105.0)
            if j==1: pz.cell(row,12,plug)               # Plug MD en la última fila de la etapa
            row+=1
    pz.cell(row+1,1,"NOTA: las filas OCULTAS se IGNORAN al ingerir (dato borrado). 'Total etapas' manda.").font=NOTE
    for col,w in zip("ABCDEFGHIJKLM",[12,13,13,8,8,7,8,8,10,8,9,11,11]): pz.column_dimensions[col].width=w
    # --- hoja Resumen (valores POR GRUPO de etapas; se leen por etiqueta) ---
    rs=wb.create_sheet("Resumen")
    rs.cell(1,1,"Yacimiento:").font=BOLD; rs.cell(1,3,"MMo-XXXXh")
    _hrow(rs, 3, ["", "TOTAL", "Etapas 1-2", "Etapas 3-4", "TOTAL POZO"])
    rs.cell(4,1,"Total etapas").font=BOLD; rs.cell(4,3,2); rs.cell(4,4,2); rs.cell(4,5,4)
    rs.cell(5,1,"PROPANTE").font=BOLD
    rs.cell(6,1,"Arena Natural 30/140"); rs.cell(6,2,"tn"); rs.cell(6,3,314.6); rs.cell(6,4,360.2); rs.cell(6,5,1349.6)
    rs.cell(7,1,"ppa promedio"); rs.cell(7,2,"ppa"); rs.cell(7,3,1.42); rs.cell(7,4,1.55)
    rs.cell(8,1,"Prop Intensity"); rs.cell(8,2,"lb/ft"); rs.cell(8,3,2010.4); rs.cell(8,4,2301.9); rs.cell(8,5,2156.1)
    rs.cell(9,1,"FLUIDOS").font=BOLD
    rs.cell(10,1,"Slickwater"); rs.cell(10,2,"m³"); rs.cell(10,3,1500); rs.cell(10,4,1700)
    rs.cell(11,1,"TOTAL"); rs.cell(11,2,"m³"); rs.cell(11,3,1848.5); rs.cell(11,4,2105.2); rs.cell(11,5,7907.4)
    rs.cell(12,1,"Fluid Intensity"); rs.cell(12,2,"m³/m"); rs.cell(12,3,33.7); rs.cell(12,4,38.4); rs.cell(12,5,36.0)
    rs.cell(13,1,"PUNZADOS").font=BOLD
    rs.cell(14,1,"Frac Length"); rs.cell(14,2,"m"); rs.cell(14,3,105.15); rs.cell(14,4,105.15); rs.cell(14,5,105.15)
    rs.cell(16,1,"Descripción punzados por grupo:").font=BOLD
    rs.cell(17,1,"Etapas 1-2"); rs.cell(17,2,"Cañón 3 1/8 · 2 tiros · Carga: EHO 45")
    rs.cell(18,1,"Etapas 3-4"); rs.cell(18,2,"Cañón 3 1/8 · 1/2 tiros · Carga: EHO 40")
    for col,w in zip("ABCDE",[26,10,14,14,14]): rs.column_dimensions[col].width=w
    wb.save(path)

# ---------------------------------------------------------------- TALLY CAÑERÍAS
def tally(path):
    wb=openpyxl.Workbook(); ws=wb.active; ws.title="Tally"
    ws.cell(1,1,"PLANTILLA TALLY DE CAÑERÍAS — un .xlsx por pozo, todas las fases. Columnas por encabezado.").font=NOTE
    ws.cell(2,1,"Una fase telescopada usa VARIAS filas (mismo OD, distinto peso/grado por tramo). El zapato = 'Hasta MD' más profundo.").font=NOTE
    _hrow(ws, 4, ["Fase","OD (pulg)","Desde MD (m)","Hasta MD (m)","Peso (lb/ft)","Grado","TOC MD (m)"])
    # (fase, od, desde, hasta, peso, grado, toc)
    demo=[("guia",13.375,0,1200,68,"K55",None),("intermedia1",9.625,0,3000,47,"P110",None),
          ("intermedia2",7.625,0,4500,39,"P110",None),
          ("produccion",5.0,0,3200,18.4,"N80",3390),      # tramo 1: 5" 18.4 N80 hasta el xover
          ("produccion",5.0,3200,6643.1,21.4,"P110",None)]# tramo 2: 5" 21.4 P110 hasta el fondo
    for k,(ph,od,d,h,wt,gr,toc) in enumerate(demo):
        ws.cell(5+k,1,ph); ws.cell(5+k,2,od); ws.cell(5+k,3,d); ws.cell(5+k,4,h); ws.cell(5+k,5,wt); ws.cell(5+k,6,gr)
        if toc is not None: ws.cell(5+k,7,toc)
    r0=12
    ws.cell(r0,1,"Piezas cortas y shoetrack (opcional; tipo = 'corto' o 'shoetrack')").font=BOLD
    _hrow(ws, r0+1, ["Fase","Tipo","Descripción","Tope MD (m)","Fondo MD (m)","Longitud (m)","XOVER"])
    pieces=[("produccion","corto","Pup joint 5\"",2450,2455.87,5.87,"no"),
            ("produccion","corto","X-Over 5\"",3200,3201.10,1.10,"si"),
            ("produccion","shoetrack","Zapato flotador",6642,6643.10,1.10,"no"),
            ("produccion","shoetrack","Collar flotador",6635,6636.20,1.20,"no")]
    for k,p in enumerate(pieces):
        for c,v in enumerate(p): ws.cell(r0+2+k,1+c,v)
    ws.cell(r0+7,1,"Longitud (m): si se deja vacía, se calcula = Fondo − Tope. XOVER: si/no.").font=NOTE
    for col,w in zip("ABCDEFG",[13,11,13,13,13,8,8]): ws.column_dimensions[col].width=w
    wb.save(path)

if __name__=="__main__":
    survey(os.path.join(HERE,"plantilla_survey.xlsx"))
    fracplan(os.path.join(HERE,"plantilla_fracplan.xlsx"))
    tally(os.path.join(HERE,"plantilla_tally_canerias.xlsx"))
    print("plantillas generadas en", HERE)
