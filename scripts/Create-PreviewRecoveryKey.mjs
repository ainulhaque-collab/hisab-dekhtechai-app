// Operator-only helper. Requires the pinned local openpgp tool, not an app dep.
// Generates no server credential and emits only a public encryption key.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.argv[2];if(!root||!root.endsWith('hisab-dekhtechai-app'))throw Error('OPERATOR_ROOT_REQUIRED');
const shell=process.argv[3];if(!shell?.endsWith('pwsh.exe'))throw Error('POWERSHELL_7_PATH_REQUIRED');
const require=createRequire(join(root,'.local-tools/secret-backup/package.json'));
const openpgp=await import(pathToFileURL(require.resolve('openpgp')).href);
const folder=join(root,'.local-access-preview');await mkdir(folder,{recursive:true});
const privateFile=join(folder,'recovery-private-key.dpapi');
try{await access(privateFile);throw Error('RECOVERY_KEY_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
const key=await openpgp.generateKey({type:'rsa',rsaBits:3072,userIDs:[{name:'Hisab Preview Recovery'}],format:'armored',config:{v6Keys:false}});
const script="$ErrorActionPreference='Stop';$raw=[Console]::In.ReadToEnd();$inputKey=$raw|ConvertFrom-Json;$secure=ConvertTo-SecureString $inputKey.key -AsPlainText -Force;$secure|ConvertFrom-SecureString|Set-Content -LiteralPath $inputKey.path -Encoding utf8;$roundTrip=(Get-Content -LiteralPath $inputKey.path -Raw).Trim()|ConvertTo-SecureString;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($roundTrip);try{if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) -cne $inputKey.key){throw 'RECOVERY_VERIFY_FAILED'};Write-Output 'RECOVERY_PRIVATE_KEY_VERIFIED'}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}";
const args=['-NoProfile','-NonInteractive','-Command',script];
if(args.some(value=>value.includes(key.privateKey)))throw Error('UNSAFE_ARGUMENT');
const result=spawnSync(shell,args,{input:JSON.stringify({key:key.privateKey,path:privateFile}),encoding:'utf8',windowsHide:true,maxBuffer:8192});
if(result.status!==0||result.stdout.trim()!=='RECOVERY_PRIVATE_KEY_VERIFIED'){
  const errorId=result.stderr?.match(/FullyQualifiedErrorId\s*:\s*([A-Za-z0-9.,_]+)/)?.[1]??'NONE';
  throw Error(`RECOVERY_PRIVATE_KEY_UNAVAILABLE status=${result.status} code=${result.error?.code??'NONE'} id=${errorId} crypto=${result.stderr?.includes('cryptographic')===true}`);
}
await writeFile(join(folder,'recovery-public-key.asc'),key.publicKey,'utf8');
console.log(JSON.stringify({publicKey:key.publicKey,privateRecoveryVerified:true}));
