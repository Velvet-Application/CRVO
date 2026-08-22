"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./planning.module.css";

type Person={employeeKey:string;employeeName:string;matricule?:string|null;team?:string|null;service?:string|null};
type Track={key:string;label:string;levelLabel?:string|null};
type Trainer={id:string;displayName:string;specialty:string;active:boolean};
type Participant={employeeKey:string;employeeName:string;status:string;attendanceStatus?:string|null;learnerSignedAt?:string|null;trainerSignedAt?:string|null};
type SessionRow={id:string;title:string;trackKey:string;trainerId?:string|null;trainerName?:string|null;startAt:string;endAt:string;status:string;workflowStatus?:string|null;location?:string|null;objective?:string|null;focusSkillKeys:string[];notes?:string|null;participants:Participant[]};
type Dashboard={access:{userId:string;displayName:string;profile:string;canEdit:boolean;canAdmin:boolean};people:Person[];tracks:Track[];trainers:Trainer[];sessions:SessionRow[];error?:string};
type Draft={id?:string;title:string;trackKey:string;trainerId:string;startAt:string;endAt:string;status:string;location:string;objective:string;notes:string;participantKeys:string[]};

const STATUS_LABEL:Record<string,string>={planned:"Planifiée",completed:"Terminée",cancelled:"Annulée"};
const WORKFLOW_LABEL:Record<string,string>={pending:"En attente de validation",approved:"Validée",refused:"Refusée",cancelled:"Annulée"};

function localInput(value:string){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return"";
  const pad=(n:number)=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dateLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"short",year:"numeric"}).format(new Date(value));}
function timeLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
function emptyDraft(data:Dashboard|null):Draft{
  const start=new Date();start.setMinutes(Math.ceil(start.getMinutes()/30)*30,0,0);start.setHours(start.getHours()+1);
  const end=new Date(start);end.setHours(end.getHours()+2);
  return {title:"",trackKey:data?.tracks[0]?.key??"",trainerId:"",startAt:localInput(start.toISOString()),endAt:localInput(end.toISOString()),status:"planned",location:"Zone formation carrosserie",objective:"",notes:"",participantKeys:[]};
}
function profileLabel(profile:string,admin:boolean){if(admin)return"Administrateur";if(profile==="hr")return"RH";if(profile==="service_manager")return"Chef de service";if(profile==="trainer")return"Formateur";return profile;}

