"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import styles from "./internal-chat.module.css";
import media from "./internal-chat-media.module.css";
import mentions from "./internal-chat-mentions.module.css";

type User={id:string;displayName:string;username:string;role:string;accessProfile:string;lastLoginAt:string|null;hasAvatar?:boolean;avatarUpdatedAt?:string|null;positionLevel?:string|null;positionTitle?:string|null};
type Participant={id:string;displayName:string;role?:string;accessProfile?:string;hasAvatar?:boolean;avatarUpdatedAt?:string|null};
type LinkedClaim={id:string;claimNumber:string;registration:string;client:string;category:string;status:string};
type LinkedVehicle={id:string;registration:string;registrationNorm?:string;workOrder:string|null;vin:string|null;model:string|null;client:string|null;status:string|null;statusAt:string|null;statusAgeDays:number|null;factoryAgeDays:number|null;mileage:number|null;alert:string|null;urgency:string|null;snapshotAt:string|null;sourceModifiedAt:string|null;mechanics?:string|null;bodywork?:string|null;technicalControl?:string|null;dsp?:string|null;wheels?:string|null;partAvailable?:string|null;partOrderedDays?:number|null};
type ChatAttachment={id:string;fileName:string;mimeType:string;sizeBytes:number;createdAt:string};
type Message={id:number;authorUserId:string;authorName:string;body:string|null;createdAt:string;linkedClaim:LinkedClaim|null;linkedVehicle?:LinkedVehicle|null;attachments?:ChatAttachment[]};
type Thread={id:string;kind:string;title:string;updatedAt:string;lastMessage:string|null;lastMessageAt:string|null;unread:number;participants:Participant[]};
type Detail={id:string;kind:string;title:string;participants:Participant[];messages:Message[]};
type Snapshot={context:{userId:string;displayName:string;hasAvatar?:boolean;avatarUpdatedAt?:string|null};users:User[];threads:Thread[];detail:Detail|null};
type Claim={id:string;claim_number:string;registration:string;client_name:string;category:string;status:string;declared_at:string};
type ClaimPayload={claims:Claim[]};
type VehiclePayload={vehicles:LinkedVehicle[]};
type VehicleDetailPayload={vehicle:LinkedVehicle};
type UploadPayload={fileName:string;mimeType:string;sizeBytes:number;fileData:string};
type MentionChoice=
  |{kind:"role";token:string;title:string;subtitle:string;count:number;icon:string}
  |{kind:"claim";token:string;title:string;subtitle:string;claim:Claim;icon:string}
  |{kind:"vehicle";token:string;title:string;subtitle:string;vehicle:LinkedVehicle;icon:string};

const EMOJIS=["😀","😄","😂","😊","😉","😍","🥳","😎","🤝","👍","👏","🙏","👌","💪","✅","⚠️","❓","💡","🚗","🔧","📷","📎","🔥","❤️","🎯","🚀","👀","🙌","😅","🤔","😬","😢"];
const FILE_ACCEPT="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
function dt(v:string|null|undefined){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d)}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"CR"}
function sizeLabel(bytes:number){if(bytes<1024)return`${bytes} o`;if(bytes<1048576)return`${Math.round(bytes/1024)} Ko`;return`${(bytes/1048576).toLocaleString("fr-FR",{maximumFractionDigits:1})} Mo`}
function kmLabel(value:number|null|undefined){const n=Number(value);return Number.isFinite(n)&&n>0?`${Math.round(n).toLocaleString("fr-FR")} km`:"—"}
function ageLabel(value:number|null|undefined){const n=Number(value);if(!Number.isFinite(n))return"—";if(n<1)return`${Math.max(0,Math.round(n*24))} h`;return`${n.toLocaleString("fr-FR",{maximumFractionDigits:1})} j`}
function avatarUrl(id:string,updated?:string|null,version?:number){return`/api/internal-chat?avatarUserId=${encodeURIComponent(id)}&v=${encodeURIComponent(updated||String(version||0))}`}
function attachmentUrl(id:string){return`/api/internal-chat?attachmentId=${encodeURIComponent(id)}`}
function normalizeText(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}
function currentMention(value:string){const match=value.match(/(?:^|\s)@([A-Za-zÀ-ÿ0-9_-]*)$/);if(!match)return null;return{fragment:match[1]||"",start:value.lastIndexOf("@")}}
async function blobBase64(blob:Blob){return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const s=String(r.result??"");resolve(s.includes(",")?s.slice(s.indexOf(",")+1):s)};r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}
async function attachmentPayload(file:File):Promise<UploadPayload>{return{fileName:file.name,mimeType:file.type||"application/octet-stream",sizeBytes:file.size,fileData:await blobBase64(file)}}
async function avatarPayload(file:File){
  if(!file.type.startsWith("image/"))throw new Error("Choisissez une image pour votre photo de profil.");
  try{
    const bitmap=await createImageBitmap(file);const max=512;const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");if(!ctx)throw new Error("canvas");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("compression")),"image/jpeg",.86));return{mimeType:"image/jpeg",sizeBytes:blob.size,fileData:await blobBase64(blob)};
  }catch{
    if(file.size>2621440)throw new Error("La photo est trop volumineuse. Choisissez une image de moins de 2,5 Mo.");
    return{mimeType:file.type,sizeBytes:file.size,fileData:await blobBase64(file)};
  }
}

