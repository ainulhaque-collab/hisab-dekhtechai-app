// Operator-only: decrypted material is never logged or returned to AI tools.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export async function recoverPreviewRecord(root,shell){
  if(!root?.endsWith('hisab-dekhtechai-app')||!shell?.endsWith('pwsh.exe'))throw Error('OPERATOR_PATH_REQUIRED');
  const require=createRequire(join(root,'.local-tools/secret-backup/package.json'));
  const pgp=await import(pathToFileURL(require.resolve('openpgp')).href);
  const folder=join(root,'.local-access-preview'),backup=JSON.parse(await readFile(join(folder,'credentials.pgp.json'),'utf8'));
  const script="$ErrorActionPreference='Stop';$path=[Console]::In.ReadToEnd();$saved=(Get-Content -LiteralPath $path -Raw).Trim()|ConvertTo-SecureString;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($saved);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}";
  // Captured private IPC only; never inherit or forward child stdout/stderr.
  const readKey=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',script],{input:join(folder,'recovery-private-key.dpapi'),encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],maxBuffer:32*1024});
  if(readKey.status!==0)throw Error('LOCAL_PRIVATE_KEY_UNAVAILABLE');
  const privateKey=await pgp.readPrivateKey({armoredKey:readKey.stdout});readKey.stdout='';
  const result=await pgp.decrypt({message:await pgp.readMessage({binaryMessage:Buffer.from(backup.encryptedBackup,'hex')}),decryptionKeys:privateKey,format:'utf8'});
  if(typeof result.data!=='string'||createHash('sha256').update(result.data).digest('hex')!==backup.recordSha256)throw Error('RECOVERY_CHECKSUM_MISMATCH');
  const record=JSON.parse(result.data);
  if(record.project!=='sfzitbasxrpmtmldujbm'||record.branch!=='codex/verified-service-identity'||!/^[a-f0-9]{64}$/.test(record.databasePassword)||!/^[a-f0-9]{64}$/.test(record.wrappingKey))throw Error('RECOVERY_SCOPE_MISMATCH');
  return record;
}
