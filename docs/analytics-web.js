(()=>{const module={exports:{}};
function rangeStats(bars) {
  const rows = bars.filter(b => Number.isFinite(b.close) && b.close > 0).sort((a,b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return null;
  let peak = rows[0], trough = rows[0], drawdown = 0, maxGain = 0;
  let ddStart = peak.date, ddEnd = peak.date, gainStart = trough.date, gainEnd = trough.date;
  for (const b of rows) {
    const dd = (peak.close - b.close) / peak.close * 100;
    const gain = (b.close - trough.close) / trough.close * 100;
    if (dd > drawdown) { drawdown = dd; ddStart = peak.date; ddEnd = b.date; }
    if (gain > maxGain) { maxGain = gain; gainStart = trough.date; gainEnd = b.date; }
    if (b.close > peak.close) peak = b;
    if (b.close < trough.close) trough = b;
  }
  return { change: (rows.at(-1).close / rows[0].close - 1) * 100, drawdown, maxGain,
    firstDate: rows[0].date, lastDate: rows.at(-1).date, firstClose: rows[0].close,
    lastClose: rows.at(-1).close, sessions: rows.length, ddStart, ddEnd, gainStart, gainEnd };
}

function indicators(bars) {
  const close = bars.map(b => b.close);
  const ma = n => close.map((_,i) => i < n-1 ? null : close.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n);
  const ema = n => { let prev = close[0]; return close.map(x => (prev = x*2/(n+1)+prev*(1-2/(n+1)))); };
  const fast = ema(12), slow = ema(26), dif = close.map((_,i)=>fast[i]-slow[i]);
  let prev = dif[0]; const dea = dif.map(x => (prev = x*.2+prev*.8));
  const rsi = Array(close.length).fill(null); let up=0, down=0;
  for(let i=1;i<close.length;i++) {
    const d = close[i]-close[i-1];
    if(i<=14) { up += Math.max(0,d)/14; down += Math.max(0,-d)/14; }
    else { up=(up*13+Math.max(0,d))/14; down=(down*13+Math.max(0,-d))/14; }
    if(i>=14) rsi[i] = up+down === 0 ? 50 : 100*up/(up+down);
  }
  return { ma5:ma(5), ma10:ma(10), ma20:ma(20), dif, dea, macd:dif.map((x,i)=>(x-dea[i])*2), rsi };
}

module.exports = { rangeStats, indicators };

window.GuanlanAnalytics=module.exports;})();
