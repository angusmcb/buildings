import {createAccount} from './account.js';
import {mountMap} from './map.js';
import {createSpaceClient} from './space.js';

async function start() {
  const config = JSON.parse(document.querySelector('#map-bootstrap').textContent);
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
