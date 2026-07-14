import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClientCommand } from '../src/contracts/protocol.js';

test('WebSocket client commands remain compatible', () => {
  assert.deepEqual(parseClientCommand('{"type":"message.cancel"}'), { type: 'message.cancel' });
  assert.deepEqual(parseClientCommand('{"type":"session.switch","chatId":"chat-1"}'), { type: 'session.switch', chatId: 'chat-1' });
  assert.deepEqual(parseClientCommand('{"type":"message.send","content":"  查询  ","attachments":[{"path":"/tmp/a.pdf","name":"a.pdf"}]}'), {
    type: 'message.send', content: '查询', attachments: [{ path: '/tmp/a.pdf', name: 'a.pdf', mime: '' }],
  });
  assert.equal(parseClientCommand('{"type":"message.send","content":""}'), null);
});
