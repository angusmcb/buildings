import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const site = new URL('../site/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const dependencies = new URL('../node_modules/', import.meta.url);
const read = path => readFile(new URL(path, site), 'utf8');
const readJson = async name => JSON.parse(await read('assets/' + name));
const readDependency = path => readFile(new URL(path, dependencies), 'utf8');
const withoutSourceMap = source => source.replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, '\n');

function inline(tag, source, attributes = '') {
  if (new RegExp('</' + tag + '\\b', 'i').test(source)) {
    throw new Error('Inline ' + tag + ' contains an HTML closing tag.');
  }
  return '<' + tag + attributes + '>\n' + source + '\n</' + tag + '>';
}

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

const [maplibreCss, maplibre, pmtiles, projection, flooding] = await Promise.all([
  readDependency('maplibre-gl/dist/maplibre-gl.css'),
  readDependency('maplibre-gl/dist/maplibre-gl.js'),
  readDependency('pmtiles/dist/pmtiles.js'),
  readDependency('proj4/dist/proj4.js'),
  readDependency('@geomatico/maplibre-cog-protocol/dist/index.js'),
]);
const optionalScripts = [
  ['projection', 'proj4', withoutSourceMap(projection)],
  ['flooding', 'maplibre-cog-protocol', withoutSourceMap(flooding)],
];
const vendorScripts = {};
const optionalAssets = optionalScripts.map(([key, name, source]) => {
  const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const path = './assets/' + name + '.' + version + '.js';
  vendorScripts[key] = path;
  return [path, source];
});
const licenseNotices = await Promise.all([
  readDependency('maplibre-gl/dist/LICENSE.txt'),
  readFile(new URL('../licenses/pmtiles.txt', import.meta.url), 'utf8'),
  readDependency('fflate/LICENSE'),
  readDependency('proj4/LICENSE.md'),
  readDependency('@geomatico/maplibre-cog-protocol/LICENSE'),
]);

// Keep the data editable as JSON and ship it in the initial HTML response.
const bootstrap = JSON.stringify({...config, coverage, map_styles: {light, dark}, vendor_scripts: vendorScripts})
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

const html = template
  .replace('<!-- map-bootstrap -->', () => '<script type="application/json" id="map-bootstrap">' + bootstrap + '</script>')
  .replace('<link rel="stylesheet" href="./assets/map.css">', () => inline('style', maplibreCss + '\n' + css))
  .replace('<script type="module" src="./assets/main.js"></script>', () => [
    inline('script', withoutSourceMap(maplibre)),
    inline('script', withoutSourceMap(pmtiles)),
    inline('script', script, ' type="module"'),
  ].join('\n'));

await rm(dist, {recursive: true, force: true});
await mkdir(new URL('assets/', dist), {recursive: true});
await Promise.all([
  writeFile(new URL('index.html', dist), html),
  writeFile(new URL('third-party-licenses.txt', dist), licenseNotices.join('\n\n')),
  ...optionalAssets.map(([path, source]) => writeFile(new URL(path, dist), source)),
]);
