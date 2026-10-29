const fs=require('node:fs/promises'),path=require('node:path');const {Market,INDEX_CODES}=require('../market.cjs');const {EtfRatio}=require('../etf-ratio.cjs');const {seed}=require('./seed-web-cache.cjs');
async function collect({dir=path.resolve(process.env.GUANLAN_DATA_DIR||'data'),withHistory=process.argv.includes('--history')}={}){
  await seed(dir);const market=new Market(dir),status={collectedAt:new Date().toISOString(),errors:[]};
  const tasks=[['全市场行情',()=>market.universe(true,phase=>console.log(phase))],['主要指数',async()=>{const data=await market.quotes(INDEX_CODES);await fs.writeFile(path.join(dir,'web-indices.json'),JSON.stringify(data));return data;}],...['csi300','sse50','star50'].map(id=>[id+' ETF',()=>new EtfRatio(dir,id).get(false)])];
  const results=await Promise.allSettled(tasks.map(async([name,work])=>{const result=await work();if(result.stale)throw new Error(result.error||'行情源返回过期缓存');console.log(name+' 已读取');return result;}));
  results.forEach((result,i)=>{if(result.status==='rejected'){const message=tasks[i][0]+': '+result.reason.message;status.errors.push(message);console.warn('保留上次有效快照：'+message);}});
  if(withHistory){
    const universe=await market.rankingUniverse(()=>{}),pool=universe.poolRows||universe.rows;let next=0,done=0,failed=0,consecutive=0,halted=false;const began=Date.now();
    await Promise.all(Array.from({length:4},async()=>{while(next<pool.length&&!halted){const row=pool[next++];try{await market.history(row.symbol,'day');consecutive=0;}catch(e){failed++;if(++consecutive>=12){halted=true;console.warn('行情源连续失败，保留已下载数据');}}done++;if(done%100===0)console.log(`历史 ${done}/${pool.length}，失败 ${failed}`);if(Date.now()-began>40*60*1000)halted=true;await new Promise(r=>setTimeout(r,150));}}));
    status.history={attemptedAt:new Date().toISOString(),done,total:pool.length,failed,complete:!halted&&failed===0};await fs.writeFile(path.join(dir,'web-history-status.json'),JSON.stringify(status.history));console.log(JSON.stringify(status.history));
  }
  await fs.writeFile(path.join(dir,'web-status.json'),JSON.stringify(status));
  if(process.env.GITHUB_STEP_SUMMARY){const summary=['## 公开行情自动更新',`- 抓取时间：${status.collectedAt}`,`- 市场、指数及ETF读取异常：${status.errors.length}`,withHistory?`- 历史处理：${status.history.done}/${status.history.total}，失败 ${status.history.failed}`:'- 本轮更新行情，历史日线保留到收盘后任务更新',...status.errors.map(message=>'- '+message)].join('\n');await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,summary+'\n');}
  return status;
}
if(require.main===module)collect().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={collect};
