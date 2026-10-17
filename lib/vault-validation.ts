import {extractWikiReferences} from "./wiki-links.ts";

export type VaultNoteInput = {
  id?:string;
  title:string;
  slug:string;
  summary:string;
  content_md:string;
  category:string;
  tags:string[];
  learned_on:string;
};
type Parsed = {ok:true;value:VaultNoteInput & {links:string[]}} | {ok:false;error:string};

export function isKnowledgeId(value:unknown): value is string {
  return typeof value==="string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

export function validateVaultNote(value:unknown):Parsed {
  if(!value || typeof value!=="object" || Array.isArray(value)) {
    return {ok:false,error:"筆記資料格式不正確。"};
  }
  const input=value as Record<string,unknown>;
  if(input.id!==undefined && !isKnowledgeId(input.id)) {
    return {ok:false,error:"私人筆記 ID 不正確。"};
  }
  if(typeof input.title!=="string" || !input.title.trim() || input.title.trim().length>160) {
    return {ok:false,error:"標題不得空白或超過 160 字。"};
  }
  if(typeof input.slug!=="string" || input.slug.length>120 ||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length<3) {
    return {ok:false,error:"筆記識別碼必須是 3–120 字元的小寫英數與連字號。"};
  }
  if(typeof input.summary!=="string" || input.summary.length>400) {
    return {ok:false,error:"摘要不得超過 400 字。"};
  }
  if(typeof input.content_md!=="string" || input.content_md.length>200000) {
    return {ok:false,error:"Markdown 正文不得超過 200,000 字。"};
  }
  if(typeof input.category!=="string" || !input.category.trim() || input.category.trim().length>36) {
    return {ok:false,error:"分類不得空白或超過 36 字。"};
  }
  if(!Array.isArray(input.tags) || input.tags.length>12 ||
    input.tags.some(tag=>typeof tag!=="string" || !tag.trim() || tag.trim().length>28)) {
    return {ok:false,error:"標籤最多 12 個，每個不得超過 28 字。"};
  }
  const date=input.learned_on;
  const timestamp=typeof date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(date+"T00:00:00Z") : NaN;
  if(!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==date) {
    return {ok:false,error:"學習日期不正確。"};
  }
  const links=extractWikiReferences(input.content_md);
  if(links.length>80) return {ok:false,error:"單篇筆記最多建立 80 個不同的知識連結。"};
  return {
    ok:true,
    value:{
      id:input.id as string|undefined,
      title:input.title.trim(), slug:input.slug, summary:input.summary.trim(),
      content_md:input.content_md,category:input.category.trim(),
      tags:[...new Set((input.tags as string[]).map(s=>s.trim()))],
      learned_on:date,links,
    },
  };
}

/** Content remains private until manually reviewed in a separate public draft. */
export function publicDraftMarkdown(content:string):string {
  // Convert Wikilink markup to ordinary, NON-clickable text. Private URLs and
  // source note IDs never enter the public article automatically.
  return content.replace(/\[\[([^\[\]|\r\n]{1,160})(?:\|([^\[\]\r\n]{1,120}))?\]\]/g,
    (_whole,_key:string,label?:string)=>(label||_key).trim());
}
