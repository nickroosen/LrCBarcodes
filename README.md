# LrC Barcodes — barcode & QR code reader for Lightroom Classic

A Lightroom Classic plug-in that finds barcodes and QR codes in your photos, stores
what it reads in the catalog, and copies those values onto the photos that follow.
The main use is product photography: shoot a barcode card, then the product, and
let the plug-in label the product shots for you.

**Platform:** Windows (Lightroom Classic 6 or later). macOS support is planned.

## Credits

- The original **[LR Barcodes](https://www.capturemonkey.com/barcodes/)** by
  [Capture Monkey](https://capturemonkey.com), which is no longer maintained
  (last updated 2017). This project reimplements its workflow and doesn't use any
  of its code.
- **[Okomikeruko/LrCBarcodes](https://github.com/Okomikeruko/LrCBarcodes)** by Lee
  Whittaker. This repository is a fork of that first open-source recreation.
- Barcode decoding by **[ZXing-C++](https://github.com/zxing-cpp/zxing-cpp)**
  (Apache License 2.0). It's bundled as `bin/win/ZXingReader.exe`, with its
  license alongside it.

## Installation

1. Download or clone this repository.
2. In Lightroom Classic, open **File › Plug-in Manager** (Ctrl+Alt+Shift+,).
3. Click **Add** and select the `LrCBarcodes.lrdevplugin` folder.

## Workflow

1. **Shoot.** Photograph a card showing the product's barcode or QR code, then the
   product. Repeat for each product.
2. **Detect.** Select the photos and choose **Library › Plug-in Extras › Detect
   Barcodes...** (also under **File › Plug-in Extras**). The plug-in fills in three
   metadata fields, visible in the Metadata panel under the *LrC Barcodes* preset:
   - **Barcode Status**: *Found*, *Not Found* or *Read Error*
   - **Barcode Type**: e.g. *QR Code*, *EAN-13*, *Code 128*
   - **Barcode Value**: the decoded text of every barcode found
   - **QR / 2D Code Value**: only QR, Data Matrix, Aztec, PDF417 and MaxiCode codes
   - **Linear Barcode Value**: only 1D barcodes (Code 128, EAN/UPC, Code 39, ITF, ...)

   If a photo contains several barcodes, the values are joined with `; `. The split
   fields let a card with, for example, a QR code *and* a Code 128 be propagated
   one code at a time.
3. **Propagate.** With the same photos selected, choose **Propagate Barcode
   Metadata...**. Photos are sorted by capture time (or by file name), and each
   barcode value is copied to the photos after it, up to the next barcode. The dialog
   previews the resulting groups before anything is written. Options:
   - **Destination:** Title, Caption, Headline, Copy Name, Job Identifier or Keyword
     (created under a parent keyword, *LrCBarcodes* by default).
   - Also write the value to the barcode photo itself.
   - Only fill photos whose destination field is empty.
   - Limit the number of photos per group.
   - Append a sequence number within each group (e.g. `012345_1`, `012345_2`),
     which is useful for renaming files from the Title field.


   **Safety for unreadable cards:** if a photo looks like a barcode card but its
   source value is missing (its status is *Read Error*, or it only has the other
   kind of code), the current group ends there. The photos that follow are left
   blank instead of getting the previous subject's value, and the preview lists
   those cards so you can fix them. You can type the value into the source field
   by hand, or rescan with a larger preview size.
4. **Clean up.** Filter the Library by *Barcode Status = Found* to find (and remove
   or reject) the barcode card shots.

Propagation can be undone with **Edit › Undo**. **Clear Barcode Data...** removes
the three barcode fields from the selected photos.

### Supported symbologies

QR Code, Micro QR, rMQR, Data Matrix, Aztec, PDF417, MicroPDF417, MaxiCode, EAN-8/13,
UPC-A/E, ISBN, Code 39, Code 93, Code 128, Codabar, ITF, Telepen, DataBar and DX Film Edge.

### How scanning works

Each photo is rendered by Lightroom to a JPEG preview (2048 px long edge by
default, adjustable in the Plug-in Manager), and the preview is scanned by
ZXing-C++. This means RAW files, virtual copies and cropped photos all work.

Photos where the preview pass finds a barcode (or can't read one) are then
re-rendered at full resolution and scanned again. This is on by default and can be
turned off in the Detect dialog. The second pass matters for fine 1D barcodes: on a
subject card, a QR code reads from a preview when the card is only about 20% of
the frame width, but the Code 128 next to it needs full resolution unless the card
nearly fills the frame. Since usually only the card shots are rescanned, the extra
time is small.

## Development

```
LrCBarcodes.lrdevplugin/
  Info.lua                  manifest and menu items
  DetectBarcodes.lua        "Detect Barcodes..." command
  PropagateMetadata.lua     "Propagate Barcode Metadata..." dialog and writer
  ClearBarcodes.lua         "Clear Barcode Data..." command
  Scanner.lua               renders previews and runs ZXingReader in batches
  ReaderOutput.lua          parses ZXingReader output (pure Lua)
  Propagation.lua           grouping and numbering rules (pure Lua)
  MetadataProvider.lua      custom metadata fields
  MetadataTagsetFactory.lua Metadata panel preset
  PluginInfoProvider.lua    Plug-in Manager settings
  Prefs.lua                 preference defaults
  bin/win/ZXingReader.exe   ZXing-C++ command-line reader
```

Logs are written to `Documents\LrClassicLogs\LrCBarcodes.log`.

### Tests

The pure-Lua modules, the Lua 5.1 syntax of every file, and the bundled reader
can be tested outside Lightroom:

```
pip install lupa segno
python tests/run_tests.py
```

### Rebuilding the barcode reader

Run the **Build barcode reader** GitHub Actions workflow (Actions tab › Run
workflow), download the artifact, and replace `bin/win/ZXingReader.exe` with it.

## License

MIT; see [LICENSE](LICENSE). The bundled ZXing-C++ binary is licensed under
Apache 2.0.
