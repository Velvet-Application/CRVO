"use client";

import { FormEvent,useEffect,useMemo,useState } from "react";
import { usePathname } from "next/navigation";
type Person={employeeKey:string;name:string;team?:string|null;sector?:string|null;service?:string|null};
type Wt={entity:"CRVO"|"TRANSPHERE";people:Person[];access:{canClose:boolean;role:string;profile:string}};
type Row={id:string;employeeKey:string;employeeName:string;team?:string|null;sector?:string|null;workDate:string;hours:number;comment?:string|null;status:"open"|"closed";createdBy:string;createdAt:string;closedBy?:string|null};
type Annual={rows:Row[];balances:Array<{employeeKey:string;employeeName:string;balanceHours:number}>};
function today(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function fmt(v:number){return `${v>0?"+":""}${new Intl.NumberFormat("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)} h`}
export default function WorktimeAnnualizationPanel(){
  const path=usePathname();
  const[open,setOpen]=useState(false);
  const[wt,setWt]=useState<Wt|null>(null);
  const[data,setData]=useState<Annual>({rows:[],balances:[]});
  const[person,setPerson]=useState("");
  const[date,setDate]=useState(today());
  const[hours,setHours]=useState("1");
  const[sign,setSign]=useState<1|-1>(1);
  const[comment,setComment]=useState("");
  const[search,setSearch]=useState("");
  const[msg,setMsg]=useState("");
  const[error,setError]=useState("");

  async function load(){
    if(path!=="/temps-travail")return;
    const d=today();
    const r=await fetch(`/api/worktime?from=${d}&to=${d}`,{cache:"no-store"});
    if(!r.ok)return;
    const p=await r.json() as Wt;
    setWt(p);
    const a=await fetch(`/api/worktime/annualization?entity=${p.entity}&from=2026-01-01&to=2026-12-31`,{cache:"no-store"});
    if(a.ok)setData(await a.json() as Annual);
  }

  useEffect(()=>{void load()},[path]);

  // Hooks must always run in the same order, including before the worktime payload arrives.
  const balance=useMemo(()=>new Map(data.balances.map(b=>[b.employeeKey,Number(b.balanceHours)])),[data]);
  const people=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (wt?.people??[]).filter(p=>!q||`${p.name} ${p.team??""} ${p.sector??""} ${p.service??""}`.toLowerCase().includes(q));
  },[wt,search]);

  if(path!=="/temps-travail"||!wt)return null;

  async function submit(e:FormEvent){e.preventDefault();setError("");setMsg("");const value=Math.abs(Number(hours))*sign;if(!person||!Number.isFinite(value)||value===0){setError("Collaborateur et volume d'heures requis.");return}const r=await fetch("/api/worktime/annualization",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({entity:wt.entity,employeeKey:person,workDate:date,hours:value,comment})});const p=await r.json().catch(()=>({})) as {error?:string};if(!r.ok){setError(p.error||"Enregistrement impossible.");return}setMsg(`Annualisation ${fmt(value)} enregistrée.`);setComment("");await load()}
  async function status(row:Row,action:"close"|"reopen"|"cancel"){const r=await fetch("/api/worktime/annualization",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.id,action})});const p=await r.json().catch(()=>({})) as {error?:string};if(!r.ok){setError(p.error||"Action impossible.");return}await load()}
  async function exportXls(){const XLSX=await import("@e965/xlsx");const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.rows.map(r=>({Date:r.workDate,Collaborateur:r.employeeName,Équipe:r.team??"",Secteur:r.sector??"",Heures:r.hours,Type:r.hours>0?"Crédit":"Débit",Commentaire:r.comment??"",Statut:r.status,Déclaré_par:r.createdBy,Clôturé_par:r.closedBy??""}))),"Annualisation");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.balances.map(b=>({Collaborateur:b.employeeName,"Solde heures":b.balanceHours}))),"Soldes");XLSX.writeFile(wb,`Annualisation_${wt.entity}_${today()}.xlsx`)}

  return <><button className="annual-launch" onClick={()=>setOpen(true)}><span>±</span> ANNUALISATION</button>{open&&<div className="annual-back" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="annual-drawer"><header><div><span>TEMPS DE TRAVAIL</span><h2>Annualisation ±</h2><p>Créditer ou débiter des heures avec historique et verrouillage RH.</p></div><button onClick={()=>setOpen(false)}>×</button></header>{error&&<div className="annual-error">{error}</div>}{msg&&<div className="annual-ok">{msg}</div>}<form onSubmit={submit}><label>RECHERCHER<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, équipe, secteur…"/></label><label>COLLABORATEUR<select value={person} onChange={e=>setPerson(e.target.value)} required><option value="">Choisir…</option>{people.map(p=><option value={p.employeeKey} key={p.employeeKey}>{p.name} · {p.team??"—"} · {p.sector??p.service??"—"} · solde {fmt(balance.get(p.employeeKey)??0)}</option>)}</select></label><div className="annual-line"><label>DATE<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>SENS<select value={sign} onChange={e=>setSign(Number(e.target.value) as 1|-1)}><option value="1">+ Créditer</option><option value="-1">- Déduire</option></select></label><label>HEURES<input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={e=>setHours(e.target.value)}/></label></div><label>COMMENTAIRE<textarea rows={2} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Motif / information RH…"/></label><button className="annual-save">ENREGISTRER {sign>0?"LE CRÉDIT":"LE DÉBIT"}</button></form><div className="annual-tools"><strong>HISTORIQUE ANNUALISATION</strong><button onClick={()=>void exportXls()}>EXPORT XLS</button></div><div className="annual-list">{data.rows.slice(0,80).map(r=><div key={r.id}><div><strong>{r.employeeName}</strong><span>{r.workDate} · {r.comment||"Sans commentaire"} · {r.createdBy}</span></div><b className={r.hours>=0?"plus":"minus"}>{fmt(Number(r.hours))}</b><em>{r.status==="closed"?"CLÔTURÉ RH":"OUVERT"}</em><div className="annual-actions">{wt.access.canClose?(r.status==="open"?<button onClick={()=>void status(r,"close")}>Clôturer</button>:<button onClick={()=>void status(r,"reopen")}>Réouvrir</button>):r.status==="open"?<button onClick={()=>void status(r,"cancel")}>Annuler</button>:null}</div></div>)}</div></section></div>}<style>{`.annual-launch{position:fixed;z-index:205;right:24px;bottom:24px;height:44px;padding:0 15px;border:0;border-radius:12px;background:#004f9f;color:#fff;box-shadow:0 12px 28px rgba(0,55,106,.22);font:800 8px Exo,Arial,sans-serif;letter-spacing:.06em}.annual-launch span{margin-right:6px;color:#86e0ff;font-size:16px}.annual-back{position:fixed;z-index:2700;inset:0;background:rgba(9,34,52,.46);display:flex;justify-content:flex-end}.annual-drawer{width:min(620px,96vw);height:100%;overflow:auto;padding:22px;background:#f7fbfd;color:#163e58;font-family:Exo,Arial,sans-serif;box-shadow:-20px 0 50px rgba(0,32,65,.2)}.annual-drawer header{display:flex;justify-content:space-between}.annual-drawer header span{font-size:8px;color:#009edb;font-weight:800}.annual-drawer h2{margin:3px 0;color:#004f9f;font-size:27px;font-style:italic}.annual-drawer header p{margin:0;color:#788d9a;font-size:9px}.annual-drawer header button{width:34px;height:34px;border:0;border-radius:9px;background:#e5eff5;color:#004f9f;font-size:20px}.annual-drawer form{display:grid;gap:9px;margin-top:17px;padding:14px;border:1px solid #d6e4ec;border-radius:14px;background:#fff}.annual-drawer label{display:grid;gap:4px;color:#718693;font-size:7px;font-weight:800}.annual-drawer input,.annual-drawer select,.annual-drawer textarea{border:1px solid #cadce6;border-radius:8px;background:#fbfdfe;color:#173e57;font:600 10px Exo,Arial,sans-serif}.annual-drawer input,.annual-drawer select{height:39px;padding:0 9px}.annual-drawer textarea{padding:9px}.annual-line{display:grid;grid-template-columns:1fr 1fr .8fr;gap:8px}.annual-save{height:41px;border:0;border-radius:9px;background:#004f9f;color:#fff;font:800 8px Exo,Arial,sans-serif}.annual-tools{display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px}.annual-tools strong{font-size:9px;color:#004f9f}.annual-tools button{height:32px;border:1px solid #cbdce5;border-radius:8px;background:#fff;color:#004f9f;font:800 7px Exo,Arial,sans-serif}.annual-list{display:grid;gap:6px}.annual-list>div{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid #dce7ed;border-radius:9px;background:#fff}.annual-list strong,.annual-list span{display:block}.annual-list strong{font-size:9px}.annual-list span{margin-top:2px;color:#80929e;font-size:7px}.annual-list b{font-size:12px;font-style:italic}.annual-list b.plus{color:#23846b}.annual-list b.minus{color:#d55751}.annual-list em{font-size:6px;color:#6f8491;font-style:normal;font-weight:800}.annual-actions button{border:1px solid #d2e0e8;border-radius:6px;background:#fff;color:#004f9f;font:800 6px Exo,Arial,sans-serif;padding:6px}.annual-error,.annual-ok{margin-top:10px;padding:9px;border-radius:8px;font-size:8px}.annual-error{background:#ffe8e6;color:#a6433e}.annual-ok{background:#e7f7f1;color:#267a62}@media(max-width:650px){.annual-line{grid-template-columns:1fr}.annual-list>div{grid-template-columns:1fr auto}.annual-actions{grid-column:1/-1}}`}</style></>}
