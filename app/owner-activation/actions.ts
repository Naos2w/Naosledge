"use server";

import {ownerActivationAuth} from "@/lib/neon/owner-activation-server";
import {validOwnerResetToken,validOwnerEmailOtp} from "@/lib/neon/owner-activation";
import {validRecoveryPassword} from "@/lib/neon/password-recovery";

type Result={ok:boolean;message:string};
const DISABLED="此帳號啟用服務尚未開放，請先完成受保護的 HTTPS Preview 設定。";
const SEND_FAILED="驗證通知暫時無法寄送，請稍後再試。";
const RESET_FAILED="密碼連結已過期或無效，請重新申請。";

/**
 * Requests go to the exact existing owner Email from an encrypted env var.
 * Never accepts an arbitrary recipient or callback from the browser.
 */
export async function requestOwnerVerificationEmail():Promise<Result> {
 try {
   const {client,config,callbacks}=ownerActivationAuth();
   const {error}=await client.sendVerificationEmail({
     email:config.email,callbackURL:callbacks.verification,
   });
   if(error)return {ok:false,message:SEND_FAILED};
   return {ok:true,message:"若驗證通知已成功寄送，請查看既有帳號的收件匣；不需提供驗證連結或驗證碼。"};
 } catch {return {ok:false,message:DISABLED};}
}

/**
 * Managed Neon Auth currently advertises OTP verification. This supports
 * code-based emails without exposing tokens/OTP to our chat or logs.
 */
export async function confirmOwnerEmailOtp(otp:unknown):Promise<Result> {
 if(!validOwnerEmailOtp(otp))return {ok:false,message:"請輸入驗證信中的數字驗證碼。"};
 try {
   const {client,config}=ownerActivationAuth();
   const {data,error}=await client.emailOtp.verifyEmail({email:config.email,otp});
   if(error || data?.status!==true)return {ok:false,message:"驗證碼無效或已過期，請重新申請。"};
   return {ok:true,message:"驗證碼已送交官方 Auth。站長權限仍須在完成密碼設定後核對確認。"};
 }catch {return {ok:false,message:DISABLED};}
}

export async function requestOwnerFirstPasswordEmail():Promise<Result> {
 try {
   const {client,config,callbacks}=ownerActivationAuth();
   const {error}=await client.requestPasswordReset({
     email:config.email,redirectTo:callbacks.reset,
   });
   if(error)return {ok:false,message:SEND_FAILED};
   return {ok:true,message:"若密碼設定通知已成功寄送，請到既有信箱查看，並只在經確認的 HTTPS 頁面輸入新密碼。"};
 } catch {return {ok:false,message:DISABLED};}
}

/** Better Auth, not the application, validates and consumes single-use tokens. */
export async function completeOwnerFirstPassword(
  token:unknown,newPassword:unknown,
):Promise<Result> {
 if(!validOwnerResetToken(token))return {ok:false,message:RESET_FAILED};
 if(!validRecoveryPassword(newPassword)) {
   return {ok:false,message:"密碼需要 12–128 字元，不可包含控制字元。"};
 }
 try{
   const {client}=ownerActivationAuth();
   const {error}=await client.resetPassword({token,newPassword});
   if(error)return {ok:false,message:RESET_FAILED};
   return {ok:true,message:"密碼設定已送出。請先完成 Email 所有權驗證；網站不會自動授予站長權限。"};
 }catch {return {ok:false,message:DISABLED};}
}
