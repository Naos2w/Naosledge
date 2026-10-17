"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {ArrowLeft,ArrowRight,Focus,GitBranch,Link2,Network,RotateCcw,Search,ZoomIn,ZoomOut} from "lucide-react";
import {
  connectedGraphNotes,layoutKnowledgeGraph,
  GRAPH_W,GRAPH_H,type KnowledgeGraph,
} from "@/lib/knowledge-graph";

type Props={
  graph:KnowledgeGraph;
  notesTruncated:boolean;
  linksTruncated:boolean;
  initialFocusId?:string|null;
};

export default function VaultKnowledgeGraph({graph,notesTruncated,linksTruncated,initialFocusId=null}:Props){
  const [search,setSearch]=useState("");
  const [category,setCategory]=useState("");
  const [selectedId,setSelectedId]=useState<string|null>(()=>
    initialFocusId&&graph.nodes.some(n=>n.id===initialFocusId)?initialFocusId:null
  );
  const [connectedOnly,setConnectedOnly]=useState(false);
  const [zoom,setZoom]=useState(1);
  const graphScrollRef=useRef<HTMLDivElement>(null);

  const categories=useMemo(()=>[...new Set(graph.nodes.map(n=>n.category))].sort(),[graph.nodes]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase();
    const visible=graph.nodes.filter(n=>
      (!category||n.category===category) &&
      (!q||[n.title,n.slug,n.category,...n.tags].some(v=>v.toLocaleLowerCase().includes(q)))
    );
    let nodes=visible;
    if(connectedOnly){
      const neighbours=new Set(graph.edges.flatMap(e=>[e.source,e.target]));
      nodes=nodes.filter(n=>neighbours.has(n.id));
    }
    const ids=new Set(nodes.map(n=>n.id));
    return {...graph,nodes,edges:graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
  },[graph,category,search,connectedOnly]);
  const selected=selectedId?filtered.nodes.find(n=>n.id===selectedId):undefined;
  const focusedId=selected?.id||null;
  const layout=useMemo(()=>layoutKnowledgeGraph(filtered,focusedId,100),[filtered,focusedId]);
  const byId=useMemo(()=>new Map(filtered.nodes.map(n=>[n.id,n])),[filtered.nodes]);
  const neighbours=useMemo(()=>selected?connectedGraphNotes(filtered,selected.id):[],[filtered,selected]);
  const positions=useMemo(()=>new Map(layout.points.map(n=>[n.id,n])),[layout.points]);
  const matchCount=filtered.nodes.length;

  function select(id:string){
    setSelectedId(previous=>previous===id?null:id);
  }
  function clearAll(){
    setSelectedId(null);
    setSearch("");setCategory("");setConnectedOnly(false);setZoom(1);
  }
  const effectiveZoom=Math.max(0.75,Math.min(1.5,zoom));
  const vw=GRAPH_W/effectiveZoom,vh=GRAPH_H/effectiveZoom;
  const viewBox=`${(GRAPH_W-vw)/2} ${(GRAPH_H-vh)/2} ${vw} ${vh}`;

  useEffect(()=>{
    // The SVG is intentionally wider than an iPhone viewport. Without an
    // initial/selection scroll, the actual focused neuron is off-screen.
    // Adjust the scroll container only when the graph's focus or size changes;
    // people may then freely pan without fighting an ongoing animation.
    const container=graphScrollRef.current;
    const svg=container?.querySelector("svg");
    if(!container||!svg)return;
    const centre=layout.points.find(p=>p.id===focusedId)?.x??GRAPH_W/2;
    const visibleOriginX=(GRAPH_W-vw)/2;
    const centerGraph=()=>{
      const pointPx=(centre-visibleOriginX)*svg.getBoundingClientRect().width/vw;
      const desired=pointPx-container.clientWidth/2;
      const maxScroll=Math.max(0,container.scrollWidth-container.clientWidth);
      container.scrollLeft=Math.max(0,Math.min(maxScroll,desired));
    };
    centerGraph();
    // Phone rotation / breakpoint changes must not leave the selected node
    // outside the now smaller visible region; manual panning remains free.
    const observer=new ResizeObserver(centerGraph);
    observer.observe(container);
    observer.observe(svg);
    return ()=>observer.disconnect();
  },[focusedId,layout,vw]);

  return <section className="vault-root container vault-graph-page">
    <div className="vault-topline">
      <Link href="/vault" className="back-link"><ArrowLeft size={16}/> 回到私人知識庫</Link>
      <span className="vault-privacy"><Network size={15}/> 僅展示你的私人知識</span>
    </div>
    <div className="vault-heading">
      <div>
        <span className="section-kicker">SECOND BRAIN / KNOWLEDGE ATLAS</span>
        <h1>知識網絡<span className="title-period">.</span></h1>
        <p>讓每篇筆記不再只是孤立的文字。選取節點、探索兩層關係，或從清單直接進入原始筆記。</p>
      </div>
      <Link href="/vault/new" className="button-primary"><GitBranch size={17}/> 建立新知識</Link>
    </div>

    {(notesTruncated||linksTruncated)&&
      <p role="status" className="vault-notice vault-graph-limit">
        <strong>目前顯示部分私人知識。</strong>
        本次最多載入最近 180 篇筆記及 2,400 條原始連結。
        請使用私人索引尋找其他筆記，未顯示的連結不代表不存在。
      </p>}
    <div className="vault-graph-toolbar" role="search">
      <div className="vault-graph-search">
        <Search size={17} aria-hidden="true"/>
        <label htmlFor="vault-graph-query" className="visually-hidden">搜尋知識節點</label>
        <input id="vault-graph-query" type="search" placeholder="搜尋筆記、標籤、概念…"
          maxLength={120} value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      <label className="vault-graph-category">
        <span>分類</span>
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="">全部分類</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="vault-graph-connectivity">
        <input type="checkbox" checked={connectedOnly}
          onChange={e=>setConnectedOnly(e.target.checked)}/>
        只看已連結的筆記
      </label>
      <button type="button" className="vault-graph-reset" onClick={clearAll}
        disabled={!selectedId&&!search&&!category&&!connectedOnly&&zoom===1}>
        <RotateCcw size={16}/> 清除篩選
      </button>
    </div>

    <div className="vault-graph-layout">
      <div className="vault-graph-stage">
        <div className="vault-graph-head">
          <div className="vault-graph-headline">
            <span className="section-kicker">{selected?"LOCAL GRAPH / TWO HOPS":"KNOWLEDGE CONSTELLATION"}</span>
            <h2>{selected?selected.title:"所有私人知識"}</h2>
            <p>{selected?"中心節點與最多兩層直接／間接關係":"依主題聚合，點選一個圓點聚焦關聯"}</p>
          </div>
          <div className="vault-graph-controls" aria-label="圖譜控制">
            {selected&&<button type="button" onClick={()=>setSelectedId(null)}
              className="vault-graph-focus-reset"><Focus size={15}/> 全覽</button>}
            <button type="button" aria-label="放大圖譜" onClick={()=>setZoom(z=>Math.min(1.5,+(z+0.15).toFixed(2)))}
              disabled={zoom>=1.5}><ZoomIn size={18}/></button>
            <button type="button" aria-label="縮小圖譜" onClick={()=>setZoom(z=>Math.max(0.75,+(z-0.15).toFixed(2)))}
              disabled={zoom<=0.75}><ZoomOut size={18}/></button>
          </div>
        </div>

        {layout.points.length?
          <div ref={graphScrollRef} className="vault-graph-scroll" role="region" tabIndex={0}
            aria-label="互動式私人知識圖譜，可左右捲動，也可使用下方的筆記清單">
            <svg className="vault-graph-svg" xmlns="http://www.w3.org/2000/svg"
              viewBox={viewBox} role="group" aria-label={selected?selected.title+" 的兩層知識關係":"私人知識網絡，點選圓點查看關係"}
              preserveAspectRatio="xMidYMid meet">
              <defs>
                <pattern id="vault-graph-grid" width="44" height="44" patternUnits="userSpaceOnUse">
                  <circle cx="1.2" cy="1.2" r="1" fill="currentColor" opacity=".10"/>
                </pattern>
              </defs>
              <rect width={GRAPH_W} height={GRAPH_H} fill="url(#vault-graph-grid)"/>
              {layout.edges.map((e,i)=>{
                const a=positions.get(e.source),b=positions.get(e.target);
                if(!a||!b)return null;
                const highlighted=Boolean(selected&&(selected.id===e.source||selected.id===e.target));
                return <line key={e.source+":"+e.target+":"+i}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className={highlighted?"vault-graph-edge active":"vault-graph-edge"}/>;
              })}
              {layout.points.map(p=>{
                const n=byId.get(p.id);
                if(!n)return null;
                const isSelected=n.id===selected?.id;
                const size=isSelected?17:Math.min(14,8+Math.sqrt(p.weight)*2);
                const showLabel=isSelected||p.weight>1||layout.points.length<=24;
                return <g role="button" tabIndex={0} key={p.id}
                    aria-label={"選取知識筆記："+n.title} aria-pressed={isSelected}
                    onClick={()=>select(n.id)}
                    onKeyDown={e=>{
                      if(e.key==="Enter"||e.key===" "){e.preventDefault();select(n.id);}
                    }}
                    className={isSelected?"vault-graph-node selected":"vault-graph-node"}>
                  <title>{n.title+" · "+n.category}</title>
                  <circle className="vault-graph-hit" cx={p.x} cy={p.y} r={Math.max(size+10,25)}/>
                  {isSelected&&<circle className="vault-graph-halo" cx={p.x} cy={p.y} r={size+14}/>}
                  <circle className="vault-graph-dot" cx={p.x} cy={p.y} r={size}/>
                  {showLabel&&<text x={p.x} y={p.y-size-15}
                    className="vault-graph-node-label" textAnchor="middle">
                    {n.title.length>14?n.title.slice(0,13)+"…":n.title}
                  </text>}
                </g>;
              })}
            </svg>
          </div>:
          <div className="vault-graph-blank">
            <Network size={30}/>
            <strong>{graph.nodes.length?"沒有符合篩選的知識":"知識網絡還是空白的"}</strong>
            <p>{graph.nodes.length?"試著取消分類或關鍵字篩選。":"從一篇筆記開始，使用 [[知識名稱]] 連結相關觀念。"}</p>
            <Link href={graph.nodes.length?"/vault":"/vault/new"} className="text-link">
              {graph.nodes.length?"瀏覽私人知識索引":"新增第一篇筆記"}
            </Link>
          </div>}
        <p className="vault-graph-mobile-hint">可左右滑動圖譜；也可以從下方清單選取筆記。</p>
        <div className="vault-graph-foot">
          <span>{matchCount} 篇筆記 · {filtered.edges.length} 條已解析關聯</span>
          <span>{layout.partial?"圖譜已依目前操作縮減節點；下方清單仍可查閱。":"點選圓點以探索關聯"}</span>
        </div>
      </div>

      <aside className="vault-graph-inspector" aria-label="知識節點詳情">
        <span className="section-kicker">INSPECTOR / KNOWLEDGE</span>
        {selected?<>
          <div className="vault-graph-inspector-title">
            <small>{selected.category}</small>
            <h2>{selected.title}</h2>
            <p>{selected.slug}</p>
          </div>
          <div className="vault-item-tags">
            {selected.tags.map(t=><span key={t}>#{t}</span>)}
          </div>
          <div className="vault-graph-inspector-stats">
            <div><strong>{neighbours.length}</strong><span>相鄰筆記</span></div>
            <div><strong>{layout.points.length}</strong><span>目前節點</span></div>
          </div>
          <Link href={`/vault/${selected.id}`} className="vault-graph-open-note">
            開啟／編輯原始筆記 <ArrowRight size={17}/>
          </Link>
          <h3><Link2 size={15}/> 直接相關的知識</h3>
          <div className="vault-graph-neighbours">
            {neighbours.length?neighbours.map(id=>{
              const n=byId.get(id);
              return n?<button key={id} type="button" onClick={()=>setSelectedId(id)}>
                <span>{n.title}<small>{n.category}</small></span><Focus size={15}/>
              </button>:null;
            }):<p>尚未有其他筆記引用這個節點，或目前關聯被篩選條件排除。</p>}
          </div>
        </>:<>
          <div className="vault-graph-inspector-title">
            <Network size={28}/>
            <h2>知識會互相生長。</h2>
            <p>選擇圖上的任一節點，查看與它相鄰的私人知識；也能透過下方清單尋找目標。</p>
          </div>
          <div className="vault-graph-inspector-stats">
            <div><strong>{graph.nodes.length}</strong><span>已載入筆記</span></div>
            <div><strong>{graph.edges.length}</strong><span>已解析關係</span></div>
          </div>
        </>}
        {graph.unresolvedCount>0&&
          <p className="vault-graph-unresolved">有 {graph.unresolvedCount} 條關係尚未在本次載入的知識中解析；可能是尚未建立的筆記，也可能超出本次顯示範圍。</p>}
      </aside>
    </div>

    <div className="vault-graph-directory">
      <div className="vault-list-heading">
        <h2>知識節點清單</h2>
        <span>提供鍵盤及螢幕閱讀器可用的替代導覽 · {matchCount} 篇</span>
      </div>
      <div className="vault-graph-directory-list">
        {filtered.nodes.length?filtered.nodes.map(n=><div key={n.id} className="vault-graph-directory-item">
          <button type="button" onClick={()=>select(n.id)}
            aria-pressed={selected?.id===n.id}
            aria-label={"聚焦筆記 "+n.title}><Focus size={17}/></button>
          <div><strong>{n.title}</strong><small>{n.category} · {n.tags.slice(0,3).join(" · ")}</small></div>
          <Link href={`/vault/${n.id}`} aria-label={"開啟私人筆記 "+n.title}>
            <ArrowRight size={17}/>
          </Link>
        </div>):<p className="vault-graph-no-results">目前沒有符合條件的筆記。</p>}
      </div>
    </div>
  </section>;
}
