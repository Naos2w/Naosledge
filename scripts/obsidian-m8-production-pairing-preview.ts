/**
 * Explicit, one-shot MSI M8 initial-pairing READ-ONLY preview.
 *
 * No native-browser cookie extraction, no environment JWT, no token on argv,
 * no Markdown body / filenames printed, no baseline adoption, no watcher
 * startup and no automatic Production or local writes.
 */
import {homedir,hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertApprovedMsiHost} from "./obsidian-msi-vault-readonly.ts";
import {readM7ProductionOwnerJwt} from "./obsidian-m7-production-preflight.ts";
import {inspectObsidianRegistration}
  from "../lib/obsidian-vault-registration.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {fetchProductionOwnerRlsFingerprints}
  from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {inspectM8ReadOnlyPairing}
  from "../lib/obsidian-m8-readonly-cycle.ts";
import {RELEASE_NEON_BRANCH} from "../lib/neon/production-release.ts";

const FLAG="--m8-first-pairing-readonly";
const FIXED_VAULT="C:\\Naos\\Obsidian\\Naosledge";

export function assertM8InitialReadOnlyInvocation(args:{
  platform:string;hostname:string;
  flags:readonly string[];stdinIsTerminal:boolean;
}){
  assertApprovedMsiHost(args.platform,args.hostname);
  if(args.flags.length!==1||args.flags[0]!==FLAG||args.stdinIsTerminal){
    throw Error("M8 requires MSI-only, exact read-only flag and piped JWT");
  }
}

/** Injectable only for isolated OS Temp tests; CLI always uses FIXED_VAULT. */
export async function previewM8InitialPairingReadOnly(args:{
  jwt:string;
  vaultPath?:string;
  registryPath?:string;
  registrationReader?:typeof inspectObsidianRegistration;
  localReader?:typeof readObsidianLocalManifest;
  remoteReader?:typeof fetchProductionOwnerRlsFingerprints;
}){
  const vaultPath=args.vaultPath??FIXED_VAULT;
  const registryPath=args.registryPath??path.join(process.env.APPDATA||
    path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
  const registration=await (args.registrationReader??inspectObsidianRegistration)({
    vaultPath,registryPath,
  });
  // Don't send any private note metadata to Neon before verifying the local
  // Obsidian app registered this specific, non-redirected Vault.
  if(registration.registered!==true||
     registration.autoSyncEnabled!==false){
    throw Error("M8 registered Obsidian Vault unavailable");
  }
  const result=await inspectM8ReadOnlyPairing({
    readLocal:()=> (args.localReader??readObsidianLocalManifest)(vaultPath),
    readRemote:()=> (args.remoteReader??fetchProductionOwnerRlsFingerprints)({
      branchId:RELEASE_NEON_BRANCH,jwt:args.jwt,
    }),
    baseline:[],
    trust:{
      initialPairingApproved:false,durableBaselineVerified:false,
      ownerSessionFresh:true,productionSchemaReady:false,
    },
  });
  // Return counts, NEVER slugs, contents, paths, JWT or note hashes to stdout.
  return {
    mode:"M8_FIRST_PAIRING_READONLY" as const,
    localNotes:result.localNoteCount,
    remoteNotes:result.remoteNoteCount,
    manualReviews:result.manualReviewCount,
    unsupportedMarkdownNames:result.unsupportedMarkdownNames,
    unscannedDirectories:result.unscannedDirectories,
    unpairedCandidates:result.possibleUnpairedFiles,
    remoteFullInventoryRead:true as const,
    ownerRlsVerified:true as const,
    initialPairingApproved:false as const,
    baselineSaved:false as const,
    localWrites:0 as const,
    remoteWrites:0 as const,
    automaticTransfersEnabled:false as const,
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assertM8InitialReadOnlyInvocation({
      platform:process.platform,hostname:hostname(),
      flags:process.argv.slice(2),stdinIsTerminal:!!process.stdin.isTTY,
    });
    const jwt=await readM7ProductionOwnerJwt(process.stdin);
    const result=await previewM8InitialPairingReadOnly({jwt});
    console.log("M8_FIRST_PAIRING_READONLY "+JSON.stringify(result));
    console.log("NO_TRANSFER; NO_BASELINE; NO_AUTOMATIC_SYNC; NO_PRODUCTION_WRITE");
  }catch{
    // Suppress raw PostgREST errors, filenames and any JWT.
    console.error("M8_INITIAL_PAIRING_NOT_VERIFIED; NO_TRANSFER");
    process.exitCode=1;
  }
}
