import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentChannels } from './payments.ts';

test('payment choices retain SHM order and distinguish channels with the same merchant and label across reads', () => {
  const channel = (profile: string, timestamp: number) => ({
    name: '支付宝', paysystem: 'epay', allow_deletion: 0, internal: 0, recurring: 0,
    shm_url: `/shm/pay_systems/epay.cgi?action=submit&user_id=1&ts=${timestamp}&ps=${profile}&amount=`,
  });
  const first = channel('shop-1', 100);
  const second = channel('shop-2', 100);
  const original = paymentChannels([first, second, first]);
  assert.deepEqual(original.map(item => item.shm_url), [first.shm_url, second.shm_url]);
  const current = channel('shop-2', 101);
  const savedCard = { ...current, allow_deletion: 1 };
  const reloaded = paymentChannels([channel('shop-1', 101), current, savedCard]);
  assert.equal(reloaded.find(item => item.id === original[1].id)?.shm_url, current.shm_url);
  assert.equal(reloaded[2].profile, 'shop-2');
  assert.notEqual(reloaded[1].id, reloaded[2].id);
});
