"use client";

import {useEffect,useRef,useState} from "react";

type Claim={id:string;claim_number:string;registration:string;status:string;updated_at:string};
type Message={id:number;author_role:"NETWORK"|"CRVO";author_name:string|null;body:string;created_at:string};
type Dashboard={claims:Claim[];detail?:{claim:Claim;messages:Message[]}|null};
type Toast={title:string;message:string;claimId?:string};

export default function NetworkQualityLive({token}:{token:string}){
  const apiRoot=`/api/quality-claims/client/${encodeURIComponent(token)}`;
  const[toast,setToast]=useState<Toast|null>(null);
  const baseline=useRef<Map<string,string>|null>(null);
  const seenMessages=useRef<Map<string,number>>(new Map());

  useEffect(()=>{
    let dead=false;
    async function poll(){
      if(document.visibilityState!=="visible")return;
      try{
        const r=await fetch(`${apiRoot}?_=${Date.now()}`,{cache:"no-store"});if(!r.ok)return;
        const p=await r.json() as Dashboard;
        const next=new Map((p.claims??[]).map(c=>[c.id,c.updated_at]));
        if(!baseline.current){baseline.current=next;return;}
        const changed=(p.claims??[]).filter(c=>baseline.current?.get(c.id)!==c.updated_at);
        baseline.current=next;
        for(const claim of changed.slice(0,3)){
          const d=await fetch(`${apiRoot}?claimId=${encodeURIComponent(claim.id)}&_=${Date.now()}`,{cache:"no-store"});if(!d.ok)continue;
          const detail=(await d.json() as Dashboard).detail;if(!detail)continue;
          const last=[...(detail.messages??[])].sort((a,b)=>a.id-b.id).at(-1);
          const previous=seenMessages.current.get(claim.id)??0;
          if(last)seenMessages.current.set(claim.id,last.id);
          if(last&&last.author_role==="CRVO"&&last.id>previous){setToast({title:"Nouveau message du CRVO",message:`${claim.registration} · ${last.body.slice(0,120)}`,claimId:claim.id});break}
          setToast({title:"Votre dossier a été mis à jour",message:`${claim.registration} · ${claim.claim_number}`,claimId:claim.id});break;
        }
      }catch{}
    }
    void poll();const timer=window.setInterval(()=>{if(!dead)void poll()},12000);return()=>{dead=true;window.clearInterval(timer)};
  },[apiRoot]);

  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(null),7000);return()=>window.clearTimeout(timer)},[toast]);
  if(!toast)return null;
  return <div role="status" aria-live="polite" style={{position:"fixed",left:"50%",bottom:20,transform:"translateX(-50%)",zIndex:12000,width:"min(520px,calc(100vw - 24px))",boxSizing:"border-box",display:"grid",gridTemplateColumns:"42px 1fr auto",gap:11,alignItems:"center",padding:"13px 14px",border:"1px solid #b9dceb",borderRadius:17,background:"rgba(255,255,255,.97)",boxShadow:"0 18px 55px rgba(0,64,104,.2)",backdropFilter:"blur(12px)",fontFamily:"Exo,Arial,sans-serif"}}>
    <div style={{display:"grid",placeItems:"center",width:40,height:40,borderRadius:12,background:"linear-gradient(145deg,#004f9f,#009edb)",color:"white",fontWeight:900,fontSize:10}}>RQ</div>
    <div><strong style={{display:"block",color:"#173b52",fontSize:13}}>{toast.title}</strong><span style={{display:"block",marginTop:3,color:"#637b8d",fontSize:9,lineHeight:1.4}}>{toast.message}</span></div>
    <button onClick={()=>setToast(null)} style={{border:0,background:"transparent",color:"#667d8e",fontSize:20,cursor:"pointer"}}>×</button>
  </div>;
}
