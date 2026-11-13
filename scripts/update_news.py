#!/usr/bin/env python3
"""R51: public 00406A news headline index. No personal data, article bodies, or trading signals."""
import datetime as dt
import email.utils
import html
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "news.json"
TZ = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(TZ)
CODE = "00406A"
MAX_AGE_DAYS = 14
CATEGORIES = (
    ("etf", '"00406A" OR "主動中信台灣收益" when:14d', 16),
    ("dividend", '"00406A" 配息 OR "主動中信台灣收益" 除息 when:14d', 10),
    ("holdings", '"00406A" 持股 調整 OR "00406A" 成分股 when:14d', 10),
    ("market", '台股 加權指數 台積電 投信 外資 when:3d', 8),
    ("industry", '台股 AI 伺服器 PCB 半導體 產業 when:3d', 8),
)
ETF_WORDS = ("00406a", "主動中信台灣收益", "中信台灣收益")
TOPIC_WORDS = {
    "dividend": ("配息", "除息", "股息", "收益分配", "填息", "發放"),
    "holdings": ("持股", "成分股", "換股", "增持", "減持", "調整", "加碼"),
    "market": ("台股", "加權指數", "大盤", "外資", "台積電", "投信"),
    "industry": ("ai", "伺服器", "pcb", "半導體", "hpc", "電子", "晶片"),
}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; 00406A-Tracker/1.0; public-headlines-only)",
    "Accept": "application/rss+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5",
}

def clean_text(value, limit=200):
    value = html.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    value = re.sub(r"\s+", " ", value).strip()
    return value[:limit]

def safe_link(url):
    url = str(url or "").strip()
    try:
        parsed = urllib.parse.urlsplit(url)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme != "https" or not host or parsed.username or parsed.password
                or host == "localhost" or host.endswith(".local") or len(url) > 1800):
            return ""
        return url
    except ValueError:
        return ""

def news_url(query):
    args = urllib.parse.urlencode(
        {"q": query, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"})
    return "https://news.google.com/rss/search?" + args

def fetch_feed(query):
    url = news_url(query)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=16) as response:
        content = response.read(2_000_000)
    return ET.fromstring(content)

def parse_date(text):
    try:
        d = email.utils.parsedate_to_datetime(str(text or ""))
        if d is None:
            return None
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(TZ)
    except (ValueError, TypeError, OverflowError):
        return None

def category_match(category, title):
    low = title.casefold()
    if category in ("etf", "dividend", "holdings"):
        if not any(word in low for word in ETF_WORDS):
            return False
    if category == "etf":
        return True
    return any(w in low for w in TOPIC_WORDS[category])

def normalized_headline(title):
    return "".join(c for c in unicodedata.normalize("NFKC", title).casefold()
                   if c.isalnum())[:110]

def extract(root, category, limit):
    articles = []
    for item in root.findall(".//channel/item"):
        title = clean_text(item.findtext("title"))
        source_tag = item.find("source")
        source = clean_text(source_tag.text if source_tag is not None else "", 65)
        if source and title.endswith(" - " + source):
            title = title[:-(len(source) + 3)].rstrip()
        pub = parse_date(item.findtext("pubDate"))
        url = safe_link(item.findtext("link"))
        if (len(title) < 7 or not url or pub is None
                or pub > NOW + dt.timedelta(hours=2)
                or pub < NOW - dt.timedelta(days=MAX_AGE_DAYS)
                or not category_match(category, title)):
            continue
        articles.append({
            "category": category,
            "title": title,
            "source": source or "Google 新聞收錄來源",
            "url": url,
            "publishedAt": pub.isoformat(timespec="seconds"),
        })
        if len(articles) >= limit:
            break
    return articles

def old_articles():
    try:
        data = json.loads(DEST.read_text(encoding="utf-8"))
        if data.get("schema") != 1 or data.get("code") != CODE:
            return []
        result = []
        for item in data.get("articles", []):
            if not isinstance(item, dict):
                continue
            category = item.get("category")
            pub = dt.datetime.fromisoformat(str(item.get("publishedAt", "")))
            if pub.tzinfo is None:
                continue
            if (category not in {row[0] for row in CATEGORIES}
                    or pub < NOW - dt.timedelta(days=MAX_AGE_DAYS)
                    or pub > NOW + dt.timedelta(hours=2)):
                continue
            title = clean_text(item.get("title"))
            url = safe_link(item.get("url"))
            if title and url and category_match(category, title):
                result.append({
                    "category": category, "title": title, "url": url,
                    "source": clean_text(item.get("source"), 65),
                    "publishedAt": pub.isoformat(timespec="seconds"),
                })
        return result
    except (OSError, ValueError, TypeError):
        return []

def dedupe_sort(rows):
    seen, result = set(), []
    for item in sorted(rows, key=lambda row: row["publishedAt"], reverse=True):
        key = normalized_headline(item["title"])
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    result.sort(key=lambda row: row["publishedAt"], reverse=True)
    return result[:60]

def main():
    old = old_articles()
    fresh, errors, successful = [], [], 0
    for category, query, limit in CATEGORIES:
        try:
            found = extract(fetch_feed(query), category, limit)
            fresh.extend(found)
            successful += 1
            print(f"{category}: {len(found)} valid headlines")
        except (ValueError, ET.ParseError, urllib.error.URLError, TimeoutError, OSError) as exc:
            errors.append(f"{category}: {type(exc).__name__}")
            print(f"{category}: failed ({type(exc).__name__})")
        time.sleep(0.3)
    # If no provider works, keep only recently dated verified URLs from the previous snapshot.
    rows = dedupe_sort(fresh + old) if successful else dedupe_sort(old)
    data = {
        "schema": 1, "code": CODE,
        "checkedAt": NOW.isoformat(timespec="seconds"),
        "updatedAt": NOW.isoformat(timespec="seconds") if successful else None,
        "source": "Google 新聞 RSS（標題索引；來源為第三方媒體，不是證交所公告）",
        "articles": rows,
        "errors": errors,
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    # Avoid rewriting if only checkedAt changes? Keeping it provides actual last-check status.
    DEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"R51 news index: {len(rows)} unique headlines; feeds OK {successful}/{len(CATEGORIES)}")
    if not successful and not rows:
        raise SystemExit("All RSS sources failed; no article headlines available")

if __name__ == "__main__":
    main()
