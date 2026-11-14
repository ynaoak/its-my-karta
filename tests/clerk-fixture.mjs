// Strict Core 3 fixture: v5 URLs and load() without the separate UI are rejected.
export async function installClerkFixture(page, token, { fail, missingUI = false } = {}) {
  const requested = [];
  await page.route('https://clerk.karta.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path === '/npm/@clerk/ui@1.42.6/dist/ui.browser.js') {
      if (fail === 'ui') return route.fulfill({ status: 503, body: 'Unavailable' });
      return route.fulfill({
        contentType: 'text/javascript',
        body: missingUI
          ? ''
          : 'window.__internal_ClerkUICtor = class ClerkUI { static version = "1.42.6"; };',
      });
    }
    if (path !== '/npm/@clerk/clerk-js@6.43.1/dist/clerk.browser.js')
      return route.fulfill({ status: 410, body: 'Old SDK is unsupported' });
    if (fail === 'sdk') return route.fulfill({ status: 503, body: 'Unavailable' });
    return route.fulfill({
      contentType: 'text/javascript',
      body: `(()=>{
      let user=null,listeners=[],ready=false;
      window.Clerk={
        version:'6.43.1',
        get user(){return user},
        get session(){return user?{getToken:async()=>${JSON.stringify(token)}}:null},
        load:async(options)=>{
          if(typeof options?.ui?.ClerkUI!=='function'||options.ui.ClerkUI!==window.__internal_ClerkUICtor)throw new Error('Core 3 requires the separate UI constructor');
          window.__testClerkInitialized=true;ready=true;
        },
        addListener:fn=>listeners.push(fn),
        openSignIn:()=>{if(!ready)throw new Error('UI not initialized');user={id:'user_host',firstName:'テスト利用者'};listeners.forEach(f=>f());},
        signOut:async()=>{user=null;listeners.forEach(f=>f());}
      };
    })()`,
    });
  });
  return requested;
}
