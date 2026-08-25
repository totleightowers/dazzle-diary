import test from 'node:test';
import assert from 'node:assert/strict';
import './idbshim.mjs';

/* Picking a kit from the catalogue used to be consumed by the first render of
   the New project form, so a second render — a fold, a rotation, anything that
   re-runs the route — produced a blank form with no picture and none of the
   details just picked. */

const files=new Map();
function mk(tag='div',id=null){const el={tagName:tag.toUpperCase(),id,children:[],dataset:{},files:[],
  value:'',textContent:'',disabled:false,hidden:false,_html:'',_attrs:{},style:{setProperty(){}},
  classList:{add(){},remove(){},contains(){return false}},
  get innerHTML(){return this._html}, set innerHTML(v){this._html=String(v)},
  setAttribute(k,v){this._attrs[k]=String(v)},getAttribute(k){return this._attrs[k]??null},
  appendChild(c){this.children.push(c);return c},remove(){},scrollTo(){},onscroll:null,
  querySelector(){return null},querySelectorAll:()=>[],closest(){return null},
  addEventListener(){},focus(){},click(){}}; return el;}
const L={}, els=new Map(); const seg={}; const app=mk('div','app');
globalThis.window={LOGBOOK_STANDALONE:true,
  LogbookNative:{save:(p,b)=>{files.set(p,Buffer.from(b,'base64'));return true;},
    exists:(p)=>files.has(p),remove:(p)=>files.delete(p),isSystemDark:()=>true,setBarColor(){}},
  addEventListener:(t,f)=>((L[t]||=[]).push(f)),removeEventListener(){},scrollTo(){},
  matchMedia:()=>({matches:false,addEventListener(){}}),getSelection:()=>({removeAllRanges(){}})};
globalThis.document={getElementById:(id)=>id==='app'?app:(els.get(id)||(()=>{const e=mk('div',id);els.set(id,e);return e})()),
  querySelector:(q)=>{const m=/#(\w+) \.opt\[aria-pressed="true"\]/.exec(q);
    if (m) { const v = seg[m[1]]; return v === undefined ? null : { dataset:{ k:v } }; } return null;},
  querySelectorAll:()=>[],createElement:mk,
  addEventListener:(t,f)=>((L['doc:'+t]||=[]).push(f)),removeEventListener(){},body:mk('body'),documentElement:mk('html')};
globalThis.location={hash:'#/'}; globalThis.localStorage={getItem:()=>null,setItem(){}};
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
globalThis.confirm=()=>true; globalThis.history={state:{},pushState(){},back(){}};
globalThis.btoa=(s)=>Buffer.from(s,'binary').toString('base64');
const PRODUCT={id:1,title:'Moon Eater',vendor:'Yuumei Art',handle:'moon-eater',
  product_type:'Diamond Art Kit',images:[{src:'https://cdn.shopify.com/moon.jpg'}],
  variants:[{title:'23.6" x 30.7" (59.9cm x 78cm) / Square with 42 Colors / 75433',price:'169.00',available:true}]};
globalThis.fetch=async(u)=>{const real=decodeURIComponent(String(u).replace('/__net/?url=',''));
  if(/\.(jpg|png|webp)/i.test(real)) return {ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer};
  const url=new URL(real); const page=Number(url.searchParams.get('page')||1);
  if(url.hostname!=='diamondartclub.com'||page>1) return {ok:true,status:200,json:async()=>({products:[]})};
  return {ok:true,status:200,json:async()=>({products:[PRODUCT]})};};

const { localApi:api } = await import('../app/local/store.js');
await import('../app/app.js?'+Date.now());
const fire=(k,e)=>Promise.all((L[k]||[]).map(f=>f(e)));
const go=async(h)=>{location.hash=h;await fire('hashchange',{});return app.innerHTML;};
const { job } = await api('/catalogue/sync',{method:'POST'});
for(let i=0;i<2000;i++){const j=await api('/jobs/'+job); if(j.state!=='running')break; await new Promise(r=>setTimeout(r,10));}

await go('#/browse');
await new Promise(r=>setTimeout(r,300));
const body = els.get('browsebody');
test('the catalogue shows cards to pick', () => assert.match(body?.innerHTML || '', /data-act="pickcat"/));

const btn = mk('button'); btn.dataset.act='pickcat'; btn.dataset.i='0';
await fire('doc:click', { target: { closest:(s)=> s==='[data-act]' ? btn : null } });
await new Promise(r=>setTimeout(r,150));
const form = await go('#/new');
const shown = (h) => /id="formshot"(?![^>]*hidden)/.test(h) || /class="formshot"><img src="http/.test(h);
test('picking one shows it on the form', () => assert.ok(shown(form)));
const again = await go('#/new');          // a re-render: rotation, fold, anything
test('and it survives a re-render', () => assert.ok(shown(again), 'the form went blank'));
test('the details are prefilled', () => assert.match(again, /value="Moon Eater"/));



// now save it the way the Save button does, and look at the project page
const field=(id,v='')=>{const e=mk('input',id); e.value=v; els.set(id,e); return e;};
for (const id of ['artist','special','brand','source','width_in','height_in','colors','drills',
                  'price','shipping','tax','sold_price','progress','notes','shop',
                  'date_ordered','date_received','date_started','date_completed']) field(id,'');
field('shop','dac');
const t = field('title','Moon Eater');
t.dataset.handle='moon-eater'; t.dataset.shop='dac'; t.dataset.holds='';
els.set('rating', mk('div','rating'));
els.set('currency', mk('div','currency'));
seg.status='notReceived'; seg.shape='Square'; seg.coverage='Full drill'; seg.currency='GBP';
const saveBtn = mk('button'); saveBtn.dataset.act='save'; saveBtn.dataset.id='';
await fire('doc:click', { target:{ closest:(s2)=> s2==='[data-act]' ? saveBtn : null } });
await new Promise(r=>setTimeout(r,400));
const rows = await api('/projects');
const saved = rows[rows.length-1];

const detail = await go('#/p/' + saved.id);
test('and the saved project shows its cover', () => assert.match(detail, /class="shots"/));



