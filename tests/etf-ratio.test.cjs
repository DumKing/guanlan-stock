const {test}=require('node:test');const assert=require('node:assert/strict');const {parseFundHistory,ratioPoint,selectTopTen,concentrationPoint,selectCandidateFunds,EtfRatio}=require('../etf-ratio.cjs');
const funds=()=>Array.from({length:11},(_,i)=>({code:String(510300+i),name:'ETF'+i,reports:[{date:'2026-09-30',shares:2,netAssets:i===10?1:10}]}));
const prices=()=>Object.fromEntries(funds().map(f=>[f.code,[{date:'2026-09-30',close:5}]]));
test('解析真实披露表格式，份额亿份与资产亿元不混淆',()=>{
  const html="var gmbd_apidata={content:\"<table><tr><th>日期</th></tr><tr><td>2026-09-30</td><td>201.07</td><td>149.02</td><td>241.20</td><td>1,068.79</td><td>12.66%</td></tr></table>\"};";
  assert.deepEqual(parseFundHistory(html),[{date:'2026-09-30',shares:241.2,netAssets:1068.79}]);
});
test('两种占比使用同日流通市值且单位一致，每期只选净资产前十',()=>{
  const p=ratioPoint('2026-09-30',funds(),[{date:'2026-09-30',floatCap:10000}],prices());
  assert.equal(p.count,10);assert.equal(p.netAssets,100);assert.equal(p.marketValue,100);assert.equal(p.netRatio,1);assert.equal(p.marketRatio,1);assert.equal(p.funds.some(f=>f.code==='510310'),false);
  const moved=funds();moved[10].reports[0].netAssets=20;assert.equal(selectTopTen(moved,'2026-09-30')[0].code,'510310');
});
test('份额与价格日期不匹配时上市市值留空，净资产曲线仍可计算',()=>{
  const map=prices();map['510300']=[{date:'2026-09-29',close:5}];const p=ratioPoint('2026-09-30',funds(),[{date:'2026-09-30',floatCap:10000}],map);
  assert.equal(p.netRatio,1);assert.equal(p.marketRatio,null);assert.equal(p.marketValue,null);
});
test('季末休市时匹配同个月末交易日；不跨月借用分母或缺失报告',()=>{
  const map=prices();for(const code in map)map[code][0].date='2026-09-29';const p=ratioPoint('2026-09-30',funds(),[{date:'2026-09-29',floatCap:10000}],map);assert.equal(p.marketRatio,1);assert.equal(p.indexDate,'2026-09-29');
  assert.equal(ratioPoint('2026-09-30',funds(),[{date:'2026-08-31',floatCap:10000}],map).netRatio,null);
  const missing=funds();missing[0].reports=[{date:'2026-06-30',shares:2,netAssets:10}];assert.equal(ratioPoint('2026-09-30',missing,[{date:'2026-09-29',floatCap:10000}],map).netRatio,null);
});

