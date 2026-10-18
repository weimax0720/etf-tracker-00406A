/* R46 手機安裝、離線顯示與「僅開啟網頁時」核對的選用通知。
   無推播伺服器，不會在 APP 關閉時背景發送通知；交易資料留在本機。 */
(function(){
'use strict';
const NOTIFY_KEY='00406A_R46_NOTIFY_OPTIN';
const SEEN_KEY='00406A_R46_PUBLIC_NOTICE_SEEN';
const BASE_YEAR=2026, BASE_AGE=42;
let reg=null,installEvent=null,lastUpdateCheck=0,publicFeed=null,fetchError=false;
const el=id=>document.getElementById(id);
const localDay=()=>{const d=new Date();return [
  d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const dayDiff=(a,b)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(a||'')||!/^\d{4}-\d{2}-\d{2}$/.test(b||''))return null;
  const utc=x=>Date.UTC(+x.slice(0,4),+x.slice(5,7)-1,+x.slice(8,10));
  return Math.round((utc(a)-utc(b))/86400000);
};
function ageAtYear(year){
  const y=Number(year);return Number.isSafeInteger(y)&&y>=BASE_YEAR?BASE_AGE+y-BASE_YEAR:null;
}
function formatDate(x){return typeof x==='string'?x.slice(5).replace('-','/'):'—';}
function setText(id,t){const e=el(id);if(e)e.textContent=t;}
function setHidden(id,hidden){const e=el(id);if(e)e.hidden=hidden;}
function syncAge(){
  const year=new Date().getFullYear(),age=ageAtYear(year);
  setText('r46_age_now',age===null?'42':String(age));
  setText('r46_age_in_retirement',year+' 年度年齡 '+(age===null?'—':age)+' 歲；2026 年以 42 歲為基準。55 歲目標：2039/09；60 歲目標：2044/09。月份沿用原計畫九月，非實際生日。');
}
function connection(){
  const online=navigator.onLine!==false;
  setText('r46_connectivity',online?'已連線｜行情依公開資料更新':'離線中｜只能查看已快取資料');
  const node=el('r46_connectivity');
  if(node){node.classList.toggle('text-amber-300',!online);node.classList.toggle('text-cyan-200',online);}
}
function availableAlerts(feed,today){
  const result=[],date=/^\d{4}-\d{2}-\d{2}$/;
  if(feed&&feed.schema===1&&feed.code==='00406A'){
    const checked=new Date(feed.checkedAt||'').valueOf();
    if(!Number.isFinite(checked)||Date.now()-checked>48*3600000){
      result.push({id:'stale-'+today,title:'公開資料更新逾時',body:'GitHub 公開市場資料已超過 48 小時未更新；請檢查 Actions 或網路。'});
    }
    if(Array.isArray(feed.errors)&&feed.errors.length)
      result.push({id:'error-'+today,title:'部分來源更新失敗',body:'市場資料來源有錯誤，請查看資料日期及 GitHub Actions。'});
  }else if(fetchError){
    result.push({id:'offline-'+today,title:'資料暫不可用',body:'公開行情無法讀取，已保留最後可用資料；請確認連線。'});
  }
  let dividend=null;
  try {if(typeof r42NextAnnouncement==='function')dividend=r42NextAnnouncement(today);}
  catch(e){console.warn('R46 除息公告查詢失敗',e);}
  if(dividend&&date.test(dividend.exDate)){
    const diff=dayDiff(dividend.exDate,today);
    if(diff!==null&&diff>=0&&diff<=3){
      result.push({id:'ex-'+dividend.exDate,title:'00406A 即將除息',
        body:formatDate(dividend.exDate)+' 預定除息；配息金額以正式公告為準。'});
    }
    if(dividend.stage==='confirmed'&&Number.isFinite(Number(dividend.amount))&&Number(dividend.amount)>0&&diff!==null&&diff>=0&&diff<=14){
      result.push({id:'confirmed-'+dividend.exDate+'-'+dividend.amount,title:'00406A 正式配息公告',
        body:formatDate(dividend.exDate)+' 除息，每股 '+Number(dividend.amount).toFixed(3)+' 元；尚未代表已實收。'});
    }
  }
  return result.slice(0,3);
}
function seen(){
  try{
    const values=JSON.parse(localStorage.getItem(SEEN_KEY)||'[]');
    return Array.isArray(values)?values.filter(x=>typeof x==='string').slice(-50):[];
  }catch(_){return [];}
}
function opted(){try{return localStorage.getItem(NOTIFY_KEY)==='yes';}catch(_){return false;}}
async function send(title,body,tag){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  const options={body,tag,icon:'./icons/tracker-icon.svg',silent:false};
  try {
    const worker=reg||(('serviceWorker' in navigator)?await navigator.serviceWorker.ready:null);
    if(worker&&worker.showNotification){await worker.showNotification(title,options);return true;}
    new Notification(title,options);
    return true;
  }catch(e){console.warn('R46 通知被瀏覽器阻擋',e);return false;}
}
async function notifyIfNeeded(items){
  if(!opted()||!('Notification' in window)||Notification.permission!=='granted')return;
  const old=seen(),keys=new Set(old);
  let changed=false;
  for(const item of items){
    if(keys.has(item.id))continue;
    const ok=await send(item.title,item.body,'00406A-'+item.id);
    if(ok){keys.add(item.id);changed=true;}
  }
  if(changed)try{localStorage.setItem(SEEN_KEY,JSON.stringify([...keys].slice(-50)));}catch(_){}
}
function renderAlerts(){
  const notices=availableAlerts(publicFeed,localDay());
  setText('r46_alert_brief',notices.length?notices[0].body:
    publicFeed?'沒有符合此版通知門檻的公開市場異常；仍可到提醒中心核對個人待辦。':
    '公開資料讀取中／尚未成功更新，請看上方同步狀態。');
  setText('r46_notification_status',!('Notification' in window)?
    '此瀏覽器不支援網頁系統通知；APP 內提醒仍可使用。':
    Notification.permission==='denied'?'系統通知已被封鎖，請到瀏覽器網站設定解除。':
    opted()&&Notification.permission==='granted'?'系統通知已啟用：僅在 APP 開啟或重新載入時檢查。':
    '系統通知未啟用；APP 內提醒已運作。');
  setText('r46_notify_button',opted()?'關閉系統通知':'啟用系統通知');
  if(notices.length)void notifyIfNeeded(notices);
  return notices;
}
async function toggleNotify(){
  if(opted()){
    try{localStorage.setItem(NOTIFY_KEY,'no');}catch(_){}
    return renderAlerts();
  }
  if(!('Notification' in window)){
    renderAlerts();return;
  }
  let permission=Notification.permission;
  if(permission!=='granted'){
    try{permission=await Notification.requestPermission();}
    catch(e){console.warn('R46 瀏覽器無法開啟通知權限',e);}
  }
  if(permission==='granted'){
    try{localStorage.setItem(NOTIFY_KEY,'yes');}catch(_){}
  }
  renderAlerts();
}
function updateAvailable(){
  if(!el('r46_update_banner'))return;
  const waiting=!!(reg&&reg.waiting&&navigator.serviceWorker.controller);
  setHidden('r46_update_banner',!waiting);
}
async function applyUpdate(){
  if(!reg||!reg.waiting)return;
  reg.waiting.postMessage({type:'R46_SKIP_WAITING'});
}
function bindReg(found){
  reg=found;
  updateAvailable();
  reg.addEventListener('updatefound',()=>{
    const installing=reg.installing;
    if(!installing)return;
    installing.addEventListener('statechange',()=>{if(installing.state==='installed')updateAvailable();});
  });
}
async function checkUpdate(){
  if(!reg)return;
  if(Date.now()-lastUpdateCheck<60*60000)return;
  lastUpdateCheck=Date.now();
  try {await reg.update();}catch(e){console.warn('R46 更新檢查無法完成',e);}
}
async function initSW(){
  if(!('serviceWorker' in navigator)||!(location.protocol==='https:'||location.hostname==='localhost')){
    setText('r46_offline_help','此瀏覽器／網址不支援離線安裝，線上記帳仍可使用。');
    return;
  }
  try {
    const found=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    bindReg(found);
    setText('r46_offline_help','離線模式已啟用：可開啟曾快取的頁面與公開資料；無網路時不會取得最新行情。');
    await checkUpdate();
  }catch(e){
    setText('r46_offline_help','離線安裝未成功，請保持網路連線使用。');
    console.warn('R46 Service Worker 註冊失敗',e);
  }
}
window.r46EnableNotifications=toggleNotify;
window.r46ApplyUpdate=applyUpdate;
window.r46Install=async ()=>{
  if(!installEvent)return;
  installEvent.prompt();
  try {await installEvent.userChoice;}catch(_){}
  installEvent=null;setHidden('r46_install_btn',true);
};
window.R46Mobile={ageAtYear,availableAlerts,renderAlerts};
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();installEvent=event;setHidden('r46_install_btn',false);
});
window.addEventListener('appinstalled',()=>{setHidden('r46_install_btn',true);installEvent=null;});
window.addEventListener('online',connection);
window.addEventListener('offline',connection);
window.addEventListener('r44:feed',event=>{
  publicFeed=event.detail&&event.detail.feed||null;fetchError=false;renderAlerts();
});
window.addEventListener('r44:error',()=>{
  fetchError=true;renderAlerts();
});
window.addEventListener('focus',()=>{connection();syncAge();renderAlerts();void checkUpdate();});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){connection();syncAge();renderAlerts();void checkUpdate();}
});
if('serviceWorker' in navigator){
  let reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(!reloaded){reloaded=true;location.reload();}
  });
}
window.addEventListener('load',()=>{
  connection();syncAge();renderAlerts();
  void initSW();
});
})();