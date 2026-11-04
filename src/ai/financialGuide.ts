import { canonicalJson,computeSha256Sync } from '../sync/canonical.js';

export interface GuideInput {
  purpose:'gemini-financial-summary-v1';consent:true;language:'en'|'bn';
  from:string;to:string;incomeMinor:string;expenseMinor:string;
  categories:{label:string;amountMinor:string}[];
}
export interface FinancialGuide { observations:string[]; suggestions:string[]; limitation:string }
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,names:string[])=>Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const minor=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9]\d{0,39})$/.test(value);
function date(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000')) return false;
  const parsed=new Date(value+'T12:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
export function validateGuideInput(raw:unknown):GuideInput {
  if(!object(raw)||!exact(raw,['purpose','consent','language','from','to','incomeMinor','expenseMinor','categories'])||raw.purpose!=='gemini-financial-summary-v1'||raw.consent!==true||!['bn','en'].includes(raw.language as string)||!date(raw.from)||!date(raw.to)||raw.from>raw.to||!minor(raw.incomeMinor)||!minor(raw.expenseMinor)||!Array.isArray(raw.categories)||raw.categories.length>8) throw new Error('AI_GUIDE_INPUT_INVALID');
  let total=0n;
  for(const category of raw.categories) {
    if(!object(category)||!exact(category,['label','amountMinor'])||!text(category.label,100)||!minor(category.amountMinor)) throw new Error('AI_GUIDE_INPUT_INVALID');
    total+=BigInt(category.amountMinor);
  }
  if(total!==BigInt(raw.expenseMinor)||BigInt(raw.incomeMinor)+total===0n) throw new Error('AI_GUIDE_INPUT_INVALID');
  return raw as unknown as GuideInput;
}
export function guideInputHash(input:GuideInput) { return computeSha256Sync(canonicalJson(validateGuideInput(input))); }
export function summaryForGuide(report:{from:string;to:string;incomeMinor:string;expenseMinor:string;categories:{id:string;amountMinor:string}[]},labels:ReadonlyMap<string,string>,language:'en'|'bn'):GuideInput {
  const keep=report.categories.length>8?7:8;
  const categories=report.categories.slice(0,keep).map(category=>({label:(labels.get(category.id)?.trim()|| (language==='en'?'Other':'অন্যান্য')).slice(0,100),amountMinor:category.amountMinor}));
  if(report.categories.length>8) categories.push({label:language==='en'?'Other categories':'অন্যান্য খাত',amountMinor:report.categories.slice(7).reduce((sum,item)=>sum+BigInt(item.amountMinor),0n).toString()});
  return validateGuideInput({purpose:'gemini-financial-summary-v1',consent:true,language,from:report.from,to:report.to,incomeMinor:report.incomeMinor,expenseMinor:report.expenseMinor,categories});
}
export function validateFinancialGuide(raw:unknown):FinancialGuide {
  if(!object(raw)||!exact(raw,['observations','suggestions','limitation'])||!text(raw.limitation,500)) throw new Error('AI_RESPONSE_INVALID');
  for(const key of ['observations','suggestions']) if(!Array.isArray(raw[key])||raw[key].length<1||raw[key].length>3||raw[key].some((entry:unknown)=>!text(entry,500))) throw new Error('AI_RESPONSE_INVALID');
  return raw as unknown as FinancialGuide;
}
export const financialGuideSchema={type:'object',properties:{observations:{type:'array',minItems:1,maxItems:3,items:{type:'string'}},suggestions:{type:'array',minItems:1,maxItems:3,items:{type:'string'}},limitation:{type:'string'}},required:['observations','suggestions','limitation'],additionalProperties:false};
