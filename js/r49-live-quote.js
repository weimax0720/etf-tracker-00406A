/* R49: 公開的證交所最近成交報價。私有交易資料只在本機；不把盤中價寫入歷史收盤。 */
(function () {
  'use strict';
  const ENDPOINT='./data/quote.json';
  const POLL_MS=60000;
  const FRESH_MS=20*60000;
  let latest=null, inFlight=null, appliedKey='', applied=false;
  const byId=id=>document.getElementById(id);
  const put=(id,message)=>{const el=byId(id);if(el)el.textContent=message;};
  function taipeiDay(){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
      year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get=type=>parts.find(p=>p.type===type)?.value||'';
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function valid(q){
    if(!q||q.schema!==1||q.code!=='00406A')return false;
    const p=Number(q.price),ts=Date.parse(q.exchangeAt||'');
    return Number.isFinite(p)&&p>0&&p<100000&&
      typeof q.tradeDate==='string'&&q.tradeDate===taipeiDay()&&
      Number.isFinite(ts)&&ts<=Date.now()+120000&&Date.now()-ts<=FRESH_MS;
  }
  function status(q,reason){
    if(valid(q)){
      const stamp=String(q.tradeTime||'').slice(0,5);
      put('r49_quote_status','🕒 證交所最近成交 '+stamp+'｜自動檢查每60秒（排程約5分鐘，可能延遲）');
    }else{
      put('r49_quote_status',reason||'🕒 無有效盤中報價，顯示最近可取得的收盤參考價');
    }
  }
  function redraw(){
    const calls=[
      'updateHoldingCalculations','runDynamicSimulation','runKidsSimulation',
      'r23Render','r24Render','r25Render','r26Render','r29Render','r34Render',
      'r37RefreshIfOpen'
    ];
    for(const name of calls){
      try{if(typeof window[name]==='function')window[name]();}
      catch(e){console.warn('R49 連動 '+name+' 未能完成',e);}
    }
    for(const [tab,func] of [['report','r27Render'],['annual','r28Render'],
                             ['efficiency','r38Render'],['performance','r37Render']]){
      try{
        const node=byId('tab-'+tab);
        if(node&&!node.classList.contains('hidden')&&typeof window[func]==='function')
          window[func]();
      }catch(e){console.warn('R49 '+func,e);}
    }
    const d=new Date();
    const ym=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric'})
      .format(d))*100+Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',month:'numeric'}).format(d));
    const budget=ym>=203301?30000:ym>=203107?20000:ym>=202707?8000:5000;
    if(Number.isFinite(currentPrice)&&currentPrice>0){
      put('buyable_shares_label','約 '+budget/1000+' 千元購買力參考');
      put('buyable_shares',String(Math.floor(budget/currentPrice)));
    }
  }
  function apply(q){
    if(!valid(q))return false;
    latest=q;
    const key=q.exchangeAt+'|'+q.price;
    const changed=!applied||appliedKey!==key||Math.abs(Number(currentPrice)-Number(q.price))>0.00001;
    currentPrice=Number(q.price);
    put('latest_price',currentPrice.toFixed(2));
    put('price_label','盤中最近成交價（證交所 '+String(q.tradeTime||'').slice(0,5)+'，非零延遲）');
    const led=byId('live_indicator');
    if(led){led.classList.remove('bg-gray-600');led.classList.add('bg-green-400');}
    applied=true;appliedKey=key;
    status(q);
    if(changed)redraw();
    return true;
  }
  function expire(){
    if(!applied)return;
    applied=false;appliedKey='';
    // 過期的盤中交易不得冒充最新。使用原有公開日收盤資料備援。
    try{
      if(Array.isArray(rawPriceData)&&rawPriceData.length){
        const last=rawPriceData.filter(p=>p&&Number(p.close)>0&&
          /^\d{4}-\d{2}-\d{2}$/.test(String(p.date))&&p.date<=taipeiDay())
          .sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
        if(last){
          currentPrice=Number(last.close);
          put('latest_price',currentPrice.toFixed(2));
          put('price_label','最近收盤價（'+last.date+'；盤中報價已過期）');
          const led=byId('live_indicator');
          if(led){led.classList.remove('bg-green-400','animate-pulse');led.classList.add('bg-gray-600');}
          redraw();
        }
      }
    }catch(e){console.warn('R49 收盤備援',e);}
  }
  async function refresh(){
    if(inFlight)return inFlight;
    if(document.hidden)return;
    inFlight=(async()=>{
      try{
        const res=await fetch(ENDPOINT+'?t='+Date.now(),{cache:'no-store'});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const quote=await res.json();
        if(!apply(quote)){
          expire();
          status(quote,'🕒 證交所盤中報價已過期或尚未取得；改用最近收盤參考價');
        }
      }catch(e){
        expire();
        status(null,'⚠️ 盤中報價暫時無法讀取；保留歷史收盤參考價');
        console.warn('R49 公開盤中報價不可用',e.message);
      }
    })().finally(()=>{inFlight=null;});
    return inFlight;
  }
  window.R49Quote={refresh,isCurrent:()=>valid(latest),reapply:()=>{
    if(valid(latest))apply(latest);
  }};
  // 舊版 FinMind / Yahoo 下載可能較晚完成：完成後重新核對更新的盤中成交時間。
  if(typeof fetchData==='function'){
    const original=fetchData;
    fetchData=async function(...args){
      try{return await original.apply(this,args);}
      finally{if(valid(latest))apply(latest);}
    };
  }
  window.addEventListener('load',()=>{void refresh();});
  window.addEventListener('focus',()=>{void refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  window.setInterval(()=>{if(!document.hidden){
    void refresh();
    if(typeof window.r44Refresh==='function')void window.r44Refresh(false);
  }},POLL_MS);
})();
