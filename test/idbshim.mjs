/* Enough of IndexedDB to run public/local/idb.js for real. */
class Req { constructor(){ this.result=undefined; this.error=null; } }
const cmpKey = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (store, v) => Array.isArray(store.keyPath) ? store.keyPath.map(k=>v[k]) : v[store.keyPath];

class Store {
  constructor(name, opts={}) { this.name=name; this.keyPath=opts.keyPath??null; this.auto=!!opts.autoIncrement;
    this.rows=new Map(); this.seq=0; this.indexes=new Map(); }
  createIndex(name, path){ this.indexes.set(name,path); }
}
class StoreHandle {
  constructor(store, tx){ this.s=store; this.tx=tx; }
  _k(v,key){ if(key!==undefined) return key; if(this.s.keyPath) { const k=keyOf(this.s,v); if(k!==undefined) return k; }
    if(this.s.auto){ const id=++this.s.seq; if(typeof this.s.keyPath==='string') v[this.s.keyPath]=id; return id; }
    throw new Error('no key'); }
  put(v,key){ const r=new Req(); const k=this._k(v,key);
    this.s.rows.set(JSON.stringify(k), v); r.result=k; this.tx._q(r); return r; }
  get(key){ const r=new Req(); r.result=this.s.rows.get(JSON.stringify(key)); this.tx._q(r); return r; }
  getAll(){ const r=new Req(); r.result=[...this.s.rows.values()]; this.tx._q(r); return r; }
  delete(key){ const r=new Req(); this.s.rows.delete(JSON.stringify(key)); this.tx._q(r); return r; }
  clear(){ const r=new Req(); this.s.rows.clear(); this.tx._q(r); return r; }
  index(name){ const path=this.s.indexes.get(name); const self=this;
    return {
      getAll(value){ const r=new Req();
        r.result=[...self.s.rows.values()].filter(v=>v[path]===value); self.tx._q(r); return r; },
      openKeyCursor(range){ const r=new Req();
        const matches=[...self.s.rows.entries()].filter(([,v])=>v[path]===range.only);
        let i=0;
        const step=()=>{ if(i>=matches.length){ r.result=null; r.onsuccess&&r.onsuccess(); return; }
          const [pk]=matches[i++];
          r.result={ primaryKey: JSON.parse(pk), continue: ()=>setTimeout(step,0) };
          r.onsuccess&&r.onsuccess(); };
        setTimeout(step,0); return r; }
    }; }
}
class Tx {
  constructor(db,names){ this.db=db; this.names=[].concat(names); this.pending=0; this.done=false;
    setTimeout(()=>this._maybe(),0); }
  objectStore(n){ return new StoreHandle(this.db.stores.get(n), this); }
  _q(r){ this.pending++; setTimeout(()=>{ r.onsuccess&&r.onsuccess(); this.pending--; this._maybe(); },0); }
  _maybe(){ if(this.done) return; if(this.pending>0) return;
    this.done=true; setTimeout(()=>this.oncomplete&&this.oncomplete(),0); }
}
class DB {
  constructor(){ this.stores=new Map();
    this.objectStoreNames={ contains:(n)=>this.stores.has(n) }; }
  createObjectStore(n,o){ const s=new Store(n,o); this.stores.set(n,s); return s; }
  transaction(names){ return new Tx(this,names); }
}
const theDb = new DB();
globalThis.IDBKeyRange = { only: (v) => ({ only: v }) };
globalThis.indexedDB = {
  open() {
    const r = new Req();
    setTimeout(() => { r.result = theDb;
      r.onupgradeneeded && r.onupgradeneeded();
      r.onsuccess && r.onsuccess(); }, 0);
    return r;
  }
};
export { theDb };
