import { describe, expect, it } from 'vitest';
import { publicRequestUrl } from '@/web/auth/public-origin';

describe('publicRequestUrl', () => {
  it('uses the configured public origin instead of the API Gateway request host', () => {
    const request = new Request(
      'https://abc.execute-api.us-east-1.amazonaws.com/api/auth/login',
    );

    expect(
      publicRequestUrl(
        '/api/auth/callback',
        request,
        'https://d123.cloudfront.net',
      ).toString(),
    ).toBe('https://d123.cloudfront.net/api/auth/callback');
  });

  it('falls back to the request origin for local development', () => {
    const request = new Request('http://localhost:3000/api/auth/login');

    expect(publicRequestUrl('/api/auth/callback', request).toString()).toBe(
      'http://localhost:3000/api/auth/callback',
    );
  });
});
