const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { rangeStats, indicators } = require('./analytics.cjs');
const DEFAULT_WATCH = ['sh600519','sz300750','sz002594','sh601318','sz000858','sh600036'];
const INDEX_CODES = ['sh000001','sz399001','sz399006','sh000300'];
const validSymbol = s => /^(sh6\d{5}|sz[03]\d{5}|bj[489]\d{5})$/.test(s);
const shanghaiDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const number = value => value === '' || value === '-' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const networkAgent=new https.Agent({keepAlive:true,maxSockets:8,proxyEnv:process.env});

function requestOnce(url, encoding='utf-8') {
  return new Promise((resolve,reject)=>{
    const host=new URL(url).hostname;
    const referer=host.includes('sse.com.cn')?'https://www.sse.com.cn/':host.includes('sina')?'https://finance.sina.com.cn/':host.includes('fund')&&host.includes('eastmoney')?'https://fundf10.eastmoney.com/':host.includes('eastmoney')?'https://quote.eastmoney.com/':'https://finance.qq.com/';
    const req=https.get(url,{agent:networkAgent,headers:{'User-Agent':'Mozilla/5.0','Referer':referer}},res=>{
      if(res.statusCode!==200){res.resume();reject(new Error(`行情服务 HTTP ${res.statusCode}`));return;}
      const chunks=[]; let length=0;
      res.on('data',x=>{length+=x.length;if(length>12e6){req.destroy(new Error('行情响应过大'));return;}chunks.push(x);});
      res.on('end',()=>resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks))));
      res.on('error',reject);
      res.on('aborted',()=>reject(new Error('行情连接中断')));
    });
    req.setTimeout(15000,()=>req.destroy(new Error('行情服务连接超时，请稍后重试')));
    req.on('error',reject);
  });
}
function transient(error) {return /ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|timeout|超时|中断|HTTP (429|5\d\d)/i.test(error.code+' '+error.message)||error instanceof SyntaxError;}
async function retry(work,{attempts=3,delay=500,shouldRetry=transient,onRetry=()=>{}}={}) {
  for(let attempt=1;;attempt++){
    try{return await work(attempt);}catch(error){
      if(attempt>=attempts||!shouldRetry(error))throw error;
      onRetry(error,attempt);await sleep(delay*2**(attempt-1));
    }
  }
}
const request=(url,encoding)=>retry(()=>requestOnce(url,encoding));
async function atomicJSON(file, data) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp'; await fs.writeFile(tmp,JSON.stringify(data)); await fs.rename(tmp,file);
}
async function readJSON(file) { try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT') return null;throw e;} }

class Market {
  constructor(dir) { this.dir=dir;this.quoteCache=new Map();this.historyPending=new Map();this.marketCache=null;this.marketPending=null;this.job=null;this.writeQueue=Promise.resolve();this.checkpointQueue=Promise.resolve();this.historyProvider='tencent';this.historyBlockedUntil={}; }
  async watchlist(codes) {
    const file=path.join(this.dir,'watchlist.json');
    if(codes!==undefined){
      if(!Array.isArray(codes)||codes.length>100||!codes.every(validSymbol)) throw new Error('自选股代码无效，最多添加 100 只');
      const unique=[...new Set(codes)];
      this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>atomicJSON(file,unique)); await this.writeQueue; return unique;
    }
    return (await readJSON(file))??DEFAULT_WATCH;
  }
  async quotes(codes) {
    if(!codes.length) return {rows:[],source:'腾讯证券公开行情',fetchedAt:new Date().toISOString()};
    if(codes.length>110||!codes.every(s=>validSymbol(s)||INDEX_CODES.includes(s))) throw new Error('行情代码无效');
    const key=codes.join(','); const cached=this.quoteCache.get(key);
    if(cached&&Date.now()-cached.time<15000)return cached.value;
    const raw=await request('https://qt.gtimg.cn/q='+key,'gb18030'); const rows=[];
    for(const match of raw.matchAll(/v_(\w+)="([^"]*)"/g)) {
      const a=match[2].split('~');if(a.length<47||!number(a[3]))continue;
      rows.push({symbol:match[1],code:a[2],name:a[1],price:number(a[3]),previous:number(a[4]),open:number(a[5]),volume:number(a[6]),
        change:number(a[32]),high:number(a[33]),low:number(a[34]),amount:number(a[37])===null?null:number(a[37])*10000,
        turnover:number(a[38]),pe:number(a[39]),marketCap:number(a[45])===null?null:number(a[45])*1e8,time:a[30]});
    }
    if(!rows.length)throw new Error('行情源没有返回有效数据');
    const value={rows,source:'腾讯证券公开行情',fetchedAt:new Date().toISOString(),missing:codes.filter(s=>!rows.some(r=>r.symbol===s))};
    this.quoteCache.set(key,{time:Date.now(),value}); return value;
  }
  async universe(force=false,onProgress=()=>{}) {
    if(this.marketPending) return this.marketPending;
    const cached=this.marketCache??await readJSON(path.join(this.dir,'market.json'));
    if(cached){this.marketCache=cached;if(!force&&Date.now()-Date.parse(cached.fetchedAt)<300000)return {...cached,stale:false};}
    this.marketPending=this.loadUniverse(onProgress).catch(async error=>{
      onProgress('主行情源连接失败，正在切换备用源');
      try{return await this.loadSinaUniverse(onProgress);}catch(backupError){
        if(this.marketCache)return {...this.marketCache,stale:true,error:`主源：${error.message}；备用源：${backupError.message}`};
        throw new Error(`股票池暂不可用：主源 ${error.message}；备用源 ${backupError.message}。可稍后重试。`);
      }
    }).finally(()=>{this.marketPending=null;});
    return this.marketPending;
  }
  async loadUniverse(onProgress=()=>{}) {
    const getPage=async page=>{
      const params=new URLSearchParams({pn:String(page),pz:'100',po:'0',np:'1',fltt:'2',invt:'2',fid:'f12',
        fs:'m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',fields:'f2,f3,f5,f6,f8,f9,f12,f13,f14,f20,f15,f16,f17,f18,f124'});
      const obj=JSON.parse(await request('https://80.push2.eastmoney.com/api/qt/clist/get?'+params));
      if(!obj.data||!Array.isArray(obj.data.diff)||!obj.data.diff.length)throw new Error('全市场行情暂不可用');return obj.data;
    };
    const first=await getPage(1);const pages=Math.ceil(first.total/first.diff.length); const data=[...first.diff];let next=2;
    let failure;let loaded=1;
    await Promise.all(Array.from({length:3},async()=>{while(next<=pages&&!failure){const page=next++;try{const d=await getPage(page);data.push(...d.diff);onProgress(`正在读取股票池 ${++loaded} / ${pages} 页`);}catch(e){failure=e;}await sleep(100);}}));
    if(failure)throw failure;
    const seen=new Set();const rows=[];
    for(const a of data){
      const symbol=(String(a.f12).startsWith('6')?'sh':/^[489]/.test(a.f12)?'bj':'sz')+a.f12;
      if(!validSymbol(symbol)||seen.has(symbol))continue;seen.add(symbol);
      rows.push({symbol,code:a.f12,name:a.f14,price:number(a.f2),change:number(a.f3),volume:number(a.f5),amount:number(a.f6),
        turnover:number(a.f8),pe:number(a.f9),marketCap:number(a.f20),high:number(a.f15),low:number(a.f16),open:number(a.f17),
        previous:number(a.f18),time:a.f124?new Date(a.f124*1000).toISOString():null});
    }
    if(rows.length<first.total*.95)throw new Error('全市场行情不完整，请重试');
    const value={rows,total:first.total,fetchedAt:new Date().toISOString(),source:'东方财富公开行情',stale:false};
    await atomicJSON(path.join(this.dir,'market.json'),value);this.marketCache=value;return value;
  }
  async loadSinaUniverse(onProgress=()=>{}) {
    const root='https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.';
    const total=Number(JSON.parse(await request(root+'getHQNodeStockCount?node=hs_a')));
    if(!Number.isInteger(total)||total<1||total>20000)throw new Error('备用股票池数量无效');
    const pages=Math.ceil(total/80),data=[];let next=1,loaded=0,failure;
    await Promise.all(Array.from({length:3},async()=>{
      while(next<=pages&&!failure){const page=next++;
        try{
          const batch=await retry(async()=>{const rows=JSON.parse(await requestOnce(root+`getHQNodeData?page=${page}&num=80&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=init`));if(!Array.isArray(rows)||!rows.length)throw new Error('备用行情返回空页');return rows;},{shouldRetry:()=>true});
          data.push(...batch);onProgress(`正在读取备用股票池 ${++loaded} / ${pages} 页`);
        }catch(e){failure=e;}await sleep(120);
      }
    }));
    if(failure)throw failure;
    const seen=new Set();const rows=[];
    for(const a of data){if(!validSymbol(a.symbol)||seen.has(a.symbol))continue;seen.add(a.symbol);
      rows.push({symbol:a.symbol,code:a.code,name:a.name,price:number(a.trade),change:number(a.changepercent),volume:number(a.volume)===null?null:number(a.volume)/100,
        amount:number(a.amount),turnover:number(a.turnoverratio),pe:null,marketCap:number(a.mktcap)===null?null:number(a.mktcap)*10000,
        high:number(a.high),low:number(a.low),open:number(a.open),previous:number(a.settlement),time:null,sourceTime:a.ticktime||null});
    }
    if(rows.length<total*.98)throw new Error('备用行情页数不完整，请重试');
    // Keep a dated, public listing snapshot separate from live quotes. The backup
    // feed may omit some listings; those remain eligible for history calculations.
    const snapshot=await readJSON(path.join(__dirname,'assets','stock-universe.json'));
    const pool=new Map((snapshot?.rows||[]).map(r=>[r.symbol,r]));
    for(const r of rows)pool.set(r.symbol,{symbol:r.symbol,code:r.code,name:r.name});
    const value={rows,total:rows.length,poolRows:[...pool.values()],fetchedAt:new Date().toISOString(),source:'新浪财经备用行情',stale:false,
      fallback:true,poolSnapshotAt:snapshot?.asOf,coverageNote:'备用行情未提供可核对的动态市盈率与交易日期，相关字段留空；排行股票池合并已保存的上市名单快照。'};
    await atomicJSON(path.join(this.dir,'market.json'),value);this.marketCache=value;return value;
  }
  async search(q) {
    q=q.trim().slice(0,40);if(!q)return [];
    if(this.marketCache) {const found=this.marketCache.rows.filter(r=>r.code.includes(q)||r.name.includes(q)).slice(0,15);if(found.length)return found;}
    if(/^\d{6}$/.test(q)){const symbol=(q.startsWith('6')?'sh':/^[489]/.test(q)?'bj':'sz')+q;if(!validSymbol(symbol))return [];return (await this.quotes([symbol])).rows;}
    const raw=await request('https://smartbox.gtimg.cn/s3/?q='+encodeURIComponent(q)+'&t=all','gb18030');
    const text=raw.match(/="(.*)"/s)?.[1];if(!text)return [];
    const decoded=text.replace(/\\u([0-9a-fA-F]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    return decoded.split('^').map(s=>s.split('~')).filter(a=>validSymbol(a[0]+a[1])&&a[4]==='GP-A').slice(0,15).map(a=>({symbol:a[0]+a[1],code:a[1],name:a[2]}));
  }
  async history(symbol,period='day',start='',end='') {
    if(!validSymbol(symbol)||!['day','week','month'].includes(period))throw new Error('K 线参数无效');
    const key=['v2',symbol,period,start,end].join('_');if(this.historyPending.has(key))return this.historyPending.get(key);
    const work=this.loadHistory(symbol,period,start,end,key).finally(()=>this.historyPending.delete(key));this.historyPending.set(key,work);return work;
  }
  async loadHistory(symbol,period,start,end,key) {
    const file=path.join(this.dir,'history',key+'.json');const cached=await readJSON(file);const now=Date.now();
    // A single retrieval spans the whole requested range so all prices share one adjustment basis.
    const ttl=end&&end<shanghaiDay()?86400000:300000;
    const chinaNow=new Date().toLocaleString('en-GB',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit'});
    const cachedDay=cached?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(cached.fetchedAt)):null;
    const sameClosedDay=end===shanghaiDay()&&Number(chinaNow)>=17&&cachedDay===shanghaiDay();
    if(cached&&(now-Date.parse(cached.fetchedAt)<ttl||sameClosedDay))return {...cached,cacheHit:true};
    // The provider's end bound is exclusive. Ask through the next calendar day,
    // then filter locally so the user's selected end date is inclusive.
    const providerEnd=end?new Date(Date.parse(end)+86400000).toISOString().slice(0,10):'';
    const param=[symbol,period,start,providerEnd,640,'qfq'].join(',');
    let source,providerName;const errors=[];
    const providers=[this.historyProvider,this.historyProvider==='tencent'?'eastmoney':'tencent'];
    for(const provider of providers){
      if(this.historyBlockedUntil[provider]>Date.now()){errors.push(provider+' 暂时不可用');continue;}
      try{
        providerName=provider==='tencent'?'腾讯证券历史行情':'东方财富前复权历史行情';
        if(provider==='tencent'){
          const result=await retry(async()=>JSON.parse(await requestOnce('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param='+param)),{attempts:2});
          const data=result.data?.[symbol];source=data?.['qfq'+period]??data?.[period];providerName='腾讯证券历史行情';
        }else{
          const query=new URLSearchParams({secid:(symbol.startsWith('sh')?'1.':'0.')+symbol.slice(2),klt:{day:'101',week:'102',month:'103'}[period],fqt:'1',
            beg:start?start.replaceAll('-',''):'19900101',end:end?end.replaceAll('-',''):'20500101',lmt:'640',fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56'});
          const result=await retry(async()=>JSON.parse(await requestOnce('https://push2his.eastmoney.com/api/qt/stock/kline/get?'+query)),{attempts:2});
          source=result.data?.klines?.map(row=>row.split(','));providerName='东方财富前复权历史行情';
        }
        if(!Array.isArray(source))throw new Error('未取得该股票的历史数据');
        if(start&&source.length>=640&&source[0][0]>start)throw new Error('历史接口未覆盖所选区间的开始日期，请缩短范围');
        this.historyProvider=provider;break;
      }catch(error){
        source=null;errors.push(providerName+': '+error.message);
        if(transient(error))this.historyBlockedUntil[provider]=Date.now()+120000;
      }
    }
    if(!Array.isArray(source))throw new Error('历史行情不可用：'+errors.join('；'));
    const bars=source.map(a=>({date:a[0],open:number(a[1]),close:number(a[2]),high:number(a[3]),low:number(a[4]),volume:number(a[5])}))
      .filter(b=>b.close>0&&(!start||b.date>=start)&&(!end||b.date<=end));
    if(bars.length>=640&&start&&bars[0].date>start)throw new Error('区间超过数据源单次上限，请缩短日期范围');
    const value={bars,fetchedAt:new Date().toISOString(),source:providerName,adjustment:'前复权',period};
    await atomicJSON(file,value);return value;
  }
  async detail(symbol,period) {
    const value=await this.history(symbol,period);return {...value,indicators:indicators(value.bars)};
  }
  async startRanking({start,end,scope,resume=false}) {
    if(this.rankingTask||['running','stopping','pausing'].includes(this.job?.status))throw new Error('已有计算或进度保存正在进行，请稍候再试');
    const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
    if(!validDate(start)||!validDate(end)||start>=end||end>shanghaiDay()||start<'1990-01-01')throw new Error('请选择有效的起止日期，结束日期不能晚于今天');
    if((Date.parse(end)-Date.parse(start))/86400000>730)throw new Error('第一版支持最长两年的区间，请缩短范围');
    if(!['all','watchlist'].includes(scope))throw new Error('选股范围无效');
    const prior=this.job;
    if(resume&&(!prior||prior.start!==start||prior.end!==end||prior.scope!==scope||!prior.outcomes))throw new Error('没有可继续的同区间任务，请点击开始计算');
    const outcomes=resume?Object.fromEntries(Object.entries(prior.outcomes).filter(([,status])=>status!=='failed')):{};
    const rows=resume?[...prior.rows]:[];const skipped=Object.values(outcomes).filter(s=>s==='skipped').length;
    const job={id:Date.now().toString(),status:'running',start,end,scope,total:resume?prior.total:0,done:rows.length+skipped,failed:0,skipped,rows,errors:[],outcomes,
      startedAt:new Date().toISOString(),phase:resume?'继续上次进度':'正在读取股票范围',...(resume?{pool:prior.pool,resumedFrom:prior.id,universeFetchedAt:prior.universeFetchedAt,universeSource:prior.universeSource,universeStale:prior.universeStale,poolSnapshotAt:prior.poolSnapshotAt}:{} )};
    this.job=job;
    this.rankingTask=this.runRanking(job).catch(async e=>{job.status='error';job.error=e.message;job.finishedAt=new Date().toISOString();await this.persistJob(job).catch(()=>{});}).finally(()=>{this.rankingTask=null;});return this.jobSnapshot();
  }
  async rankingUniverse(onProgress) {
    try{
      const market=await this.universe(false,onProgress);
      if(market.fallback){
        const snapshot=await readJSON(path.join(__dirname,'assets','stock-universe.json'));
        const rows=new Map((snapshot?.rows||[]).map(r=>[r.symbol,r]));for(const r of market.rows)rows.set(r.symbol,{symbol:r.symbol,code:r.code,name:r.name});
        return {...market,poolRows:[...rows.values()],poolSnapshotAt:snapshot?.asOf};
      }
      return {...market,poolRows:market.rows.filter(r=>r.price>0&&!/退|^PT/.test(r.name))};
    }catch(error){
      const snapshot=await readJSON(path.join(__dirname,'assets','stock-universe.json'));
      if(!snapshot?.rows?.length)throw error;
      return {rows:snapshot.rows,poolRows:snapshot.rows,source:'本机上市名单快照',fetchedAt:snapshot.asOf,poolSnapshotAt:snapshot.asOf,stale:true,error:error.message};
    }
  }
  persistJob(job) {
    const snapshot={...job,rows:[...job.rows],outcomes:{...job.outcomes}};
    this.checkpointQueue=this.checkpointQueue.catch(()=>{}).then(()=>atomicJSON(path.join(this.dir,'last-ranking.json'),snapshot));return this.checkpointQueue;
  }
  async runRanking(job) {
    let pool=job.pool;
    if(!pool){
      if(job.scope==='all'){const m=await this.rankingUniverse(phase=>{job.phase=phase;});pool=m.poolRows??m.rows;job.universeFetchedAt=m.fetchedAt;job.universeStale=!!m.stale;job.universeSource=m.source;job.poolSnapshotAt=m.poolSnapshotAt;}
      else {const codes=await this.watchlist();pool=(await this.quotes(codes)).rows;}
    }
    job.pool=pool.map(({symbol,code,name})=>({symbol,code,name}));
    if(job.status!=='running'){if(job.status==='stopping')job.status='cancelled';await this.persistJob(job);return;}
    job.total=pool.length;job.phase='读取前复权日线并计算（网络中断自动重试）';let next=0;
    const pending=pool.filter(r=>!job.outcomes[r.symbol]);await this.persistJob(job);let savedAt=Date.now();
    await Promise.all(Array.from({length:4},async()=>{
      while(next<pending.length&&job.status==='running'){
        const row=pending[next++];let cacheHit=false;
        try{const h=await this.history(row.symbol,'day',job.start,job.end);cacheHit=!!h.cacheHit;job.consecutiveErrors=0;const stats=rangeStats(h.bars);if(stats){job.rows.push({...row,...stats,historySource:h.source});job.outcomes[row.symbol]='ok';}else {job.skipped++;job.outcomes[row.symbol]='skipped';}}
        catch(e){job.failed++;job.outcomes[row.symbol]='failed';if(job.errors.length<20)job.errors.push({symbol:row.symbol,name:row.name,message:e.message});
          if(transient(e)||/暂时不可用/.test(e.message)){job.consecutiveErrors=(job.consecutiveErrors||0)+1;if(job.consecutiveErrors>=8&&job.status==='running'){job.status='pausing';job.error='历史行情源连续连接失败，已自动暂停并保存进度。稍后点击“继续上次进度”，已成功的股票无需重算。';}}
        }
        job.done++;if(job.status==='running'&&!cacheHit)await sleep(150);
        if(job.done%20===0||Date.now()-savedAt>5000){savedAt=Date.now();await this.persistJob(job);}
      }
    }));
    if(job.status==='running')job.status='complete';else if(job.status==='stopping')job.status='cancelled';else if(job.status==='pausing')job.status='paused';job.finishedAt=new Date().toISOString();
    await this.persistJob(job);
  }
  jobSnapshot() {if(!this.job)return null;const {pool,outcomes,...snapshot}=this.job;return {...snapshot,rows:[...this.job.rows],resumable:!!pool&&!!outcomes&&snapshot.done>0};}
  cancelRanking() {if(this.job?.status==='running')this.job.status='stopping';return this.jobSnapshot();}
}
module.exports={Market,validSymbol,INDEX_CODES,rangeStats,indicators,retry,request};
