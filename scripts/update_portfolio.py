#!/usr/bin/env python3
"""R52: read-only, public CTBC 00406A portfolio snapshots and conservative risk metrics.

Only official disclosed stock/derivative rows are used. Never invent net futures
exposure, industry exposure, option delta or manager executions from share changes.
"""
import datetime as dt
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "portfolio.json"
MARKET = ROOT / "data" / "market.json"
TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(TZ)
TODAY = NOW.date()
CODE = "00406A"
ROOT_API = "https://www.ctbcinvestments.com.tw"
OFFICIAL_PAGE = "https://www.ctbcinvestments.com/Etf/00682450/Info"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; 00406A-Tracker/1.0; public-portfolio-index)",
           "Content-Type": "application/json", "Accept": "application/json"}

def num(value):
    try:
        if value in (None, "", "-", "—"):
            return None
        result = float(str(value).replace(",", "").replace("%", "").strip())
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None

def as_day(value):
    s = str(value or "").strip().replace("/", "-")
    try:
        return dt.date.fromisoformat(s).isoformat()
    except ValueError:
        return None

def decode(value):
    # CTBC sometimes wraps JSON in a JSON string.
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("非 JSON 物件")
    return value

def post(path, query, body, timeout=18):
    url = ROOT_API + path + "?" + urllib.parse.urlencode(query)
    request = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers=HEADERS, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        payload = resp.read(3_500_000).decode("utf-8-sig")
    return decode(json.loads(payload))

def string(v, limit=100):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:limit]

def asset_type(group):
    text = (string(group.get("Code")) + " " + string(group.get("Name")) +
            " " + string(group.get("Title")) + " " + string(group.get("name"))).upper()
    code = string(group.get("Code")).upper()
    if code in ("STOCK", "STOCKS", "EQUITY") or "股票" in text or "STOCK" in text:
        return "stock"
    if ("FUTURE" in text or "期貨" in text or code in ("FUT", "TX")):
        return "futures"
    if ("OPTION" in text or "選擇權" in text or "買權" in text or "賣權" in text):
        return "options"
    return "unknown"

def parse_portfolio(payload):
    if payload.get("ResultCode") != 0:
        raise ValueError("官方投資組合尚未公布或回傳失敗")
    data = payload.get("Data") or {}
    assets = data.get("FundAssets") or []
    groups = data.get("FundAssetsDetail") or []
    if not assets or not isinstance(groups, list):
        raise ValueError("無完整投資組合")
    a = assets[0]
    date = as_day(a.get("資料日期"))
    if not date or date > TODAY.isoformat() or date < (TODAY - dt.timedelta(days=18)).isoformat():
        raise ValueError("投資組合資料日期無效或過舊")
    stocks, futures, options, unknown_groups = [], [], [], []
    for g in groups:
        if not isinstance(g, dict):
            continue
        cat = asset_type(g)
        rows = g.get("Data") or []
        if not isinstance(rows, list):
            continue
        if cat == "unknown":
            if rows:
                unknown_groups.append(string(g.get("Code") or g.get("Name") or "?"))
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            code = string(row.get("code_") or row.get("code") or row.get("Code"), 45)
            name = string(row.get("name_") or row.get("name") or row.get("Name"), 105)
            qty = num(row.get("qty_", row.get("qty")))
            weight = num(row.get("weights_", row.get("weight")))
            if not (code or name) or qty is None or abs(qty)>1e13:
                continue
            if weight is not None and abs(weight)>1000:
                weight = None
            base = {"code": code, "name": name, "quantity": round(qty, 4),
                    "reportedWeight": weight}
            if cat == "stock":
                if not re.fullmatch(r"[0-9A-Z]{3,8}", code) or qty < 0 or weight is None or not 0 <= weight <= 100:
                    continue
                stocks.append({"code": code, "name": name,
                               "shares": int(qty), "weight": weight})
            elif cat == "futures":
                futures.append(base)
            else:
                options.append(base)
    if len(stocks) < 10 or len(stocks)>350 or len({x["code"] for x in stocks})!=len(stocks):
        raise ValueError("股票資料筆數或代碼不合理（防止以空白/錯檔覆蓋）")
    gross = sum(x["weight"] for x in stocks)
    if not 15 <= gross <= 125:
        raise ValueError("股票權重總和不合理")
    stocks.sort(key=lambda x:(-x["weight"], x["code"]))
    nav = num(a.get("基金每單位淨值"))
    assets_total = num(a.get("基金淨資產"))
    units = num(a.get("基金在外流通單位數"))
    return {"date": date, "stocks": stocks, "futures": futures, "options": options,
            "nav": nav if nav and nav > 0 else None,
            "fundAssets": assets_total if assets_total and assets_total > 0 else None,
            "units": units if units and units > 0 else None,
            "source": "中國信託投信 ETF 投資組合 API",
            "sourceUrl": OFFICIAL_PAGE, "unknownGroups": unknown_groups}

