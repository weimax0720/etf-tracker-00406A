#!/usr/bin/env node
/* R45 regression tests: no network, no personal user data, no external dependencies. */
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'index.html'),'utf8');
const r44=fs.readFileSync(path.join(root,'js/auto-market.js'),'utf8');
const r45=fs.readFileSync(path.join(root,'js/r45-smart.js'),'utf8');
assert.match(app, /00406A Tracker R4[567]/);
assert.match(app, /id="r45_brief"/);
assert.match(app, /id="r45_legacy_details"/);
assert.match(app, /src="\.\/js\/r45-smart\.js"/);
assert.equal((app.match(/data-r32-home="assistant"/g)||[]).length,1,
  'R45 must not duplicate the existing assistant preference');
for (const id of 'overview transactions ledger family cashflow performance efficiency kids charts dividends assets topup report annual retirement records reminders security safety'.split(' ')) {
  assert.ok(app.includes('id="tab-'+id+'"'),'missing original page '+id);
}
const inline=[...app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).filter(x=>x.length>10000);
assert.equal(inline.length,1,'existing inline app must remain intact');
new vm.Script(inline[0],{filename:'index.html'});
new vm.Script(r44,{filename:'js/auto-market.js'});
new vm.Script(r45,{filename:'js/r45-smart.js'});
assert.match(r44,/r44:feed/);
assert.match(r44,/r44:error/);
const ctx={console:{warn:()=>{}},document:{addEventListener:()=>{},getElementById:()=>null},
  window:{addEventListener:()=>{}},setTimeout:()=>{}};
vm.runInNewContext(r45,ctx,{filename:'js/r45-smart.js'});
const calc=ctx.window.R45Smart.evaluate;
assert.equal(typeof calc,'function');
const today='2026-10-18';
const quote=(date,close=9.32,vol=100000000)=>({date,close,Trading_Volume:vol,Trading_money:900000000});
const prices=[quote('2026-09-29'),quote('2026-10-01'),quote('2026-10-05'),quote('2026-10-06'),
  quote('2026-10-07'),quote('2026-10-08'),quote('2026-10-09'),quote('2026-10-12'),
  quote('2026-10-13'),quote('2026-10-14'),quote('2026-10-15'),quote('2026-10-16')];
const feed={schema:1,code:'00406A',checkedAt:new Date().toISOString(),prices,dividends:[],errors:[],
 sources:{prices:'臺灣證券交易所'}};
const announcement={exDate:'2026-11-03',payDate:'2026-11-27',stage:'estimated',amount:0.138};
const base={today,feed,prices,announcement,
  main:{valid:true,shares:90,basis:900,fee:0.2}};
const normal=calc(base);
assert.equal(normal.lines.length,3);
assert.match(normal.lines[0],/10\/16/);
assert.match(normal.lines[1],/0\.138/);
assert.match(normal.lines[1],/已公告預估/);
assert.match(normal.lines[2],/90 股/);
assert.equal(normal.priceStatus,'公開來源');
assert.equal(normal.dividendStatus,'已公告預估');
const formal=calc({...base,announcement:{...announcement,amount:0.145,stage:'confirmed'}});
assert.match(formal.lines[1],/0\.145/);
assert.match(formal.lines[1],/正式/);
assert.match(formal.lines[1],/不代表已實際入帳/);
const stale=calc({...base,prices:[quote('2026-09-30')],
 feed:{...feed,prices:[quote('2026-09-30')]}});
assert.equal(stale.priceStatus,'資料過期');
assert.ok(stale.attention.some(x=>x.includes('過期')));
const failed=calc({...base,feed:null,prices:[],feedError:true,main:{valid:false,invalid:true},announcement:null});
assert.match(failed.lines[0],/尚未取得/);
assert.match(failed.lines[2],/暫停/);
assert.ok(failed.attention.some(x=>x.includes('讀取失敗')));
const mainOnly=calc({...base,kids:{kid_a:{shares:100000},kid_b:{shares:100000}}});
assert.match(mainOnly.lines[2],/90 股/);
assert.doesNotMatch(mainOnly.lines[2],/100,000/);
const mismatch=calc({...base,prices:prices.map((p,i)=>i===prices.length-1?quote('2026-10-16',9.8):p)});
assert.equal(mismatch.priceStatus,'來源不一致');
console.log('R45 smoke checks PASS: HTML, 19 tabs, JS syntax, estimates/formal, stale, account isolation, mismatch');
