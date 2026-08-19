"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type Me = {
  role?: "admin" | "user";
  accessProfile?: string;
  pagePermissions?: string[];
};

type ManagedUser = {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  access_profile?: string;
  last_login_at?: string | null;
  must_change_password?: boolean;
};

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%_-";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

function dateLabel(value?: string | null) {
  if (!value) return "Jamais connecté";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Jamais connecté" : new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export default function TransphereAccessManager() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const onAccount = pathname === "/account";
  const onTransphere = pathname.startsWith("/transphere");

  async function loadUsers() {
    const response = await fetch("/api/auth/users", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({})) as { users?: ManagedUser[] };
    setUsers((payload.users ?? []).filter((user) => user.access_profile === "transphere"));
  }

  useEffect(() => {
    if (!onAccount && !onTransphere) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const payload = await response.json().catch(() => ({})) as { user?: Me };
      if (cancelled) return;
      setMe(payload.user ?? null);
      if (onAccount && payload.user?.role === "admin") await loadUsers();
    })();
    return () => { cancelled = true; };
  }, [onAccount, onTransphere]);

  useEffect(() => {
    if (!onTransphere || !me || me.role === "admin") return;
    document.body.classList.add("transphere-readonly-user");
    const rename = () => {
      document.querySelectorAll(".transphere-shell small").forEach((node) => {
        if (node.textContent?.trim() === "ENVIRONNEMENT ADMINISTRATEUR") node.textContent = "ENVIRONNEMENT TRANSPHÈRE";
      });
    };
    rename();
    const timer = window.setTimeout(rename, 300);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove("transphere-readonly-user");
    };
  }, [onTransphere, me]);

  const activeCount = useMemo(() => users.filter((user) => user.is_active).length, [users]);

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    const password = temporaryPassword || generatePassword();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          temporaryPassword: password,
          accessProfile: "transphere",
          pagePermissions: ["transphere"],
          productivityScopes: [],
          teamScopes: [],
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Création impossible.");
      setTemporaryPassword(password);
      setNotice(`Compte créé. Mot de passe temporaire : ${password}`);
      setDisplayName(""); setUsername("");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Création impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleUser(user: ManagedUser) {
    setError(""); setNotice("");
    const response = await fetch("/api/auth/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-active", userId: user.id, active: !user.is_active }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(payload.error || "Modification impossible."); return; }
    await loadUsers();
  }

  async function resetPassword(user: ManagedUser) {
    const password = generatePassword();
    if (!window.confirm(`Réinitialiser le mot de passe de ${user.display_name} ?`)) return;
    const response = await fetch("/api/auth/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password", userId: user.id, temporaryPassword: password }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setError(payload.error || "Réinitialisation impossible."); return; }
    setTemporaryPassword(password);
    setNotice(`Mot de passe temporaire pour ${user.display_name} : ${password}`);
    await loadUsers();
  }

  if (!onAccount && !onTransphere) return null;

  return <>
    <style>{`
      body.transphere-readonly-user .transphere-shell [class*="importLabel"] { display:none !important; }
      .transphere-access-launcher{position:fixed;right:22px;bottom:22px;z-index:2147482500;border:0;border-radius:18px;background:#003a78;color:#fff;padding:13px 17px;box-shadow:0 12px 36px rgba(0,45,85,.25);font:800 12px Exo,Arial,sans-serif;cursor:pointer;text-align:left}
      .transphere-access-launcher span{display:block;color:#70ddd4;font-size:9px;letter-spacing:.08em;margin-bottom:3px}
      .transphere-access-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,31,61,.42);display:grid;place-items:center;padding:24px}
      .transphere-access-modal{width:min(920px,96vw);max-height:88vh;overflow:auto;background:#f7fbfd;border-radius:24px;border:1px solid #d6e7ef;box-shadow:0 30px 80px rgba(0,32,64,.3);padding:24px;color:#092f55;font-family:Exo,Arial,sans-serif}
      .transphere-access-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.transphere-access-head img{width:150px;height:auto}.transphere-access-head h2{margin:3px 0 5px;font-size:25px;font-style:italic}.transphere-access-head p{margin:0;color:#617b91;font-size:12px}.transphere-access-close{border:0;background:#e8f1f6;color:#003a78;width:38px;height:38px;border-radius:12px;font-size:24px;cursor:pointer}
      .transphere-access-rule{margin:18px 0;padding:13px 15px;border-radius:13px;background:#eef9f8;border-left:5px solid #0aa99f;font-size:12px;line-height:1.5}.transphere-access-rule b{color:#003a78}
      .transphere-access-form{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:10px;align-items:end;background:#fff;border:1px solid #dce8ee;border-radius:17px;padding:15px}.transphere-access-form label{display:grid;gap:5px;font-size:9px;font-weight:800;letter-spacing:.07em;color:#617b91}.transphere-access-form input{height:40px;border:1px solid #cbdce6;border-radius:10px;padding:0 11px;font:600 12px Exo,Arial,sans-serif;color:#092f55}.transphere-access-form button{height:40px;border:0;border-radius:10px;background:#0055a5;color:#fff;font:800 11px Exo,Arial,sans-serif;padding:0 15px;cursor:pointer}
      .transphere-access-message{margin-top:10px;border-radius:11px;padding:10px 12px;font-size:11px}.transphere-access-message.ok{background:#e9f8f3;color:#176b53}.transphere-access-message.err{background:#fff0ef;color:#a93934}
      .transphere-access-list-head{display:flex;justify-content:space-between;align-items:end;margin:20px 0 8px}.transphere-access-list-head h3{margin:0;font-size:16px}.transphere-access-list-head span{font-size:10px;color:#71889a}
      .transphere-access-user{display:grid;grid-template-columns:1.6fr 1fr .8fr auto;gap:12px;align-items:center;background:#fff;border:1px solid #dce8ee;border-radius:13px;padding:11px 13px;margin-top:7px}.transphere-access-user strong{display:block;font-size:12px}.transphere-access-user small{display:block;color:#72889a;font-size:9px;margin-top:3px}.transphere-access-state{font-size:9px;font-weight:800;color:#17815e}.transphere-access-state.off{color:#a54a44}.transphere-access-actions{display:flex;gap:6px}.transphere-access-actions button{border:1px solid #cbdce6;background:#f7fbfd;color:#003a78;border-radius:8px;padding:7px 9px;font:800 9px Exo,Arial,sans-serif;cursor:pointer}
      @media(max-width:760px){.transphere-access-form{grid-template-columns:1fr}.transphere-access-user{grid-template-columns:1fr}.transphere-access-launcher{right:12px;bottom:12px}}
    `}</style>

    {onAccount && me?.role === "admin" && <button className="transphere-access-launcher" type="button" onClick={() => { setOpen(true); setError(""); setNotice(""); if (!temporaryPassword) setTemporaryPassword(generatePassword()); }}>
      <span>GESTION DES ACCÈS</span>
      TRANSPHÈRE · {activeCount} compte{activeCount > 1 ? "s" : ""}
    </button>}

    {open && onAccount && me?.role === "admin" && <div className="transphere-access-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section className="transphere-access-modal">
        <div className="transphere-access-head">
          <div><img src="/transphere-logo.svg" alt="Transphère"/><h2>Identifiants Transphère uniquement</h2><p>Créer et administrer des comptes dédiés au pilotage Transphère.</p></div>
          <button className="transphere-access-close" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
        </div>
        <div className="transphere-access-rule"><b>Périmètre verrouillé :</b> dashboard Transphère + reporting quotidien. Aucun accès aux pages, données ou réglages CRVO. L’import du Book Transphère reste réservé aux administrateurs globaux.</div>
        <form className="transphere-access-form" onSubmit={createAccount}>
          <label>NOM AFFICHÉ<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ex. Thomas Gestin" required/></label>
          <label>IDENTIFIANT<input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="prenom.nom" required/></label>
          <label>MOT DE PASSE TEMPORAIRE<input value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} minLength={12} required/></label>
          <button type="submit" disabled={loading || temporaryPassword.length < 12}>{loading ? "CRÉATION…" : "CRÉER L'ACCÈS"}</button>
        </form>
        {notice && <div className="transphere-access-message ok">{notice} <button type="button" onClick={() => void navigator.clipboard?.writeText(temporaryPassword)} style={{marginLeft:8}}>Copier</button></div>}
        {error && <div className="transphere-access-message err">{error}</div>}
        <div className="transphere-access-list-head"><h3>Comptes Transphère</h3><span>{activeCount} actif{activeCount > 1 ? "s" : ""} · {users.length} au total</span></div>
        {users.length === 0 ? <div className="transphere-access-rule">Aucun compte dédié Transphère pour le moment.</div> : users.map((user) => <div className="transphere-access-user" key={user.id}>
          <div><strong>{user.display_name}</strong><small>{user.username}</small></div>
          <div><span className={`transphere-access-state ${user.is_active ? "" : "off"}`}>{user.is_active ? "ACTIF" : "DÉSACTIVÉ"}</span><small>{user.must_change_password ? "Mot de passe à changer" : "Mot de passe validé"}</small></div>
          <div><strong>Dernière connexion</strong><small>{dateLabel(user.last_login_at)}</small></div>
          <div className="transphere-access-actions"><button type="button" onClick={() => void resetPassword(user)}>Nouveau MDP</button><button type="button" onClick={() => void toggleUser(user)}>{user.is_active ? "Désactiver" : "Réactiver"}</button></div>
        </div>)}
      </section>
    </div>}
  </>;
}
