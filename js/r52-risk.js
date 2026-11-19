/* R52：00406A 投信公開部位與保守型風險雷達。只讀資料，不觸及任何私人帳務。 */
(function(){
'use strict';
const FEED='./data/portfolio.json';
const OFFICIAL='https://www.ctbcinvestments.com/Etf/00682450/Info';
const RULES=[
  {id:'stock',name:'單一股票權重',warn:8,high:12,unit:'%',field:'maxSingleStockPct'},
  {id:'exposure',name:'股票＋期貨總曝險',warn:105,high:115,unit:'%',field:'grossExposurePct'},
  {id:'sector',name:'單一產業集中度',warn:25,high:35,unit:'%',field:'sectorConcentrationPct'},
  {id:'option',name:'賣出買權名目比重',warn:20,high:25,unit:'%',field:'optionNotionalPct'},
  {id:'drawdown',name:'配息調整後市價回落',warn:10,high:15,unit:'%',field:'adjustedPriceDrawdownPct'},
  {id:'premium',name:'ETF 市價溢價',warn:1,high:2,unit:'%',field:'premiumPct'}
];
const el=id=>document.getElementById(id);
const put=(id,s)=>{const n=el(id);if(n)n.textContent=String(s);};
const create=(tag,css,txt)=>{const n=document.createElement(tag);if(css)n.className=css;if(txt!==undefined)n.textContent=String(txt);return n;};
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const day=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(new Date(s+'T12:00:00+08:00').getTime());
const numeric=x=>x!==null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const stage=(value,warn,high)=>value===null?'unknown':value>=high?'high':value>=warn?'watch':'normal';
let payload=null,flight=null,checked=0,details=false;
function safeRows(rows,type){
  if(!Array.isArray(rows))return [];
  return rows.slice(0,350).filter(x=>x&&typeof x==='object').map(x=>{
    const code=String(x.code||'').trim().slice(0,40),name=String(x.name||'').trim().slice(0,100);
    const weight=numeric(type==='stock'?x.weight:x.reportedWeight);
    const amount=numeric(type==='stock'?x.shares:x.quantity);
    if(!name&&!code)return null;
    return {code,name,weight,amount};
  }).filter(Boolean);
}
function validate(raw){
  if(!raw||raw.schema!==1||raw.code!=='00406A')throw Error('資料版本或商品不符');
  const latest=raw.latest,previous=raw.previous;
  if(latest!==null&&latest!==undefined&&(!day(latest.date)||!Array.isArray(latest.stocks)))throw Error('無效最新持股');
  if(previous!==null&&previous!==undefined&&(!day(previous.date)||!Array.isArray(previous.stocks)))throw Error('無效前期持股');
  const metrics=raw.metrics&&typeof raw.metrics==='object'?raw.metrics:{};
  const safe={};
  for(const field of [...RULES.map(x=>x.field),'dividendLatest','dividendPrevious','stockWeightPct','top10WeightPct']){
    const val=numeric(metrics[field]);
    safe[field]=val!==null&&Math.abs(val)<=1000?val:null;
  }
  // Note: options notional and exposure are set to null by the data provider
  // unless a verified and comparable nominal/Delta measure exists.
  const entries=Array.isArray(raw.changes)?raw.changes.slice(0,200):[];
  const changes=entries.filter(x=>x&&typeof x==='object'&&String(x.code||'').length<=40)
    .map(x=>({code:String(x.code||'').slice(0,40),name:String(x.name||'').slice(0,100),
      type:String(x.type||'').slice(0,25),prevQty:numeric(x.previousShares),
      qty:numeric(x.shares),delta:numeric(x.sharesDelta),
      prevWt:numeric(x.previousWeight),wt:numeric(x.weight),deltaPp:numeric(x.weightDeltaPp)}));
  return {
    date:latest?.date||null,previousDate:previous?.date||null,
    holdings:safeRows(latest?.stocks,'stock'),futures:safeRows(latest?.futures,'deriv'),
    options:safeRows(latest?.options,'deriv'),
    unknownGroups:Array.isArray(latest?.unknownGroups)?latest.unknownGroups.map(x=>String(x).slice(0,40)):[],
    nav:numeric(latest?.nav),priceDate:day(metrics.priceDate)?metrics.priceDate:null,
    checkedAt:String(raw.checkedAt||'').slice(0,35),
    metrics:safe,changes,errors:Array.isArray(raw.errors)?raw.errors.slice(0,10).map(x=>String(x).slice(0,180)):[]
  };
}
function renderRisks(data,stale){
  const host=el('r52_risks');if(!host)return;
  host.replaceChildren();
  let high=0,watch=0,unknown=0,known=0;
  const entries=RULES.map(r=>{
    let value=data?.metrics[r.field]??null;
    // Only the official comparable dated holdings may be rated; price-only drawdown
    // can be rated from valid public history without holdings.
    if(stale && r.id!=='drawdown')value=null;
    if(r.id==='premium' && (!data?.date || data.date!==data.priceDate))value=null;
    if(r.id==='drawdown' && (!data?.priceDate || new Date()-new Date(data.priceDate+'T23:59:59+08:00')>5*86400000))value=null;
    const level=stage(value,r.warn,r.high);
    return {r,value,level};
  });
  const last=data?.metrics.dividendLatest??null,prev=data?.metrics.dividendPrevious??null;
  const drop=(last!==null&&prev!==null&&prev>0)?(prev-last)/prev*100:null;
  const divStatus=last===null?'unknown':last<0.10?'high':drop!==null&&drop>=10?'watch':drop===null?'unknown':'normal';
  entries.push({r:{id:'dividend',name:'每股配息',unit:'元'},value:last,level:divStatus});
  for(const entry of entries){
    const {r,value,level}=entry;
    if(level==='high')high++;else if(level==='watch')watch++;else if(level==='unknown')unknown++;else known++;
    const colors={high:'border-red-700/70 bg-red-950/30',watch:'border-amber-700/70 bg-amber-950/20',
      normal:'border-emerald-800/70 bg-slate-900/70',unknown:'border-slate-700 bg-slate-900/50'};
    const label={high:'🔴 高度警戒',watch:'🟡 注意',normal:'🟢 未觸發',unknown:'⚪ 待核對'}[level];
    const item=create('div','rounded-lg border p-3 '+colors[level]);
    item.append(create('p','text-xs text-slate-300',r.name));
    item.append(create('p','text-xl font-bold mt-1 text-white',value===null?'待核對':fmt(value,r.id==='dividend'?3:2)+r.unit));
    item.append(create('p','text-xs mt-1 text-slate-300',label));
    item.append(create('p','text-xs mt-1 text-slate-400',r.id==='dividend'
      ?'低於 0.10 元紅燈；較前期減少 10% 黃燈'
      :'注意 ≥ '+r.warn+'%；高度警戒 ≥ '+r.high+'%'));
    host.append(item);
  }
  const label=high?'🔴 '+high+' 項高度警戒':watch?'🟡 '+watch+' 項注意':unknown?'⚪ 部分待核對':'🟢 未觸發設定門檻';
  put('r52_overall',label+'｜'+unknown+' 項待核對');
  put('r52_coverage','已判讀 '+(high+watch+known)+' / '+entries.length+' 項｜不代表基金無風險');
}
function renderChanges(d){
  const holder=el('r52_changes');if(!holder)return;
  holder.replaceChildren();
  if(!d?.previousDate || !d?.date || d.previousDate>=d.date){
    holder.append(create('p','text-sm text-slate-400 p-3','尚未累積相鄰兩次官方持股快照，暫不計算個股增減。'));return;
  }
  const filtered=d.changes.filter(x=>x.type!=='weight_only');
  const rows=(details?filtered:filtered.slice(0,12));
  put('r52_change_count','股數異動 '+filtered.length+' 檔｜'+d.previousDate+' → '+d.date);
  for(const x of rows){
    const item=create('article','rounded-lg bg-slate-900/70 border border-slate-700 p-3');
    const typeText={new:'新增',removed:'退出',increase:'持股增加',decrease:'持股減少'}[x.type]||'權重改變';
    const title=create('div','flex flex-wrap items-center justify-between gap-2');
    title.append(create('strong','text-sm text-slate-100',x.code+' '+x.name));
    title.append(create('span','text-xs text-cyan-200',typeText));
    item.append(title);
    item.append(create('p','text-xs text-slate-300 mt-2','股數 '+fmt(x.prevQty,0)+' → '+fmt(x.qty,0)+'（'+(x.delta>0?'+':'')+fmt(x.delta,0)+'）'));
    item.append(create('p','text-xs text-slate-400 mt-1','權重 '+fmt(x.prevWt)+'% → '+fmt(x.wt)+'%（'+(x.deltaPp>0?'+':'')+fmt(x.deltaPp)+' pp）'));
    holder.append(item);
  }
  const btn=el('r52_toggle_details');
  if(btn){btn.hidden=filtered.length<=12;btn.textContent=details?'收合個股異動':'顯示全部 '+filtered.length+' 檔';}
}
function renderPositions(d){
  const stock=el('r52_holdings'),future=el('r52_futures'),option=el('r52_options');
  if(stock){
    stock.replaceChildren();
    if(!d?.holdings.length)stock.append(create('p','text-sm text-slate-400','尚無可驗證的股票持股'));
    for(const x of (d?.holdings||[]).slice(0,10)){
      const item=create('div','flex justify-between gap-2 rounded bg-slate-900/60 p-2 text-sm');
      item.append(create('span','text-slate-200',x.code+' '+x.name));
      item.append(create('strong','text-cyan-200',fmt(x.weight)+'%'));
      stock.append(item);
    }
  }
  for(const [host,rows] of [[future,d?.futures],[option,d?.options]]){
    if(!host)continue;
    host.replaceChildren();
    if(!rows?.length){host.append(create('p','text-sm text-slate-400','來源尚未提供可辨識的該類部位；不代表基金沒有此類部位。'));continue;}
    for(const x of rows.slice(0,15)){
      const card=create('div','rounded bg-slate-900/60 p-2 text-sm space-y-1');
      card.append(create('p','text-slate-200',x.name||x.code));
      card.append(create('p','text-xs text-slate-400','揭露數量／口數 '+fmt(x.amount,0)+'｜揭露權重 '+(x.weight===null?'未提供':fmt(x.weight)+'%')));
      host.append(card);
    }
  }
  put('r52_stock_total',d?.holdings.length?d.holdings.length+' 檔股票｜合計 '+fmt(d.metrics.stockWeightPct)+'%':'股票資料待取得');
}
function render(){
  if(!el('r52_panel'))return;
  const d=payload;
  const diff=d?.date?(Date.now()-new Date(d.date+'T23:59:59+08:00'))/86400000:null;
  const stale=diff===null||diff>5;
  put('r52_status',!d?.date?'⚪ 尚未取得有效官方持股；風險判讀待核對':
      '官方持股基準日 '+d.date+(stale?'｜⚠️ 資料可能過期':'｜已取得持股快照')+
      (d.errors.length?'｜部分來源失敗':''));
  put('r52_comparison',d?.previousDate?'比較期間 '+d.previousDate+' → '+d.date:'等待第二個有效持股快照');
  const warnings=[...(d?.errors||[])];
  if(d?.unknownGroups.length)warnings.push('未辨識的持股分類：'+d.unknownGroups.join('、')+'；不據此判定期貨或選擇權風險。');
  if(!d?.futures.length)warnings.push('尚無可驗證的期貨明細，無法計算期貨淨曝險。');
  if(!d?.options.length)warnings.push('尚無可驗證的選擇權明細，無法計算買權名目比重。');
  if(stale)warnings.push('持股基準日超過 5 日或尚未取得，所有持股風險暫停分級。');
  if(!warnings.length)warnings.push('公開數據已取得；仍須注意揭露時間差、申購贖回及避險部位。');
  const n=el('r52_notes');
  if(n){n.replaceChildren();for(const w of warnings)n.append(create('p','text-xs text-slate-300','• '+w));}
  renderRisks(d,stale);renderChanges(d);renderPositions(d);
}
async function refresh(force=false){
  if(flight)return flight;
  if(!force&&checked&&Date.now()-checked<15*60000)return;
  flight=(async()=>{
    try{
      const response=await fetch(FEED+'?v='+Math.floor(Date.now()/60000),{cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status);
      payload=validate(await response.json());checked=Date.now();render();
    }catch(e){console.warn('R52 公開持股暫不可用',e);put('r52_status','⚪ 公開持股快照暫不可用，保留原資料並顯示待核對');render();}
  })().finally(()=>{flight=null;});
  return flight;
}
function init(){
  if(!el('r52_panel'))return;
  const check=el('r52_check'),toggle=el('r52_toggle_details'),official=el('r52_official');
  if(check)check.addEventListener('click',()=>{void refresh(true);});
  if(toggle)toggle.addEventListener('click',()=>{details=!details;renderChanges(payload);});
  if(official)official.href=OFFICIAL;
  render();void refresh(false);
}
window.R52Risk={refresh,render,validate,open:()=>{void refresh(false);}};
window.addEventListener('load',init);
window.addEventListener('focus',()=>{if(!document.hidden)void refresh(false);});
window.setInterval(()=>{if(!document.hidden)void refresh(false);},15*60*1000);
})();
