"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import styles from "./internal-chat.module.css";
import media from "./internal-chat-media.module.css";

type User={id:string;displayName:string;username:string;role:string;accessProfile:string;lastLoginAt:string|null;hasAvatar?:boolean;avatarUpdatedAt?:string|null};
type Participant={id:string;displayName:string;role?:string;accessProfile?:string;hasAvatar?:boolean;avatarUpdatedAt?:string|null};
type LinkedClaim={id:string;claimNumber:string;registration:string;client:string;category:string;status:string};
type ChatAttachment={id:string;fileName:string;mimeType:string;sizeBytes:number;createdAt:string};
type Message={id:number;authorUserId:string;authorName:string;body:string|null;createdAt:string;linkedClaim:LinkedClaim|null;attachments?:ChatAttachment[]};
type Thread={id:string;kind:string;title:string;updatedAt:string;lastMessage:string|null;lastMessageAt:string|null;unread:number;participants:Participant[]};
type Detail={id:string;kind:string;title:string;participants:Participant[];messages:Message[]};
type Snapshot={context:{userId:string;displayName:string;hasAvatar?:boolean;avatarUpdatedAt?:string|null};users:User[];threads:Thread[];detail:Detail|null};
type Claim={id:string;claim_number:string;registration:string;client_name:string;category:string;status:string;declared_at:string};
type ClaimPayload={claims:Claim[]};
type UploadPayload={fileName:string;mimeType:string;sizeBytes:number;fileData:string};

