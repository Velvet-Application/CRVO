"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Connexion impossible.");
      const requestedNext = params.get("next");
      const next = payload.user?.mustChangePassword
        ? "/account?change=1"
        : payload.user?.clientPortal
          ? "/espace-client"
          : requestedNext || "/";
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <div className={styles.brand}><span>TOOLBOX CRVO · LENS</span><h1>Accès sécurisé</h1><p>Pilotage · Relation Client · RH · Administration · Transphère</p></div>
      <form onSubmit={submit} className={styles.form}>
        <label>Identifiant<input autoComplete="username" value={username} onChange={(event)=>setUsername(event.target.value)} autoFocus /></label>
        <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} /></label>
        {error && <div className={styles.error}>{error}</div>}
        <button disabled={loading || !username || !password}>{loading ? "CONNEXION…" : "SE CONNECTER"}</button>
      </form>
      <small>Accès réservé aux utilisateurs autorisés.</small>
    </section>
  </main>;
}
