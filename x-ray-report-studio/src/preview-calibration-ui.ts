import {calibratedCapacity,type Capacity,type PreviewCalibration} from './preview-calibration.ts';
export type CalibrationUIOptions={capacity:Capacity;font:string;optimize:boolean;value:PreviewCalibration;available:boolean;save:(value:PreviewCalibration)=>void;change:()=>void;openPreview?:()=>void};
/** Shared controls in physician settings and the single existing preview. */
export function mountCalibrationControls(root:HTMLElement,options:CalibrationUIOptions){
 let value={...options.value};
 root.classList.add('preview-calibration-controls');
 root.innerHTML=`<h3>Калибровка предпросмотра Word</h3><p data-calibration-diagnostics></p><div class="calibration-adjust"><button type="button" class="btn" data-calibration-minus aria-label="Уменьшить вместимость на одну строку">−1</button><label>Установлено: <input type="number" step="1" data-calibration-target aria-label="Целевая вместимость в стандартных строках"> строк</label><button type="button" class="btn" data-calibration-plus aria-label="Увеличить вместимость на одну строку">+1</button><button type="button" class="btn" data-calibration-reset>Сбросить</button></div><label class="checkbox"><input type="checkbox" data-calibration-enabled> Применять калибровку</label><p>Калибровка регулирует расположение разрывов страниц в предпросмотре. На экспорт Word и PDF не влияет.</p><p data-calibration-error role="status"></p>${options.openPreview?'<button class="btn" type="button" data-calibration-open>Открыть предпросмотр</button>':''}`;
 const input=root.querySelector<HTMLInputElement>('[data-calibration-target]')!,enabled=root.querySelector<HTMLInputElement>('[data-calibration-enabled]')!,error=root.querySelector<HTMLElement>('[data-calibration-error]')!;
 const minus=root.querySelector<HTMLButtonElement>('[data-calibration-minus]')!,plus=root.querySelector<HTMLButtonElement>('[data-calibration-plus]')!,reset=root.querySelector<HTMLButtonElement>('[data-calibration-reset]')!;
 const paint=()=>{
  const result=calibratedCapacity(options.capacity,value),stored=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,value.offset));
  input.min=String(options.capacity.baseLines+options.capacity.minimumOffset);input.max=String(options.capacity.baseLines+options.capacity.maximumOffset);input.value=String(options.capacity.baseLines+stored);input.disabled=!options.available;
  enabled.checked=value.enabled;enabled.disabled=!options.available;minus.disabled=!options.available||stored<=options.capacity.minimumOffset;plus.disabled=!options.available||stored>=options.capacity.maximumOffset;reset.disabled=!options.available;
  root.dataset.baseHeight=String(result.baseHeight);root.dataset.effectiveHeight=String(result.height);root.dataset.standardLine=String(result.lineHeight);root.dataset.baseLines=String(result.baseLines);root.dataset.offset=String(value.offset);root.dataset.effectiveOffset=String(result.offset);
  root.querySelector('[data-calibration-diagnostics]')!.textContent=`Расчётное значение: ${result.baseLines} строк. Поправка врача: ${value.offset>0?'+':''}${value.offset}. Эффективная вместимость: ${result.target} строк. Стандартная строка: ${options.font}. Оптимизация печати: ${options.optimize?'включена':'выключена'}.`;
  error.textContent=!options.available?'Сначала сохраните врача, чтобы настроить его калибровку.':result.limited?'Поправка ограничена безопасной областью страницы.':plus.disabled?'Достигнут безопасный верхний предел: поля и футер сохранены.':'';
 };
 const save=(next:PreviewCalibration)=>{try{options.save(next);value=next;paint();options.change();}catch(e){paint();error.textContent=(e as Error).message;}};
 const adjust=(offset:number)=>{offset=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,offset));save({...value,offset,lastTarget:options.capacity.baseLines+offset});};
 minus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines-1);plus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines+1);
 input.onchange=()=>{const target=Number(input.value);if(!Number.isInteger(target)||target<Number(input.min)||target>Number(input.max)){paint();error.textContent=`Введите целое число от ${input.min} до ${input.max}.`;return;}adjust(target-options.capacity.baseLines);};
 enabled.onchange=()=>save({...value,enabled:enabled.checked,lastTarget:value.lastTarget??Number(input.value)});reset.onclick=()=>save({...value,offset:0,lastTarget:options.capacity.baseLines});
 root.querySelector<HTMLButtonElement>('[data-calibration-open]')?.addEventListener('click',()=>options.openPreview?.());paint();
 return {get value(){return {...value};}};
}
