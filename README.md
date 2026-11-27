# GKod

Describe a part in words, a sketch or a photo. GKod writes it as editable code, shows it in 3D, checks that it will print, and slices it for your printer, all in the browser.

The name is a short form of G-code, the file a 3D printer runs.

## Status

Build day 4 (26 November 2026). This section is updated as each piece lands.

What works today:

- **Make a part from words.** Type a request, such as "Phone stand, 80 mm wide", and Gemini writes it as OpenSCAD code with named sizes. If the code does not compile, the compiler's error goes back once for a fix.
- **Photo or sketch.** Add a picture to the request. It is shrunk in the browser before it is sent.
- **Change it by typing.** "Make it 10 mm wider" sends the current code back and makes a new version. Every version is listed, with the model that wrote it. Undo and Redo (or Ctrl+Z and Shift+Ctrl+Z) move between them.
- **Sizes.** A slider and a number box for each named size. The part recompiles as you change them.
- **On your device.** The code compiles in a Web Worker (10 second limit) and is shown in a 3D viewer that works with the mouse or the keyboard. The STL file can be downloaded.
- **Print checks.** After every compile, four checks run on the mesh in the same worker. They take about a millisecond for the examples and about 70 ms for a 160,000-triangle part:
  - the surface is closed, with no holes;
  - it fits the bed of the printer chosen in the Print panel (the Anycubic Kobra 2 Neo, 220 x 220 x 250 mm, until you choose another);
  - it sits flat on the bed;
  - nothing underneath leans more than 45 degrees from vertical over an area that would sag. An area counts only if it is at least 20 mm² and reaches more than 5 mm from a wall that holds it up, so small holes and short bridges pass. A wall that hangs from another overhang only holds with what is left of that overhang's 5 mm, so steps that each reach out a little cannot add up to a flat overhang. An area with nothing holding it up, such as the bottom of a piece floating in the air, fails at any size.

  The box beside the part says "Ready to print" or names what to fix, the viewer marks where it would sag, and "What we checked" lists every check with a word and an icon. The details are in [checks/](checks/).
