# GKod

Describe a part in words, a sketch or a photo. GKod writes it as editable code, shows it in 3D, checks that it will print, and slices it for your printer, all in the browser.

The name is a short form of G-code, the file a 3D printer runs.

## Status

Build day 1 (26 November 2026). This section is updated as each piece lands.

What works today:

- The site opens with three example parts (phone stand, wall hook, cable clip), each written as OpenSCAD code with named sizes.
- The code compiles to a 3D shape in your browser, in a Web Worker, with a 10 second limit per compile.
- A 3D viewer that turns with the mouse or the keyboard, with a text summary of the part's size.
- A slider and a number box for each named size. The part recompiles as you change them, and the code shown changes with it.
- The STL file can be downloaded.
- Tests, type checks and a build run on every push, with a deploy to GitHub Pages from `main`.

Not built yet: making a part from a description, the fine-tuned model, the print checks and the slicer. Everything under "How it will work" below is the plan, not the current state.

Four feasibility tests were done before the build started. Their code and measured results are in [spikes/](spikes/).

## Run it locally

Needs Node 22.

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
| 3D viewer | [three.js](https://threejs.org) with [react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | In use |
| Slicer | [Kiri:Moto](https://github.com/GridSpace/grid-apps) | MIT | Planned |
| Training | [MLX LM](https://github.com/ml-explore/mlx-lm) | MIT | Planned |

The print checks will be our own code. The pieces that are in the site today are listed, with exact versions and source links, in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Limits

- Practical parts first: brackets, hooks, stands, boxes, clips. Moving parts such as hinges and threads come later.
- The built-in slicer gives a good first result. Its time and filament numbers will not exactly match a desktop slicer.

## Licence

GKod is licensed under GPL-3.0-or-later; the text is in [LICENSE](LICENSE). It uses this licence because the site ships a compiled copy of OpenSCAD, which is GPL software. Third-party software and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and on the site's Notices page.
