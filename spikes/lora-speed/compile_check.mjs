// Compile OpenSCAD code with the OpenSCAD WebAssembly build and report pass/fail.
//
//   node compile_check.mjs data/train.jsonl --sample 70      (dataset answers)
//   node compile_check.mjs outputs/gen_small_base.jsonl      (model outputs)
//
// A row passes when OpenSCAD exits 0 and writes a non-empty STL.
import { createOpenSCAD } from "openscad-wasm";
import fs from "node:fs";

const file = process.argv[2];
const sampleAt = process.argv.indexOf("--sample");
const sample = sampleAt > 0 ? Number(process.argv[sampleAt + 1]) : 0;

function codeOf(row) {
  let text = row.code ?? row.output ?? row.messages?.at(-1)?.content ?? "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const fence = text.match(/```(?:openscad|scad)?\s*\n([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

let rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
if (sample && sample < rows.length) {
  const step = rows.length / sample;
  rows = Array.from({ length: sample }, (_, i) => rows[Math.floor(i * step)]);
}

let pass = 0;
const results = [];
for (const [i, row] of rows.entries()) {
  const code = codeOf(row);
  const log = [];
  let ok = false, bytes = 0, facets = 0;
  const t0 = performance.now();
  try {
    // a fresh instance per part: the wasm module cannot run main twice
    const scad = await createOpenSCAD({ print: () => {}, printErr: (s) => log.push(s) });
    const inst = scad.getInstance();
    inst.FS.writeFile("/in.scad", code);
    const rc = inst.callMain(["/in.scad", "-o", "/out.stl"]);
    if (rc === 0) {
      const stl = inst.FS.readFile("/out.stl", { encoding: "utf8" });
      bytes = stl.length;
      facets = (stl.match(/facet normal/g) || []).length;
      ok = facets > 0;
    }
  } catch (e) {
    log.push(String(e));
  }
  const ms = Math.round(performance.now() - t0);
  if (ok) pass++;
  const errs = log.filter((l) => /error|warning/i.test(l)).slice(0, 3);
  results.push({ i, label: row.label ?? row.kind ?? "", ok, facets, ms, errs });
  console.log(`${ok ? "PASS" : "FAIL"} #${i} ${row.label ?? ""} facets=${facets} ${ms}ms ${ok ? "" : errs.join(" | ")}`);
}
console.log(`\n${pass}/${rows.length} compiled to a non-empty STL  (${file})`);
