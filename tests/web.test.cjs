const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {WebApi,aggregateBars}=require('../public/web-api.js'),analytics=require('../analytics.cjs'),{build}=require('../scripts/build-pages.cjs');
const bars=[['2026-07-01',10,10,11,9,1],['2026-07-02',10,8,10,7,2],['2026-07-03',8,12,13,8,3]];
function fixture({latency=0,count=2}={}){
 const symbols=Array.from({length:count},(_,i)=>'sh'+String(600000+i)),storage=new Map(),rows=symbols.map(symbol=>({symbol,code:symbol.slice(2),name:'测试'+symbol,price:12}));
 const manifest={version:'1',generatedAt:'2026-10-29T00:00:00Z',marketAsOf:'2026-10-28T08:00:00Z',rankingFrom:'2026-07-01',historyThrough:'2026-07-03',pool:rows,historyFiles:Object.fromEntries(symbols.map(symbol=>[symbol,'history/000.json.gz']))};
 const values={'manifest.json':manifest,'market.json':{rows,fetchedAt:manifest.marketAsOf},'indices.json':{rows:[]},'history/000.json.gz':Object.fromEntries(symbols.map(symbol=>[symbol,{bars,coverageStart:'2026-07-01',fetchedAt:manifest.marketAsOf,source:'公开数据'}]))};
 const requested=[];const api=new WebApi({base:'https://example.github.io/project/data/',analytics,storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},sleep:()=>new Promise(r=>setTimeout(r,latency)),fetcher:async url=>{requested.push(String(url));const key=new URL(url).pathname.split('/data/')[1],value=values[key];return {ok:!!value,status:value?200:404,json:async()=>value,arrayBuffer:async()=>zlib.gzipSync(JSON.stringify(value))};}});
 return {api,storage,values,requested,symbols};
}
test('Pages子路径和gzip日线正常，自选隔离保存在浏览器，不能写入文件路径',async()=>{
 const {api,requested}=fixture();assert.equal((await api.api('watchlist',{method:'PUT',body:JSON.stringify({codes:['sh600001','sh600001']})})).codes.length,1);
 assert.deepEqual((await api.api('watchlist')).codes,['sh600001']);await assert.rejects(api.api('watchlist',{method:'PUT',body:'{"codes":["../../private"]}'}));
 const h=await api.api('history?symbol=sh600000&period=day');assert.equal(h.bars.length,3);assert.equal(h.indicators.macd.length,3);assert.ok(requested.every(url=>url.startsWith('https://example.github.io/project/data/')));
 await assert.rejects(api.api('etf-ratio?group=../../private'),/不支持/);
});
test('网页区间排行和桌面公式一致，覆盖不足时明确拒绝，不能假装全市场完成',async()=>{
 const {api}=fixture();await assert.rejects(api.api('ranking',{method:'POST',body:'{"start":"2026-06-01","end":"2026-07-03","scope":"all"}'}),/2026-07-01/);
 await api.api('ranking',{method:'POST',body:'{"start":"2026-07-01","end":"2026-07-03","scope":"all"}'});await api.running;
 const j=await api.api('ranking');assert.equal(j.status,'complete');assert.equal(j.done,2);assert.equal(j.failed,0);assert.ok(j.rows.every(r=>r.drawdown===20&&r.maxGain===50&&Math.abs(r.change-20)<1e-10));
});
test('浏览器停止后恢复进度只计算未处理股票',async()=>{
 const {api}=fixture({count:201,latency:15});await api.api('ranking',{method:'POST',body:'{"start":"2026-07-01","end":"2026-07-03","scope":"all"}'});
 await new Promise(r=>setTimeout(r,5));await api.api('ranking',{method:'DELETE'});await api.running;const stopped=await api.api('ranking');assert.equal(stopped.status,'cancelled');assert.ok(stopped.done>0&&stopped.done<201);
 await api.api('ranking',{method:'POST',body:'{"start":"2026-07-01","end":"2026-07-03","scope":"all","resume":true}'});await api.running;const complete=await api.api('ranking');assert.equal(complete.done,201);assert.equal(new Set(complete.rows.map(r=>r.symbol)).size,201);
});
test('由日线聚合周月线保留首开末收和真实最高最低及成交量',()=>{
 const rows=bars.map(b=>({date:b[0],open:b[1],close:b[2],high:b[3],low:b[4],volume:b[5]}));const weekly=aggregateBars(rows,'week');assert.deepEqual(weekly,[{date:'2026-07-03',open:10,close:12,high:13,low:7,volume:6}]);
});
test('发布构建仅导出公开数据，不包含桌面自选和个人排行',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'guanlan-pages-')),data=path.join(root,'private'),out=path.join(root,'site');
 try{
  await fs.mkdir(path.join(data,'history'),{recursive:true});await fs.writeFile(path.join(data,'watchlist.json'),'["PRIVATE-WATCHLIST-MARKER"]');await fs.writeFile(path.join(data,'last-ranking.json'),'{"private":"PRIVATE-RANKING-MARKER"}');
  await fs.writeFile(path.join(data,'market.json'),JSON.stringify({rows:[{symbol:'sh600000',code:'600000',name:'公开股票',price:12,secret:'PRIVATE-FIELD-MARKER'}],source:'公开快照',fetchedAt:'2026-07-03T08:00:00Z'}));
  await fs.writeFile(path.join(data,'web-indices.json'),JSON.stringify({rows:[{symbol:'sh000001',price:3000}]}));
  await fs.writeFile(path.join(data,'history/v2_sh600000_day_2026-07-01_2026-07-03.json'),JSON.stringify({bars:bars.map(b=>({date:b[0],open:b[1],close:b[2],high:b[3],low:b[4],volume:b[5]})),adjustment:'前复权',source:'公开快照',fetchedAt:'2026-07-03T08:00:00Z'}));
  for(const id of ['csi300','sse50','star50']){const dir=path.join(data,'etf-ratio',id==='csi300'?'':id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'dataset-v3.json'),JSON.stringify({value:{group:{id},points:[{date:'2026-06-30'}]}}));}
  await build({dataDir:data,outputDir:out});const html=await fs.readFile(path.join(out,'index.html'),'utf8');assert.ok(html.includes('src="./web-api.js"'));assert.ok(!html.includes('src="/app.js"'));
  const market=await fs.readFile(path.join(out,'data/market.json'),'utf8');assert.ok(!market.includes('PRIVATE'));await assert.rejects(fs.access(path.join(out,'watchlist.json')));await assert.rejects(fs.access(path.join(out,'last-ranking.json')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
