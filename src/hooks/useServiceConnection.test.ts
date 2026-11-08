import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadProxySubscription } from '../utils/subscription.ts';

type Request = { signal: AbortSignal; timeout: number; params?: { format: string }; responseType?: string };
type Effect = () => (() => void) | undefined;
// Execute the real hook with controlled state/effect scheduling. Actual React
// rendering and input behavior are verified separately in the browser fixture.
function connectionFixture(get: (path: string, request: Request) => Promise<{ data: unknown }>) {
  const states: unknown[] = [];
  let cursor = 0, previous: unknown[] = [], next: { effect: Effect; dependencies: unknown[] } | undefined;
  let cleanup: (() => void) | undefined;
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(effect: Effect, dependencies: unknown[]) {
      if (dependencies.length !== previous.length || dependencies.some((value, index) => !Object.is(value, previous[index]))) next = { effect, dependencies };
    },
  };
  const source = readFileSync(new URL('./useServiceConnection.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: unknown[]) => any> = {};
  runInNewContext(code, { exports, AbortController, require: (name: string) => {
    if (name === 'react') return hooks;
    if (name === '../api/client') return { api: { get } };
    if (name === '../config') return { config: { PROXY_STORAGE_PREFIX: undefined, VPN_STORAGE_PREFIX: undefined } };
    if (name === '../utils/subscription') return { loadProxySubscription };
    throw new Error(`Unexpected hook dependency: ${name}`);
  } });
  return {
    render(id = 42, category = 'proxy', status = 'ACTIVE') { cursor = 0; return exports.useServiceConnection(id, category, status); },
    flushEffects() { if (next) { cleanup?.(); previous = next.dependencies; cleanup = next.effect(); next = undefined; } },
    unmount() { cleanup?.(); },
  };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const subscription = (id: number) => ({ data: { subscription_url: `https://sub.example.test/${id}` } });

test('connection reads are bounded and carry cancellation and JSON parameters', async () => {
  const calls: Array<{ path: string; request: Request }> = [];
  const hook = connectionFixture(async (path, request) => { calls.push({ path, request }); return subscription(42); });
  assert.equal(hook.render().loading, true); hook.flushEffects(); await tick();
  assert.equal(hook.render().loading, false);
  assert.equal(hook.render().subscription.url, 'https://sub.example.test/42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/storage/manage/vpn_remna_42');
  assert.equal(calls[0].request.timeout, 10_000);
  assert.equal(calls[0].request.params?.format, 'json');
  hook.unmount(); assert.equal(calls[0].request.signal.aborted, true);
});

test('a timed-out connection ends loading and an explicit refresh can succeed', async () => {
  let fail = true;
  const hook = connectionFixture(async () => { if (fail) throw { code: 'ECONNABORTED' }; return subscription(42); });
  hook.render(); hook.flushEffects(); await tick();
  assert.equal(hook.render().loading, false); assert.equal(hook.render().failed, true);
  fail = false; hook.render().reload();
  assert.equal(hook.render().loading, true); assert.equal(hook.render().subscription, null);
  hook.flushEffects(); await tick();
  assert.equal(hook.render().failed, false); assert.equal(hook.render().subscription.url, 'https://sub.example.test/42');
  hook.unmount();
});

test('service switches hide old data before effects and late old responses cannot replace the new service', async () => {
  const requests: Array<{ request: Request; finish: (value: { data: unknown }) => void }> = [];
  const hook = connectionFixture(async (_path, request) => new Promise(resolve => requests.push({ request, finish: resolve })));
  hook.render(42); hook.flushEffects();
  const newFrame = hook.render(43); assert.equal(newFrame.subscription, null); assert.equal(newFrame.loading, true);
  hook.flushEffects(); assert.equal(requests[0].request.signal.aborted, true);
  requests[1].finish(subscription(43)); await tick();
  assert.equal(hook.render(43).subscription.url, 'https://sub.example.test/43');
  requests[0].finish(subscription(42)); await tick();
  assert.equal(hook.render(43).subscription.url, 'https://sub.example.test/43');
  hook.unmount();
});

test('VPN configuration uses a bounded text read and clears data after category/status changes', async () => {
  let request!: Request;
  const hook = connectionFixture(async (_path, options) => { request = options; return { data: '[Interface]\nSynthetic only' }; });
  hook.render(42, 'vpn'); hook.flushEffects(); await tick();
  assert.equal(hook.render(42, 'vpn').vpnConfig, '[Interface]\nSynthetic only');
  assert.equal(request.timeout, 10_000); assert.equal(request.responseType, 'text');
  assert.equal(hook.render(42, 'other', 'BLOCK').vpnConfig, null);
  hook.flushEffects(); assert.equal(request.signal.aborted, true); hook.unmount();
});
