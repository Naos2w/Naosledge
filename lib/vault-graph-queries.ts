import type {KnowledgeGraphReference} from "./knowledge-graph";

// Keep PostgREST `in.(uuid,...)` filters below conservative URL limits.
// A single request for all 180 UUIDs can exceed 7 KB before other query fields.
export const GRAPH_QUERY_ID_BATCH_SIZE=48;

export type DatedGraphReference=KnowledgeGraphReference&{created_at:string};

export function graphNoteIdBatches(ids:readonly string[]):string[][]{
  const batches:string[][]=[];
  for(let i=0;i<ids.length;i+=GRAPH_QUERY_ID_BATCH_SIZE){
    batches.push(ids.slice(i,i+GRAPH_QUERY_ID_BATCH_SIZE));
  }
  return batches;
}

/**
 * Every owner-scoped chunk is individually bounded to limit+1 newest links.
 * Merging those chunks is sufficient to select the global newest `limit`:
 * no omitted row can outrank the kept rows in its own chunk.
 *
 * Never serialize timestamps or ownership metadata to the browser graph.
 */
export function selectGraphReferences(
  groups:readonly (readonly DatedGraphReference[])[],
  limit:number,
):{references:KnowledgeGraphReference[];truncated:boolean}{
  const rows=groups.flat().sort((a,b)=>
    b.created_at.localeCompare(a.created_at) ||
    a.source_note_id.localeCompare(b.source_note_id) ||
    a.target_key.localeCompare(b.target_key)
  );
  return {
    references:rows.slice(0,limit).map(r=>({
      source_note_id:r.source_note_id,target_key:r.target_key,
    })),
    truncated:rows.length>limit,
  };
}
