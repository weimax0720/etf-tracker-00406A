/* R49: quote freshness, cross-page update, stale fallback, no private accounting writes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
const reader=fs.readFileSync(path.join(dir,'js/r49-live-quote.js'),'utf8');
const feed=fs.readFileSync(path.join(dir,'js/auto-market.js'),'utf8');
assert.match(html,/r49_quote_status/);
assert.match(html,/src="\.\/js\/r49-live-quote\.js"/);
assert.match(sw,/00406A-r49-shell-v1/);
assert.match(sw,/js\/r49-live-quote\.js/);
assert.match(sw,/quoteUrl/);
assert.match(feed,/window\.R49Quote && window\.R49Quote\.isCurrent\(\)/);
assert.doesNotMatch(reader,/localStorage|sessionStorage|indexedDB/);
new vm.Script(reader);
new vm.Script(sw);
const nodes=new Map();
function getNode(id){
  if(!nodes.has(id))nodes.set(id,{
    textContent:'',classList:{add(){},remove(){},contains(){return true;}}
  });
  return nodes.get(id);
}
const calls=[];
let payload=null;
const localParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const p=type=>localParts.find(x=>x.type===type).value;
const today=p('year')+'-'+p('month')+'-'+p('day');
const context={currentPrice:10,rawPriceData:[{date:'2026-10-16',close:9.03}],
  document:{hidden:false,getElementById:getNode,addEventListener(){}},
  window:{addEventListener(){},setInterval(){},
    updateHoldingCalculations(){calls.push('holding');},
    runDynamicSimulation(){calls.push('forecast');},
    runKidsSimulation(){calls.push('kids');},
    r25Render(){calls.push('main');},
    r34Render(){calls.push('family');}},
  Intl,Date,console,Number,String,Error,Array,Math,
  fetch:async()=>({ok:true,json:async()=>payload}),
  setTimeout(){},setInterval(){}
};
vm.runInNewContext(reader,context,{filename:'js/r49-live-quote.js'});
async function run(){
 payload={schema:1,code:'00406A',price:9.12,
   tradeDate:today,tradeTime:'10:33:59',exchangeAt:new Date().toISOString()};
 await context.window.R49Quote.refresh();
 assert.equal(context.currentPrice,9.12);
 assert.match(getNode('latest_price').textContent,/9\.12/);
 assert.ok(calls.includes('holding')&&calls.includes('kids')&&calls.includes('family'));
 assert.equal(context.window.R49Quote.isCurrent(),true);
 payload={...payload,price:10000,tradeDate:'2001-01-01',
   exchangeAt:'2001-01-01T10:30:00+08:00'};
 await context.window.R49Quote.refresh();
 assert.equal(context.window.R49Quote.isCurrent(),false);
 assert.equal(context.currentPrice,9.03);
 assert.match(getNode('price_label').textContent,/最近收盤價/);
 console.log('R49 PASS: TWSE price, linked valuations, timestamp validation, stale fallback and PWA integration.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
