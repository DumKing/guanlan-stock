const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
async function exists(file){try{await fs.access(file);return true;}catch{return false;}}
async function seed(dir,source=path.resolve('docs/data')){
  await fs.mkdir(dir,{recursive:true});const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  for(const [from,to] of [['market.json','market.json'],['indices.json','web-indices.json']])if(!await exists(path.join(dir,to)))await fs.copyFile(path.join(source,from),path.join(dir,to));
  const history=path.join(dir,'history');await fs.mkdir(history,{recursive:true});
  if(!(await fs.readdir(history)).some(f=>f.endsWith('.json'))){
    for(const file of new Set(Object.values(manifest.historyFiles))){const records=JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(source,file))));
      for(const [symbol,row] of Object.entries(records)){const full=row.coverageStart==='1990-01-01',start=full?'':row.coverageStart,end=full?'':row.bars.at(-1)?.[0]||manifest.historyThrough;
        const value={bars:row.bars.map(b=>({date:b[0],open:b[1],close:b[2],high:b[3],low:b[4],volume:b[5]})),fetchedAt:row.fetchedAt,source:row.source,adjustment:'前复权',period:'day'};
        await fs.writeFile(path.join(history,['v2',symbol,'day',start,end].join('_')+'.json'),JSON.stringify(value));
      }
    }
  }
  for(const id of ['csi300','sse50','star50']){const folder=path.join(dir,'etf-ratio',id==='csi300'?'':id),file=path.join(folder,'dataset-v3.json');if(!await exists(file)){const value=JSON.parse(await fs.readFile(path.join(source,'etf-'+id+'.json'),'utf8'));await fs.mkdir(folder,{recursive:true});await fs.writeFile(file,JSON.stringify({savedAt:Date.parse(value.fetchedAt),value}));}}
}
module.exports={seed};
