// Quarterly ETF values use contemporaneous disclosed shares and unadjusted closes.
let etfSelectedDate=null,etfGeometry={},etfHiddenFunds=new Set(),etfLoadRequest=0;
const etfTotalCode='TOP10',etfTotalColor='#344c65';
const etfGroupNames={csi300:'沪深300',sse50:'上证50',star50:'科创50'};
const etfLabel=()=>etfGroupNames[$('etfGroup').value]||'沪深300';
const etfColors=['#168b78','#4c87bd','#9b77c2','#d0963b','#d16e78','#3d9fa3','#859438','#a36a47','#7582bc','#bd72a5'];
const etfConcentration=()=>$('etfDenominator').value==='allEtf';
const etfNumber=(value,digits=2)=>value==null?'—':fmt(value,digits);
const etfPercent=value=>value==null?'缺少数据':fmt(value,4)+'%';
const etfBillions=value=>value==null?'缺少数据':fmt(value)+' 亿元';
function quarterName(date){return date?`${date.slice(0,4)} Q${Math.ceil(Number(date.slice(5,7))/3)}`:'—';}
function etfVisible(){return state.etfData?.points.slice(-Number($('etfYears').value)*4)||[];}
function etfCohortPoint(){return state.etfData?.points.filter(p=>p.concentration?.ratio!=null).at(-1);}
function etfCohort(){return etfCohortPoint()?.concentration.funds||[];}
function etfFundAt(point,code){return point.concentration?.allFunds.find(f=>f.code===code);}
function etfTotalShares(point){const con=point?.concentration;return con?.topMarketValue!=null&&con.topCount>0&&con.funds.length===con.topCount&&con.funds.every(f=>f.shares>0)?con.funds.reduce((sum,f)=>sum+f.shares,0):null;}
function etfSharesValue(point,code){return !point?null:code===etfTotalCode?etfTotalShares(point):etfFundAt(point,code)?.shares??null;}
function etfShareChange(point,code){
  const index=state.etfData.points.findIndex(p=>p.date===point.date),previous=state.etfData.points[index-1];
  const quarter=date=>Number(date.slice(0,4))*4+Math.floor((Number(date.slice(5,7))-1)/3);
  if(!previous||quarter(point.date)-quarter(previous.date)!==1)return null;
  const current=etfSharesValue(point,code),before=etfSharesValue(previous,code);return current==null||before==null?null:current-before;
}
const etfSharesText=value=>value==null?'缺少数据':fmt(value)+' 亿份';
const etfSharesChangeText=value=>value==null?'—':(value>0?'+':'')+fmt(value)+' 亿份';
async function loadEtf(force=false){
  const group=$('etfGroup').value;if(state.etfLoading&&state.etfLoadingGroup===group)return;
  const request=++etfLoadRequest;state.etfLoading=true;state.etfLoadingGroup=group;$('refreshEtf').disabled=true;
  for(const id of ['exportEtf','exportEtfIndividual','exportEtfShares'])$(id).disabled=true;
  if(!state.etfData)for(const id of ['etfOverlay','etfIndividualOverlay','etfSharesOverlay']){$(id).classList.remove('hidden');$(id).textContent='正在核对'+etfLabel()+' ETF 的季度份额与同日收盘价…';}
  try{
    const data=await api('etf-ratio?group='+group+(force?'&refresh=1':''));
    if(request!==etfLoadRequest)return;state.etfData=data;
    const valid=data.points.filter(p=>etfConcentration()?p.concentration?.ratio!=null:p.netRatio!=null);
    etfSelectedDate=valid.at(-1)?.date||data.points.at(-1)?.date||null;
    $('etfFreshness').textContent='数据读取 '+timeText(data.fetchedAt);
    const complete=data.points.filter(p=>p.concentration?.ratio!=null).length;
    $('etfSourceCoverage').textContent=`当前检索到 ${data.candidates.length} 只普通${etfLabel()} ETF；近 ${data.points.length} 个季度中，${complete} 个季度可完整核算集中度。不足10只时取全部，集中度为100%。当前名单可能不含已终止或无法检索的基金；缺少报告或同日价格时保留断点。`;
    renderEtfMode();
  }catch(e){
    if(request!==etfLoadRequest)return;
    if(!state.etfData)for(const id of ['etfOverlay','etfIndividualOverlay','etfSharesOverlay']){$(id).classList.remove('hidden');$(id).textContent=etfLabel()+' ETF 数据读取失败：'+e.message;}
    else toast('更新失败，仍显示已读取数据：'+e.message);
  }finally{if(request===etfLoadRequest){state.etfLoading=false;$('refreshEtf').disabled=false;for(const id of ['exportEtf','exportEtfIndividual','exportEtfShares'])$(id).disabled=!state.etfData;}}
}
function changeEtfGroup(){
  state.etfData=null;etfSelectedDate=null;etfHiddenFunds.clear();etfGeometry={};
  for(const id of ['etfChart','etfIndividualChart','etfSharesChart'])context(id);
  for(const id of ['etfQuarter','etfNetRatio','etfNetValue','etfMarketRatio','etfMarketValue','etfFloatCap','etfCapDate','etfCohortLabel','etfDataNote','etfSharesNote','etfIndividualNote'])$(id).textContent='—';
  for(const id of ['etfIndividualLegend','etfSharesLegend'])$(id).innerHTML='';
  for(const id of ['etfTooltip','etfIndividualTooltip','etfSharesTooltip'])$(id).classList.add('hidden');
  $('etfFreshness').textContent='正在读取…';$('etfSourceCoverage').textContent='';$('etfFundTitle').textContent=etfLabel()+' ETF 明细';$('etfFundTable').innerHTML='<div class="empty">正在核对所选指数的 ETF…</div>';
  renderEtfMode();loadEtf();
}
function renderEtfMode(){
  const concentration=etfConcentration(),label=etfLabel();
  $('etfDenominator').options[0].textContent='全部'+label+' ETF 合计流通市值（集中度）';
  $('etfDenominator').options[1].textContent=label+'指数流通市值（规模占比）';
  $('etfConcentrationMethod').innerHTML=`<p><b>市值集中度</b> = 当季市值头部${label} ETF 合计市值 ÷ 当季全部候选普通${label} ETF 合计流通市值 × 100%。按上市市值最多取10只，不足10只取全部。</p><p>每只 ETF 市值 = 当季披露总份额 × 同一月末交易日未复权收盘价。普通上市 ETF 以披露总份额估算流通份额；份额精度为0.01亿份，市值与比例均为估算。缺少任意一只的报告或同日价格时不计算集中度。</p>`;
  $('etfIndexMethod').innerHTML=`<p><b>净资产规模占比</b> = 当季按净资产排名的头部${label} ETF 净资产合计 ÷ 同期${label}指数流通市值 × 100%。</p><p><b>上市市值占比（估算）</b> = 相同基金的总份额 × 各自未复权月末收盘价，合计后 ÷ 同期${label}指数流通市值 × 100%。最多取10只，不足10只取全部。</p>`;
  $('etfPageTitle').textContent=label+(concentration?' ETF 集中度、市值与份额':' ETF 规模占比、市值与份额');
  $('etfPageDescription').textContent=concentration?'查看头部集中度、合计与单只市值，以及季度总份额的变化。':'保留指数流通市值口径，并对照头部 ETF 市值和总份额变化。';
  $('etfChartTitle').textContent=concentration?'头部 ETF 市值集中度趋势':'头部 ETF / '+label+'指数流通市值';
  $('etfSelectionNote').textContent=concentration?'当季按上市市值最多取10只，不足10只取全部':'指数占比按净资产排名；市值与份额图按上市市值排名';
  $('etfLegendOne').textContent=concentration?'头部市值 / 全部 ETF 流通市值（估算）':'净资产规模占比';
  $('etfLegendTwoWrap').classList.toggle('hidden',concentration);
  $('etfConcentrationMethod').classList.toggle('hidden',!concentration);$('etfIndexMethod').classList.toggle('hidden',concentration);
  $('etfTableScope').classList.toggle('hidden',!concentration);$('etfTableScope').options[0].textContent='头部 ETF（最多10只）';
  $('etfMetricOneLabel').textContent=concentration?'头部市值集中度（估算）':'净资产规模占比';
  $('etfMetricTwoLabel').textContent=concentration?'头部合计市值（估算）':'上市市值占比（估算）';
  $('etfDenominatorLabel').textContent=concentration?'全部 ETF 合计流通市值（估算）':label+'指数流通市值';
  $('etfChart').setAttribute('aria-label',concentration?label+' ETF 头部市值集中度季度曲线':label+' ETF 净资产与上市市值占对应指数流通市值的季度曲线');
  $('etfIndividualChart').setAttribute('aria-label',label+' ETF 头部合计及各只基金上市市值的历史曲线，单位亿元');
  $('etfSharesChart').setAttribute('aria-label',label+' ETF 头部合计及各只基金总份额的季度变动曲线，单位亿份');
  renderEtfQuarter();drawEtf();
}
function renderEtfQuarter(){
  const point=state.etfData?.points.find(p=>p.date===etfSelectedDate);if(!point)return;
  const con=point.concentration,mode=etfConcentration();
  $('etfQuarterLabel').textContent=point===state.etfData.points.at(-1)?'最新披露季度':'所选季度';$('etfQuarter').textContent=quarterName(point.date);
  $('etfNetRatio').textContent=mode?(con?.ratio==null?'—':fmt(con.ratio,4)+'%'):(point.netRatio==null?'—':fmt(point.netRatio,4)+'%');
  $('etfNetValue').textContent=mode?`前 ${con?.topCount||0} 只 / 全部 ${con?.allCount||0} 只`:etfBillions(point.netAssets);
  $('etfMarketRatio').textContent=mode?etfNumber(con?.topMarketValue):(point.marketRatio==null?'—':fmt(point.marketRatio,4)+'%');
  $('etfMarketValue').textContent=mode?'亿元 · 当季市值前'+(con?.topCount||0)+'只':etfBillions(point.marketValue);
  $('etfFloatCap').textContent=mode?etfNumber(con?.totalMarketValue):(point.floatCap==null?'—':fmt(point.floatCap/10000)+' 万亿元');
  $('etfCapDate').textContent=mode?'亿元 · 价格日期 '+(con?.priceDate||'缺少数据'):'指数市值日期 '+(point.indexDate||'未公布');
  if(mode){
    const missing=[con?.missingReports.length?'缺少报告：'+con.missingReports.join('、'):'',con?.missingPrices.length?'缺少同日价格：'+con.missingPrices.join('、'):''].filter(Boolean);
    $('etfDataNote').textContent=con?.ratio==null?`${point.date} 数据不完整，未计算集中度及头部合计市值。${missing.join('；')}`:`${point.date} 季度份额 × ${con.priceDate} 未复权收盘价 · 分母覆盖当季全部 ${con.allCount} 只候选 ETF · 份额精度为 0.01 亿份，市值及比例为估算。`;
  }else $('etfDataNote').textContent=point.missingReports.length?`缺少 ${point.missingReports.join('、')} 的季度报告，未计算指数占比。`:`${point.date} 披露口径 · 价格与指数流通市值日期 ${point.indexDate||'缺失'} · 两条曲线可能接近或重合。`;
  const all=mode&&$('etfTableScope').value==='all';const funds=mode?(all?con?.allFunds:con?.funds)||[]:point.funds;
  $('etfFundTitle').textContent=quarterName(point.date)+' · '+etfLabel()+(all?' ETF 全部基金':' ETF 头部'+funds.length+'只');
  $('etfFundSort').textContent=mode?'按上市市值估算排序':'按净资产规模排序';
  $('etfFundTable').innerHTML=`<table><thead><tr><th>排名</th><th>ETF 名称</th><th>净资产（亿元）</th><th>总份额（亿份）</th><th>未复权收盘价</th><th>市值估算（亿元）</th>${mode?'<th>占全部 ETF（%）</th>':''}<th>价格日期</th></tr></thead><tbody>${funds.map((f,i)=>`<tr><td>${i+1}</td><td><b>${escape(f.name)}</b><small>${escape(f.code)}</small></td><td>${etfNumber(f.netAssets)}</td><td>${etfNumber(f.shares)}</td><td>${etfNumber(f.close,3)}</td><td>${etfNumber(f.marketValue)}</td>${mode?`<td>${con.totalMarketValue>0&&f.marketValue!=null?fmt(f.marketValue/con.totalMarketValue*100,4):'—'}</td>`:''}<td>${f.priceDate||'—'}</td></tr>`).join('')}</tbody></table>`;
  renderEtfIndividualLegend(point);
}
function renderEtfIndividualLegend(point){
  const cohort=etfCohort();$('etfCohortLabel').textContent=quarterName(etfCohortPoint()?.date)+' 前'+cohort.length+'只 · 固定名单追踪历史';
  for(const [id,shares] of [['etfIndividualLegend',false],['etfSharesLegend',true]]){
    const value=f=>shares?etfFundAt(point,f.code)?.shares:etfFundAt(point,f.code)?.marketValue;
    $(id).innerHTML=`<label class="etf-fund-toggle etf-total-toggle" style="--fund-color:${etfTotalColor}"><input type="checkbox" data-etf-code="${etfTotalCode}" ${etfHiddenFunds.has(etfTotalCode)?'':'checked'}><i></i><span>前${point.concentration?.topCount||0}只合计${shares?'总份额':'市值'}<small>每季按市值排名</small></span><b>${etfNumber(shares?etfTotalShares(point):point.concentration?.topMarketValue)}</b></label>`+cohort.map((f,i)=>`<label class="etf-fund-toggle" style="--fund-color:${etfColors[i]}"><input type="checkbox" data-etf-code="${f.code}" ${etfHiddenFunds.has(f.code)?'':'checked'}><i></i><span title="${escape(f.name)}">${escape(f.name)}<small>${f.code}</small></span><b>${etfNumber(value(f))}</b></label>`).join('');
  }
  $('etfSharesNote').textContent=`${quarterName(point.date)} 头部${point.concentration?.topCount||0}只合计 ${etfSharesText(etfTotalShares(point))}，较上季 ${etfSharesChangeText(etfShareChange(point,etfTotalCode))}。合计每季按市值最多取10只，不足10只取全部；单只固定追踪 ${quarterName(etfCohortPoint()?.date)} 的${cohort.length}只。披露精度为0.01亿份，份额变动包含名单变化影响，不等同于资金净流入。`;
  $('etfIndividualNote').textContent=`合计每季按市值最多取10只，不足10只取全部；单只固定追踪 ${quarterName(etfCohortPoint()?.date)} 的${cohort.length}只，历史名单可能与当季头部不同。图例为 ${quarterName(point.date)} 市值估算（亿元）；缺失时留空。`;
}
// One plotting primitive keeps date selection and gaps consistent across all charts.
function etfPlot(id,rows,series,{percent=false,zoom=false}={}){
  const result=context(id);if(!result||!rows.length)return null;const {c,w,h}=result;
  const values=rows.flatMap(r=>series.map(s=>s.value(r))).filter(v=>v!=null&&Number.isFinite(v));
  const left=percent?65:69,right=25,top=20,bottom=h-38,t0=Date.parse(rows[0].date),t1=Date.parse(rows.at(-1).date);
  const min=Math.min(...values),max=Math.max(...values);let low=0,high=1;
  if(values.length){if(zoom){low=Math.max(0,Math.floor((min-.5)*2)/2);high=Math.min(100,Math.ceil((max+.5)*2)/2);}else {const raw=Math.max(.01,max*1.12),unit=10**Math.floor(Math.log10(raw));high=Math.ceil(raw/unit*2)/2*unit;}}
  if(high<=low)high=low+1;
  const x=date=>left+(Date.parse(date)-t0)/(t1-t0||1)*(w-left-right),y=value=>bottom-(value-low)/(high-low)*(bottom-top);
  c.font='10px -apple-system, sans-serif';c.lineWidth=.7;c.strokeStyle='#edf1f3';c.fillStyle='#9ba8b3';
  for(let i=0;i<=4;i++){const value=low+(high-low)*i/4,yy=y(value);c.beginPath();c.moveTo(left,yy);c.lineTo(w-right,yy);c.stroke();c.textAlign='right';c.fillText(fmt(value,percent?2:(high>=100?0:2))+(percent?'%':''),left-10,yy+3);}
  c.textAlign='center';const ticks=Math.min(w<650?4:6,rows.length);for(let i=0;i<ticks;i++){const row=rows[Math.round((rows.length-1)*i/Math.max(1,ticks-1))];c.fillText(quarterName(row.date),x(row.date),h-14);}
  for(const s of series){c.beginPath();c.strokeStyle=s.color;c.lineWidth=s.width||2;c.setLineDash(s.dash||[]);let connected=false;
    for(const row of rows){const value=s.value(row);if(value==null){connected=false;continue;}if(connected)c.lineTo(x(row.date),y(value));else c.moveTo(x(row.date),y(value));connected=true;}c.stroke();c.setLineDash([]);
    for(const row of rows){const value=s.value(row);if(value==null)continue;c.beginPath();c.arc(x(row.date),y(value),2.3,0,Math.PI*2);c.fillStyle=s.color;c.fill();}
  }
  if(rows.some(r=>r.date===etfSelectedDate)){c.beginPath();c.setLineDash([3,5]);c.strokeStyle='#a7bab1';c.lineWidth=1;c.moveTo(x(etfSelectedDate),top);c.lineTo(x(etfSelectedDate),bottom);c.stroke();c.setLineDash([]);}
  return {rows,x,w,hasData:values.length>0,low};
}
function etfOverlay(id,geometry,message){$(id).classList.toggle('hidden',Boolean(geometry?.hasData));if(!geometry?.hasData)$(id).textContent=message;}
function drawEtf(){
  if(state.page!=='etf'||!state.etfData)return;const rows=etfVisible(),mode=etfConcentration();
  etfGeometry.etfChart=etfPlot('etfChart',rows,mode?[{color:'#168b78',value:r=>r.concentration?.ratio}]:[{color:'#168b78',value:r=>r.netRatio},{color:'#8e87c5',dash:[5,4],value:r=>r.marketRatio}],{percent:true,zoom:mode});
  $('etfAxisNote').textContent=mode&&etfGeometry.etfChart?.low>0?'纵轴已放大，非零起点':'';
  etfOverlay('etfOverlay',etfGeometry.etfChart,'所选范围没有完整数据，暂不计算占比。');
  for(const [id,overlay,shares] of [['etfIndividualChart','etfIndividualOverlay',false],['etfSharesChart','etfSharesOverlay',true]]){
    const series=etfCohort().map((f,i)=>({color:etfColors[i],code:f.code,value:r=>shares?etfFundAt(r,f.code)?.shares:etfFundAt(r,f.code)?.marketValue})).filter(s=>!etfHiddenFunds.has(s.code));
    if(!etfHiddenFunds.has(etfTotalCode))series.unshift({color:etfTotalColor,width:3,dash:[7,4],value:r=>shares?etfTotalShares(r):r.concentration?.topMarketValue});
    etfGeometry[id]=etfPlot(id,rows,series);
    etfOverlay(overlay,etfGeometry[id],series.length?'所选范围缺少所选曲线的季度数据。':'请勾选合计或单只基金，显示曲线。');
  }
}
function etfNearest(event,id){const geometry=etfGeometry[id];if(!geometry?.rows.length)return null;const xx=event.clientX-$(id).getBoundingClientRect().left;return geometry.rows.reduce((best,row)=>Math.abs(geometry.x(row.date)-xx)<Math.abs(geometry.x(best.date)-xx)?row:best);}
function etfTooltipContent(row,id){
  const con=row.concentration,title=`<b>${quarterName(row.date)} · ${row.date}</b><br>`;
  if(id==='etfIndividualChart'||id==='etfSharesChart'){
    const shares=id==='etfSharesChart',value=code=>shares?etfSharesText(etfSharesValue(row,code)):etfBillions(code===etfTotalCode?con?.topMarketValue:etfFundAt(row,code)?.marketValue);
    const change=code=>shares?'<small> · 较上季 '+etfSharesChangeText(etfShareChange(row,code))+'</small>':'';
    return title+(etfHiddenFunds.has(etfTotalCode)?'':`<i style="background:${etfTotalColor}"></i><b>当季前${con?.topCount||0}只合计　${value(etfTotalCode)}</b>${change(etfTotalCode)}<br>`)+etfCohort().map((f,i)=>etfHiddenFunds.has(f.code)?'':`<i style="background:${etfColors[i]}"></i>${escape(f.name)} ${f.code}　${value(f.code)}${change(f.code)}`).filter(Boolean).join('<br>')+'<br><small>点击同时定位季度</small>';
  }
  return title+(etfConcentration()?`市值集中度　${etfPercent(con?.ratio)}<br>头部市值　${etfBillions(con?.topMarketValue)}<br>全部 ${con?.allCount||0} 只市值　${etfBillions(con?.totalMarketValue)}`:`净资产规模占比　${etfPercent(row.netRatio)}<br>上市市值占比　${etfPercent(row.marketRatio)}<br>指数流通市值　${etfBillions(row.floatCap)}`)+'<br><small>点击查看当季基金明细</small>';
}
for(const [id,tooltip] of [['etfChart','etfTooltip'],['etfIndividualChart','etfIndividualTooltip'],['etfSharesChart','etfSharesTooltip']]){
  $(id).addEventListener('mousemove',event=>{const row=etfNearest(event,id);if(!row)return;const rect=$(id).getBoundingClientRect(),tip=$(tooltip);tip.innerHTML=etfTooltipContent(row,id);tip.classList.remove('hidden');tip.style.left=(event.clientX-rect.left>rect.width*.5?10:Math.max(10,rect.width-tip.offsetWidth-10))+'px';});
  $(id).addEventListener('mouseleave',()=>$(tooltip).classList.add('hidden'));
  $(id).addEventListener('click',event=>{const row=etfNearest(event,id);if(row){etfSelectedDate=row.date;renderEtfQuarter();drawEtf();}});
}
$('etfGroup').addEventListener('change',changeEtfGroup);
$('refreshEtf').addEventListener('click',()=>loadEtf(true));$('etfDenominator').addEventListener('change',renderEtfMode);$('etfTableScope').addEventListener('change',renderEtfQuarter);
for(const id of ['etfYears','etfIndividualYears','etfSharesYears'])$(id).addEventListener('change',()=>{
  for(const other of ['etfYears','etfIndividualYears','etfSharesYears'])$(other).value=$(id).value;
  const rows=etfVisible();if(!rows.some(r=>r.date===etfSelectedDate))etfSelectedDate=rows.at(-1)?.date;renderEtfQuarter();drawEtf();
});
for(const id of ['etfIndividualLegend','etfSharesLegend'])$(id).addEventListener('change',event=>{
  const code=event.target.dataset.etfCode;if(!code)return;event.target.checked?etfHiddenFunds.delete(code):etfHiddenFunds.add(code);renderEtfQuarter();drawEtf();
});
for(const id of ['etfSelectAll','etfSharesSelectAll'])$(id).addEventListener('click',()=>{etfHiddenFunds.clear();renderEtfQuarter();drawEtf();});
for(const id of ['etfSelectNone','etfSharesSelectNone'])$(id).addEventListener('click',()=>{etfHiddenFunds=new Set([etfTotalCode,...etfCohort().map(f=>f.code)]);renderEtfQuarter();drawEtf();});
new ResizeObserver(()=>{if(state.page==='etf')drawEtf();}).observe($('etfChart').parentElement);
$('exportEtf').addEventListener('click',()=>{
  const mode=etfConcentration();csv(etfLabel()+'ETF_'+(mode?'集中度与市值':'指数占比')+'_'+today,
    mode?['季度','价格日期','头部合计市值估算(亿元)','全部ETF合计流通市值估算(亿元)','头部集中度估算(%)','全部基金数','当季市值头部代码','全部基金代码','缺少报告','缺少同日价格']:['季度','指数市值日期','净资产头部净资产(亿元)','净资产头部上市市值估算(亿元)','指数流通市值(亿元)','净资产占比(%)','上市市值占比(%)','净资产头部代码','市值头部合计估算(亿元)'],
    etfVisible().map(p=>{const con=p.concentration;return mode?[p.date,con.priceDate,con.topMarketValue,con.totalMarketValue,con.ratio,con.allCount,con.funds.map(f=>f.code).join(';'),con.allFunds.map(f=>f.code).join(';'),con.missingReports.join(';'),con.missingPrices.join(';')]:[p.date,p.indexDate,p.netAssets,p.marketValue,p.floatCap,p.netRatio,p.marketRatio,p.funds.map(f=>f.code).join(';'),con.topMarketValue];}));
});
$('exportEtfIndividual').addEventListener('click',()=>csv(etfLabel()+'ETF_合计与单只市值_'+today,['季度','曲线类型','基金代码','基金名称','名单口径','是否显示曲线','总份额(亿份)','未复权收盘价(元)','价格日期','上市市值估算(亿元)'],etfVisible().flatMap(p=>[
  [p.date,'合计',etfTotalCode,'当季市值前'+p.concentration.topCount+'只合计','每季按市值最多取10只，不足10只取全部',!etfHiddenFunds.has(etfTotalCode),etfTotalShares(p),'',p.concentration?.priceDate,p.concentration?.topMarketValue],
  ...etfCohort().map(f=>{const row=etfFundAt(p,f.code);return [p.date,'单只',f.code,f.name,'固定'+etfCohortPoint().date+'前'+etfCohort().length+'只',!etfHiddenFunds.has(f.code),row?.shares,row?.close,row?.priceDate,row?.marketValue];})
])));
$('exportEtfShares').addEventListener('click',()=>csv(etfLabel()+'ETF_总份额变动_'+today,['季度','曲线类型','基金代码','基金名称','名单口径','是否显示曲线','披露总份额(亿份)','较上季增减(亿份)'],etfVisible().flatMap(p=>[
  [p.date,'合计',etfTotalCode,'当季市值前'+p.concentration.topCount+'只合计','每季按市值最多取10只，不足10只取全部',!etfHiddenFunds.has(etfTotalCode),etfTotalShares(p),etfShareChange(p,etfTotalCode)],
  ...etfCohort().map(f=>[p.date,'单只',f.code,f.name,'固定'+etfCohortPoint().date+'前'+etfCohort().length+'只',!etfHiddenFunds.has(f.code),etfSharesValue(p,f.code),etfShareChange(p,f.code)])
])));
