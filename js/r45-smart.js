/* R45 智慧首頁：規則式摘要、公開資料可信度、異常提醒。
   不使用外部 AI、不讀取或傳送個人交易到 GitHub，不自動更改帳務。 */
(function () {
  'use strict';
  const PREFIX = 'r45_';
  let publicFeed = null, feedError = false, pending = false;
  const $ = id => document.getElementById(PREFIX + id);
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(new Date(s + 'T00:00:00').valueOf());
  const number = x => Number.isFinite(Number(x)) ? Number(x) : null;
  const fmt = n => Number(n).toLocaleString('zh-TW', {maximumFractionDigits: 0});
  function dayDiff(a, b) {
    if (!validDate(a) || !validDate(b)) return null;
    const parse = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.round((parse(a) - parse(b)) / 86400000);
  }
  function dateLabel(s) { return validDate(s) ? s.slice(5).replace('-', '/') : '待確認'; }
  function validPrices(prices, today) {
    const map = new Map();
    for (const p of (Array.isArray(prices) ? prices : [])) {
      if (!p || !validDate(p.date) || p.date > today) continue;
      const close = number(p.close), vol = number(p.Trading_Volume ?? p.volume);
      if (close === null || close <= 0 || vol === null || vol < 0) continue;
      map.set(p.date, {...p, close, Trading_Volume: vol});
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  function evaluate(input) {
    const today = input.today;
    const feed = input.feed && input.feed.schema === 1 && input.feed.code === '00406A' ? input.feed : null;
    const historical = validPrices(input.prices, today);
    const officialPrices = validPrices(feed?.prices, today);
    const prices = historical.length ? historical : officialPrices;
    const last = prices.at(-1) || null, officialLast = officialPrices.at(-1) || null;
    const age = last ? dayDiff(today, last.date) : null;
    const feedAge = feed?.checkedAt && Number.isFinite(Date.parse(feed.checkedAt))
      ? (Date.now() - Date.parse(feed.checkedAt)) / 3600000 : null;
    const marketOld = age === null || age > 7;
    const feedOld = feedAge === null || feedAge > 48 || feedAge < -1;
    const hasPublicPrice = officialLast && last && officialLast.date === last.date;
    const sameDayMismatch = !!hasPublicPrice &&
      Math.abs(officialLast.close - last.close) / officialLast.close > 0.005;
    const attention = [];
    const lines = [];
    let priceStatus = '未取得', dividendStatus = '待核對', feedStatus = '未連線';
    let state = '待核對';

    if (!last) {
      lines.push('市場行情尚未取得。請檢查 GitHub 自動更新狀態。');
      attention.push('沒有有效的收盤行情，估值與量能分析暫不宜視為最新。');
    } else if (marketOld) {
      lines.push('最近可用收盤價為 ' + last.date + ' 的 ' + last.close.toFixed(2) + ' 元，已超過 7 天。');
      priceStatus = '資料過期';
      attention.push('行情日期已過期，請先確認證交所資料是否成功更新。');
    } else {
      lines.push('最近交易日 ' + dateLabel(last.date) + ' 收盤 ' + last.close.toFixed(2) +
        ' 元，並非盤中即時成交價。');
      priceStatus = hasPublicPrice ? '公開來源' : '來源待核對';
    }
    if (sameDayMismatch) {
      attention.push('同日收盤價與公開快照有差異，請檢查資料來源後再使用估值。');
      priceStatus = '來源不一致';
    }

    const next = input.announcement && validDate(input.announcement.exDate) &&
      input.announcement.exDate >= today ? input.announcement : null;
    if (!next) {
      lines.push('下次除息尚未確認，不沿用上一期的配息日期或金額。');
    } else {
      const amount = number(next.amount);
      const validAmount = amount !== null && amount > 0;
      const stage = next.stage === 'confirmed' ? '正式' :
        next.stage === 'estimated' ? '已公告預估' :
        validAmount ? '金額待核對' : '金額未公告';
      dividendStatus = stage;
      lines.push(dateLabel(next.exDate) + ' 預定除息；' +
        (validAmount ? '每股 ' + amount.toFixed(3) + ' 元（' + stage + '）' : '金額待公告') +
        '。公告／預估都不代表已實際入帳。');
      const exDays = dayDiff(next.exDate, today);
      if (exDays !== null && exDays <= 7 && next.stage !== 'confirmed') {
        attention.push('距預定除息日 ' + exDays + ' 天，目前配息仍非正式確認金額。');
      }
    }

    const main = input.main;
    if (main?.valid) {
      if (main.shares > 0) {
        const marketClose = last?.close ?? null;
        const avg = main.basis / main.shares;
        const breakeven = avg * (1 + Math.max(0, main.fee || 0) / 100);
        if (marketClose !== null && !marketOld && breakeven > 0) {
          const gap = marketClose - breakeven;
          lines.push('主帳戶 ' + fmt(main.shares) + ' 股；收盤價較參考損益平衡價' +
            (gap >= 0 ? '高 ' : '低 ') + Math.abs(gap).toFixed(2) +
            ' 元／股（依目前成本及費率估算）。');
        } else {
          lines.push('主帳戶 ' + fmt(main.shares) + ' 股；行情未確認前暫不比較損益平衡價。');
        }
      } else {
        lines.push('主帳戶目前沒有有效持股；可從快速記帳開始。');
      }
    } else {
      lines.push('主帳戶帳務尚未核對，暫停持股及損益試算，避免顯示錯誤數字。');
      if (main?.invalid) attention.push('交易資料需核對；請到「資料安全」查看帳務完整性。');
    }

    if (officialPrices.length >= 20 && !marketOld) {
      const sample = officialPrices.slice(-20);
      const m20 = sample.reduce((sum, p) => sum + p.Trading_Volume, 0) / 20;
      const m5 = sample.slice(-5).reduce((sum, p) => sum + p.Trading_Volume, 0) / 5;
      if (m20 > 0 && m5 / m20 < 0.55) {
        attention.push('近期 5 日平均量低於 20 日均量的 55%，請查看流動性雷達。');
      }
    }

    if (!feed) {
      attention.push(input.feedError ?
        'GitHub 公開資料暫時讀取失敗；已保留先前資料。' :
        '尚未取得 GitHub 自動更新資料，不能確認公開數據是否為最新。');
    } else {
      feedStatus = feedOld ? '更新逾時' : (feed.errors?.length ? '部分異常' : '已更新');
      if (feedOld) attention.push('GitHub 公開資料超過 48 小時未成功更新；請檢查 Actions。');
      else if (Array.isArray(feed.errors) && feed.errors.length)
        attention.push('部分公開資料來源更新失敗，請檢查 GitHub Actions 紀錄。');
    }
    const highest = attention.length > 0;
    state = highest ? '需留意' : (marketOld || feedOld || !next ? '資料待核對' : '已核對近期資料');
    const checkedLabel = feed?.checkedAt ?
      String(feed.checkedAt).replace('T', ' ').slice(0, 16) : '尚無成功排程紀錄';
    return {
      state, lines: lines.slice(0, 3), attention: attention.slice(0, 3),
      priceStatus, dividendStatus, feedStatus,
      checkedLabel, latestDate: last?.date || null,
      sourceInfo: feed?.sources?.prices || '原有行情／待查來源',
    };
  }

  function inputFromPage() {
    let today = '';
    try { today = r42LocalToday(); } catch (_) {
      const d = new Date();today = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
    }
    let main = {valid:false, invalid:false};
    try {
      const book = r34Build();
      const owner = book?.owners?.main;
      if (book?.allValid && owner && !owner.invalid &&
          Number.isSafeInteger(owner.shares) && owner.shares >= 0 &&
          Number.isFinite(owner.basis) && owner.basis >= 0) {
        const fee = number(document.getElementById('sell_tax_fee_pct')?.value);
        main = {valid:true, shares:owner.shares, basis:owner.basis, fee:fee === null ? 0 : fee};
      } else main.invalid = !!book?.errors?.length;
    } catch (e) { console.warn('R45 無法讀取主帳戶帳務', e); main.invalid=true; }
    let announcement = null;
    try {announcement = r42NextAnnouncement(today);}catch (e) {console.warn('R45 除息資料未就緒',e);}
    let prices=[];
    try {prices=Array.isArray(rawPriceData)?rawPriceData:[];}catch (_) {}
    return {today,feed:publicFeed,feedError,prices,main,announcement};
  }
  function render() {
    if (!$('brief')) return null;
    const result = evaluate(inputFromPage());
    const labels = [
      ['market', result.priceStatus], ['dividend', result.dividendStatus],
      ['feed', result.feedStatus]
    ];
    for (const [id, value] of labels) if ($(id)) $(id).textContent = value;
    if ($('state')) $('state').textContent = result.state;
    if ($('asof')) $('asof').textContent = '公開資料核對：' + result.checkedLabel +
      '｜最近行情：' + (result.latestDate || '尚未取得');
    result.lines.forEach((message, i) => {if ($('line' + (i + 1))) $('line' + (i + 1)).textContent = message;});
    const host=$('attention');
    if (host) {
      host.hidden = result.attention.length === 0;
      if ($('attention_title')) $('attention_title').textContent =
        result.attention.length ? '需要留意（' + result.attention.length + '）' : '';
      for (let i=1; i<=3; i++) {
        const row=$('warn' + i);
        if (row) {row.hidden = i > result.attention.length;row.textContent=result.attention[i-1]||'';}
      }
    }
    return result;
  }
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(() => {pending=false;render();}, 0);
  }
  async function refresh() {
    render();
    if (typeof window.r44Refresh === 'function') {
      try {await window.r44Refresh(true);} catch (e) {console.warn('R45 無法刷新公開資料', e);}
    }
    return render();
  }
  window.R45Smart = {evaluate,render};
  window.r45Refresh = refresh;
  window.addEventListener('r44:feed', evt => {publicFeed=evt.detail?.feed||null;feedError=false;schedule();});
  window.addEventListener('r44:error', () => {feedError=true;schedule();});
  window.addEventListener('load', () => {schedule();setTimeout(schedule,3000);});
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', () => {if(!document.hidden)schedule();});
  // 原有投資頁及配息頁更新後同步摘要，避免數字需再切頁才刷新。
  for(const fnName of ['r23Render','r42Render','updateTransactions']){
    try {
      if(typeof window[fnName]!=='function')continue;
      const prev=window[fnName];
      window[fnName]=function(...args){
        const value=prev.apply(this,args);
        schedule();
        return value;
      };
    }catch(e){console.warn('R45 連動 '+fnName+' 失敗',e);}
  }
})();