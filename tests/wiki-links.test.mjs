import test from "node:test";
import assert from "node:assert/strict";
import {extractWikiReferences, wikiTargetMap, remarkWikiLinks} from "../lib/wiki-links.ts";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

test("wikilinks are collected from Markdown text, deduplicated, and bounded",()=>{
  const markdown=`# 學習筆記
從 [[Neon Auth]] 連到 [[RLS Security|資料庫存取]]，然後 [[neon auth]]。
`;
  assert.deepEqual(extractWikiReferences(markdown),["neon auth","rls security"]);
  assert.deepEqual(extractWikiReferences("不含關係"),[]);
});

test("do not turn code, fenced code, links or HTML into knowledge edges",()=>{
  const content=[
    "真正的 [[Next.js]]", "",
    "使用 `[[inline-secret]]` 不算", "",
    "```ts", "const label = '[[code-secret]]';", "```", "",
    "[外部連結 [[unknown]]](https://example.com)", "",
    "![alt [[image-secret]]](https://example.com/a.png)", "",
    "<span>[[html-secret]]</span>",
  ].join("\n");
  assert.deepEqual(extractWikiReferences(content),["next.js"]);
});

test("resolve titles and slugs, refusing ambiguous titles",()=>{
  const uuids=[
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  const index=wikiTargetMap([
    {id:uuids[0],slug:"neon-auth",title:"Neon 身分驗證"},
    {id:uuids[1],slug:"rls",title:"共同標題"},
    {id:uuids[2],slug:"other",title:"共同標題"},
  ]);
  assert.equal(index["neon-auth"],uuids[0]);
  assert.equal(index["neon 身分驗證"],uuids[0]);
  assert.equal(index.rls,uuids[1]);
  assert.equal(index["共同標題"],undefined);
});

test("prototype-looking note titles cannot pollute link lookup",()=>{
  const id="00000000-0000-4000-8000-000000000004";
  const map=wikiTargetMap([{id,slug:"safe-note",title:"__proto__"}]);
  assert.equal(map["__proto__"],id);
  assert.equal(Object.getPrototypeOf(map),Object.prototype);
  assert.equal(Object.hasOwn(map,"__proto__"),true);
  assert.equal(({}).polluted,undefined);
});

test("remark transforms only resolvable private Wikilinks into local Vault URLs",()=>{
  const id="00000000-0000-4000-8000-000000000001";
  const tree=unified().use(remarkParse).use(remarkGfm)
    .use(remarkWikiLinks,{"neon auth":id})
    .parse("看 [[Neon Auth|登入]] 和 [[unresolved]] 與 `[[hidden]]`。");
  const result=unified().use(remarkParse).use(remarkGfm)
    .use(remarkWikiLinks,{"neon auth":id}).runSync(tree);
  const paragraph=result.children[0];
  const links=paragraph.children.filter(x=>x.type==="link");
  assert.equal(links.length,1);
  assert.equal(links[0].url,`/vault/${id}`);
  assert.equal(links[0].children[0].value,"登入");
  assert.ok(paragraph.children.some(x=>x.type==="text" && x.value.includes("[[unresolved]]")));
  assert.ok(paragraph.children.some(x=>x.type==="inlineCode" && x.value==="[[hidden]]"));
});