def valid_old_snapshot(s):
    if not isinstance(s, dict) or not as_day(s.get("date")) or not isinstance(s.get("stocks"), list):
        return False
    return len(s["stocks"]) >= 10 and all(isinstance(row, dict) and num(row.get("weight")) is not None for row in s["stocks"])

def changes(previous, current):
    if not valid_old_snapshot(previous) or not valid_old_snapshot(current):
        return []
    a, b = {r["code"]:r for r in previous["stocks"]}, {r["code"]:r for r in current["stocks"]}
    result = []
    for code in sorted(a.keys() | b.keys()):
        p, n = a.get(code), b.get(code)
        old_shares = p.get("shares",0) if p else 0
        shares = n.get("shares",0) if n else 0
        old_weight = num(p.get("weight")) if p else 0
        weight = num(n.get("weight")) if n else 0
        if old_weight is None or weight is None:
            continue
        diff = shares - old_shares
        delta = round(weight-old_weight,4)
        if not diff and abs(delta)<0.005:
            continue
        kind = "new" if not p else "removed" if not n else "increase" if diff>0 else "decrease" if diff<0 else "weight_only"
        result.append({"code":code,"name":(n or p)["name"],"type":kind,
                       "previousShares":old_shares,"shares":shares,"sharesDelta":diff,
                       "previousWeight":old_weight,"weight":weight,"weightDeltaPp":delta})
    result.sort(key=lambda x:(-abs(x["weightDeltaPp"]),-abs(x["sharesDelta"]),x["code"]))
    return result[:180]

def derivative_changes(previous, current, key):
    """Compare disclosed contract quantities and reported weights, not inferred exposures."""
    if not previous or not current or key not in ("futures","options"):
        return []
    prior = {(r.get("code"),r.get("name")):r for r in previous.get(key,[]) if isinstance(r,dict)}
    after = {(r.get("code"),r.get("name")):r for r in current.get(key,[]) if isinstance(r,dict)}
    out = []
    for ident in sorted(prior.keys() | after.keys()):
        old,now=prior.get(ident,{}),after.get(ident,{})
        old_qty,qty=num(old.get("quantity")) or 0,num(now.get("quantity")) or 0
        old_pct,pct=num(old.get("reportedWeight")),num(now.get("reportedWeight"))
        diff=qty-old_qty
        delta_pct=round(pct-old_pct,4) if pct is not None and old_pct is not None else None
        if not diff and (delta_pct is None or abs(delta_pct)<0.005):
            continue
        out.append({"code":ident[0],"name":ident[1],
                    "previousQuantity":old_qty,"quantity":qty,"quantityDelta":diff,
                    "previousReportedWeight":old_pct,"reportedWeight":pct,
                    "weightDeltaPp":delta_pct})
    return out[:50]

def market_metrics(portfolio):
    """Close-only data adjusted for confirmed distributions: market total-return proxy, NOT fund NAV drawdown."""
    out={"premiumPct":None,"adjustedPriceDrawdownPct":None,
         "priceDate":None,"dividendLatest":None,"dividendPrevious":None,
         "stockWeightPct":None,"maxSingleStockPct":None,"top10WeightPct":None,
         "grossExposurePct":None,"optionNotionalPct":None,"sectorConcentrationPct":None}
    stocks=portfolio.get("stocks") or []
    if stocks:
        out["stockWeightPct"]=round(sum(x["weight"] for x in stocks),3)
        out["maxSingleStockPct"]=round(max(x["weight"] for x in stocks),3)
        out["top10WeightPct"]=round(sum(x["weight"] for x in stocks[:10]),3)
    try:
        feed=json.loads(MARKET.read_text(encoding="utf-8"))
        if feed.get("code")!=CODE or feed.get("schema")!=1: return out
        divs=[d for d in feed.get("dividends",[]) if d.get("stage")=="confirmed"
              and as_day(d.get("exDate")) and num(d.get("amount")) is not None and num(d["amount"])>0]
        divs.sort(key=lambda x:x["exDate"])
        if divs:
            out["dividendLatest"]=float(divs[-1]["amount"])
            if len(divs)>1:out["dividendPrevious"]=float(divs[-2]["amount"])
        div_map={r["exDate"]:float(r["amount"]) for r in divs}
        prices=sorted({r["date"]:float(r["close"]) for r in feed.get("prices",[])
                       if as_day(r.get("date")) and num(r.get("close")) is not None and
                       0<float(r["close"])<100000}.items())
        if not prices:return out
        day,close=prices[-1]
        out["priceDate"]=day
        if (day==portfolio.get("date") and portfolio.get("nav")
            and portfolio["nav"]>0):
            out["premiumPct"]=round((close/portfolio["nav"]-1)*100,3)
        if len(prices)<20 or (TODAY-dt.date.fromisoformat(day)).days>5:return out
        # Incomplete dividend announcements in this period make total-return reconstruction unsafe.
        uncertain=[d for d in feed.get("dividends",[]) if d.get("stage")!="confirmed"
                    and as_day(d.get("exDate")) and prices[0][0]<=d["exDate"]<=day]
        if uncertain:return out
        current=peak=1.0
        for i in range(1,len(prices)):
            d,p=prices[i];prev=prices[i-1][1]
            if prev<=0:return out
            if (dt.date.fromisoformat(d)-dt.date.fromisoformat(prices[i-1][0])).days>10:
                return out
            current*= (p+div_map.get(d,0))/prev
            peak=max(peak,current)
        out["adjustedPriceDrawdownPct"]=round(max(0,(1-current/peak)*100),3)
    except (OSError, ValueError, TypeError, KeyError, ZeroDivisionError):
        pass
    return out

