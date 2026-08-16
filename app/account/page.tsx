"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./account.module.css";

type AccessProfile="admin"|"service_manager"|"team_manager"|"custom";
type User={id:string;username:string;display_name:string;role:"admin"|"user";is_active:boolean;must_change_password:boolean;created_at:string;last_login_at:string|null;access_profile:AccessProfile;page_permissions:string[];productivity_scopes:string[];team_scopes:string[];can_manage_bonus_workflow:boolean};
type Me={id:string;username:string;displayName:string;role:"admin"|"user";accessProfile:AccessProfile;pagePermissions:string[];productivityScopes:string[];teamScopes:string[];canManageBonusWorkflow:boolean;mustChangePassword:boolean};
type Option={key:string;label:string;detail:string};

const PAGE_OPTIONS:Option[]=[
  {key:"reporting",label:"Reporting principal",detail:"Performance opérationnelle du reporting"},
  {key:"productivity",label:"Productivité",detail:"Productivité par secteur, équipe et collaborateur"},
  {key:"monthly_animation",label:"Animation mensuelle",detail:"Primes, workflow, validations et historique figé"},
  {key:"book",label:"Book / CA / goulots",detail:"Dashboard, goulots, Walking Dead, chiffre d'affaires et Book"},
  {key:"cockpit",label:"CRVO Cockpit V2",detail:"Pilotage, synthèse, décisions et prévisions"},
  {key:"bodyshop",label:"Focus carrosserie",detail:"Cockpit spécifique carrosserie"},
  {key:"client_dashboard",label:"Dashboard client",detail:"Vues Réseau et BMW / MINI"},
  {key:"intelligence",label:"Analyse / intelligence",detail:"Analyses et aide à la décision"},
  {key:"settings",label:"Paramètres métier",detail:"Objectifs, seuils, sources et connexions"},
  {key:"data_rh",label:"Data RH",detail:"Imports RH, temps facturés, CA et OR en cours"},
];
const SCOPE_OPTIONS:Option[]=[
  {key:"expertise",label:"Expertise",detail:"Expertise + expertise dynamique"},{key:"qualite",label:"Qualité",detail:"Qualité + opérateurs qualité"},{key:"mecanique",label:"Mécanique",detail:"Mécanique"},{key:"carrosserie",label:"Carrosserie",detail:"Fixline, Box et tôlerie"},{key:"dsp",label:"DSP",detail:"DSP"},{key:"preparation",label:"Préparation",detail:"Préparation"},{key:"photo",label:"Photo",detail:"Photo"},{key:"jantes",label:"Jantes",detail:"Jantes"},{key:"lavage",label:"Lavage",detail:"Lavage"},{key:"magasin",label:"Magasin",detail:"Magasin, acheteurs et labo peinture"},{key:"diagnostic",label:"Diagnostic",detail:"Transverse / diagnostic"},{key:"jockey",label:"Jockey",detail:"Jockey"},{key:"encadrement",label:"Encadrement",detail:"Chefs d'équipe"},{key:"administratif",label:"Administratif",detail:"Administratif"},{key:"autre",label:"Autre / entretien",detail:"Entretien et autres"},
];
const TEAM_OPTIONS:Option[]=[
  {key:"A",label:"Équipe A",detail:"Collaborateurs affectés à l'équipe A"},
  {key:"B",label:"Équipe B",detail:"Collaborateurs affectés à l'équipe B"},
  {key:"C",label:"Équipe C",detail:"Collaborateurs affectés à l'équipe C"},
  {key:"J",label:"Journée / transverse",detail:"Équipe ou organisation de journée"},
];
const ALL_PAGES=PAGE_OPTIONS.map(item=>item.key);
const SERVICE_MANAGER_PAGES=ALL_PAGES.filter(key=>key!=="settings"&&key!=="data_rh");

function generatePassword(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);return Array.from(bytes,b=>chars[b%chars.length]).join("");}
function profileLabel(value:AccessProfile){return value==="admin"?"ADMIN":value==="service_manager"?"CHEF DE SERVICE":value==="team_manager"?"CHEF D'ÉQUIPE":"ACCÈS PERSONNALISÉ";}
function hasAll(values:string[]|undefined){return Boolean(values?.includes("*"));}
function labelList(values:string[]|undefined,options:Option[],allLabel="Tous"){if(hasAll(values))return allLabel;const set=new Set(values??[]);return options.filter(item=>set.has(item.key)).map(item=>item.label).join(", ")||"Aucun";}
function toggle(values:string[],key:string){return values.includes(key)?values.filter(item=>item!==key):[...values.filter(item=>item!=="*"),key];}

