export interface StructuredLogFields {
  readonly event: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly [key: string]: unknown;
}

export function structuredLog(
  level: 'info' | 'warn' | 'error',
  fields: StructuredLogFields,
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}

/** CloudWatch Embedded Metric Format; não exige chamada de API nem permissão extra. */
export function emitMetric(
  name: string,
  value = 1,
  unit: 'Count' | 'Milliseconds' | 'Seconds' = 'Count',
  dimensions: Readonly<Record<string, string>> = {},
): void {
  console.info(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'LiveClassesPlatform',
            Dimensions: [Object.keys(dimensions)],
            Metrics: [{ Name: name, Unit: unit }],
          },
        ],
      },
      ...dimensions,
      [name]: value,
    }),
  );
}
