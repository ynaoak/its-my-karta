// Upgrade both frontend packages together; Clerk JS v6 requires the separate UI bundle.
// Versions verified against npm's stable dist-tags, not canary/snapshot releases.
export const CLERK_JS_VERSION = '6.43.1';
export const CLERK_UI_VERSION = '1.42.6';

function loadScript(url, publishableKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = publishableKey;
    script.src = url;
    const fail = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error('ログイン画面を読み込めません。通信状態を確認して再読み込みしてください'));
    };
    const timer = setTimeout(fail, timeoutMs);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      resolve();
    };
    document.head.append(script);
  });
}

export async function loadClerk(config, { timeoutMs = 15000 } = {}) {
  if (!config.clerkKey || !/^[a-z0-9.-]+$/.test(config.clerkDomain || '')) {
    throw new Error('ログインの設定を確認してください');
  }
  const base = `https://${config.clerkDomain}/npm/@clerk`;
  await Promise.all([
    loadScript(
      `${base}/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`,
      config.clerkKey,
      timeoutMs,
    ),
    loadScript(`${base}/ui@${CLERK_UI_VERSION}/dist/ui.browser.js`, config.clerkKey, timeoutMs),
  ]);
  const clerk = window.Clerk;
  const ClerkUI = window.__internal_ClerkUICtor;
  if (!clerk || typeof ClerkUI !== 'function') {
    throw new Error('ログイン画面の初期化に失敗しました。ページを再読み込みしてください');
  }
  await clerk.load({ ui: { ClerkUI } });
  return clerk;
}
