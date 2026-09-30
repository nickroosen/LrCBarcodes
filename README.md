# LrC Barcodes — barcode & QR code reader for Lightroom Classic

A Lightroom Classic plug-in that finds barcodes and QR codes in your photos, stores
what it reads in the catalog, and copies those values onto the photos that follow.
The main use is volume photography: shoot a barcode card, then the subject, and
let the plug-in label the subjects for you.

**Platforms:** Windows and macOS (Apple Silicon and Intel), Lightroom Classic 6 or
later. The macOS version is new and hasn't been tested inside Lightroom yet.

## Credits

- The original **[LR Barcodes](https://www.capturemonkey.com/barcodes/)** by
  [Capture Monkey](https://capturemonkey.com), which is no longer maintained
  (last updated 2017). This project reimplements its workflow and doesn't use any
  of its code.
- **[Okomikeruko/LrCBarcodes](https://github.com/Okomikeruko/LrCBarcodes)** by Lee
  Whittaker. This repository is a fork of that first open-source recreation.
- Barcode decoding by **[ZXing-C++](https://github.com/zxing-cpp/zxing-cpp)**
  (Apache License 2.0). It's bundled as `bin/win/ZXingReader.exe` and
  `bin/mac/ZXingReader`, with its license alongside each.

## Installation

1. Download `LrCBarcodes-<version>.zip` from the
   [latest release](https://github.com/nickroosen/LrCBarcodes/releases/latest) and
   unzip it somewhere permanent, e.g. `Documents\Lightroom Plug-ins` on Windows or
   `~/Documents/Lightroom Plug-ins` on a Mac. Lightroom loads the plug-in from
   wherever you put it, so don't leave it in Downloads.
2. In Lightroom Classic, open **File › Plug-in Manager** (Ctrl+Alt+Shift+, on
   Windows, Cmd+Option+Shift+, on a Mac).
3. Click **Add** and select the `LrCBarcodes.lrplugin` folder.

To upgrade, replace the folder with the new version and click **Reload Plug-in**
in the Plug-in Manager (or restart Lightroom).

**macOS note:** the bundled reader isn't signed with an Apple Developer ID. The
plug-in clears the download quarantine flag on it the first time it runs, so
Gatekeeper shouldn't block it. If scanning still fails with a permissions or
"cannot be opened" error, run this once in Terminal, pointing at the folder:

```
xattr -dr com.apple.quarantine ~/Documents/Lightroom\ Plug-ins/LrCBarcodes.lrplugin
```

To run the development version from a clone of this repository instead, add the
`LrCBarcodes.lrdevplugin` folder.

## Workflow

1. **Shoot.** Before each subject (a player, a student, a team), photograph their
   barcode or QR card, e.g. a GotPhoto or other volume-workflow subject card. Then
   photograph the subject. Repeat for each subject.
2. **Detect.** Select the photos and choose **Library › Plug-in Extras › Detect
   Barcodes...** (also under **File › Plug-in Extras**). The plug-in fills in these
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
4. **Clean up.** Detect creates two smart collections in an **LrC Barcodes**
   collection set: **Barcode Found** (the card shots, e.g. to reject or remove
   them) and **No Barcode** (everything else). They cover the whole catalog, update
   automatically, and can be turned off in the Detect dialog. You can also filter
   the Library by *Barcode Status*.

Propagation can be undone with **Edit › Undo**. **Clear Barcode Data...** removes
all barcode fields from the selected photos.

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

## Companion app: QR cards on a tablet or phone

Show each subject's QR code on a tablet or phone and photograph the screen as the
card shot, then hand out the printed card as usual. The plug-in reads a screen
the same way it reads a printed card, and you can find subjects by searching
instead of sorting through a stack of cards.

**Open it at <https://nickroosen.github.io/LrCBarcodes/>**, then add it to the home
screen (Safari: Share › Add to Home Screen; Chrome: menu › Install app). It then
works offline, which helps in gyms and on fields with no signal.

1. **Import the QR card PDFs from GotPhoto.** GotPhoto doesn't include gallery
   links in its exports, but its QR card PDFs contain them. Download the card PDFs
   for the job and tap **Import GotPhoto QR cards (PDF)**; you can pick several
   PDFs at once, and add more later from **More › Add card PDFs**. For each card,
   the app reads the name and class (on named cards), access code, card number
   and Code 128 number, and decodes the gallery link from the QR code. This
   all happens on the device. Unnamed password cards appear as e.g.
   `Card 2.1 · ZFC98L4W`. Adding a PDF twice doesn't duplicate cards.

   You can also **import a roster (CSV)** from any spreadsheet (comma- or
   semicolon-separated) for jobs without GotPhoto cards. The app detects the name,
   team/class and QR columns; you can change them:
   - **Subject name** and **QR code content** are templates, e.g.
     `{First Name} {Last Name}` or `{Team}-{Jersey Number}`. Tap a column name to
     insert it.
   - **QR code content for walk-ups** is used for subjects added on the day, who
     aren't in GotPhoto yet. By default it's `WALKUP-{#} {name}`, e.g.
     `WALKUP-001 Priya Shah`.

   There's also **Start a job without a roster**, for walk-ups only.
2. **On the day,** search for the subject by name, class, access code or barcode
   number, tap them, and photograph the full-screen QR code before photographing
   them. Tap **Mark photographed** to return to the list for the next subject. Use **+ Walk-up** for
   anyone not on the roster; a search that finds no one pre-fills their name.
3. **Afterwards,** choose **More › Export results (CSV)**. The export has every
   roster column plus the QR content, whether and when each subject was
   photographed, and which subjects were walk-ups. For card imports, this is also
   the one place you get each subject's name, access code and gallery link
   together in a spreadsheet.

**Privacy:** rosters are stored only in the browser on that device. Nothing is
uploaded, and there's no account or server. On iPhone and iPad, Safari may clear a
website's data after about a week of not being used, but not once the app is added
to the home screen. Export results you need to keep.

**Shooting tips:** turn the screen brightness up and avoid reflections. If the
QR code shows moiré stripes, step back or zoom in slightly rather than filling the
frame. The QR code always shows black on white, even in dark mode.

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
  SmartCollections.lua      "Barcode Found" / "No Barcode" smart collections
  PluginInfoProvider.lua    Plug-in Manager settings
  Prefs.lua                 preference defaults
  bin/win/ZXingReader.exe   ZXing-C++ command-line reader (Windows x64)
  bin/mac/ZXingReader       ZXing-C++ command-line reader (macOS universal)
companion/                  companion web app (GitHub Pages)
  lib.js                    CSV parsing, templates, export (pure JS)
  app.js                    UI
  vendor/                   qrcode-generator, PDF.js, zxing-wasm (see vendor/README.md)
scripts/package.py          builds the release zip
tests/run_tests.py          plug-in tests that run outside Lightroom
tests/companion.test.js     companion app tests (node --test)
```

Logs are written to `Documents/LrClassicLogs/LrCBarcodes.log` when the reader
reports an error.

### Tests

The pure-Lua modules, the Lua 5.1 syntax of every file, and the bundled reader
can be tested outside Lightroom:

```
pip install lupa segno
python tests/run_tests.py
```

For the companion app, run `node --test tests/companion.test.js`. To try it
locally, serve the folder (e.g. `python -m http.server --directory companion`) and
open <http://localhost:8000>.

The **Tests** workflow runs both on Windows and macOS for every pull request and
every push to `main`. The **Deploy companion app** workflow publishes `companion/`
to GitHub Pages whenever it changes on `main`. When you change the app's files,
bump `VERSION` in `companion/sw.js` so installed copies pick up the update.

### Rebuilding the barcode reader

Run the **Build barcode reader** GitHub Actions workflow (Actions tab › Run
workflow). It builds both readers; download the two artifacts and replace
`bin/win/ZXingReader.exe` and `bin/mac/ZXingReader`. The Mac artifact is a zip,
so the executable bit survives the download. After replacing the Mac reader, keep
it executable in git with `git update-index --chmod=+x
LrCBarcodes.lrdevplugin/bin/mac/ZXingReader`.

### Releasing

1. Bump `VERSION` in `Info.lua` (e.g. `major = 2, minor = 1, revision = 0`).
2. Commit, then tag and push the tag:

   ```
   git tag v2.1.0
   git push origin v2.1.0
   ```

The **Release** workflow runs the tests, checks that the tag matches `Info.lua`,
builds `LrCBarcodes-<version>.zip` with `scripts/package.py`, and publishes a
GitHub release with it. To build the zip locally, run `python scripts/package.py`;
the output goes to `dist/`.

## License

MIT; see [LICENSE](LICENSE). The bundled ZXing-C++ binary is licensed under
Apache 2.0.
