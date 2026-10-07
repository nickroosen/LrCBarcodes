// PDF.js worker entry point with fallbacks for older iPad Safari.
// Imports run in order, so the fallbacks are installed before PDF.js loads.
// See ../../polyfills.js.
import '../../polyfills.js';
import './pdf.worker.min.mjs';
