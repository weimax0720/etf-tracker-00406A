#!/usr/bin/env python3
"""R52 independent official-API parser tests; pure fixture/no network."""
import datetime as dt
import importlib.util
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("portfolio",root/"scripts"/"update_portfolio.py")
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

def holding(code, weight, shares=123000, name="測試股"):
    return {"code_":code,"name_":name,"qty_":f"{shares:,}.00","weights_":str(weight)}
def payload(when,stock_weight=5):
    return {"ResultCode":0,"Data":{"FundAssets":[{
        "資料日期":when,"基金每單位淨值":"6.40","基金淨資產":"1,250,000,000",
        "基金在外流通單位數":"300,000,000"}],
        "FundAssetsDetail":[
            {"Code":"STOCK","Data":[holding(str(2000+i),stock_weight,shares=100000+i*1000)
                                     for i in range(12)]},
            {"Code":"FUTURE","Data":[{"code_":"TX","name_":"臺股期貨",
                                       "qty_":"4,540.00","weights_":"23.94"}]},
            {"Code":"OPTION","Data":[{"code_":"TXX","name_":"台指買權",
                                       "qty_":"-6,300.00","weights_":"-7.60"}]},
            {"Code":"CASH","Data":[{"code_":"CASH","name_":"現金",
                                      "qty_":"123,000","weights_":"0.5"}]}]}}
date=p.TODAY.isoformat()
parsed=p.parse_portfolio(payload(date))
assert parsed["date"]==date
assert len(parsed["stocks"])==12
assert parsed["futures"][0]["quantity"]==4540
assert parsed["options"][0]["quantity"]==-6300
assert parsed["unknownGroups"]==["CASH"]
assert parsed["nav"]==6.40
prev_derivative={**parsed,"futures":[{**parsed["futures"][0],"quantity":4400,
                                           "reportedWeight":22.5}],
                 "options":[{**parsed["options"][0],"quantity":-6000,
                                            "reportedWeight":-7.1}]}
future_delta=p.derivative_changes(prev_derivative,parsed,"futures")
option_delta=p.derivative_changes(prev_derivative,parsed,"options")
assert len(future_delta)==1 and future_delta[0]["quantityDelta"]==140
assert option_delta[0]["quantityDelta"]==-300
assert abs(future_delta[0]["weightDeltaPp"]-1.44)<0.001

older={**parsed,"date":(p.TODAY-dt.timedelta(days=1)).isoformat(),
       "stocks":[dict(row) for row in parsed["stocks"]]}
newer={**parsed,"stocks":[dict(row) for row in parsed["stocks"]]}
newer["stocks"][0]["shares"]+=5000
newer["stocks"][0]["weight"]+=0.5
newer["stocks"][1]["weight"]+=0.05
delta=p.changes(older,newer)
assert any(d["type"]=="increase" and d["sharesDelta"]==5000 and
           abs(d["weightDeltaPp"]-0.5)<0.01 for d in delta)
assert any(d["type"]=="weight_only" and d["sharesDelta"]==0 for d in delta)
metrics=p.market_metrics(parsed)
assert metrics["grossExposurePct"] is None
assert metrics["optionNotionalPct"] is None
assert metrics["sectorConcentrationPct"] is None
assert metrics["maxSingleStockPct"]==5
try:
    p.parse_portfolio({"ResultCode":0,"Data":{"FundAssets":[{"資料日期":date}],
                                             "FundAssetsDetail":[{"Code":"STOCK","Data":[]}]}})
    raise AssertionError("empty holdings wrongly accepted")
except ValueError:
    pass
assert p.num("nan") is None
assert p.num("Infinity") is None
print("R52 Python PASS: stock/futures/options parsing, share-vs-weight differences, no invented exposure, no empty override.")
