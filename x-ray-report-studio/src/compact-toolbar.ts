function toolbarGroup(className: string) {
 const group=document.createElement('div');group.className=`tool-group ${className}`;return group;
}

/** Reuse the existing commands in a responsive wrapping toolbar. */
export function compactToolbar(root:HTMLElement){
 const ribbon=root.querySelector<HTMLElement>('.ribbon')!,header=root.querySelector<HTMLElement>('.topbar')!,tools=root.querySelector<HTMLElement>('.document-tools')!;
 const copy=document.createElement('details');copy.className='compact-menu copy-menu';
 const summary=document.createElement('summary');summary.textContent='Копировать ▼';summary.setAttribute('aria-label','Копировать');
 const panel=document.createElement('div');panel.className='compact-menu-items';
 for(const [id,title]of [['copy-report','Копировать полностью'],['copy-for-ai','Копировать для ИИ']]){const button=root.querySelector<HTMLButtonElement>('#'+id)!;button.textContent=title;panel.append(button);}copy.append(summary,panel);
 const xrs=toolbarGroup('toolbar-xrs');for(const id of ['review-unchanged','sticky-note-open','calculator','insert-size'])xrs.append(root.querySelector('#'+id)!);
 const copying=toolbarGroup('toolbar-copy');copying.append(copy);
 const files=toolbarGroup('toolbar-files');files.append(root.querySelector('#toggle-sidebar')!,root.querySelector('#open-report')!,root.querySelector('.save-menu')!);
 const zoom=toolbarGroup('toolbar-zoom');zoom.append(root.querySelector('.zoom-control')!);
 // The tab strip owns the + action. Keep the legacy node only for compatible automation.
 const legacyNewReport=root.querySelector<HTMLElement>('#new-report')!;legacyNewReport.hidden=true;
 const metadata=header.querySelector<HTMLElement>('.document-heading')!;metadata.classList.add('visually-hidden-metadata');metadata.append(legacyNewReport);
 ribbon.append(xrs,copying,files,zoom,metadata);header.remove();tools.remove();
 const close=()=>{copy.open=false;};panel.addEventListener('click',event=>{if((event.target as HTMLElement).closest('button'))close();});
 document.addEventListener('click',event=>{if(!(event.target instanceof Element)||!event.target.closest('.copy-menu'))close();});
 copy.addEventListener('keydown',event=>{if(event.key==='Escape'){close();summary.focus();event.stopPropagation();}});
}
