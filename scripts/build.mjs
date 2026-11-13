import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const site = new URL('../site/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const read = path => readFile(new URL(path, site), 'utf8');
const readJson = async name => JSON.parse(await read('assets/' + name));

const [template, config, coverage, light, dark] = await Promise.all([
  read('index.html'),
  readJson('config.json'),
  readJson('coverage.geojson'),
  readJson('context-light.json'),
  readJson('context-dark.json')
]);

// Keep the data editable as JSON and ship it in the initial HTML response.
const bootstrap = JSON.stringify({...config, coverage, map_styles: {light, dark}})
  .replaceAll('<', '\\u003c');
const scripts = ['account.js', 'map.js', 'space.js'];
const css = await read('assets/map.css');
const version = content => createHash('sha256').update(content).digest('hex').slice(0, 12);
let entry = await read('assets/main.js');
const preloads = [];

await rm(dist, {recursive: true, force: true});
await mkdir(new URL('assets/', dist), {recursive: true});
for (const file of scripts) {
  const source = await read('assets/' + file);
  const name = file.replace('.js', '.' + version(source) + '.js');
  await writeFile(new URL('assets/' + name, dist), source);
  preloads.push('<link rel="modulepreload" href="./assets/' + name + '">');
  entry = entry.replace('./' + file, './' + name);
}
const entryName = 'main.' + version(entry) + '.js';
await writeFile(new URL('assets/' + entryName, dist), entry);
preloads.unshift('<link rel="modulepreload" href="./assets/' + entryName + '">');
const cssName = 'map.' + version(css) + '.css';
await writeFile(new URL('assets/' + cssName, dist), css);
await writeFile(new URL('index.html', dist), template
  .replace('<!-- map-preloads -->', preloads.join('\n  '))
  .replace('<!-- map-bootstrap -->', () => '<script type="application/json" id="map-bootstrap">' + bootstrap + '</script>')
  .replace('./assets/map.css', './assets/' + cssName)
  .replace('./assets/main.js', './assets/' + entryName));
