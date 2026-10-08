import {normalizeLocalLensAddress} from '../src/services/localLensAddress';

describe('local lens address', () => {
  test.each([
    ['192.168.1.44', 'http://192.168.1.44'],
    ['010.0.0.1', 'http://10.0.0.1'],
    ['http://192.168.4.1/', 'http://192.168.4.1'],
    ['Lentes-729FF8.local:80', 'http://lentes-729ff8.local'],
    ['10.0.0.12:8080', 'http://10.0.0.12:8080'],
    ['172.31.4.2', 'http://172.31.4.2'],
  ])('accepts local address %s', (input, expected) => {
    expect(normalizeLocalLensAddress(input)).toBe(expected);
  });
  test.each([
    'https://example.com',
    'http://192.168.1.44@evil.com',
    '192.168.1.44/redirect',
    '192.168.1.44?password=secret',
    '192.168.1.999',
    '172.32.1.2',
    '127.0.0.1',
    '8.8.8.8',
    'lentes.local.evil.com',
    '192.168.1.44:65536',
    '192.168.1.44:0',
  ])('rejects unsafe endpoint %s', input => {
    expect(() => normalizeLocalLensAddress(input)).toThrow();
  });
});