- **Fix it for me.** Sends our own instruction for each failed check (never model text) to Gemini as a change of the code on screen. The result is a new version, checked again; if it still fails, the page says so and keeps both versions. On a built-in example, the fix becomes a new part of your own. "Print with supports instead" is remembered on that version and is the same choice as "Print with supports" in the Print panel: the part is then sliced with supports, and the viewer keeps marking where they go.
- **Slice for your printer, in the browser.** The Print panel under the status box slices the part with the [Kiri:Moto](https://github.com/GridSpace/grid-apps) engine in a Web Worker (2 minute limit, with Stop) and offers the G-code file. Nothing is sent to a server.
  - Printers: Anycubic Kobra 2 Neo (the default), Anycubic Kobra 2, Creality Ender-3 V2, Creality Ender-3 S1 Plus, and "Other printer, 220 x 220 mm, Marlin". Bed sizes come from the makers' own firmware source. Start and end code come from Anycubic Slicer Next or Cura for that printer. Bambu Lab and Prusa printers are not offered: their makers' start code moves outside the bed or saves settings, which the safety check refuses.
  - Settings come from our code only, never from a model: PLA at 205 °C nozzle and 60 °C bed, Normal (0.2 mm layers) or Fine (0.12 mm), infill 10, 15, 20 or 30 %, supports on or off.
  - The print time is the slicer's estimate and is labelled so; at our deliberately slow speeds it runs long. Filament is shown in metres. Grams are not shown, because the flow is not calibrated yet.
  - **Every G-code file is checked before it can be downloaded:** every move inside the bed and above zero height, homing before the first move, no move across the bed or filament pushed before the position is known again after homing, temperatures inside the PLA ranges (heater lines may only use S, R and T0, so no presets or automatic temperature), only commands on an allow-list (nothing that saves settings or changes firmware), the extruder mode stated before the first extrusion, filament that matches the total the slicer states, and the part fan at half speed or more by layer 3. Lines are read the way Marlin reads them from an SD card: a lone carriage return ends a line, and control characters, non-ASCII text before a comment, numbers with exponents and lines over 95 characters fail. A file that fails is not offered.
  - No skirt is drawn (as in Anycubic's own Kobra 2 Neo profile), and the print checks measure a part against the space the slicer can use: the bed, less the room above the part for the nozzle to lift at the end. So a part that "fits your printer" is never refused by the slicer.
  - **Not yet proven by a real print.** The first real print, a 20 mm test cube on the owner's Kobra 2 Neo, is still to be measured.
- **No key needed for the examples.** Four built-in parts (phone stand, wall hook, cable clip and a 20 mm test cube) open without a key.
- **Tests, type checks and a build** run on every push, with a deploy to GitHub Pages from `main`. CI and the deploy also slice the examples, a cube, and a bar and a column as large as the print checks allow for every printer in the picker and check each file, and one Playwright test opens the test cube on the built site, slices it for the Kobra 2 Neo, downloads the file and checks it.

The Gemini engine uses **your own free Gemini key**. It stays in your browser: in memory by default, or on your device only if you tick "Remember on this device". It is sent only to Google, in a request header. Parts you make are kept in the browser tab that made them. Gemini's output is shown to you only; it is never used to train the GKod model.

Not built yet: the fine-tuned model. The slicer has no layer preview yet. The print checks do not yet look at wall thickness or compare the sizes with your words, and the size check measures the part as it is placed, without trying to turn it on the bed. Everything under "How it will work" below is the plan, not the current state.

Four feasibility tests were done before the build started. Their code and measured results are in [spikes/](spikes/).

## Run it locally

Needs Node 22.18 or later.

```sh
npm ci
npm run fetch:openscad   # downloads the pinned OpenSCAD web build (about 3.4 MB) and checks its sha256
npm run fetch:kiri       # builds the Kiri:Moto engine from a pinned source commit (checks its sha256) into app/public/kiri/
npm run dev
```

Other commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run e2e` (after a build), `npm run slice:printers` to slice the examples for every printer and check each file, `npm run check:gcode <file>` to check a G-code file, and `npm run licenses` to rebuild the third-party licence texts the site ships.

`npm test`, `npm run e2e` and `npm run slice:printers` run in Google Chrome, so Chrome must be installed (or run `npx playwright install chrome`).

Deploying needs one manual step first: in the repository settings, set Pages > Build and deployment > Source to "GitHub Actions". After that, the Pages workflow publishes every push to `main`.

## Use GKod's tools from an MCP client

The `mcp/` folder holds a small Python server that lets an MCP client compile parts, run the print checks and look at each part as a picture, with the same compiler and checks as the site. How to set it up and register it is in [mcp/README.md](mcp/README.md). The `gkod` command it calls also works on its own; see [tools/](tools/README.md).

## Backend

The `api/` folder holds the backend: a FastAPI service in front of the parts library, a PostgreSQL 17 database with pgvector that holds the parts the generator makes, with their code, requests and print-check results. It runs locally with Docker Compose, on 127.0.0.1 only:

```sh
npm run api:up                      # copies .env.example to .env if needed, then docker compose up
curl http://127.0.0.1:8000/health
npm run api:down
```

Today it loads the generator's `parts.jsonl` files (refusing any row that does not name the generator, version and commit that made it) and answers `/health`, `/parts`, `/parts/{id}` and `/stats`. Embeddings and search come on day 8, and the local model behind the API on day 9. How to load parts, the endpoints and the tests are in [api/README.md](api/README.md).

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

- **No model-written training examples.** A seeded generator builds every training part: it picks the features and sizes, writes the code, compiles it and runs the print checks on it. The request text for each part is put together by the same program, from short word lists. Every row records the generator commit and seed. How it works is in [datagen/](datagen/README.md).
- **Training runs on a MacBook** (M4, 16 GB) with LoRA.
- **Results will be measured, not claimed.** The same held-out prompts go to the untrained model, the fine-tuned model and Gemini, scored by code: does it compile, does it pass the print checks, are the sizes right. The numbers will be published here, including the ones that are not flattering.

## Built on

| Piece | Project | Licence | State |
|---|---|---|---|
| Part code | [OpenSCAD](https://openscad.org) compiled to WebAssembly | GPL-2.0-or-later | In use |
| Engine option | [Gemini API](https://ai.google.dev/gemini-api/docs/interactions-overview), called with the visitor's own key | Google's API terms | In use |
| 3D viewer | [three.js](https://threejs.org) with [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | In use |
| Slicer | [Kiri:Moto](https://github.com/GridSpace/grid-apps) engine, built from a pinned commit | MIT | In use |
| Training | [MLX LM](https://github.com/ml-explore/mlx-lm) | MIT | Planned |

The print checks are our own code, in [checks/](checks/). The pieces that are in the site today are listed, with exact versions and source links, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Limits

- Practical parts first: brackets, hooks, stands, boxes, clips. Moving parts such as hinges and threads come later.
- The built-in slicer gives a good first result. Its time and filament numbers are estimates and will not exactly match a desktop slicer.

## Licence

GKod is licensed under GPL-3.0-or-later; the text is in [LICENSE](LICENSE). It uses this licence because the site ships a compiled copy of OpenSCAD, which is GPL software. Third-party software and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and on the site's Notices page.
