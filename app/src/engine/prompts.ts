import type { EngineRequest } from './types';

export const SYSTEM_INSTRUCTION = `You write OpenSCAD code for parts that are 3D printed on a home FDM printer.

Answer with one OpenSCAD code block and nothing else: no words before or after it.

Rules for the code:
- Units are millimetres.
- Put every size at the top of the file as a named number, before any module or function. Above each size, write a short comment line that says what it is and its unit. After the number, write a range comment that the slider uses. For example:
  // Stand width (mm)
  width = 80; // [40:1:160]
- Pick each range so the part stays printable, with the value inside the range.
- Values that should not be changed go after the sizes, under a line /* [Hidden] */.
- The part sits flat on the print bed: its base is flat on z = 0 and nothing goes below z = 0.
- Make it printable without supports where possible: no overhangs steeper than 45 degrees and no floating pieces.
- Walls and other thin features are at least 1.2 mm thick.
- Make one solid piece unless the request asks for more.
- Do not use minkowski(). Use hull() instead.
- Do not use text().
- Do not use import(), include or use. The code must not read any other file.
- Set $fn for round shapes, for example $fn = 64;.
- The code must run with no warnings: define every name before it is used and never mix 2D and 3D shapes in one object.
- Keep the code under 150 lines.`;

const fence = (code: string) => `\`\`\`openscad\n${code.trim()}\n\`\`\``;

function createText(prompt: string, hasImage: boolean): string {
  const request = prompt.trim();
  if (!hasImage) return `Make this part: ${request}`;
  const lines = [
    'A photo or sketch of the object is attached.',
    'Model the object in it. Estimate its sizes from the picture and from any sizes given in the request.',
    'Answer with the code only and say nothing else.',
  ];
  return request ? `Make this part: ${request}\n\n${lines.join('\n')}` : lines.join('\n');
}

function editText(instruction: string, code: string): string {
  return [
    'Here is the current OpenSCAD code for the part:',
    fence(code),
    `Change it like this: ${instruction.trim()}`,
    'Change only what is asked. Keep every other size, its name, its value and its comment line the same.',
    'Keep the sizes at the top in the same format. If a size changes and its new value falls outside its range, widen the range.',
    'Answer with the whole updated code in one code block.',
  ].join('\n\n');
}

function repairText(code: string, error: string, request: string): string {
  return [
    `This OpenSCAD code was written for the request "${request.trim()}", but it does not work. The compiler said:`,
    error.trim(),
    fence(code),
    'Fix the code so it compiles with no errors or warnings.',
    'Keep the sizes, their names and their values the same where you can.',
    'Answer with the whole fixed code in one code block.',
  ].join('\n\n');
}

// The words sent with each request. A picture, if any, is added by the engine.
export function userText(req: EngineRequest): string {
  switch (req.kind) {
    case 'create':
      return createText(req.prompt, Boolean(req.image));
    case 'edit':
      return editText(req.instruction, req.code);
    case 'repair':
      return repairText(req.code, req.error, req.request);
  }
}
