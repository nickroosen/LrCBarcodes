Third-party code bundled so the app works offline. All files are copied
unmodified from their npm packages.

| Path | Package | License |
|---|---|---|
| `qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 (`dist/qrcode.js`) | MIT, see file header |
| `pdfjs/` | [pdfjs-dist](https://github.com/mozilla/pdf.js) 6.3.289 (`legacy/build/pdf.min.mjs`, `pdf.worker.min.mjs`) | Apache 2.0, `pdfjs/LICENSE` |
| `zxing/` | [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 (`dist/iife/reader/index.js` as `zxing-reader.js`, `dist/reader/zxing_reader.wasm`) | MIT, `zxing/LICENSE` |

The legacy PDF.js build is used for compatibility with older iPad Safari versions.
