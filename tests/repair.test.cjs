const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {Market,retry}=require('../market.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(m){await m.rankingTask;await m.checkpointQueue;}
test('网络中断自动重试；参数错误不反复请求',async()=>{
  let attempts=0;assert.equal(await retry(()=>{if(++attempts<3)throw new Error('socket hang up');return 7;},{delay:0}),7);assert.equal(attempts,3);
  attempts=0;await assert.rejects(retry(()=>{attempts++;throw new Error('代码无效');},{delay:0}));assert.equal(attempts,1);
});
test('主股票池连接中断时自动调用备用源；两源中断可返回注明过期的缓存',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-fallback-'));
  try{
    const m=new Market(dir);let backupCalls=0;
    m.loadUniverse=async()=>{throw new Error('socket hang up');};m.loadSinaUniverse=async()=>{backupCalls++;return {rows:[{symbol:'sz000001'}],source:'备用行情'};};
    assert.equal((await m.universe()).source,'备用行情');assert.equal(backupCalls,1);
    const cache={rows:[{symbol:'sh600519'}],fetchedAt:'2026-01-01T00:00:00Z'};await fs.writeFile(path.join(dir,'market.json'),JSON.stringify(cache));
    const n=new Market(dir);n.loadUniverse=m.loadUniverse;n.loadSinaUniverse=async()=>{throw new Error('timeout');};const saved=await n.universe(true);
    assert.equal(saved.stale,true);assert.equal(saved.rows[0].symbol,'sh600519');assert.match(saved.error,/socket hang up/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('停止和重启后继续已保存进度，只重新请求失败和未处理股票',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-resume-'));
  try{
    const m=new Market(dir);const pool=Array.from({length:16},(_,i)=>({symbol:'sh'+String(600000+i),price:1,name:String(i)}));m.rankingUniverse=async()=>({rows:pool,source:'测试股票池'});
    m.history=async()=>({bars:[{date:'2026-07-01',close:100},{date:'2026-07-02',close:110}]});
    await m.startRanking({start:'2026-07-01',end:'2026-07-02',scope:'all'});while(m.job.done<4)await delay(5);m.cancelRanking();await settle(m);
    const saved=JSON.parse(await fs.readFile(path.join(dir,'last-ranking.json'),'utf8'));assert.equal(saved.status,'cancelled');assert.ok(saved.done>=4&&saved.done<16);
    const completed=new Set(saved.rows.map(r=>r.symbol));const n=new Market(dir);n.job=saved;const requested=[];
    n.history=async symbol=>{requested.push(symbol);return {bars:[{date:'2026-07-01',close:100},{date:'2026-07-02',close:110}]};};
    n.rankingUniverse=async()=>{throw new Error('续算不应重新读取股票池');};
    await n.startRanking({start:saved.start,end:saved.end,scope:'all',resume:true});await settle(n);
    assert.equal(n.job.status,'complete');assert.equal(n.job.done,16);assert.equal(n.job.rows.length,16);assert.equal(n.job.failed,0);
    assert.ok(requested.every(symbol=>!completed.has(symbol)));assert.equal(requested.length,16-completed.size);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('连续行情连接失败会暂停，保留进度，避免将整个股票池逐只记为失败',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-pause-'));
  try{const m=new Market(dir);m.rankingUniverse=async()=>({rows:Array.from({length:40},(_,i)=>({symbol:'sh'+(600000+i),name:String(i)}))});
    m.history=async()=>{throw new Error('socket hang up');};await m.startRanking({start:'2026-07-01',end:'2026-07-02',scope:'all'});await settle(m);
    assert.equal(m.job.status,'paused');assert.ok(m.job.done<40);assert.equal(m.job.failed,m.job.done);assert.equal(m.jobSnapshot().resumable,true);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'last-ranking.json'),'utf8')).status,'paused');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