const EMOJIS=["😀","😄","😂","😊","😉","😍","🥳","😎","🤝","👍","👏","🙏","👌","💪","✅","⚠️","❓","💡","🚗","🔧","📷","📎","🔥","❤️","🎯","🚀","👀","🙌","😅","🤔","😬","😢"];
const FILE_ACCEPT="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
function dt(v:string|null|undefined){if(!v)return"";const d=new Date(v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d)}
function initials(name:string){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"CR"}
function sizeLabel(bytes:number){if(bytes<1024)return`${bytes} o`;if(bytes<1048576)return`${Math.round(bytes/1024)} Ko`;return`${(bytes/1048576).toLocaleString("fr-FR",{maximumFractionDigits:1})} Mo`}
function avatarUrl(id:string,updated?:string|null,version?:number){return`/api/internal-chat?avatarUserId=${encodeURIComponent(id)}&v=${encodeURIComponent(updated||String(version||0))}`}
function attachmentUrl(id:string){return`/api/internal-chat?attachmentId=${encodeURIComponent(id)}`}
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
  const[claimPicker,setClaimPicker]=useState(false),[claims,setClaims]=useState<Claim[]>([]),[claimSearch,setClaimSearch]=useState(""),[selectedClaim,setSelectedClaim]=useState<Claim|null>(null);
  const[pendingFiles,setPendingFiles]=useState<File[]>([]),[emojiOpen,setEmojiOpen]=useState(false),[preview,setPreview]=useState<ChatAttachment|null>(null),[avatarVersion,setAvatarVersion]=useState(0),[avatarBusy,setAvatarBusy]=useState(false);
  const bottomRef=useRef<HTMLDivElement|null>(null),fileRef=useRef<HTMLInputElement|null>(null),avatarRef=useRef<HTMLInputElement|null>(null);

  async function api<T>(url:string,init?:RequestInit){const r=await fetch(url,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(p.error||"Service indisponible"));return p as T}
  async function load(thread=active,quiet=false){try{if(!quiet)setBusy(true);const q=thread?`?thread=${encodeURIComponent(thread)}&_=${Date.now()}`:`?_=${Date.now()}`;const p=await api<Snapshot>(`/api/internal-chat${q}`);setData(p);setError("");if(thread&&p.detail){void api("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"read",threadId:thread})}).catch(()=>null)}}catch(e){setError(e instanceof Error?e.message:"Messagerie indisponible.")}finally{if(!quiet)setBusy(false)}}
  useEffect(()=>{const q=new URLSearchParams(location.search);const thread=q.get("thread");if(thread)setActive(thread);void load(thread,false)},[]);
  useEffect(()=>{const timer=window.setInterval(()=>void load(active,true),active?5000:12000);return()=>window.clearInterval(timer)},[active]);
  useEffect(()=>{if(data?.detail)requestAnimationFrame(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}))},[data?.detail?.messages.length]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==="Escape"){setPreview(null);setEmojiOpen(false)}};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[]);

  const filteredThreads=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.threads??[]).filter(t=>!q||`${t.title} ${t.lastMessage??""}`.toLowerCase().includes(q))},[data,search]);
  const filteredUsers=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.users??[]).filter(u=>q&&`${u.displayName} ${u.username}`.toLowerCase().includes(q)).slice(0,12)},[data,search]);
  const filteredClaims=useMemo(()=>{const q=claimSearch.trim().toLowerCase();return claims.filter(c=>!q||`${c.registration} ${c.claim_number} ${c.client_name}`.toLowerCase().includes(q)).slice(0,80)},[claims,claimSearch]);

  async function openThread(id:string){setActive(id);setEmojiOpen(false);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(id)}`);await load(id,false)}
  async function startDirect(peer:string){setBusy(true);try{const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"startDirect",peerUserId:peer})});setData(p);if(p.detail){setActive(p.detail.id);history.replaceState(null,"",`/messagerie?thread=${encodeURIComponent(p.detail.id)}`)}setSearch("")}catch(e){setError(e instanceof Error?e.message:"Conversation impossible.")}finally{setBusy(false)}}
  function addFiles(list:FileList|null){if(!list)return;const combined=[...pendingFiles,...Array.from(list)].slice(0,6);const tooBig=combined.find(f=>f.size>6291456);if(tooBig){setError(`${tooBig.name} dépasse la limite de 6 Mo.`);return}const total=combined.reduce((s,f)=>s+f.size,0);if(total>18874368){setError("Les pièces jointes d’un message sont limitées à 18 Mo au total.");return}setPendingFiles(combined);setEmojiOpen(false)}
  async function send(){if(!active||(!message.trim()&&!selectedClaim&&!pendingFiles.length))return;setBusy(true);try{const attachments:UploadPayload[]=[];for(const file of pendingFiles)attachments.push(await attachmentPayload(file));const p=await api<Snapshot>("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"send",threadId:active,message:message.trim()||null,linkedClaimId:selectedClaim?.id||null,attachments})});setData(p);setMessage("");setSelectedClaim(null);setPendingFiles([]);setClaimPicker(false);setEmojiOpen(false)}catch(e){setError(e instanceof Error?e.message:"Message non envoyé.")}finally{setBusy(false)}}
  async function openClaimPicker(){setClaimPicker(true);setEmojiOpen(false);setClaimSearch("");if(claims.length)return;try{const today=new Date().toISOString().slice(0,10);const p=await api<ClaimPayload>(`/api/quality-claims-v2?dateFrom=2026-01-01&dateTo=${today}&_=${Date.now()}`);setClaims(p.claims??[])}catch{setClaims([])}}
  async function uploadAvatar(file:File|undefined){if(!file)return;setAvatarBusy(true);try{const avatar=await avatarPayload(file);await api("/api/internal-chat",{method:"POST",body:JSON.stringify({action:"avatar",avatar})});setAvatarVersion(v=>v+1);await load(active,true);setError("")}catch(e){setError(e instanceof Error?e.message:"Photo de profil non enregistrée.")}finally{setAvatarBusy(false);if(avatarRef.current)avatarRef.current.value=""}}

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
        {filteredUsers.length>0&&<div className={styles.people}><b>NOUVELLE CONVERSATION</b>{filteredUsers.map(u=><button key={u.id} onClick={()=>void startDirect(u.id)}><Avatar id={u.id} name={u.displayName} updated={u.avatarUpdatedAt}/><span><strong>{u.displayName}</strong><small>{u.accessProfile||u.role}</small></span><em>+</em></button>)}</div>}
        <div className={styles.threadList}>{filteredThreads.map(t=>{const peer=t.participants.find(p=>p.id!==data?.context.userId)||t.participants[0];return <button key={t.id} onClick={()=>void openThread(t.id)} className={active===t.id?styles.selected:""}>{peer?<Avatar id={peer.id} name={t.title} updated={peer.avatarUpdatedAt}/>:<i>{initials(t.title)}</i>}<span><strong>{t.title}</strong><small>{t.lastMessage||"Nouvelle conversation"}</small></span><time>{dt(t.lastMessageAt||t.updatedAt)}{t.unread>0&&<b>{t.unread>99?"99+":t.unread}</b>}</time></button>})}{!filteredThreads.length&&!search&&<p className={styles.empty}>Aucune conversation. Recherchez le nom d’un collègue pour commencer.</p>}</div>
      </aside>

      <section className={styles.chatPane}>
        {error&&<div className={styles.error}>{error}<button onClick={()=>setError("")}>×</button></div>}
        {detail?<><header className={styles.chatHead}><button className={styles.mobileBack} onClick={()=>{setActive(null);history.replaceState(null,"","/messagerie");setData(d=>d?{...d,detail:null}:d)}}>←</button>{headerPeer?<Avatar id={headerPeer.id} name={detail.title} updated={headerPeer.avatarUpdatedAt}/>:<i>{initials(detail.title)}</i>}<div><strong>{detail.title}</strong><small>{detail.participants.map(p=>p.displayName).join(" · ")}</small></div><span>INTERNE CRVO</span></header>
          <div className={styles.messages}>{detail.messages.map(m=>{const mine=m.authorUserId===data?.context.userId;const author=detail.participants.find(p=>p.id===m.authorUserId);return <div key={m.id} className={`${styles.messageRow} ${mine?styles.mine:""}`} style={{alignItems:"flex-end",gap:7}}>{!mine&&<Avatar id={m.authorUserId} name={m.authorName} updated={author?.avatarUpdatedAt}/>}<div className={styles.bubble}>{!mine&&<b>{m.authorName}</b>}{m.body&&<p>{m.body}</p>}{m.linkedClaim&&<a className={styles.claimCard} href={`/reclamations-qualite?claimId=${encodeURIComponent(m.linkedClaim.id)}`}><span>DOSSIER RÉCLAMATION</span><strong>{m.linkedClaim.registration}</strong><small>{m.linkedClaim.claimNumber} · {m.linkedClaim.client}</small><em>{m.linkedClaim.category} · {m.linkedClaim.status}</em></a>}{(m.attachments?.length??0)>0&&<div className={media.attachments}>{m.attachments?.map(a=>a.mimeType.startsWith("image/")?<button type="button" key={a.id} className={media.imageAttachment} onClick={()=>setPreview(a)}><img src={attachmentUrl(a.id)} alt={a.fileName}/><span>AGRANDIR</span></button>:<a key={a.id} className={media.fileAttachment} href={attachmentUrl(a.id)} target="_blank" rel="noreferrer"><i>📎</i><span><strong>{a.fileName}</strong><small>{sizeLabel(a.sizeBytes)}</small></span></a>)}</div>}<time>{dt(m.createdAt)}</time></div></div>})}<div ref={bottomRef}/></div>
          {selectedClaim&&<div className={styles.attached}><span>DOSSIER JOINT</span><strong>{selectedClaim.registration}</strong><small>{selectedClaim.claim_number} · {selectedClaim.client_name}</small><button onClick={()=>setSelectedClaim(null)}>×</button></div>}
          {pendingFiles.length>0&&<div className={media.pendingFiles}>{pendingFiles.map((f,i)=><div className={media.pendingFile} key={`${f.name}-${f.size}-${i}`}><i>{f.type.startsWith("image/")?"🖼️":"📎"}</i><span><strong>{f.name}</strong><small>{sizeLabel(f.size)}</small></span><button type="button" onClick={()=>setPendingFiles(files=>files.filter((_,index)=>index!==i))}>×</button></div>)}</div>}
          {emojiOpen&&<div className={media.emojiPanel}>{EMOJIS.map(e=><button type="button" key={e} onClick={()=>{setMessage(v=>v+e);setEmojiOpen(false)}}>{e}</button>)}</div>}
          <div className={styles.composer}><div className={media.composerTools}><button className={media.toolButton} title="Partager une réclamation" onClick={()=>void openClaimPicker()}>＋</button><button className={media.toolButton} title="Ajouter une photo ou un fichier" onClick={()=>fileRef.current?.click()}>📎</button><button className={media.toolButton} title="Ajouter un emoji" onClick={()=>setEmojiOpen(v=>!v)}>☺</button><input ref={fileRef} className={media.hiddenInput} type="file" multiple accept={FILE_ACCEPT} onChange={e=>{addFiles(e.target.files);e.currentTarget.value=""}}/></div><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="Écrire un message…"/><button className={styles.send} disabled={busy||(!message.trim()&&!selectedClaim&&!pendingFiles.length)} onClick={()=>void send()}>➤</button></div>
        </>:<div className={styles.welcome}><div>CRVO</div><h1>Messagerie interne</h1><p>Échangez directement entre utilisateurs de la Toolbox, envoyez des photos, des pièces jointes et partagez un dossier Réclamation sans quitter votre environnement de travail.</p><small>Recherchez un collègue à gauche pour démarrer.</small></div>}
      </section>
    </div>

    {claimPicker&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.currentTarget===e.target)setClaimPicker(false)}}><div className={styles.modal}><header><div><span>PARTAGER DANS LA CONVERSATION</span><h2>Choisir une réclamation</h2></div><button onClick={()=>setClaimPicker(false)}>×</button></header><input autoFocus value={claimSearch} onChange={e=>setClaimSearch(e.target.value)} placeholder="Immatriculation, numéro de dossier, client…"/><div className={styles.claimPicker}>{filteredClaims.map(c=><button key={c.id} onClick={()=>{setSelectedClaim(c);setClaimPicker(false)}}><div><strong>{c.registration}</strong><span>{c.claim_number} · {c.client_name}</span><small>{c.category}</small></div><em>JOINDRE</em></button>)}{!filteredClaims.length&&<p>Vous n’avez pas accès à une liste de réclamations partageables, ou aucun dossier ne correspond à la recherche.</p>}</div></div></div>}
    {preview&&<div className={media.lightbox} role="dialog" aria-modal="true" onMouseDown={e=>{if(e.currentTarget===e.target)setPreview(null)}}><button type="button" onClick={()=>setPreview(null)} aria-label="Fermer">×</button><img src={attachmentUrl(preview.id)} alt={preview.fileName}/></div>}
  </main>;
}
