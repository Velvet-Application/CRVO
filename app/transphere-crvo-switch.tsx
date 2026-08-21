"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TransphereCrvoSwitch() {
  const pathname = usePathname();
  if (!pathname.startsWith("/transphere")) return null;

  return (
    <Link
      href="/"
      className="transphere-crvo-switch"
      aria-label="Basculer vers la ToolBox CRVO"
      title="ToolBox CRVO"
    >
      <span className="transphere-crvo-switch__mark">CRVO</span>
      <span className="transphere-crvo-switch__label">ToolBox</span>
      <span className="transphere-crvo-switch__arrow">↗</span>
      <style>{`
        .transphere-crvo-switch{
          position:fixed;
          left:14px;
          bottom:14px;
          z-index:10050;
          display:inline-flex;
          align-items:center;
          gap:7px;
          min-height:34px;
          padding:6px 9px 6px 7px;
          border:1px solid rgba(104,190,242,.26);
          border-radius:999px;
          background:rgba(2,23,45,.68);
          color:#dff5ff;
          text-decoration:none;
          font-family:Exo,Arial,sans-serif;
          font-size:9px;
          font-weight:700;
          letter-spacing:.02em;
          box-shadow:0 6px 20px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.05);
          backdrop-filter:blur(12px);
          -webkit-backdrop-filter:blur(12px);
          opacity:.62;
          transition:opacity .16s ease,transform .16s ease,border-color .16s ease,background .16s ease;
        }
        .transphere-crvo-switch:hover,.transphere-crvo-switch:focus-visible{
          opacity:1;
          transform:translateY(-1px);
          border-color:rgba(64,189,255,.72);
          background:rgba(2,30,58,.92);
          outline:none;
        }
        .transphere-crvo-switch__mark{
          display:grid;
          place-items:center;
          height:22px;
          padding:0 7px;
          border-radius:999px;
          background:linear-gradient(135deg,#0055a5,#00a7d7);
          color:#fff;
          font-size:8px;
          font-weight:900;
          letter-spacing:.08em;
        }
        .transphere-crvo-switch__label{white-space:nowrap;color:#cce9f8}
        .transphere-crvo-switch__arrow{color:#43c8ff;font-size:12px;line-height:1}
        @media(max-width:700px){
          .transphere-crvo-switch{left:10px;bottom:10px;padding-right:7px}
          .transphere-crvo-switch__label{display:none}
        }
      `}</style>
    </Link>
  );
}
