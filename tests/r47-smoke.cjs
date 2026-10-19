#!/usr/bin/env node
/* R47: verify the backup-free UI and both accounts' read-only health scan.
 * Run: node tests/r47-smoke.cjs
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html'),smart=read('js/r45-smart.js'),sw=read('sw.js');
assert.match(html,/Tracker R4[78]｜/);
const allPages='overview transactions ledger family cashflow performance efficiency kids charts dividends assets topup report annual retirement records reminders security safety'.split(' ');
for(const id of allPages)assert.ok(html.includes('id="tab-'+id+'"'),'missing page '+id);
assert.match(html,/id="r30_issue_list"/);
assert.match(html,/r30Scan\(\)/);
assert.match(html,/帳務健康檢查/);
assert.ok(!html.includes('備份'),'R47 user interface/code must not mention backups');
assert.ok(!smart.includes('backup'),'R45 summary must not create backup reminder');
const removed=/\b(r25Backup|r25Restore|r30Backup|r30StageFile|r30ApplyRestore|r30VerifyCurrent|r30Digest|r30UpdateRestoreButton|r32ConfirmBackup)\b/;
assert.doesNotMatch(html,removed);
for(const id of ['r30_backup_btn','r30_restore_btn','r32_backup_age','r32_backup_note','r25_restore_input','r30_import_status'])
  assert.ok(!html.includes('id="'+id+'"'),'legacy backup UI exists: '+id);
assert.ok(/r4[78]-shell/.test(sw),'PWA must refresh cached HTML on upgrade');
assert.doesNotMatch(sw,/localStorage|indexedDB/);
const tags=['div','section','article','details'];
for(const tag of tags){
  const n=(html.match(new RegExp('<'+tag+'(?:\\s|>)','g'))||[]).length;
  const m=(html.match(new RegExp('</'+tag+'>','g'))||[]).length;
  assert.equal(n,m,'unbalanced '+tag+' tags');
}
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const inline=scripts.filter(x=>x.length>100000);
assert.equal(inline.length,1,'original financial program must stay intact');
new vm.Script(inline[0],{filename:'index.html'});
new vm.Script(smart,{filename:'js/r45-smart.js'});
new vm.Script(sw,{filename:'sw.js'});
assert.match(inline[0],/function r30Analyze\(data\)/);
assert.match(inline[0],/function r30Scan\(\)/);
assert.match(inline[0],/function r35ValidateKidRows\(/);
const aud=inline[0].slice(inline[0].indexOf('function r30Analyze(data){'),
                             inline[0].indexOf('function r30HealthDOM(',inline[0].indexOf('function r30Analyze(data){')));
assert.ok(aud.length>2500);
const fake={
 TX_KEY:'00406A_TRANSACTIONS',R25_CASH_KEY:'00406A_CASH',
 R29_SETTINGS_KEY:'00406A_RETIREMENT',R24_DIV_CACHE_KEY:'00406A_DIV_CACHE',
 R30_CORE_MAPS:new Set(),R30_TYPES:new Set(['buy','buy_regular','buy_extra','dividend','sell','buy_kid_a','div_kid_a','sell_kid_a','buy_kid_b','div_kid_b','sell_kid_b']),
 r25SafeId:()=>false,r25Today:()=> '2026-10-18',
 r24SafeDate:s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?s:'',
 r25ReadCashRows:r=>r,
 R29_DEFAULTS:{},r29Validate:()=>'',console
};
vm.runInNewContext(aud+'\nglobalThis.audit=r30Analyze;',fake);
const tx=[
 {id:1,date:'2026-10-01',type:'buy_regular',shares:90,price:9.3,fee:0},
 {id:2,date:'2026-10-02',type:'buy_kid_a',shares:25,price:9.3,fee:0},
 {id:3,date:'2026-10-02',type:'buy_kid_b',shares:30,price:9.3,fee:0}
];
const sample={[fake.TX_KEY]:JSON.stringify(tx),[fake.R25_CASH_KEY]:'[]'};
const good=fake.audit(sample);
assert.equal(good.txCount,3);
assert.equal(good.positions.main,90);
assert.equal(good.positions.kid_a,25);
assert.equal(good.positions.kid_b,30);
assert.equal(good.errors.length,0);
const oversold=fake.audit({...sample,[fake.TX_KEY]:JSON.stringify([...tx,{id:4,date:'2026-10-03',type:'sell',shares:100,price:9.2,fee:0}])});
assert.ok(oversold.warnings.some(x=>x.includes('賣出股數超過當時庫存')));
const broken=fake.audit({...sample,[fake.TX_KEY]:'{malformed JSON'});
assert.ok(broken.errors.length>0);
const prompt=inline[0].slice(inline[0].indexOf('function r32BuildItems(today){'),
                              inline[0].indexOf('function r32Label(',inline[0].indexOf('function r32BuildItems(today){')));
assert.ok(prompt.length>1000);
const reminders={
 r32Prefs:{days:{main:0,kid_a:0,kid_b:0},home:{}},
 r32Todos:[],r32Done:{},r24Rows:[],
 r32NextMonth:()=> '2026-11',r32TransactionsForMonth:()=>false,
 r32MonthDay:()=>'',r32DayDiff:()=>0,console
};
vm.runInNewContext(prompt+'\nglobalThis.generateReminders=r32BuildItems;',reminders);
assert.equal(reminders.generateReminders('2026-10-18').length,0,'no periodic backup task');
console.log('R47 PASS: zero backup functions/UI/reminders; independent 90/25/30 accounts; oversell/corruption detection; 19 tabs; PWA refresh');
