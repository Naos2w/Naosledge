/**
 * Rank only the already-authorized, bounded rows returned by the Neon RPC.
 *
 * This is a zero-cost lexical relevance pass, NOT vector embeddings or AI.
 * SQL/RLS remains the source of truth for matching and authorizing results.
 * Never fetch Markdown bodies, owner IDs or JWTs just for relevance.
 */
export type VaultSearchCandidate = {
  id:string;
  title:string;
  slug:string;
  summary:string;
  category:string;
  tags:readonly string[];
};

function normalized(value:string):string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant").trim();
}

function phraseScore(value:string,query:string,exact:number,prefix:number,contains:number):number{
  if(!value)return 0;
  if(value===query)return exact;
  if(value.startsWith(query))return prefix;
  if(value.includes(query))return contains;
  return 0;
}

/**
 * Reorder the RPC's max 100 search hits by visible-field relevance.
 * Results whose match exists only in private Markdown content stay present
 * and preserve the database's recency order for equal scores.
 */
export function rankVaultSearchResults<T extends VaultSearchCandidate>(
  notes:readonly T[],rawQuery:string,
):T[]{
  const query=normalized(rawQuery.slice(0,120));
  if(!query || notes.length<2)return [...notes];

  // Bound work even if a caller bypasses the database's 120-character input cap.
  const terms=[...new Set(query.match(/[\p{L}\p{N}]+/gu)||[])].slice(0,8);
  const ranked=notes.map((note,index)=>{
    const title=normalized(note.title);
    const slug=normalized(note.slug);
    const summary=normalized(note.summary);
    const category=normalized(note.category);
    const tags=note.tags.map(normalized);

    let score=phraseScore(title,query,950,760,500);
    score+=phraseScore(slug,query,620,330,185);
    score+=phraseScore(summary,query,260,160,120);
    score+=phraseScore(category,query,180,100,75);
    score+=Math.max(0,...tags.map(tag=>phraseScore(tag,query,700,400,220)));

    let covered=0;
    for(const term of terms){
      const weights=[
        title.includes(term)?38:0,
        slug.includes(term)?26:0,
        tags.some(tag=>tag.includes(term))?35:0,
        summary.includes(term)?15:0,
        category.includes(term)?10:0,
      ];
      const best=Math.max(...weights);
      if(best)covered++;
      score+=best;
    }
    if(terms.length && covered===terms.length)score+=95;
    return {note,index,score};
  });

  // The RPC already orders equally relevant entries by updated_at desc.
  // Sorting must never rewrite the original array or change tie order.
  ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
  return ranked.map(r=>r.note);
}
