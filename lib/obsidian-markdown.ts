import type {MarkdownBackupDraft} from "./markdown-backup.ts";

type ObsidianFields=Omit<MarkdownBackupDraft,"content_md">;
export type ObsidianImported={content_md:string;metadata:ObsidianFields};

const MAX_CONTENT=200_000;
const MAX_INPUT=250_000;
const FIELD_KEYS=new Set([
  "title","tags","aliases","summary","description","category","date","learned_on",
  "naosledge_slug",
]);

function yamlScalar(value:string):string|null {
  const s=value.trim();
  if(!s)return "";
  if(s.startsWith('"')){
    try {const parsed=JSON.parse(s);return typeof parsed==="string"?parsed:null;}
    catch{return null;}
  }
  if(s.startsWith("'")&&s.endsWith("'")&&s.length>=2) {
    return s.slice(1,-1).replaceAll("''","'");
  }
  // No executable YAML tags, anchors, references, nested structures, or
  // JavaScript expressions. Unknown values make the entire file generic.
  if(/^[\p{L}\p{N}][\p{L}\p{N}\s_.:/#-]*$/u.test(s) &&
     !/[\r\n\u0000-\u001f\u007f]/.test(s)) return s;
  return null;
}

function validDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=Date.parse(value+"T00:00:00Z");
  return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value;
}

function slugFor(title:string):string{
  const ascii=title.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g,"-")
    .replace(/^-|-$/g,"").slice(0,100).replace(/-$/,"");
  if(ascii.length>=3)return ascii;
  let hash=2166136261;
  for(const ch of title){hash=Math.imul(hash^ch.codePointAt(0)!,16777619);}
  return "obsidian-"+(hash>>>0).toString(16).padStart(8,"0");
}

/**
 * Export Obsidian-readable Markdown with portable basic YAML properties.
 * All metadata stays within a local browser Blob; never upload automatically.
 */
export function serializeObsidianMarkdown(note:MarkdownBackupDraft):string {
  const lines=[
    "---",
    "title: "+JSON.stringify(note.title),
    // Slug filename + title alias both resolve existing [[Wikilinks]] in Obsidian.
    "aliases: "+JSON.stringify([note.title]),
    "naosledge_slug: "+JSON.stringify(note.slug),
    "summary: "+JSON.stringify(note.excerpt),
    "category: "+JSON.stringify(note.category),
    "tags: "+JSON.stringify(note.tags),
    "date: "+JSON.stringify(note.learned_on),
    "---",
    "",
  ];
  return lines.join("\n")+"\n"+note.content_md;
}

/**
 * Import only a tiny, explicit Obsidian YAML subset; unsupported properties
 * return null so the existing plain Markdown import preserves the WHOLE file
 * (including unknown frontmatter) rather than silently dropping user data.
 *
 * No YAML package, anchors, executable tags, or arbitrary object parsing.
 * A single title alias emitted by our own exporter is permitted; custom
 * aliases fall back to lossless generic Markdown import.
 * No remote calls, database writes, owner/author IDs, or auto-publication.
 */
export function parseObsidianMarkdown(
  input:unknown,fileName:string,fallbackDate:string,
):ObsidianImported|null{
  if(typeof input!=="string"||input.length>MAX_INPUT)return null;
  const source=input.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");
  const match=source.match(/^---\n([\s\S]{0,8192}?)\n---\n(?:\n)?/);
  if(!match)return null;
  const content_md=source.slice(match[0].length);
  if(content_md.length>MAX_CONTENT)return null;

  const fields:Record<string,string|string[]>=Object.create(null);
  const lines=match[1].split("\n");
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!line.trim()||/^\s*#/.test(line))continue;
    const m=line.match(/^([a-z_]+):(?:\s+(.*))?$/);
    if(!m||!FIELD_KEYS.has(m[1])||Object.hasOwn(fields,m[1]))return null;
    const key=m[1],raw=m[2]??"";
    if(key==="tags"||key==="aliases"){
      let list:string[];
      if(!raw.trim()){
        list=[];
        while(i+1<lines.length && /^\s+-\s+/.test(lines[i+1])){
          const scalar=yamlScalar(lines[++i].replace(/^\s+-\s+/,""));
          if(scalar===null)return null;
          list.push(scalar);
        }
      }else{
        try {
          const parsed=JSON.parse(raw);
          if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=="string"))return null;
          list=parsed;
        }catch{return null;}
      }
      fields[key]=list;
    }else{
      const scalar=yamlScalar(raw);
      if(scalar===null)return null;
      fields[key]=scalar;
    }
  }
  // Do not accidentally eat a Markdown horizontal rule/frontmatter that
  // doesn't describe any recognized Obsidian note properties.
  if(!Object.keys(fields).length)return null;
  const field=(key:string)=>typeof fields[key]==="string"?fields[key] as string:"";
  const fallback=fileName.replace(/\.(?:md|markdown)$/i,"").trim().slice(0,160);
  const title=field("title")||fallback;
  const slug=field("naosledge_slug")||slugFor(title);
  const aliases=fields.aliases;
  // Never silently discard author-defined Obsidian aliases.
  if(aliases!==undefined && (!Array.isArray(aliases)||
      aliases.length!==1||aliases[0]!==title))return null;
  const tagsRaw=fields.tags;
  const tags=Array.isArray(tagsRaw)?[...new Set(tagsRaw.map(s=>s.trim()).filter(Boolean))]:[];
  const summary=field("summary")||field("description");
  const category=field("category")||"筆記";
  const learned_on=field("learned_on")||field("date")||fallbackDate;
  if(!title||title.length>160||/[\u0000-\u001f\u007f]/.test(title)||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<3||slug.length>120||
     summary.length>400||category.length>36||!category.trim()||
     tags.length>12||tags.some(tag=>tag.length>28)||
     !validDate(learned_on))return null;
  return {content_md,metadata:{
    title,slug,excerpt:summary,category,tags,learned_on,
  }};
}