export default function AccountPage(){
  const [me,setMe]=useState<Me|null>(null);const [users,setUsers]=useState<User[]>([]);const [error,setError]=useState("");const [notice,setNotice]=useState("");const [currentPassword,setCurrentPassword]=useState("");const [newPassword,setNewPassword]=useState("");
  const [username,setUsername]=useState("");const [displayName,setDisplayName]=useState("");const [temporaryPassword,setTemporaryPassword]=useState(generatePassword());const [accessProfile,setAccessProfile]=useState<AccessProfile>("custom");const [pagePermissions,setPagePermissions]=useState<string[]>(["productivity"]);const [productivityScopes,setProductivityScopes]=useState<string[]>(["*"]);const [teamScopes,setTeamScopes]=useState<string[]>([]);
  const [editing,setEditing]=useState<User|null>(null);const [editProfile,setEditProfile]=useState<AccessProfile>("custom");const [editPages,setEditPages]=useState<string[]>([]);const [editScopes,setEditScopes]=useState<string[]>(["*"]);const [editTeams,setEditTeams]=useState<string[]>([]);

  async function load(){const response=await fetch("/api/auth/me",{cache:"no-store"});if(!response.ok){location.href="/login";return;}const payload=await response.json();setMe(payload.user);if(payload.user.role==="admin"){const usersResponse=await fetch("/api/auth/users",{cache:"no-store"});if(usersResponse.ok){const data=await usersResponse.json();setUsers(data.users??[]);}}}
  useEffect(()=>{void load();},[]);

  function applyCreateProfile(profile:AccessProfile){
    setAccessProfile(profile);
    if(profile==="admin"){setPagePermissions(["*"]);setProductivityScopes(["*"]);setTeamScopes(["*"]);}
    else if(profile==="service_manager"){setPagePermissions(SERVICE_MANAGER_PAGES);if(!productivityScopes.length)setProductivityScopes(["*"]);setTeamScopes(["*"]);}
    else if(profile==="team_manager"){setPagePermissions(["reporting","productivity","monthly_animation"]);setProductivityScopes(current=>hasAll(current)?[]:current);setTeamScopes(current=>hasAll(current)?[]:current);}
    else{setPagePermissions(current=>hasAll(current)?["productivity"]:current);setTeamScopes(current=>hasAll(current)?[]:current);}
  }
  function applyEditProfile(profile:AccessProfile){
    setEditProfile(profile);
    if(profile==="admin"){setEditPages(["*"]);setEditScopes(["*"]);setEditTeams(["*"]);}
    else if(profile==="service_manager"){setEditPages(SERVICE_MANAGER_PAGES);if(!editScopes.length)setEditScopes(["*"]);setEditTeams(["*"]);}
    else if(profile==="team_manager"){setEditPages(["reporting","productivity","monthly_animation"]);setEditScopes(current=>hasAll(current)?[]:current);setEditTeams(current=>hasAll(current)?[]:current);}
    else{setEditPages(current=>hasAll(current)?["productivity"]:current);setEditTeams(current=>hasAll(current)?[]:current);}
  }
  function openRights(user:User){setEditing(user);setEditProfile(user.access_profile??(user.role==="admin"?"admin":"custom"));setEditPages(user.role==="admin"?["*"]:(user.page_permissions??[]));setEditScopes(user.role==="admin"?["*"]:(user.productivity_scopes??[]));setEditTeams(user.role==="admin"?["*"]:(user.team_scopes??[]));setTimeout(()=>document.getElementById("rights-editor")?.scrollIntoView({behavior:"smooth",block:"start"}),0);}

  async function changePassword(event:FormEvent){event.preventDefault();setError("");setNotice("");const response=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Modification impossible.");return;}setCurrentPassword("");setNewPassword("");setNotice("Mot de passe modifié.");await load();}
  async function createUser(event:FormEvent){event.preventDefault();setError("");setNotice("");const response=await fetch("/api/auth/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,displayName,temporaryPassword,accessProfile,pagePermissions,productivityScopes,teamScopes})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Création impossible.");return;}setNotice(`Accès créé pour ${displayName||username}. Les périmètres sont appliqués côté serveur dès la première connexion.`);setUsername("");setDisplayName("");setTemporaryPassword(generatePassword());setAccessProfile("custom");setPagePermissions(["productivity"]);setProductivityScopes(["*"]);setTeamScopes([]);await load();}
  async function saveRights(){if(!editing)return;setError("");setNotice("");const response=await fetch("/api/auth/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update-access",userId:editing.id,accessProfile:editProfile,pagePermissions:editPages,productivityScopes:editScopes,teamScopes:editTeams})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Modification impossible.");return;}setNotice(`Droits mis à jour pour ${editing.display_name}. Sa session active a été révoquée afin d'appliquer immédiatement le nouveau périmètre.`);setEditing(null);await load();}
  async function toggleUser(user:User){setError("");const response=await fetch("/api/auth/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set-active",userId:user.id,active:!user.is_active})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Modification impossible.");return;}await load();}
  async function resetPassword(user:User){const value=prompt(`Nouveau mot de passe temporaire pour ${user.display_name}`,generatePassword());if(!value)return;setError("");const response=await fetch("/api/auth/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reset-password",userId:user.id,temporaryPassword:value})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Réinitialisation impossible.");return;}setNotice(`Mot de passe réinitialisé pour ${user.display_name}. Pense à lui transmettre le mot de passe temporaire.`);await load();}

  const active=useMemo(()=>users.filter(user=>user.is_active).length,[users]);
  if(!me)return <main className={styles.loading}>Chargement du compte…</main>;
  const myPages=me.role==="admin"?["*"]:me.pagePermissions;const myScopes=me.role==="admin"?["*"]:me.productivityScopes;const myTeams=me.role==="admin"?["*"]:me.teamScopes;

  const permissionPicker=(values:string[],setter:(next:string[])=>void,disabled:boolean)=><div className={styles.optionGrid}>{PAGE_OPTIONS.map(item=><label key={item.key} className={`${styles.optionCard} ${values.includes(item.key)||hasAll(values)?styles.selected:""}`}><input type="checkbox" disabled={disabled} checked={values.includes(item.key)||hasAll(values)} onChange={()=>setter(toggle(values,item.key))}/><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div>;
  const scopePicker=(values:string[],setter:(next:string[])=>void,disabled:boolean,allowAll=true)=><>{allowAll&&<label className={`${styles.allScope} ${hasAll(values)?styles.selected:""}`}><input type="checkbox" disabled={disabled} checked={hasAll(values)} onChange={()=>setter(hasAll(values)?[]:["*"])}/><span><strong>Tous les secteurs</strong><small>Accès à tout le périmètre métier</small></span></label>}<div className={styles.optionGrid}>{SCOPE_OPTIONS.map(item=><label key={item.key} className={`${styles.optionCard} ${hasAll(values)||values.includes(item.key)?styles.selected:""}`}><input type="checkbox" disabled={disabled||hasAll(values)} checked={hasAll(values)||values.includes(item.key)} onChange={()=>setter(toggle(values,item.key))}/><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div></>;
  const teamPicker=(values:string[],setter:(next:string[])=>void,disabled:boolean)=><div className={styles.optionGrid}>{TEAM_OPTIONS.map(item=><label key={item.key} className={`${styles.optionCard} ${hasAll(values)||values.includes(item.key)?styles.selected:""}`}><input type="checkbox" disabled={disabled||hasAll(values)} checked={hasAll(values)||values.includes(item.key)} onChange={()=>setter(toggle(values,item.key))}/><span><strong>{item.label}</strong><small>{item.detail}</small></span></label>)}</div>;

  return <main className={styles.page}>
    <header><div><a href="/">← RETOUR AU REPORTING</a><span>ADMINISTRATION CRVO</span><h1>Mon compte</h1><p>{me.displayName} · {profileLabel(me.accessProfile)}</p></div>{me.mustChangePassword&&<strong>CHANGEMENT DE MOT DE PASSE REQUIS</strong>}</header>
    {error&&<div className={styles.error}>{error}</div>}{notice&&<div className={styles.notice}>{notice}</div>}

    <section className={styles.myAccess}><div><span>MES ACCÈS</span><h2>{profileLabel(me.accessProfile)}</h2>{me.canManageBonusWorkflow&&<p><b>OUVERTURE / CLÔTURE PAYPLAN : AUTORISÉE</b></p>}</div><div><b>Pages visibles</b><p>{me.role==="admin"?"Accès total, paramètres inclus":labelList(myPages,PAGE_OPTIONS)}</p></div><div><b>Périmètre</b><p>{labelList(myScopes,SCOPE_OPTIONS,"Tous secteurs")} · {labelList(myTeams,TEAM_OPTIONS,"Toutes équipes")}</p></div></section>

    <section className={styles.grid}>
      <article className={styles.card}><span>SÉCURITÉ</span><h2>Changer mon mot de passe</h2><form onSubmit={changePassword}><label>Mot de passe actuel<input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} autoComplete="current-password"/></label><label>Nouveau mot de passe<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" placeholder="12 caractères minimum"/></label><button disabled={!currentPassword||newPassword.length<12}>ENREGISTRER</button></form></article>
      {me.role==="admin"&&<article className={`${styles.card} ${styles.createCard}`}><span>GESTION DES ACCÈS</span><h2>Créer un utilisateur</h2><form onSubmit={createUser}><div className={styles.twoCols}><label>Nom affiché<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Ex. Yohan VELLE"/></label><label>Identifiant<input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="Ex. yohan.velle"/></label></div><label>Profil d'accès<select value={accessProfile} onChange={e=>applyCreateProfile(e.target.value as AccessProfile)}><option value="custom">Accès personnalisé</option><option value="team_manager">Chef d'équipe · son équipe</option><option value="service_manager">Chef de service · son service</option><option value="admin">ADMIN · accès total</option></select></label><fieldset><legend>Pages visibles</legend><p>{accessProfile==="admin"?"ADMIN : toutes les pages et paramètres.":accessProfile==="service_manager"?"Chef de service : pages opérationnelles ; paramètres métier et Data RH restent attribuables explicitement.":accessProfile==="team_manager"?"Chef d'équipe : Reporting, Productivité et Animation mensuelle par défaut.":"Sélection libre des pages."}</p>{permissionPicker(pagePermissions,setPagePermissions,accessProfile==="admin")}</fieldset><fieldset><legend>Périmètre métier</legend><p>Les données Productivité et Animation Variable sont filtrées côté serveur selon ces secteurs.</p>{scopePicker(productivityScopes,setProductivityScopes,accessProfile==="admin")}</fieldset>{accessProfile==="team_manager"&&<fieldset><legend>Équipe(s) visible(s)</legend><p>Un Chef d'équipe ne voit que les collaborateurs des équipes sélectionnées, à l'intérieur de ses secteurs autorisés.</p>{teamPicker(teamScopes,setTeamScopes,false)}</fieldset>}<label>Mot de passe temporaire<div className={styles.passwordRow}><input value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)} minLength={12}/><button type="button" onClick={()=>setTemporaryPassword(generatePassword())}>GÉNÉRER</button></div></label><button disabled={!username||!displayName||temporaryPassword.length<12}>CRÉER L'ACCÈS</button></form></article>}
    </section>

    {me.role==="admin"&&<section className={styles.users}><div className={styles.usersHead}><div><span>UTILISATEURS</span><h2>Accès & périmètres</h2></div><b>{active} ACTIF{active>1?"S":""}</b></div><div className={styles.userList}>{users.map(user=><article key={user.id}><div className={styles.userIdentity}><span className={user.is_active?styles.online:styles.offline}/><div><strong>{user.display_name}</strong><small>{user.username}</small></div></div><div><b>{profileLabel(user.access_profile)}</b><small>{user.role==="admin"?"Toutes pages":labelList(user.page_permissions,PAGE_OPTIONS)}</small><small>{user.role==="admin"?"Tous secteurs / toutes équipes":`${labelList(user.productivity_scopes,SCOPE_OPTIONS,"Tous secteurs")} · ${labelList(user.team_scopes,TEAM_OPTIONS,"Toutes équipes")}`}</small></div><div className={styles.userMeta}><small>Dernière connexion</small><span>{user.last_login_at?new Date(user.last_login_at).toLocaleString("fr-FR"):"Jamais"}</span></div><div className={styles.userActions}><button onClick={()=>openRights(user)}>DROITS</button><button onClick={()=>resetPassword(user)}>MDP</button><button className={user.is_active?styles.danger:styles.success} onClick={()=>toggleUser(user)}>{user.is_active?"DÉSACTIVER":"ACTIVER"}</button></div></article>)}</div></section>}

    {editing&&me.role==="admin"&&<section id="rights-editor" className={styles.rights}><div className={styles.rightsHead}><div><span>PÉRIMÈTRE UTILISATEUR</span><h2>{editing.display_name}</h2><p>{editing.username}</p></div><button onClick={()=>setEditing(null)}>FERMER</button></div><div className={styles.rightsGrid}><label>Profil d'accès<select value={editProfile} onChange={e=>applyEditProfile(e.target.value as AccessProfile)}><option value="custom">Accès personnalisé</option><option value="team_manager">Chef d'équipe · son équipe</option><option value="service_manager">Chef de service · son service</option><option value="admin">ADMIN · accès total</option></select></label><div><b>Pages visibles</b>{permissionPicker(editPages,setEditPages,editProfile==="admin")}</div><div><b>Périmètre métier</b>{scopePicker(editScopes,setEditScopes,editProfile==="admin")}</div>{editProfile==="team_manager"&&<div><b>Équipe(s)</b>{teamPicker(editTeams,setEditTeams,false)}</div>}</div><button className={styles.saveRights} onClick={saveRights}>ENREGISTRER LES DROITS</button></section>}
  </main>;
}
