/**
 * Internal synthetic fixture protocol. No generic paths and no production
 * archive keys. The test harness transmits a RANDOM test-only key via stdin.
 * Neither keys nor decrypted Markdown are printed or written beside records.
 */
import {fileURLToPath} from "node:url";
import path from "node:path";
import {
  createSyntheticEncryptedArchive,readSyntheticEncryptedRecord,
  inspectSyntheticEncryptedArchive,
} from "../lib/obsidian-synthetic-encrypted-archive.ts";

async function keyFromStdin():Promise<Buffer>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of process.stdin){
    const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=data.length;
    if(size>64)throw Error("Oversized test-only key input");
    chunks.push(data);
  }
  const encoded=Buffer.concat(chunks).toString("ascii").trim();
  if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded)){
    throw Error("Invalid test-only archive key encoding");
  }
  const key=Buffer.from(encoded,"base64");
  if(key.byteLength!==32||key.toString("base64")!==encoded){
    throw Error("Invalid test-only archive key");
  }
  return key;
}

async function main(){
  const mode=process.argv[2];
  if(mode==="create"&&process.argv.length===3){
    const key=await keyFromStdin();
    try{
      const archive=await createSyntheticEncryptedArchive();
      const record=await archive.addSyntheticRecord({
        key,slug:"synthetic-encrypted-note",
        body:"NAOSLEDGE_SYNTHETIC_NOTE: private-looking sample written by an isolated fixture",
      });
      console.log("NAOSLEDGE_ENCRYPTED_SYNTHETIC_WRITER "+JSON.stringify({
        archiveId:archive.archiveId,recordId:record.id,syntheticOnly:true,
      }));
    }finally{key.fill(0);}
    return;
  }
  if(mode==="read"&&process.argv.length===5){
    const key=await keyFromStdin();
    try{
      const [archiveId,recordId]=[process.argv[3],process.argv[4]];
      const note=await readSyntheticEncryptedRecord(archiveId,recordId,key);
      const report=await inspectSyntheticEncryptedArchive(archiveId,key);
      if(note.slug!=="synthetic-encrypted-note"||
         note.body!=="NAOSLEDGE_SYNTHETIC_NOTE: private-looking sample written by an isolated fixture"||
         report.needsManualReview||report.verifiedRecords!==1){
        throw Error("Synthetic encrypted data mismatch");
      }
      console.log("NAOSLEDGE_ENCRYPTED_SYNTHETIC_READER "+JSON.stringify({
        authenticated:true,syntheticOnly:true,readOnly:true,
        noteBytes:Buffer.byteLength(note.body,"utf8"),
        automaticRestoreEnabled:false,
      }));
    }finally{key.fill(0);}
    return;
  }
  throw Error("Unsupported synthetic archive command");
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    console.error("SYNTHETIC_ENCRYPTED_ARCHIVE_OPERATION_REJECTED");
    process.exitCode=2;
  });
}
