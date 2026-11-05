export function openStickyNote() {
  const existing = document.querySelector<HTMLElement>('.sticky-note');
  if (existing) { existing.querySelector('textarea')?.focus(); return; }
  const key='xray.sticky-note.v1';
  let saved:{text?:string;x?:number;y?:number}={};
  try { saved=JSON.parse(localStorage.getItem(key)??'{}')??{}; } catch {}
  const note=document.createElement('aside');note.className='sticky-note';note.setAttribute('aria-label','Заметка');
  note.innerHTML='<header><span>Заметка</span><button type="button" aria-label="Закрыть заметку" title="Закрыть">×</button></header><textarea aria-label="Текст заметки" placeholder="Введите заметку…"></textarea>';
  const area=note.querySelector('textarea')!;area.value=typeof saved.text==='string'?saved.text:'';
  const position=(x:number,y:number)=>{note.style.left=`${Math.max(0,Math.min(x,window.innerWidth-240))}px`;note.style.top=`${Math.max(0,Math.min(y,window.innerHeight-80))}px`;};
  position(Number.isFinite(saved.x)?saved.x!:12,Number.isFinite(saved.y)?saved.y!:12);
  const save=()=>{try {localStorage.setItem(key,JSON.stringify({text:area.value,x:parseFloat(note.style.left),y:parseFloat(note.style.top)}));}catch{}};
  area.addEventListener('input',save);note.querySelector('button')!.onclick=()=>{save();note.remove();};
  const header=note.querySelector('header')!;
  header.onpointerdown=event=>{if((event.target as HTMLElement).closest('button'))return;event.preventDefault();const rect=note.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;header.setPointerCapture(event.pointerId);header.onpointermove=move=>position(move.clientX-dx,move.clientY-dy);header.onpointerup=()=>{header.onpointermove=null;save();};header.onpointercancel=()=>{header.onpointermove=null;save();};};
  document.body.append(note);area.focus();
}
