import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type LiveRow={snapshot_at:string;source_name:string;source_modified_at:string|null;factory_modified_at:string|null;park_modified_at:string|null};
type BridgeRow={started_at:string;finished_at:string|null;status:string;files_seen:number|string;files_imported:number|string;details:Record<string,unknown>|null};
type InvoiceRow={invoice_date:string;imported_at:string|null};
type BilledRow={work_date:string|null;invoice_date:string|null;imported_at:string|null};
type PresenceRow={work_date:string;source_synced_at:string|null};
type WorkloadRow={snapshot_at:string;observed_at:string|null};
type RhSyncRow={completed_at:string|null;status:string;max_work_date:string|null;rows_saved:number|string|null};

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
async function rest<T>(url:string,key:string,path:string):Promise<T>{const response=await fetch(`${url}/rest/v1/${path}`,{headers:supabaseRestHeaders(key,{Accept:"application/json"}),cache:"no-store"});if(!response.ok)throw new Error(`Supabase ${response.status} · ${path.split("?")[0]}`);return response.json() as Promise<T>;}

export async function GET(){
  const session=await currentSession();
  if(!session)return NextResponse.json({supabase:false,error:"Session CRVO requise."},{status:401,headers:{"Cache-Control":"no-store"}});
  const db=env();
  if(!db)return NextResponse.json({supabase:false,supabaseConfigured:false,error:"Base CRVO non configurée."},{status:503,headers:{"Cache-Control":"no-store"}});
  try{
    const [liveRows,bridgeRows,invoiceRows,billedRows,presenceRows,workloadRows,rhSyncRows]=await Promise.all([
      rest<LiveRow[]>(db.supabaseUrl,db.secretKey,"kpi_ftp_live_dashboard?select=snapshot_at,source_name,source_modified_at,factory_modified_at,park_modified_at&limit=1"),
      rest<BridgeRow[]>(db.supabaseUrl,db.secretKey,"kpi_bridge_runs?select=started_at,finished_at,status,files_seen,files_imported,details&order=started_at.desc&limit=1").catch(()=>[]),
      rest<InvoiceRow[]>(db.supabaseUrl,db.secretKey,"kpi_invoice_facts?select=invoice_date,imported_at&source_name=eq.SQL%20Reporting%20factures%20CRVO&order=invoice_date.desc,imported_at.desc&limit=1"),
      rest<BilledRow[]>(db.supabaseUrl,db.secretKey,"kpi_billed_time_facts?select=work_date,invoice_date,imported_at&source_name=eq.Direct%20Temps%20point%C3%A9%20factur%C3%A9&order=work_date.desc,imported_at.desc&limit=1"),
      rest<PresenceRow[]>(db.supabaseUrl,db.secretKey,"kpi_sql_presence_facts?select=work_date,source_synced_at&source_name=eq.Direct%20Data%20RH&order=work_date.desc,source_synced_at.desc&limit=1"),
      rest<WorkloadRow[]>(db.supabaseUrl,db.secretKey,"kpi_vehicle_workload?select=snapshot_at,observed_at&source_name=eq.SQL%20OR%20encours%20CRVO&order=snapshot_at.desc,observed_at.desc&limit=1"),
      rest<RhSyncRow[]>(db.supabaseUrl,db.secretKey,"kpi_sql_presence_sync_runs?select=completed_at,status,max_work_date,rows_saved&order=completed_at.desc.nullslast&limit=1").catch(()=>[]),
    ]);
    const live=liveRows[0]??null;const bridge=bridgeRows[0]??null;const invoice=invoiceRows[0]??null;const billed=billedRows[0]??null;const presence=presenceRows[0]??null;const workload=workloadRows[0]??null;const rh=rhSyncRows[0]??null;
    return NextResponse.json({
      supabase:true,supabaseConfigured:true,supabaseStatus:"connected",ftpBridge:Boolean(live),sftpBridge:false,
      ftpRefresh:live?{lastRefreshAt:live.source_modified_at??live.factory_modified_at,lastDepositAt:live.park_modified_at??live.source_modified_at,lastDepositFilename:"EtatduParc.csv",filesSeen:Number(bridge?.files_seen??0),filesImported:Number(bridge?.files_imported??0),bridgeStatus:bridge?.status??null}:null,
      readiness:{
        operational:{latestDate:live?.snapshot_at??null,updatedAt:live?.source_modified_at??live?.park_modified_at??null,ready:Boolean(live)},
        finance:{latestDate:invoice?.invoice_date??null,updatedAt:invoice?.imported_at??null,ready:Boolean(invoice)},
        billedTime:{latestDate:billed?.work_date??billed?.invoice_date??null,updatedAt:billed?.imported_at??null,ready:Boolean(billed)},
        rhPresence:{latestDate:presence?.work_date??rh?.max_work_date??null,updatedAt:presence?.source_synced_at??rh?.completed_at??null,ready:Boolean(presence),lastSyncStatus:rh?.status??null},
        workload:{latestDate:workload?.snapshot_at??null,updatedAt:workload?.observed_at??null,ready:Boolean(workload)},
      },
      archiveBucket:"kpi-raw-archive",
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error(JSON.stringify({event:"system_readiness_failed",message:error instanceof Error?error.message:"unknown"}));
    return NextResponse.json({supabase:false,supabaseConfigured:true,supabaseStatus:"unreachable",ftpBridge:false,sftpBridge:false,ftpRefresh:null,error:"Contrôle des sources impossible."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
