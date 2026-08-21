"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function TransphereNavigationBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/transphere/") || pathname === "/transphere") return;

    const patch = () => {
      document.querySelectorAll<HTMLAnchorElement>('a[aria-label="Revenir au niveau précédent"]').forEach((link) => {
        link.href = "/transphere";
        link.setAttribute("data-transphere-back", "true");
      });
    };

    patch();
    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
