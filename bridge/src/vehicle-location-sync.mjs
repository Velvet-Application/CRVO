import crypto from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import { parseEtatduParcVehicleState } from "./ftp-vehicle-state.mjs";

function normalizeRemoteDir(value) {
  const normalized = String(value ?? "/").trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (!normalized || normalized === ".") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
function boolEnv(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function log(event, details = {}) { process.stdout.write(`${JSON.stringify({ timestamp:new Date().toISOString(), event, ...details })}\n`); }

const cfg = {
  host: process.env.FTP_HOST ?? process.env.SFTP_HOST,
  port: Number(process.env.FTP_PORT ?? process.env.SFTP_PORT ?? "21"),
  username: process.env.FTP_USERNAME ?? process.env.SFTP_USERNAME,
  password: process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD,
  remoteDir: normalizeRemoteDir(process.env.FTP_REMOTE_DIR ?? process.env.SFTP_REMOTE_DIR ?? "/"),
  secure: boolEnv(process.env.FTP_SECURE, false),
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  sourceId: process.env.KPI_SOURCE_ID,
};
if (!cfg.password || !cfg.supabaseUrl || !cfg.sourceId) throw new Error("Missing FTP_PASSWORD, SUPABASE_URL or KPI_SOURCE_ID");

const gatewayUrl = `${cfg.supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway`;
const gatewayToken = hash(`kpi-crvo-ftp-bridge:v1:${cfg.password}`);

async function gateway(action, { method="POST", body, params={}, allowedStatuses=[] } = {}) {
  const url = new URL(gatewayUrl);
  url.searchParams.set("action", action);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
  const response = await fetch(url, {
    method,
    headers:{ "x-kpi-bridge-token":gatewayToken, ...(body===undefined?{}:{"Content-Type":"application/json"}) },
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const payload = await response.json().catch(()=>({}));
  if (!response.ok && !allowedStatuses.includes(response.status)) throw new Error(`KPI gateway ${response.status}: ${payload.error ?? "unknown error"}`);
  return { status:response.status, payload };
}

async function readConnection() {
  const { payload } = await gateway("connection", { method:"GET", params:{ sourceId:cfg.sourceId } });
  return {
    host:String(payload.host || cfg.host || "").trim(),
    port:Number(payload.port || cfg.port || 21),
    username:String(payload.username || cfg.username || "").trim(),
    password:cfg.password,
    remoteDir:normalizeRemoteDir(payload.remoteDir || cfg.remoteDir || "/"),
    secure:typeof payload.secure === "boolean" ? payload.secure : cfg.secure,
  };
}

async function downloadToBuffer(client, remotePath) {
  const chunks=[];
  const sink=new Writable({ write(chunk,_encoding,callback){chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));callback();} });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks);
}
function modifiedTimestamp(file) {
  return file.modifiedAt instanceof Date && Number.isFinite(file.modifiedAt.getTime()) ? file.modifiedAt.getTime() : Date.now();
}

async function run() {
  const connection=await readConnection();
  const ftp=new FtpClient(30_000);
  ftp.ftp.verbose=false;
  try {
    await ftp.access({host:connection.host,port:connection.port,user:connection.username,password:connection.password,secure:connection.secure});
    const files=await ftp.list(connection.remoteDir);
    const candidates=files.filter(file=>/^(EtatduParc-Nuit|Etat-du-parc)\.csv$/i.test(file.name));
    if (!candidates.length) {
      log("ftp_vehicle_location_missing", { remoteDir:connection.remoteDir });
      return;
    }
    candidates.sort((a,b)=>modifiedTimestamp(b)-modifiedTimestamp(a));
    const remoteFile=candidates[0];
    const remotePath=path.posix.join(connection.remoteDir,remoteFile.name);
    const buffer=await downloadToBuffer(ftp,remotePath);
    const fileHash=hash(buffer);
    const modifiedAt=modifiedTimestamp(remoteFile);
    const snapshotAt=new Date(modifiedAt).toISOString().slice(0,10);
    const { status, payload }=await gateway("init", { body:{
      sourceId:cfg.sourceId,
      filename:remoteFile.name,
      byteSize:remoteFile.size || buffer.length,
      sha256:fileHash,
      snapshotAt,
      remotePath,
      modifiedAt,
    }, allowedStatuses:[409] });
    const batchId=payload.batchId;
    if (!batchId) throw new Error("Location snapshot batch id missing");
    if (payload.signedUrl) {
      const upload=await fetch(payload.signedUrl,{method:"PUT",headers:{"Content-Type":"application/octet-stream","x-upsert":"false"},body:buffer});
      if (!upload.ok) throw new Error(`Location archive upload failed: ${upload.status}`);
    }
    const vehicleStateReady=Boolean(payload.vehicleStateReady);
    if (status===409 && vehicleStateReady) {
      log("ftp_vehicle_location_duplicate_ready", { filename:remoteFile.name,batchId });
      return;
    }
    const rows=parseEtatduParcVehicleState(buffer,{snapshotAt,sourceModifiedAt:modifiedAt});
    const positioned=rows.filter(row=>String(row.metadata?.position ?? "").trim() !== "").length;
    const chunkSize=350;
    for(let offset=0;offset<rows.length;offset+=chunkSize){
      const chunk=rows.slice(offset,offset+chunkSize);
      await gateway("vehicle-state",{body:{batchId,rows:chunk,reset:offset===0,complete:offset+chunkSize>=rows.length}});
    }
    await gateway("archive-only",{body:{batchId,metadata:{mapping_status:"vehicle_location_snapshot",vehicle_location_rows:positioned}}}).catch(()=>null);
    log("ftp_vehicle_location_loaded", { filename:remoteFile.name,batchId,rows:rows.length,positioned,snapshotAt });
  } finally {
    ftp.close();
  }
}

run().catch(error=>{log("ftp_vehicle_location_failed",{message:error instanceof Error?error.message:String(error)});process.exitCode=1;});
