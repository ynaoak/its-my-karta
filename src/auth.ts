import { verifyToken } from '@clerk/backend';
import { assert, HttpError, type Env } from './types';
export function clerkDomain(key: string) {
  const encoded = key.split('_')[2];
  try {
    const host = atob(encoded).replace(/\$$/, '');
    assert(/^[a-z0-9.-]+$/.test(host), 'Clerkキーが不正です', 503);
    return host;
  } catch {
    throw new HttpError(503, 'Clerkキーが未設定です');
  }
}
export async function user(req: Request, env: Env, optional = false): Promise<string | null> {
  const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (optional && !token) return null;
  assert(token, 'ログインしてください', 401);
  assert(
    env.CLERK_PUBLISHABLE_KEY && env.CLERK_JWT_KEY && env.CLERK_AUTHORIZED_PARTIES,
    'Clerk認証が未設定です',
    503,
  );
  try {
    const payload = await verifyToken(token, {
      jwtKey: env.CLERK_JWT_KEY.replace(/\\n/g, '\n'),
      authorizedParties: env.CLERK_AUTHORIZED_PARTIES.split(',').map((s) => s.trim()),
    });
    assert(
      payload.iss === `https://${clerkDomain(env.CLERK_PUBLISHABLE_KEY)}` &&
        /^user_/.test(payload.sub) &&
        typeof payload.sid === 'string' &&
        payload.sts !== 'pending',
      '認証が無効です',
      401,
    );
    return payload.sub;
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) throw e;
    throw new HttpError(401, 'ログインの有効期限を確認してください');
  }
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  assert(
    !origin || origin === new URL(req.url).origin,
    '別サイトからの操作は許可されていません',
    403,
  );
}