def load_previous():
    try:
        old=json.loads(DEST.read_text(encoding="utf-8"))
        if old.get("schema")==1 and old.get("code")==CODE:
            return old
    except (OSError, ValueError, TypeError):
        pass
    return {}

def main():
    old=load_previous()
    errors=[]
    latest=old.get("latest") if valid_old_snapshot(old.get("latest")) else None
    previous=old.get("previous") if valid_old_snapshot(old.get("previous")) else None
    try:
        auth=post("/API/home/AuthToken",{"token":"www.ctbcinvestments.com"}, {})
        token=(auth.get("Data") or {}).get("token")
        if not token or len(str(token))>1000:
            raise ValueError("官方驗證流程未回傳有效存取權杖")
        etfs=post("/API/etf/ETFList",{"token":token}, {})
        container=etfs.get("Data") or {}
        rows=container.get("Data",[]) if isinstance(container,dict) else container
        fid=next((r.get("FID") for r in rows if r.get("ETF_ID")==CODE),None)
        if not fid:
            raise ValueError("官方 ETFList 未找到 00406A")
        updated=None
        for back in range(9):
            candidate=(TODAY-dt.timedelta(days=back)).strftime("%Y/%m/%d")
            payload=post("/API/etf/ETFHoldingWeight",{"token":token},{"FID":fid,"StartDate":candidate})
            try:
                updated=parse_portfolio(payload)
                break
            except ValueError:
                continue
        if not updated:
            raise ValueError("最近 9 天均無可驗證的官方持股快照")
        if not latest or updated["date"]>latest["date"]:
            previous=latest
            latest=updated
        elif updated["date"]==latest["date"]:
            latest=updated
        else:
            errors.append("來源資料日期早於快取，已保留較新的持股")
        # First activation: retrieve one earlier portfolio day so that the
        # initial R52 view already shows real, dated changes.
        if latest and not previous:
            d=dt.date.fromisoformat(latest["date"])
            for back in range(1,7):
                q=(d-dt.timedelta(days=back)).strftime("%Y/%m/%d")
                try:
                    older=parse_portfolio(post("/API/etf/ETFHoldingWeight",
                                               {"token":token},{"FID":fid,"StartDate":q}))
                    if older["date"]<latest["date"]:
                        previous=older
                        break
                except (ValueError, OSError):
                    continue
    except Exception as exc:
        errors.append("官方持股來源暫不可用："+type(exc).__name__+"："+str(exc)[:135])
    if not latest:
        errors.append("尚未取得可核對的完整官方持股；風險分級暫停")
    output={
        "schema":1,"code":CODE,"checkedAt":NOW.isoformat(timespec="seconds"),
        "latest":latest,"previous":previous,
        "changes": changes(previous,latest) if previous and latest and
                   0<(dt.date.fromisoformat(latest["date"])-dt.date.fromisoformat(previous["date"])).days<=5 else [],
        "derivativeChanges":{
            category: derivative_changes(previous,latest,category)
            if previous and latest and
                0<(dt.date.fromisoformat(latest["date"])-dt.date.fromisoformat(previous["date"])).days<=5 else []
            for category in ("futures","options")
        },
        "metrics":market_metrics(latest or {}),
        "errors":errors,
        "methodNotes":["股數差分可能包含申購／贖回與價格變動，不代表經理人實際成交",
                       "期貨與選擇權列示部位不可直接加權成淨曝險；缺乏契約名目/Delta時顯示待核對",
                       "市價配息調整後回落是近可用資料的價格代理指標，不是基金淨值總報酬"]
    }
    DEST.parent.mkdir(parents=True,exist_ok=True)
    DEST.write_text(json.dumps(output,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("R52:", "latest",latest.get("date") if latest else None,
          "stocks",len(latest["stocks"]) if latest else 0,
          "futures",len(latest["futures"]) if latest else 0,
          "options",len(latest["options"]) if latest else 0,
          "changes",len(output["changes"]),"errors",errors)
    # A missing external endpoint must not block deployment; UI will show gray status.
    return 0

if __name__=="__main__":
    raise SystemExit(main())
