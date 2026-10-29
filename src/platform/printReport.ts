import { Capacitor, registerPlugin } from '@capacitor/core';
import type { FinancialReport } from '../domain/financialReports';
import { reportDocument } from '../domain/reportDocument';
import latinFont from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import bengaliFont from '@fontsource-variable/noto-sans-bengali/files/noto-sans-bengali-bengali-wght-normal.woff2?url';

const native = registerPlugin<{open(options:{html:string;name:string}):Promise<void>}>('ReportPrint');
async function embeddedFont(url:string) {
  const response=await fetch(url,{credentials:'omit',cache:'force-cache'});
  if(!response.ok) throw new Error('REPORT_FONT_UNAVAILABLE');
  const bytes=new Uint8Array(await response.arrayBuffer());
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192) binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(binary);
}
/** System print-to-PDF, local only. Opening the dialog is not a saved-file receipt. */
export async function printFinancialReport(report:FinancialReport,options:{workspace:string;scope:string;language:'en'|'bn'}) {
  const fonts=await Promise.all([embeddedFont(latinFont),embeddedFont(bengaliFont)]);
  const html=reportDocument(report,{...options,fonts});
  if(Capacitor.getPlatform()==='android') return native.open({html,name:`Hisab ${report.from} ${report.to}`});
  const frame=document.createElement('iframe');
  frame.title=options.language==='en'?'Financial report print preview':'হিসাবের রিপোর্ট প্রিন্ট প্রিভিউ';
  frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
  try {
    const ready=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('REPORT_PRINT_UNAVAILABLE')),15000);
      frame.onload=()=>{clearTimeout(timer);resolve();}; frame.onerror=()=>{clearTimeout(timer);reject(new Error('REPORT_PRINT_UNAVAILABLE'));};
    });
    frame.srcdoc=html;document.body.append(frame);await ready;
    if(!frame.contentWindow || !frame.contentDocument) throw new Error('REPORT_PRINT_UNAVAILABLE');
    await frame.contentDocument.fonts.ready;
    frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
    frame.contentWindow.focus();frame.contentWindow.print();
    setTimeout(()=>frame.remove(),300_000);
  } catch(error) { frame.remove();throw error; }
}
