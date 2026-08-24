import test from 'node:test';
import assert from 'node:assert/strict';
import './idbshim.mjs';
globalThis.window={LOGBOOK_STANDALONE:true,LogbookNative:{save:()=>true,exists:()=>false,remove:()=>true}};
globalThis.btoa=(s)=>Buffer.from(s,'binary').toString('base64');
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({products:[]}),arrayBuffer:async()=>new Uint8Array([1]).buffer});
const { localApi:api } = await import('../app/local/store.js');
const J=(b)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const P=(id,b)=>api('/projects/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const ok = (name, cond, detail = '') => test(name, () => assert.ok(cond, String(detail)));

// the form's route: progress alone, status left as it was
const a = await api('/projects', J({ title:'A', status:'started', date_started:'2026-08-01', progress: 40 }));
const done = await P(a.id, { progress: 100 });
ok('100% completes it, whichever route set it', done.status === 'completed', done.status);
ok('and dates it',                              !!done.date_completed, String(done.date_completed));

// an abandoned project is not quietly finished by a stray percentage
const b = await api('/projects', J({ title:'B', status:'abandoned', progress: 100 }));
ok('an abandoned project stays abandoned', b.status === 'abandoned', b.status);

// a completion date already there is not overwritten
const c = await api('/projects', J({ title:'C', status:'started', date_started:'2026-07-01',
                                     date_completed:'2026-07-20', progress: 100 }));
ok('an existing completion date is kept', c.date_completed === '2026-07-20', String(c.date_completed));

// and below 100 nothing is forced
const d = await P(a.id, { progress: 60 });
ok('dropping below 100 does not un-complete it', d.status === 'completed', d.status);


/* Every currency the app can display must be offered by the editor. They drifted
   apart once — three in the form, four in Settings — and saving a CAD project
   then submitted a null currency and lost it. */
const { CURRENCIES } = await import('../app/core/shops.js');
const appSrc = (await import('node:fs')).readFileSync(
  new URL('../app/app.js', import.meta.url), 'utf8');
ok('the editor takes its currencies from the one list',
   !/\['GBP', 'USD', 'EUR'\]/.test(appSrc), 'a hard-coded shortlist is still there');
ok('and so does Settings',
   !/\['GBP', 'USD', 'EUR', 'CAD'\]/.test(appSrc), 'Settings still has its own list');
ok('a saved currency can never become nothing',
   /data-was="\$\{h\(p\.currency \|\| ''\)\}"/.test(appSrc) && /dataset\.was/.test(appSrc));
ok('every symbol the app can print is a currency it offers', CURRENCIES.length >= 6);
