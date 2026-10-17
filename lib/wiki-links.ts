import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {Root, RootContent, PhrasingContent, Text} from "mdast";
import type {Plugin} from "unified";

export type WikiReference = {key:string; label:string; raw:string};
export type KnowledgeTitle = {id:string; slug:string; title:string};

// Syntax: [[slug]], [[exact title]], [[slug|display label]].
// Tokens are only collected from Markdown TEXT; never from code, inline code,
// raw HTML, linked text, image descriptions, or fenced code blocks.
const WIKI = /\[\[([^\[\]|\r\n]{1,160})(?:\|([^\[\]\r\n]{1,120}))?\]\]/g;
const FORBIDDEN = new Set(["code","inlineCode","html","link","linkReference","image","imageReference","definition","yaml"]);

export function normalizeWikiKey(value: string): string {
  return value.trim().toLowerCase();
}

function scan(value:string): WikiReference[] {
  const result: WikiReference[]=[];
  for(const match of value.matchAll(WIKI)) {
    const key=normalizeWikiKey(match[1]);
    if(!key || key.length>160) continue;
    const label=(match[2] ?? match[1]).trim();
    if(!label || label.length>160) continue;
    result.push({key,label,raw:match[0]});
  }
  return result;
}

type Walkable = {type:string;value?:string;children?:Walkable[]};

/** Remark represents inline <span>content</span> as HTML/text/HTML siblings. */
function htmlDelta(value:string):number {
  if(/^<\s*\/[A-Za-z]/.test(value)) return -1;
  if(/^<\s*[A-Za-z][\w-]*(?:\s[^>]*)?>$/.test(value) && !/\/\s*>$/.test(value)) return 1;
  return 0;
}

function visit(node: Walkable, onText:(node:Walkable)=>void) {
  if(FORBIDDEN.has(node.type)) return;
  if(node.type==="text" && typeof node.value==="string") {
    onText(node);
  } else if(node.children) {
    let rawHtmlDepth=0;
    for(const child of node.children) {
      if(child.type==="html") {rawHtmlDepth=Math.max(0,rawHtmlDepth+htmlDelta(child.value??""));continue;}
      if(rawHtmlDepth===0) visit(child,onText);
    }
  }
}

export function extractWikiReferences(content: string): string[] {
  const tree=unified().use(remarkParse).use(remarkGfm).parse(content);
  const keys=new Set<string>();
  visit(tree as Walkable,node=>{
    for(const link of scan(node.value??"")) {
      keys.add(link.key);
    }
  });
  return [...keys];
}

/** Resolve by stable slug first; title aliases work only when unambiguous. */
export function wikiTargetMap(notes: KnowledgeTitle[]): Record<string,string> {
  const slugs: Record<string,string>=Object.create(null);
  const titles=new Map<string,string|null>();
  for(const note of notes) {
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(note.id)) continue;
    const slug=normalizeWikiKey(note.slug);
    const title=normalizeWikiKey(note.title);
    if(slug) slugs[slug]=note.id;
    if(title) {
      if(!titles.has(title)) titles.set(title,note.id);
      else if(titles.get(title)!==note.id) titles.set(title,null);
    }
  }
  for(const [key,id] of titles.entries()) {
    if(id && !Object.hasOwn(slugs,key)) slugs[key]=id;
  }
  // Spread into a normal serializable object without invoking __proto__ setters.
  return {...slugs};
}

function wikiChildren(value:string, targets:Record<string,string>): PhrasingContent[]|null {
  const result:PhrasingContent[]=[];
  let cursor=0, found=false;
  for(const match of value.matchAll(WIKI)) {
    if(match.index===undefined) continue;
    if(match.index>cursor) result.push({type:"text",value:value.slice(cursor,match.index)});
    const key=normalizeWikiKey(match[1]);
    const label=(match[2]??match[1]).trim();
    const id=Object.hasOwn(targets,key)?targets[key]:undefined;
    if(key && label && id && /^[0-9a-f-]{36}$/i.test(id)) {
      result.push({
        type:"link",url:`/vault/${id}`,children:[{type:"text",value:label}],
      });
    } else {
      result.push({type:"text",value:match[0]});
    }
    cursor=match.index+match[0].length;
    found=true;
  }
  if(!found) return null;
  if(cursor<value.length) result.push({type:"text",value:value.slice(cursor)});
  return result;
}

export const remarkWikiLinks: Plugin<[Record<string,string>],Root> = (targets) => (tree) => {
  // This plugin runs only for private /vault pages, never on public articles.
  const walk=(node: Root | RootContent | PhrasingContent) => {
    const generic=node as unknown as {type:string;children?:PhrasingContent[];value?:string};
    if(FORBIDDEN.has(node.type) || !generic.children) return;
    const changed:PhrasingContent[]=[];
    let rawHtmlDepth=0;
    for(const child of generic.children) {
      if(child.type==="html") rawHtmlDepth=Math.max(0,rawHtmlDepth+htmlDelta(child.value??""));
      if(rawHtmlDepth>0 || child.type==="html") {changed.push(child);continue;}
      if(child.type==="text") {
        changed.push(...(wikiChildren((child as Text).value,targets)??[child]));
      } else {
        walk(child as RootContent);
        changed.push(child);
      }
    }
    generic.children=changed;
  };
  walk(tree);
};
