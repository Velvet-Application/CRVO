export type NotificationSoundKind="crystal"|"pulse"|"soft_ping"|"silent";

export type NotificationSoundPreferences={sound:NotificationSoundKind;volume:number};

let audioContext:AudioContext|null=null;

function context(){
  if(typeof window==="undefined")return null;
  const AudioCtor=window.AudioContext||(window as typeof window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!AudioCtor)return null;
  if(!audioContext)audioContext=new AudioCtor();
  return audioContext;
}

export async function unlockNotificationAudio(){
  const ctx=context();
  if(!ctx)return false;
  try{if(ctx.state==="suspended")await ctx.resume();return ctx.state==="running"}catch{return false}
}

export function armNotificationAudio(){
  if(typeof window==="undefined")return()=>{};
  const unlock=()=>{void unlockNotificationAudio()};
  window.addEventListener("pointerdown",unlock,{passive:true});
  window.addEventListener("keydown",unlock);
  window.addEventListener("touchstart",unlock,{passive:true});
  return()=>{window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);window.removeEventListener("touchstart",unlock)};
}

function tone(ctx:AudioContext,frequency:number,start:number,duration:number,level:number,type:OscillatorType="sine"){
  const oscillator=ctx.createOscillator();
  const gain=ctx.createGain();
  oscillator.type=type;
  oscillator.frequency.setValueAtTime(frequency,start);
  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002,level),start+Math.min(.025,duration*.18));
  gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
  oscillator.connect(gain);gain.connect(ctx.destination);
  oscillator.start(start);oscillator.stop(start+duration+.03);
}

export async function playNotificationSound(kind:NotificationSoundKind,volume=.25){
  if(kind==="silent"||volume<=0)return;
  const ctx=context();if(!ctx)return;
  try{if(ctx.state==="suspended")await ctx.resume();if(ctx.state!=="running")return;}catch{return}
  const now=ctx.currentTime+.015;
  const level=Math.max(.006,Math.min(1,volume)*.12);
  if(kind==="crystal"){
    tone(ctx,880,now,.24,level,"sine");
    tone(ctx,1174.66,now+.17,.30,level*.82,"sine");
    tone(ctx,1760,now+.18,.20,level*.22,"sine");
    return;
  }
  if(kind==="pulse"){
    tone(ctx,520,now,.16,level*.75,"triangle");
    tone(ctx,700,now+.105,.20,level*.60,"sine");
    tone(ctx,910,now+.205,.18,level*.42,"sine");
    return;
  }
  tone(ctx,790,now,.30,level*.78,"sine");
  tone(ctx,1580,now,.20,level*.16,"sine");
}