export default function TrainingPlanningPage(){
  const[data,setData]=useState<Dashboard|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[notice,setNotice]=useState("");
  const[search,setSearch]=useState("");
  const[filter,setFilter]=useState("planned");
  const[open,setOpen]=useState(false);
  const[draft,setDraft]=useState<Draft>(emptyDraft(null));
  const[saving,setSaving]=useState(false);

  const canManage=Boolean(data&&(data.access.canAdmin||data.access.profile==="hr"));

  async function load(){
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/training?_=${Date.now()}`,{cache:"no-store"});
      const payload=await response.json()as Dashboard;
      if(!response.ok)throw new Error(payload.error||"Chargement du planning impossible.");
      setData(payload);
    }catch(cause){setError(cause instanceof Error?cause.message:"Chargement du planning impossible.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const sessions=useMemo(()=>{
    if(!data)return[];
    const q=search.trim().toLocaleLowerCase("fr");
    return [...data.sessions]
      .filter(item=>(filter==="*"||item.status===filter)&&(!q||`${item.title} ${item.trainerName??""} ${item.location??""} ${item.participants.map(p=>p.employeeName).join(" ")}`.toLocaleLowerCase("fr").includes(q)))
      .sort((a,b)=>a.startAt.localeCompare(b.startAt));
  },[data,filter,search]);

  const upcoming=useMemo(()=>data?.sessions.filter(s=>s.status==="planned"&&new Date(s.endAt)>=new Date()).length??0,[data]);
  const nextSeven=useMemo(()=>{const now=Date.now(),end=now+7*86400000;return data?.sessions.filter(s=>s.status==="planned"&&new Date(s.startAt).getTime()>=now&&new Date(s.startAt).getTime()<=end).length??0;},[data]);
  const participantCount=useMemo(()=>data?.sessions.filter(s=>s.status==="planned").reduce((sum,s)=>sum+s.participants.length,0)??0,[data]);

  function openSession(session:SessionRow){
    setNotice("");setError("");
    setDraft({id:session.id,title:session.title,trackKey:session.trackKey,trainerId:session.trainerId??"",startAt:localInput(session.startAt),endAt:localInput(session.endAt),status:session.status,location:session.location??"",objective:session.objective??"",notes:session.notes??"",participantKeys:session.participants.map(p=>p.employeeKey)});
    setOpen(true);
  }
  function createSession(){setNotice("");setError("");setDraft(emptyDraft(data));setOpen(true);}
  function close(){if(!saving)setOpen(false);}

  async function post(body:Record<string,unknown>){
    const response=await fetch("/api/training",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}))as{error?:string};
    if(!response.ok)throw new Error(payload.error||"Action impossible.");
    return payload;
  }

  async function save(){
    if(!canManage)return;
    if(!draft.title.trim()){setError("Le titre de la formation est obligatoire.");return;}
    if(!draft.trackKey||!draft.startAt||!draft.endAt){setError("Le parcours, le début et la fin sont obligatoires.");return;}
    if(new Date(draft.endAt)<=new Date(draft.startAt)){setError("L'heure de fin doit être postérieure au début.");return;}
    setSaving(true);setError("");setNotice("");
    try{
      await post({action:"save-session",id:draft.id??null,title:draft.title,trackKey:draft.trackKey,trainerId:draft.trainerId||null,startAt:new Date(draft.startAt).toISOString(),endAt:new Date(draft.endAt).toISOString(),status:draft.status,location:draft.location||null,objective:draft.objective||null,focusSkillKeys:[],participantKeys:draft.participantKeys,notes:draft.notes||null});
      setNotice(draft.id?"Formation mise à jour.":"Formation programmée.");
      setOpen(false);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}
    finally{setSaving(false);}
  }

  async function remove(){
    if(!canManage||!draft.id)return;
    if(!window.confirm(`Supprimer définitivement la formation « ${draft.title} » ?\n\nCette action retire la session du planning. Une trace d'audit est conservée.`))return;
    setSaving(true);setError("");setNotice("");
    try{
      await post({action:"delete-session",id:draft.id});
      setNotice("Formation supprimée du planning.");setOpen(false);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Suppression impossible.");}
    finally{setSaving(false);}
  }

  const selectedSession=draft.id?data?.sessions.find(s=>s.id===draft.id):null;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div>
        <Link href="/formation" className={styles.back}>← Formation & compétences</Link>
        <p className={styles.eyebrow}>PÔLE FORMATION · PLANNING</p>
        <h1>Planning des formations</h1>
        <p>Ouvrir une session programmée, contrôler ses participants et permettre aux RH / administrateurs de la modifier ou de la supprimer.</p>
      </div>
      <div className={styles.identity}>
        <span>SESSION UTILISATEUR</span>
        <strong>{data?.access.displayName??"—"}</strong>
        <small>{data?profileLabel(data.access.profile,data.access.canAdmin):"Chargement…"}</small>
        {data&&<b data-manage={canManage}>{canManage?"GESTION AUTORISÉE":"LECTURE SEULE"}</b>}
      </div>
    </header>

    {error&&<div className={styles.error}>{error}</div>}
    {notice&&<div className={styles.notice}>{notice}</div>}

    <section className={styles.kpis}>
      <article><span>FORMATIONS À VENIR</span><strong>{upcoming}</strong><small>sessions planifiées</small></article>
      <article><span>7 PROCHAINS JOURS</span><strong>{nextSeven}</strong><small>sessions à préparer</small></article>
      <article><span>COLLABORATEURS PLANIFIÉS</span><strong>{participantCount}</strong><small>inscriptions sur les sessions à venir</small></article>
      <article className={canManage?styles.authorized:styles.readonly}><span>DROITS PLANNING</span><strong>{canManage?"RH / ADMIN":"LECTURE"}</strong><small>{canManage?"ouvrir · modifier · supprimer":"consultation des sessions"}</small></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div><p className={styles.eyebrow}>CALENDRIER OPÉRATIONNEL</p><h2>Sessions de formation</h2><p>Clique sur une session pour l'ouvrir.</p></div>
        {canManage&&<button className={styles.primary} onClick={createSession}>+ Nouvelle formation</button>}
      </div>
      <div className={styles.toolbar}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une formation, un formateur, un participant…"/>
        <select value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="planned">Planifiées</option><option value="completed">Terminées</option><option value="cancelled">Annulées</option><option value="*">Toutes les sessions</option>
        </select>
        <span>{sessions.length} session{sessions.length>1?"s":""}</span>
      </div>

      {loading?<div className={styles.loading}>Chargement du planning…</div>:<div className={styles.sessionList}>
        {sessions.map(session=><button className={styles.session} key={session.id} onClick={()=>openSession(session)}>
          <div className={styles.dateBlock}><strong>{new Intl.DateTimeFormat("fr-FR",{day:"2-digit"}).format(new Date(session.startAt))}</strong><span>{new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(new Date(session.startAt))}</span></div>
          <div className={styles.sessionMain}>
            <div className={styles.titleLine}><h3>{session.title}</h3><span data-status={session.status}>{STATUS_LABEL[session.status]??session.status}</span></div>
            <p>{dateLabel(session.startAt)} · {timeLabel(session.startAt)} → {timeLabel(session.endAt)} · {session.location||"Lieu à définir"}</p>
            <small>{data?.tracks.find(t=>t.key===session.trackKey)?.label??session.trackKey} · {session.trainerName||"Formateur à définir"}</small>
            <div className={styles.people}>{session.participants.slice(0,5).map(p=><i key={p.employeeKey}>{p.employeeName}</i>)}{session.participants.length>5&&<i>+{session.participants.length-5}</i>}{session.participants.length===0&&<i>Aucun participant</i>}</div>
          </div>
          <div className={styles.sessionSide}><b>{session.participants.length}</b><small>participant{session.participants.length>1?"s":""}</small><em>Ouvrir ›</em></div>
        </button>)}
        {sessions.length===0&&<div className={styles.empty}>Aucune session ne correspond aux filtres.</div>}
      </div>}
    </section>

    {open&&data&&<>
      <button className={styles.backdrop} onClick={close} aria-label="Fermer"/>
      <aside className={styles.drawer}>
        <header className={styles.drawerHead}>
          <div><p className={styles.eyebrow}>{draft.id?"SESSION PROGRAMMÉE":"NOUVELLE SESSION"}</p><h2>{draft.id?draft.title||"Formation":"Programmer une formation"}</h2>{selectedSession?.workflowStatus&&<small>{WORKFLOW_LABEL[selectedSession.workflowStatus]??selectedSession.workflowStatus}</small>}</div>
          <button onClick={close} aria-label="Fermer">×</button>
        </header>

        {!canManage&&<div className={styles.readOnlyBanner}><strong>Consultation uniquement</strong><span>La modification et la suppression sont réservées aux profils RH et ADMIN.</span></div>}

        <div className={styles.form}>
          <label className={styles.full}>Titre de la formation<input disabled={!canManage} value={draft.title} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/></label>
          <label>Parcours<select disabled={!canManage} value={draft.trackKey} onChange={e=>setDraft(v=>({...v,trackKey:e.target.value}))}>{data.tracks.map(t=><option value={t.key} key={t.key}>{t.label}</option>)}</select></label>
          <label>Formateur<select disabled={!canManage} value={draft.trainerId} onChange={e=>setDraft(v=>({...v,trainerId:e.target.value}))}><option value="">À définir</option>{data.trainers.filter(t=>t.active||t.id===draft.trainerId).map(t=><option value={t.id} key={t.id}>{t.displayName}</option>)}</select></label>
          <label>Début<input disabled={!canManage} type="datetime-local" value={draft.startAt} onChange={e=>setDraft(v=>({...v,startAt:e.target.value}))}/></label>
          <label>Fin<input disabled={!canManage} type="datetime-local" value={draft.endAt} onChange={e=>setDraft(v=>({...v,endAt:e.target.value}))}/></label>
          <label>Statut<select disabled={!canManage} value={draft.status} onChange={e=>setDraft(v=>({...v,status:e.target.value}))}><option value="planned">Planifiée</option><option value="completed">Terminée</option><option value="cancelled">Annulée</option></select></label>
          <label>Lieu<input disabled={!canManage} value={draft.location} onChange={e=>setDraft(v=>({...v,location:e.target.value}))}/></label>
          <label className={styles.full}>Objectif pédagogique<textarea disabled={!canManage} value={draft.objective} onChange={e=>setDraft(v=>({...v,objective:e.target.value}))} placeholder="Compétences visées, résultat attendu…"/></label>
          <label className={styles.full}>Notes<textarea disabled={!canManage} value={draft.notes} onChange={e=>setDraft(v=>({...v,notes:e.target.value}))} placeholder="Informations utiles pour l'organisation…"/></label>

          <div className={`${styles.full} ${styles.participants}`}>
            <div><span>Participants</span><b>{draft.participantKeys.length} sélectionné{draft.participantKeys.length>1?"s":""}</b></div>
            <div className={styles.participantGrid}>{data.people.map(person=><label key={person.employeeKey}>
              <input disabled={!canManage} type="checkbox" checked={draft.participantKeys.includes(person.employeeKey)} onChange={e=>setDraft(v=>({...v,participantKeys:e.target.checked?[...v.participantKeys,person.employeeKey]:v.participantKeys.filter(k=>k!==person.employeeKey)}))}/>
              <span><strong>{person.employeeName}</strong><small>{person.service||"—"} · Équipe {person.team||"—"}</small></span>
            </label>)}</div>
          </div>
        </div>

        {canManage&&<footer className={styles.actions}>
          {draft.id&&draft.status==="planned"&&<button className={styles.danger} disabled={saving} onClick={()=>void remove()}>Supprimer</button>}
          <button className={styles.secondary} disabled={saving} onClick={close}>Annuler</button>
          <button className={styles.primary} disabled={saving} onClick={()=>void save()}>{saving?"Enregistrement…":draft.id?"Enregistrer les modifications":"Programmer la formation"}</button>
        </footer>}
      </aside>
    </>}
  </main>;
}
