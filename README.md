# Shilp

Describe a part in words, a sketch or a photo. Shilp writes it as editable code, shows it in 3D, checks that it will print, and slices it for your printer, all in the browser.

"Shilp" is the Hindi word for craft.

## Status

Day 1 (25 November 2026). The repository is set up and the design is decided. Nothing runs yet. This section is updated as each piece lands.

## What makes it different

Most "text to 3D" tools return a fixed mesh. If the hole is 2 mm too small, you start again.

Shilp returns **OpenSCAD code with named sizes**. Saying "make it 10 mm wider" changes one number, and nothing else moves. The same code can be re-opened and edited later.

## How it will work

1. **You describe the part.** Words, a sketch or a photo.
2. **A model writes OpenSCAD.** You choose the engine:
   - **Shilp model**: a small open model, fine-tuned for this job on a laptop.
   - **Your own Gemini key**: kept in your browser, never stored on a server.
3. **The code compiles in the browser** and appears in a 3D viewer. You change it by typing, or with sliders.
4. **Print checks run on the shape**: watertight, wall thickness, overhangs, fits the bed.
5. **The built-in slicer** produces the printer file, with suggested settings you can accept or ignore.

## The fine-tuned model

- **Training data is made by a program, not by another AI.** A generator builds parts from parametric templates, compiles each one, and keeps only those that pass the print checks. No output from Gemini, GPT or Claude is used for training.
- **Training runs on a MacBook** (M4, 16 GB) with LoRA.
- **Results will be measured, not claimed.** The same held-out prompts go to the untrained model, the fine-tuned model and Gemini, scored by code: does it compile, does it pass the print checks, are the sizes right. The numbers will be published here, including the ones that are not flattering.

## Built on

| Piece | Project | Licence |
|---|---|---|
| Part code | [OpenSCAD](https://openscad.org) compiled to WebAssembly | GPL-2.0-or-later |
| 3D viewer | [three.js](https://threejs.org) | MIT |
| Print checks | [trimesh](https://trimesh.org), [Manifold](https://github.com/elalish/manifold) | MIT, Apache-2.0 |
| Slicer | [Kiri:Moto](https://github.com/GridSpace/grid-apps) | MIT |
| Training | [MLX LM](https://github.com/ml-explore/mlx-lm) | MIT |

## Limits

- Practical parts first: brackets, hooks, stands, boxes, clips. Moving parts such as hinges and threads come later.
- The built-in slicer gives a good first result. Its time and filament numbers will not exactly match a desktop slicer.
