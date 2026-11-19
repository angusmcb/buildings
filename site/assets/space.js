export function createSpaceClient(base, getToken, clearAccount = () => {}) {
  const url = new URL(base);
  async function request(path, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(new URL(path, url), {...options, headers, redirect: 'error'});
    if (!response.ok) {
      if (token && response.status === 401) {
        clearAccount();
        throw new Error('Your Hugging Face session was rejected. Please log in again.');
      }
      const detail = await response.json().catch(() => null);
      const message = typeof detail?.detail === 'string' ? detail.detail : '';
      throw new Error(message || 'The inference service returned HTTP ' + response.status + '.');
    }
    return response;
  }

  async function stage(config, name, data, session, progress) {
    const endpoint = config.dependencies.find(item => item.api_name === name);
    if (!endpoint) throw new Error('The inference service is updating. Please try again shortly.');
    const joined = await request('gradio_api/queue/join', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({data, fn_index: endpoint.id, session_hash: session, trigger_id: null}),
      signal: AbortSignal.timeout(30_000)
    });
    const {event_id: eventId} = await joined.json();
    const response = await request('gradio_api/queue/data?' + new URLSearchParams({session_hash: session}), {
      signal: AbortSignal.timeout(20 * 60_000)
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) throw new Error('The inference connection closed. Please try again.');
        buffer += value;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!frame.startsWith('data: ')) continue;
          const message = JSON.parse(frame.slice(6));
          if (message.msg === 'unexpected_error') throw new Error('The inference service encountered an error.');
          if (message.event_id !== eventId) continue;
          if (message.msg === 'estimation' && message.rank > 0) progress('In queue…');
          if (message.msg === 'progress') {
            const description = message.progress_data?.find(item => item.desc)?.desc;
            if (description) progress(description);
          }
          if (message.msg !== 'process_completed') continue;
          if (!message.success) throw new Error(message.output?.error || 'The inference service could not complete this run.');
          return message.output.data;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  return async (selection, render, progress) => {
    const config = await (await request('config', {signal: AbortSignal.timeout(30_000)})).json();
    const session = crypto.randomUUID().replaceAll('-', '');
    const [, preview] = await stage(config, 'prepare_selection_v1', [selection], session, progress);
    if (preview?.state !== 'mapping') throw new Error('The service did not return an imagery preview.');
    render(preview);
    await stage(config, 'infer_v1', [null], session, progress);
    progress('Writing exports…');
    const [, result] = await stage(config, 'finish_v1', [null, null], session, progress);
    if (result?.state !== 'ready') throw new Error('The service did not return a map result.');
    render(result);
  };
}
