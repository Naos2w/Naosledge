/**
 * Second opt-in safety boundary for live, synthetic Neon Sandbox writes.
 * A manual operator must set the exact environment acknowledgement before
 * the test can sign up any account or mutate any sandbox record.
 */
export const OWNER_SANDBOX_WRITE_ACK="SYNTHETIC_SANDBOX_ONLY";
export const OWNER_SANDBOX_BRANCH="br-quiet-sunset-b4xx4pnx";
export const OWNER_SANDBOX_PROJECT="bitter-silence-36632892";

export function requireSandboxOwnerWriteApproval(input:{
  platform:string;
  computerName:string;
  branchId:string;
  projectId:string;
  acknowledgement:string|undefined;
}):void{
  if(input.platform!=="win32"||input.computerName.trim().toUpperCase()!=="MSI"){
    throw Error("Synthetic Neon Sandbox Owner E2E is restricted to MSI Windows");
  }
  if(input.branchId!==OWNER_SANDBOX_BRANCH||input.projectId!==OWNER_SANDBOX_PROJECT){
    throw Error("Synthetic Owner E2E is restricted to the named nonproduction Neon Sandbox");
  }
  if(input.acknowledgement!==OWNER_SANDBOX_WRITE_ACK){
    throw Error("Explicit synthetic Sandbox write approval acknowledgement is required");
  }
}
