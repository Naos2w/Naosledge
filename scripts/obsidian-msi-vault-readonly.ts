/**
 * MSI-only read-only baseline preview of the OWNER-APPROVED local folder.
 *
 * This does not read Neon, touch GitHub, initiate transfers, store a baseline,
 * create files, or print Markdown/filenames. Designed for first empty-vault
 * readiness checks while actual Obsidian GUI registration is still pending.
 */
import {homedir,hostname} from "node:os";
import path from "node:path";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {inspectObsidianRegistration} from "../lib/obsidian-vault-registration.ts";

const APPROVED_MSI_VAULT="C:\\Naos\\Obsidian\\Naosledge";

export function assertApprovedMsiHost(platform:string,computerName:string){
  if(platform!=="win32"||computerName.trim().toUpperCase()!=="MSI"){
    throw new Error("This check is restricted to the Owner-approved MSI Windows device");
  }
}

if(process.argv[1] && /obsidian-msi-vault-readonly\.ts$/i.test(process.argv[1])){
  try{
    assertApprovedMsiHost(process.platform,hostname());
    const registryPath=path.join(process.env.APPDATA||
      path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
    const registration=await inspectObsidianRegistration({
      vaultPath:APPROVED_MSI_VAULT,registryPath,
    });
    if(!registration.registered){
      throw new Error("Obsidian GUI has not registered exactly one approved Vault");
    }
    const scan=await readObsidianLocalManifest(APPROVED_MSI_VAULT);
    console.log("OBSIDIAN_MSI_LOCAL_ONLY "+JSON.stringify({
      obsidianGuiRegistrationVerified:registration.registered,
      obsidianConfigPresent:registration.configPresent,
      approvedPath:APPROVED_MSI_VAULT,
      directMarkdownFingerprints:scan.fingerprints.length,
      unsupportedMarkdownFilenames:scan.unsupportedMarkdownFiles,
      unrelatedFiles:scan.otherFiles,
      directoriesNotScanned:scan.directoriesNotScanned,
      cloudComparisonPerformed:false,
      cloudWrites:0,
      localWrites:0,
      automaticSyncEnabled:false,
    }));
    if(scan.unsupportedMarkdownFiles)console.log(
      "Some Markdown names need manual mapping before any future sync; no files modified."
    );
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    console.error("OBSIDIAN_MSI_LOCAL_CHECK_FAILED "+reason.slice(0,160));
    process.exitCode=1;
  }
}
