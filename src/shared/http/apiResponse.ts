export type ApiSuccessResponse<T> = {
  data: T;
  meta: {
    requestId: string;
  };
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details: ReadonlyArray<unknown>;
  requestId: string;
};

export type ApiErrorResponse = {
  error: ApiErrorBody;
};

export function successResponse<T>(data: T, requestId: string): ApiSuccessResponse<T> {
  return { data, meta: { requestId } };
}

export function errorResponse(body: ApiErrorBody): ApiErrorResponse {
  return { error: body };
}
