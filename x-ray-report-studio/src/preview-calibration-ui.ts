import {calibratedCapacity,calibratedWidth,type Capacity,type WidthCapacity,type PreviewCalibration} from './preview-calibration.ts';
export type CalibrationUIOptions={capacity:Capacity;width:WidthCapacity;font:string;optimize:boolean;value:PreviewCalibration;available:boolean;save:(value:PreviewCalibration)=>void;change:()=>void;openPreview?:()=>void};
/** Shared controls in physician settings and the single existing preview. */
export function mountCalibrationControls(root:HTMLElement,options:CalibrationUIOptions){
 let value={...options.value};
 root.classList.add('preview-calibration-controls');
 root.innerHTML=`<h3>Калибровка предпросмотра Word</h3><h4>Количество строк на странице</h4><p data-calibration-diagnostics></p><div class="calibration-adjust"><button type="button" class="btn" data-calibration-minus aria-label="Уменьшить вместимость на одну строку">−1</button><label>Установлено: <input type="number" step="1" data-calibration-target aria-label="Целевая вместимость в стандартных строках"> строк</label><button type="button" class="btn" data-calibration-plus aria-label="Увеличить вместимость на одну строку">+1</button><button type="button" class="btn" data-calibration-reset>Сбросить</button></div><label class="checkbox"><input type="checkbox" data-calibration-enabled> Применять калибровку строк</label><h4>Количество знаков в строке</h4><p data-character-diagnostics></p><div class="calibration-adjust"><button type="button" class="btn" data-character-minus aria-label="Уменьшить ширину на один знак">−1</button><label>Установлено: <output data-character-target></output> знаков</label><button type="button" class="btn" data-character-plus aria-label="Увеличить ширину на один знак">+1</button><button type="button" class="btn" data-character-reset>Сбросить ширину</button></div><p>Число знаков показывает ширину по контрольной строке. Реальные переносы зависят от текста и шрифта. Настройки действуют только в предпросмотре.</p><p data-calibration-error role="status"></p>${options.openPreview?'<button class="btn" type="button" data-calibration-open>Открыть предпросмотр</button>':''}`;
 const input=root.querySelector<HTMLInputElement>('[data-calibration-target]')!,enabled=root.querySelector<HTMLInputElement>('[data-calibration-enabled]')!,error=root.querySelector<HTMLElement>('[data-calibration-error]')!;
 const minus=root.querySelector<HTMLButtonElement>('[data-calibration-minus]')!,plus=root.querySelector<HTMLButtonElement>('[data-calibration-plus]')!,reset=root.querySelector<HTMLButtonElement>('[data-calibration-reset]')!;
 const widthMinus=root.querySelector<HTMLButtonElement>('[data-character-minus]')!,widthPlus=root.querySelector<HTMLButtonElement>('[data-character-plus]')!,widthReset=root.querySelector<HTMLButtonElement>('[data-character-reset]')!;
 const paint=()=>{
  const result=calibratedCapacity(options.capacity,value),stored=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,value.offset));
  input.min=String(options.capacity.baseLines+options.capacity.minimumOffset);input.max=String(options.capacity.baseLines+options.capacity.maximumOffset);input.value=String(options.capacity.baseLines+stored);input.disabled=!options.available;
  enabled.checked=value.enabled;enabled.disabled=!options.available;minus.disabled=!options.available||stored<=options.capacity.minimumOffset;plus.disabled=!options.available||stored>=options.capacity.maximumOffset;reset.disabled=!options.available;
  root.dataset.baseHeight=String(result.baseHeight);root.dataset.effectiveHeight=String(result.height);root.dataset.standardLine=String(result.lineHeight);root.dataset.baseLines=String(result.baseLines);root.dataset.offset=String(value.offset);root.dataset.effectiveOffset=String(result.offset);
  root.querySelector('[data-calibration-diagnostics]')!.textContent=`Расчётное значение: ${result.baseLines} строк. Поправка врача: ${value.offset>0?'+':''}${value.offset}. Эффективная вместимость: ${result.target} строк. Стандартная строка: ${options.font}. Оптимизация печати: ${options.optimize?'включена':'выключена'}.`;
  const width=calibratedWidth(options.width,value);
  root.dataset.baseWidth=String(options.width.baseWidth);root.dataset.effectiveWidth=String(width.width);
  root.dataset.baseCharacters=String(options.width.baseCharacters);root.dataset.characterOffset=String(value.characterOffset??0);
  root.querySelector('[data-character-diagnostics]')!.textContent=`Расчётное значение: ${options.width.baseCharacters} знаков.`;
  root.querySelector('[data-character-target]')!.textContent=String(width.target);
  widthMinus.disabled=!options.available||width.offset<=options.width.minimumOffset;
  widthPlus.disabled=!options.available||width.offset>=options.width.maximumOffset;
  widthReset.disabled=!options.available||(value.characterOffset??0)===0;
  error.textContent=!options.available?'Сначала сохраните врача, чтобы настроить его калибровку.':(result.limited||width.limited)?'Поправка ограничена безопасной областью страницы.':plus.disabled?'Достигнут безопасный верхний предел: поля и футер сохранены.':'';
 };
 const save=(next:PreviewCalibration)=>{try{options.save(next);value=next;paint();options.change();}catch(e){paint();error.textContent=(e as Error).message;}};
 const adjust=(offset:number)=>{offset=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,offset));save({...value,offset,lastTarget:options.capacity.baseLines+offset});};
 minus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines-1);plus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines+1);
 input.onchange=()=>{const target=Number(input.value);if(!Number.isInteger(target)||target<Number(input.min)||target>Number(input.max)){paint();error.textContent=`Введите целое число от ${input.min} до ${input.max}.`;return;}adjust(target-options.capacity.baseLines);};
 enabled.onchange=()=>save({...value,enabled:enabled.checked,lastTarget:value.lastTarget??Number(input.value)});reset.onclick=()=>save({...value,offset:0,lastTarget:options.capacity.baseLines});
 const adjustWidth=(change:number)=>save({...value,characterOffset:calibratedWidth(options.width,value).offset+change});
 widthMinus.onclick=()=>adjustWidth(-1);widthPlus.onclick=()=>adjustWidth(1);widthReset.onclick=()=>save({...value,characterOffset:0});
 root.querySelector<HTMLButtonElement>('[data-calibration-open]')?.addEventListener('click',()=>options.openPreview?.());paint();
 return {get value(){return {...value};}};
}
