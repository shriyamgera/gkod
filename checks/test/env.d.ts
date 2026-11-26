// Binary test files, imported as data URLs so the same test reads them in Node and in the browser.
declare module '*.stl?inline' {
  const dataUrl: string;
  export default dataUrl;
}

declare module '*.scad?raw' {
  const source: string;
  export default source;
}
