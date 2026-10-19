#!/usr/bin/env node
/* R48: presentation-only removal of obsolete export/print/manual refresh toolbars.
 * All market updates and user-input calculations are preserved.
 * Run: node tests/r48-smoke.cjs
 */
'use strict';
const fs=require('node:fs'), path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..'),load=p=>fs.readFileSync(path.join(dir,p),'utf8');
const html=load('index.html'),sw=load('sw.js');
assert.match(html,/Tracker R48｜自動閱讀・零匯出按鈕版/);
const scriptAt=html.indexOf('<script>',150000);
assert.ok(scriptAt>150000,'Find original application script');
const ui=html.slice(0,scriptAt), js=html.slice(scriptAt);
const original=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).filter(x=>x.length>100000);
assert.equal(original.length,1);
new vm.Script(original[0],{filename:'index.html'});
assert.ok(/const r31ExportButton=r31Node\('r31_export'\);if\(r31ExportButton\)/.test(js),'Removing CSV button must not break search page');
for(const tag of ['div','section','details','button']) {
  const opens=(ui.match(new RegExp('<'+tag+'(?:\\s|>)','g'))||[]).length;
  const closes=(ui.match(new RegExp('</'+tag+'>','g'))||[]).length;
  assert.equal(opens,closes,'Unbalanced '+tag);
}
const oldControls=new Set([
  'saveAndLoad','r44Refresh','r45Refresh','r23Refresh','r42Refresh',
  'r24DownloadCsv','r26ExportCsv','r27Print','r27ExportCSV','r27ExportHTML',
  'r28Print','r28ExportCSV','r28ExportHTML','r29ExportCSV','r29Print','r29ExportHTML',
  'r31ExportCsv','r32Render','r30Scan','r37Render','r37ExportCsv','r37ExportHTML','r37Print',
  'r38Render','r38Csv','r38Html','r38Print','r35Render','r35ExportCsv','r35ExportHTML','r35Print',
  'r34Render','r34ExportCsv','r34ExportHTML','r34Print',
  'r40Refresh','r40ExportCsv','r40ExportHTML','r40Print'
]);
const buttons=[...ui.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(x=>x[0]);
for(const btn of buttons){
 const f=btn.match(/onclick="([a-zA-Z_][\w]*)\s*\(/)?.[1];
 assert.ok(!oldControls.has(f),'Unwanted button still visible: '+f);
 const label=btn.replace(/<[^>]+>/g,'').trim();
 assert.doesNotMatch(label,/下載(?:.*CSV|.*HTML)?|CSV|匯出|列印|PDF|重新計算|重新彙整|重新分析|重新驗算|重新整理|重新檢查/,'Unwanted toolbar label');
}
for(const id of 'overview transactions ledger family cashflow performance efficiency kids charts dividends assets topup report annual retirement records reminders security safety'.split(' ')) {
 assert.ok(ui.includes('id="tab-'+id+'"'),'Original page missing: '+id);
}
assert.ok(ui.includes('id="api_key"')&&ui.includes('type="hidden" id="api_key"'),'Retain inert key input for existing private local settings');
assert.ok(ui.includes('id="r45_brief"'),'Smart summary preserved');
assert.ok(ui.includes('id="r46_update_banner"'),'App update prompt preserved');
assert.ok(ui.includes('onclick="r46ApplyUpdate()"'),'Explicit consent to app updates preserved');
assert.ok(ui.includes('onclick="r33OpenQuick()"'),'Quick entry preserved');
assert.ok(ui.includes('id="r35_save"')&&ui.includes('id="r25_cash_date"'),'Actual dividend bookkeeping preserved');
assert.ok(ui.includes('id="r31_list"')&&ui.includes('id="r31_prev"'),'Search and pagination preserved');
assert.ok(ui.includes('id="r29_goal55"')&&ui.includes('id="r29_goal60"'),'Retirement goals preserved');
assert.ok(ui.includes('id="r30_issue_list"'),'Read-only data health preserved');
assert.ok(ui.includes('id="r44_sync_status"'),'Market auto-sync status preserved');
assert.ok(!ui.includes('備份')&&!ui.includes('還原'),'No backup/restore features');
assert.ok(sw.includes('r48-shell'),'R48 PWA offline cache version needed for removal');
assert.ok(sw.includes('r47-')&&sw.includes('r48-'),'Old public shell invalidated');
assert.doesNotMatch(sw,/localStorage|indexedDB/);
new vm.Script(sw,{filename:'sw.js'});
console.log('R48 PASS: no redundant export/print/refresh buttons, 19 tabs, main and kids ledgers, automatic refresh, R47 health checks, PWA cache.');
