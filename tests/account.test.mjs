import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccount} from '../site/assets/account.js';
import {createSpaceClient} from '../site/assets/space.js';

test('restores the same token across reloads and clears rejected sessions', async t => {
  const values = new Map();
  // These browser globals are absent in Node.
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  globalThis.location = {href: 'https://tracker.example/?code=test&state=state'};
  globalThis.history = {replaceState() {}};
  t.after(() => {
    delete globalThis.sessionStorage;
    delete globalThis.location;
    delete globalThis.history;
  });
  values.set('settlement-tracker-oauth', JSON.stringify({state: 'state', verifier: 'verifier', search: ''}));
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('/token')) return Response.json({access_token: 'test-token', expires_in: 3600});
    return Response.json({preferred_username: 'example'});
  });
  const account = createAccount('client', 'https://tracker.example/');
  await account.completeSignIn();
  assert.equal(account.username, 'example');
  const restored = createAccount('client', 'https://tracker.example/');
  assert.equal(restored.getToken(), 'test-token');
  await restored.validate();
  globalThis.fetch.mock.mockImplementation(async () => new Response(null, {status: 401}));
  await assert.rejects(restored.validate(), /expired/);
  assert.equal(restored.username, null);
  assert.equal(createAccount('client', 'https://tracker.example/').getToken(), null);

  values.set('settlement-tracker-session:client', JSON.stringify({
    token: 'expired', username: 'example', expiresAt: Date.now() - 1,
  }));
  assert.equal(createAccount('client', 'https://tracker.example/').username, null);
});

test('clears a rejected Space token and stops the comparison', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 401}));
  let cleared = false;
  const submit = createSpaceClient('https://space.example/', () => 'token', () => {cleared = true;});
  await assert.rejects(submit({}, () => {}, () => {}), /log in again/);
  assert.equal(cleared, true);
});
