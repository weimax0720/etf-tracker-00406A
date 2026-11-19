/* R52: public risk guardrails and UI integrations; no personal data or live network. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const html=read('index.html'),script=read('js/r52-risk.js'),sw=read('sw.js');
const ci=read('.github/workflows/update-portfolio.yml'),py=read('scripts/update_portfolio.py');
for(const id of ['r52_panel','r52_status','r52_risks','r52_changes','r52_holdings',
                 'r52_futures','r52_options','r52_overall','r52_plain_summary','r52_official']){
 assert.ok(html.includes('id="'+id+'"'),'missing '+id);
}
assert.match(html,/src="\.\/js\/r52-risk\.js"/);
assert.match(html,/window\.R52Risk\) window\.R52Risk\.open/);
assert.equal((html.match(/id="btn-[^"]+" class="tab-btn/g)||[]).length,20,'20 existing tabs must remain');
assert.match(sw,/const APP_CACHE='00406A-r52-shell-v3'/);
assert.match(sw,/portfolioUrl\(\)/);
assert.match(sw,/js\/r52-risk\.js/);
assert.match(ci,/scripts\/update_portfolio\.py/);
assert.match(py,/www\.ctbcinvestments\.com\.tw/);
assert.doesNotMatch(script,/localStorage|sessionStorage|indexedDB|document\.cookie|\.innerHTML\s*=/,'risk client must be read-only and safe');
new vm.Script(script,{filename:'js/r52-risk.js'});
new vm.Script(sw,{filename:'sw.js'});
const elements=new Map(),listeners={};
function node(){
 return {textContent:'',className:'',children:[],hidden:false,
  append(...items){this.children.push(...items);},
  replaceChildren(...items){this.children=items;},addEventListener(){}};
}
function element(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);}
let response=null;
const sandbox={console,Date,Number,String,Array,Object,Intl,URL,Math,
 window:{addEventListener:(name,fn)=>{listeners[name]=fn;},setInterval(){}},
 document:{getElementById:element,createElement:()=>node(),hidden:false},
 fetch:async()=>({ok:true,json:async()=>response})};
vm.runInNewContext(script,sandbox,{filename:'js/r52-risk.js'});
const obj=sandbox.window.R52Risk;
assert.equal(typeof obj.validate,'function');
const fresh=new Date().toISOString().slice(0,10);
function item(code,weight){return {code,name:'股票'+code,shares:100000,weight};}
response={schema:1,code:'00406A',checkedAt:new Date().toISOString(),
 latest:{date:fresh,stocks:[item('2330',12.5),item('2454',6.6)],
   futures:[{code:'TX',name:'臺股期貨',quantity:10,reportedWeight:24.1}],
   options:[{code:'TXX',name:'台指賣出買權',quantity:-22,reportedWeight:-8.3}],
   unknownGroups:['CASH']},
 previous:{date:'2026-11-17',stocks:[item('2330',11.1)]},
 changes:[{code:'2330',name:'台積電',type:'increase',previousShares:80000,
   shares:100000,sharesDelta:20000,previousWeight:11.1,weight:12.5,weightDeltaPp:1.4}],
 derivativeChanges:{
   futures:[{code:'TX',name:'臺股期貨',previousQuantity:8,quantity:10,quantityDelta:2,
     previousReportedWeight:22.7,reportedWeight:24.1,weightDeltaPp:1.4}],
   options:[{code:'TXX',name:'台指賣出買權',previousQuantity:-20,quantity:-22,quantityDelta:-2,
     previousReportedWeight:-7.5,reportedWeight:-8.3,weightDeltaPp:-0.8}]
 },
 metrics:{maxSingleStockPct:12.5,stockWeightPct:19.1,top10WeightPct:19.1,
   premiumPct:2.05,priceDate:fresh,adjustedPriceDrawdownPct:15.9,
   grossExposurePct:null,sectorConcentrationPct:null,optionNotionalPct:null,
   dividendLatest:0.09,dividendPrevious:0.138},
 errors:[]};
async function test(){
 await obj.refresh(true);
 assert.match(element('r52_overall').textContent,/高度警戒/);
 assert.match(element('r52_overall').textContent,/待核對/);
 assert.match(element('r52_coverage').textContent,/4 \/ 7 項/);
 assert.equal(element('r52_futures').children.length,1);
 assert.equal(element('r52_options').children.length,1);
 assert.match(element('r52_futures').children[0].children[2].textContent,/口數變化.*\+2/);
 assert.match(element('r52_options').children[0].children[2].textContent,/口數變化.*-2/);
 assert.equal(element('r52_changes').children.length,1);
 assert.match(element('r52_changes').children[0].children[1].textContent,/20,000/);
 assert.ok(element('r52_risks').children.filter(x=>x.children[2].textContent.includes('待核對')).length>=3);
 assert.match(element('r52_plain_summary').textContent,/目前最該注意/);
 assert.match(element('r52_plain_summary').textContent,/單一股票權重/);
 const riskCards=element('r52_risks').children;
 assert.equal(riskCards.length,7,'all seven warning categories explained');
 const stockCard=riskCards[0];
 assert.match(stockCard.children[4].textContent,/最大持股|最大一檔|股票/);
 assert.equal(stockCard.children[5].open,true,'red/yellow cards expand their explanation automatically');
 assert.match(stockCard.children[5].children[1].textContent,/這是什麼/);
 assert.match(stockCard.children[5].children[2].textContent,/可以怎麼做/);
 const drawdownCard=riskCards[4];
 assert.match(drawdownCard.children[4].textContent,/不是今天跌了/,'drawdown must not be misread as one-day loss');
 assert.match(drawdownCard.children[4].textContent,/不是你的實際虧損/);
 assert.equal(drawdownCard.children[5].open,true,'large drawdown must show explanation');
 const premiumCard=riskCards[5];
 assert.match(premiumCard.children[4].textContent,/折價/,'negative premium must be explained as discount');
 assert.match(riskCards[1].children[4].textContent,/無法判定/,'unknown derivatives exposure must explain missing basis');
 assert.match(riskCards[3].children[4].textContent,/口數/,'option notional must not be inferred from contracts');
 response={...response,latest:null,previous:null,changes:[],
  metrics:{...response.metrics,maxSingleStockPct:null,premiumPct:null,
   adjustedPriceDrawdownPct:null,dividendLatest:null,dividendPrevious:null}};
 await obj.refresh(true);
 assert.match(element('r52_overall').textContent,/部分待核對/);
 assert.doesNotMatch(element('r52_overall').textContent,/🟢 未觸發/);
 assert.match(element('r52_plain_summary').textContent,/灰燈不是安全保證/);
 assert.throws(()=>obj.validate({...response,code:'XYZ'}));
 assert.throws(()=>obj.validate({...response,latest:{date:'fake',stocks:[]}}));
 const live=JSON.parse(read('data/portfolio.json'));
 assert.equal(live.code,'00406A');assert.equal(live.schema,1);
 assert.ok(Array.isArray(live.changes));
 assert.equal(live.metrics.grossExposurePct,null,'must not invent futures exposure');
 assert.equal(live.metrics.optionNotionalPct,null,'must not invent option delta');
 console.log('R52 PASS: official snapshot, 20 tabs, futures and options, 7 conservative risk guards, missing-data gray, no private writes and PWA.');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
