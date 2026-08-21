"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import styles from "./internal-chat.module.css";

type User={id:string;displayName:string;username:string;role:string;accessProfile:string;lastLoginAt:string|null};
type Participant={id:string;displayName:string;role?:string;accessProfile?:string};
type LinkedClaim={id:string;claimNumber:string;registration:string;client:string;category:string;status:string};
type Message={id:number;authorUserId:string;authorName:string;body:string|null;createdAt:string;linkedClaim:LinkedClaim|null};
type Thread={id:string;kind:string;title:string;updatedAt:string;lastMessage:string|null;lastMessageAt:string|null;unread:number;participants:Participant[]};
type Detail={id:string;kind:string;title:string;participants:Participant[];messages:Message[]};
type Snapshot={context:{userId:string;displayName:string};users:User[];threads:Thread[];detail:Detail|null};
type Claim={id:string;claim_number:string;registration:string;client_name:string;category:string;status:string;declared_at:string};
type ClaimPayload={claims:Claim[]};

function dt(v:string|null|undefined){if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d)}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"CR"}

export default function InternalChat({sessionName}:{sessionName:string}){
  const[data,setData]=useState<Snapshot|null>(null),[active,setActive]=useState<string|null>(null),[search,setSearch]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const[claimPicker,setClaimPicker]=useState(false),[claims,setClaims]=useState<Claim[]>([]),[claimSearch,setClaimSearch]=useState(""),[selectedClaim,setSelectedClaim]=useState<Claim|null>(null);
  const bottomRef=useRef<HTMLDivElement|null>(null);

  async function api<T>(url:string,init?:RequestInit){const r=await fetch(url,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(p.error||"Service indisponible"));return p as T}
  async function load(thread=active,quiet=false){try{if(!quiet)setBusy(true);const q=thread?`?thread=${encodeURIComponent(thread)}&_=${Date.now()}`:`?_=${Date.now()}`;const p=await api<Snapshot>(`/api/internal-chat${q}`);setData(p);setError("");if(thread&&p.detail){void api("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"read",threadId:thread})}).catch(()=>null)}}catch(e){setError(e instanceof Error?e.message:"Messagerie indisponible.")}finally{if(!quiet)setBusy(false)}}
  useEffect(()=>{const q=new URLSearchParams(location.search);const thread=q.get("thread");if(thread)setActive(thread);void load(thread,false)},[]);
  useEffect(()=>{const timer=window.setInterval(()=>void load(active,true),active?5000:12000);return()=>window.clearInterval(timer)},[active]);
  useEffect(()=>{if(data?.detail)requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}))},[data?.detail?.messages.length]);

  const filteredThreads=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.threads??[]).filter(t=>!q||`${t.title} ${t.lastMessage??""}`.toLowerCase().includes(q))},[data,search]);
  const filteredUsers=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.users??[]).filter(u=>q&&`${u.displayName} ${u.username}`.toLowerCase().includes(q)).slice(0,12)},[data,search]);
  const filteredClaims=useMemo(()=>{const q=claimSearch.trim().toLowerCase();return claims.filter(c=>!q||`${c.registration} ${c.claim_number} ${c.client_name}`.toLowerCase().includes(q)).slice(0,80)},[claims,claimSearch]);

  async function openThread(id:string){setActive(id);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(id)}`);await load(id,false)}
  async function startDirect(peer:string){setBusy(true);try{const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"startDirect",peerUserId:peer})});setData(p);if(p.detail){setActive(p.detail.id);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(p.detail.id)}`)}setSearch("")}catch(e){setError(e instanceof Error?e.message:"Conversation impossible.")}finally{setBusy(false)}}
  async function send(){if(!active||(!message.trim()&&!selectedClaim))return;setBusy(true);try{const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"send",threadId:active,message:message.trim()||null,linkedClaimId:selectedClaim?.id||null})});setData(p);setMessage("");setSelectedClaim(null);setClaimPicker(false)}catch(e){setError(e instanceof Error?e.message:"Message non envoyé.")}finally{setBusy(false)}}
  async function openClaimPicker(){setClaimPicker(true);setClaimSearch("");if(claims.length)return;try{const today=new Date().toISOString().slice(0,10);const p=await api<ClaimPayload>(`/api/quality-claims-v2?dateFrom=2026-01-01&dateTo=${today}&_=${Date.now()}`);setClaims(p.claims??[])}catch{setClaims([])}}

  const detail=data?.detail;
  return <main className={styles.page}>
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${detail?styles.sidebarHiddenMobile:""}`}>
        <div className={styles.brand}><div>CRVO</div><span><strong>Messagerie interne</strong><small>{sessionName}</small></span></div>
        <label className={styles.search}><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une conversation ou un collègue…"/></label>
        {filteredUsers.length>0&&<div className={styles.people}><b>NOUVELLE CONVERSATION</b>{filteredUsers.map(u=><button key={u.id} onClick={()=>void startDirect(u.id)}><i>{initials(u.displayName)}</i><span><strong>{u.displayName}</strong><small>{u.accessProfile||u.role}</small></span><em>+</em></button>)}</div>}
        <div className={styles.threadList}>{filteredThreads.map(t=><button key={t.id} onClick={()=>void openThread(t.id)} className={active===t.id?styles.selected:""}><i>{initials(t.title)}</i><span><strong>{t.title}</strong><small>{t.lastMessage||"Nouvelle conversation"}</small></span><time>{dt(t.lastMessageAt||t.updatedAt)}{t.unread>0&&<b>{t.unread>99?"99+":t.unread}</b>}</time></button>)}{!filteredThreads.length&&!search&&<p className={styles.empty}>Aucune conversation. Recherchez le nom d’un collègue pour commencer.</p>}</div>
      </aside>

      <section className={styles.chatPane}>
        {error&&<div className={styles.error}>{error}<button onClick={()=>setError("")}>×</button></div>}
        {detail?<><header className={styles.chatHead}><button className={styles.mobileBack} onClick={()=>{setActive(null);history.replaceState(null,"","/messagerie");setData(d=>d?{...d,detail:null}:d)}}>←</button><i>{initials(detail.title)}</i><div><strong>{detail.title}</strong><small>{detail.participants.map(p=>p.displayName).join(" · ")}</small></div><span>INTERNE CRVO</span></header>
          <div className={styles.messages}>{detail.messages.map(m=>{const mine=m.authorUserId===data?.context.userId;return <div key={m.id} className={`${styles.messageRow} ${mine?styles.mine:""}`}><div className={styles.bubble}>{!mine&&<b>{m.authorName}</b>}{m.body&&<p>{m.body}</p>}{m.linkedClaim&&<a className={styles.claimCard} href={`/reclamations-qualite?claimId=${encodeURIComponent(m.linkedClaim.id)}`}><span>DOSSIER RÉCLAMATION</span><strong>{m.linkedClaim.registration}</strong><small>{m.linkedClaim.claimNumber} · {m.linkedClaim.client}</small><em>{m.linkedClaim.category} · {m.linkedClaim.status}</em></a>}<time>{dt(m.createdAt)}</time></div></div>})}<div ref={bottomRef}/></div>
          {selectedClaim&&<div className={styles.attached}><span>DOSSIER JOINT</span><strong>{selectedClaim.registration}</strong><small>{selectedClaim.claim_number} · {selectedClaim.client_name}</small><button onClick={()=>setSelectedClaim(null)}>×</button></div>}
          <div className={styles.composer}><button title="Partager une réclamation" onClick={()=>void openClaimPicker()}>＋</button><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="Écrire un message…"/><button className={styles.send} disabled={busy||(!message.trim()&&!selectedClaim)} onClick={()=>void send()}>➤</button></div>
        </>:<div className={styles.welcome}><div>CRVO</div><h1>Messagerie interne</h1><p>Échangez directement entre utilisateurs de la Toolbox et partagez un dossier Réclamation sans quitter votre environnement de travail.</p><small>Recherchez un collègue à gauche pour démarrer.</small></div>}
      </section>
    </div>

    {claimPicker&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.currentTarget===e.target)setClaimPicker(false)}}><div className={styles.modal}><header><div><span>PARTAGER DANS LA CONVERSATION</span><h2>Choisir une réclamation</h2></div><button onClick={()=>setClaimPicker(false)}>×</button></header><input autoFocus value={claimSearch} onChange={e=>setClaimSearch(e.target.value)} placeholder="Immatriculation, numéro de dossier, client…"/><div className={styles.claimPicker}>{filteredClaims.map(c=><button key={c.id} onClick={()=>{setSelectedClaim(c);setClaimPicker(false)}}><div><strong>{c.registration}</strong><span>{c.claim_number} · {c.client_name}</span><small>{c.category}</small></div><em>JOINDRE</em></button>)}{!filteredClaims.length&&<p>Vous n’avez pas accès à une liste de réclamations partageables, ou aucun dossier ne correspond à la recherche.</p>}</div></div></div>}
  </main>;
}
