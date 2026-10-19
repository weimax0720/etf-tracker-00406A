#!/usr/bin/env python3
"""R49: publish a validated TWSE MIS last-trade snapshot; never touch private holdings."""
import datetime as dt
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor
from http.cookiejar import CookieJar

TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(TZ)
TODAY = NOW.strftime("%Y%m%d")
OUT = Path(__file__).resolve().parents[1] / "data" / "quote.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; 00406A-Tracker/1.0)",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://mis.twse.com.tw/stock/fibest.jsp?stock=00406A",
}
def number(value):
    try:
        result = float(str(value).replace(",", ""))
        return result if 0 < result < 100000 else None
    except (TypeError, ValueError):
        return None

def main():
    if NOW.weekday() >= 5 or not (dt.time(8, 55) <= NOW.time() <= dt.time(14, 10)):
        print("Outside TWSE weekday quote window")
        return
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    def read(url):
        with opener.open(Request(url, headers=HEADERS), timeout=16) as response:
            return response.read().decode("utf-8-sig")
    try:
        # MIS may require a session cookie before returning current quote data.
        try:
            read("https://mis.twse.com.tw/stock/fibest.jsp?stock=00406A")
        except Exception as exc:
            print("MIS warm-up unavailable:", exc)
        url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?"
        url += urlencode({"ex_ch": "tse_00406A.tw", "json": 1, "delay": 0,
                          "_": int(NOW.timestamp() * 1000)})
        result = json.loads(read(url))
        rows = result.get("msgArray")
        if not isinstance(rows, list):
            raise ValueError("MIS did not return msgArray")
        row = next((r for r in rows if str(r.get("c", "")).upper() == "00406A"), None)
        if not row:
            raise ValueError("MIS did not return 00406A")
        if row.get("d") != TODAY:
            print("MIS trade date differs from Taiwan today: no overwrite")
            return
        price = number(row.get("z"))
        time_value = str(row.get("t") or "")
        if price is None or len(time_value) != 8 or time_value[2] != ":" or time_value[5] != ":":
            print("No valid last-trade price/time: no overwrite")
            return
        quote_time = dt.datetime.strptime(
            str(row["d"]) + " " + time_value, "%Y%m%d %H:%M:%S"
        ).replace(tzinfo=TZ)
        if quote_time > NOW + dt.timedelta(minutes=2) or NOW - quote_time > dt.timedelta(minutes=25):
            print("Exchange quote is too old or in the future: no overwrite")
            return
        new = {
            "schema": 1, "code": "00406A", "price": price,
            "tradeDate": quote_time.strftime("%Y-%m-%d"),
            "tradeTime": quote_time.strftime("%H:%M:%S"),
            "exchangeAt": quote_time.isoformat(timespec="seconds"),
            "retrievedAt": NOW.isoformat(timespec="seconds"),
            "source": "臺灣證券交易所 MIS 最近成交價",
        }
        if OUT.exists():
            try:
                old = json.loads(OUT.read_text(encoding="utf-8"))
                if (old.get("exchangeAt") == new["exchangeAt"]
                        and old.get("price") == new["price"]):
                    print("No new last trade; keeping existing exchange timestamp")
                    return
            except (ValueError, OSError):
                pass
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
        print("Updated TWSE quote:", new["tradeDate"], new["tradeTime"], price)
    except Exception as exc:
        print("MIS quote unavailable; retaining last successful quote:", exc, file=sys.stderr)
        # Historical market.json remains the fallback; do not fabricate a quote.

if __name__ == "__main__":
    main()
