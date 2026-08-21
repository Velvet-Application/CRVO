import Link from "next/link";
import TransportDecisionMatrix from "../transport-decision-matrix";

export const dynamic = "force-dynamic";

export default function TransphereMatrixPage(){
  return <main style={{minHeight:"100vh",background:"#f3f7fb",padding:"22px"}}>
    <div style={{maxWidth:1600,margin:"0 auto 14px"}}><Link href="/transphere" style={{display:"inline-flex",alignItems:"center",gap:8,textDecoration:"none",fontWeight:800,color:"#0055a5"}}>← Accueil Transphère</Link></div>
    <TransportDecisionMatrix/>
  </main>;
}
