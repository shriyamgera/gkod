# GKod

Describe a part in words, a sketch or a photo. GKod writes it as editable code, shows it in 3D, checks that it will print, and slices it for your printer, all in the browser.

The name is a short form of G-code, the file a 3D printer runs.

## Status

Build day 3 (26 November 2026). This section is updated as each piece lands.

What works today:

- **Make a part from words.** Type a request, such as "Phone stand, 80 mm wide", and Gemini writes it as OpenSCAD code with named sizes. If the code does not compile, the compiler's error goes back once for a fix.
- **Photo or sketch.** Add a picture to the request. It is shrunk in the browser before it is sent.
- **Change it by typing.** "Make it 10 mm wider" sends the current code back and makes a new version. Every version is listed, with the model that wrote it. Undo and Redo (or Ctrl+Z and Shift+Ctrl+Z) move between them.
- **Sizes.** A slider and a number box for each named size. The part recompiles as you change them.
- **On your device.** The code compiles in a Web Worker (10 second limit) and is shown in a 3D viewer that works with the mouse or the keyboard. The STL file can be downloaded.
- **Print checks.** After every compile, four checks run on the mesh in the same worker. They take about a millisecond for the examples and about 40 ms for a 160,000-triangle part:
  - the surface is closed, with no holes;
  - it fits the printer bed, which is 256 x 256 x 256 mm for now (a printer picker comes with the slicer);
  - it sits flat on the bed;
  - nothing underneath leans more than 45 degrees from vertical over an area that would sag. An area counts only if it is at least 20 mm² and reaches more than 5 mm from a wall that holds it up, so small holes and short bridges pass. A wall that hangs from another overhang only holds with what is left of that overhang's 5 mm, so steps that each reach out a little cannot add up to a flat overhang. An area with nothing holding it up, such as the bottom of a piece floating in the air, fails at any size.

  The box beside the part says "Ready to print" or names what to fix, the viewer marks where it would sag, and "What we checked" lists every check with a word and an icon. The details are in [checks/](checks/).
- **Fix it for me.** Sends our own instruction for each failed check (never model text) to Gemini as a change of the code on screen. The result is a new version, checked again; if it still fails, the page says so and keeps both versions. On a built-in example, the fix becomes a new part of your own. "Print with supports instead" is remembered on that version: the box then says to turn on supports in your slicer and the viewer keeps marking where they go. The site does not add supports itself yet.
- **No key needed for the examples.** Three built-in parts (phone stand, wall hook, cable clip) open without a key.
- **Tests, type checks and a build** run on every push, with a deploy to GitHub Pages from `main`.

The Gemini engine uses **your own free Gemini key**. It stays in your browser: in memory by default, or on your device only if you tick "Remember on this device". It is sent only to Google, in a request header. Parts you make are kept in the browser tab that made them. Gemini's output is shown to you only; it is never used to train the GKod model.

Not built yet: the fine-tuned model and the slicer. The print checks do not yet look at wall thickness or compare the sizes with your words, and the size check measures the part as it is placed, without trying to turn it on the bed. Everything under "How it will work" below is the plan, not the current state.

Four feasibility tests were done before the build started. Their code and measured results are in [spikes/](spikes/).

## Run it locally

Needs Node 22.18 or later.

```sh
npm ci
npm run fetch:openscad   # downloads the pinned OpenSCAD web build (about 3.4 MB) and checks its sha256
npm run dev
```

Other commands: `npm test`, `npm run typecheck`, `npm run build`, and `npm run licenses` to rebuild the third-party licence texts the site ships.

Deploying needs one manual step first: in the repository settings, set Pages > Build and deployment > Source to "GitHub Actions". After that, the Pages workflow publishes every push to `main`.

## What makes it different

Most "text to 3D" tools return a fixed mesh. If the hole is 2 mm too small, you start again.

GKod returns **OpenSCAD code with named sizes**. Saying "make it 10 mm wider" changes one number, and nothing else moves. The same code can be re-opened and edited later.

## How it will work

1. **You describe the part.** Words, a sketch or a photo.
2. **A model writes OpenSCAD.** You choose the engine:
   - **GKod model**: a small open model, fine-tuned for this job on a laptop.
   - **Your own Gemini key**: kept in your browser, never stored on a server.
3. **The code compiles in the browser** and appears in a 3D viewer. You change it by typing, or with sliders.
4. **Print checks run on the shape**: closed shape, flat base, overhangs, fits the bed.
5. **The built-in slicer** produces the printer file, with suggested settings you can accept or ignore.

## The fine-tuned model

- **No model-written training examples.** A seeded generator builds every training part: it picks the features and sizes, writes the code, compiles it, and keeps only parts that pass the print checks. The request text for each part is put together by the same program.
- **Training runs on a MacBook** (M4, 16 GB) with LoRA.
- **Results will be measured, not claimed.** The same held-out prompts go to the untrained model, the fine-tuned model and Gemini, scored by code: does it compile, does it pass the print checks, are the sizes right. The numbers will be published here, including the ones that are not flattering.

## Built on

| Piece | Project | Licence | State |
|---|---|---|---|
| Part code | [OpenSCAD](https://openscad.org) compiled to WebAssembly | GPL-2.0-or-later | In use |
| Engine option | [Gemini API](https://ai.google.dev/gemini-api/docs/interactions-overview), called with the visitor's own key | Google's API terms | In use |
| 3D viewer | [three.js](https://threejs.org) with [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | In use |
| Slicer | [Kiri:Moto](https://github.com/GridSpace/grid-apps) | MIT | Planned |
| Training | [MLX LM](https://github.com/ml-explore/mlx-lm) | MIT | Planned |

The print checks are our own code, in [checks/](checks/). The pieces that are in the site today are listed, with exact versions and source links, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Limits

- Practical parts first: brackets, hooks, stands, boxes, clips. Moving parts such as hinges and threads come later.
- The built-in slicer gives a good first result. Its time and filament numbers will not exactly match a desktop slicer.

## Licence

GKod is licensed under GPL-3.0-or-later; the text is in [LICENSE](LICENSE). It uses this licence because the site ships a compiled copy of OpenSCAD, which is GPL software. Third-party software and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and on the site's Notices page.
