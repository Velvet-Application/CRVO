"use client";

import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {parkingPointForLocation} from "./parking-zone-coordinates";
import styles from "./global-search.module.css";

type SearchKind="vehicle"|"claim"|"client"|"person";
type QuickLocation={location:string;sourceModifiedAt:string|null;site:string|null};
type SearchResult={id:string;kind:SearchKind;eyebrow:string;title:string;subtitle:string;href:string;sourceLabel:string;badges:string[];summary:Array<{label:string;value:string}>;quickLocation?:QuickLocation|null};
type SearchPayload={query:string;results:SearchResult[];total:number;error?:string};

const kindIcon:Record<SearchKind,string>={vehicle:"VO",claim:"RQ",client:"CL",person:"RH"};

function VehicleQuickLocation({location}:{location:QuickLocation}){
  const point=parkingPointForLocation(location.location);
  if(!point)return null;
  return <div className={styles.quickLocation}>
    <div className={styles.quickLocationInfo}>
      <span><i/> EN PRODUCTION</span>
      <strong>{location.location}</strong>
      <small>Position parc issue du dernier relevé FTP</small>
      <b>Voir immédiatement où se trouve le véhicule</b>
    </div>
    <div className={styles.quickLocationMap} aria-label={`Position ${location.location} sur le parc`}>
      <span className={styles.quickLocationPin} style={{left:`clamp(12px, ${point.x}%, calc(100% - 12px))`,top:`clamp(12px, ${point.y}%, calc(100% - 12px))`}}>
        <i/>
        <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 24l5-9c1-2 3-3 5-3h12c2 0 4 1 5 3l5 9 5 3c2 1 3 3 3 5v11c0 2-1 3-3 3h-2v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3H22v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3h-2c-2 0-3-1-3-3V32c0-2 1-4 3-5l5-3zm7-5l-3 7h24l-3-7c-.5-1-1-1-2-1H25c-1 0-2 0-2 1zm-6 13a4 4 0 100 8 4 4 0 000-8zm30 0a4 4 0 100 8 4 4 0 000-8z"/></svg>
      </span>
      <span className={styles.quickLocationCode}>{point.key}</span>
    </div>
  </div>;
}

export default function GlobalSearch(){
  const pathname=usePathname();
  const root=useRef<HTMLDivElement|null>(null);
  const input=useRef<HTMLInputElement|null>(null);
  const[query,setQuery]=useState("");
  const[results,setResults]=useState<SearchResult[]>([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[open,setOpen]=useState(false);

  useEffect(()=>{setOpen(false);},[pathname]);
  useEffect(()=>{
    const onPointer=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false);};
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){setOpen(false);input.current?.blur();}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();input.current?.focus();setOpen(true);}
    };
    document.addEventListener("pointerdown",onPointer);window.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("pointerdown",onPointer);window.removeEventListener("keydown",onKey);};
  },[]);
  useEffect(()=>{
    const q=query.trim();
    if(q.length<2){setResults([]);setError("");setLoading(false);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setLoading(true);setError("");
      try{
        const response=await fetch(`/api/global-search?q=${encodeURIComponent(q)}`,{cache:"no-store",signal:controller.signal});
        const payload=await response.json().catch(()=>null) as SearchPayload|null;
        if(!response.ok)throw new Error(payload?.error||"Recherche indisponible");
        setResults(payload?.results??[]);setOpen(true);
      }catch(caught){if((caught as Error)?.name!=="AbortError"){setResults([]);setError(caught instanceof Error?caught.message:"Recherche indisponible");setOpen(true);}}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },260);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[query]);

  const visible=open&&(query.trim().length>=2||loading);
  return <div className={styles.globalSearch} ref={root}>
    <div className={`${styles.searchField} ${open?styles.searchFieldOpen:""}`}>
      <span className={styles.searchGlyph} aria-hidden="true">⌕</span>
      <input ref={input} value={query} onChange={event=>{setQuery(event.target.value);setOpen(true);}} onFocus={()=>{if(query.trim().length>=2)setOpen(true);}} placeholder="Immat., VIN, OR, réclamation, collaborateur, client…" aria-label="Recherche globale CRVO" aria-expanded={visible}/>
      {loading?<span className={styles.searchSpinner} aria-label="Recherche en cours"/>:query?<button className={styles.searchClear} type="button" onClick={()=>{setQuery("");setResults([]);setOpen(false);input.current?.focus();}} aria-label="Effacer la recherche">×</button>:<kbd>⌘K</kbd>}
    </div>
    {visible&&<div className={styles.searchPopover} role="dialog" aria-label="Résultats de la recherche globale">
      <div className={styles.searchPopoverHead}>
        <div><span>RECHERCHE UNIFIÉE</span><strong>{loading?"Recherche dans les sources CRVO…":results.length?`${results.length} résultat${results.length>1?"s":""}`:"Aucun résultat"}</strong></div>
        <small>Cliquer sur une fiche ouvre sa source</small>
      </div>
      {error?<div className={styles.searchEmpty}><strong>Recherche indisponible</strong><span>{error}</span></div>:!loading&&results.length===0?<div className={styles.searchEmpty}><strong>Aucune correspondance</strong><span>Essaie une immatriculation, un VIN, un N° OR, une réclamation, un client ou un collaborateur.</span></div>:<div className={styles.searchResults}>
        {results.map(result=><a className={styles.searchResult} href={result.href} key={result.id} onClick={()=>setOpen(false)}>
          <span className={`${styles.searchResultIcon} ${styles[`searchKind_${result.kind}`]}`}>{kindIcon[result.kind]}</span>
          <div className={styles.searchResultBody}>
            <div className={styles.searchResultTitle}><div><small>{result.eyebrow}</small><strong>{result.title}</strong></div><span>›</span></div>
            {result.subtitle&&<p>{result.subtitle}</p>}
            {result.badges.length>0&&<div className={styles.searchBadges}>{result.badges.map((badge,index)=><b key={`${badge}-${index}`}>{badge}</b>)}</div>}
            {result.kind==="vehicle"&&result.quickLocation&&<VehicleQuickLocation location={result.quickLocation}/>}
            {result.summary.length>0&&<dl>{result.summary.slice(0,10).map(item=><div key={`${result.id}-${item.label}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
            <footer><span>Source</span><strong>{result.sourceLabel}</strong><i>Ouvrir →</i></footer>
          </div>
        </a>)}
      </div>}
    </div>}
  </div>;
}
