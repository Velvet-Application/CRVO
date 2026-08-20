import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { currentSession } from "../../../lib/crvo-auth";
import { bonusRpc } from "../../../lib/bonus-rpc";
import { buildProrationContext, type ProrationContext, type ProrationRulesPayload } from "../../../lib/bonus-proration";

export const dynamic = "force-dynamic";

type Component = {
  employeeKey:string|null; matricule:string|null; employeeName:string; population:string; jobKey:string;
  sectorLabel:string|null; teamCode:string|null; theoreticalTier:number|null; teamTier:number|null; serviceTier:number|null;
  finalTier:number|null; coefficient:number|null; presenceHours:number|null; billedHours:number|null; absenceHours:number|null;
  absenceRate:number|null; productivity:number|null; individualBaseEur:number|null; individualAmountEur:number|null;
  collectiveAmountEur:number|null; collectiveProration:number|null; exceptionalAmountEur:number|null; totalAmountEur:number|null;
  sourcePayload:Record<string,unknown>; frozen:boolean;
};
type Detail = {
  workflow:{id:string;month:string;status:string;validationMode:string;sourceFilename:string|null;sourceSha256:string|null;audit:Record<string,unknown>;currentAudit:Record<string,unknown>;totals:Record<string,unknown>;frozenHash:string|null};
  components:Component[];
  manualInputs?:Array<{scopeType:string;scopeKey:string;inputKey:string;numericValue:number|null}>;
};

