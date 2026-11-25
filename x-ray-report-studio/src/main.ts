// Catch initialization failures before the editor and its save handlers are loaded.
let fatal=false;
function showFailure(error:unknown){
 if(fatal)return;fatal=true;
 Reflect.set(window,'xrsFatal',true);
 const stack=error instanceof Error?error.stack??'':'';
 const frames=[...stack.matchAll(/:(\d+):(\d+)\)?(?:\n|$)/g)].slice(0,12).map(m=>`${m[1]}:${m[2]}`);
 const desktop=Reflect.get(window,'desktop');
 desktop?.reportDiagnostic?.({event:'renderer-exception',errorType:error instanceof Error?error.name:'Unknown',frames});
 const screen=document.createElement('section');screen.id='xrs-emergency';screen.setAttribute('role','alert');
 screen.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#1d2935;color:white;padding:40px;font:18px sans-serif';
 const text=document.createElement('p');text.textContent='Ошибка интерфейса. Автосохранение остановлено для защиты документов. Закройте и заново откройте XRS. Сохранённое рабочее пространство не удалено.';
 const logs=document.createElement('button');logs.textContent='Открыть диагностические журналы';logs.onclick=()=>void desktop?.openDiagnostics?.();screen.append(text,logs);document.body.append(screen);
}
window.addEventListener('error',event=>{if(event.error)showFailure(event.error);});
window.addEventListener('unhandledrejection',event=>showFailure(event.reason));
void import('./template-updates.ts').then(async module=>{await module.loadTemplateCatalog();return import('./workspace');}).catch(showFailure);
