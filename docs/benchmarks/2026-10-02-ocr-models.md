# OCR model benchmark (2026-10-02)

- Machine: 12th Gen Intel(R) Core(TM) i5-12600KF, Node v24.14.1
- Runtime: onnxruntime-web 1.24.3, plain WASM, single thread (same setup as the browser worker)
- Fixture: `test/fixtures/menu-kkm.png`, 12 required dish names (`test/fixtures/labels.json`)
- Method: `node scripts/bench.js` (median of 3 scans per row)

| det | rec | long side | models MB | exact | mean CER | det ms | rec ms | total ms | misses |
|---|---|---|---|---|---|---|---|---|---|
| v4 | v4 | 960 | 15.6 | 10/12 | 0.061 | 212 | 1490 | 1727 | 海鲜可口面→阿公可口面, 面粉粿→面粉颗 |
| v4 | v4 | 1280 | 15.6 | 11/12 | 0.028 | 397 | 1662 | 2099 | 面粉粿→面粉颗 |
| v4 | v5 | 960 | 21.4 | 11/12 | 0.033 | 210 | 1572 | 1811 | 海鲜可口面→阿公可口面 |
| v4 | v5 | 1280 | 21.4 | 11/12 | 0.028 | 392 | 1730 | 2166 | 面粉粿→面粉棵 |
| v4 | v6-tiny | 960 | 9.2 | 10/12 | 0.061 | 212 | 437 | 670 | 海鲜可口面→阿公可口面, 面粉粿→面粉棵 |
| v4 | v6-tiny | 1280 | 9.2 | 11/12 | 0.028 | 391 | 492 | 915 | 面粉粿→面粉棵 |
| v4 | v6-small | 960 | 25.9 | 11/12 | 0.033 | 212 | 2067 | 2300 | 海鲜可口面→阿公可口面 |
| v4 | v6-small | 1280 | 25.9 | 12/12 | 0.000 | 389 | 2312 | 2736 |  |
| v5 | v4 | 960 | 15.7 | 11/12 | 0.028 | 284 | 1495 | 1801 | 面粉粿→面粉棵 |
| v5 | v4 | 1280 | 15.7 | 11/12 | 0.028 | 510 | 1657 | 2201 | 面粉粿→面粉颗 |
| v5 | v5 | 960 | 21.5 | 12/12 | 0.000 | 283 | 1588 | 1891 |  |
| v5 | v5 | 1280 | 21.5 | 12/12 | 0.000 | 518 | 1724 | 2277 |  |
| v5 | v6-tiny | 960 | 9.3 | 11/12 | 0.028 | 281 | 438 | 739 | 面粉粿→面粉棵 |
| v5 | v6-tiny | 1280 | 9.3 | 11/12 | 0.028 | 510 | 470 | 1010 | 面粉粿→面粉棵 |
| v5 | v6-small | 960 | 26.0 | 12/12 | 0.000 | 285 | 2098 | 2408 |  |
| v5 | v6-small | 1280 | 26.0 | 12/12 | 0.000 | 507 | 2287 | 2828 |  |
| v6-tiny | v4 | 960 | 12.6 | 11/12 | 0.028 | 149 | 1526 | 1694 | 面粉粿→面粉颗 |
| v6-tiny | v4 | 1280 | 12.6 | 11/12 | 0.028 | 270 | 1614 | 1921 | 面粉粿→面粉颗 |
| v6-tiny | v5 | 960 | 18.4 | 11/12 | 0.028 | 148 | 1613 | 1785 | 面粉粿→面粉棵 |
| v6-tiny | v5 | 1280 | 18.4 | 11/12 | 0.028 | 267 | 1711 | 2013 | 面粉粿→面粉棵 |
| v6-tiny | v6-tiny | 960 | 6.2 | 11/12 | 0.028 | 150 | 450 | 625 | 面粉粿→面粉棵 |
| v6-tiny | v6-tiny | 1280 | 6.2 | 11/12 | 0.028 | 271 | 472 | 778 | 面粉粿→面粉棵 |
| v6-tiny | v6-small | 960 | 22.9 | 12/12 | 0.000 | 154 | 2151 | 2325 |  |
| v6-tiny | v6-small | 1280 | 22.9 | 12/12 | 0.000 | 270 | 2269 | 2572 |  |
| v6-small | v4 | 960 | 20.7 | 11/12 | 0.028 | 372 | 1593 | 1995 | 面粉粿→面粉颗 |
| v6-small | v4 | 1280 | 20.7 | 12/12 | 0.000 | 671 | 1720 | 2432 |  |
| v6-small | v5 | 960 | 26.5 | 11/12 | 0.028 | 375 | 1673 | 2066 | 面粉粿→面粉棵 |
| v6-small | v5 | 1280 | 26.5 | 11/12 | 0.028 | 658 | 1804 | 2496 | 面粉粿→面粉棵 |
| v6-small | v6-tiny | 960 | 14.3 | 11/12 | 0.028 | 372 | 469 | 867 | 面粉粿→面粉棵 |
| v6-small | v6-tiny | 1280 | 14.3 | 11/12 | 0.028 | 662 | 498 | 1201 | 面粉粿→面粉棵 |
| v6-small | v6-small | 960 | 31.0 | 12/12 | 0.000 | 368 | 2216 | 2608 |  |
| v6-small | v6-small | 1280 | 31.0 | 12/12 | 0.000 | 659 | 2398 | 3092 |  |

Selection rule picks: det=v6-small rec=v4 longSide=1280


## Decision

`DEFAULT_CONFIG = { det: 'v6-small', rec: 'v4', longSide: 1280 }`, chosen by the spec §6.7 rule
(every dish exact, then smallest download, then fastest).

Not final until measured on a phone: recognition is most of the scan time, so check spec success
criterion 4 (≤ 1.5s from freeze to pinyin) with Plan 2's debug panel. If it's too slow there, the
fallback is the fastest row that reads 11/12 (v6-tiny + v6-tiny during planning), which trades one
rare character (粿) for roughly a third of the time and download.
