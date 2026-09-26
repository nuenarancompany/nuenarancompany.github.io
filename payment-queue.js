// Durable, idempotent outbox. A pending request is NOT a confirmed payment.
export function createPaymentQueue(commit, changed) {
  let running = false;
  const ready = new Promise((resolve,reject)=>{
    const req=indexedDB.open('nuenaran-payment-outbox',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('requests',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  ready.catch(()=>{}); // Surface unavailable storage when a queue operation is attempted.
  async function access(mode,fn) {
    const db=await ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('requests',mode);const req=fn(tx.objectStore('requests'));
      tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
    });
  }
  const list=()=>access('readonly',store=>store.getAll());
  const put=item=>access('readwrite',store=>store.put(item));
  const remove=id=>access('readwrite',store=>store.delete(id));
  async function notify(){await changed(await list());}
  async function flush(){
    if(running||!navigator.onLine)return;
    running=true;
    try {
      for(const item of await list()) {
        if(item.state==='failed')continue;
        try { await commit(item); await remove(item.id); }
        catch(error) {
          if(!navigator.onLine || /unavailable|deadline-exceeded|aborted|network/.test(error.code||'')) break;
          await put({...item,state:'failed',error:String(error.message||error)});
        }
        await notify();
      }
    } finally { running=false; await notify(); }
  }
  return {
    list, flush,
    async enqueue(item){
      // Enforce the same-house guard in one IndexedDB transaction, including across tabs.
      const db=await ready;
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests');
        const req=store.getAll();let conflict=false;
        req.onsuccess=()=>{if(req.result.some(r=>r.houseId===item.houseId)){conflict=true;tx.abort();}else store.add(item);};
        tx.oncomplete=resolve;tx.onabort=()=>reject(new Error(conflict?'ئەم خانووە پارەدانێکی چاوەڕوانکراوی هەیە.':String(tx.error)));tx.onerror=()=>reject(tx.error);
      });
      await notify(); void flush();
    },
    async retry(id){const item=(await list()).find(r=>r.id===id);if(item){await put({...item,state:'pending',error:''});await notify();void flush();}},
    async cancel(id){const item=(await list()).find(r=>r.id===id);if(item?.state==='failed'){await remove(id);await notify();}}
  };
}
