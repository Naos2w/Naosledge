/**
 * Password recovery is intentionally restricted to the approved Neon Sandbox.
 * Only the owner's exact Vercel Preview project + development branch may use
 * a hosted callback. The callback URL comes from Vercel system metadata, not
 * the incoming request, Host header, or a user-controlled redirect parameter.
 */
export type PreviewRecoveryContext = {
  vercelEnv?: string;
  vercelBranchHost?: string;
  gitRef?: string;
  projectId?: string;
  authorizedProjectId?: string;
};

export const APPROVED_PREVIEW_BRANCH = "feat/initial-v3-site-20261015";
const PREVIEW_PROJECT_PREFIX = "naosledge-sandbox-preview-";

/** None for local development; otherwise require complete Vercel metadata. */
export function vercelPreviewContext(): PreviewRecoveryContext | undefined {
  if (!process.env.VERCEL && !process.env.VERCEL_ENV) return undefined;
  return {
    vercelEnv: process.env.VERCEL_ENV || "unknown",
    vercelBranchHost: process.env.VERCEL_BRANCH_URL,
    gitRef: process.env.VERCEL_GIT_COMMIT_REF,
    projectId: process.env.VERCEL_PROJECT_ID,
    authorizedProjectId: process.env.NAOSLEDGE_PREVIEW_PROJECT_ID,
  };
}

export function sandboxResetRedirect(
  siteUrl: string,
  context?: PreviewRecoveryContext,
): string {
  if (context?.vercelEnv !== undefined) {
    const branchHost = context.vercelBranchHost || "";
    if (
      context.vercelEnv !== "preview" ||
      context.gitRef !== APPROVED_PREVIEW_BRANCH ||
      !context.projectId?.startsWith("prj_") ||
      context.projectId !== context.authorizedProjectId ||
      !branchHost.startsWith(PREVIEW_PROJECT_PREFIX) ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(branchHost)
    ) {
      throw new Error("只允許已授權的 Naosledge Vercel Sandbox Preview。");
    }
    return new URL("/reset-password", `https://${branchHost}`).href;
  }

  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    throw new Error("尚未設定可用的 Sandbox 測試網站網址。");
  }
  if (
    site.protocol !== "http:" ||
    site.hostname !== "localhost" ||
    !!site.username || !!site.password ||
    site.pathname !== "/" || !!site.search || !!site.hash
  ) {
    throw new Error("密碼重設目前只允許本機 Neon Sandbox。");
  }
  return new URL("/reset-password", site).href;
}

export function validRecoveryEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 256 && value.length >= 3 &&
    !/[\u0000-\u0020\u007f]/.test(value) &&
    /^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(value);
}

export function validRecoveryToken(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

export function validRecoveryPassword(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 12 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
