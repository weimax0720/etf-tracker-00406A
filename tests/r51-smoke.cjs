/* R51 regression: news tab, third-party safe links, headline freshness, privacy, PWA. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html'),reader=read('js/r51-news.js'),sw=read('sw.js');
const workflow=read('.github/workflows/update-news.yml');
assert.match(html,/id="tab-news"/);
assert.match(html,/id="btn-news"/);
assert.match(html,/id="r51_list"/);
assert.match(html,/id="r51_category"/);
assert.match(html,/id="r51_search"/);
assert.match(html,/id="r51_twse_dividends"/);
assert.match(html,/src="\.\/js\/r51-news\.js"/);
assert.match(html,/\['news','消息面'\]/);
assert.equal((html.match(/id="btn-[^"]+" class="tab-btn/g)||[]).length,20);
assert.equal((html.match(/id="tab-(?:overview|transactions|ledger|family|cashflow|performance|efficiency|kids|charts|dividends|news|assets|topup|report|annual|retirement|records|reminders|security|safety)"/g)||[]).length,20);
assert.match(sw,/00406A-r51-shell-v1/);
assert.match(sw,/js\/r51-news\.js/);
assert.match(sw,/newsUrl\(\)/);
assert.match(workflow,/scripts\/update_news\.py/);
assert.doesNotMatch(reader,/localStorage|sessionStorage|indexedDB|eval\(/);
new vm.Script(reader,{filename:'js/r51-news.js'});
new vm.Script(sw,{filename:'sw.js'});
const sandbox={window:{addEventListener(){},setInterval(){}},
  document:{getElementById(){return null;},hidden:false},URL,Date,Intl,console,
  fetch:()=>Promise.reject(new Error('no network in tests'))};
vm.runInNewContext(reader,sandbox,{filename:'js/r51-news.js'});
const normalize=sandbox.window.R51News.normalize;
assert.equal(typeof normalize,'function');
function item(title,url,category,date=new Date().toISOString(),source='測試媒體'){
  return {title,url,category,publishedAt:date,source};
}
const fresh=new Date().toISOString();
const old='2020-01-01T12:00:00+08:00';
const feed={schema:1,code:'00406A',checkedAt:fresh,articles:[
  item('00406A 正式配息公布','https://news.google.com/rss/articles/test1','dividend'),
  item('00406A－正式配息公布','https://news.google.com/rss/articles/test2','dividend'),
  item('<img src=x onerror=alert(1)> 00406A 來源標題','https://news.google.com/rss/articles/test3','etf'),
  item('00406A 不安全連結','javascript:alert(1)','etf'),
  item('00406A 過期文章','https://news.google.com/rss/articles/test4','etf',old),
  item('00406A 其他類別','https://news.google.com/rss/articles/test5','unknown')
]};
const rows=normalize(feed);
assert.equal(rows.length,2,'accept only recent unique https items with valid category');
assert.ok(rows.every(x=>x.url.startsWith('https:')));
assert.ok(rows.some(x=>x.title.includes('<img')),'untrusted title must remain literal text, never injected as markup');
assert.throws(()=>normalize({...feed,code:'wrong'}));
assert.throws(()=>normalize({...feed,articles:null}));
assert.doesNotMatch(reader,/\.innerHTML\s*=|insertAdjacentHTML/,'untrusted titles must use DOM textContent');
const actual=read('data/news.json');
const data=JSON.parse(actual);
assert.equal(data.code,'00406A');
assert.ok(Array.isArray(data.articles));
assert.ok(data.articles.every(x=>typeof x.source==='string'&&/^https:\/\//.test(x.url)));
console.log('R51 PASS: 20th news tab, mobile category, safe headline-only RSS display, date/URL guards, PWA, privacy.');
