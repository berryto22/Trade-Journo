import {cp, mkdir} from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
await mkdir(output, {recursive:true});
for (const item of ['index.html', 'sw.js', 'css', 'js']) {
  await cp(new URL(`../${item}`, import.meta.url), new URL(`../dist/${item}`, import.meta.url), {recursive:true, force:true});
}
console.log('Static site packaged in dist/');
