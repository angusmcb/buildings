import assert from 'node:assert/strict';
import test from 'node:test';
import {createSpaceClient} from '../site/assets/space.js';

const endpointNames = ['prepare_selection_v1', 'infer_v1', 'finish_v1'];

function mockQueue(t, failInference = false) {
  const calls = [];
  let stage;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://space.example');
    assert.equal(options.headers.get('Authorization'), 'Bearer oauth-test');
    if (url.pathname === '/config') {
      return Response.json({dependencies: endpointNames.map((api_name, id) => ({id, api_name}))});
    }
    if (url.pathname.endsWith('/join')) {
      stage = JSON.parse(options.body);
      calls.push(stage);
      return Response.json({event_id: String(stage.fn_index)});
    }
    assert.equal(url.pathname, '/gradio_api/queue/data');
    assert.equal(url.searchParams.get('session_hash'), stage.session_hash);
    const failed = failInference && stage.fn_index === 1;
    const messages = [
      {msg: 'process_completed', event_id: 'unrelated', success: false},
      {msg: 'progress', event_id: String(stage.fn_index), progress_data: [{desc: 'Working'}]},
      {
        msg: 'process_completed', event_id: String(stage.fn_index), success: !failed,
        output: failed ? {error: 'GPU quota exhausted'} : {
          data: [null, [{state: 'mapping'}, null, {state: 'ready'}][stage.fn_index]]
        }
      }
    ];
    const stream = messages.map(message => 'data: ' + JSON.stringify(message) + '\n\n').join('');
    return new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(stream);
        controller.enqueue(bytes.slice(0, 42));
        controller.enqueue(bytes.slice(42));
        controller.close();
      }
    }));
  });
  return calls;
}

test('keeps one authenticated session through preview, inference and exports', async t => {
  const calls = mockQueue(t);
  const submit = createSpaceClient('https://space.example/', () => 'oauth-test');
  const rendered = [];
  const progress = [];
  const selection = {longitude: 31.5825, latitude: 4.8539, area_metres: 2000};

  await submit(selection, value => rendered.push(value.state), message => progress.push(message));

  assert.deepEqual(rendered, ['mapping', 'ready']);
  assert.deepEqual(progress, ['Working', 'Working', 'Writing exports…', 'Working']);
  assert.deepEqual(calls.map(call => call.data), [[selection], [null], [null, null]]);
  assert.equal(new Set(calls.map(call => call.session_hash)).size, 1);
});

test('surfaces a quota failure and skips export generation', async t => {
  const calls = mockQueue(t, true);
  const submit = createSpaceClient('https://space.example/', () => 'oauth-test');
  const rendered = [];
  await assert.rejects(submit({}, value => rendered.push(value.state), () => {}), /GPU quota exhausted/);
  assert.deepEqual(rendered, ['mapping']);
  assert.deepEqual(calls.map(call => call.fn_index), [0, 1]);
});
