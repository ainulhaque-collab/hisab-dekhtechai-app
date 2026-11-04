import type { FinancialReport } from './financialReports';
import { formatBDT } from './money';

const escape = (value:string) => value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function reportDocument(report:FinancialReport,options:{workspace:string;scope:string;language:'en'|'bn';fonts?:string[]}) {
  if(report.entries.length>2000) throw new Error('REPORT_TOO_LARGE');
  const en=options.language==='en',money=(amount:string)=>escape(formatBDT(amount,{locale:options.language}));
  const fonts=(options.fonts||[]).map((font,index)=>{
    if(!/^[A-Za-z0-9+/=]+$/.test(font) || font.length>500_000) throw new Error('REPORT_FONT_INVALID');
    return `@font-face{font-family:Report${index};src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-style:normal;}`;
  }).join('');
  return `<!doctype html><html lang="${options.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Hisab — ${escape(report.from)} — ${escape(report.to)}</title><style>${fonts}
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px Report0,Report1,sans-serif;color:#172033;margin:0;line-height:1.6}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;margin:22px 0 8px}.muted{color:#475569}p{overflow-wrap:anywhere}.summary{display:table;width:100%;border-collapse:collapse}.summary p{display:table-row}.summary span{display:table-cell;padding:6px;border-bottom:1px solid #e2e8f0}.amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}th,td{border-bottom:1px solid #e2e8f0;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{text-align:left;background:#eff6ff}thead{display:table-header-group}tr{break-inside:avoid}td:first-child{width:18%}.note{width:42%}footer{margin-top:22px;font-size:10px;color:#475569}</style></head><body>
    <h1>${en?'Financial report':'হিসাবের রিপোর্ট'}</h1><p class="muted">Hisab DekhteChai · ${escape(options.workspace)}<br>${escape(options.scope)}<br>${escape(report.from)} — ${escape(report.to)} · BDT</p>
    <div class="summary">${[
      [en?'Opening wallet balance':'শুরুর ওয়ালেট স্থিতি',report.openingWalletMinor],
      [en?'Income':'আয়',report.incomeMinor],[en?'Expense':'খরচ',report.expenseMinor],
      [en?'Income minus expense':'আয় থেকে ব্যয় বাদে',report.netMinor],
      [en?'Closing wallet balance':'শেষের ওয়ালেট স্থিতি',report.closingWalletMinor]
    ].map(([label,amount])=>`<p><span>${label}</span><span class="amount">${money(amount)}</span></p>`).join('')}</div>
    <p class="muted">${en?'Opening capital, loan principal and transfer principal are excluded from income and expense. Transfer fees count once. Wallet balances replay reversals.':'আয়-ব্যয়ে প্রারম্ভিক মূলধন, ঋণের আসল ও স্থানান্তরের মূল টাকা নেই। স্থানান্তরের ফি একবার খরচ হয়। ওয়ালেটের স্থিতিতে বিপরীত এন্ট্রিও হিসাব হয়।'}</p>
    <h2>${en?'Selected transactions':'নির্বাচিত লেনদেন'} (${report.entries.length.toLocaleString(en?'en-GB':'bn-BD')})</h2>
    <table><thead><tr><th>${en?'Date / type':'তারিখ / ধরন'}</th><th class="note">${en?'Note':'নোট'}</th><th class="amount">${en?'Income':'আয়'}</th><th class="amount">${en?'Expense':'খরচ'}</th></tr></thead><tbody>${report.entries.map(({transaction,incomeMinor,expenseMinor})=>`<tr><td>${escape(transaction.effectiveDate)}<br>${escape(en?transaction.transactionType:({income:'আয়',expense:'খরচ',transfer:'স্থানান্তর',opening:'প্রারম্ভিক',correction:'সংশোধন',reversal:'বাতিল'}[transaction.transactionType]))}</td><td class="note">${escape(transaction.note||'—')}</td><td class="amount">${money(incomeMinor)}</td><td class="amount">${money(expenseMinor)}</td></tr>`).join('')}</tbody></table>
    <footer>${en?'Generated on this device. The report contains private financial records.':'এই ডিভাইসে তৈরি। রিপোর্টে ব্যক্তিগত আর্থিক তথ্য আছে।'}</footer></body></html>`;
}
