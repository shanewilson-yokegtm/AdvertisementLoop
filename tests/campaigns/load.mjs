import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname,'../..');
const require = createRequire(import.meta.url); const cache = new Map();
export function load(file) {
  file = path.resolve(root,file); if (cache.has(file)) return cache.get(file).exports;
  const module={exports:{}}; cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(id=>{
    if (!id.startsWith('.')&&!id.startsWith('@/')) return require(id);
    const target=id.startsWith('@/')?path.resolve(root,'src',id.slice(2)):path.resolve(path.dirname(file),id);
    for(const name of [target+'.ts',target+'.tsx',target+'.js'])if(existsSync(name))return load(name);
    return require(target);
  },module,module.exports); return module.exports;
}
