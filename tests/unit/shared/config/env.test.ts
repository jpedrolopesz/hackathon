import { describe, expect, it } from 'vitest';
import { envSchema } from '@/shared/config/env';

const validEnv = {
  AWS_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'pool-id',
  COGNITO_CLIENT_ID: 'client-id',
  COGNITO_ISSUER_URL: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123',
  COGNITO_HOSTED_UI_DOMAIN: 'https://teste-development.auth.us-east-1.amazoncognito.com',
  SESSION_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:session-secret-AbCdEf',
  DYNAMODB_TABLE_NAME: 'table',
  S3_RECORDINGS_BUCKET_NAME: 'bucket',
  CLOUDFRONT_KEY_PAIR_ID: 'key-pair',
  CLOUDFRONT_PRIVATE_KEY_SECRET_ARN:
    'arn:aws:secretsmanager:us-east-1:123456789012:secret:cloudfront-private-key-AbCdEf',
  EVENTBRIDGE_BUS_NAME: 'bus',
  WEBSOCKET_API_ENDPOINT: 'https://ws.example.com',
  WEBSOCKET_CLIENT_URL: 'wss://ws.example.com/development',
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
