"use client";

import {useMemo} from "react";

function makeQr(value:string){
  const bytes=new TextEncoder().encode(value);
  if(bytes.length>106)throw new Error("Lien trop long pour le QR sécurisé.");
  const exp=new Array<number>(512).fill(0),log=new Array<number>(256).fill(0);let x=1;
  for(let i=0;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&0x100)x^=0x11d}for(let i=255;i<512;i++)exp[i]=exp[i-255];
  const mul=(a:number[],b:number[])=>{const out=new Array<number>(a.length+b.length-1).fill(0);for(let i=0;i<a.length;i++)if(a[i])for(let j=0;j<b.length;j++)if(b[j])out[i+j]^=exp[log[a[i]]+log[b[j]]];return out};
  let gen=[1];for(let i=0;i<26;i++)gen=mul(gen,[1,exp[i]]);
  const bits:number[]=[];const append=(v:number,count:number)=>{for(let i=count-1;i>=0;i--)bits.push((v>>i)&1)};
  append(4,4);append(bytes.length,8);for(const b of bytes)append(b,8);const cap=108*8;for(let i=0;i<Math.min(4,cap-bits.length);i++)bits.push(0);while(bits.length%8)bits.push(0);
  const data:number[]=[];for(let i=0;i<bits.length;i+=8){let v=0;for(const b of bits.slice(i,i+8))v=(v<<1)|b;data.push(v)}let p=0;while(data.length<108)data.push(p++%2?0x11:0xec);
  const msg=[...data,...new Array<number>(26).fill(0)];for(let i=0;i<108;i++){const coef=msg[i];if(!coef)continue;const l=log[coef];for(let j=0;j<gen.length;j++)if(gen[j])msg[i+j]^=exp[l+log[gen[j]]];}
  const stream:number[]=[];for(const cw of [...data,...msg.slice(108)])for(let i=7;i>=0;i--)stream.push((cw>>i)&1);
  const n=37;const matrix=Array.from({length:n},()=>new Array<boolean|null>(n).fill(null));
  const finder=(r0:number,c0:number)=>{for(let dr=-1;dr<=7;dr++)for(let dc=-1;dc<=7;dc++){const r=r0+dr,c=c0+dc;if(r<0||c<0||r>=n||c>=n)continue;matrix[r][c]=dr>=0&&dr<=6&&dc>=0&&dc<=6&&(dr===0||dr===6||dc===0||dc===6||(dr>=2&&dr<=4&&dc>=2&&dc<=4));}};
  finder(0,0);finder(n-7,0);finder(0,n-7);
  for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)matrix[30+dr][30+dc]=Math.abs(dr)===2||Math.abs(dc)===2||(dr===0&&dc===0);
  for(let i=8;i<n-8;i++){if(matrix[i][6]===null)matrix[i][6]=i%2===0;if(matrix[6][i]===null)matrix[6][i]=i%2===0}
  const digit=(v:number)=>{let d=0;while(v){d++;v>>=1}return d};const raw=8;let d=raw<<10;while(digit(d)-digit(0x537)>=0)d^=0x537<<(digit(d)-digit(0x537));const fmt=((raw<<10)|d)^0x5412;
  for(let i=0;i<15;i++){const mod=((fmt>>i)&1)===1;if(i<6)matrix[i][8]=mod;else if(i<8)matrix[i+1][8]=mod;else matrix[n-15+i][8]=mod;if(i<8)matrix[8][n-i-1]=mod;else if(i<9)matrix[8][7]=mod;else matrix[8][15-i-1]=mod;}matrix[n-8][8]=true;
  let inc=-1,row=n-1,index=0;for(let col=n-1;col>0;col-=2){if(col===6)col--;while(true){for(const c of [col,col-1])if(matrix[row][c]===null){let dark=index<stream.length?Boolean(stream[index]):false;index++;if((row+c)%2===0)dark=!dark;matrix[row][c]=dark;}row+=inc;if(row<0||row>=n){row-=inc;inc=-inc;break}}}
  return matrix as boolean[][];
}

export default function QrCode({value,label="QR code d’accès"}:{value:string;label?:string}){
  const matrix=useMemo(()=>{try{return makeQr(value)}catch{return null}},[value]);
  if(!matrix)return <div style={{padding:16,border:"1px solid #dce6ef",borderRadius:14}}>Lien disponible mais QR non générable.</div>;
  const quiet=4,n=matrix.length,size=n+quiet*2;
  return <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width="220" height="220" style={{display:"block",background:"#fff",borderRadius:16}} shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff"/>{matrix.flatMap((row,r)=>row.map((dark,c)=>dark?<rect key={`${r}-${c}`} x={c+quiet} y={r+quiet} width="1" height="1" fill="#102033"/>:null))}</svg>;
}
