import type {
  AssetDto,
  CreatePredictionBody,
  CreatePredictionResponse,
  ErrorCode,
  MeDto,
  NicknameCheckResponse,
  NicknameSuggestResponse,
  PredictionDto,
  PredictionListResponse,
} from '@updown/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
  ) {
    super(message);
  }
}

// Браузер ходит в API через тот же origin (/api), поэтому cookie сессии остаются first-party.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      cache: 'no-store',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Нет соединения. Проверьте интернет и попробуйте ещё раз.');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { code?: ErrorCode; message?: string } | null;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      body?.code ?? 'internal',
      body?.message ?? 'Что-то пошло не так. Попробуйте ещё раз.',
    );
  }
  return body as T;
}

export const api = {
  me: () => request<MeDto>('/v1/me'),
  createGuest: (nickname: string) =>
    request<MeDto>('/v1/auth/guest', { method: 'POST', body: JSON.stringify({ nickname }) }),
  checkNickname: (value: string) =>
    request<NicknameCheckResponse>(`/v1/nicknames/check?value=${encodeURIComponent(value)}`),
  suggestNickname: () => request<NicknameSuggestResponse>('/v1/nicknames/suggest'),
  assets: () => request<AssetDto[]>('/v1/assets'),
  createPrediction: (body: CreatePredictionBody) =>
    request<CreatePredictionResponse>('/v1/predictions', { method: 'POST', body: JSON.stringify(body) }),
  predictions: (cursor?: string) =>
    request<PredictionListResponse>(`/v1/predictions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  prediction: (id: string) => request<PredictionDto>(`/v1/predictions/${id}`),
};
