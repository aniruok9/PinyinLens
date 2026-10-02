# OCR model benchmark (2026-10-02)

- Machine: 12th Gen Intel(R) Core(TM) i5-12600KF, Node v24.14.1
- Runtime: onnxruntime-web 1.24.3, plain WASM, single thread (same setup as the browser worker)
- Fixture: `test/fixtures/menu-kkm.png`, 12 required dish names (`test/fixtures/labels.json`)
- Method: `node scripts/bench.js` (median of 3 scans per row)

| det | rec | long side | models MB | exact | mean CER | det ms | rec ms | total ms | misses |
|---|---|---|---|---|---|---|---|---|---|
| v4 | v4 | 960 | 15.6 | 10/12 | 0.061 | 211 | 1478 | 1713 | 海鲜可口面→阿公可口面, 面粉粿→面粉颗 |
| v4 | v4 | 1280 | 15.6 | 11/12 | 0.028 | 388 | 1630 | 2062 | 面粉粿→面粉颗 |
| v4 | v5 | 960 | 21.4 | 11/12 | 0.033 | 210 | 1594 | 1832 | 海鲜可口面→阿公可口面 |
| v4 | v5 | 1280 | 21.4 | 11/12 | 0.028 | 387 | 1751 | 2170 | 面粉粿→面粉棵 |
| v4 | v6-tiny | 960 | 9.2 | 10/12 | 0.061 | 211 | 434 | 666 | 海鲜可口面→阿公可口面, 面粉粿→面粉棵 |
| v4 | v6-tiny | 1280 | 9.2 | 11/12 | 0.028 | 384 | 481 | 899 | 面粉粿→面粉棵 |
| v4 | v6-small | 960 | 25.9 | 11/12 | 0.033 | 208 | 2071 | 2304 | 海鲜可口面→阿公可口面 |
| v4 | v6-small | 1280 | 25.9 | 12/12 | 0.000 | 390 | 2282 | 2712 |  |
| v5 | v4 | 960 | 15.7 | 11/12 | 0.028 | 284 | 1490 | 1797 | 面粉粿→面粉棵 |
| v5 | v4 | 1280 | 15.7 | 11/12 | 0.028 | 510 | 1621 | 2160 | 面粉粿→面粉颗 |
| v5 | v5 | 960 | 21.5 | 12/12 | 0.000 | 281 | 1599 | 1903 |  |
| v5 | v5 | 1280 | 21.5 | 12/12 | 0.000 | 509 | 1714 | 2258 |  |
| v5 | v6-tiny | 960 | 9.3 | 11/12 | 0.028 | 280 | 440 | 742 | 面粉粿→面粉棵 |
| v5 | v6-tiny | 1280 | 9.3 | 11/12 | 0.028 | 511 | 473 | 1017 | 面粉粿→面粉棵 |
| v5 | v6-small | 960 | 26.0 | 12/12 | 0.000 | 281 | 2100 | 2405 |  |
| v5 | v6-small | 1280 | 26.0 | 12/12 | 0.000 | 513 | 2281 | 2829 |  |
| v6-tiny | v4 | 960 | 12.6 | 11/12 | 0.028 | 150 | 1515 | 1684 | 面粉粿→面粉颗 |
| v6-tiny | v4 | 1280 | 12.6 | 11/12 | 0.028 | 267 | 1590 | 1886 | 面粉粿→面粉颗 |
| v6-tiny | v5 | 960 | 18.4 | 11/12 | 0.028 | 151 | 1607 | 1781 | 面粉粿→面粉棵 |
| v6-tiny | v5 | 1280 | 18.4 | 11/12 | 0.028 | 268 | 1705 | 2009 | 面粉粿→面粉棵 |
| v6-tiny | v6-tiny | 960 | 6.2 | 11/12 | 0.028 | 151 | 442 | 611 | 面粉粿→面粉棵 |
| v6-tiny | v6-tiny | 1280 | 6.2 | 11/12 | 0.028 | 266 | 473 | 772 | 面粉粿→面粉棵 |
| v6-tiny | v6-small | 960 | 22.9 | 12/12 | 0.000 | 149 | 2135 | 2306 |  |
| v6-tiny | v6-small | 1280 | 22.9 | 12/12 | 0.000 | 267 | 2261 | 2558 |  |
| v6-small | v4 | 960 | 20.7 | 11/12 | 0.028 | 371 | 1544 | 1940 | 面粉粿→面粉颗 |
| v6-small | v4 | 1280 | 20.7 | 12/12 | 0.000 | 659 | 1673 | 2367 |  |
| v6-small | v5 | 960 | 26.5 | 11/12 | 0.028 | 371 | 1669 | 2062 | 面粉粿→面粉棵 |
| v6-small | v5 | 1280 | 26.5 | 11/12 | 0.028 | 667 | 1826 | 2534 | 面粉粿→面粉棵 |
| v6-small | v6-tiny | 960 | 14.3 | 11/12 | 0.028 | 377 | 475 | 875 | 面粉粿→面粉棵 |
| v6-small | v6-tiny | 1280 | 14.3 | 11/12 | 0.028 | 673 | 507 | 1211 | 面粉粿→面粉棵 |
| v6-small | v6-small | 960 | 31.0 | 12/12 | 0.000 | 365 | 2177 | 2575 |  |
| v6-small | v6-small | 1280 | 31.0 | 12/12 | 0.000 | 663 | 2403 | 3103 |  |

Selection rule picks: det=v5 rec=v5 longSide=960

## Decision

`DEFAULT_CONFIG = { det: 'v5', rec: 'v5', longSide: 960 }`, chosen by the spec §6.7 rule
(every dish exact, then fastest, then smallest download). The earlier smallest-download-first rule picked v6-small + v4 @ 1280 (20.7MB, ~2.4s, only 11/12 at 960) and was replaced for that reason.

Not final until measured on a phone: recognition is most of the scan time, so check spec success
criterion 4 (≤ 1.5s from freeze to pinyin) with Plan 2's debug panel. If it's too slow there, the
fallback is the fastest row that reads 11/12 (v6-tiny + v6-tiny during planning), which trades one
rare character (粿) for roughly a third of the time and download.
