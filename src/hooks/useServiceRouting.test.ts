import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readRoutingOptions } from '../utils/routing.ts';
import { queuedPollDelay } from '../utils/routingUi.ts';

type Effect = () => (() => void) | undefined;
type EffectSlot = { dependencies: unknown[]; cleanup?: () => void };
function routingFixture(get: (id: number, signal: AbortSignal) => Promise<{ data: unknown }>) {
  const values: unknown[] = [], effects: EffectSlot[] = [];
  let cursor = 0, pending: Array<{ index: number; effect: Effect; dependencies: unknown[] }> = [];
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    },
    useEffect(effect: Effect, dependencies: unknown[]) {
      const index = cursor++, previous = effects[index]?.dependencies;
      if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) pending.push({ index, effect, dependencies });
    },
  };
  const source = readFileSync(new URL('./useServiceRouting.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: unknown[]) => any> = {};
  runInNewContext(code, { exports, AbortController,
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => {
      if (name === 'react') return hooks;
      if (name === '../api/client') return { serviceOptionsApi: { get } };
      if (name === '../utils/routing') return { readRoutingOptions };
      if (name === '../utils/routingUi') return { queuedPollDelay };
      throw new Error(`Unexpected hook dependency: ${name}`);
    },
  });
  return {
    render(id = 42) { cursor = 0; return exports.useServiceRouting(id); },
    flushEffects() {
      const next = pending; pending = [];
      for (const { index, effect, dependencies } of next) {
        effects[index]?.cleanup?.();
        effects[index] = { dependencies, cleanup: effect() };
      }
    },
    timers,
    runTimer() {
      const [id, timer] = timers.entries().next().value || [];
      assert.ok(timer && id !== undefined, 'a queued status schedules a read');
      timers.delete(id); timer.callback();
    },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (status: unknown = 'queued', error?: string) => ({ data: { status: 200, data: [{
  supported: true, feature: 'routing', enabled: true, has_secret: true, data: {}, status, ...(error ? { error } : {}),
}] } });

test('scalar queued status schedules bounded reads and stops polling after a submitted response', async () => {
  let reads = 0;
  const hook = routingFixture(async () => response(++reads === 1 ? 'queued' : 'submitted'));
  assert.equal(hook.render().loading, true); hook.flushEffects(); await tick();
  assert.equal(hook.render().options.status, 'queued'); hook.flushEffects();
  assert.equal([...hook.timers.values()][0].delay, 3000);
  hook.runTimer(); await tick();
  assert.equal(hook.render().options.status, 'submitted'); hook.flushEffects();
  assert.equal(hook.timers.size, 0); assert.equal(reads, 2);
  hook.unmount();
});

test('obsolete status shapes fail controlled reads and cannot replace current state during polling', async () => {
  let reads = 0;
  const hook = routingFixture(async () => {
    reads++;
    if (reads === 1 || reads === 3) return response({ state: 'queued', error: 'do-not-render' });
    return reads === 2 ? response() : response('error', 'SERVICE_OPTIONS_TARGET_CHANGED');
  });
  hook.render(); hook.flushEffects(); await tick();
  assert.equal(hook.render().failed, true); assert.equal(hook.render().options, null);
  hook.render().reload(); hook.render(); hook.flushEffects(); await tick();
  assert.equal(hook.render().options.status, 'queued'); hook.flushEffects();
  hook.runTimer(); await tick();
  assert.equal(hook.render().options.status, 'queued'); hook.flushEffects();
  hook.runTimer(); await tick();
  const current = hook.render(); hook.flushEffects();
  assert.equal(current.options.status, 'error');
  assert.equal(current.options.error, 'SERVICE_OPTIONS_TARGET_CHANGED');
  assert.equal(hook.timers.size, 0); assert.equal(reads, 4);
  hook.unmount();
});