function Avatar({id,name,updated,version=0}:{id:string;name:string;updated?:string|null;version?:number}){
  const[failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[id,updated,version]);
  return <i className={media.avatar}>{!failed&&<img src={avatarUrl(id,updated,version)} alt="" onError={()=>setFailed(true)}/>} {failed&&initials(name)}</i>;
}

export default function InternalChat({sessionName}:{sessionName:string}){
  const[data,setData]=useState<Snapshot|null>(null),[active,setActive]=useState<string|null>(null),[search,setSearch]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const[claimPicker,setClaimPicker]=useState(false),[claims,setClaims]=useState<Claim[]>([]),[claimSearch,setClaimSearch]=useState(""),[selectedClaim,setSelectedClaim]=useState<Claim|null>(null),[claimsLoading,setClaimsLoading]=useState(false);
  const[vehicleResults,setVehicleResults]=useState<LinkedVehicle[]>([]),[vehicleSearchLoading,setVehicleSearchLoading]=useState(false),[vehicleDetail,setVehicleDetail]=useState<LinkedVehicle|null>(null),[vehicleDetailLoading,setVehicleDetailLoading]=useState(false);
  const[pendingFiles,setPendingFiles]=useState<File[]>([]),[emojiOpen,setEmojiOpen]=useState(false),[preview,setPreview]=useState<ChatAttachment|null>(null),[avatarVersion,setAvatarVersion]=useState(0),[avatarBusy,setAvatarBusy]=useState(false);
  const bottomRef=useRef<HTMLDivElement|null>(null),fileRef=useRef<HTMLInputElement|null>(null),avatarRef=useRef<HTMLInputElement|null>(null);

  async function api<T>(url:string,init?:RequestInit){const r=await fetch(url,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(p.error||"Service indisponible"));return p as T}
  async function load(thread=active,quiet=false){try{if(!quiet)setBusy(true);const q=thread?`?thread=${encodeURIComponent(thread)}&_=${Date.now()}`:`?_=${Date.now()}`;const p=await api<Snapshot>(`/api/internal-chat${q}`);setData(p);setError("");if(thread&&p.detail){void api("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"read",threadId:thread})}).catch(()=>null)}}catch(e){setError(e instanceof Error?e.message:"Messagerie indisponible.")}finally{if(!quiet)setBusy(false)}}
  async function ensureClaims(){if(claims.length||claimsLoading)return;setClaimsLoading(true);try{const today=new Date().toISOString().slice(0,10);const p=await api<ClaimPayload>(`/api/quality-claims-v2?dateFrom=2026-01-01&dateTo=${today}&_=${Date.now()}`);setClaims(p.claims??[])}catch{setClaims([])}finally{setClaimsLoading(false)}}

  useEffect(()=>{const q=new URLSearchParams(location.search);const thread=q.get("thread");if(thread)setActive(thread);void load(thread,false)},[]);
  useEffect(()=>{const timer=window.setInterval(()=>void load(active,true),active?5000:12000);return()=>window.clearInterval(timer)},[active]);
  useEffect(()=>{if(data?.detail)requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}))},[data?.detail?.messages.length]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setPreview(null);setEmojiOpen(false);setVehicleDetail(null)}};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);

  const filteredThreads=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.threads??[]).filter(t=>!q||`${t.title} ${t.lastMessage??""}`.toLowerCase().includes(q))},[data,search]);
  const filteredUsers=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.users??[]).filter(u=>q&&`${u.displayName} ${u.username} ${u.positionTitle??""}`.toLowerCase().includes(q)).slice(0,12)},[data,search]);
  const filteredClaims=useMemo(()=>{const q=claimSearch.trim().toLowerCase();return claims.filter(c=>!q||`${c.registration} ${c.claim_number} ${c.client_name}`.toLowerCase().includes(q)).slice(0,80)},[claims,claimSearch]);
  const mention=useMemo(()=>currentMention(message),[message]);

  useEffect(()=>{if(mention&&mention.fragment.length>=1)void ensureClaims()},[mention?.fragment]);
  useEffect(()=>{
    const fragment=mention?.fragment??"";
    const compact=fragment.replace(/[^A-Za-z0-9]/g,"");
    if(compact.length<3){setVehicleResults([]);setVehicleSearchLoading(false);return}
    let cancelled=false;
    setVehicleSearchLoading(true);
    const timer=window.setTimeout(async()=>{
      try{const p=await api<VehiclePayload>(`/api/internal-chat?vehicleQuery=${encodeURIComponent(fragment)}&_=${Date.now()}`);if(!cancelled)setVehicleResults(p.vehicles??[])}catch{if(!cancelled)setVehicleResults([])}finally{if(!cancelled)setVehicleSearchLoading(false)}
    },180);
    return()=>{cancelled=true;window.clearTimeout(timer)};
  },[mention?.fragment]);

  const mentionChoices=useMemo<MentionChoice[]>(()=>{
    if(!mention)return[];
    const q=normalizeText(mention.fragment);
    const users=data?.users??[];
    const supervisors=users.filter(u=>u.positionLevel==="supervisor").length;
    const teamLeaders=users.filter(u=>u.positionLevel==="team_leader").length;
    const roles=([
      {kind:"role",token:"superviseur",title:"@superviseur",subtitle:"Écrire au groupe Superviseurs CRVO",count:supervisors,icon:"S"},
      {kind:"role",token:"chef-equipe",title:"@chef-equipe",subtitle:"Écrire à tous les chefs d’équipe",count:teamLeaders,icon:"CE"},
    ] satisfies MentionChoice[]).filter(item=>!q||normalizeText(item.token).includes(q)||normalizeText(item.title).includes(q));
    const vehicleMatches=vehicleResults.slice(0,5).map<MentionChoice>(v=>({kind:"vehicle",token:v.registration,title:`@${v.registration}`,subtitle:`${v.model||"Véhicule"} · ${v.status||"Statut non renseigné"}${v.workOrder?` · OR ${v.workOrder}`:""}`,vehicle:v,icon:"VO"}));
    const claimMatches=mention.fragment.length<2?[]:claims.filter(c=>normalizeText(`${c.claim_number} ${c.registration} ${c.client_name}`).includes(q)).slice(0,5).map<MentionChoice>(c=>({kind:"claim",token:c.claim_number,title:`@${c.claim_number}`,subtitle:`${c.registration} · ${c.client_name}`,claim:c,icon:"RQ"}));
    return[...roles,...vehicleMatches,...claimMatches].slice(0,10);
  },[mention,data?.users,claims,vehicleResults]);
  const roleGroupLabel=useMemo(()=>{const q=normalizeText(message);const sup=q.includes("@superviseur");const lead=q.includes("@chef-equipe")||q.includes("@chefequipe")||q.includes("@chef_equipe");return sup&&lead?"Encadrement CRVO":sup?"Superviseurs CRVO":lead?"Chefs d’équipe CRVO":null},[message]);

  async function openThread(id:string){setActive(id);setEmojiOpen(false);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(id)}`);await load(id,false)}
  async function startDirect(peer:string){setBusy(true);try{const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"startDirect",peerUserId:peer})});setData(p);if(p.detail){setActive(p.detail.id);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(p.detail.id)}`)}setSearch("")}catch(e){setError(e instanceof Error?e.message:"Conversation impossible.")}finally{setBusy(false)}}
  function addFiles(list:FileList|null){if(!list)return;const combined=[...pendingFiles,...Array.from(list)].slice(0,6);const tooBig=combined.find(f=>f.size>6291456);if(tooBig){setError(`${tooBig.name} dépasse la limite de 6 Mo.`);return}const total=combined.reduce((s,f)=>s+f.size,0);if(total>18874368){setError("Les pièces jointes d’un message sont limitées à 18 Mo au total.");return}setPendingFiles(combined);setEmojiOpen(false)}
  function chooseMention(choice:MentionChoice){const current=currentMention(message);if(!current)return;const before=message.slice(0,current.start);setMessage(`${before}@${choice.token} `);if(choice.kind==="claim")setSelectedClaim(choice.claim);if(choice.kind==="vehicle")setSelectedClaim(null);setEmojiOpen(false);setVehicleResults([])}
  async function send(){if(!active||(!message.trim()&&!selectedClaim&&!pendingFiles.length))return;setBusy(true);try{const attachments:UploadPayload[]=[];for(const file of pendingFiles)attachments.push(await attachmentPayload(file));const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"send",threadId:active,message:message.trim()||null,linkedClaimId:selectedClaim?.id||null,attachments})});setData(p);if(p.detail?.id&&p.detail.id!==active){setActive(p.detail.id);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(p.detail.id)}`)}setMessage("");setSelectedClaim(null);setPendingFiles([]);setClaimPicker(false);setEmojiOpen(false);setVehicleResults([])}catch(e){setError(e instanceof Error?e.message:"Message non envoyé.")}finally{setBusy(false)}}
  async function openClaimPicker(){setClaimPicker(true);setEmojiOpen(false);setClaimSearch("");await ensureClaims()}
  async function uploadAvatar(file:File|undefined){if(!file)return;setAvatarBusy(true);try{const avatar=await avatarPayload(file);await api("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"avatar",avatar})});setAvatarVersion(v=>v+1);await load(active,true);setError("")}catch(e){setError(e instanceof Error?e.message:"Photo de profil non enregistrée.")}finally{setAvatarBusy(false);if(avatarRef.current)avatarRef.current.value=""}}
  async function openVehicle(vehicle:LinkedVehicle){setVehicleDetail(vehicle);setVehicleDetailLoading(true);try{const p=await api<VehicleDetailPayload>(`/api/internal-chat?vehicleRegistration=${encodeURIComponent(vehicle.registration)}&_=${Date.now()}`);setVehicleDetail(p.vehicle)}catch{}finally{setVehicleDetailLoading(false)}}
  async function refreshVehicle(){if(!vehicleDetail)return;await openVehicle(vehicleDetail)}

  const detail=data?.detail;
  const currentAvatar=data?.context.userId;
  const headerPeer=detail?.participants.find(p=>p.id!==data?.context.userId)||detail?.participants[0];
  return <main className={styles.page}>
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${detail?styles.sidebarHiddenMobile:""}`}>
        <div className={styles.brand}>
          <button className={media.profileAvatar} type="button" title="Changer ma photo de profil" onClick={()=>avatarRef.current?.click()} disabled={avatarBusy}>
            {currentAvatar&&<img key={`${currentAvatar}-${avatarVersion}`} src={avatarUrl(currentAvatar,data?.context.avatarUpdatedAt,avatarVersion)} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>}<b>{initials(sessionName)}</b><span>📷</span>{avatarBusy&&<em className={media.uploading}>ENVOI…</em>}
          </button>
          <input ref={avatarRef} className={media.hiddenInput} type="file" accept="image/*" onChange={e=>void uploadAvatar(e.target.files?.[0])}/>
          <span><strong>Messagerie interne</strong><small>{sessionName}</small><small className={media.profileHint}>Cliquez sur la photo pour la modifier</small></span>
        </div>
        <label className={styles.search}><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une conversation ou un collègue…"/></label>
        {filteredUsers.length>0&&<div className={styles.people}><b>NOUVELLE CONVERSATION</b>{filteredUsers.map(u=><button key={u.id} onClick={()=>void startDirect(u.id)}><Avatar id={u.id} name={u.displayName} updated={u.avatarUpdatedAt}/><span><strong>{u.displayName}</strong><small>{u.positionTitle||u.accessProfile||u.role}</small></span><em>+</em></button>)}</div>}
        <div className={styles.threadList}>{filteredThreads.map(t=>{const peer=t.participants.find(p=>p.id!==data?.context.userId)||t.participants[0];return <button key={t.id} onClick={()=>void openThread(t.id)} className={active===t.id?styles.selected:""}>{peer?<Avatar id={peer.id} name={t.title} updated={peer.avatarUpdatedAt}/>:<i>{initials(t.title)}</i>}<span><strong>{t.title}</strong><small>{t.lastMessage||"Nouvelle conversation"}</small></span><time>{dt(t.lastMessageAt||t.updatedAt)}{t.unread>0&&<b>{t.unread>99?"99+":t.unread}</b>}</time></button>})}{!filteredThreads.length&&!search&&<p className={styles.empty}>Aucune conversation. Recherchez le nom d’un collègue pour commencer.</p>}</div>
      </aside>

      <section className={styles.chatPane}>
        {error&&<div className={styles.error}>{error}<button onClick={()=>setError("")}>×</button></div>}
        {detail?<><header className={styles.chatHead}><button className={styles.mobileBack} onClick={()=>{setActive(null);history.replaceState(null,"","/messagerie");setData(d=>d?{...d,detail:null}:d)}}>←</button>{headerPeer?<Avatar id={headerPeer.id} name={detail.title} updated={headerPeer.avatarUpdatedAt}/>:<i>{initials(detail.title)}</i>}<div><strong>{detail.title}</strong><small>{detail.participants.map(p=>p.displayName).join(" · ")}</small></div><span>INTERNE CRVO</span></header>
          <div className={styles.messages}>{detail.messages.map(m=>{const mine=m.authorUserId===data?.context.userId;const author=detail.participants.find(p=>p.id===m.authorUserId);return <div key={m.id} className={`${styles.messageRow} ${mine?styles.mine:""}`} style={{alignItems:"flex-end",gap:7}}>{!mine&&<Avatar id={m.authorUserId} name={m.authorName} updated={author?.avatarUpdatedAt}/>}<div className={styles.bubble}>{!mine&&<b>{m.authorName}</b>}{m.body&&<p>{m.body}</p>}{m.linkedClaim&&<a className={styles.claimCard} href={`/reclamations-qualite?claimId=${encodeURIComponent(m.linkedClaim.id)}`}><span>DOSSIER RÉCLAMATION</span><strong>{m.linkedClaim.registration}</strong><small>{m.linkedClaim.claimNumber} · {m.linkedClaim.client}</small><em>{m.linkedClaim.category} · {m.linkedClaim.status}</em></a>}{m.linkedVehicle&&<button type="button" className={mentions.vehicleCard} onClick={()=>void openVehicle(m.linkedVehicle!)}><span className={mentions.vehicleCardTop}><span>VÉHICULE EN PRODUCTION</span><em>OUVRIR LA FICHE ↗</em></span><span className={mentions.vehicleCardBody}><strong>{m.linkedVehicle.registration}</strong><b>{m.linkedVehicle.model||"Modèle non renseigné"}</b><small>{m.linkedVehicle.client||"Client non renseigné"}{m.linkedVehicle.workOrder?` · OR ${m.linkedVehicle.workOrder}`:""}</small><small className={mentions.vehicleStatus}>{m.linkedVehicle.status||"Statut non renseigné"}</small></span><span className={mentions.vehicleMeta}><span>Statut {ageLabel(m.linkedVehicle.statusAgeDays)}</span><span>Usine {ageLabel(m.linkedVehicle.factoryAgeDays)}</span><span>{kmLabel(m.linkedVehicle.mileage)}</span></span></button>}{(m.attachments?.length??0)>0&&<div className={media.attachments}>{m.attachments?.map(a=>a.mimeType.startsWith("image/")?<button type="button" key={a.id} className={media.imageAttachment} onClick={()=>setPreview(a)}><img src={attachmentUrl(a.id)} alt={a.fileName}/><span>AGRANDIR</span></button>:<a key={a.id} className={media.fileAttachment} href={attachmentUrl(a.id)} target="_blank" rel="noreferrer"><i>📎</i><span><strong>{a.fileName}</strong><small>{sizeLabel(a.sizeBytes)}</small></span></a>)}</div>}<time>{dt(m.createdAt)}</time></div></div>})}<div ref={bottomRef}/></div>
          {selectedClaim&&<div className={styles.attached}><span>DOSSIER JOINT</span><strong>{selectedClaim.registration}</strong><small>{selectedClaim.claim_number} · {selectedClaim.client_name}</small><button onClick={()=>setSelectedClaim(null)}>×</button></div>}
          {pendingFiles.length>0&&<div className={media.pendingFiles}>{pendingFiles.map((f,i)=><div className={media.pendingFile} key={`${f.name}-${f.size}-${i}`}><i>{f.type.startsWith("image/")?"🖼️":"📎"}</i><span><strong>{f.name}</strong><small>{sizeLabel(f.size)}</small></span><button type="button" onClick={()=>setPendingFiles(files=>files.filter((_,index)=>index!==i))}>×</button></div>)}</div>}
          {roleGroupLabel&&<div className={mentions.groupNotice}>Ce message sera envoyé dans le groupe <b>{roleGroupLabel}</b>, sans ouvrir l’historique de cette conversation aux destinataires.</div>}
          {emojiOpen&&<div className={media.emojiPanel}>{EMOJIS.map(e=><button type="button" key={e} onClick={()=>{setMessage(v=>v+e);setEmojiOpen(false)}}>{e}</button>)}</div>}
          {mention&&<div className={mentions.mentionPanel}><span className={mentions.mentionTitle}>MENTION INTELLIGENTE · UTILISATEUR / DOSSIER / VÉHICULE</span>{mentionChoices.map(choice=><button type="button" className={`${mentions.mentionOption} ${choice.kind==="vehicle"?mentions.vehicleOption:""}`} key={`${choice.kind}-${choice.token}`} onClick={()=>chooseMention(choice)}><i className={mentions.mentionIcon}>{choice.icon}</i><span><strong>{choice.title}</strong><small>{choice.subtitle}</small></span><em>{choice.kind==="role"?`${choice.count} profil(s)`:choice.kind==="vehicle"?"VÉHICULE":"DOSSIER"}</em></button>)}{!mentionChoices.length&&<p className={mentions.emptyMention}>{claimsLoading||vehicleSearchLoading?"Recherche dans la Toolbox…":"Aucune mention correspondante."}</p>}</div>}
          <div className={styles.composer}><div className={media.composerTools}><button className={media.toolButton} title="Partager une réclamation" onClick={()=>void openClaimPicker()}>＋</button><button className={media.toolButton} title="Ajouter une photo ou un fichier" onClick={()=>fileRef.current?.click()}>📎</button><button className={media.toolButton} title="Ajouter un emoji" onClick={()=>setEmojiOpen(v=>!v)}>☺</button><input ref={fileRef} className={media.hiddenInput} type="file" multiple accept={FILE_ACCEPT} onChange={e=>{addFiles(e.target.files);e.currentTarget.value=""}}/></div><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="Écrire… @superviseur · @chef-equipe · @JF-2026-0002 · @AA123BB"/><button className={styles.send} disabled={busy||(!message.trim()&&!selectedClaim&&!pendingFiles.length)} onClick={()=>void send()}>➤</button></div>
          <div className={mentions.mentionHint}>Astuce : <b>@superviseur</b> / <b>@chef-equipe</b> cible l’encadrement, <b>@0002</b> ou <b>@JF-2026-0002</b> joint une réclamation, et <b>@immatriculation</b> joint le véhicule avec son statut production.</div>
        </>:<div className={styles.welcome}><div>CRVO</div><h1>Messagerie interne</h1><p>Échangez directement entre utilisateurs de la Toolbox, envoyez des photos, des pièces jointes et partagez un dossier Réclamation ou un véhicule en production sans quitter votre environnement de travail.</p><small>Recherchez un collègue à gauche pour démarrer.</small></div>}
      </section>
    </div>

    {claimPicker&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.currentTarget===e.target)setClaimPicker(false)}}><div className={styles.modal}><header><div><span>PARTAGER DANS LA CONVERSATION</span><h2>Choisir une réclamation</h2></div><button onClick={()=>setClaimPicker(false)}>×</button></header><input autoFocus value={claimSearch} onChange={e=>setClaimSearch(e.target.value)} placeholder="Immatriculation, numéro de dossier, client…"/><div className={styles.claimPicker}>{filteredClaims.map(c=><button key={c.id} onClick={()=>{setSelectedClaim(c);setClaimPicker(false)}}><div><strong>{c.registration}</strong><span>{c.claim_number} · {c.client_name}</span><small>{c.category}</small></div><em>JOINDRE</em></button>)}{!filteredClaims.length&&<p>{claimsLoading?"Chargement des dossiers…":"Vous n’avez pas accès à une liste de réclamations partageables, ou aucun dossier ne correspond à la recherche."}</p>}</div></div></div>}
    {preview&&<div className={media.lightbox} role="dialog" aria-modal="true" onMouseDown={e=>{if(e.currentTarget===e.target)setPreview(null)}}><button type="button" onClick={()=>setPreview(null)} aria-label="Fermer">×</button><img src={attachmentUrl(preview.id)} alt={preview.fileName}/></div>}
    {vehicleDetail&&<div className={mentions.vehicleModalBackdrop} role="dialog" aria-modal="true" aria-label={`Véhicule ${vehicleDetail.registration}`} onMouseDown={e=>{if(e.currentTarget===e.target)setVehicleDetail(null)}}><div className={mentions.vehicleModal}><div className={mentions.vehicleModalHead}><div><span>FICHE PRODUCTION · ÉTAT DU PARC</span><h2>{vehicleDetail.registration}</h2><p>{vehicleDetail.model||"Modèle non renseigné"}</p></div><button type="button" onClick={()=>setVehicleDetail(null)} aria-label="Fermer">×</button></div>{vehicleDetailLoading?<div className={mentions.vehicleLoading}>Actualisation de la situation production…</div>:<><div className={mentions.vehicleFresh}><span>Situation rechargée depuis l’État du Parc · {dt(vehicleDetail.sourceModifiedAt)}</span><button type="button" className={mentions.refreshVehicle} onClick={()=>void refreshVehicle()}>ACTUALISER</button></div><div className={mentions.vehicleStatusBlock}><span>STATUT ACTUEL</span><strong>{vehicleDetail.status||"Non renseigné"}</strong><small>Dans ce statut depuis {ageLabel(vehicleDetail.statusAgeDays)} · ancienneté usine {ageLabel(vehicleDetail.factoryAgeDays)}</small></div><div className={mentions.vehicleGrid}><div className={mentions.vehicleField}><span>ORDRE DE RÉPARATION</span><strong>{vehicleDetail.workOrder||"—"}</strong></div><div className={mentions.vehicleField}><span>CLIENT / AFFAIRE</span><strong>{vehicleDetail.client||"—"}</strong></div><div className={mentions.vehicleField}><span>VIN</span><strong>{vehicleDetail.vin||"—"}</strong></div><div className={mentions.vehicleField}><span>KILOMÉTRAGE</span><strong>{kmLabel(vehicleDetail.mileage)}</strong></div><div className={mentions.vehicleField}><span>MÉCANIQUE</span><strong>{vehicleDetail.mechanics||"—"}</strong></div><div className={mentions.vehicleField}><span>CARROSSERIE</span><strong>{vehicleDetail.bodywork||"—"}</strong></div><div className={mentions.vehicleField}><span>CONTRÔLE TECHNIQUE</span><strong>{vehicleDetail.technicalControl||"—"}</strong></div><div className={mentions.vehicleField}><span>JANTES / DSP</span><strong>{[vehicleDetail.wheels,vehicleDetail.dsp].filter(Boolean).join(" · ")||"—"}</strong></div></div>{vehicleDetail.alert&&<div className={mentions.vehicleAlert}><b>POINTS / ALERTES DU DOSSIER</b><br/>{vehicleDetail.alert}</div>}</>}</div></div>}
  </main>;
}
