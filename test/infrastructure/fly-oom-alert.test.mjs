import { describe, expect, it } from 'vitest';

import {
  buildOomQuery,
  checkFlyOom,
  flyAuthorization,
  parseOomMetric,
} from '../../v2/scripts/check-fly-oom.mjs';

describe('Fly OOM alert', () => {
  it('creates a bounded app-scoped query', () => {
    expect(buildOomQuery('cosyworld-lonelyforest', '2h')).toBe(
      'max(max_over_time(fly_instance_exit_oom{app="cosyworld-lonelyforest"}[2h]))'
    );
    expect(() => buildOomQuery('cosyworld"} or vector(1)', '30m')).toThrow(/app must/);
    expect(() => buildOomQuery('cosyworld', '30 minutes')).toThrow(/window must/);
  });

  it('accepts raw and already-prefixed Fly tokens', () => {
    expect(flyAuthorization('secret-token')).toBe('FlyV1 secret-token');
    expect(flyAuthorization(' FlyV1 secret-token \n')).toBe('FlyV1 secret-token');
    expect(() => flyAuthorization('')).toThrow(/required/);
  });

  it('treats zero as healthy and one as an OOM', () => {
    expect(
      parseOomMetric({
        status: 'success',
        data: { result: [{ value: [1_750_000_000, '0'] }] },
      })
    ).toBe(0);
    expect(
      parseOomMetric({
        status: 'success',
        data: { result: [{ value: [1_750_000_000, '1'] }] },
      })
    ).toBe(1);
  });

  it('fails closed on missing and malformed metrics', () => {
    expect(() => parseOomMetric({ status: 'success', data: { result: [] } })).toThrow(
      /no OOM series/
    );
    expect(() =>
      parseOomMetric({
        status: 'success',
        data: { result: [{ value: [1_750_000_000, 'not-a-number'] }] },
      })
    ).toThrow(/nonnumeric/);
    expect(() =>
      parseOomMetric({ status: 'error', errorType: 'bad_data', error: 'invalid' })
    ).toThrow(/bad_data: invalid/);
  });

  it('sends the least-privilege FlyV1 request', async () => {
    let request;
    const result = await checkFlyOom({
      org: 'personal',
      app: 'cosyworld',
      token: 'read-only-token',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { result: [{ value: [1_750_000_000, '0'] }] },
          })
        );
      },
    });
    expect(result.maxOom).toBe(0);
    expect(request.options.headers.Authorization).toBe('FlyV1 read-only-token');
    expect(request.url.hostname).toBe('api.fly.io');
    expect(request.url.pathname).toBe('/prometheus/personal/api/v1/query');
    expect(request.url.searchParams.get('query')).toBe(buildOomQuery('cosyworld'));
  });

  it('rejects HTTP and invalid JSON responses', async () => {
    await expect(
      checkFlyOom({
        org: 'personal',
        app: 'cosyworld',
        token: 'token',
        fetchImpl: async () => new Response('unauthorized', { status: 401 }),
      })
    ).rejects.toThrow(/HTTP 401/);
    await expect(
      checkFlyOom({
        org: 'personal',
        app: 'cosyworld',
        token: 'token',
        fetchImpl: async () => new Response('not-json'),
      })
    ).rejects.toThrow(/invalid JSON/);
  });
});
