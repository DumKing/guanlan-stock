const fs=require('node:fs/promises');
const path=require('node:path');
const zlib=require('node:zlib');
const {validSymbol}=require('../market.cjs');
const FIELDS=['symbol','code','name','price','previous','open','volume','change','high','low','amount','turnover','pe','marketCap','time'];
const ROOT=path.resolve(__dirname,'..');
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function write(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data));}
async function build({dataDir=path.join(ROOT,'data'),outputDir=path.join(ROOT,'docs'),indicesFile=path.join(dataDir,'web-indices.json')}={}){
  const dataOut=path.join(outputDir,'data'),prior=await read(path.join(dataOut,'manifest.json'));
  const records=new Map();
  if(prior){for(const name of new Set(Object.values(prior.historyFiles||{}))){const bytes=await fs.readFile(path.join(dataOut,name));const rows=JSON.parse(zlib.gunzipSync(bytes));for(const [symbol,row] of Object.entries(rows))records.set(symbol,row);}}
  const cachedMarket=await read(path.join(dataDir,'market.json'));
  const oldMarket=await read(path.join(dataOut,'market.json'));
  const market=cachedMarket?.rows?.length?cachedMarket:oldMarket;
  if(!market?.rows?.length)throw new Error('缺少公开全市场行情快照，请先运行 npm run web:collect');
  const cleanRows=market.rows.filter(r=>validSymbol(r.symbol)&&!(/退|^PT/.test(r.name||''))).map(r=>Object.fromEntries(FIELDS.filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
  const snapshot=await read(path.join(ROOT,'assets/stock-universe.json'));
  const pool=new Map((snapshot?.rows||[]).filter(r=>validSymbol(r.symbol)).map(r=>[r.symbol,{symbol:r.symbol,code:r.code,name:r.name}]));
  for(const r of cleanRows)pool.set(r.symbol,{symbol:r.symbol,code:r.code,name:r.name});
  const files=(await fs.readdir(path.join(dataDir,'history')).catch(()=>[])).filter(name=>/^v2_(sh6\d{5}|sz[03]\d{5}|bj[489]\d{5})_day_(\d{4}-\d{2}-\d{2})?_(\d{4}-\d{2}-\d{2})?\.json$/.test(name));
  for(const name of files){
    const match=name.match(/^v2_(.+)_day_(.*?)_(.*?)\.json$/),symbol=match[1];if(!pool.has(symbol))continue;
    const value=await read(path.join(dataDir,'history',name));if(value?.adjustment!=='前复权'||!Array.isArray(value.bars))continue;
    const bars=value.bars.filter(b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.close>0).map(b=>[b.date,b.open,b.close,b.high,b.low,b.volume]);
    const old=records.get(symbol),coverageStart=match[2]||'1990-01-01';
    if(!old||bars.length>old.bars.length||(bars.length===old.bars.length&&value.fetchedAt>old.fetchedAt))records.set(symbol,{bars,fetchedAt:value.fetchedAt,source:value.source,coverageStart});
  }
  await fs.mkdir(dataOut,{recursive:true});
  const symbols=[...pool.keys()].sort(),historyFiles={};let rankingFrom='1990-01-01',historyThrough='';
  for(let i=0;i<symbols.length;i+=100){
    const chunk={};for(const symbol of symbols.slice(i,i+100)){const row=records.get(symbol);if(!row)continue;chunk[symbol]=row;rankingFrom=rankingFrom>row.coverageStart?rankingFrom:row.coverageStart;const last=row.bars.at(-1)?.[0];if(last&&last>historyThrough)historyThrough=last;}
    const relative='history/'+String(i/100).padStart(3,'0')+'.json.gz';await fs.mkdir(path.join(dataOut,'history'),{recursive:true});
    await fs.writeFile(path.join(dataOut,relative),zlib.gzipSync(JSON.stringify(chunk),{level:9}));for(const symbol of Object.keys(chunk))historyFiles[symbol]=relative;
  }
  await write(path.join(dataOut,'market.json'),{...Object.fromEntries(['source','fetchedAt','stale','fallback','error'].filter(k=>market[k]!==undefined).map(k=>[k,market[k]])),rows:cleanRows});
  const indices=await read(indicesFile)||await read(path.join(dataOut,'indices.json'));if(!indices?.rows?.length)throw new Error('缺少公开指数行情快照');
  await write(path.join(dataOut,'indices.json'),indices);
  for(const id of ['csi300','sse50','star50']){
    const source=path.join(dataDir,'etf-ratio',id==='csi300'?'':id,'dataset-v3.json'),cached=await read(source);
    const dataset=cached?.value||await read(path.join(dataOut,'etf-'+id+'.json'));
    if(!dataset?.points?.length||dataset.group?.id!==id)throw new Error('缺少 '+id+' ETF 公开数据');
    await write(path.join(dataOut,'etf-'+id+'.json'),dataset);
  }
  const health=await read(path.join(dataDir,'web-status.json')),historyHealth=await read(path.join(dataDir,'web-history-status.json'));
  const dataWarnings=[...(health?.errors||[]),...(historyHealth&&!historyHealth.complete?['部分历史日线更新未完成，保留已有快照']:[])];
  const manifest={updatePolicy:'交易时段约每15分钟更新行情，16:35后更新日线；GitHub排队可能延迟',dataWarnings,version:require('../package.json').version,generatedAt:new Date().toISOString(),marketAsOf:market.fetchedAt,historyThrough,rankingFrom,historyCount:Object.keys(historyFiles).length,pool:[...pool.values()],historyFiles};
  await write(path.join(dataOut,'manifest.json'),manifest);
  let html=await fs.readFile(path.join(ROOT,'public/index.html'),'utf8');
  html=html.replaceAll('href="/style.css"','href="./style.css"').replaceAll('src="/app.js"','src="./app.js"').replaceAll('src="/etf.js"','src="./etf.js"');
  html=html.replace('<script src="./app.js"></script>','<script src="./analytics-web.js"></script>\n  <script src="./web-api.js"></script>\n  <script src="./app.js"></script>');
  html=html.replace('<span>LOCAL</span>','<span>WEB</span>').replace('本地运行 · 数据私有','网页快照 · 自选仅存本机').replace('行情与自选<span','行情与自选<span');
  html=html.replace('<div id="notice"','<div class="web-snapshot-note" id="webSnapshotNote">正在读取公开行情快照；自选股仅保存在当前浏览器。</div>\n    <div id="notice"');
  html=html.replace('公开行情，30 秒刷新。','公开行情快照，按计划自动更新。').replace('腾讯证券公开行情，30 秒刷新','公开行情快照，以页面标注时间为准').replace('在本机根据前复权日线收盘价计算','在浏览器根据已发布前复权日线计算').replace('本机存储</h2>','浏览器存储</h2>').replace('自选股、行情快照、历史缓存和最近一次排行保存在你的电脑。','自选股与最近一次排行保存在当前浏览器；公开行情、K线与ETF数据来自网站发布快照。').replace('公开接口可能存在延迟、缺失或限流。刷新时间是本机取得数据的时间；个股另显示行情源时间。离线时不会生成模拟行情。','GitHub Pages 展示发布时的公开行情快照，不是盘中实时行情。页面更新按钮检查最新已发布数据；行情、历史和ETF报告分别保留来源时间。').replace('第一版不连接券商、不执行交易。你可以导出 CSV，在其他软件中继续分析。','网页版不连接券商、不执行交易。不同浏览器的自选互不共享；可导出 CSV 继续分析。');
  await fs.mkdir(outputDir,{recursive:true});await fs.writeFile(path.join(outputDir,'index.html'),html);
  for(const file of ['app.js','etf.js','style.css','web-api.js'])await fs.copyFile(path.join(ROOT,'public',file),path.join(outputDir,file));
  await fs.writeFile(path.join(outputDir,'analytics-web.js'),'(()=>{const module={exports:{}};\n'+await fs.readFile(path.join(ROOT,'analytics.cjs'),'utf8')+'\nwindow.GuanlanAnalytics=module.exports;})();\n');
  await fs.writeFile(path.join(outputDir,'.nojekyll'),'');
  console.log(JSON.stringify({outputDir,stocks:symbols.length,histories:manifest.historyCount,rankingFrom,historyThrough,marketAsOf:market.fetchedAt}));return manifest;
}
if(require.main===module){const args=process.argv.slice(2),option=name=>args.includes(name)?path.resolve(args[args.indexOf(name)+1]):undefined;build({dataDir:option('--data-dir'),outputDir:option('--output'),indicesFile:option('--indices-file')}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={build};
