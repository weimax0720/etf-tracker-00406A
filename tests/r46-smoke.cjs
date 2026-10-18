#!/usr/bin/env node
/* R46 automated regression checks; pure JS, no secrets or network required. */
'use strict';
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(base,file),'utf8');
const html=read('index.html'), mobile=read('js/r46-mobile.js'), sw=read('sw.js');
const manifest=JSON.parse(read('manifest.webmanifest'));
const icon=read('icons/tracker-icon.svg');
assert.match(html, /Tracker R46｜手機離線・智慧提醒版/);
assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
assert.match(html, /r46_connectivity/);
assert.match(html, /r46_update_banner/);
assert.match(html, /r46_age_now/);
assert.match(html, /r46_age_in_retirement/);
assert.match(html, /r46_notification_status/);
assert.match(html, /r46_notify_button/);
assert.match(html, /src="\.\/js\/r46-mobile\.js"/);
assert.match(html, /R29_STOP='2039-09',R29_RETIRE='2044-09'/);
assert.match(html, /const totalMonths = 217/);
assert.match(html, /if \(i < 156\)/);
assert.match(html, /projectedData\[155\]/);
assert.match(html, /for\(let i = 0; i <= 18; i\+\+\)/);
assert.match(html, /age: 42 \+ \(currentY - startYear\)/);
assert.match(html, /let age = 42 \+ i;/);
assert.doesNotMatch(html, /2038\/09|2043\/09|43歲 ➔ 60歲/);
assert.equal(manifest.display,'standalone');
assert.equal(manifest.start_url,'./index.html');
assert.equal(manifest.scope,'./');
assert.ok(manifest.icons.length>0);
for(const [size,filename] of [[192,'icons/tracker-192.png'],[512,'icons/tracker-512.png']]){
  const raw=fs.readFileSync(path.join(base,filename));
  assert.equal(raw.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(raw.readUInt32BE(16),size);
  assert.equal(raw.readUInt32BE(20),size);
  assert.ok(manifest.icons.some(icon=>icon.src==='./'+filename && icon.sizes===size+'x'+size));
}
assert.match(icon, /<svg /);
assert.match(sw, /networkOrCached\(req,APP_CACHE,true\)/);
assert.match(sw, /networkOrCached\(req,DATA_CACHE\)/);
assert.match(sw, /if\(req.method!=='GET'\)return/);
assert.match(sw, /R46_SKIP_WAITING/);
assert.doesNotMatch(sw, /localStorage|indexedDB|Authorization|api_key/);
assert.doesNotMatch(mobile, /fetch\(/);
const original=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).filter(x=>x.length>10000);
assert.equal(original.length,1);
for(const [name,content] of [['index',original[0]],['r46',mobile],['service worker',sw]]){
  new vm.Script(content,{filename:name});
}
const registered={};
const win={addEventListener:(event,callback)=>{registered[event]=callback;},};
const sandbox={
  window:win,document:{addEventListener:()=>{},getElementById:()=>null},
  navigator:{onLine:true},location:{protocol:'https:',hostname:'localhost'},
  console:{warn:()=>{}},Notification:{permission:'default',requestPermission:async()=> 'default'},
  localStorage:{getItem:()=>null,setItem:()=>{}}
};
win.Notification=sandbox.Notification;
let announcement={exDate:'2026-11-03',payDate:'2026-11-27',amount:0.138,stage:'estimated'};
sandbox.r42NextAnnouncement=()=>announcement;
vm.runInNewContext(mobile,sandbox,{filename:'js/r46-mobile.js'});
const age=win.R46Mobile.ageAtYear;
assert.equal(age(2026),42);
assert.equal(age(2027),43);
assert.equal(age(2039),55);
assert.equal(age(2044),60);
assert.equal(age('bad'),null);
const recent={schema:1,code:'00406A',checkedAt:new Date().toISOString(),prices:[],dividends:[],errors:[]};
const coming=win.R46Mobile.availableAlerts(recent,'2026-11-01');
assert.ok(coming.some(x=>x.id==='ex-2026-11-03'));
assert.ok(!coming.some(x=>x.id.startsWith('confirmed-')));
announcement={...announcement,amount:0.145,stage:'confirmed'};
const confirmed=win.R46Mobile.availableAlerts(recent,'2026-10-29');
assert.ok(confirmed.some(x=>x.id==='confirmed-2026-11-03-0.145'));
announcement=null;
const stale=win.R46Mobile.availableAlerts({...recent,checkedAt:'2020-01-01T00:00:00Z'},'2026-10-18');
assert.ok(stale.some(x=>x.title.includes('逾時')));
const broken=win.R46Mobile.availableAlerts({...recent,errors:['TWSE unavailable']},'2026-10-18');
assert.ok(broken.some(x=>x.title.includes('失敗')));
// Execute the untouched R29 pure finance model to test the corrected 55/60 milestone calendar.
const start=original[0].indexOf("const R29_SETTINGS_KEY=");
const stop=original[0].indexOf("const r29PriorTransactions=");
assert.ok(start>0&&stop>start);
const retirement=original[0].slice(start,stop);
const financeSandbox={document:{getElementById:()=>null},console:{warn:()=>{}},localStorage:{getItem:()=>null},window:{}};
vm.runInNewContext(retirement+
  '\n globalThis.testProjection = (base,ym,config)=>r29Simulate(base,ym,config,4,5,{});'+
  '\n globalThis.testMonths = (a,b)=>r29MonthsUntil(a,b);',financeSandbox);
const result=financeSandbox.testProjection(100000,'2026-10',
  {contribution:'flat',flat:5000,after55:'reinvest'});
assert.equal(result.at55.month,'2039-09');
assert.equal(result.at60.month,'2044-09');
assert.ok(result.contribMonths>100);
assert.ok(result.at60.value>result.at55.value);
assert.equal(financeSandbox.testMonths('2039-09','2026-09'),156);
assert.equal(financeSandbox.testMonths('2044-09','2026-09'),216);
console.log('R46 smoke PASS: PWA shell/privacy, age, 2039/2044 retirement, formal vs estimated reminders, stale data.');
