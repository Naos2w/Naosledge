/**
 * Read-only, MSI-targeted Obsidian installation preflight.
 *
 * Node.js 24 runs this TypeScript directly (built-in type stripping).
 * Does NOT install programs, scan Obsidian Vaults, read Markdown, authenticate,
 * call APIs, create folders, schedule jobs or modify any user-owned files.
 */
import {existsSync} from "node:fs";
import {homedir,hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export type ObsidianPreflight={
  supportedWindows:boolean;
  targetIsMsi:boolean;
  knownExecutableFound:boolean;
  checkedLocations:number;
  packageId:"Obsidian.Obsidian";
  installCommand:string;
};

type PreflightInputs={
  platform:string;
  hostname:string;
  localAppData:string;
  programFiles:string;
  programFilesX86:string;
  pathExists:(value:string)=>boolean;
};

export function inspectObsidianInstallation(input:PreflightInputs):ObsidianPreflight{
  const installCommand=
    "winget install --id Obsidian.Obsidian --exact --source winget --accept-source-agreements --accept-package-agreements";
  const local=input.localAppData;
  const candidates=[
    path.win32.join(local,"Obsidian","Obsidian.exe"),
    path.win32.join(local,"Programs","Obsidian","Obsidian.exe"),
    path.win32.join(input.programFiles,"Obsidian","Obsidian.exe"),
    path.win32.join(input.programFilesX86,"Obsidian","Obsidian.exe"),
  ];
  return {
    supportedWindows:input.platform==="win32",
    targetIsMsi:input.hostname.trim().toUpperCase()==="MSI",
    knownExecutableFound:candidates.some(p=>input.pathExists(p)),
    checkedLocations:candidates.length,
    packageId:"Obsidian.Obsidian",
    installCommand,
  };
}

const invoked=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(invoked){
  const check=inspectObsidianInstallation({
    platform:process.platform,
    hostname:hostname(),
    localAppData:process.env.LOCALAPPDATA||path.win32.join(homedir(),"AppData","Local"),
    programFiles:process.env.ProgramFiles||"C:\\Program Files",
    programFilesX86:process.env["ProgramFiles(x86)"]||"C:\\Program Files (x86)",
    pathExists:existsSync,
  });
  console.log("MSI_OBSIDIAN_PREFLIGHT "+JSON.stringify({
    ...check, // Contains no home path, cookies, Vault names, or personal notes.
  }));
  if(!check.supportedWindows||!check.targetIsMsi){
    console.log("只允許在指定的 MSI Windows 電腦上準備此流程；未變更任何檔案。");
    process.exitCode=1;
  }else if(!check.knownExecutableFound){
    console.log("常見路徑沒有找到 Obsidian 執行檔；不代表所有安裝型態皆不存在。");
    console.log("要安裝時請由擁有者確認後執行： "+check.installCommand);
    console.log("安裝後請在 Obsidian 介面自行選擇 Vault 資料夾；本工具不建立或掃描 Vault。");
  }else{
    console.log("找到 Obsidian 常見安裝路徑；尚未取得任何 Vault 資料夾授權。");
  }
}
