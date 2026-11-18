import assert from 'node:assert/strict';
import test from 'node:test';
import { fillFormRecipients } from '../dist/runtime/form-recipients.js';

function plugin(items) {
  const calls = [];
  const call = async (path, body) => {
    calls.push([path, body]);
    if (path === '/forms/list') return { success: true, data: { items } };
    if (path === '/forms/update') return { success: true, data: {} };
    return { success: false, error: { code: 'NOT_FOUND' } };
  };
  return { call, calls };
}

test('stored forms without recipients get the platform list; others are left alone', async () => {
  const { call, calls } = plugin([
    { id: 'a', settings: { notifyEmails: [] } },
    { id: 'b', settings: { notifyEmails: ['kund@example.com'] } },
    { id: 'c', settings: {} },
  ]);
  assert.deepEqual(await fillFormRecipients(call, ['anton@walterco.se']), ['a', 'c']);
  assert.deepEqual(calls, [
    ['/forms/list', undefined],
    ['/forms/update', { id: 'a', settings: { notifyEmails: ['anton@walterco.se'] } }],
    ['/forms/update', { id: 'c', settings: { notifyEmails: ['anton@walterco.se'] } }],
  ]);
});

test('no platform list: nothing is read or written', async () => {
  const { call, calls } = plugin([{ id: 'a', settings: { notifyEmails: [] } }]);
  assert.deepEqual(await fillFormRecipients(call, []), []);
  assert.deepEqual(calls, []);
});

test('a failing route is an error, not a silent skip', async () => {
  await assert.rejects(
    fillFormRecipients(async () => ({ success: false }), ['a@example.com']),
    /forms\/list failed/
  );
  const call = async (path) =>
    path === '/forms/list'
      ? { success: true, data: { items: [{ id: 'a', settings: { notifyEmails: [] } }] } }
      : { success: false, error: { code: 'X' } };
  await assert.rejects(fillFormRecipients(call, ['a@example.com']), /forms\/update a failed/);
});
