const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {createServer}=require('../server.cjs');const {Market}=require('../market.cjs');
test('本地自选持久化、恶意来源和非法代码被拒绝',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-test-'));let server;
  try{
    const r=await createServer({dataDir:dir});server=r.server;
    const response=await fetch(r.origin+'/api/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes:['sh600519','sh600519','sz300750']})});
    assert.equal(response.status,200);assert.deepEqual((await response.json()).codes,['sh600519','sz300750']);
    assert.deepEqual(await new Market(dir).watchlist(),['sh600519','sz300750']);
    const cross=await fetch(r.origin+'/api/watchlist',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{"codes":[]}'});assert.equal(cross.status,403);
    const bad=await fetch(r.origin+'/api/watchlist',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"codes":["../../bad"]}'});assert.equal(bad.status,400);
    const wrongGroup=await fetch(r.origin+'/api/etf-ratio?group=../other');assert.equal(wrongGroup.status,400);
    const plain=await fetch(r.origin+'/api/watchlist',{method:'PUT',headers:{'Content-Type':'text/plain'},body:'{"codes":[]}'});assert.equal(plain.status,400);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
test('区间日期校验、部分失败计数和停止后不启动新的任务',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-rank-'));const m=new Market(dir);
  try{
    await assert.rejects(m.startRanking({start:'2026-02-30',end:'2026-03-05',scope:'all'}));
    await assert.rejects(m.startRanking({start:'2020-01-01',end:'2026-01-01',scope:'all'}));
    m.watchlist=async()=>['sh600519','sz300750','sz000001'];m.quotes=async()=>({rows:[{symbol:'sh600519'},{symbol:'sz300750'},{symbol:'sz000001'}]});
    m.history=async symbol=>{if(symbol==='sz300750')throw new Error('限流');return {bars:symbol==='sh600519'?[{date:'2026-01-01',close:100},{date:'2026-01-02',close:80}]:[]};};
    await m.startRanking({start:'2026-01-01',end:'2026-01-05',scope:'watchlist'});
    while(m.job.status==='running')await new Promise(r=>setTimeout(r,10));
    assert.equal(m.job.status,'complete');assert.equal(m.job.done,3);assert.equal(m.job.failed,1);assert.equal(m.job.skipped,1);assert.equal(m.job.rows.length,1);assert.equal(m.job.rows[0].drawdown,20);
    m.job={status:'running',rows:[]};m.cancelRanking();assert.equal(m.job.status,'stopping');
    await assert.rejects(m.startRanking({start:'2026-01-01',end:'2026-01-05',scope:'watchlist'}));
  }finally{await new Promise(r=>setTimeout(r,20));await fs.rm(dir,{recursive:true,force:true});}
});
