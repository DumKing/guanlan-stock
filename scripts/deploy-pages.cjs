const {spawnSync}=require('node:child_process');const fs=require('node:fs');
function run(args){const result=spawnSync(args[0],args.slice(1),{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
if(!fs.existsSync('docs/index.html'))throw new Error('请先运行 npm run web:build');
run(['git','add','docs']);
const changes=spawnSync('git',['diff','--cached','--quiet'],{stdio:'inherit'});
if(changes.status===1)run(['git','commit','-m','Update public stock data and GitHub Pages site']);
run(['git','-c','credential.helper=','-c','credential.helper=!gh auth git-credential','push','origin','main']);
