const $=id=>document.getElementById(id);
const paths={chart:'M3 3v18h18M7 14l4-5 4 3 5-7',filter:'M3 5h18M6 12h12M9 19h6M8 3v4M16 10v4M12 17v4',rank:'M4 20v-7h4v7M10 20V8h4v12M16 20V3h4v17',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',search:'M21 21l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',refresh:'M20 7V3l-3 3a8 8 0 1 0 3 9M20 7h-5',plus:'M12 5v14M5 12h14',download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',activity:'M2 12h5l3-8 4 16 3-8h5',drawdown:'M3 5l7 7 4-4 7 12M15 20h6v-6',trend:'M3 18l7-7 4 4 7-12M15 3h6v6',play:'M8 4l12 8-12 8z',info:'M12 11v6M12 7h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20'};
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[el.dataset.icon]||paths.chart}"/></svg>`;});}
icons();
const state={page:'watch',codes:[],quotes:[],selected:'sh600519',period:'day',history:null,dailyHistory:null,indicator:'macd',market:null,screenRows:[],screenPage:1,rank:null,rankType:'changeUp',rankRows:[],rankPage:1,historyRequest:0,searchRequest:0,marketLoading:false};
const fmt=(n,d=2)=>n==null||!Number.isFinite(n)?'—':n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=n=>n==null?'—':(n>0?'+':'')+fmt(n)+'%';
const color=n=>n>0?'up':n<0?'down':'neutral';
const units=n=>n==null?'—':Math.abs(n)>=1e8?fmt(n/1e8)+'亿':Math.abs(n)>=1e4?fmt(n/1e4)+'万':fmt(n);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeText=s=>{if(!s)return '时间未知';if(/^\d{14}$/.test(s))return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}`;return new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
const shortTime=s=>s?new Date(s).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const localDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4500);}
function notice(text){$('notice').textContent=text;$('notice').classList.toggle('hidden',!text);}
async function api(url,opts={}){if(window.GuanlanWeb)return window.GuanlanWeb.api(url,opts);const res=await fetch('/api/'+url,{...opts,headers:{'Content-Type':'application/json',...opts.headers}});const data=await res.json();if(!res.ok)throw new Error(data.error||'请求失败');return data;}
const names={watch:'行情与自选',screener:'条件选股',ranking:'区间排行榜',settings:'数据与设置',etf:'ETF 分析'};
function navigate(page){
  state.page=page;history.replaceState(null,'','#'+page);document.querySelectorAll('.page').forEach(el=>el.classList.add('hidden'));$(page+'Page').classList.remove('hidden');
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('breadcrumb').textContent=names[page];
  if(page==='etf'){if(!state.etfData)loadEtf();else requestAnimationFrame(drawEtf);}
  if(page==='screener'&&!state.market&&!state.marketLoading)loadMarket();
  if(page==='ranking')pollRank();if(page==='watch')requestAnimationFrame(drawCharts);
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
$('today').textContent=new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',weekday:'short'});

async function refreshQuotes(){
  const results=await Promise.allSettled([api('indices'),api('quotes?codes='+state.codes.join(','))]);
  if(results[0].status==='fulfilled')renderIndices(results[0].value);
  else $('indices').innerHTML=`<div class="index-card skeleton">指数暂不可用 · ${escape(results[0].reason.message)}</div>`;
  if(results[1].status==='fulfilled'){
    const data=results[1].value;state.quotes=data.rows;renderWatch();renderStock();$('watchTime').textContent=shortTime(data.fetchedAt);$('quoteStatus').textContent=window.GuanlanWeb?'公开行情快照 · 随网站发布更新':'公开行情 · 30 秒刷新';
    if(window.GuanlanWeb)$('webSnapshotNote').textContent='网页行情快照 '+timeText(data.fetchedAt)+' · 历史截至 '+data.historyThrough+' · 自选仅存当前浏览器'+(data.dataWarnings?.length?' · 部分数据更新异常，沿用已有快照':'');
    if(window.GuanlanWeb&&state.webHistoryThrough&&state.webHistoryThrough!==data.historyThrough)loadHistory();if(window.GuanlanWeb)state.webHistoryThrough=data.historyThrough;
    notice(data.missing?.length?`未取得 ${data.missing.join('、')} 的行情；请稍后刷新。`:'');
  }else {$('quoteStatus').textContent='行情连接失败';notice('行情获取失败：'+results[1].reason.message+'。已显示的数据可能过期，请核对行情时间。');}
}
function renderIndices(data){$('indices').innerHTML=data.rows.map(r=>`<div class="index-card"><div class="index-top"><span class="index-name">${escape(r.name)}</span><span class="index-code">${escape(r.code)}</span></div><div class="index-bottom"><span class="index-price ${color(r.change)}">${fmt(r.price)}</span><span class="index-change ${color(r.change)}">${pct(r.change)}</span></div><div class="index-time">行情时间 ${escape(timeText(r.time))}</div></div>`).join('');}
function renderWatch(){
  $('watchCount').textContent=state.codes.length;$('watchBadge').textContent=state.codes.length;
  $('watchRows').innerHTML=state.codes.length?state.codes.map(symbol=>{
    const r=state.quotes.find(r=>r.symbol===symbol);return `<div class="watch-row ${symbol===state.selected?'selected':''}" role="button" tabindex="0" data-symbol="${symbol}"><button class="remove-watch" data-remove="${symbol}" title="移出自选" aria-label="移出${escape(r?.name||symbol)}">×</button><div class="stock-identity"><strong>${escape(r?.name||symbol)}</strong><small>${symbol.toUpperCase()}</small></div><div class="watch-quote"><b class="${color(r?.change)}">${fmt(r?.price)}</b><small class="${color(r?.change)}">${pct(r?.change)}</small></div></div>`;
  }).join(''):'<div class="empty">还没有自选股<br>搜索股票后，点击星标添加。</div>';
  $('watchRows').querySelectorAll('[data-symbol]').forEach(el=>{el.addEventListener('click',()=>selectStock(el.dataset.symbol));el.addEventListener('keydown',e=>{if(e.key==='Enter')selectStock(el.dataset.symbol);});});
  $('watchRows').querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();toggleWatch(el.dataset.remove);}));
  $('toggleWatch').textContent=state.codes.includes(state.selected)?'★':'☆';
}
let watchMutation=Promise.resolve();
function toggleWatch(symbol=state.selected){
  watchMutation=watchMutation.then(async()=>{
    const saved=state.codes.includes(symbol);const codes=saved?state.codes.filter(s=>s!==symbol):[...state.codes,symbol];
    const data=await api('watchlist',{method:'PUT',body:JSON.stringify({codes})});state.codes=data.codes;renderWatch();renderScreen();renderRanking();await refreshQuotes();toast(saved?'已移出自选':'已加入自选');
  }).catch(e=>toast(e.message));return watchMutation;
}
$('toggleWatch').addEventListener('click',()=>toggleWatch());
function renderStock(){
  const r=state.quotes.find(r=>r.symbol===state.selected)||state.market?.rows.find(r=>r.symbol===state.selected);
  $('stockName').textContent=r?.name||state.selected;$('stockCode').textContent=state.selected.toUpperCase();
  $('stockPrice').textContent=fmt(r?.price);$('stockPrice').className=color(r?.change);$('stockChange').textContent=pct(r?.change);$('stockChange').className=color(r?.change);$('stockTime').textContent=r?timeText(r.time):'行情暂不可用';
  for(const [id,key] of Object.entries({statOpen:'open',statHigh:'high',statLow:'low',statPrevious:'previous'}))$(id).textContent=fmt(r?.[key]);
  $('statTurnover').textContent=r?.turnover==null?'—':fmt(r.turnover)+'%';$('statAmount').textContent=units(r?.amount);
}
async function selectStock(symbol){
  state.selected=symbol;navigate('watch');renderWatch();renderStock();loadHistory();
  if(!state.quotes.some(r=>r.symbol===symbol))try{const data=await api('quotes?codes='+symbol);if(state.selected===symbol){state.quotes.push(...data.rows);renderStock();}}catch(e){toast(e.message);}
}
async function loadHistory(){
  const id=++state.historyRequest;state.history=null;state.dailyHistory=null;$('chartOverlay').classList.remove('hidden');$('chartOverlay').textContent='正在读取历史 K 线…';
  ['insightChange','insightDrawdown','insightGain'].forEach(x=>{$(x).textContent='—';$(x).className='';});$('insightDrawdownDates').textContent='按收盘价计算';$('insightGainDates').textContent='先低点，后高点 · 按收盘价';
  $('chartLegend').textContent='MA5 —　MA10 —　MA20 —';$('indicatorValue').textContent='';drawCharts();
  try{
    const symbol=state.selected,period=state.period;const data=await api(`history?symbol=${symbol}&period=${period}`);if(id!==state.historyRequest)return;
    state.history=data;$('chartOverlay').classList.toggle('hidden',data.bars.length>0);if(!data.bars.length)$('chartOverlay').textContent='该股票没有可用的 K 线数据';
    $('historyMeta').textContent=`${data.source} · 前复权 · 截至 ${data.bars.at(-1)?.date||'—'}`;drawCharts();
    try{const daily=period==='day'?data:await api(`history?symbol=${symbol}&period=day`);if(id!==state.historyRequest)return;state.dailyHistory=daily;renderInsights(daily.bars.slice(-60));}catch(e){if(id===state.historyRequest)toast('日线统计暂不可用：'+e.message);}
  }catch(e){if(id!==state.historyRequest)return;$('chartOverlay').textContent='历史数据读取失败：'+e.message;}
}
function rangeStats(bars){
  if(bars.length<2)return null;let peak=bars[0],trough=bars[0],dd=0,gain=0,ddDates='',gainDates='';
  for(const b of bars){const d=(peak.close-b.close)/peak.close*100,g=(b.close/trough.close-1)*100;if(d>dd){dd=d;ddDates=peak.date+' → '+b.date;}if(g>gain){gain=g;gainDates=trough.date+' → '+b.date;}if(b.close>peak.close)peak=b;if(b.close<trough.close)trough=b;}
  return {change:(bars.at(-1).close/bars[0].close-1)*100,dd,gain,ddDates,gainDates};
}
function renderInsights(bars){const s=rangeStats(bars);if(!s)return;$('insightChange').textContent=pct(s.change);$('insightChange').className=color(s.change);$('insightDrawdown').textContent=fmt(s.dd)+'%';$('insightDrawdown').className='down';$('insightGain').textContent='+'+fmt(s.gain)+'%';$('insightGain').className='up';$('insightDrawdownDates').textContent=s.ddDates||'区间未发生收盘回撤';$('insightGainDates').textContent=s.gainDates||'区间未发生收盘上涨';}
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.period;document.querySelectorAll('[data-period]').forEach(x=>x.classList.toggle('active',x===b));loadHistory();}));
document.querySelectorAll('[data-indicator]').forEach(b=>b.addEventListener('click',()=>{state.indicator=b.dataset.indicator;document.querySelectorAll('[data-indicator]').forEach(x=>x.classList.toggle('active',x===b));drawCharts();}));
$('visibleBars').addEventListener('change',()=>drawCharts());
let chartGeometry=null;
function context(id){const el=$(id),r=el.getBoundingClientRect(),dpr=devicePixelRatio||1;if(!r.width||!r.height)return null;el.width=r.width*dpr;el.height=r.height*dpr;const c=el.getContext('2d');c.scale(dpr,dpr);c.font='9px -apple-system, sans-serif';return {c,w:r.width,h:r.height};}
function drawCharts(){
  const main=context('chart'),ind=context('indicatorChart');if(!main||!ind)return;const {c,w,h}=main;const data=state.history;if(!data?.bars.length){chartGeometry=null;return;}
  const start=Math.max(0,data.bars.length-Number($('visibleBars').value)),bars=data.bars.slice(start),n=bars.length;
  const left=12,right=55,top=14,priceBottom=h*.69,volTop=h*.78,bottom=h-22,pw=w-left-right,step=pw/n;
  let high=Math.max(...bars.map(b=>b.high)),low=Math.min(...bars.map(b=>b.low));const pad=(high-low||high*.01)*.08;high+=pad;low-=pad;
  const x=i=>left+step*(i+.5),y=p=>top+(high-p)/(high-low)*(priceBottom-top);
  c.strokeStyle='#edf1f3';c.fillStyle='#a6b0ba';c.lineWidth=.7;
  for(let i=0;i<5;i++){const yy=top+(priceBottom-top)*i/4;c.beginPath();c.moveTo(left,yy);c.lineTo(w-right,yy);c.stroke();c.fillText(fmt(high-(high-low)*i/4),w-right+8,yy+3);}
  for(let i=0;i<5;i++){const k=Math.floor((n-1)*i/4),xx=x(k);c.beginPath();c.moveTo(xx,top);c.lineTo(xx,bottom);c.stroke();c.fillText(bars[k].date.slice(2),Math.max(2,xx-22),h-6);}
  const maxVol=Math.max(1,...bars.map(b=>b.volume));c.fillText('成交量',left,volTop-5);c.fillText(units(maxVol),w-right+8,volTop+4);
  bars.forEach((b,i)=>{const up=b.close>=b.open;c.strokeStyle=c.fillStyle=up?'#dd656b':'#32a68b';const xx=x(i),bw=Math.max(.8,step*.58);c.beginPath();c.moveTo(xx,y(b.high));c.lineTo(xx,y(b.low));c.stroke();const height=Math.max(1,Math.abs(y(b.open)-y(b.close)));if(up&&step>3){c.fillStyle='#fff';c.fillRect(xx-bw/2,Math.min(y(b.open),y(b.close)),bw,height);c.strokeRect(xx-bw/2,Math.min(y(b.open),y(b.close)),bw,height);}else c.fillRect(xx-bw/2,Math.min(y(b.open),y(b.close)),bw,height);c.fillStyle=up?'#eeb0b4':'#99d1c2';const vh=(b.volume||0)/maxVol*(bottom-volTop);c.fillRect(xx-bw/2,bottom-vh,bw,vh);});
  function line(ctx,arr,transform,col){ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1;let moved=false;arr.forEach((v,i)=>{if(v==null||!Number.isFinite(v)){moved=false;return;}const xx=x(i),yy=transform(v);if(!moved)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy);moved=true;});ctx.stroke();}
  const values=data.indicators;line(c,values.ma5.slice(start),y,'#b7a35f');line(c,values.ma10.slice(start),y,'#8c9bd1');line(c,values.ma20.slice(start),y,'#c98eac');
  const last=data.bars.length-1;$('chartLegend').innerHTML=`MA5 <b class="ma5">${fmt(values.ma5[last])}</b>　MA10 <b class="ma10">${fmt(values.ma10[last])}</b>　MA20 <b class="ma20">${fmt(values.ma20[last])}</b>`;
  const ci=ind.c,ih=ind.h;ci.strokeStyle='#edf1f3';ci.fillStyle='#a3afba';
  if(state.indicator==='macd'){
    const arrays=[values.dif.slice(start),values.dea.slice(start),values.macd.slice(start)],max=Math.max(.01,...arrays.flat().map(Math.abs)),iy=v=>ih/2-v/max*(ih/2-11);
    ci.beginPath();ci.moveTo(left,iy(0));ci.lineTo(w-right,iy(0));ci.stroke();ci.fillText('0',w-right+8,iy(0)+3);
    arrays[2].forEach((v,i)=>{ci.fillStyle=v>=0?'#e3a2a7':'#91ccbc';ci.fillRect(x(i)-Math.max(.6,step*.25),Math.min(iy(0),iy(v)),Math.max(1,step*.5),Math.max(1,Math.abs(iy(v)-iy(0))));});
    line(ci,arrays[0],iy,'#b7a35f');line(ci,arrays[1],iy,'#8c9bd1');$('indicatorValue').textContent=`DIF ${fmt(values.dif[last])}　DEA ${fmt(values.dea[last])}　MACD ${fmt(values.macd[last])}`;
  }else {
    const iy=v=>ih-7-v/100*(ih-14);for(const v of [30,70]){ci.setLineDash([3,4]);ci.beginPath();ci.moveTo(left,iy(v));ci.lineTo(w-right,iy(v));ci.stroke();ci.fillText(String(v),w-right+8,iy(v)+3);}ci.setLineDash([]);line(ci,values.rsi.slice(start),iy,'#8b9dcd');$('indicatorValue').textContent='RSI(14) '+fmt(values.rsi[last]);
  }
  chartGeometry={bars,left,step,start};
}
new ResizeObserver(()=>{if(state.page==='watch')drawCharts();}).observe($('chart').parentElement);
$('chart').addEventListener('mousemove',e=>{if(!chartGeometry)return;const {bars,left,step}=chartGeometry;const r=e.target.getBoundingClientRect(),i=Math.floor((e.clientX-r.left-left)/step);if(i<0||i>=bars.length){$('chartTooltip').classList.add('hidden');return;}const b=bars[i];$('chartTooltip').innerHTML=`<b>${b.date}</b><br>开盘 ${fmt(b.open)}　收盘 ${fmt(b.close)}<br>最高 ${fmt(b.high)}　最低 ${fmt(b.low)}<br>成交量 ${fmt(b.volume,0)} 手`;$('chartTooltip').classList.remove('hidden');$('chartTooltip').style.left=(e.clientX-r.left>r.width*.5?12:r.width-185)+'px';});
$('chart').addEventListener('mouseleave',()=>$('chartTooltip').classList.add('hidden'));

let searchTimer;
$('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);const q=$('searchInput').value.trim();const id=++state.searchRequest;if(!q){$('searchResults').classList.add('hidden');return;}$('searchResults').innerHTML='<div class="search-message">正在搜索…</div>';$('searchResults').classList.remove('hidden');searchTimer=setTimeout(async()=>{try{const data=await api('search?q='+encodeURIComponent(q));if(id!==state.searchRequest)return;$('searchResults').innerHTML=data.rows.length?data.rows.map(r=>`<button class="search-result" data-search-symbol="${escape(r.symbol)}"><span>${escape(r.name)}</span><small>${escape(r.symbol.toUpperCase())}　↗</small></button>`).join(''):'<div class="search-message">没有匹配的 A 股；可尝试 6 位代码。</div>';$('searchResults').querySelectorAll('[data-search-symbol]').forEach(b=>b.addEventListener('click',()=>{$('searchResults').classList.add('hidden');$('searchInput').value='';selectStock(b.dataset.searchSymbol);}));}catch(e){if(id===state.searchRequest)$('searchResults').innerHTML=`<div class="search-message">${escape(e.message)}</div>`;}},300);});
document.addEventListener('click',e=>{if(!e.target.closest('.global-search'))$('searchResults').classList.add('hidden');});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('searchInput').focus();}if(e.key==='Escape')$('searchResults').classList.add('hidden');});
$('addStockBtn').addEventListener('click',()=>{$('searchInput').focus();toast('搜索股票，打开后点击名称旁的星标加入自选');});
$('refreshBtn').addEventListener('click',async()=>{$('refreshBtn').disabled=true;await refreshQuotes();if(state.page==='watch')await loadHistory();$('refreshBtn').disabled=false;});

async function loadMarket(force=false){
  if(state.marketLoading)return;state.marketLoading=true;$('loadMarket').disabled=true;
  $('marketMeta').textContent='正在读取沪深北全市场快照…';if(!state.market)$('screenTable').innerHTML='<div class="loading-inline">正在读取全 A 股行情，请稍候…</div>';
  try{state.market=await api('market'+(force?'?refresh=1':''));state.screenPage=1;renderScreen();if(state.market.stale)toast('行情刷新失败，正在显示缓存快照');else if(state.market.fallback)toast('已切换新浪备用行情；动态市盈率暂缺，相关筛选会排除缺失值');}
  catch(e){$('marketMeta').textContent='读取失败';if(!state.market)$('screenTable').innerHTML=`<div class="empty">${escape(e.message)}<br>请点击「刷新全市场行情」重试。</div>`;toast(e.message);}
  finally{state.marketLoading=false;$('loadMarket').disabled=false;}
}
$('loadMarket').addEventListener('click',()=>loadMarket(true));
const filterIds=['filterQuery','priceMin','priceMax','changeMin','changeMax','turnoverMin','turnoverMax','amountMin','peMin','peMax','exchange','excludeST','excludeSuspended'];
filterIds.forEach(id=>$(id).addEventListener('input',()=>{state.screenPage=1;renderScreen();}));$('screenSort').addEventListener('change',()=>{state.screenPage=1;renderScreen();});
$('resetFilters').addEventListener('click',()=>{filterIds.forEach(id=>{if($(id).type==='checkbox')$(id).checked=true;else $(id).value=id==='exchange'?'all':'';});state.screenPage=1;renderScreen();});
function meets(r,key,minId,maxId,multiplier=1){const min=$(minId)?.value,max=$(maxId)?.value;if((min!==''&&min!=null)||(max!==''&&max!=null)){if(r[key]==null)return false;if(min!==''&&min!=null&&r[key]<Number(min)*multiplier)return false;if(max!==''&&max!=null&&r[key]>Number(max)*multiplier)return false;}return true;}
function renderScreen(){
  if(!state.market)return;const q=$('filterQuery').value.trim().toLowerCase();let rows=state.market.rows.filter(r=>
    (!q||r.name.toLowerCase().includes(q)||r.code.includes(q))&&($('exchange').value==='all'||r.symbol.startsWith($('exchange').value))&&
    (!$('excludeST').checked||!(/ST|退/i.test(r.name)))&&(!$('excludeSuspended').checked||(r.volume>0&&r.price>0))&&
    meets(r,'price','priceMin','priceMax')&&meets(r,'change','changeMin','changeMax')&&meets(r,'turnover','turnoverMin','turnoverMax')&&meets(r,'pe','peMin','peMax')&&meets(r,'amount','amountMin',null,1e8));
  const [key,dir]=$('screenSort').value.split('_');rows.sort((a,b)=>a[key]==null?1:b[key]==null?-1:(a[key]-b[key])*(dir==='asc'?1:-1));state.screenRows=rows;
  $('filterCount').textContent=rows.length;$('marketMeta').textContent=`${state.market.stale?'缓存过期 · ':''}${state.market.source} · ${state.market.rows.length} 只 · 快照 ${timeText(state.market.fetchedAt)}`;
  const page=rows.slice((state.screenPage-1)*30,state.screenPage*30);
  $('screenTable').innerHTML=rows.length?`<table><thead><tr><th>#</th><th>股票名称</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>换手率</th><th>市盈率</th><th>总市值</th><th>自选</th></tr></thead><tbody>${page.map((r,i)=>`<tr><td>${(state.screenPage-1)*30+i+1}</td><td>${stockCell(r)}</td><td>${fmt(r.price)}</td><td class="${color(r.change)}">${pct(r.change)}</td><td>${units(r.amount)}</td><td>${r.turnover==null?'—':fmt(r.turnover)+'%'}</td><td>${fmt(r.pe)}</td><td>${units(r.marketCap)}</td><td>${watchButton(r)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">没有符合当前条件的股票。试试放宽筛选范围。</div>';
  wireTable($('screenTable'));pagination('screenPagination',rows.length,state.screenPage,p=>{state.screenPage=p;renderScreen();});
}
function stockCell(r){return `<button class="table-stock" data-open="${escape(r.symbol)}">${escape(r.name)}</button><small>${escape(r.symbol.toUpperCase())}</small>`;}
function watchButton(r){const saved=state.codes.includes(r.symbol);return `<button class="table-add ${saved?'saved':''}" data-watch="${escape(r.symbol)}" aria-label="${saved?'移出':'加入'}自选">${saved?'✓ 已选':'+ 自选'}</button>`;}
function wireTable(el){el.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>selectStock(b.dataset.open)));el.querySelectorAll('[data-watch]').forEach(b=>b.addEventListener('click',()=>toggleWatch(b.dataset.watch)));}
function pagination(id,total,page,callback){const pages=Math.max(1,Math.ceil(total/30));$(id).innerHTML=`<span>${total?`${(page-1)*30+1} – ${Math.min(page*30,total)}`:'0'} / 共 ${total.toLocaleString()} 只</span><div><button data-prev ${page<=1?'disabled':''}>上一页</button><span>${page} / ${pages}</span><button data-next ${page>=pages?'disabled':''}>下一页</button></div>`;$(id).querySelector('[data-prev]').addEventListener('click',()=>callback(page-1));$(id).querySelector('[data-next]').addEventListener('click',()=>callback(page+1));}

