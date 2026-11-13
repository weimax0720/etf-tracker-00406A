/* R50: newly confirmed official dividends update main and kids forecast basis, not private accounts. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const reader=fs.readFileSync(path.join(root,'js/auto-market.js'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
new vm.Script(reader,{filename:'js/auto-market.js'});
const nodes=new Map();
const getNode=id=>{
  if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',classList:{add(){},remove(){},contains(){return true;}}});
  return nodes.get(id);
};
const calls=[],writes=[];
let payload;
const sandbox={
  console,Date,Number,String,Array,Map,Math,Error,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail;}},
  window:{addEventListener(){},dispatchEvent(){},setInterval(fn){sandbox.tick=fn;}},
  document:{hidden:false,getElementById:getNode},
  localStorage:{setItem(k,v){writes.push(k);},getItem(){return null;}},
  fetch:async()=>({ok:true,json:async()=>payload}),
  currentPrice:8,rawPriceData:[],latestDividend:0,currentExDivDate:'',
  r42LocalToday:()=> '2026-11-13',
  r24SafeDate:s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'',
  r24ParseRows:rows=>[...new Map(rows.filter(x=>Number(x.amount)>0).map(x=>[x.exDate,{...x}])).values()]
    .sort((a,b)=>a.exDate.localeCompare(b.exDate)),
  r42OfficialRows:[],r24Rows:[],r24Source:'',r24CacheAt:'',R24_DIV_CACHE_KEY:'00406A_R24_DIV_CACHE_V1',
  r32Initialized:false,r42Live:false,r42CheckNote:'',
  r24Render(){calls.push('dividend-center');},
  r42Render(){calls.push('next-announcement');},
  r23Render(){calls.push('home');},
  r25Render(){calls.push('assets');},
  r34Render(){calls.push('family');},
  r26Render(){calls.push('topup');},
  r29Render(){calls.push('retirement');},
  runDynamicSimulation(){calls.push('main-compound');},
  runKidsSimulation(){calls.push('kids-compound');},
  fetchData:async()=>{sandbox.latestDividend=.138;sandbox.currentExDivDate='2026-10-05';},
};
vm.runInNewContext(reader,sandbox,{filename:'js/auto-market.js'});
function div(ex,amount,stage='confirmed'){
 return {exDate:ex,payDate:'2026-12-27',amount,stage,source:'臺灣證券交易所 ETF e添富'};
}
function feed(dividends){return {schema:1,code:'00406A',checkedAt:'2026-11-13T16:04:19+08:00',
  dividends,prices:[],errors:[]};}
async function check(){
 payload=feed([div('2026-11-03',.145),div('2026-12-03',null,'scheduled')]);
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.145);
 assert.equal(sandbox.currentExDivDate,'2026-11-03');
 assert.ok(calls.includes('main-compound')&&calls.includes('kids-compound'));
 assert.equal(getNode('latest_dividend_overview').textContent,'0.145');
 assert.equal(sandbox.r24Rows.length,1,'scheduled amount must never enter confirmed history');
 assert.ok(writes.every(k=>k===sandbox.R24_DIV_CACHE_KEY),'do not touch private ledger');
 calls.length=0;
 payload=feed([div('2026-10-05',.138),div('2026-12-03',.2,'estimated')]);
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.145,'older or estimated dividend cannot replace confirmed forecast basis');
 assert.ok(!calls.includes('main-compound')&&!calls.includes('kids-compound'),'no unnecessary forecast churn');
 payload=feed([div('2026-11-03',.155)]);
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.155,'corrected confirmed amount on same date applies');
 calls.length=0;
 await sandbox.fetchData();
 assert.equal(sandbox.latestDividend,.155,'older FinMind cannot override latest official announcement');
 assert.ok(calls.includes('main-compound')&&calls.includes('kids-compound'));
 // If FinMind knows a genuinely newer dated amount, old GitHub feed must not roll it back.
 sandbox.fetchData=async()=>{sandbox.latestDividend=.16;sandbox.currentExDivDate='2026-11-25';};
 payload=feed([div('2026-11-03',.155)]);
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.155);
 // no new invocation of the already-installed wrapper: simulate later dated FinMind manually
 sandbox.latestDividend=.16;sandbox.currentExDivDate='2026-11-25';
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.16);
 assert.equal(sandbox.currentExDivDate,'2026-11-25');
 payload=feed([div('2026-12-03',.17)]);
 await sandbox.window.r44Refresh(true);
 assert.equal(sandbox.latestDividend,.17);
 assert.match(sw,/00406A-r50-shell-v1/,'PWA must signal R50 update');
 console.log('R50 PASS: verified dividend -> main/kids forecasts; official corrections, stale FinMind guard, estimated exclusion and no ledger writes.');
}
check().catch(e=>{console.error(e);process.exitCode=1;});
