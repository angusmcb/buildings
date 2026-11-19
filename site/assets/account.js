const hub = 'https://huggingface.co';
const pendingKey = 'settlement-tracker-oauth';

function randomString() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function createAccount(clientId, redirectUri) {
  let token = null;
  let expiresAt = 0;
  let username = null;
  const sessionKey = 'settlement-tracker-session:' + clientId;
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    if (typeof saved?.token === 'string' && typeof saved.username === 'string' &&
        Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()) {
      ({token, expiresAt, username} = saved);
    } else {
      sessionStorage.removeItem(sessionKey);
    }
  } catch { /* Sign-in still works when browser storage is unavailable. */ }

  function clear() {
    token = null;
    expiresAt = 0;
    username = null;
    try { sessionStorage.removeItem(sessionKey); } catch {}
  }

  async function signIn(returnUrl) {
    const verifier = randomString();
    const state = randomString();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    sessionStorage.setItem(pendingKey, JSON.stringify({state, verifier, search: returnUrl.search}));
    location.assign(hub + '/oauth/authorize?' + new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile',
      state, code_challenge: challenge, code_challenge_method: 'S256'
    }));
  }

  async function completeSignIn() {
    const callback = new URL(location.href);
    const params = callback.searchParams;
    if (!params.has('code') && !params.has('error')) return;
    history.replaceState(null, '', redirectUri);
    const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    sessionStorage.removeItem(pendingKey);
    if (!saved || params.get('state') !== saved.state) throw new Error('Sign-in expired. Please try again.');
    history.replaceState(null, '', redirectUri + saved.search);
    if (params.has('error')) throw new Error('Hugging Face sign-in was cancelled or declined.');
    const response = await fetch(hub + '/oauth/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri,
        code_verifier: saved.verifier, code: params.get('code')
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error('Hugging Face could not complete sign-in. Please try again.');
    const {access_token: accessToken, expires_in: expiresIn} = await response.json();
    const profile = await fetch(hub + '/oauth/userinfo', {
      headers: {Authorization: 'Bearer ' + accessToken},
      signal: AbortSignal.timeout(15_000)
    });
    if (!profile.ok) throw new Error('Hugging Face could not load your profile. Please try again.');
    const {preferred_username: handle} = await profile.json();
    if (!accessToken || !handle) throw new Error('Hugging Face did not return an account profile.');
    token = accessToken;
    expiresAt = Date.now() + Number(expiresIn || 3600) * 1000;
    username = handle;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({token, expiresAt, username})); } catch {}
  }

  function getToken() {
    if (token && Date.now() >= expiresAt) clear();
    return token;
  }

  async function validate() {
    const wasSignedIn = Boolean(token);
    const accessToken = getToken();
    if (!accessToken) {
      if (wasSignedIn) throw new Error('Your Hugging Face session expired. Please log in again.');
      return;
    }
    const response = await fetch(hub + '/oauth/userinfo', {
      headers: {Authorization: 'Bearer ' + accessToken},
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      clear();
      throw new Error('Your Hugging Face session expired. Please log in again.');
    }
    if (!response.ok) throw new Error('Could not check your Hugging Face session. Please try again.');
    const profile = await response.json();
    if (profile.preferred_username !== username) {
      clear();
      throw new Error('Your Hugging Face account changed. Please log in again.');
    }
  }

  return {
    signIn, completeSignIn, clear, getToken, validate,
    get username() { return getToken() ? username : null; }
  };
}
