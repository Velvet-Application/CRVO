import Link from "next/link";
import PrWorkspace from "./pr-workspace";

export const dynamic = "force-dynamic";

export default function DevelopmentPrPage(){
  return <>
    <div style={{position:"fixed",zIndex:110,top:54,right:18}}><Link href="/developpement/pr/import" style={{display:"inline-flex",padding:"9px 12px",borderRadius:10,background:"#004f9f",color:"#fff",font:"900 9px Exo,Arial,sans-serif",letterSpacing:".04em",textDecoration:"none",boxShadow:"0 8px 20px rgba(0,79,159,.2)"}}>IMPORTER RÉFÉRENTIEL</Link></div>
    <PrWorkspace/>
  </>;
}
