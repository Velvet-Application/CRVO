import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book d'animation - KPI CRVO Lens",
  description: "Book d'animation quotidien CRVO Lens, imprimable en PDF A4 paysage.",
};

export default function BookLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    {children}
    <style>{`@page { size: A4 landscape; margin: 0; }`}</style>
  </>;
}