const today=localDate(new Date());$('rankEnd').value=today;$('rankEnd').max=today;$('rankStart').max=today;$('rankStart').value=localDate(new Date(Date.now()-90*86400000));
let rankingPoll;
$('startRanking').addEventListener('click',async()=>{try{state.rank=await api('ranking',{method:'POST',body:JSON.stringify({start:$('rankStart').value,end:$('rankEnd').value,scope:$('rankScope').value})});state.rankPage=1;renderRanking();scheduleRank();}catch(e){toast(e.message);}});
$('resumeRanking').addEventListener('click',async()=>{const j=state.rank;if(!j)return;try{state.rank=await api('ranking',{method:'POST',body:JSON.stringify({start:j.start,end:j.end,scope:j.scope,resume:true})});$('rankStart').value=j.start;$('rankEnd').value=j.end;$('rankScope').value=j.scope;renderRanking();scheduleRank();}catch(e){toast(e.message);}});
$('cancelRanking').addEventListener('click',async()=>{try{state.rank=await api('ranking',{method:'DELETE'});renderRanking();scheduleRank();}catch(e){toast(e.message);}});
async function pollRank(){try{const initial=!state.rank;state.rank=await api('ranking');if(initial&&state.rank){$('rankStart').value=state.rank.start;$('rankEnd').value=state.rank.end;$('rankScope').value=state.rank.scope;}renderRanking();scheduleRank();}catch(e){toast(e.message);scheduleRank();}}
function scheduleRank(){clearTimeout(rankingPoll);if(['running','stopping','pausing'].includes(state.rank?.status))rankingPoll=setTimeout(pollRank,1800);}
document.querySelectorAll('[data-rank]').forEach(b=>b.addEventListener('click',()=>{state.rankType=b.dataset.rank;state.rankPage=1;renderRanking();}));
function renderRanking(){
  const type=state.rankType;const titles={changeUp:'区间涨幅榜',changeDown:'区间跌幅榜',drawdown:'最大回撤榜',maxGain:'最大涨幅榜'};
  $('rankTitle').textContent=titles[type];document.querySelectorAll('[data-rank]').forEach(b=>b.classList.toggle('active',b.dataset.rank===type));
  const j=state.rank;if(!j)return;const busy=['running','stopping','pausing'].includes(j.status);$('startRanking').disabled=busy;$('resumeRanking').classList.toggle('hidden',busy||!j.resumable||(j.status==='complete'&&!j.failed));
  $('cancelRanking').classList.toggle('hidden',!busy);$('cancelRanking').disabled=j.status==='stopping';$('cancelRanking').textContent=j.status==='stopping'?'正在停止…':'停止计算';
  $('rankProgress').classList.remove('hidden');const percent=j.total?Math.floor(j.done/j.total*100):0;$('rankProgressPct').textContent=percent+'%';$('rankProgressBar').style.width=percent+'%';
  const statusNames={running:'计算中 · 部分结果',stopping:'正在停止 · 部分结果',cancelled:'已停止 · 部分结果',pausing:'正在暂停并保存进度',paused:'已暂停 · 进度已保存',error:'计算失败 · 部分结果',complete:j.failed?'已完成 · 有数据缺失':'计算完成'};
  $('rankStatus').textContent=statusNames[j.status]||j.status;$('rankProgressText').textContent=`${busy?j.phase:statusNames[j.status]} · ${j.done} / ${j.total} 只`;
  let rows=[...j.rows];if(type==='changeUp')rows=rows.filter(r=>r.change>0).sort((a,b)=>b.change-a.change);else if(type==='changeDown')rows=rows.filter(r=>r.change<0).sort((a,b)=>a.change-b.change);else rows.sort((a,b)=>b[type]-a[type]);
  state.rankRows=rows;state.rankPage=Math.min(state.rankPage,Math.max(1,Math.ceil(rows.length/30)));$('rankCount').textContent=rows.length;
  $('rankSummary').textContent=`${j.start} → ${j.end} · ${j.scope==='all'?'当前全 A 股股票池':'我的自选股'} · 已计算 ${j.rows.length} 只 · 失败 ${j.failed} 只 · 数据不足跳过 ${j.skipped} 只${j.universeSource?' · 股票池来源：'+j.universeSource:''}${j.poolSnapshotAt?' · 补充名单截至 '+timeText(j.poolSnapshotAt):''}${j.universeStale?' · 股票池采用过期缓存':''}${busy||j.status!=='complete'?' · 当前为部分结果，排名仍可能变化':''}${j.error?' · '+j.error:''}${j.failed?' · 失败示例：'+j.errors.slice(0,3).map(e=>e.name+' '+e.message).join('；'):''}`;
  const isPath=type==='drawdown'||type==='maxGain';const measure=isPath?type:'change';const isDD=type==='drawdown';const page=rows.slice((state.rankPage-1)*30,state.rankPage*30);
  $('rankTable').innerHTML=rows.length?`<table><thead><tr><th>排名</th><th>股票名称</th><th>${isPath?(isDD?'最大回撤':'最大涨幅'):'区间涨跌幅'}</th><th>${isPath?'区间涨跌幅':'最大回撤'}</th><th>${isPath?(isDD?'高点日期 → 低点日期':'低点日期 → 高点日期'):'首日收盘 → 末日收盘'}</th><th>有效交易区间</th><th>交易日</th><th>自选</th></tr></thead><tbody>${page.map((r,i)=>{const rank=(state.rankPage-1)*30+i+1;return `<tr><td>${rank<=3?`<span class="tag-first">${rank}</span>`:rank}</td><td>${stockCell(r)}</td><td class="${isDD?'down':color(r[measure])}"><b>${isDD?fmt(r.drawdown)+'%':pct(r[measure])}</b></td><td class="${isPath?color(r.change):'down'}">${isPath?pct(r.change):fmt(r.drawdown)+'%'}</td><td>${isPath?(isDD?r.ddStart+' → '+r.ddEnd:r.gainStart+' → '+r.gainEnd):fmt(r.firstClose)+' → '+fmt(r.lastClose)}</td><td>${r.firstDate} → ${r.lastDate}</td><td>${r.sessions}</td><td>${watchButton(r)}</td></tr>`;}).join('')}</tbody></table>`:`<div class="empty large">${busy?'正在获取历史数据，结果会陆续显示…':j.status==='error'?escape(j.error):'当前榜单没有符合条件的结果。'}</div>`;
  wireTable($('rankTable'));pagination('rankPagination',rows.length,state.rankPage,p=>{state.rankPage=p;renderRanking();});
}
function csv(filename,headers,rows){
  if(!rows.length){toast('当前没有可导出的数据');return;}
  const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s)&&typeof v!=='number')s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const data='\ufeff'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');const blob=new Blob([data],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);toast('已发起 CSV 导出');
}
$('watchExport').addEventListener('click',()=>csv('自选行情_'+today,['代码','名称','价格','涨跌幅(%)','成交额(元)','换手率(%)','行情源时间'],state.codes.map(s=>state.quotes.find(r=>r.symbol===s)).filter(Boolean).map(r=>[r.symbol,r.name,r.price,r.change,r.amount,r.turnover,r.time])));
$('historyExport').addEventListener('click',()=>csv(state.selected+'_'+state.period+'_前复权_'+today,['日期','开盘','收盘','最高','最低','成交量(手)','复权方式'],(state.history?.bars||[]).map(r=>[r.date,r.open,r.close,r.high,r.low,r.volume,'前复权'])));
$('screenExport').addEventListener('click',()=>csv('条件选股_'+today,['代码','名称','价格','涨跌幅(%)','成交额(元)','换手率(%)','动态市盈率','总市值(元)','快照时间'],state.screenRows.map(r=>[r.symbol,r.name,r.price,r.change,r.amount,r.turnover,r.pe,r.marketCap,state.market.fetchedAt])));
$('rankExport').addEventListener('click',()=>{const j=state.rank;if(!j)return toast('请先计算榜单');csv(`${names.ranking}_${state.rankType}_${j.start}_${j.end}_${j.status}`,['排名','代码','名称','区间涨跌幅(%)','最大回撤(%)','最大涨幅(%)','回撤高点日期','回撤低点日期','涨幅低点日期','涨幅高点日期','有效起日','有效止日','有效交易日','股票范围','计算状态','总股票数','已处理数','失败数','跳过数','计算发起时间'],state.rankRows.map((r,i)=>[i+1,r.symbol,r.name,r.change,r.drawdown,r.maxGain,r.ddStart,r.ddEnd,r.gainStart,r.gainEnd,r.firstDate,r.lastDate,r.sessions,j.scope,j.status,j.total,j.done,j.failed,j.skipped,j.startedAt]));});
async function init(){
  try{state.codes=(await api('watchlist')).codes;if(state.codes.length)state.selected=state.codes[0];renderWatch();await refreshQuotes();loadHistory();}catch(e){notice('初始化失败：'+e.message);}
  try{const s=await api('settings');$('dataPath').textContent=s.dataDir;if(s.snapshot){$('webSnapshotNote').textContent='网页行情快照 '+timeText(s.marketAsOf)+' · 历史截至 '+s.historyThrough+' · 自选仅存当前浏览器';$('rankStart').min=s.rankingFrom;$('rankEnd').min=s.rankingFrom;if($('rankStart').value<s.rankingFrom)$('rankStart').value=s.rankingFrom;}}catch{}
  setInterval(()=>{if(state.page==='watch'&&!document.hidden)refreshQuotes();},window.GuanlanWeb?300000:30000);
}
init();
window.addEventListener('DOMContentLoaded',()=>{if(names[location.hash.slice(1)])navigate(location.hash.slice(1));});
window.addEventListener('hashchange',()=>{if(names[location.hash.slice(1)])navigate(location.hash.slice(1));});
