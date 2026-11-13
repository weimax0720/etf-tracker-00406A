#!/usr/bin/env python3
"""R51 RSS parser fixture: no live network, no user records."""
import datetime as dt
import email.utils
import importlib.util
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("r51_news", ROOT / "scripts" / "update_news.py")
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)

pub = email.utils.format_datetime(news.NOW - dt.timedelta(hours=1))
xml = f"""<rss><channel>
 <item><title>00406A 配息 公告 - 財經媒體</title>
 <link>https://news.google.com/rss/articles/abc123</link>
 <pubDate>{pub}</pubDate><source>財經媒體</source><description>Do not reproduce body</description></item>
 <item><title>無關的娛樂消息</title>
 <link>https://news.google.com/rss/articles/xyz456</link>
 <pubDate>{pub}</pubDate></item>
</channel></rss>"""
feed = ET.fromstring(xml)
dividends = news.extract(feed, "dividend", 10)
assert len(dividends) == 1, dividends
assert dividends[0]["title"] == "00406A 配息 公告"
assert dividends[0]["source"] == "財經媒體"
assert "description" not in dividends[0]
assert len(news.extract(feed, "holdings", 10)) == 0
assert news.safe_link("javascript:alert(1)") == ""
assert news.safe_link("http://example.com") == ""
assert news.safe_link("https://news.google.com/rss/articles/abc123")
assert news.category_match("holdings", "00406A 持股調整")
assert not news.category_match("holdings", "台股明天漲停")
assert len(news.dedupe_sort(dividends + dividends)) == 1
print("R51 Python PASS: RSS parsing, source attribution, category checks, title-only and URL guards")
