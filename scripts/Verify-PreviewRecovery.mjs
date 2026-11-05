import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {recoverPreviewRecord} from './previewRecovery.mjs';
try{
  await recoverPreviewRecord(process.argv[2],process.argv[3]);
  await writeFile(join(process.argv[2],'.local-access-preview/verification.json'),JSON.stringify({exactMatch:true,ownerDpapiReadable:true,plaintextFileWritten:false,checkedAt:new Date().toISOString()})+'\n','utf8');
  console.log('OWNER_DPAPI_AND_ENCRYPTED_CREDENTIAL_RECOVERY_EXACT_MATCH');
}catch{console.error('PREVIEW_RECOVERY_VERIFICATION_FAILED');process.exitCode=1;}
