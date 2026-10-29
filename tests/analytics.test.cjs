const {test}=require('node:test');const assert=require('node:assert/strict');
const {rangeStats,indicators}=require('../analytics.cjs');
const bars=values=>values.map((close,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,close}));
test('回撤必须先出现高点，最大涨幅必须先出现低点',()=>{
  const s=rangeStats(bars([100,80,120,60,90]));
  assert.ok(Math.abs(s.change+10)<1e-10);assert.equal(s.drawdown,50);assert.equal(s.maxGain,50);
  assert.equal(s.ddStart,'2026-01-03');assert.equal(s.ddEnd,'2026-01-04');
  assert.equal(s.gainStart,'2026-01-02');assert.equal(s.gainEnd,'2026-01-03');
});
test('单调下跌不存在最大上涨，不能将最小值与此前最高值颠倒',()=>{
  const s=rangeStats(bars([100,90,50]));assert.equal(s.maxGain,0);assert.equal(s.drawdown,50);assert.equal(s.change,-50);
});
test('单调上涨不存在回撤',()=>{const s=rangeStats(bars([50,75,100]));assert.equal(s.drawdown,0);assert.equal(s.maxGain,100);});
test('常数序列与不足两个有效交易日',()=>{const s=rangeStats(bars([10,10,10]));assert.equal(s.change,0);assert.equal(s.drawdown,0);assert.equal(s.maxGain,0);assert.equal(rangeStats(bars([10])),null);assert.equal(rangeStats(bars([null,0,10])),null);});
test('均线窗口和 RSI 初始化与边界',()=>{const a=indicators(bars(Array.from({length:30},(_,i)=>i+1)));assert.equal(a.ma5[3],null);assert.equal(a.ma5[4],3);assert.equal(a.ma20[19],10.5);assert.equal(a.rsi[13],null);assert.equal(a.rsi[14],100);assert.equal(indicators(bars(Array(20).fill(10))).rsi[14],50);});
