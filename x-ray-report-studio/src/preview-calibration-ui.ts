import {calibratedCapacity,calibratedWidth,validWidthOffset,WIDTH_STEP_MM,type Capacity,type WidthCapacity,type PreviewCalibration} from './preview-calibration.ts';
export type CalibrationUIOptions={capacity:Capacity;width:WidthCapacity;font:string;optimize:boolean;value:PreviewCalibration;available:boolean;save:(value:PreviewCalibration)=>void;change:()=>void;openPreview?:()=>void};
/** Shared controls in physician settings and the single existing preview. */
export function mountCalibrationControls(root:HTMLElement,options:CalibrationUIOptions){
 let value={...options.value};
 root.classList.add('preview-calibration-controls');
 root.innerHTML=`<h3>Калибровка предпросмотра Word</h3><h4>Количество строк на странице</h4><p data-calibration-diagnostics></p><div class="calibration-adjust"><button type="button" class="btn" data-calibration-minus aria-label="Уменьшить вместимость на одну строку">−1</button><label>Установлено: <input type="number" step="1" data-calibration-target aria-label="Целевая вместимость в стандартных строках"> строк</label><button type="button" class="btn" data-calibration-plus aria-label="Увеличить вместимость на одну строку">+1</button><button type="button" class="btn" data-calibration-reset>Сбросить</button></div><label class="checkbox"><input type="checkbox" data-calibration-enabled> Применять калибровку строк</label><h4>Калибровка ширины строки, мм</h4><div class="calibration-adjust"><button type="button" class="btn" data-width-minus aria-label="Уменьшить ширину на 0,5 мм">−0,5</button><label>Поправка, мм <input type="number" step="0.5" data-width-offset></label><button type="button" class="btn" data-width-plus aria-label="Увеличить ширину на 0,5 мм">+0,5</button><button type="button" class="btn" data-width-reset>Сбросить ширину</button></div><p>Поправка влияет только на предпросмотр. Поля Word и PDF сохраняются.</p><p data-line-compaction hidden>Интервалы предпросмотра скорректированы в пределах печатной области.</p><p data-calibration-error role="status"></p>${options.openPreview?'<button class="btn" type="button" data-calibration-open>Открыть предпросмотр</button>':''}`;
 const input=root.querySelector<HTMLInputElement>('[data-calibration-target]')!,enabled=root.querySelector<HTMLInputElement>('[data-calibration-enabled]')!,error=root.querySelector<HTMLElement>('[data-calibration-error]')!;
 const minus=root.querySelector<HTMLButtonElement>('[data-calibration-minus]')!,plus=root.querySelector<HTMLButtonElement>('[data-calibration-plus]')!,reset=root.querySelector<HTMLButtonElement>('[data-calibration-reset]')!;
 const widthMinus=root.querySelector<HTMLButtonElement>('[data-width-minus]')!,widthPlus=root.querySelector<HTMLButtonElement>('[data-width-plus]')!,widthReset=root.querySelector<HTMLButtonElement>('[data-width-reset]')!;
 const widthInput=root.querySelector<HTMLInputElement>('[data-width-offset]')!;
 const paint=()=>{
  const result=calibratedCapacity(options.capacity,value),stored=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,value.offset));
  input.min=String(options.capacity.baseLines+options.capacity.minimumOffset);input.max=String(options.capacity.baseLines+options.capacity.maximumOffset);input.value=String(options.capacity.baseLines+stored);input.disabled=!options.available;
  enabled.checked=value.enabled;enabled.disabled=!options.available;minus.disabled=!options.available||stored<=options.capacity.minimumOffset;plus.disabled=!options.available||stored>=options.capacity.maximumOffset;reset.disabled=!options.available;
  root.dataset.lineScale=String(result.lineScale);root.dataset.baseHeight=String(result.baseHeight);root.dataset.effectiveHeight=String(result.height);root.dataset.standardLine=String(result.lineHeight);root.dataset.baseLines=String(result.baseLines);root.dataset.offset=String(value.offset);root.dataset.effectiveOffset=String(result.offset);
  root.querySelector('[data-calibration-diagnostics]')!.textContent=`Расчётное значение: ${result.baseLines} строк. Поправка врача: ${value.offset>0?'+':''}${value.offset}. Эффективная вместимость: ${result.target} строк. Стандартная строка: ${options.font}. Оптимизация печати: ${options.optimize?'включена':'выключена'}.`;
  const width=calibratedWidth(options.width,value);
  root.dataset.baseWidth=String(options.width.baseWidth);root.dataset.effectiveWidth=String(width.width);
  root.dataset.widthOffsetMm=String(value.widthOffsetMm??0);
  widthInput.min=String(options.width.minimumOffset);widthInput.max=String(options.width.maximumOffset);
  widthInput.value=width.offset.toFixed(1);widthInput.disabled=!options.available;
  widthMinus.disabled=!options.available||width.offset<=options.width.minimumOffset;
  widthPlus.disabled=!options.available||width.offset>=options.width.maximumOffset;
  widthReset.disabled=!options.available||(value.widthOffsetMm??0)===0;
  root.querySelector<HTMLElement>('[data-line-compaction]')!.hidden=result.lineScale>=1;
  error.textContent=!options.available?'Сначала сохраните врача, чтобы настроить его калибровку.':(result.limited||width.limited)?'Поправка ограничена безопасной областью страницы.':plus.disabled?'Достигнут безопасный верхний предел: поля и футер сохранены.':'';
 };
 const save=(next:PreviewCalibration)=>{try{options.save(next);value=next;paint();options.change();}catch(e){paint();error.textContent=(e as Error).message;}};
 const adjust=(offset:number)=>{offset=Math.max(options.capacity.minimumOffset,Math.min(options.capacity.maximumOffset,offset));save({...value,offset,lastTarget:options.capacity.baseLines+offset});};
 minus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines-1);plus.onclick=()=>adjust(Number(input.value)-options.capacity.baseLines+1);
 input.onchange=()=>{const target=Number(input.value);if(!Number.isInteger(target)||target<Number(input.min)||target>Number(input.max)){paint();error.textContent=`Введите целое число от ${input.min} до ${input.max}.`;return;}adjust(target-options.capacity.baseLines);};
 enabled.onchange=()=>save({...value,enabled:enabled.checked,lastTarget:value.lastTarget??Number(input.value)});reset.onclick=()=>save({...value,offset:0,lastTarget:options.capacity.baseLines});
 const adjustWidth=(widthOffsetMm:number)=>save({...value,widthOffsetMm});
 widthMinus.onclick=()=>adjustWidth(Number(widthInput.value)-WIDTH_STEP_MM);
 widthPlus.onclick=()=>adjustWidth(Number(widthInput.value)+WIDTH_STEP_MM);
 widthReset.onclick=()=>adjustWidth(0);
 widthInput.onchange=()=>{
  const mm=widthInput.valueAsNumber;
  if(!validWidthOffset(mm)||mm<Number(widthInput.min)||mm>Number(widthInput.max)){
   paint();error.textContent=`Введите поправку от ${widthInput.min} до ${widthInput.max} мм с шагом 0,5 мм.`;return;
  }
  adjustWidth(mm);
 };
 root.querySelector<HTMLButtonElement>('[data-calibration-open]')?.addEventListener('click',()=>options.openPreview?.());paint();
 return {get value(){return {...value};}};
}
