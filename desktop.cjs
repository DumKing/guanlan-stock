const {app,BrowserWindow,session,dialog}=require('electron');
const path=require('node:path');
const {createServer}=require('./server.cjs');
let backend,window;
app.setName('观澜股票');
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(async()=>{
    backend=await createServer({dataDir:path.join(app.getPath('userData'),'data')});
    session.defaultSession.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
    session.defaultSession.on('will-download',(_event,item)=>item.setSaveDialogOptions({title:'导出股票分析数据',defaultPath:path.join(app.getPath('downloads'),item.getFilename())}));
    function open(){
      window=new BrowserWindow({width:1460,height:980,minWidth:1080,minHeight:720,title:'观澜股票',backgroundColor:'#f5f6f8',
        webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==backend.origin)event.preventDefault();});
      window.loadURL(backend.origin+(process.argv.includes('--etf')?'/#etf':''));window.on('closed',()=>{window=null;});
    }
    open();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)open();});
  }).catch(e=>{dialog.showErrorBox('启动失败',e.message);app.quit();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('before-quit',()=>{backend?.market.cancelRanking();backend?.server.close();});
}
