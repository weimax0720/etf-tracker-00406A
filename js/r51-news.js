/* R51 公開消息面：新聞只是第三方標題索引，絕非正式公告或買賣訊號。 */
(function(){
'use strict';
const FEED='./data/news.json';
const CATS={all:'全部消息',etf:'00406A 動態',dividend:'配息與除息',holdings:'持股調整',market:'台股大盤',industry:'產業消息'};
let articles=[],selected='all',search='',shown=12,lastRead=0,inFlight=null,lastChecked='',lastError='';
const el=id=>document.getElementById(id);
function plain(s,max=240){return String(s||'').trim().slice(0,max);}
function validDate(v){const d=new Date(String(v||''));return Number.isFinite(d.getTime())?d:null;}
function validLink(value){
  try{
    const u=new URL(String(value||''));
    return u.protocol==='https:'&&u.hostname.includes('.')&&!u.username&&!u.password&&u.href.length<1800?u.href:'';
  }catch(_){return '';}
}
function normalize(raw){
  if(!raw || raw.schema!==1 || raw.code!=='00406A' || !Array.isArray(raw.articles))
    throw Error('新聞資料格式或商品代碼不符');
  const now=Date.now(),byTitle=new Map();
  for(const rec of raw.articles){
    if(!rec || !Object.hasOwn(CATS,rec.category) || rec.category==='all')continue;
    const when=validDate(rec.publishedAt),url=validLink(rec.url),title=plain(rec.title,230);
    if(!when||when.getTime()>now+2*3600000||now-when.getTime()>15*86400000||!url||title.length<7)continue;
    const key=title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'').slice(0,110);
    if(!key || byTitle.has(key))continue;
    byTitle.set(key,{title,url,category:rec.category,source:plain(rec.source,70)||'新聞來源',date:when});
  }
  return [...byTitle.values()].sort((a,b)=>b.date-a.date).slice(0,60);
}
function day(d){return d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function make(tag,className,text){
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function render(){
  const host=el('r51_list');if(!host)return;
  const needle=search.toLocaleLowerCase();
  const found=articles.filter(x=>(selected==='all'||x.category===selected)
    &&(!needle||(x.title+' '+x.source+' '+CATS[x.category]).toLocaleLowerCase().includes(needle)));
  const displayed=found.slice(0,shown);
  host.replaceChildren();
  for(const item of displayed){
    const article=make('article','rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-2');
    const header=make('div','flex flex-wrap justify-between items-center gap-2');
    header.append(make('span','text-xs font-semibold text-cyan-200',CATS[item.category]));
    header.append(make('time','text-xs text-slate-400',day(item.date)));
    const link=make('a','block text-base font-semibold text-white hover:text-cyan-300 underline-offset-4 hover:underline',item.title);
    link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
    const meta=make('p','text-xs text-slate-400','來源：'+item.source+' · 開啟來源新聞（可能經 Google 新聞轉址）');
    article.append(header,link,meta);host.appendChild(article);
  }
  if(!displayed.length){
    const text=!articles.length
      ?'暫無有效新聞標題；請查看下方官方連結。若來源暫時無法讀取，會顯示最近一次公開索引。'
      :'這個條件目前沒有消息，請切換分類或清除搜尋條件。';
    host.appendChild(make('p','rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-300',text));
  }
  if(el('r51_count'))el('r51_count').textContent='符合 '+found.length+' 則｜顯示 '+displayed.length+' 則';
  const more=el('r51_more');
  if(more){more.hidden=displayed.length>=found.length;more.disabled=displayed.length>=found.length;}
}
function apply(raw){
  articles=normalize(raw);
  lastChecked=plain(raw.checkedAt||raw.updatedAt,35);
  lastError=Array.isArray(raw.errors)&&raw.errors.length?'｜部分消息來源無法讀取':'';
  const when=validDate(lastChecked);
  const stale=!when||(Date.now()-when.getTime()>48*3600000);
  const msg='📰 消息索引'+(when?'：'+day(when):'尚未檢查')+
    (stale?'｜資料超過 48 小時':'')+lastError+
    '｜第三方新聞非官方公告';
  if(el('r51_status'))el('r51_status').textContent=msg;
  render();
}
async function refresh(force=false){
  if(inFlight)return inFlight;
  if(!force&&lastRead&&Date.now()-lastRead<15*60000)return;
  inFlight=(async()=>{
    try{
      const result=await fetch(FEED+'?v='+Math.floor(Date.now()/60000),{cache:'no-store'});
      if(!result.ok)throw Error('HTTP '+result.status);
      apply(await result.json());lastRead=Date.now();
    }catch(e){
      if(el('r51_status'))el('r51_status').textContent='⚠️ 消息來源暫不可用，保留已載入內容。可前往證交所查看正式資訊。';
      console.warn('R51 news fetch unavailable',e);
      render();
    }
  })().finally(()=>{inFlight=null;});
  return inFlight;
}
function init(){
  if(!el('r51_list'))return;
  const select=el('r51_category'),input=el('r51_search'),more=el('r51_more'),check=el('r51_check');
  if(select)select.addEventListener('change',()=>{selected=Object.hasOwn(CATS,select.value)?select.value:'all';shown=12;render();});
  if(input)input.addEventListener('input',()=>{search=String(input.value||'').trim().slice(0,100);shown=12;render();});
  if(more)more.addEventListener('click',()=>{shown+=12;render();});
  if(check)check.addEventListener('click',()=>{void refresh(true);});
  const official=el('r51_twse_dividends');
  if(official){
    const year=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,4);
    const p=new URL('https://www.twse.com.tw/zh/ETFortune/dividendList');
    p.searchParams.set('startDate',year);p.searchParams.set('endDate',year);p.searchParams.set('stkNo','00406A');
    official.href=p.href;
  }
  render();void refresh(false);
}
window.R51News={refresh,render,normalize,open:()=>{void refresh(false);}};
window.addEventListener('load',init);
window.addEventListener('focus',()=>{if(!document.hidden)void refresh(false);});
window.setInterval(()=>{if(!document.hidden)void refresh(false);},15*60*1000);
})();
