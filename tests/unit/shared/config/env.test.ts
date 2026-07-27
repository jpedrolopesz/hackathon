import { describe, expect, it } from 'vitest';
import { envSchema } from '@/shared/config/env';

const validEnv = {
  AWS_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'pool-id',
  COGNITO_CLIENT_ID: 'client-id',
  DYNAMODB_TABLE_NAME: 'table',
  S3_RECORDINGS_BUCKET_NAME: 'bucket',
  CLOUDFRONT_DOMAIN_NAME: 'domain.cloudfront.net',
  CLOUDFRONT_KEY_PAIR_ID: 'key-pair',
  CLOUDFRONT_PRIVATE_KEY_SECRET_ARN:
    'arn:aws:secretsmanager:us-east-1:123456789012:secret:cloudfront-private-key-AbCdEf',
  EVENTBRIDGE_BUS_NAME: 'bus',
  WEBSOCKET_API_ENDPOINT: 'https://ws.example.com',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
};

describe('envSchema', () => {
  it('applies defaults for optional values', () => {
    const parsed = envSchema.parse(validEnv);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.APP_ENV).toBe('development');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('rejects a missing required value', () => {
    const rest = Object.fromEntries(
      Object.entries(validEnv).filter(([key]) => key !== 'AWS_REGION'),
    );
    expect(envSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a CloudFront private key reference that is not a Secrets Manager ARN', () => {
    const withRawKey = {
      ...validEnv,
      CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: '-----BEGIN PRIVATE KEY-----',
    };
    expect(envSchema.safeParse(withRawKey).success).toBe(false);
  });
});
