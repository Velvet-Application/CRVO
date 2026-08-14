"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./account.module.css";

type User = { id:string; username:string; display_name:string; role:"admin"|"user"; is_active:boolean; must_change_password:boolean; created_at:string; last_login_at:string|null };
type Me = { id:string; username:string; displayName:string; role:"admin"|"user"; mustChangePassword:boolean };

function generatePassword(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";
  const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>chars[b%chars.length]).join("");
}

export default function AccountPage(){
  const [me,setMe]=useState<Me|null>(null);const [users,setUsers]=useState<User[]>([]);const [error,setError]=useState("");const [notice,setNotice]=useState("");const [currentPassword,setCurrentPassword]=useState("");const [newPassword,setNewPassword]=useState("");
  const [username,setUsername]=useState("");const [displayName,setDisplayName]=useState("");const [role,setRole]=useState<"admin"|"user">("user");const [temporaryPassword,setTemporaryPassword]=useState(generatePassword());

  async function load(){
    const response=await fetch("/api/auth/me",{cache:"no-store"});if(!response.ok){location.href="/login";return;}const payload=await response.json();setMe(payload.user);
    if(payload.user.role==="admin"){const usersResponse=await fetch("/api/auth/users",{cache:"no-store"});if(usersResponse.ok){const data=await usersResponse.json();setUsers(data.users??[]);}}
  }
  useEffect(()=>{void load();},[]);

  async function changePassword(event:FormEvent){event.preventDefault();setError("");setNotice("");const response=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Modification impossible.");return;}setCurrentPassword("");setNewPassword("");setNotice("Mot de passe modifié.");await load();}

  async function createUser(event:FormEvent){event.preventDefault();setError("");setNotice("");const response=await fetch("/api/auth/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,displayName,temporaryPassword,role})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Création impossible.");return;}setNotice(`Accès créé pour ${displayName||username}. Le mot de passe temporaire devra être changé à la première connexion.`);setUsername("");setDisplayName("");setRole("user");setTemporaryPassword(generatePassword());await load();}

  async function toggleUser(user:User){setError("");const response=await fetch("/api/auth/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set-active",userId:user.id,active:!user.is_active})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Modification impossible.");return;}await load();}

  async function resetPassword(user:User){const value=prompt(`Nouveau mot de passe temporaire pour ${user.display_name}`,generatePassword());if(!value)return;setError("");const response=await fetch("/api/auth/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reset-password",userId:user.id,temporaryPassword:value})});const payload=await response.json().catch(()=>({}));if(!response.ok){setError(payload.error||"Réinitialisation impossible.");return;}setNotice(`Mot de passe réinitialisé pour ${user.display_name}. Pense à lui transmettre le mot de passe temporaire.`);await load();}

  const active=useMemo(()=>users.filter(user=>user.is_active).length,[users]);
  if(!me)return <main className={styles.loading}>Chargement du compte…</main>;
  return <main className={styles.page}>
    <header><div><a href="/">← RETOUR AU REPORTING</a><span>ADMINISTRATION CRVO</span><h1>Mon compte</h1><p>{me.displayName} · {me.role==="admin"?"Administrateur":"Utilisateur"}</p></div>{me.mustChangePassword&&<strong>CHANGEMENT DE MOT DE PASSE REQUIS</strong>}</header>
    {error&&<div className={styles.error}>{error}</div>}{notice&&<div className={styles.notice}>{notice}</div>}
    <section className={styles.grid}>
      <article className={styles.card}><span>SÉCURITÉ</span><h2>Changer mon mot de passe</h2><form onSubmit={changePassword}><label>Mot de passe actuel<input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} autoComplete="current-password"/></label><label>Nouveau mot de passe<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" placeholder="12 caractères minimum"/></label><button disabled={!currentPassword||newPassword.length<12}>ENREGISTRER</button></form></article>
      {me.role==="admin"&&<article className={styles.card}><span>GESTION DES ACCÈS</span><h2>Créer un utilisateur</h2><form onSubmit={createUser}><label>Nom affiché<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Ex. Marie Dupont"/></label><label>Identifiant<input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="Ex. marie.dupont"/></label><label>Rôle<select value={role} onChange={e=>setRole(e.target.value as "admin"|"user")}><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></label><label>Mot de passe temporaire<div className={styles.passwordRow}><input value={temporaryPassword} onChange={e=>setTemporaryPassword(e.target.value)}/><button type="button" onClick={()=>setTemporaryPassword(generatePassword())}>GÉNÉRER</button></div></label><button disabled={!username||temporaryPassword.length<12}>CRÉER L'ACCÈS</button></form></article>}
    </section>
    {me.role==="admin"&&<section className={styles.users}><div className={styles.usersHead}><div><span>UTILISATEURS AUTORISÉS</span><h2>{active} accès actifs</h2></div><small>Tu peux désactiver un accès immédiatement ou imposer un nouveau mot de passe.</small></div><div className={styles.userTable}>{users.map(user=><div key={user.id} className={!user.is_active?styles.disabled:""}><div><strong>{user.display_name}</strong><span>{user.username} · {user.role==="admin"?"Administrateur":"Utilisateur"}</span></div><em>{user.is_active?"ACTIF":"DÉSACTIVÉ"}</em><small>{user.must_change_password?"Mot de passe à changer":user.last_login_at?`Dernière connexion ${new Date(user.last_login_at).toLocaleString("fr-FR")}`:"Jamais connecté"}</small><div className={styles.actions}><button onClick={()=>resetPassword(user)}>RÉINITIALISER MDP</button><button onClick={()=>toggleUser(user)}>{user.is_active?"DÉSACTIVER":"RÉACTIVER"}</button></div></div>)}</div></section>}
  </main>;
}
