import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberAdminReturn,consumeAdminReturn} from '../access/adminReturn';
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
test('Admin return is consumed once only after a captured callback',()=>{
  const saved=storage();rememberAdminReturn(saved,1000);assert.equal(consumeAdminReturn(false,saved,2000),false);assert.equal(saved.values.size,1);
  assert.equal(consumeAdminReturn(true,saved,2000),true);assert.equal(consumeAdminReturn(true,saved,2000),false);
});
test('Expired, future and attacker-controlled destinations cannot redirect a callback',()=>{
  const saved=storage();rememberAdminReturn(saved,1000);assert.equal(consumeAdminReturn(true,saved,601001),false);
  rememberAdminReturn(saved,3000);assert.equal(consumeAdminReturn(true,saved,2000),false);
  saved.setItem('hisab_admin_return_v1',JSON.stringify({path:'https://attacker.invalid',issuedAt:1000}));assert.equal(consumeAdminReturn(true,saved,2000),false);
  saved.setItem('hisab_admin_return_v1','invalid json');assert.equal(consumeAdminReturn(true,saved,2000),false);
});
test('Storage denial never prevents login or creates an Admin return',()=>{
  const denied={getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();}};
  assert.doesNotThrow(()=>rememberAdminReturn(denied));assert.equal(consumeAdminReturn(true,denied),false);assert.equal(consumeAdminReturn(true,undefined),false);
});
