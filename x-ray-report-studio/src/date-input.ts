/** Normalize date separators without changing decimal measurements. */
export function normalizeDateInput(text:string):string {
 return text.replace(/(?<!\d)(\d{1,2})[.,](\d{1,2})[.,](\d{4})(?!\d)/g,(original,day,month,year)=>Number(day)>=1&&Number(day)<=31&&Number(month)>=1&&Number(month)<=12?`${day}.${month}.${year}`:original);
}
