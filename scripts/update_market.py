#!/usr/bin/env python3
"""00406A 公開市場資料同步；只寫 data/market.json，不存放個人帳務或 API 金鑰。"""
import datetime as dt
import html
import json
import os
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "market.json"
CODE = "00406A"
TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(TZ)
TODAY = NOW.date()
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; 00406A-Tracker/1.0; public-data-check)",
           "Accept": "application/json,text/html;q=0.9,*/*;q=0.8"}

def get(url, params=None, token=""):
    full = url + ("?" + urlencode(params) if params else "")
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = "Bearer " + token
    last = None
    for i in range(2):
        try:
            with urlopen(Request(full, headers=headers), timeout=22) as reply:
                return reply.read().decode("utf-8-sig", errors="replace")
        except Exception as exc:
            last = exc
            if i == 0:
                time.sleep(2)
    raise RuntimeError(str(last))

def parse_day(value):
    text = str(value or "").strip()
    m = re.search(r"(\d{2,3})[年/](\d{1,2})[月/](\d{1,2})日?", text)
    if m:
        year = int(m[1]) + 1911
        try:
            return dt.date(year, int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return ""
    m = re.search(r"(20\d{2})[-/](\d{1,2})[-/](\d{1,2})", text)
    if m:
        try:
            return dt.date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            return ""
    return ""

def number(value):
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None

class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_tr = False
        self.in_td = 0
        self.cell = []
        self.cells = []
        self.rows = []
    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.in_tr = True
            self.cells = []
        elif tag == "td" and self.in_tr:
            self.in_td += 1
            if self.in_td == 1:
                self.cell = []
    def handle_data(self, value):
        if self.in_td:
            self.cell.append(value)
    def handle_endtag(self, tag):
        if tag == "td" and self.in_td:
            self.in_td -= 1
            if self.in_td == 0:
                self.cells.append(html.unescape("".join(self.cell)).strip())
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            if self.cells:
                self.rows.append(self.cells)

def twse_dividends(year):
    page = get("https://www.twse.com.tw/zh/ETFortune/dividendList",
               {"startDate": year, "endDate": year, "stkNo": CODE})
    parser = Rows()
    parser.feed(page)
    items = []
    for cells in parser.rows:
        if len(cells) < 6 or cells[0] != CODE:
            continue
        ex_date = parse_day(cells[2])
        pay_date = parse_day(cells[4])
        if not ex_date or not pay_date:
            continue
        amount = number(cells[5])
        confirmed = amount is not None and 0 < amount < 100
        items.append({
            "exDate": ex_date, "payDate": pay_date,
            "amount": round(amount, 6) if confirmed else None,
            "stage": "confirmed" if confirmed else "scheduled",
            "source": "臺灣證券交易所 ETF e添富",
        })
    if not items:
        raise RuntimeError("證交所網頁未回傳可辨識的 00406A 表格（避免清空舊資料）")
    return items

def previous_month(y, m):
    return (y - 1, 12) if m == 1 else (y, m - 1)

def twse_prices(year, month):
    date = f"{year:04d}{month:02d}01"
    text = get("https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY",
               {"date": date, "stockNo": CODE, "response": "json"})
    payload = json.loads(text)
    if payload.get("stat") != "OK" or not isinstance(payload.get("data"), list):
        raise RuntimeError("證交所單月價格 API 無有效回應")
    title = str(payload.get("title") or "")
    if CODE not in title and payload.get("data"):
        raise RuntimeError("證交所回傳的股票代號不符")
    parsed = []
    for cells in payload["data"]:
        if len(cells) < 7:
            continue
        day = parse_day(cells[0])
        volume, traded, close = number(cells[1]), number(cells[2]), number(cells[6])
        if not day or day > TODAY.isoformat() or not all(
            v is not None and v >= 0 for v in (volume, traded, close)
        ) or close <= 0:
            continue
        parsed.append({
            "date": day, "close": close,
            "Trading_Volume": volume, "Trading_money": traded,
            "open": number(cells[3]), "max": number(cells[4]),
            "min": number(cells[5]),
            "stock_id": CODE
        })
    return parsed

def finmind(dataset, start, token):
    data = json.loads(get("https://api.finmindtrade.com/api/v4/data",
                          {"dataset": dataset, "data_id": CODE, "start_date": start}, token))
    if data.get("msg") != "success" or not isinstance(data.get("data"), list):
        raise RuntimeError("FinMind API 失敗：" + str(data.get("msg", "未知錯誤")))
    return data["data"]

def valid_price(row):
    if not isinstance(row, dict):
        return False
    day = parse_day(row.get("date"))
    close = number(row.get("close"))
    volume = number(row.get("Trading_Volume", row.get("volume")))
    return bool(day and day <= TODAY.isoformat() and close is not None
                and 0 < close < 100000 and volume is not None and volume >= 0)

def valid_dividend(row):
    if not isinstance(row, dict):
        return False
    ex = parse_day(row.get("exDate", row.get("CashExDividendTradingDate")))
    pay = parse_day(row.get("payDate", row.get("CashDividendPaymentDate")))
    return bool(ex and pay and ex[:4] >= "2020")

def main():
    old = {}
    if DEST.exists():
        try:
            old = json.loads(DEST.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            old = {}
    if old.get("schema") != 1:
        old = {}
    result = {
        "schema": 1, "code": CODE,
        "checkedAt": NOW.isoformat(timespec="seconds"),
        "pricesUpdatedAt": old.get("pricesUpdatedAt"),
        "dividendsUpdatedAt": old.get("dividendsUpdatedAt"),
        "prices": [r for r in old.get("prices", []) if valid_price(r)],
        "dividends": [r for r in old.get("dividends", []) if valid_dividend(r)],
        "sources": {"prices": "沿用已取得資料", "dividends": "沿用已取得資料"},
        "errors": [],
    }

    token = os.environ.get("FINMIND_TOKEN", "").strip()
    new_prices = []
    if token:
        try:
            start = (TODAY - dt.timedelta(days=395)).isoformat()
            new_prices.extend(finmind("TaiwanStockPrice", start, token))
            result["sources"]["prices"] = "FinMind（GitHub Actions）"
        except Exception as exc:
            result["errors"].append("FinMind 價格：" + str(exc))
    # 不需金鑰，仍使用證交所官方每日交易資料；TWSE 同日資料優先。
    y, m = TODAY.year, TODAY.month
    months = 3 if old.get("prices") else 4
    twse_count = 0
    for _ in range(months):
        try:
            rows = twse_prices(y, m)
            if rows:
                new_prices.extend(rows)
                twse_count += 1
        except Exception as exc:
            result["errors"].append(f"TWSE {y}-{m:02d} 價格：" + str(exc))
        y, m = previous_month(y, m)
        time.sleep(0.7)
    if twse_count:
        result["sources"]["prices"] = "臺灣證券交易所每日成交資料" + ("＋FinMind" if token else "")

    good_prices = [r for r in new_prices if valid_price(r)]
    if good_prices:
        price_by_day = {r["date"]: r for r in result["prices"]}
        price_by_day.update({r["date"]: r for r in good_prices})
        result["prices"] = sorted(price_by_day.values(), key=lambda r: r["date"])[-400:]
        result["pricesUpdatedAt"] = NOW.isoformat(timespec="seconds")

    if token:
        try:
            items = finmind("TaiwanStockDividend", "2020-01-01", token)
            confirmed = []
            for row in items:
                ex_date = parse_day(row.get("CashExDividendTradingDate"))
                pay_date = parse_day(row.get("CashDividendPaymentDate"))
                amount = number(row.get("CashEarningsDistribution"))
                if ex_date and amount is not None and 0 < amount < 100:
                    confirmed.append({
                        "exDate": ex_date, "payDate": pay_date,
                        "amount": amount, "stage": "source_amount",
                        "source": "FinMind（官方待核對）",
                    })
            if confirmed:
                result["dividends"] = confirmed
                result["dividendsUpdatedAt"] = NOW.isoformat(timespec="seconds")
                result["sources"]["dividends"] = "FinMind"
        except Exception as exc:
            result["errors"].append("FinMind 配息：" + str(exc))

    twse_rows = []
    for year in (TODAY.year - 1, TODAY.year):
        try:
            twse_rows.extend(twse_dividends(year))
        except Exception as exc:
            result["errors"].append(f"TWSE {year} 配息：" + str(exc))
    if twse_rows:
        by_day = {r["exDate"]: r for r in result["dividends"] if valid_dividend(r)}
        # 官方當期正式金額最高優先；空白不會清除既有當期金額，
        # 但沒有正式金額時只能標示「來源金額待核對」。
        for row in twse_rows:
            old_row = by_day.get(row["exDate"])
            if row["amount"] is not None:
                by_day[row["exDate"]] = row
            elif old_row and number(old_row.get("amount")) is not None:
                by_day[row["exDate"]] = {**row, "amount": old_row["amount"],
                    "stage": "source_amount", "source": old_row.get("source", "待核對")}
            else:
                by_day[row["exDate"]] = row
        result["dividends"] = sorted(by_day.values(), key=lambda r: r["exDate"])
        result["dividendsUpdatedAt"] = NOW.isoformat(timespec="seconds")
        result["sources"]["dividends"] = "臺灣證券交易所 ETF e添富"

    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8")
    print(f"同步結果：價格 {len(result['prices'])} 筆，配息 {len(result['dividends'])} 筆")
    for err in result["errors"]:
        print("注意：" + err, file=sys.stderr)
    if not result["prices"] and not result["dividends"]:
        raise SystemExit("公開市場來源均未成功；資料仍保持空白，未捏造行情")

if __name__ == "__main__":
    main()
