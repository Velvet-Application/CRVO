import styles from "./toolbox-domain.module.css";

export type ToolboxDomainItem={href:string;label:string;description:string;kicker:string;section?:string;footer?:string};

type Props={eyebrow:string;title:string;description:string;code:string;items:ToolboxDomainItem[];sessionLabel:string};

export default function ToolboxDomainPage({eyebrow,title,description,code,items,sessionLabel}:Props){
  const sections=Array.from(new Set(items.map(item=>item.section||"Accès directs")));
  return <main className={styles.page}>
    <div className={styles.shell}>
      <a className={styles.back} href="/">← RETOUR À TOOLBOX CRVO LENS</a>
      <header className={styles.hero}>
        <div className={styles.heroText}><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
        <div className={styles.code}>{code}</div>
      </header>
      {items.length?sections.map(section=>{
        const rows=items.filter(item=>(item.section||"Accès directs")===section);
        return <section className={styles.section} key={section}>
          <div className={styles.sectionHead}><div><span>TOOLBOX CRVO LENS</span><h2>{section}</h2></div><span>{rows.length} accès</span></div>
          <div className={styles.grid}>{rows.map(item=><a className={styles.card} href={item.href} key={`${section}:${item.href}:${item.label}`}>
            <div className={styles.cardTop}><span>{item.kicker}</span><i>›</i></div>
            <h3>{item.label}</h3><p>{item.description}</p><footer>{item.footer||"Ouvrir l’outil"}</footer>
          </a>)}</div>
        </section>;
      }):<div className={styles.empty}>Aucun outil n’est actuellement autorisé sur ce périmètre.</div>}
      <footer className={styles.foot}><span>Session : {sessionLabel}</span><a href="/account">Mon compte & accès</a></footer>
    </div>
  </main>;
}
