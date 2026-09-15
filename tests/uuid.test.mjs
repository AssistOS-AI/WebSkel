import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import { createSecureUuid } from '../utils/uuid.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('native UUID generation preserves the Crypto receiver', () => {
    const expected = '00000000-0000-4000-8000-000000000000';
    const cryptoApi = {
        randomUUID() {
            assert.equal(this, cryptoApi);
            return expected;
        },
        getRandomValues() { assert.fail('native UUID generation should be used'); },
    };
    assert.equal(createSecureUuid(cryptoApi), expected);
});

test('HTTP-compatible generation uses secure random bytes and UUIDv4 bits', () => {
    let calls = 0;
    const cryptoApi = {
        getRandomValues(bytes) {
            assert.equal(this, cryptoApi);
            assert.ok(bytes instanceof Uint8Array);
            assert.equal(bytes.length, 16);
            bytes.set(Array.from({ length: 16 }, (_, index) => index));
            calls += 1;
            return bytes;
        },
    };
    const uuid = createSecureUuid(cryptoApi);
    assert.equal(uuid, '00010203-0405-4607-8809-0a0b0c0d0e0f');
    assert.match(uuid, UUID_V4);
    assert.equal(calls, 1);
});

test('successive IDs do not reuse random bytes', () => {
    const cryptoApi = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
    const values = Array.from({ length: 32 }, () => createSecureUuid(cryptoApi));
    assert.equal(new Set(values).size, values.length);
    for (const value of values) assert.match(value, UUID_V4);
});

test('missing secure randomness fails instead of generating weak IDs', () => {
    for (const cryptoApi of [null, {}, { randomUUID: null }, { getRandomValues: true }]) {
        assert.throws(() => createSecureUuid(cryptoApi), { code: 'WEB_CRYPTO_UNAVAILABLE' });
    }
});

test('a secure random source failure is not hidden by another fallback', () => {
    const failure = new Error('random source unavailable');
    assert.throws(() => createSecureUuid({ getRandomValues() { throw failure; } }), (error) => error === failure);
});
