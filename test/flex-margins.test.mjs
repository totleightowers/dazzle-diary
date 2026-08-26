// Auto side margins on a flex item shrink it to its content instead of filling
// it. Find every element where that is happening, across every screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import './idbshim.mjs';
import { rulesFor, parseHtml, computed } from '../tools/layout-probe.mjs';
let WIDE = true;
function mk(tag='div',id=null){const el={tagName:tag.toUpperCase(),id,children:[],dataset:{},files:[],
  value:'',textContent:'',disabled:false,hidden:false,_html:'',_attrs:{},style:{setProperty(){}},
  classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}},
  get innerHTML(){return this._html},
  set innerHTML(v){ this._html=String(v);
    if (/id="side"/.test(this._html)) { els.set('side', mk('aside','side')); els.set('main', mk('main','main')); }
    if (this._html === '') { els.delete('side'); els.delete('main'); } },
  setAttribute(k,v){this._attrs[k]=String(v)},getAttribute(k){return this._attrs[k]??null},
  appendChild(c){this.children.push(c);return c},remove(){},scrollTo(){},onscroll:null,
  getBoundingClientRect:()=>({width:0}),
  querySelector(){return mk()},querySelectorAll:()=>[],closest(){return null},
  addEventListener(){},focus(){},click(){}}; return el;}
const L={}, els=new Map(); const app=mk('div','app'); els.set('app',app);
globalThis.window={LOGBOOK_STANDALONE:true,innerWidth:1236,devicePixelRatio:2,
  LogbookNative:{save:()=>true,exists:()=>false,remove:()=>true,isSystemDark:()=>true,setBarColor(){}},
  addEventListener:(t,f)=>((L[t]||=[]).push(f)),removeEventListener(){},scrollTo(){},
  matchMedia:(q)=>{const m=/min-width:\s*(\d+)px/.exec(q);
    return {matches: m ? window.innerWidth >= Number(m[1]) : false, addEventListener(){}, addListener(){}};},
  getSelection:()=>({removeAllRanges(){}})};
globalThis.document={getElementById:(id)=>els.get(id)||(()=>{const e=mk('div',id);els.set(id,e);return e})(),
  querySelector:()=>null,querySelectorAll:()=>[],createElement:mk,
  addEventListener:(t,f)=>((L['doc:'+t]||=[]).push(f)),removeEventListener(){},body:mk('body'),documentElement:mk('html')};
globalThis.location={hash:'#/'}; globalThis.localStorage={getItem:()=>null,setItem(){}};
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
globalThis.confirm=()=>true; globalThis.history={state:{},pushState(){},back(){}};
// things a WebView provides and Node does not
globalThis.requestAnimationFrame=(fn)=>setTimeout(()=>fn(Date.now()),0);
globalThis.cancelAnimationFrame=(id)=>clearTimeout(id);
globalThis.btoa=(s)=>Buffer.from(s,'binary').toString('base64');
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({products:[]}),arrayBuffer:async()=>new Uint8Array([1]).buffer});

const { localApi:api } = await import('../app/local/store.js');
await import('../app/app.js?'+Date.now());
const fire=(k,e)=>Promise.all((L[k]||[]).map(f=>f(e)));
const J=(b)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const proj = await api('/projects', J({ title:'Moon Eater', status:'started', date_started:'2026-08-01' }));

const rules = rulesFor();
const routes = [['logbook','#/'], ['project','#/p/'+proj.id], ['edit','#/p/'+proj.id+'/edit'],
                ['new','#/new'], ['settings','#/settings'], ['licences','#/licences'],
                ['import','#/import'], ['catalogue','#/browse']];
const AUTO = (v) => v && /\bauto\b/.test(v);
const offenders = [], squashed = []; let checked = 0;

for (const width of [1236, 390]) {
  window.innerWidth = width;
  for (const [name, hash] of routes) {
    location.hash = hash; await fire('hashchange', {});
    const html = (els.get('main') || app).innerHTML || app.innerHTML;
    if (!html) continue;
    const root = parseHtml(`<div id="app" class="${els.get('side') ? 'two-pane' : ''}">${
      els.get('side') ? `<main id="main">${html}</main>` : html}</div>`);
    const walk = (node) => {
      for (const el of node.children) {
        const pc = computed(node, width, rules);
        /* Only a column. In a flex row, auto side margins are the ordinary way
           to push something to the end — that is not the trap. */
        const isFlex = pc.display && /flex/.test(pc.display.val)
                    && pc['flex-direction'] && /column/.test(pc['flex-direction'].val);
        if (isFlex) {
          const c = computed(el, width, rules);
          const ml = c['margin-left'] && c['margin-left'].val;
          const mr = c['margin-right'] && c['margin-right'].val;
          const shorthand = c.margin && c.margin.val;
          const sideAuto = AUTO(ml) || AUTO(mr) || (shorthand && /auto/.test(shorthand));
          const hasWidth = (c.width && c.width.val) || (c.flex && /1|auto/.test(c.flex.val));
          checked++;
          const who = `${el.tag}${el.id ? '#'+el.id : ''}${el.classes.length ? '.'+el.classes.join('.') : ''}`;
          if (sideAuto && !hasWidth) {
            offenders.push(`${name} @${width}px: ${who} inside ${node.tag}.${node.classes.join('.')}`);
          }
          /* The other half of the same trap: a flex column taller than the
             screen shrinks every item that can shrink, and overflow:hidden
             gives an item an automatic minimum size of nothing. A fixed height
             is not a promise unless flex-shrink says so. */
          const fixedHeight = c.height && /^\d+(\.\d+)?(px|dvh|vh)$/.test(c.height.val);
          const hides = (c.overflow && /hidden|auto|scroll/.test(c.overflow.val))
                     || (c['overflow-y'] && /hidden|auto|scroll/.test(c['overflow-y'].val));
          const holds = (c['flex-shrink'] && c['flex-shrink'].val === '0')
                     || (c.flex && /^0\s+0/.test(c.flex.val))
                     || (c['min-height'] && c['min-height'].val !== 'auto' && c['min-height'].val !== '0');
          if (fixedHeight && hides && !holds) {
            squashed.push(`${name} @${width}px: ${who} (height ${c.height.val}) inside ${node.tag}.${node.classes.join('.')}`);
          }
        }
        walk(el);
      }
    };
    walk(root);
  }
}
/* Auto side margins on a flex item in a COLUMN shrink it to its own content
   rather than filling it to the cap — which had every section of Settings at a
   different width, and the back arrow beside the title instead of at the edge.
   In a flex row the same margins are the ordinary way to push something to the
   end, so only columns are checked. */
test('nothing shrinks where it should fill', () => {
  assert.ok(checked > 50, `only ${checked} elements were examined`);
  assert.deepEqual(offenders, [], 'these need width: 100% beside their auto margins');
});

/* A fixed height inside a scrolling flex column is only kept if the item also
   refuses to shrink. The form's picture strip did not, so on a narrow screen —
   where the form is a flex column rather than a grid — it collapsed to nothing
   and the kit appeared to have no picture at all. */
test('nothing with a fixed height gets squashed to nothing', () => {
  assert.deepEqual(squashed, [], 'these need flex-shrink: 0 beside their height');
});
