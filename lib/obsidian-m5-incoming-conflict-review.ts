/**
 * M5 offline handoff: verify the exact three files written by M4 before a
 * human compares both conflict versions in the owner-only browser UI.
 * This never trusts a receipt as a sync Baseline or as live Neon evidence.
 */
export type IncomingConflictFile=Pick<File,"name"|"size"|"arrayBuffer">;
export type VerifiedIncomingConflict={
  slug:string;
  remoteRevision:string;
  remoteSha256:string;
  localSha256:string;
  remoteMarkdown:string;
  localMarkdown:string;
};
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decoder=new TextDecoder("utf-8",{fatal:true});

async function bytesOf(file:IncomingConflictFile,max:number):Promise<ArrayBuffer>{
  if(!Number.isSafeInteger(file.size)||file.size>max||file.size<1){
    throw new Error("檔案大小不符合 M4 Incoming 格式");
  }
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength!==file.size||bytes.byteLength>max){
    throw new Error("檔案在匯入期間發生變化");
  }
  return bytes;
}

async function sha256(bytes:ArrayBuffer):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
}

/**
 * Caller selects M4's receipt and both untouched Markdown files together.
 * Everything is read locally in memory; no URL, JWT, path or network request.
 */
export async function inspectM4IncomingConflict(files:readonly IncomingConflictFile[]):Promise<VerifiedIncomingConflict>{
  if(files.length!==3||files.some(file=>!file||typeof file.name!=="string")){
    throw new Error("請同時選取 M4 收據與兩份 Markdown 副本");
  }
  const receiptFile=files.find(file=>file.name==="incoming-receipt.json");
  if(!receiptFile){
    throw new Error("缺少 M4 Incoming 收據");
  }
  const raw=decoder.decode(await bytesOf(receiptFile,2048));
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error("M4 Incoming 收據不是有效 JSON");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw new Error("M4 Incoming 收據格式不符");
  }
  const r=parsed as Record<string,unknown>;
  const keys=["format","slug","choice","remoteSha256","remoteRevision","localSha256"];
  if(Object.keys(r).length!==keys.length||!keys.every(key=>Object.hasOwn(r,key))||
     r.format!=="naosledge.m4.incoming-copy.v1"||r.choice!=="conflict"||
     typeof r.slug!=="string"||r.slug.length<3||r.slug.length>120||!SLUG.test(r.slug)||
     typeof r.remoteSha256!=="string"||!SHA.test(r.remoteSha256)||
     typeof r.remoteRevision!=="string"||!SHA.test(r.remoteRevision)||
     typeof r.localSha256!=="string"||!SHA.test(r.localSha256)||
     r.localSha256===r.remoteSha256||JSON.stringify(r)!==raw){
    throw new Error("收據不是完整的 M4 雙版本衝突紀錄");
  }
  const remoteFile=files.find(file=>file.name===r.slug+".md");
  const localFile=files.find(file=>file.name===r.slug+"--local.md");
  if(!remoteFile||!localFile||
     new Set(files.map(file=>file.name)).size!==3){
    throw new Error("副本檔名必須與 M4 收據的筆記名稱一致");
  }
  const [remoteBytes,localBytes]=await Promise.all([
    bytesOf(remoteFile,250_000),bytesOf(localFile,250_000),
  ]);
  const [remoteSha,localSha]=await Promise.all([
    sha256(remoteBytes),sha256(localBytes),
  ]);
  if(remoteSha!==r.remoteSha256||localSha!==r.localSha256){
    throw new Error("雙版本副本 SHA-256 與收據不一致，拒絕顯示過期或遭修改的內容");
  }
  return {
    slug:r.slug,remoteRevision:r.remoteRevision,
    remoteSha256:remoteSha,localSha256:localSha,
    remoteMarkdown:decoder.decode(remoteBytes),localMarkdown:decoder.decode(localBytes),
  };
}
