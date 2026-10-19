/* R44：讀取 GitHub Actions 已發布的公開市場資料。私人交易與實收股息只在瀏覽器。 */
(function(){
'use strict';
const FEED='./data/market.json';
let latestSnapshot=null, inFlight=null, lastCheck=0;
function el(id){return document.getElementById(id);}
function status(message){const node=el('r44_sync_status');if(node)node.textContent=message;}
function day(s){return typeof s==='string'&&typeof r24SafeDate==='function'&&r24SafeDate(s)===s;}
function applyFeed(feed){
  if(!feed||feed.schema!==1||feed.code!=='00406A'||!Array.isArray(feed.prices)||!Array.isArray(feed.dividends))
    throw Error('版本、商品代號或資料結構不符');
  const today=r42LocalToday();
  const market=feed.prices.filter(x=>x&&day(x.date)&&x.date<=today&&
    Number.isFinite(Number(x.close))&&Number(x.close)>0&&Number(x.close)<100000&&
    Number.isFinite(Number(x.Trading_Volume))&&Number(x.Trading_Volume)>=0)
    .map(x=>({...x,close:Number(x.close),Trading_Volume:Number(x.Trading_Volume),
      Trading_money:Number(x.Trading_money)||0})).sort((a,b)=>a.date.localeCompare(b.date));
  const published=feed.dividends.filter(x=>x&&day(x.exDate)&&day(x.payDate)&&
    (x.amount==null||(Number.isFinite(Number(x.amount))&&Number(x.amount)>0&&Number(x.amount)<100)))
    .map(x=>({exDate:x.exDate,payDate:x.payDate,amount:x.amount==null?null:Number(x.amount),
      stage:x.stage==='confirmed'&&x.amount!=null?'confirmed':
        x.amount!=null?'source_amount':'scheduled',
      source:String(x.source||'GitHub 排程公告')}));
  if(market.length){
    // 合併歷史價格；若已有更新的 FinMind／Yahoo 報價，不以舊價格覆蓋。
    const oldLast=rawPriceData.length?String(rawPriceData[rawPriceData.length-1].date):'';
    const index=new Map();
    for(const row of rawPriceData){if(row&&day(row.date)&&Number(row.close)>0)index.set(row.date,row);}
    for(const row of market){if(!index.has(row.date)||row.date>=oldLast)index.set(row.date,row);}
    rawPriceData=[...index.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const recent=rawPriceData[rawPriceData.length-1];
    const live=el('price_label')?.textContent.includes('盤中即時') || (window.R49Quote && window.R49Quote.isCurrent());
    if(recent&&recent.date===market[market.length-1].date&&!live){
      currentPrice=Number(recent.close);
      if(el('latest_price'))el('latest_price').textContent=currentPrice.toFixed(2);
      if(el('price_label'))el('price_label').textContent='最近收盤（'+recent.date+'・公開資料）';
      if(el('live_indicator')){
        el('live_indicator').classList.remove('bg-green-400');
        el('live_indicator').classList.add('bg-gray-600');
      }
    }
    // 僅喚起原本讀取市場價格的顯示函式，絕不寫交易紀錄。
    for(const [name,fn] of [
      ['主帳戶估值',()=>updateHoldingCalculations()],
      ['首頁摘要',()=>r23Render()],
      ['主帳戶資產',()=>r25Render()],
      ['帳戶資產',()=>r34Render()],
      ['量能雷達',()=>r40Render()],
      ['績效摘要',()=>r37RefreshIfOpen()],
      ['XIRR',()=>{if(!el('tab-efficiency')?.classList.contains('hidden'))r38Render();}],
      ['價格圖',()=>{if(!el('tab-charts')?.classList.contains('hidden'))renderTrendChart(currentChartTimeframe);}],
    ]){try{fn();}catch(e){console.warn('R44 更新'+name,e);}}
  }
  if(published.length){
    const index=new Map(r42OfficialRows.map(x=>[x.exDate,x]));
    for(const row of published)index.set(row.exDate,row);
    r42OfficialRows=[...index.values()].sort((a,b)=>a.exDate.localeCompare(b.exDate));
    const official=published.filter(x=>x.stage==='confirmed');
    if(official.length){
      r24Rows=r24ParseRows([...r24Rows,...official]);
      r24Source='公開市場配息（證交所＋既有 FinMind）';
      r24CacheAt=feed.dividendsUpdatedAt||new Date().toISOString();
      try{localStorage.setItem(R24_DIV_CACHE_KEY,JSON.stringify({at:r24CacheAt,rows:r24Rows}));}
      catch(e){console.warn('R44 無法儲存公開配息快取',e);}
      try{r24Render();}catch(e){console.warn('R44 配息圖表更新',e);}
    }
  }
  const when=feed.checkedAt?String(feed.checkedAt).replace('T',' ').slice(0,16):'尚未首次執行';
  const priceDay=market.length?market[market.length-1].date:'尚無價格';
  const old=feed.checkedAt&&Number.isFinite(Date.parse(feed.checkedAt))
    &&Date.now()-Date.parse(feed.checkedAt)>48*3600*1000;
  status('🌐 市場資料：'+when+'｜最新交易日 '+priceDay+
    (old?'｜更新超過48小時':'')+
    (Array.isArray(feed.errors)&&feed.errors.length?'｜部分來源失敗':''));
  r42Live=false; // GitHub 排程快照不是即時官方連線。
  r42CheckNote=published.length?'GitHub 公開資料最後檢查 '+when+'（非即時；正式公告優先）':'尚無有效的排程除息公告';
  try{r42Render();if(r32Initialized)r32Render();}catch(e){console.warn('R44 提醒更新',e);}
  window.dispatchEvent(new CustomEvent('r44:feed', {detail:{feed}}));
  return market.length+published.length;
}
async function refresh(force=false){
  if(inFlight)return inFlight;
  if(!force&&lastCheck&&Date.now()-lastCheck<300000)return;
  const button=el('r44_refresh_btn');
  if(button)button.disabled=true;
  status('🌐 正在檢查公開市場資料…');
  inFlight=(async()=>{
    try{
      const response=await fetch(FEED+'?v='+Math.floor(Date.now()/60000),{cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const body=await response.json();
      const count=applyFeed(body);
      latestSnapshot=body;lastCheck=Date.now();
      if(!count&&!body.checkedAt)status('🌐 已設定自動排程；等待 GitHub Actions 首次成功更新。');
    }catch(e){
      console.warn('R44 公開資料來源不可用',e);
      status('⚠️ 公開市場資料暫不可用；保留原有行情／配息資訊。');
      window.dispatchEvent(new Event('r44:error'));
    }
  })().finally(()=>{inFlight=null;if(button)button.disabled=false;});
  return inFlight;
}
window.r44Refresh=refresh;
// 使用者手動 FinMind 更新完成後，再依官方排程資料核對，防止舊公告覆蓋新日期。
const oldFetch=fetchData;
fetchData=async function(...args){
  const result=await oldFetch.apply(this,args);
  if(latestSnapshot)applyFeed(latestSnapshot);
  return result;
};
window.addEventListener('load',()=>{void refresh(false);});
})();