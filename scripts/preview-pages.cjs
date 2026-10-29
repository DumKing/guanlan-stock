const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve('docs'),prefix='/guanlan-stock/';
http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/'){res.writeHead(302,{Location:prefix});return res.end();}
  if(!pathname.startsWith(prefix)){res.writeHead(404);return res.end();}const file=path.resolve(root,pathname.slice(prefix.length)||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  const type={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.gz':'application/gzip'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(await fs.readFile(file));
}catch{res.writeHead(404);res.end();}}).listen(Number(process.env.PORT)||8910,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+(Number(process.env.PORT)||8910)+prefix));
