import 'server-only';
import type { NextResponse } from 'next/server';
import { dispatchApiV1 } from '@/web/api-v1/catalog';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  return handleApiV1Request(request, (auth) => dispatchApiV1(request, auth, path));
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
