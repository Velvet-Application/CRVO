"use client";

import {useEffect,useState} from "react";
import {armNotificationAudio,playNotificationSound,type NotificationSoundKind,type NotificationSoundPreferences} from "../lib/notification-sound";
import styles from "./notification-sound-settings.module.css";

type Payload={preferences?:NotificationSoundPreferences;error?:string};
const OPTIONS:{key:NotificationSoundKind;name:string;detail:string;icon:string}[]=[
  {key:"crystal",name:"Cristal CRVO",detail:"Deux notes claires, élégantes et discrètes.",icon:"✦"},
  {key:"pulse",name:"Pulse",detail:"Signal électronique court, esprit Toolbox.",icon:"◉"},
  {key:"soft_ping",name:"Soft Ping",detail:"Une note ronde et très discrète.",icon:"•"},
  {key:"silent",name:"Silencieux",detail:"Conserve les pop-up sans alerte sonore.",icon:"⌁"},
];

export default function NotificationSoundSettings(){
  const[sound,setSound]=useState<NotificationSoundKind>("crystal"),[volume,setVolume]=useState(.25),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState("");
  useEffect(()=>{const disarm=armNotificationAudio();void (async()=>{try{const r=await fetch(`/api/notification-sound?_=${Date.now()}`,{cache:"no-store"});const p=await r.json() as Payload;if(r.ok&&p.preferences){setSound(p.preferences.sound);setVolume(Number(p.preferences.volume??.25))}}catch{}finally{setLoaded(true)}})();return disarm},[]);
  async function preview(kind=sound){setError("");await playNotificationSound(kind,volume)}
  async function save(){setBusy(true);setSaved(false);setError("");try{const r=await fetch("/api/notification-sound",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({sound,volume})});const p=await r.json() as Payload;if(!r.ok)throw new Error(p.error||"Enregistrement impossible.");const next=p.preferences??{sound,volume};window.dispatchEvent(new CustomEvent("crvo-notification-sound-changed",{detail:{sound:next.sound,volume:Number(next.volume)}}));setSaved(true);window.setTimeout(()=>setSaved(false),2400)}catch(e){setError(e instanceof Error?e.message:"Enregistrement impossible.")}finally{setBusy(false)}}
  function choose(next:NotificationSoundKind){setSound(next);setSaved(false);if(next!=="silent")void preview(next)}
  return <section className={styles.zone} id="notifications"><div className={styles.panel}>
    <div className={styles.head}><div><span>RÉGLAGES · NOTIFICATIONS</span><h2>Son des nouveaux messages</h2><p>Choisis le signal joué lorsqu’un nouveau message CRVO ou Réseau arrive dans la Toolbox.</p></div><div className={styles.state}>{saved?"ENREGISTRÉ":sound==="silent"?"SILENCIEUX":"SON ACTIF"}</div></div>
    <div className={styles.choices}>{OPTIONS.map(option=><button key={option.key} type="button" className={`${styles.choice} ${sound===option.key?styles.selected:""}`} onClick={()=>choose(option.key)} disabled={!loaded||busy}><i className={styles.icon}>{option.icon}</i><span><strong>{option.name}</strong><small>{option.detail}</small></span></button>)}</div>
    <div className={styles.controls}><label className={styles.volume}><span>VOLUME <b>{Math.round(volume*100)} %</b></span><input type="range" min="0" max="1" step="0.05" value={volume} disabled={sound==="silent"||busy} onChange={e=>{setVolume(Number(e.target.value));setSaved(false)}}/></label><button className={styles.preview} type="button" onClick={()=>void preview()} disabled={!loaded||busy||sound==="silent"}>ÉCOUTER</button><button className={styles.save} type="button" onClick={()=>void save()} disabled={!loaded||busy}>{busy?"ENREGISTREMENT…":"ENREGISTRER"}</button></div>
    {error&&<div className={styles.error}>{error}</div>}<p className={styles.note}>Le réglage est lié à ton compte et te suit sur tes appareils. Les anciennes notifications ne rejouent pas de son à la connexion.</p>
  </div></section>;
}
