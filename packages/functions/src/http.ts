/** Tiny HTTP response helpers for the read API (T-13). */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const notFound = (message = 'not found'): APIGatewayProxyStructuredResultV2 => json(404, { error: 'not_found', message });