async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}
function eur(value:number|null){return value == null ? null : Number(value.toFixed(2));}
function pct(value:number|null){return value == null ? null : Number((value*100).toFixed(2));}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return NextResponse.json({error:"Session CRVO requise."},{status:401});
  if(current.session.role!=="admin")return NextResponse.json({error:"Export paie réservé à la Direction / administration."},{status:403});
  try{
    const url=new URL(request.url);const workflowId=url.searchParams.get("workflowId");
    if(!workflowId)return NextResponse.json({error:"Workflow manquant."},{status:400});
    const detail=await bonusRpc<Detail>("kpi_bonus_get_workflow",{p_session_hash:current.tokenHash,p_workflow_id:workflowId});
    if(!["closed","legacy_closed"].includes(detail.workflow.status))return NextResponse.json({error:"L'export paie est disponible uniquement après clôture."},{status:409});

    let proration:ProrationContext|null=null;
    try{
      const rules=await bonusRpc<ProrationRulesPayload>("kpi_bonus_proration_rules_read",{p_session_hash:current.tokenHash,p_workflow_id:workflowId});
      proration=buildProrationContext(detail,rules);
    }catch(error){
      console.error("bonus_proration_export_fallback",error);
    }
    const prorationMap=new Map((proration?.components??[]).map(item=>[item.employeeKey,item]));
    const legacy=detail.workflow.validationMode==="legacy_excel";
    const rows=detail.components.map(c=>{
      const p=c.employeeKey?prorationMap.get(c.employeeKey):null;
      const individualPaid=p?.individualAfterEur??c.individualAmountEur;
      const collectiveFactor=p?.collectiveFactor??c.collectiveProration;
      const collectivePaid=p?.collectiveAfterEur??(c.collectiveAmountEur==null||c.collectiveProration==null?null:c.collectiveAmountEur*c.collectiveProration);
      const totalPaid=p?.totalAfterEur??c.totalAmountEur;
      const events=p?.events.map(event=>`${event.label}: ${event.days.toFixed(2)}j [ind ${event.individualEffectiveMode}${event.individualThresholdDays?` >${event.individualThresholdDays}j`:""}; coll ${event.collectiveEffectiveMode}${event.collectiveThresholdDays?` >${event.collectiveThresholdDays}j`:""}]`).join(" | ")??"";
      return {
        Mois:detail.workflow.month,Matricule:c.matricule,Collaborateur:c.employeeName,Population:c.population,Métier:c.jobKey,Secteur:c.sectorLabel,Équipe:c.teamCode,
        "Heures présence":c.presenceHours,"Heures facturées":c.billedHours,"Heures absence":c.absenceHours,"Rendement %":pct(c.productivity),"Absentéisme %":pct(c.absenceRate),
        "Palier théorique":c.theoreticalTier,"Palier chef équipe":c.teamTier,"Palier chef service":c.serviceTier,"Palier final":c.finalTier,Coefficient:c.coefficient,
        "Base individuelle €":eur(c.individualBaseEur),"Prime individuelle avant règles RH €":eur(c.individualAmountEur),"Facteur individuel RH %":pct(p?.individualFactor??1),"Prime individuelle payée €":eur(individualPaid),
        "Collectif brut €":eur(c.collectiveAmountEur),"Prorata collectif historique %":pct(c.collectiveProration),"Facteur collectif / sortie usine RH %":pct(collectiveFactor),"Collectif payé €":eur(collectivePaid),
        "Exception €":eur(c.exceptionalAmountEur),"TOTAL avant règles RH €":eur(c.totalAmountEur),"Impact règles RH €":p?eur(p.totalImpactEur):0,"TOTAL À PAYER €":eur(totalPaid),
        "Événements RH et règles":events,Figé:c.frozen?"OUI":"NON","Commentaire source":String(c.sourcePayload?.sourceComment??""),Source:proration?"KPI CRVO + Data RH + règles mensuelles figées":detail.workflow.sourceFilename??"KPI CRVO"
      };
    });
    const auditRows:(string|number|null)[][]=[
      ["Mois",detail.workflow.month],["Statut",detail.workflow.status],["Mode",detail.workflow.validationMode],["Fichier source",detail.workflow.sourceFilename??""],["SHA source",detail.workflow.sourceSha256??""],["Empreinte clôture",detail.workflow.frozenHash??""],["Nombre de lignes",rows.length],
      ["Moteur de proratisation RH",proration?"ACTIF - règles mensuelles + événements Data RH":"INDISPONIBLE - export basé sur le calcul historique"],["Jours ouvrés utilisés",proration?.workingDays??null],["Source jours ouvrés",proration?.workingDaysSource??""],["Nombre de règles",proration?.rules.length??0],["Calcul proratisation horodaté",proration?.calculatedAt??""],
      ["Référence juillet",legacy?"OUI - historique Excel figé, non export paie natif":"NON"],["Montants juillet",legacy?"NON DÉTERMINABLES : collectif BIMESTRE et bases € absentes du classeur":"Calcul natif KPI CRVO"],
      ["Audit figé",JSON.stringify(detail.workflow.audit??{})],["Audit courant",JSON.stringify(detail.workflow.currentAudit??{})],["Totaux figés",JSON.stringify(detail.workflow.totals??{})]
    ];
    const wb=XLSX.utils.book_new();const payroll=XLSX.utils.json_to_sheet(rows);payroll["!autofilter"]={ref:payroll["!ref"]??"A1:A1"};const audit=XLSX.utils.aoa_to_sheet([["AUDIT EXPORT PAIE","VALEUR"],...auditRows]);
    payroll["!cols"]=[{wch:11},{wch:13},{wch:28},{wch:14},{wch:22},{wch:22},{wch:9},{wch:16},{wch:17},{wch:15},{wch:14},{wch:15},{wch:15},{wch:18},{wch:20},{wch:12},{wch:12},{wch:18},{wch:22},{wch:20},{wch:22},{wch:18},{wch:24},{wch:28},{wch:19},{wch:13},{wch:22},{wch:18},{wch:18},{wch:22},{wch:62},{wch:8},{wch:34},{wch:36}];audit["!cols"]=[{wch:30},{wch:115}];
    XLSX.utils.book_append_sheet(wb,payroll,"PAIE");XLSX.utils.book_append_sheet(wb,audit,"AUDIT");
    const raw=XLSX.write(wb,{type:"array",bookType:"xlsx"}) as ArrayBuffer;const bytes=new Uint8Array(raw);const hash=await sha256(bytes);
    await bonusRpc("kpi_bonus_record_export",{p_session_hash:current.tokenHash,p_workflow_id:workflowId,p_export_type:"payroll_xlsx",p_employee_key:null,p_sha256:hash,p_metadata:{rows:rows.length,month:detail.workflow.month,legacy_reference:legacy,proration_engine:Boolean(proration)}});
    const filename=`KPI_CRVO_Primes_${detail.workflow.month}_${detail.workflow.status}.xlsx`;
    return new NextResponse(bytes,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}"`,"X-CRVO-Export-SHA256":hash,"Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Export impossible."},{status:400});}
}
