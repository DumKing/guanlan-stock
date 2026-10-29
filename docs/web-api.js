(function(root,factory){const exported=factory();if(typeof module==='object'&&module.exports)module.exports=exported;else root.GuanlanWeb=new exported.WebApi({base:new URL('./data/',document.baseURI),analytics:root.GuanlanAnalytics});})(typeof window==='object'?window:globalThis,function(){
  const validSymbol=s=>/^(sh6\d{5}|sz[03]\d{5}|bj[489]\d{5})$/.test(s),GROUPS=['csi300','sse50','star50'];
  const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  function aggregateBars(bars,period){
    if(period==='day')return bars;const groups=new Map();
    for(const b of bars){const date=new Date(b.date+'T00:00:00Z');if(period==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const key=period==='month'?b.date.slice(0,7):date.toISOString().slice(0,10),old=groups.get(key);
      if(!old)groups.set(key,{...b});else {old.date=b.date;old.close=b.close;old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.volume=(old.volume||0)+(b.volume||0);}
    }return [...groups.values()];
  }
  class WebApi{
    constructor({base,analytics,fetcher=(...args)=>fetch(...args),storage=typeof localStorage==='object'?localStorage:null,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
      this.base=new URL(base);this.analytics=analytics;this.fetcher=fetcher;this.storage=storage;this.sleep=sleep;this.prefix='guanlan:'+this.base.pathname+':';this.documents=new Map();this.chunks=new Map();this.job=null;this.ready=false;this.running=null;
    }
    async document(name,force=false){
      if(force)this.documents.delete(name);if(!this.documents.has(name))this.documents.set(name,this.fetcher(new URL(name,this.base),{cache:'no-cache'}).then(async r=>{if(!r.ok)throw new Error('网站数据暂不可用（'+r.status+'）');return r.json();}).catch(e=>{this.documents.delete(name);throw e;}));return this.documents.get(name);
    }
    async syncManifest(){
      if(this.running)return this.document('manifest.json');if(this.manifestPending)return this.manifestPending;
      if(Date.now()-(this.lastManifestCheck||0)<15000)return this.document('manifest.json');
      this.manifestPending=this.document('manifest.json',true).then(manifest=>{
        if(this.manifestVersion&&this.manifestVersion!==manifest.generatedAt){for(const key of ['market.json','indices.json',...GROUPS.map(id=>'etf-'+id+'.json')])this.documents.delete(key);this.chunks.clear();}
        this.manifestVersion=manifest.generatedAt;this.lastManifestCheck=Date.now();return manifest;
      }).finally(()=>{this.manifestPending=null;});return this.manifestPending;
    }
    readLocal(key,fallback){try{return JSON.parse(this.storage?.getItem(this.prefix+key)||'null')??fallback;}catch{return fallback;}}
    saveLocal(key,value){try{this.storage?.setItem(this.prefix+key,JSON.stringify(value));}catch{this.storageWarning='浏览器存储空间不足，当前结果仍可导出，刷新后可能无法恢复。';}}
    async init(){if(this.ready)return;this.job=this.readLocal('ranking',null);if(this.job&&['running','stopping'].includes(this.job.status))this.job.status='cancelled';this.ready=true;}
    watchlist(codes){
      if(codes!==undefined){if(!Array.isArray(codes)||codes.length>100||!codes.every(validSymbol))throw new Error('自选代码无效，最多100只');this.saveLocal('watchlist',[...new Set(codes)]);}
      return {codes:this.readLocal('watchlist',['sh600519','sz300750','sz002594','sh601318','sz000858','sh600036'])};
    }
    async quote(codes){const manifest=await this.syncManifest();const market=await this.document('market.json'),indices=await this.document('indices.json');const rows=[...market.rows,...indices.rows].filter(r=>codes.includes(r.symbol));return {rows,missing:codes.filter(s=>!rows.some(r=>r.symbol===s)),fetchedAt:market.fetchedAt,source:market.source,snapshot:true,historyThrough:manifest.historyThrough,dataWarnings:manifest.dataWarnings||[]};}
    async history(symbol,period='day',start='',end=''){
      if(!validSymbol(symbol)||!['day','week','month'].includes(period))throw new Error('K线参数无效');const manifest=await this.document('manifest.json'),file=manifest.historyFiles[symbol];if(!file)throw new Error('该股票尚无已发布的历史快照');
      if(!this.chunks.has(file))this.chunks.set(file,this.fetcher(new URL(file,this.base)).then(async response=>{if(!response.ok)throw new Error('历史快照读取失败');const bytes=new Uint8Array(await response.arrayBuffer());let text;if(bytes[0]===31&&bytes[1]===139){if(typeof DecompressionStream!=='function')throw new Error('请使用支持解压数据的新版本浏览器');text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}else text=new TextDecoder().decode(bytes);return JSON.parse(text);}).catch(e=>{this.chunks.delete(file);throw e;}));
      const row=(await this.chunks.get(file))[symbol];if(!row)throw new Error('缺少该股票的历史快照');if(start&&start<row.coverageStart)throw new Error('该股票的历史快照从'+row.coverageStart+'开始，请缩短区间');
      const daily=row.bars.filter(b=>(!start||b[0]>=start)&&(!end||b[0]<=end)).map(b=>({date:b[0],open:b[1],close:b[2],high:b[3],low:b[4],volume:b[5]})),bars=aggregateBars(daily,period);
      return {bars,indicators:this.analytics.indicators(bars),fetchedAt:row.fetchedAt,source:row.source+' · 网站发布快照',adjustment:'前复权',period};
    }
    snapshot(){if(!this.job)return null;const {pool,outcomes,...value}=this.job;return {...value,rows:[...this.job.rows],resumable:!!pool&&!!outcomes&&this.job.done>0};}
    async start({start,end,scope,resume=false}){
      if(this.running||['running','stopping'].includes(this.job?.status))throw new Error('已有计算，请先停止');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if(!validDate(start)||!validDate(end)||start>=end||end>today||Date.parse(end)-Date.parse(start)>730*86400000)throw new Error('请选择有效区间，最长两年，结束日期不能晚于今天');
      if(!['all','watchlist'].includes(scope))throw new Error('股票范围无效');const manifest=await this.document('manifest.json');if(start<manifest.rankingFrom)throw new Error('网页版当前全市场历史快照从'+manifest.rankingFrom+'开始，请调整起始日');
      const prior=this.job;if(resume&&(!prior||prior.start!==start||prior.end!==end||prior.scope!==scope||!prior.pool))throw new Error('没有同区间的可继续任务');
      const pool=resume?prior.pool:scope==='all'?manifest.pool:manifest.pool.filter(r=>this.watchlist().codes.includes(r.symbol)),outcomes=resume?Object.fromEntries(Object.entries(prior.outcomes).filter(([,s])=>s!=='failed')):{};
      const rows=resume?[...prior.rows]:[],skipped=Object.values(outcomes).filter(s=>s==='skipped').length;
      this.job={id:String(Date.now()),start,end,scope,status:'running',pool,outcomes,rows,skipped,failed:0,done:rows.length+skipped,total:pool.length,errors:[],startedAt:new Date().toISOString(),phase:'在浏览器读取已发布日线并计算',universeSource:'网站公开股票池快照',universeFetchedAt:manifest.marketAsOf};
      const current=this.job;this.running=this.run(current).catch(e=>{current.status='error';current.error=e.message;this.saveLocal('ranking',current);}).finally(()=>{this.running=null;});return this.snapshot();
    }
    async run(job){
      for(const row of job.pool){if(job.status!=='running')break;if(job.outcomes[row.symbol])continue;
        try{const history=await this.history(row.symbol,'day',job.start,job.end),stats=this.analytics.rangeStats(history.bars);if(stats){job.rows.push({...row,...stats,historySource:history.source});job.outcomes[row.symbol]='ok';}else {job.skipped++;job.outcomes[row.symbol]='skipped';}}
        catch(e){job.failed++;job.outcomes[row.symbol]='failed';if(job.errors.length<20)job.errors.push({...row,message:e.message});}
        job.done++;if(job.done%100===0){this.saveLocal('ranking',job);await this.sleep(0);}
      }
      job.status=job.status==='stopping'?'cancelled':'complete';job.finishedAt=new Date().toISOString();if(this.storageWarning)job.error=this.storageWarning;this.saveLocal('ranking',job);
    }
    async api(route,options={}){
      await this.init();const url=new URL(route,'https://local.invalid/'),name=url.pathname.slice(1),method=options.method||'GET',body=()=>JSON.parse(options.body||'{}');
      if(name==='watchlist')return this.watchlist(method==='PUT'?body().codes:undefined);
      if(name==='indices'){await this.syncManifest();return this.document('indices.json');}
      if(name==='quotes')return this.quote((url.searchParams.get('codes')||'').split(',').filter(Boolean));
      if(name==='market'){await this.syncManifest();return this.document('market.json',url.searchParams.has('refresh'));}
      if(name==='search'){const q=(url.searchParams.get('q')||'').trim().toLowerCase(),manifest=await this.document('manifest.json');return {rows:q?manifest.pool.filter(r=>r.code.includes(q)||r.name.toLowerCase().includes(q)||r.symbol.includes(q)).slice(0,15):[]};}
      if(name==='history')return this.history(url.searchParams.get('symbol'),url.searchParams.get('period')||'day');
      if(name==='etf-ratio'){const group=url.searchParams.get('group')||'csi300';if(!GROUPS.includes(group))throw new Error('不支持的ETF指数类型');await this.syncManifest();return this.document('etf-'+group+'.json',url.searchParams.has('refresh'));}
      if(name==='ranking'){if(method==='POST')return this.start(body());if(method==='DELETE'&&this.job?.status==='running')this.job.status='stopping';return this.snapshot();}
      if(name==='settings'){const manifest=await this.document('manifest.json');return {...manifest,dataDir:'当前浏览器 · 自选与排行仅保存在本机；公开数据随网站发布更新',snapshot:true};}
      throw new Error('网页功能不存在');
    }
  }
  return {WebApi,aggregateBars,validDate};
});
