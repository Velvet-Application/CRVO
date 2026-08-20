"use client";

export default function MobileNavigationFix(){
  return <style>{`
    @media(max-width:760px){
      .gn2-trigger{
        display:grid!important;
        visibility:visible!important;
        opacity:1!important;
        pointer-events:auto!important;
        z-index:10020!important;
        left:max(8px,env(safe-area-inset-left))!important;
        top:max(8px,env(safe-area-inset-top))!important;
        width:44px!important;
        height:44px!important;
        border-radius:12px!important;
        box-shadow:0 8px 24px rgba(20,59,86,.18)!important;
      }
      .gn2-backdrop{z-index:10010!important;}
      .gn2-drawer{
        z-index:10011!important;
        width:min(340px,94vw)!important;
        padding-bottom:env(safe-area-inset-bottom)!important;
      }
      .gn2-drawer nav{
        -webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;
      }

      .crvo-trust-ticker{
        z-index:140!important;
        top:auto!important;
        bottom:calc(68px + env(safe-area-inset-bottom))!important;
        left:auto!important;
        right:10px!important;
        width:auto!important;
        max-width:min(188px,calc(100vw - 20px))!important;
        pointer-events:none!important;
      }
      .crvo-trust-ticker__shell{
        pointer-events:none!important;
        display:flex!important;
        align-items:center!important;
        min-height:34px!important;
        padding:7px 10px!important;
        gap:7px!important;
        border-radius:999px!important;
        box-shadow:0 8px 22px rgba(22,57,83,.14)!important;
      }
      .crvo-trust-ticker__viewport,
      .crvo-trust-ticker small{
        display:none!important;
      }
      .crvo-trust-ticker strong{
        white-space:normal!important;
        font-size:7.5px!important;
        line-height:1.2!important;
        letter-spacing:.05em!important;
      }
    }
    @media(max-width:360px){
      .crvo-trust-ticker{
        bottom:calc(72px + env(safe-area-inset-bottom))!important;
        max-width:145px!important;
      }
    }
    @media print{.gn2-trigger,.crvo-trust-ticker{display:none!important;}}
  `}</style>;
}
