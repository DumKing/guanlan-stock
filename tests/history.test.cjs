const {test}=require('node:test');const assert=require('node:assert/strict');const https=require('node:https');const {EventEmitter}=require('node:events');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {Market}=require('../market.cjs');
test('历史接口结束日为排他边界，选中截止日应计入且不泄漏次日数据',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stock-history-'));let requested;
  t.mock.method(https,'get',(url,_options,callback)=>{
    requested=url;const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=e=>req.emit('error',e);
    process.nextTick(()=>{
      const res=new EventEmitter();res.statusCode=200;callback(res);
      const payload={data:{sh600519:{qfqday:[['2026-10-28','100','110','111','99','1'],['2026-10-29','110','120','121','109','2'],['2026-10-30','120','130','131','119','3']]}}};
      res.emit('data',Buffer.from(JSON.stringify(payload)));res.emit('end');
    });return req;
  });
  try{
    const history=await new Market(dir).history('sh600519','day','2026-10-28','2026-10-29');
    assert.ok(requested.includes('2026-10-28,2026-10-30,640,qfq'));
    assert.deepEqual(history.bars.map(b=>b.date),['2026-10-28','2026-10-29']);
    assert.equal(history.bars.at(-1).close,120);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
