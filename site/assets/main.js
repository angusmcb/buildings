import {createAccount} from './account.js';
import {prefetchedArchiveSource} from './archive.js';
import {mountMap} from './map.js';
import {createSpaceClient} from './space.js';

async function start() {
  const config = JSON.parse(document.querySelector('#map-bootstrap').textContent);
  const defaultArchive = config.preprocessed_maps[config.default_archive];
  const protocol = new pmtiles.Protocol();
  const source = new pmtiles.FetchSource(defaultArchive.url);
  protocol.add(new pmtiles.PMTiles(prefetchedArchiveSource(source, window.settlementArchivePrefetch)));
  maplibregl.addProtocol('pmtiles', protocol.tile);
  const redirect = new URL('./', location.href).href;
  const account = createAccount(config.oauthClientId, redirect);
  let accountError;
  try {
    await account.completeSignIn();
  } catch (error) {
    accountError = error.message;
  }
  mountMap(document.body, config,
    account, createSpaceClient(config.space, account.getToken), accountError);
}

start().catch(error => {
  const status = document.querySelector('.selection-hint');
  status.textContent = error.message || 'The map could not load. Please reload the page.';
  status.hidden = false;
});
