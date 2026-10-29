const fs=require('node:fs/promises');
const path=require('node:path');
const {request}=require('./market.cjs');
const numeric=value=>{const n=Number(String(value??'').replaceAll(',',''));return value==null||value===''||!Number.isFinite(n)?null:n;};
const dateISO=s=>/^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:s;

const ETF_GROUPS=Object.freeze({
  csi300:{id:'csi300',label:'沪深300',indexCode:'000300',sqlId:'COMMON_SSE_ZQZS_M_CSI300_INDEX_C'},
  sse50:{id:'sse50',label:'上证50',indexCode:'000016',sqlId:'COMMON_SSE_ZQZS_M_SSE50_INDEX_C'},
  star50:{id:'star50',label:'科创50',indexCode:'000688',sqlId:'COMMON_SSE_ZQZS_M_KCB50_INDEX_C'},
});
function etfGroup(id='csi300'){if(!Object.hasOwn(ETF_GROUPS,id))throw new Error('不支持的ETF指数类型');return ETF_GROUPS[id];}
function selectCandidateFunds(rows,groupId='csi300'){
  const {label}=etfGroup(groupId);
  return [...new Map(rows.filter(r=>/^(15|51|56|58)\d{4}$/.test(r[0])&&String(r[2]).replace(/\s/g,'').includes(label+'ETF')&&!/联接|增强|指增/.test(r[2])).map(r=>[r[0],{code:r[0],name:r[2]}])).values()];
}

