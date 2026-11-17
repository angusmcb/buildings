import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';

const site = new URL('../site/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const read = path => readFile(new URL(path, site), 'utf8');
const readJson = async name => JSON.parse(await read('assets/' + name));

const [template, config, coverage, light, dark, css, entry, ...modules] = await Promise.all([
  read('index.html'),
  readJson('config.json'),
  readJson('coverage.geojson'),
  readJson('context-light.json'),
  readJson('context-dark.json'),
  read('assets/map.css'),
  read('assets/main.js'),
  read('assets/account.js'),
  read('assets/map.js'),
  read('assets/space.js'),
]);

// Keep the data editable as JSON and ship it in the initial HTML response.
const bootstrap = JSON.stringify({...config, coverage, map_styles: {light, dark}})
  .replaceAll('<', '\\u003c');
// These three modules have no dependencies of their own. Their exports are
// in scope in the inline module, so remove the corresponding entry imports.
const startup = entry
  .replace("import {createAccount} from './account.js';\n", '')
  .replace("import {mountMap} from './map.js';\n", '')
  .replace("import {createSpaceClient} from './space.js';\n", '');
const script = [...modules, startup].join('\n');
if (/^\s*import\s/m.test(script)) {
  throw new Error('Update the inline build to include the new module imports.');
}
if (/<\/script\b/i.test(script) || /<\/style\b/i.test(css)) {
  throw new Error('Inline assets contain an HTML closing tag.');
}

await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});
await writeFile(new URL('index.html', dist), template
  .replace('<!-- map-bootstrap -->', () => '<script type="application/json" id="map-bootstrap">' + bootstrap + '</script>')
  .replace('<link rel="stylesheet" href="./assets/map.css">', () => '<style>\n' + css + '</style>')
  .replace('<script type="module" src="./assets/main.js"></script>', () => '<script type="module">\n' + script + '</script>'));
