import {createAccount} from './account.js';
import {mountMap} from './map.js';
import {createSpaceClient} from './space.js';

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Could not load map configuration.');
  return response.json();
}

async function start() {
  const [config, coverage, light, dark] = await Promise.all([
    loadJson('config.json'), loadJson('coverage.geojson'), loadJson('context-light.json'), loadJson('context-dark.json')
  ]);
  const redirect = new URL('../', import.meta.url).href;
  const account = createAccount(config.oauthClientId, redirect);
  let accountError;
  try {
    await account.completeSignIn();
  } catch (error) {
    accountError = error.message;
  }
  mountMap(document.body, {...config, coverage, map_styles: {light, dark}},
    account, createSpaceClient(config.space, account.getToken), accountError);
}

start().catch(error => {
  const status = document.querySelector('.selection-hint');
  status.textContent = error.message || 'The map could not load. Please reload the page.';
  status.hidden = false;
});