function parseFundHistory(text) {
  const rows=new Map();
  for(const match of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim());
    if(cells.length<5||!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(cells[0]))continue;
    const shares=numeric(cells[3]),netAssets=numeric(cells[4]);
    if(shares>0&&netAssets>0&&!rows.has(cells[0]))rows.set(cells[0],{date:cells[0],shares,netAssets});
  }
  return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function selectTopTen(funds,date) {
  return funds.map(f=>{const report=f.reports.find(r=>r.date===date);return report?{code:f.code,name:f.name,...report}:null;}).filter(Boolean).sort((a,b)=>b.netAssets-a.netAssets||a.code.localeCompare(b.code)).slice(0,10);
}
function ratioPoint(date,funds,indexRows,priceMaps) {
  const top=selectTopTen(funds,date);const missingReports=funds.filter(f=>f.reports[0]?.date<=date&&!f.reports.some(r=>r.date===date)).map(f=>f.code);
  const cap=indexRows.filter(r=>r.date<=date&&r.date.slice(0,7)===date.slice(0,7)&&r.floatCap>0).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const common={date,indexDate:cap?.date||null,floatCap:cap?.floatCap??null,count:top.length,missingReports};
  if(!top.length||missingReports.length||!cap)return {...common,netAssets:null,marketValue:null,netRatio:null,marketRatio:null,funds:top};
  const withPrices=top.map(f=>{
    const row=priceMaps[f.code]?.find(p=>p.date===cap.date);
    return {...f,close:row?.close??null,priceDate:row?.date??null,marketValue:row?.close>0?f.shares*row.close:null};
  });
  const netAssets=top.reduce((n,f)=>n+f.netAssets,0);const completePrices=withPrices.every(f=>f.marketValue!==null);
  const marketValue=completePrices?withPrices.reduce((n,f)=>n+f.marketValue,0):null;
  return {...common,netAssets,marketValue,netRatio:netAssets/cap.floatCap*100,marketRatio:marketValue===null?null:marketValue/cap.floatCap*100,funds:withPrices};
}
function concentrationPoint(date,funds,priceMaps) {
  // Exclude periods before a fund's first available listed quote. Missing price
  // responses remain missing data, rather than silently removing the fund.
  const eligible=funds.filter(f=>f.reports[0]?.date<=date&&(!priceMaps[f.code]?.length||priceMaps[f.code][0].date<=date));
  const missingReports=eligible.filter(f=>!f.reports.some(r=>r.date===date)).map(f=>f.code);
  const quarterPrices=f=>priceMaps[f.code]?.filter(p=>p.date<=date&&p.date.slice(0,7)===date.slice(0,7))||[];
  const priceDate=eligible.flatMap(quarterPrices).map(p=>p.date).sort().at(-1)||null;
  const allFunds=eligible.map(f=>{
    const report=f.reports.find(r=>r.date===date),price=quarterPrices(f).find(p=>p.date===priceDate);
    return {code:f.code,name:f.name,date,shares:report?.shares??null,netAssets:report?.netAssets??null,
      close:price?.close??null,priceDate:price?.date??null,marketValue:report?.shares>0&&price?.close>0?report.shares*price.close:null};
  }).sort((a,b)=>(a.marketValue===null&&b.marketValue===null)?a.code.localeCompare(b.code):a.marketValue===null?1:b.marketValue===null?-1:b.marketValue-a.marketValue||a.code.localeCompare(b.code));
  const missingPrices=allFunds.filter(f=>f.close===null).map(f=>f.code);
  const complete=allFunds.length>0&&!missingReports.length&&!missingPrices.length;
  const totalMarketValue=complete?allFunds.reduce((n,f)=>n+f.marketValue,0):null;
  const top=allFunds.slice(0,10),topMarketValue=complete?top.reduce((n,f)=>n+f.marketValue,0):null;
  return {date,priceDate,allCount:allFunds.length,topCount:top.length,totalMarketValue,topMarketValue,
    ratio:totalMarketValue>0?topMarketValue/totalMarketValue*100:null,missingReports,missingPrices,funds:top,allFunds,
    selection:'当季按上市市值估算值排序，最多取前10只，不足10只时取全部；分母为当季该指数全部候选 ETF 的上市市值估算合计。'};
}
async function mapLimit(items,limit,work){let next=0;const results=Array(items.length);await Promise.all(Array.from({length:limit},async()=>{while(next<items.length){const i=next++;results[i]=await work(items[i],i);}}));return results;}
class EtfRatio {
  constructor(dir,groupId='csi300'){this.group=etfGroup(groupId);this.dir=groupId==='csi300'?path.join(dir,'etf-ratio'):path.join(dir,'etf-ratio',groupId);this.pending=null;}
  async cache(key,ttl,work){const file=path.join(this.dir,key+'.json');let cached;try{cached=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
    if(cached&&!this.refreshing&&Date.now()-cached.savedAt<ttl)return cached.value;
    const value=await work();await fs.mkdir(this.dir,{recursive:true});const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify({savedAt:Date.now(),value}));await fs.rename(temp,file);return value;
  }
  async get(force=false){if(this.pending)return this.pending;this.refreshing=force;this.pending=this.cache('dataset-v3',force?0:6*3600000,()=>this.load()).finally(()=>{this.pending=null;this.refreshing=false;});return this.pending;}
  async load(){
    const {id,label,sqlId}=this.group;
    const funds=await this.cache('candidate-funds',86400000,async()=>{
      const raw=await request('https://fund.eastmoney.com/js/fundcode_search.js');const rows=JSON.parse(raw.slice(raw.indexOf('['),raw.lastIndexOf(']')+1));
      const candidates=selectCandidateFunds(rows,id);
      if(!candidates.length)throw new Error('未检索到普通'+label+' ETF 候选名单');return candidates;
    });
    const histories=await mapLimit(funds,3,async f=>({...f,reports:await this.cache('reports-'+f.code,6*3600000,async()=>{
      const rows=parseFundHistory(await request('https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=gmbd&code='+f.code));
      if(!rows.length)throw new Error(f.name+' 缺少季度规模数据，暂时无法可靠确认前十排名');return rows;
    })}));
    const dates=[...new Set(histories.flatMap(f=>f.reports.map(r=>r.date)))].sort().slice(-20);
    const months=[...new Set(dates.map(d=>d.slice(0,7).replace('-','')))];
    const indexErrors=[];
    const caps=(await mapLimit(months,2,month=>this.cache('floatcap-'+month,86400000,async()=>{
      const query=new URLSearchParams({sqlId,isPagination:'false',MDATE:month});
      const data=JSON.parse(await request('https://query.sse.com.cn/commonQuery.do?'+query));
      if(!Array.isArray(data.result)||!data.result.length)throw new Error(month+' '+label+'流通市值尚未公布');
      return data.result.map(r=>({date:dateISO(r.MDATE),floatCap:numeric(r.CPT_NGT)})).filter(r=>r.floatCap>0);
    }).catch(e=>{indexErrors.push({month,message:e.message});return [];}))).flat();
    const needed=funds.map(f=>f.code);const priceMaps={};const priceErrors=[];
    await mapLimit(needed,2,async code=>{
      try{priceMaps[code]=await this.cache('raw-month-close-'+code,86400000,async()=>{
        const symbol=(code.startsWith('15')?'sz':'sh')+code;
        const result=JSON.parse(await request('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param='+symbol+',month,,,120,'));
        const rows=result.data?.[symbol]?.month;if(!Array.isArray(rows))throw new Error('缺少未复权月末收盘价');
        return rows.map(r=>({date:r[0],close:numeric(r[2])})).filter(r=>r.close>0);
      });}catch(e){priceErrors.push({code,message:e.message});priceMaps[code]=[];}
    });
    return {group:{id,label,indexCode:this.group.indexCode},points:dates.map(d=>({...ratioPoint(d,histories,caps,priceMaps),concentration:concentrationPoint(d,histories,priceMaps)})),fetchedAt:new Date().toISOString(),frequency:'季度',topN:10,candidates:funds,
      selection:`每季按净资产选前10只普通${label} ETF，集中度按上市市值选前10；不足10只时取全部。排除联接、增强及衍生指数产品。`,
      formulas:{net:`头部 ETF 季末净资产合计 ÷ 同期${label}指数流通市值 × 100%`,market:`头部 ETF 季末总份额 × 未复权月末收盘价，合计后 ÷ 同期${label}指数流通市值 × 100%`,concentration:`当季市值前10只${label} ETF 合计市值 ÷ 当季全部候选${label} ETF 合计流通市值 × 100%；不足10只时取全部`},
      units:'资产、市值均为亿元；基金份额为亿份；收盘价为元。',priceErrors,indexErrors,
      notes:['基金份额公开披露值精确至0.01亿份，因此上市市值曲线标记为估算。','集中度分母为该指数全部候选普通 ETF 的上市市值估算合计；原有指数口径分母为上交所披露的对应指数流通市值。','季度末为非交易日时，收盘价和指数流通市值匹配同一个月末交易日。','缺少当季报告或同日价格时留空，不使用当前份额回填历史，不跨日期拼接。','基金候选名单采用当前可检索的对应指数普通 ETF；季度数据可能晚于报告期公布。','合计市值每季按市值重新选前十；单只曲线固定追踪最新完整季度前十的各自历史市值。'],
      sources:[{name:'上交所·上证统计月报·'+label+'指数',url:'https://www.sse.com.cn/aboutus/publication/monthly/index/'},{name:'天天基金·基金规模变动',url:'https://fundf10.eastmoney.com/gmbd_'+funds[0].code+'.html'},{name:'腾讯证券·未复权月线收盘价',url:'https://gu.qq.com/'+(funds[0].code.startsWith('15')?'sz':'sh')+funds[0].code}]};
  }
}
module.exports={ETF_GROUPS,etfGroup,selectCandidateFunds,EtfRatio,parseFundHistory,selectTopTen,ratioPoint,concentrationPoint};
