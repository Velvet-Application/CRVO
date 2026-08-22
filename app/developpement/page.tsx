export const dynamic = "force-dynamic";

export default function DevelopmentHub(){
  const card={display:"block",padding:24,border:"1px solid #cfe2ed",borderRadius:18,background:"#fff",boxShadow:"0 14px 34px rgba(0,79,159,.08)",textDecoration:"none",color:"inherit"} as const;
  return <main style={{minHeight:"100vh",padding:"86px 28px 40px",background:"linear-gradient(180deg,#eef7fc 0%,#f8fbfd 55%,#fff 100%)",fontFamily:"Exo,Arial,sans-serif",color:"#173447"}}>
    <div style={{maxWidth:1280,margin:"0 auto"}}>
      <header style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"flex-start",marginBottom:28}}>
        <div><span style={{fontSize:10,fontWeight:800,letterSpacing:".12em",color:"#009edb"}}>SAS DE DÉVELOPPEMENT · CRVO LENS</span><h1 style={{margin:"7px 0 8px",fontSize:"clamp(30px,4vw,48px)",color:"#004f9f",fontStyle:"italic"}}>Production · Expertise · PR</h1><p style={{margin:0,maxWidth:850,color:"#668094",lineHeight:1.6}}>Zone de travail isolée pour construire les futurs moteurs opérationnels Toolbox. Les données sources réelles peuvent être reflétées ici sans déclencher d'écriture dans les outils industriels externes.</p></div>
        <a href="/" style={{padding:"11px 15px",border:"1px solid #cfe0e9",borderRadius:10,background:"#fff",color:"#004f9f",fontSize:10,fontWeight:800,textDecoration:"none",whiteSpace:"nowrap"}}>← KPI CRVO</a>
      </header>

      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:18}}>
        <a href="/developpement/production" style={{...card,borderTop:"5px solid #009edb"}}>
          <span style={{fontSize:9,fontWeight:800,letterSpacing:".1em",color:"#009edb"}}>PILOTAGE INDUSTRIEL</span><h2 style={{margin:"9px 0 8px",color:"#004f9f",fontSize:24}}>Production Live</h2><p style={{margin:0,color:"#6e8493",lineHeight:1.55}}>Parc FTP, états regroupés, MPR, RUN, FIFO, recherche multi-OR / immatriculation / VIN et historique dossier.</p><strong style={{display:"inline-block",marginTop:20,color:"#004f9f"}}>OUVRIR LA PRODUCTION →</strong>
        </a>
        <a href="/developpement/expertise" style={{...card,borderTop:"5px solid #fec82f"}}>
          <span style={{fontSize:9,fontWeight:800,letterSpacing:".1em",color:"#b58b00"}}>EXPERTISE · CHIFFRAGE · CLIENT</span><h2 style={{margin:"9px 0 8px",color:"#004f9f",fontSize:24}}>Dossier expertise</h2><p style={{margin:0,color:"#6e8493",lineHeight:1.55}}>Contrôle, photos, dommages, forfaits, validation, soumission au client, choix d'interventions, chat et traçabilité horodatée.</p><strong style={{display:"inline-block",marginTop:20,color:"#004f9f"}}>OUVRIR L'EXPERTISE →</strong>
        </a>
        <a href="/developpement/pr" style={{...card,borderTop:"5px solid #47b9b4"}}>
          <span style={{fontSize:9,fontWeight:800,letterSpacing:".1em",color:"#268f8b"}}>PIÈCES · STOCK · MAGASIN</span><h2 style={{margin:"9px 0 8px",color:"#004f9f",fontSize:24}}>PR / Magasin</h2><p style={{margin:0,color:"#6e8493",lineHeight:1.55}}>Stock transactionnel, PAMP, réservations et débits OR, inventaires tournants, CMM, rotations, forfaits + MO, rabais et préparation Sage.</p><strong style={{display:"inline-block",marginTop:20,color:"#004f9f"}}>OUVRIR LE MODULE PR →</strong>
        </a>
      </section>

      <section style={{marginTop:24,padding:18,borderRadius:14,border:"1px solid #f0d477",background:"#fff9e6",color:"#6d5a12",fontSize:11,lineHeight:1.6}}><strong>Garde-fou SAS :</strong> expertise et PR utilisent des tables dédiées et auditables. Le module PR interdit le stock négatif et ne pousse encore aucune écriture dans Sage ou un DMS externe. Les activations externes seront faites uniquement après validation métier et tests sur données réelles.</section>
    </div>
  </main>;
}
