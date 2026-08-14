"use client";

import { useEffect, useState } from "react";
import styles from "./data-rh.module.css";

type GatewayStatus = { configured?: boolean; updatedAt?: string | null; error?: string; authRequired?: boolean };
type GatewayCreate = GatewayStatus & { token?: string; oneTimeDisplay?: boolean };

export default function EmailGatewaySetup(){
  const [configured,setConfigured]=useState<boolean|null>(null);
  const [token,setToken]=useState("");
  const [message,setMessage]=useState("Chargement de la passerelle…");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    fetch("/api/email-import/token",{cache:"no-store"})
      .then(async response=>({response,payload:await response.json() as GatewayStatus}))
      .then(({response,payload})=>{
        if(!response.ok){setConfigured(false);setMessage(payload.authRequired?"Déverrouille l’accès CRVO pour administrer la clé Make.":payload.error||"Configuration indisponible.");return;}
        setConfigured(Boolean(payload.configured));
        setMessage(payload.configured?"Clé de connexion déjà configurée. Tu peux la renouveler si nécessaire.":"Aucune clé Make active pour le moment.");
      })
      .catch(()=>{setConfigured(false);setMessage("Configuration indisponible.");});
  },[]);

  async function generate(){
    setBusy(true);setToken("");setMessage("Création d’une nouvelle clé sécurisée…");
    try{
      const response=await fetch("/api/email-import/token",{method:"POST"});
      const payload=await response.json() as GatewayCreate;
      if(!response.ok||!payload.token)throw new Error(payload.error||"Création impossible.");
      setConfigured(true);setToken(payload.token);setMessage("Nouvelle clé créée. Copie-la maintenant dans Make : elle ne sera plus réaffichée après rechargement.");
    }catch(error){setMessage(error instanceof Error?error.message:"Création impossible.");}
    finally{setBusy(false);}
  }

  async function copy(){
    if(!token)return;
    try{await navigator.clipboard.writeText(token);setMessage("Clé copiée. Colle-la dans le header x-crvo-ingest-token de Make.");}
    catch{setMessage("Sélectionne la clé ci-dessous et copie-la manuellement.");}
  }

  return <section className={styles.gateway}>
    <div className={styles.gatewayTitle}><span>CLÉ DE PASSERELLE</span><h2>Connexion Make → CRVO</h2><p>La clé est stockée uniquement sous forme de SHA-256 dans la base. Une nouvelle génération invalide immédiatement l’ancienne.</p></div>
    <div className={styles.gatewayAction}>
      <div className={configured?styles.gatewayOk:styles.gatewayWait}><i/><strong>{configured?"CLÉ CONFIGURÉE":"À CONFIGURER"}</strong></div>
      <p>{message}</p>
      {token&&<div className={styles.tokenBox}><code>{token}</code><button type="button" onClick={()=>void copy()}>Copier</button></div>}
      <button className={styles.generate} type="button" disabled={busy} onClick={()=>void generate()}>{busy?"Création…":configured?"Renouveler la clé Make":"Générer la clé Make"}</button>
    </div>
  </section>;
}