test('ETF集中度分母包含全部基金，按市值而非净资产重排前十',()=>{
  const list=funds(),map=prices();map['510310'][0].close=20;
  const p=concentrationPoint('2026-09-30',list,map);
  assert.equal(p.allCount,11);assert.equal(p.totalMarketValue,140);assert.equal(p.topMarketValue,130);
  assert.equal(p.funds[0].code,'510310');assert.equal(p.ratio,130/140*100);
  assert.equal(p.topMarketValue,p.funds.reduce((sum,f)=>sum+f.marketValue,0));
  assert.equal(p.totalMarketValue,p.allFunds.reduce((sum,f)=>sum+f.marketValue,0));
  assert.ok(p.ratio<=100&&p.ratio>0);
});
test('尾部ETF缺少价格或报告也不能静默从集中度分母排除',()=>{
  const map=prices();delete map['510310'];
  const p=concentrationPoint('2026-09-30',funds(),map);
  assert.equal(p.ratio,null);assert.equal(p.totalMarketValue,null);assert.equal(p.topMarketValue,null);
  assert.deepEqual(p.missingPrices,['510310']);assert.equal(p.allCount,11);
  const list=funds();list[10].reports=[{date:'2026-06-30',shares:2,netAssets:1}];
  const missing=concentrationPoint('2026-09-30',list,prices());
  assert.equal(missing.ratio,null);assert.deepEqual(missing.missingReports,['510310']);
});
test('集中度严格匹配同日价格，非交易日使用相同的月末交易日',()=>{
  const map=prices();map['510310'][0].date='2026-09-29';
  assert.equal(concentrationPoint('2026-09-30',funds(),map).ratio,null);
  for(const code in map)map[code][0].date='2026-09-29';
  const p=concentrationPoint('2026-09-30',funds(),map);
  assert.equal(p.priceDate,'2026-09-29');assert.equal(p.ratio,100/110*100);
});
test('上市前不纳入分母；单只历史值保留基金身份及数据断点',()=>{
  const list=funds();list.push({code:'159999',name:'新ETF',reports:[{date:'2026-09-30',shares:100,netAssets:100}]});
  const map=prices();map['159999']=[{date:'2026-10-30',close:1}];
  const p=concentrationPoint('2026-09-30',list,map);
  assert.equal(p.allCount,11);assert.equal(p.allFunds.some(f=>f.code==='159999'),false);
  assert.equal(p.allFunds.find(f=>f.code==='510300').marketValue,10);
  delete map['510300'];const missing=concentrationPoint('2026-09-30',list,map);
  assert.equal(missing.allFunds.find(f=>f.code==='510300').marketValue,null);
  assert.equal(missing.allFunds.find(f=>f.code==='510301').marketValue,10);
});

test('三个指数独立筛选普通ETF，不混入联接、增强和相近衍生指数',()=>{
  const rows=[['510300','','沪深300ETF甲'],['510050','','上证50ETF乙'],['588000','','科创50ETF丙'],['588050','','科创50ETF丁'],['588050','','科创50ETF丁'],['588100','','科创50ETF增强'],['588200','','科创50ETF联接A'],['588300','','科创成长50ETF'],['588400','','科创100ETF'],['510100','','上证50ETF增强'],['000001','','上证50ETF联接']];
  assert.deepEqual(selectCandidateFunds(rows,'csi300').map(f=>f.code),['510300']);
  assert.deepEqual(selectCandidateFunds(rows,'sse50').map(f=>f.code),['510050']);
  assert.deepEqual(selectCandidateFunds(rows,'star50').map(f=>f.code),['588000','588050']);
  assert.throws(()=>selectCandidateFunds(rows,'../other'),/不支持/);assert.throws(()=>new EtfRatio('data','constructor'),/不支持/);
});
test('不足十只时按实际数量取全部，集中度100%，指数口径仍按对应分母计算',()=>{
  const list=funds().slice(0,9),map=prices();const p=concentrationPoint('2026-09-30',list,map);
  assert.equal(p.allCount,9);assert.equal(p.topCount,9);assert.equal(p.ratio,100);assert.equal(p.topMarketValue,90);
  const index=ratioPoint('2026-09-30',list,[{date:'2026-09-30',floatCap:9000}],map);assert.equal(index.count,9);assert.equal(index.marketRatio,1);
  assert.equal(concentrationPoint('2026-09-30',[],{}).ratio,null);
});
test('三组ETF缓存、并发请求和强制更新互不串用',async()=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'etf-groups-'));
  try{
    const groups=['csi300','sse50','star50'].map(id=>new EtfRatio(dir,id));
    assert.equal(new Set(groups.map(g=>g.dir)).size,3);
    const calls=[0,0,0];groups.forEach((g,i)=>{g.load=async()=>{calls[i]++;await new Promise(resolve=>setTimeout(resolve,5));return {id:g.group.id,generation:calls[i]};};});
    const results=await Promise.all(groups.flatMap(g=>[g.get(),g.get()]));
    assert.deepEqual(results.map(r=>r.id),['csi300','csi300','sse50','sse50','star50','star50']);assert.deepEqual(calls,[1,1,1]);
    assert.equal((await groups[1].get(true)).generation,2);assert.equal((await groups[0].get()).generation,1);assert.equal((await groups[2].get()).generation,1);
    assert.deepEqual(calls,[1,2,1]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
