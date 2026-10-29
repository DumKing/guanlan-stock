const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Market,INDEX_CODES}=require('./market.cjs');
const {EtfRatio,ETF_GROUPS}=require('./etf-ratio.cjs');

async function createServer({dataDir=path.join(__dirname,'data'),port=0}={}) {
  const market=new Market(dataDir);market.job=await (async()=>{try{const j=JSON.parse(await fs.readFile(path.join(dataDir,'last-ranking.json'),'utf8'));if(['running','stopping','pausing'].includes(j.status))j.status='cancelled';return j;}catch{return null;}})();
  const etfRatios=new Map(Object.keys(ETF_GROUPS).map(id=>[id,new EtfRatio(dataDir,id)]));let origin;
  const server=http.createServer(async(req,res)=>{
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      if(req.headers.host!==new URL(origin).host)return json({error:'无效来源'},403);
      const url=new URL(req.url,origin);const p=url.pathname;
      if(req.headers.origin&&req.headers.origin!==origin)return json({error:'不允许跨站请求'},403);
      const body=async()=>{
        if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('请求格式无效');
        let text='';for await(const chunk of req){text+=chunk;if(text.length>20000)throw new Error('请求过大');}return JSON.parse(text);
      };
      if(p==='/api/watchlist'&&req.method==='GET')return json({codes:await market.watchlist()});
      if(p==='/api/watchlist'&&req.method==='PUT')return json({codes:await market.watchlist((await body()).codes)});
      if(p==='/api/quotes')return json(await market.quotes((url.searchParams.get('codes')||'').split(',').filter(Boolean)));
      if(p==='/api/indices')return json(await market.quotes(INDEX_CODES));
      if(p==='/api/market')return json(await market.universe(url.searchParams.get('refresh')==='1'));
      if(p==='/api/search')return json({rows:await market.search(url.searchParams.get('q')||'')});
      if(p==='/api/history')return json(await market.detail(url.searchParams.get('symbol'),url.searchParams.get('period')||'day'));
      if(p==='/api/ranking'&&req.method==='GET')return json(market.jobSnapshot());
      if(p==='/api/ranking'&&req.method==='POST')return json(await market.startRanking(await body()));
      if(p==='/api/ranking'&&req.method==='DELETE')return json(market.cancelRanking());
      if(p==='/api/etf-ratio'&&req.method==='GET'){
        const etfRatio=etfRatios.get(url.searchParams.get('group')||'csi300');if(!etfRatio)return json({error:'不支持的ETF指数类型'},400);
        return json(await etfRatio.get(url.searchParams.get('refresh')==='1'));
      }
      if(p==='/api/settings')return json({dataDir,version:require('./package.json').version,marketSource:'东方财富公开行情 / 新浪财经备用行情',quoteSource:'腾讯证券公开行情'});
      if(p.startsWith('/api/'))return json({error:'接口不存在'},404);
      const files={'/':'index.html','/app.js':'app.js','/etf.js':'etf.js','/style.css':'style.css'};const name=files[p];
      if(!name||req.method!=='GET')return json({error:'页面不存在'},404);
      const content=await fs.readFile(path.join(__dirname,'public',name));
      res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(content);
    }catch(e){json({error:e.message},400);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,origin,market};
}
if(require.main===module)createServer({port:Number(process.env.PORT)||8765}).then(({origin})=>console.log('Local: '+origin)).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={createServer};
