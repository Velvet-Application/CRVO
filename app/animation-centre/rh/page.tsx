import { redirect } from "next/navigation";

// Stable access route: the operational RH view is the same EffectifClient context="animation"
// already validated under /data-rh/effectif. This alias only routes the Animation du centre menu to it.
export default function AnimationCentreRhPage(){
  redirect("/data-rh/effectif?from=animation");
}
