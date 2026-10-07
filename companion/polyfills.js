/*
 * Small fallbacks for older iPad Safari versions.
 *
 * PDF.js 6 (vendor/pdfjs) calls Promise.withResolvers() and
 * ArrayBuffer.prototype.transferToFixedLength(), which Safari only added in
 * iPadOS 17.4, and its "legacy" build doesn't include fallbacks for them. On
 * older iPads, importing a card PDF failed with "undefined is not a function".
 * The others here are used by the bundled libraries and missing before
 * iPadOS 15.4. (PDF.js itself needs at least iPadOS 16.4: it uses class
 * static blocks, which can't be polyfilled.)
 *
 * Loaded as a classic script in index.html (main page) and imported first by
 * vendor/pdfjs/pdf.worker.polyfilled.mjs (PDF.js's worker). Each fallback is
 * only installed when the browser lacks the feature.
 */
(function (global) {
  'use strict';

  function define(target, name, value) {
    if (!(name in target)) {
      Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
    }
  }

  define(Promise, 'withResolvers', function withResolvers() {
    let resolve, reject;
    const promise = new this((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  });

  define(Object, 'hasOwn', function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  });

  function at(index) {
    const n = Math.trunc(index) || 0;
    const i = n < 0 ? this.length + n : n;
    return i < 0 || i >= this.length ? undefined : this[i];
  }
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', at);
  if (typeof Uint8Array !== 'undefined') define(Object.getPrototypeOf(Uint8Array.prototype), 'at', at);

  // Used by PDF.js when it falls back to system fonts (iPadOS 17.4+).
  function transferToFixedLength(length) {
    const size = length === undefined ? this.byteLength : length;
    const copy = new ArrayBuffer(size);
    new Uint8Array(copy).set(new Uint8Array(this, 0, Math.min(size, this.byteLength)));
    return copy;
  }
  define(ArrayBuffer.prototype, 'transferToFixedLength', transferToFixedLength);
  define(ArrayBuffer.prototype, 'transfer', transferToFixedLength);

  define(Array.prototype, 'findLast', function findLast(fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  });
  define(Array.prototype, 'findLastIndex', function findLastIndex(fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
