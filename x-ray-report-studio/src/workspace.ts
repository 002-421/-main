import {normalizeTheme,normalizeZoom,type Theme} from './ui-preferences.ts';
import {attachRecovery,recoverReset} from './reset-recovery.ts';
import {rememberTemplateBase} from './template-local-conflicts.ts';
import {createEditableField} from './editable-field-command.ts';
import {selectionFontSize,setReportFontSize} from './document-typography.ts';
import {templateUpdatesDialog,templateUpdatesSettings,templatePublicationSettings} from './template-updates.ts';
import {templateAvailable,networkTemplate,networkTemplateSource,makeBuiltinTemplateDocument,revisionsForTemplate} from './catalog.ts';
import { DoctorFormats, type DoctorFormat, TEMPLATE_FONT_SIZES, newProtocolFont } from './doctor-format.ts';
import { choosePrintLayout, PrintLayoutError, type PrintPlan } from './print-layout.ts';
import { preparePrintDocument, printConclusion, firstPrintedConclusionBlock } from './print-document.ts';
import { exportTemplateDocx, exportTemplateDocxGroup, inspectTemplateDocx, applyTemplateDocx, rollback as rollbackTemplateDocx, recover as recoverTemplateDocx, type TemplateDocxItem } from './template-docx';
import { INITIAL_TEMPLATE_VERSION, nextTemplateVersion, readTemplateVersions, templateVersion as readTemplateVersion, TEMPLATE_VERSION_STORAGE_KEY } from './template-versioning';
import { recoverParagraphBlocks } from './document-recovery';
import { medicalTextForCopy, personalDataWarnings } from './safe-medical-copy';
import './style.css';
import { titleWithStudySide } from './report-side';
import { justifyDescription } from './description-alignment';
import { makeSizeBlock } from './size-block';
import { hasYellowFields } from './export-validation';
import { paginateBrowserPreview, measurePrintBox } from './preview-pages';
import { openStickyNote } from './sticky-note';
import { addReportSeparators } from './report-separators';
const prepareInlineDocument = (doc: RichNode, trackOriginal = true) => prepareInlineDocumentBase(doc.content?.some(node=>node.type==='reportSection')?doc:addReportSeparators(doc), trackOriginal);
import packageInfo from '../package.json' with { type: 'json' };
import { canRedoReport, canUndoReport, configureReportHistoryDepth, getReportHistory, REPORT_HISTORY_DEPTHS, restoreReportHistory, runReportHistoryCommand, sanitizeReportHistory, setDefaultReportHistoryDepth, type ReportHistoryDepth, type StoredReportHistory } from './report-history';
import { EditorState, Selection } from '@tiptap/pm/state';
import { ReviewEngine, TrackChangesEngine, LocalAIProvider, reviewCategories, categoryGroup, type ReviewCategory } from './ai-review';
import { applyReviewSuggestion, isSafeReviewReplacement, resolveReviewRange, ReviewEditError } from './ai-review-editor';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { setAiReviewDecorations } from './ai-review-decorations';
import type { ReviewDecorationRange } from './ai-review-decorations';
import { structurePreparedBuiltin } from './ai-review-structure';
import DOMPurify from 'dompurify';
import { makeEditor } from './editor';
import { setParagraphLineHeight } from './editor-format';
import { bindFormatToolbar, fillToolbar, paragraphToolbar } from './format-toolbar';
import { prepareInlineDocument as prepareInlineDocumentBase, initializeTemplateTracking, promoteInlineTemplate, resetInlineTemplate, collectInlineFields, countUnchangedParts, setReviewHighlights } from './inline-fields';
import { getLiveProofIssueAtPosition, refreshProofreading, setLiveProofreading } from './live-proofreading';
import { areas, reportTemplates, reportBlocks, makeTemplateDocument, DOCTOR_FIELD_ID, PATIENT_FIELD_ID, DEFAULT_TEMPLATE_ID } from './catalog';
import { builtinModules, moduleNode, compiler, validateDraft, validateTemplate, draftVersion, type RichNode } from './model';
import { exportDocx, importOwnDocx, recoverDocx } from './docx';
import { russianProofreadingLicense } from './proofreading';
import { calculate, formatCalculatorResult, parseCalculatorDisplay, type CalculatorOperation } from './calculator';
import { buildReportFilename, buildReportTabName, extractFilenameFields, shortPatientName } from './report-filename';
import { isPatientField } from './patient-field.ts';
import { initializeReportFooter } from './report-footer';
import { attachDoctorStamp, findDoctorStampKey } from './doctor-stamp';
import { compactTemplateTables, separateRecommendations, highlightDeletionNotes } from './table-layout';
import fontLicense from './assets/fonts/LICENSE.txt?raw';
import regularFont from './assets/fonts/DejaVuSans.ttf?url';
import boldFont from './assets/fonts/DejaVuSans-Bold.ttf?url';
import italicFont from './assets/fonts/DejaVuSans-Oblique.ttf?url';
import boldItalicFont from './assets/fonts/DejaVuSans-BoldOblique.ttf?url';

declare global { interface Window { desktop?: {
  reportReady:(details:{appRoot:boolean;templateCount:number;viewport:{width:number;height:number};shell:{width:number;height:number;display:string;visibility:string;opacity:string};bodyColor:string;textLength:number})=>void;
  getApplicationVersion:()=>Promise<string>;
  onWordSaved?:(callback:(url:string)=>void)=>void;
  exportPDF:(name:string)=>Promise<{canceled:boolean;path?:string}>;
  checkForUpdates:()=>Promise<{version:string;currentVersion:string;available:boolean;notes?:string}>;
  installUpdate:()=>Promise<{available:boolean;installing?:boolean;version?:string}>;
  onUpdateProgress:(callback:(progress:{stage:string;loaded:number;total:number;percent:number|null;message?:string;phase?:string;code?:string;logFile?:string})=>void)=>void;
  clearUpdateProgress:()=>void;
  copyReport:(html:string,text:string)=>Promise<void>;
  copyPlainText:(text:string)=>Promise<void>;
  reportDiagnostic:(value:unknown)=>void;
  openDiagnostics:()=>Promise<unknown>;
  dictionaryLoad:()=>Promise<{words:string[];shared:boolean}>;
  dictionaryMergeSave:(words:string[])=>Promise<{words:string[];shared:boolean}>;
} } }
const $ = <T extends HTMLElement = HTMLElement>(s:string) => document.querySelector<T>(s)!;
const esc = (v:unknown) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const KEYS = { draft:'mri-report-studio.draft.v1',workspace:'mri-report-studio.workspace.v1',history:'mri-report-studio.undo-history.v1',templates:'mri-alliance.templates.v4',templateVersions:TEMPLATE_VERSION_STORAGE_KEY,blocks:'mri-alliance.blocks.v3',settings:'mri-alliance.settings.v3',dictionary:'mri-report-studio.dictionary.v1' };
type Block = {id:string;title:string;areaId:string;tags:string;doc:RichNode;custom:boolean};
type OpenReport = {id:string;templateId:string;doc:RichNode;dirty:boolean};
type StoredReportView = {selection:Record<string,unknown>;scrollTop:number};
type StoredReportHistoryRecord = {fingerprint:string;history:StoredReportHistory;view?:StoredReportView};
type Settings = {doctorStampOwners?:Record<string,string>;doctor:string;doctors:string[];logo:string;doctorStamps:Record<string,string>;doctorStampSizes:Record<string,{width:number;height:number}>;doctorStampHeights:Record<string,number>;doctorStampPositions:Record<string,{x:number;y:number}>;theme:Theme;zoom:number;historyDepth:ReportHistoryDepth};
const read = <T>(key:string,fallback:T):T => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
function documentFingerprint(doc:RichNode):string { const value=JSON.stringify(doc);let hash=0x811c9dc5;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193);}return `${(hash>>>0).toString(16)}:${value.length}`; }
await recoverReset();
const storedSettings=read<Partial<Settings>&{liveProof?:boolean}>(KEYS.settings,{});
const {liveProof:_legacyLiveProof,...currentSettings}=storedSettings;
let settings:Settings = {...{doctor:'',doctors:[],logo:'',doctorStamps:{},doctorStampSizes:{},doctorStampHeights:{},doctorStampPositions:{},theme:'dark',zoom:100,historyDepth:500 as ReportHistoryDepth},...currentSettings};
delete (settings as Settings & {autoUpdate?:unknown;lastAutoUpdateCheckAt?:unknown}).autoUpdate;
delete (settings as Settings & {autoUpdate?:unknown;lastAutoUpdateCheckAt?:unknown}).lastAutoUpdateCheckAt;
if(!REPORT_HISTORY_DEPTHS.includes(settings.historyDepth))settings.historyDepth=500;
setDefaultReportHistoryDepth(settings.historyDepth);
if (typeof settings.doctor !== 'string') settings.doctor = '';
if (!Array.isArray(settings.doctors)) settings.doctors=[];
if (typeof settings.logo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(settings.logo)) settings.logo = '';
if (!settings.doctorStamps || typeof settings.doctorStamps !== 'object' || Array.isArray(settings.doctorStamps)) settings.doctorStamps={};
if (settings.doctorStampOwners && (typeof settings.doctorStampOwners !== 'object' || Array.isArray(settings.doctorStampOwners))) delete settings.doctorStampOwners;
settings.doctorStamps=Object.fromEntries(Object.entries(settings.doctorStamps).filter(([name,image])=>typeof name==='string'&&name.length<=200&&typeof image==='string'&&/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)).slice(0,30));
if (!settings.doctorStampSizes || typeof settings.doctorStampSizes !== 'object' || Array.isArray(settings.doctorStampSizes)) settings.doctorStampSizes={};
settings.doctorStampSizes=Object.fromEntries(Object.entries(settings.doctorStampSizes).filter(([name,size])=>settings.doctorStamps[name]&&size&&Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0).slice(0,30));
if (!settings.doctorStampHeights || typeof settings.doctorStampHeights !== 'object' || Array.isArray(settings.doctorStampHeights)) settings.doctorStampHeights={};
settings.doctorStampHeights=Object.fromEntries(Object.entries(settings.doctorStampHeights).filter(([name,height])=>settings.doctorStamps[name]&&Number.isFinite(height)&&Number(height)>=40&&Number(height)<=500).slice(0,30));
if (!settings.doctorStampPositions || typeof settings.doctorStampPositions !== 'object' || Array.isArray(settings.doctorStampPositions)) settings.doctorStampPositions={};
settings.doctorStampPositions=Object.fromEntries(Object.entries(settings.doctorStampPositions).filter(([name,pos])=>settings.doctorStamps[name]&&pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y)&&Math.abs(pos.x)<=300&&Math.abs(pos.y)<=200).slice(0,30));
settings.theme=normalizeTheme(settings.theme);
settings.zoom=normalizeZoom(settings.zoom);
let doctorFormats:DoctorFormats|undefined;
let doctorFormatError='';
try{doctorFormats=new DoctorFormats(localStorage,settings.doctors.filter(name=>typeof name==='string'),settings.doctor);}catch(error){doctorFormatError=(error as Error).message;}
// Keep the original image records readable by older XRS releases. The UUID
// owns the link to the existing name key, so switching profiles never copies an image.
function doctorStampKey(name:string, doctorId=doctorFormats?.get(name)?.id) {
 const linked=doctorId&&settings.doctorStampOwners?.[doctorId];
 if(typeof linked==='string'&&doctorFormats?.get(linked)?.id===doctorId)return linked;
 if(Object.hasOwn(settings.doctorStamps,name))return name;
 if(!doctorId)return name;
 const matches=Object.keys(settings.doctorStamps).filter(key=>doctorFormats?.get(key)?.id===doctorId);
 return matches.length===1?matches[0]:name;
}
const currentDoctorFormat=()=>doctorFormats?.get(settings.doctor)??{id:'unsaved',name:settings.doctor,fontSize:11,optimize:true};
const storedWords=read<unknown>(KEYS.dictionary,[]);
const removedDictionaryWords=new Set(read<string[]>('xrs.dictionary.removed.v1',[]));
const filterPersonalWords=(words:string[])=>words.filter(word=>!removedDictionaryWords.has(word.toLocaleLowerCase('ru')));
let personalWords:string[] = filterPersonalWords([...new Set((Array.isArray(storedWords)?storedWords.filter(w=>typeof w==='string'):[]))]).slice(0,20000);
let sharedDictionaryAvailable=false;
let overrides:Record<string,RichNode> = {};
try{recoverTemplateDocx(localStorage);}catch{window.alert('Не удалось восстановить импорт шаблонов. Резервная копия сохранена.');}
for (const [id,doc] of Object.entries(read<Record<string,RichNode>>(KEYS.templates,{}))) {
  try { if(reportTemplates.some(t=>t.id===id)) overrides[id]=validateTemplate(doc); } catch { /* Keep valid templates available. */ }
}
let customBlocks:Block[] = [];
try { customBlocks=read<Block[]>(KEYS.blocks,[]).slice(0,200).filter(b=>b && typeof b.id==='string' && typeof b.title==='string').map(b=>({...b,doc:validateTemplate(b.doc),custom:true})); } catch { /* A broken library cannot block the report. */ }
const builtInBlocks:Block[] = reportBlocks.map(m=>({id:m.id,title:m.title,areaId:'',tags:m.description,doc:m.doc,custom:false}));
let activeTemplateId = DEFAULT_TEMPLATE_ID;
let selectedAreaId = reportTemplates.find(t=>t.id===DEFAULT_TEMPLATE_ID)?.areaId ?? reportTemplates[0].areaId;
let sidebarTab:'templates'|'blocks' = 'templates';
let templateMode=false;
let backup:{doc:RichNode;changed:boolean;history?:StoredReportHistory}|null=null;
let templateEditBaseline:RichNode|null=null;
let changedSinceOpen=false;
let suppress=false;
let review=false;
let timer:ReturnType<typeof setTimeout>;
let selectionForBlock:{from:number;to:number}|null=null;
let recoveryError=false;

function fieldMark(n:RichNode) { return n.marks?.find(m=>m.type==='templateField'); }
function defaultDoctor(doc:RichNode):RichNode {
  if(!settings.doctor.trim()) return doc;
  let applied=false;
  const walk=(n:RichNode)=>{if(n.content)n.content=n.content.filter(child=>{const m=fieldMark(child);if(m?.attrs?.id===DOCTOR_FIELD_ID&&child.type==='text'){if(applied)return false;applied=true;child.text=settings.doctor.trim();m.attrs={...m.attrs,filled:true};}walk(child);return true;});};walk(doc);return doc;
}
function newDocumentBody(id:string) { if(networkTemplate(id)&&!overrides[id])return defaultDoctor(prepareInlineDocument(initializeReportFooter(resetInlineTemplate(newProtocolFont(makeTemplateDocument(id),currentDoctorFormat().fontSize)))));const builtin=!overrides[id],source=builtin?newProtocolFont(makeTemplateDocument(id),currentDoctorFormat().fontSize):structuredClone(overrides[id]);const doc=justifyDescription(defaultDoctor(prepareInlineDocument(initializeReportFooter(resetInlineTemplate(source)))));return builtin?structurePreparedBuiltin(id,doc):doc; }
function newDocument(id:string){const doc=newDocumentBody(id),version=overrides[id]?currentTemplateVersion(id):reportTemplates.find(t=>t.id===id)!.templateVersion;doc.attrs={...doc.attrs,templateSource:{id,version,status:overrides[id]?'Personal':(revisionsForTemplate(id).find(row=>row.templateVersion===version)?.status??'Active')}};return doc;}
function currentTemplateVersion(id:string){const template=reportTemplates.find(item=>item.id===id);return overrides[id]?readTemplateVersion(localStorage,id,template?.templateVersion??INITIAL_TEMPLATE_VERSION):(template?.templateVersion??INITIAL_TEMPLATE_VERSION);}
function canonicalTemplateRevision(doc:RichNode){return JSON.stringify(doc,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);}
let initial = newDocument(activeTemplateId);
try {
  const raw=read<any>(KEYS.draft,null);
  if(raw) { const restored=validateDraft(raw);initial=prepareInlineDocument(restored.doc);if(reportTemplates.some(t=>t.id===raw.templateId)){activeTemplateId=raw.templateId;selectedAreaId=reportTemplates.find(t=>t.id===activeTemplateId)!.areaId;} }
} catch { recoveryError=true; }
let openReports:OpenReport[]=[];
let activeReportId='';
let workspaceRecoveryBlocked=false;
let workspaceRaw:string|null=null;
try { workspaceRaw=localStorage.getItem(KEYS.workspace); } catch { recoveryError=true;workspaceRecoveryBlocked=true; }
if(workspaceRaw!==null){
  try {
    const stored=JSON.parse(workspaceRaw);
    if(!stored || !Array.isArray(stored.reports)) throw new Error('Invalid workspace structure');
    let invalidReports=0;
    for(const item of stored.reports){
      try {
        if(!item||typeof item.id!=='string'||typeof item.templateId!=='string'||!reportTemplates.some(t=>t.id===item.templateId))throw new Error('Invalid report metadata');
        const doc=validateDraft({format:'mri-report-studio',version:draftVersion,templateId:item.templateId,profile:'custom',doc:item.doc,customModules:[]}).doc;
        openReports.push({id:item.id,templateId:item.templateId,doc,dirty:Boolean(item.dirty)});
      } catch { invalidReports++; }
    }
    if(invalidReports)throw Object.assign(new Error('Some workspace reports are invalid'),{validReports:openReports});
  } catch(error){
    recoveryError=true;
    // Never silently replace a damaged workspace with a new empty one.
    // Keep the original bytes before allowing any subsequent autosave.
    try {
      const recoveryPrefix=KEYS.workspace+'.recovery.';
      const alreadyBackedUp=Object.keys(localStorage).some(key=>key.startsWith(recoveryPrefix)&&localStorage.getItem(key)===workspaceRaw);
      if(!alreadyBackedUp){
        const backupKey=recoveryPrefix+Date.now()+'.'+crypto.randomUUID();
        localStorage.setItem(backupKey,workspaceRaw);
        if(localStorage.getItem(backupKey)!==workspaceRaw)throw new Error('Workspace recovery backup verification failed');
      }
    } catch { workspaceRecoveryBlocked=true; }
    if(!workspaceRecoveryBlocked && Array.isArray((error as {validReports?:OpenReport[]}).validReports))
      openReports=(error as {validReports:OpenReport[]}).validReports;
  }
}
if(openReports.length){
  const stored=read<{activeId?:string}>(KEYS.workspace,{});
  activeReportId=openReports.some(r=>r.id===stored.activeId)?stored.activeId!:openReports[0].id;
  const active=openReports.find(r=>r.id===activeReportId)!;
  initial=active.doc;activeTemplateId=active.templateId;
  selectedAreaId=reportTemplates.find(t=>t.id===activeTemplateId)!.areaId;changedSinceOpen=active.dirty;
}
if(!openReports.length){activeReportId=crypto.randomUUID();openReports=[{id:activeReportId,templateId:activeTemplateId,doc:initial,dirty:false}];}
const historyStorage=read<unknown>(KEYS.history,{});
const historyByReport:Record<string,StoredReportHistoryRecord>={};
if(historyStorage&&typeof historyStorage==='object'&&!Array.isArray(historyStorage)){
 for(const report of openReports){
  const candidate=(historyStorage as Record<string,unknown>)[report.id];
  if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)){
   const record=candidate as Record<string,unknown>;
   if(record.fingerprint===documentFingerprint(report.doc))historyByReport[report.id]={fingerprint:record.fingerprint as string,history:sanitizeReportHistory(record.history,settings.historyDepth),view:readReportView(record.view)};
  }
 }
}

$('#app').innerHTML=`<div class="shell">
 <aside class="sidebar" aria-label="Зоны, шаблоны и дополнительные описания">
  <button class="brand" id="brand-settings" title="Настроить врача и подпись"><span id="brand-image"></span></button>
  <div class="side-tabs"><button data-tab="templates" class="active">Зоны и шаблоны</button><button data-tab="blocks">Доп. описания</button></div>
  <div id="template-navigation"><label class="side-label" for="modality-select">Тип исследования</label><select id="modality-select"><option value="mri">МРТ</option><option value="ct">КТ</option></select><label class="side-label area-label" for="area-select">Зона исследования</label><select id="area-select"></select><div class="side-heading">Выберите шаблон</div><div id="template-list" class="template-list"></div><button class="side-action" id="edit-template">✎ Редактировать шаблон</button><button class="side-action" id="export-template-docx">⇩ Экспортировать шаблон в Word</button><button class="side-action" id="import-template-docx">⇧ Импортировать шаблон из Word</button><button class="side-action" id="restore-template-backup">↶ Резервные копии шаблонов</button></div>
  <div id="block-navigation" class="hidden"><label class="side-label" for="block-search">Поиск дополнительных описаний</label><input type="search" id="block-search" placeholder="Название, находка или ключевое слово…"><div class="block-filters"><button data-block-filter="all" class="active">Все</button><button data-block-filter="custom">Мои</button></div><div class="block-create"><button id="new-block" class="btn small">＋ Создать</button><button id="save-selection" class="btn small">Сохранить выделенное</button></div><div id="block-list" class="block-list"></div></div>
  <div class="side-bottom"><button id="template-packages">Пакеты шаблонов</button><button id="settings">⚙ Врач и настройки</button><small>Локальная работа · версия <span id="application-version">${esc(packageInfo.version)}</span></small></div>
 </aside>
 <main class="main">
  <header class="topbar"><div class="document-heading"><strong id="document-name">Новое описание</strong><small id="save-state" hidden>Сохранено на компьютере</small></div><div class="top-actions"><button id="toggle-sidebar" class="btn icon-button" title="Показать меню">☰</button><button id="new-report" class="btn">＋ Заключение</button><button id="open-report" class="btn">Открыть</button><button id="copy-report" class="btn">Копировать</button><button id="copy-for-ai" class="btn" type="button">Копировать для ИИ</button><div class="save-menu"><button id="save-menu-toggle" class="btn primary" type="button" aria-expanded="false" aria-controls="save-menu-items">Сохранить</button><div id="save-menu-items" class="save-menu-items" hidden><button id="save-docx" class="btn" type="button">Word (.docx)</button><button id="export-pdf" class="btn" type="button">PDF (.pdf)</button></div></div></div></header>
  <nav id="report-tabs" class="report-tabs" aria-label="Открытые заключения"></nav>
  <div class="ribbon" role="toolbar" aria-label="Форматирование описания"><div class="tool-group"><button data-command="undo" title="Отменить (Ctrl+Z)">↶</button><button data-command="redo" title="Повторить (Ctrl+Y)">↷</button></div><div class="tool-group"><select id="font-family" aria-label="Шрифт"><option>DejaVu Sans</option><option selected>Arial</option><option>Times New Roman</option><option>Calibri</option></select><select id="font-size" aria-label="Размер шрифта">${[8,9,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15,16,18,21,24].map(s=>`<option value="${s}" ${s===12?'selected':''}>${s}</option>`).join('')}</select></div><div class="tool-group"><button data-command="bold" title="Полужирный"><b>Ж</b></button><button data-command="italic" title="Курсив"><i>К</i></button><button data-command="underline" title="Подчёркнутый"><u>Ч</u></button><button data-command="strike" title="Зачёркнутый"><s>А</s></button><input type="color" id="text-color" title="Цвет текста" value="#172c40">${fillToolbar}</div><div class="tool-group">${paragraphToolbar}</div><div class="tool-group"><label class="line-height-control" for="line-height">Интервал <select id="line-height" aria-label="Межстрочный интервал"><option value="1">1</option><option value="1.05">1,05</option><option value="1.15">1,15</option><option value="1.2">1,2</option><option value="1.5">1,5</option><option value="2">2</option></select></label><button id="insert-size" title="Размер (фронтальный/сагиттальный/вертикальный)">＋ Размер</button></div></div>
  <div id="template-banner" class="template-banner hidden"><div><strong>Редактирование шаблона</strong><small>Правки будут применяться к новым описаниям. Текущий документ сохранён.</small></div><div><button id="create-editable-field" class="btn" title="Выделите весь абзац, текстовый фрагмент или отдельный размер 0,0">Редактируемое поле</button><button id="reset-template" class="btn">Исходный шаблон</button><button id="cancel-template" class="btn">Отмена</button><button id="save-template" class="btn primary">Сохранить шаблон</button></div></div>
  <div class="document-tools"><div><button id="review-unchanged" class="chip" aria-pressed="false" title="Показать поля и фрагменты, оставшиеся как в шаблоне">Подсветить неизменённое</button><button id="sticky-note-open" class="chip" title="Открыть заметку">Заметка</button><button id="calculator" class="chip" title="Открыть калькулятор" aria-haspopup="dialog">Калькулятор</button></div><div><label class="zoom-control" title="Масштаб редактора"><span>Масштаб</span><input id="zoom" type="range" min="75" max="200" step="5" value="100" aria-label="Масштаб редактора"><output id="zoom-value">100%</output></label></div></div>
  <div class="canvas" id="canvas"><div class="page-meta"><span id="template-name"></span><span>A4 · оформление исходного шаблона</span></div><article class="paper"><div id="editor"></div></article></div>
  <footer class="statusbar"><span id="status-left">Данные сохраняются на этом компьютере</span><span id="word-count"></span></footer>
 </main></div><input type="file" id="report-file" accept=".docx,.json,.mri.json" hidden><input type="file" id="template-file" accept=".docx" hidden><input type="file" id="doctor-stamp-file" accept="image/png,image/jpeg,.jpg,.jpeg" hidden>`;

function applyTheme() { document.documentElement.dataset.theme=normalizeTheme(settings.theme); }
applyTheme();
function renderBrand() { $('#brand-image').innerHTML='<span class="brand-text"><strong>X-ray <em>Report</em> Studio</strong></span>'; }
renderBrand();
const editor=makeEditor($('#editor'),initial,{getPersonalWords:()=>personalWords});
restoreReportHistory(editor.view,historyByReport[activeReportId]?.history);
restoreReportView(historyByReport[activeReportId]?.view);
function runHistoryCommand(direction:'undo'|'redo'){
 const canvas=$('#canvas'),scrollTop=canvas.scrollTop,ran=runReportHistoryCommand(editor.view,direction);
 if(!ran)return;
 // ProseMirror marks history transactions scrollIntoView. Keep the current
 // viewport when the restored caret is already visible; otherwise move only
 // enough to bring that caret into view.
 canvas.scrollTop=scrollTop;
 try{
  // Measure the actual DOM focus point first. coordsAtPos can differ by a few
  // pixels from the browser's rendered caret near wrapped lines, which can
  // cause a needless scroll even though the caret is already visible.
  const selection=window.getSelection();let caret:{top:number;bottom:number}|undefined;
  if(selection?.focusNode&&editor.view.dom.contains(selection.focusNode)){
   const range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);const rect=range.getBoundingClientRect();if(rect.height||rect.width)caret={top:rect.top,bottom:rect.bottom};
  }
  const position=caret??editor.view.coordsAtPos(editor.state.selection.head);
  const viewport=canvas.getBoundingClientRect(),margin=12,visibilityTolerance=2;
  if(position.top<viewport.top-visibilityTolerance)canvas.scrollTop+=position.top-(viewport.top+margin);
  else if(position.bottom>viewport.bottom+visibilityTolerance)canvas.scrollTop+=position.bottom-(viewport.bottom-margin);
 }catch{/* Some non-text selections do not expose a measurable caret. */}
}
document.addEventListener('keydown',event=>{const key=event as KeyboardEvent,target=key.target instanceof Element?key.target:null,editingOutsideReport=Boolean(target?.closest('input,textarea,select,[contenteditable="true"]')&&!target.closest('.report-content')),modified=key.ctrlKey||key.metaKey,undo=modified&&(key.code==='KeyZ'||key.key.toLowerCase()==='z')&&!key.shiftKey,redo=(key.ctrlKey&&(key.code==='KeyY'||key.key.toLowerCase()==='y'||key.shiftKey&&(key.code==='KeyZ'||key.key.toLowerCase()==='z')))||(key.metaKey&&key.shiftKey&&(key.code==='KeyZ'||key.key.toLowerCase()==='z'));if(key.isComposing||editingOutsideReport||(!undo&&!redo))return;key.preventDefault();key.stopPropagation();if((undo&&canUndoReport(editor.state))||(redo&&canRedoReport(editor.state)))runHistoryCommand(undo?'undo':'redo');},true);
function dictionarySaveError(error:unknown):string {
 const detail=error instanceof Error?error.message:String(error);
 const reason=/EACCES|EPERM/.test(detail)?'Нет разрешения на запись словаря.':/ENOSPC/.test(detail)?'На диске недостаточно места.':/EEXIST|доступ к общему/.test(detail)?'Словарь занят. Повторите сохранение.':/SyntaxError|JSON/.test(detail)?'Файл словаря повреждён. Сохранение отменено.':/dictionaryMergeSave|not a function/.test(detail)?'Недоступна связь с локальным словарём Electron. Перезапустите приложение.':'Ошибка записи локального словаря. Повторите сохранение.';
 return `Не удалось сохранить термин. ${reason}`;
}
async function loadSharedDictionary(){if(!window.desktop)return;try{const stored=await window.desktop.dictionaryLoad();sharedDictionaryAvailable=stored.shared;personalWords=filterPersonalWords([...new Set([...personalWords,...stored.words])]).slice(0,20000);localStorage.setItem(KEYS.dictionary,JSON.stringify(personalWords));if(personalWords.length)await window.desktop.dictionaryMergeSave(personalWords);refreshProofreading(editor);document.dispatchEvent(new Event('xrs-dictionary-changed'));}catch{sharedDictionaryAvailable=false;}}
void loadSharedDictionary();
setLiveProofreading(editor,false);
let savedSelection=editor.state.selection;
function scheduleViewSave(){if(templateMode)return;clearTimeout(timer);timer=setTimeout(saveLocal,450);}
editor.on('selectionUpdate',()=>{ savedSelection=editor.state.selection;updateRibbon();scheduleViewSave(); });
$('#canvas').addEventListener('scroll',scheduleViewSave,{passive:true});
editor.on('update',()=>{if(!suppress){changedSinceOpen=true;const active=openReports.find(r=>r.id===activeReportId);if(active){active.doc=editor.getJSON() as RichNode;active.templateId=activeTemplateId;active.dirty=true;}clearTimeout(timer);if(!templateMode){$('#save-state').hidden=false;$('#save-state').textContent='Сохраняется…';timer=setTimeout(saveLocal,450);}else $('#save-state').textContent='Шаблон изменён';renderCounts();renderReportTabs();}});
editor.on('transaction',updateRibbon);
const json=()=>editor.getJSON() as RichNode;
document.addEventListener('xrs-template-update-available',()=>toast('Доступна новая версия медицинских шаблонов. Откройте «Медицинские шаблоны», чтобы проверить изменения и подтвердить установку.'));
function restore(doc:RichNode,history:unknown,view?:unknown) { suppress=true;try {const prepared=prepareInlineDocument(doc);editor.commands.setContent(prepared);const root=editor.schema.nodeFromJSON(prepared);let attributes=editor.state.tr;for(const [name,value] of Object.entries(root.attrs))attributes=attributes.setDocAttribute(name,value);editor.view.dispatch(attributes.setMeta('addToHistory',false));restoreReportHistory(editor.view,sanitizeReportHistory(history,settings.historyDepth));}finally{suppress=false;}restoreReportView(view);savedSelection=editor.state.selection;setReviewHighlights(editor,review);setLiveProofreading(editor,false);refreshProofreading(editor);renderCounts(); }
function toast(message:string,error=false) { $('.toast')?.remove();const t=document.createElement('div');t.className=`toast${error?' error':''}`;t.role=error?'alert':'status';t.textContent=message;document.body.append(t);setTimeout(()=>t.remove(),5000); }
function readReportView(value:unknown):StoredReportView|undefined {if(!value||typeof value!=='object'||Array.isArray(value))return;const view=value as Record<string,unknown>;if(!view.selection||typeof view.selection!=='object'||Array.isArray(view.selection)||typeof view.scrollTop!=='number'||!Number.isFinite(view.scrollTop)||view.scrollTop<0||view.scrollTop>100000)return;return{selection:view.selection as Record<string,unknown>,scrollTop:view.scrollTop};}
function restoreReportView(value:unknown){
 const view=readReportView(value);let selection:Selection|undefined;
 if(view){try{selection=Selection.fromJSON(editor.state.doc,view.selection);editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory',false));}catch{/* Invalid or stale view state cannot affect the document or its history. */}}
 $('#canvas').scrollTop=view?.scrollTop??0;
 if(view&&selection){
  const reportId=activeReportId,doc=editor.state.doc,restoredSelection=selection;
  // The first layout starts loading embedded fonts. Restoring before they are
  // ready lets font reflow and browser scroll anchoring shift the saved view.
  requestAnimationFrame(()=>{void document.fonts.ready.then(()=>{
   if(editor.isDestroyed||activeReportId!==reportId||editor.state.doc!==doc||!editor.state.selection.eq(restoredSelection))return;
   editor.view.focus();$('#canvas').scrollTop=view.scrollTop;
  });});
 }
}
function syncActiveReport(){const active=openReports.find(r=>r.id===activeReportId);if(active){active.doc=json();active.templateId=activeTemplateId;active.dirty=changedSinceOpen;historyByReport[active.id]={fingerprint:documentFingerprint(active.doc),history:getReportHistory(editor.state),view:{selection:editor.state.selection.toJSON() as Record<string,unknown>,scrollTop:$('#canvas').scrollTop}};}}
function saveLocal():boolean {
 if(Reflect.get(window,'xrsFatal'))return false;
 if(templateMode)return false;
 if(workspaceRecoveryBlocked){$('#save-state').hidden=false;$('#save-state').textContent='Не сохранено';toast('Не удалось создать резервную копию повреждённого рабочего пространства. Сохраните документ в Word.',true);return false;}
 try{
  syncActiveReport();
  const draft=JSON.stringify({format:'mri-report-studio',version:draftVersion,profile:profileForTemplate(),templateId:activeTemplateId,doc:json(),customModules:[]});
  localStorage.setItem(KEYS.workspace,JSON.stringify({activeId:activeReportId,reports:openReports}));
  try{localStorage.setItem(KEYS.history,JSON.stringify(historyByReport));}
  catch{
   $('#save-state').hidden=false;$('#save-state').textContent='Документы сохранены; история в памяти';
   toast('Документы сохранены. Не хватает места для сохранения истории Undo/Redo. Текущая история доступна до закрытия приложения.',true);
   return true;
  }
  try{localStorage.setItem(KEYS.draft,draft);}catch{/* The saved workspace is authoritative. */}
  $('#save-state').hidden=true;$('#save-state').textContent='Сохранено на компьютере';return true;
 }catch{ $('#save-state').hidden=false;$('#save-state').textContent='Не сохранено';toast('Не удалось сохранить рабочее пространство. Проверьте свободное место. Открытые документы остаются в редакторе. Сохраните правки в Word или PDF перед выходом.',true);return false; }
}
function restoreMigrationExactly(doc:RichNode) { const node=editor.schema.nodeFromJSON(prepareInlineDocumentBase(doc));node.check();suppress=true;try{editor.view.updateState(EditorState.create({schema:editor.schema,doc:node,plugins:editor.state.plugins}));}finally{suppress=false;}savedSelection=editor.state.selection;setReviewHighlights(editor,review);setLiveProofreading(editor,false);refreshProofreading(editor);renderCounts(); }
function profileForTemplate() { const area=reportTemplates.find(t=>t.id===activeTemplateId)?.areaId;return area==='head'?'brain':'custom'; }
function reportTitle(id:string,doc:RichNode){const template=reportTemplates.find(t=>t.id===id);return template?titleWithStudySide(template.title,overrides[id]??template.doc,doc):'Исследование';}
function renderCounts() {
 const templateTitle=reportTitle(activeTemplateId,json());
 const patient=extractFilenameFields(editor.getText({blockSeparator:'\n'})).patient;
 $('#document-name').textContent=patient?`${shortPatientName(patient)} · ${templateTitle}`:templateTitle;
 $('#template-name').textContent=templateTitle;
 $('#word-count').textContent=`${editor.state.doc.textContent.split(/\s+/).filter(Boolean).length} слов`;
 $('#review-unchanged').textContent=review?`Неизменённых частей: ${countUnchangedParts(json())}`:'Подсветить неизменённое';
}
const tabPatientNames=new WeakMap<RichNode,string>();
function patientNameForReport(doc:RichNode):string {
 const cached=tabPatientNames.get(doc);
 if(cached!==undefined)return cached;
 const labels=(node:RichNode):string=>node.type==='text'?node.text??'':node.type==='hardBreak'?'\n':
  node.type==='reportField'?String(node.attrs?.value??''):
  (node.content??[]).map(labels).join(['paragraph','heading'].includes(node.type)?'':'\n');
 const patient=extractFilenameFields(labels(doc)).patient||
  collectInlineFields(doc).find(field=>field.filled&&isPatientField(field))?.value.trim()||'';
 tabPatientNames.set(doc,patient);return patient;
}
function renderReportTabs(){
 const tabs=$('#report-tabs'),scroll=tabs.scrollLeft;
 tabs.innerHTML=openReports.map((report,index)=>{
  const name=buildReportTabName(patientNameForReport(report.doc),reportTitle(report.templateId,report.doc),index);
  return `<div class="report-tab ${report.id===activeReportId?'active':''}"><button class="report-tab-select" data-report-select="${esc(report.id)}" aria-label="${esc(name.fullTitle)}" title="${esc(name.fullTitle)}">${report.dirty?'● ':''}${esc(name.label)}</button><button class="report-tab-close" data-report-close="${esc(report.id)}" aria-label="Закрыть ${esc(name.fullTitle)}" title="Закрыть">×</button></div>`;
 }).join('')+'<button class="report-tab-add" id="add-report-tab" type="button" aria-label="Новое заключение" title="Новое заключение">＋</button>';
 tabs.scrollLeft=scroll;
 const selected=tabs.querySelector<HTMLElement>('.report-tab.active');
 if(selected){
  const strip=tabs.getBoundingClientRect(),tab=selected.getBoundingClientRect();
  if(tab.left<strip.left || tab.right>strip.right)tabs.scrollLeft+=tab.left-strip.left;
 }
}
function modalityForTemplate(id=activeTemplateId):'mri'|'ct' { return id.startsWith('ct-')?'ct':'mri'; }
function revisionSelect(id:string){const rows=revisionsForTemplate(id);if(!rows.length)return '';return `<label class="template-version-label">Версия <select data-revision-template="${esc(id)}" aria-label="Версия шаблона ${esc(id)}"><option value="">${overrides[id]?'Моя редакция':'Установленная редакция'}</option>${rows.map(r=>`<option value="${esc(r.templateVersion)}" ${r.status==='Revoked'||!r.available?'disabled':''}>${esc(r.templateVersion)} — ${esc(r.status)}${!r.available?' (нет локального пакета)':''}</option>`).join('')}</select></label>`;}
function renderTemplates() { const modality=($('#modality-select') as HTMLSelectElement).value||modalityForTemplate();const choices=areas.filter(a=>a.id.startsWith(modality==='ct'?'ct-':'')&& (modality==='ct'||!a.id.startsWith('ct-')));if(!choices.some(a=>a.id===selectedAreaId))selectedAreaId=choices[0]?.id??'';const areaSelect=$('#area-select') as HTMLSelectElement;areaSelect.innerHTML=choices.map(a=>`<option value="${esc(a.id)}">${esc(a.title)}</option>`).join('');areaSelect.value=selectedAreaId;$('#template-list').innerHTML=reportTemplates.filter(t=>(!t.retired||Boolean(overrides[t.id]))&&t.areaId===selectedAreaId).map(t=>`<div class="template-version-row"><button class="template-card ${t.id===activeTemplateId?'selected':''}" data-template="${esc(t.id)}"><span class="template-icon">▤</span><span><strong>${esc(t.title)}</strong><small>Версия шаблона: ${esc(currentTemplateVersion(t.id))}${overrides[t.id]?' · Пользовательская редакция':''}</small></span>${t.id===activeTemplateId?'<span class="check">✓</span>':''}</button>${revisionSelect(t.id)}</div>`).join(''); }
let blockFilter='all';
function allBlocks():Block[]{return [...customBlocks,{id:'standard-size',title:'Размер (фронтальный/сагиттальный/вертикальный)',areaId:'',tags:'размер размеры фронтальный сагиттальный вертикальный',doc:makeSizeBlock(modalityForTemplate()==='ct'),custom:false},...builtInBlocks];}
function plain(doc:RichNode):string {if(doc.type==='reportField')return doc.attrs?.value||doc.attrs?.hint||'';return doc.text??(doc.content??[]).map(plain).join(['paragraph','heading','doc','reportSection'].includes(doc.type)?'\n':'');}
function exportDocument():RichNode{return templateMode?promoteInlineTemplate(json()):attachDoctorStamp(json(),settings.doctorStamps,settings.doctorStampSizes,settings.doctorStampHeights,settings.doctorStampPositions);}
function doctorStampForLine(line:string){const name=findDoctorStampKey(line,settings.doctorStamps);if(!name)return null;return {src:settings.doctorStamps[name],size:settings.doctorStampSizes[name]??{width:140,height:55},height:settings.doctorStampHeights[name]??140,position:settings.doctorStampPositions[name]??{x:0,y:0}};}
function decorateExportFooter(root:HTMLElement){
 const doctor=[...root.querySelectorAll<HTMLElement>('p')].find(p=>/врач(?:-рентгенолог)?\s*:/i.test(p.textContent??''));if(!doctor)return;
 let date:HTMLElement|null=null;
 if(/дата\s*:/i.test(doctor.textContent??'')){
  const walker=document.createTreeWalker(doctor,NodeFilter.SHOW_TEXT);let dateText:Text|null=null,offset=0;
  while(walker.nextNode()){const current=walker.currentNode as Text;const found=current.data.search(/дата\s*:/i);if(found>=0){dateText=current;offset=found;break;}}
  if(dateText){const range=document.createRange();range.setStart(dateText,offset);range.setEnd(doctor,doctor.childNodes.length);const tail=range.extractContents();date=doctor.cloneNode(false) as HTMLElement;date.append(tail);doctor.after(date);}
 }else{const next=doctor.nextElementSibling as HTMLElement|null;if(next&&next.tagName==='P'&&/дата\s*:/i.test(next.textContent??''))date=next;}
 const parent=doctor.parentElement;if(!parent)return;const row=document.createElement('div');row.className='doctor-signature-row';parent.insertBefore(row,doctor);row.append(doctor);doctor.classList.add('doctor-signature-doctor');if(date){row.append(date);date.classList.add('doctor-signature-date');}
 if(date){const walker=document.createTreeWalker(date,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode as Text;node.data=node.data.replace(/дата\s*:/i,'Дата:');}}
 const stamp=doctorStampForLine(doctor.textContent??'');if(stamp){const image=document.createElement('img');image.className='doctor-stamp-image';image.src=stamp.src;image.alt='Подпись и печать врача';image.style.setProperty('--stamp-height',`${stamp.height}px`);image.style.setProperty('--stamp-x',`${stamp.position.x}px`);image.style.setProperty('--stamp-y',`${stamp.position.y}px`);image.width=Math.max(1,Math.round(stamp.height*stamp.size.width/Math.max(1,stamp.size.height)));image.height=stamp.height;image.contentEditable='false';row.append(image);}root.contentEditable='false';
}
let printPlanCache:{key:string;promise:Promise<PrintPlan>}|undefined;
function renderPrintVariant(doc:RichNode,asTemplate=false){
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden';document.body.append(host);
 const box=measurePrintBox(doc),prepared=preparePrintDocument(doc,box),temporary=makeEditor(host,prepared,()=>{});
 const printNodes=prepared.content??[],conclusion=printConclusion(printNodes,firstPrintedConclusionBlock(doc));
 printNodes.forEach((node,index)=>{
  const element=temporary.view.dom.children[index];
  if(node.type==='horizontalRule'&&node.attrs?.keepNext)element?.setAttribute('data-keep-next','true');
  if(index===conclusion?.description){
   element?.setAttribute('data-last-description','true');
   if(node.type==='table')element?.setAttribute('data-keep-next','true');
  }
  if(index===conclusion?.heading)element?.setAttribute('data-conclusion-start','true');
  if(index===conclusion?.body)element?.setAttribute('data-conclusion-body','true');
  if(conclusion&&conclusion.body>conclusion.heading&&index>=conclusion.heading&&index<conclusion.body)element?.setAttribute('data-keep-conclusion','true');
 });
 try{if(!asTemplate)decorateExportFooter(temporary.view.dom);temporary.view.dom.querySelectorAll<HTMLImageElement>('img:not(.doctor-stamp-image)').forEach(image=>{const w=Number(image.getAttribute('width')),h=Number(image.getAttribute('height'));if(w>0&&h>0){image.style.width=`min(100%, ${w}px)`;image.style.height='auto';image.style.aspectRatio=`${w}/${h}`;}});const previewSourceHtml=DOMPurify.sanitize(temporary.view.dom.innerHTML),html=paginateBrowserPreview(previewSourceHtml,doc,box);
 const fragment=document.createElement('div');fragment.innerHTML=html;const pages=[...fragment.querySelectorAll<HTMLElement>('.preview-page .report-content')];
 const firstConclusion=pages.find(page=>page.querySelector('[data-conclusion-start="true"]'));
 const paired=!conclusion||conclusion.description<0||Boolean(firstConclusion?.querySelector<HTMLElement>('[data-last-description="true"]')?.textContent?.trim());
 const bodyWithHeading=!conclusion||Boolean(firstConclusion?.querySelector('[data-conclusion-body="true"]'));
 const releaseDescriptionKeep=Boolean(fragment.querySelector('[data-description-exceeds-keep-group]'));
 return{html,box,releaseDescriptionKeep,metrics:{pages:pages.length,safe:pages.length>0&&bodyWithHeading&&!fragment.querySelector('[data-preview-overflow=true]'),descriptionOnConclusion:paired}};
 }finally{temporary.destroy();host.remove();}
}
async function getReportPrintPlan():Promise<PrintPlan>{
 const asTemplate=templateMode,source=asTemplate?promoteInlineTemplate(json()):json(),format=currentDoctorFormat();const key=JSON.stringify([source,format,settings,asTemplate]);
 if(printPlanCache?.key===key)return printPlanCache.promise;
 const promise=(async()=>{const probe=document.createElement('div');probe.style.cssText='position:fixed;left:-10000px;width:210mm';document.body.append(probe);const editorProbe=makeEditor(probe,source,()=>{});try{await document.fonts.ready;}finally{editorProbe.destroy();probe.remove();}if(key!==JSON.stringify([templateMode?promoteInlineTemplate(json()):json(),currentDoctorFormat(),settings,templateMode]))throw new Error('Документ или настройки изменились во время подготовки печати. Повторите сохранение.');return choosePrintLayout(source,!asTemplate&&format.optimize,doc=>renderPrintVariant(doc,asTemplate));})();
 printPlanCache={key,promise};try{return await promise;}catch(error){if(printPlanCache?.key===key)printPlanCache=undefined;throw error;}
}
function mountExportEditor(html:string):()=>void {
 const host=document.createElement('div');
 host.className='export-only-editor';
 host.innerHTML=html;
 $('#editor').append(host);
 return ()=>host.remove();
}

function renderBlocks() { const query=($('#block-search') as HTMLInputElement).value.toLocaleLowerCase('ru');const rows=allBlocks().filter(b=>(blockFilter!=='custom'||b.custom)&&`${b.title} ${b.tags} ${plain(b.doc)}`.toLocaleLowerCase('ru').includes(query));$('#block-list').innerHTML=rows.map(b=>`<article class="block-card"><span class="block-tag">${b.custom?'Моё описание':'Готовый блок'}</span><strong>${esc(b.title)}</strong><p>${esc(plain(b.doc).slice(0,140))}</p><div><button class="btn small" data-preview-block="${esc(b.id)}">Посмотреть</button><button class="btn small insert" data-insert-block="${esc(b.id)}">Вставить</button></div></article>`).join('')||'<p class="empty-state">Описание не найдено. Создайте новый блок или сохраните выделенный фрагмент.</p>'; }
function setTab(tab:'templates'|'blocks'){sidebarTab=tab;document.querySelectorAll<HTMLElement>('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#template-navigation').classList.toggle('hidden',tab!=='templates');$('#block-navigation').classList.toggle('hidden',tab!=='blocks');if(tab==='blocks')renderBlocks();}
document.querySelectorAll<HTMLElement>('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab as typeof sidebarTab));
$('#area-select').onchange=()=>{selectedAreaId=($('#area-select') as HTMLSelectElement).value;renderTemplates();};$('#modality-select').onchange=()=>{const modality=($('#modality-select') as HTMLSelectElement).value;selectedAreaId=areas.find(a=>a.id.startsWith(modality==='ct'?'ct-':'')&&(modality==='ct'||!a.id.startsWith('ct-')))?.id??'';renderTemplates();};
$('#template-list').onclick=e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-template]');if(b) chooseTemplate(b.dataset.template!);};
async function chooseTemplate(id:string) {if(templateMode){toast('Сначала сохраните или отмените изменения шаблона.',true);return;}
 const choice=document.querySelector<HTMLSelectElement>(`[data-revision-template="${CSS.escape(id)}"]`),rows=revisionsForTemplate(id),version=choice?.value;
 if(!version){createReportTab(id,newDocument(id));return;}
 const bridge=Reflect.get(window,'desktop') as import('./template-update-types.ts').TemplateDesktop|undefined;
 if(!bridge?.templateRevision){toast('Для выбора редакции перезапустите установленный XRS.',true);return;}
 try{const result=await bridge.templateRevision(id,version);const raw=result.builtin?makeBuiltinTemplateDocument(id):result.template!.doc;
 let doc=defaultDoctor(prepareInlineDocument(initializeReportFooter(resetInlineTemplate(newProtocolFont(raw,currentDoctorFormat().fontSize)))));
 if(result.builtin)doc=structurePreparedBuiltin(id,justifyDescription(doc));
 const source=result.metadata;doc.attrs={...doc.attrs,templateSource:{id,version:source.templateVersion,status:source.status,sha256:source.sha256,...(source.catalogVersion?{catalogVersion:source.catalogVersion}:{})}};createReportTab(id,doc);
 }catch(error){toast(`Редакция не открыта: ${(error as Error).message}`,true);}
}
function openReportTab(id:string){if(id===activeReportId)return;if(templateMode){toast('Сначала сохраните или отмените изменения шаблона.',true);return;}clearTimeout(timer);saveLocal();const report=openReports.find(item=>item.id===id);if(!report)return;activeReportId=id;activeTemplateId=report.templateId;selectedAreaId=reportTemplates.find(t=>t.id===activeTemplateId)!.areaId;($('#modality-select') as HTMLSelectElement).value=modalityForTemplate();changedSinceOpen=report.dirty;restore(report.doc,historyByReport[report.id]?.history,historyByReport[report.id]?.view);renderTemplates();renderReportTabs();saveLocal();}
function createReportTab(templateId=activeTemplateId,doc?:RichNode){if(!doc&&!templateAvailable(templateId)&&!overrides[templateId])templateId=reportTemplates.find(t=>!t.retired)!.id;if(templateMode)return;doc??=newDocument(templateId);clearTimeout(timer);if(!saveLocal())return;const report:OpenReport={id:crypto.randomUUID(),templateId,doc,dirty:false};openReports.push(report);activeReportId=report.id;activeTemplateId=templateId;selectedAreaId=reportTemplates.find(t=>t.id===templateId)!.areaId;($('#modality-select') as HTMLSelectElement).value=modalityForTemplate();changedSinceOpen=false;restore(doc,undefined);renderTemplates();renderReportTabs();saveLocal();$('#canvas').scrollTop=0;}
function closeReportTab(id:string,confirmed=false){const report=openReports.find(r=>r.id===id);if(!confirmed&&report?.dirty){const d=dialog('Документ не сохранён','<p>В документ внесены изменения, которые не были сохранены в Word или PDF. Закрыть документ без сохранения?</p>','<button class="btn primary" data-close>Продолжить редактирование</button><button class="btn danger" id="close-unsaved-report">Закрыть без сохранения</button>');d.querySelector('#close-unsaved-report')!.addEventListener('click',()=>{closeDialog();closeReportTab(id,true);});return;}if(templateMode){toast('Сначала сохраните или отмените изменения шаблона.',true);return;}if(openReports.length===1){const current=openReports[0];current.doc=newDocument(current.templateId);current.dirty=false;delete historyByReport[current.id];changedSinceOpen=false;restore(current.doc,undefined);saveLocal();renderReportTabs();return;}const wasActive=id===activeReportId;clearTimeout(timer);if(wasActive)syncActiveReport();openReports=openReports.filter(r=>r.id!==id);delete historyByReport[id];if(wasActive){const next=openReports.at(-1)!;activeReportId=next.id;activeTemplateId=next.templateId;selectedAreaId=reportTemplates.find(t=>t.id===activeTemplateId)!.areaId;($('#modality-select') as HTMLSelectElement).value=modalityForTemplate();changedSinceOpen=next.dirty;restore(next.doc,historyByReport[next.id]?.history,historyByReport[next.id]?.view);renderTemplates();}renderReportTabs();saveLocal();}
$('#report-tabs').onclick=e=>{const target=e.target as HTMLElement;if(target.closest('#add-report-tab')){createReportTab();return;}const close=target.closest<HTMLElement>('[data-report-close]');if(close){closeReportTab(close.dataset.reportClose!);return;}const select=target.closest<HTMLElement>('[data-report-select]');if(select)openReportTab(select.dataset.reportSelect!);};
$('#new-report').onclick=()=>createReportTab();
$('#toggle-sidebar').onclick=()=>$('.sidebar').classList.toggle('open');
$('#block-search').oninput=renderBlocks;
document.querySelectorAll<HTMLElement>('[data-block-filter]').forEach(b=>b.onclick=()=>{blockFilter=b.dataset.blockFilter!;document.querySelectorAll('[data-block-filter]').forEach(x=>x.classList.toggle('active',x===b));renderBlocks();});

function dialog(title:string,body:string,footer='') {closeDialog();const overlay=document.createElement('div');overlay.className='dialog-overlay';overlay.innerHTML=`<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">${esc(title)}</h2><button data-close aria-label="Закрыть">×</button></header><div class="dialog-body">${body}</div>${footer?`<footer>${footer}</footer>`:''}</section>`;document.body.append(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay||(e.target as HTMLElement).closest('[data-close]'))closeDialog();});overlay.addEventListener('keydown',e=>{if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll<HTMLElement>('button,input,textarea,select')].filter(n=>!n.hasAttribute('disabled'));if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}});setTimeout(()=>overlay.querySelector<HTMLElement>('input,textarea,button')?.focus(),0);return overlay;}
function closeDialog(){$('.dialog-overlay')?.remove();}
// Experimental local prototype. Existing user documents are never migrated automatically.
{
  const status=document.createElement('small');status.id='ai-review-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const tracks=new TrackChangesEngine();
  const rejectedReviewKeys=new Map<string,Set<string>>();
  const reviewRejectionKey=(item:import('./ai-review.ts').Suggestion,blocks:import('./ai-review.ts').ReviewBlocks)=>{
    const text=blocks[item.blockId],before=text.slice(Math.max(0,item.from-32),item.from),after=text.slice(item.to,item.to+32);
    return JSON.stringify([item.blockId,categoryGroup(item.category),item.from,item.to,item.original,before,after]);
  };
  let findings:import('./ai-review.ts').Suggestion[]=[];
  let reviewedBlocks:import('./ai-review.ts').ReviewBlocks|undefined;
  let reviewedReport='';
  let reviewedDoc:ProseMirrorNode|undefined;
  let card:HTMLElement|undefined;
  let cardPositionHandler:(()=>void)|undefined;
  let cardResizeObserver:ResizeObserver|undefined;
  const closeCard=()=>{if(cardPositionHandler){window.removeEventListener('resize',cardPositionHandler);window.removeEventListener('scroll',cardPositionHandler,true);}cardResizeObserver?.disconnect();cardPositionHandler=undefined;cardResizeObserver=undefined;card?.remove();card=undefined;};
  const renderFindingPanel=()=>{};
  const renderDecorations=()=>{
    if(!reviewedBlocks||reviewedReport!==activeReportId){setAiReviewDecorations(editor,[]);renderFindingPanel();return;}
    const ranges:ReviewDecorationRange[]=[];
    for(const item of findings){try{const range=resolveReviewRange(editor,item,reviewedBlocks,reviewedReport,activeReportId);ranges.push({...range,id:item.id,category:item.category,original:item.original});}catch{/* stale locations are not decorated */}}
    setAiReviewDecorations(editor,ranges);
    renderFindingPanel();
  };
  const openCard=(target:HTMLElement,point?:{x:number;y:number})=>{
    closeCard();
    const ids=(target.dataset.aiReviewIds??'').split(',').filter(Boolean);
    const items=findings.filter(item=>ids.includes(item.id)&&item.state==='pending');
    const blocks=reviewedBlocks,tabId=reviewedReport,checkedDocument=reviewedDoc;
    if(!items.length||!blocks||!checkedDocument||tabId!==activeReportId)return;
    const pop=document.createElement('section');card=pop;pop.className='ai-review-card';pop.setAttribute('role','menu');pop.setAttribute('aria-label','Замечания AI Review');
    for(const item of items){
      const section=document.createElement('article');section.className='ai-review-card-item';
      const title=document.createElement('strong');title.textContent=reviewCategories.find(([id])=>id===categoryGroup(item.category))?.[1]??item.category;
      const explanation=document.createElement('details');const summary=document.createElement('summary');summary.textContent=item.explanation.split(' Связанный фрагмент:')[0].slice(0,160);const evidence=document.createElement('p');evidence.textContent=item.explanation;explanation.append(summary,evidence);
      section.append(title,explanation);
      if(item.related){const related=document.createElement('p');related.textContent=`Связанный фрагмент: ${item.related}`;explanation.append(related);}
      const excerpt=document.createElement('small');excerpt.textContent=`Фрагмент: ${item.original||'позиция вставки'}`;explanation.append(excerpt);
      const confirmation=document.createElement('div');
      confirmation.hidden=true;
      confirmation.className='ai-review-safety';
      const apply=(spellingText?:string,medicalConfirmed=false)=>{
        try{
          if(tabId!==activeReportId)throw new ReviewEditError('wrong-document');
          if(card!==pop||reviewedBlocks!==blocks||!findings.some(finding=>finding===item))throw new ReviewEditError('stale-text');
          applyReviewSuggestion(editor,item,blocks,tabId,activeReportId,{checkedDocument,spellingText,medicalConfirmed});
          tracks.markAccepted(tabId,item.id);
          closeCard();
          toast('Исправление применено.');
        }catch(error){
          if(error instanceof ReviewEditError&&error.code==='medical-confirmation'){
            if(spellingText===undefined)return;
            const warning=document.createElement('p');
            warning.setAttribute('role','alert');
            warning.textContent=error.message;
            const comparison=document.createElement('p');
            comparison.textContent=`«${item.original}» → «${spellingText}»`;
            const confirm=document.createElement('button');confirm.type='button';confirm.className='btn small primary';
            confirm.textContent='Подтвердить замену';confirm.onclick=()=>apply(spellingText,true);
            const cancel=document.createElement('button');cancel.type='button';cancel.className='btn small';
            cancel.textContent='Отмена';cancel.onclick=()=>{confirmation.hidden=true;confirmation.replaceChildren();section.querySelector('input')?.focus();};
            confirmation.replaceChildren(warning,comparison,confirm,cancel);
            confirmation.hidden=false;
            cancel.focus();
          }else{
            if(error instanceof ReviewEditError&&error.code!=='invalid-operation'&&card===pop)closeCard();
            toast(error instanceof ReviewEditError?error.message:'Не удалось применить исправление. Повторите проверку.',true);
          }
        }
      };
      if((item.operation==='delete'||item.proposed)&&isSafeReviewReplacement(item)){
        const replace=document.createElement('button');replace.type='button';replace.className='btn small primary';
        replace.textContent=item.operation==='delete'?'Удалить лишний пробел':'Заменить';replace.onclick=()=>apply();section.append(replace);
      }
      if(item.category==='spelling'){
        const input=document.createElement('input');input.placeholder='Заменить на...';input.setAttribute('aria-label','Заменить на...');
        input.value=item.candidates?.[0]??item.proposed;
        input.oninput=()=>{confirmation.hidden=true;confirmation.replaceChildren();};
        const submit=document.createElement('button');submit.type='button';submit.className='btn small';submit.textContent='Применить';
        submit.onclick=()=>apply(input.value);section.append(input,submit);
        for(const candidate of item.candidates??[]){
          const choice=document.createElement('button');choice.type='button';choice.className='btn small';choice.textContent=candidate;
          choice.onclick=()=>{input.value=candidate;apply(candidate);};
          section.append(choice);
        }
        section.append(confirmation);
      }else if(item.operation==='comment'||(item.operation!=='delete'&&!item.proposed)||!isSafeReviewReplacement(item)){
        const assess=document.createElement('p');assess.className='ai-review-safety';assess.textContent='Предупреждение для оценки врачом. Текст не изменяется.';section.append(assess);
      }
      const actions=document.createElement('div');actions.className='ai-review-card-actions';
      const reject=document.createElement('button');reject.className='btn small';reject.textContent='Отклонить';reject.onclick=()=>{if(card!==pop||tabId!==activeReportId||reviewedBlocks!==blocks)return;const keys=rejectedReviewKeys.get(tabId)??new Set<string>();keys.add(reviewRejectionKey(item,blocks));rejectedReviewKeys.set(tabId,keys);tracks.reject(tabId,item.id);findings=findings.filter(x=>x.id!==item.id);closeCard();renderDecorations();};actions.append(reject);
      const remember=/^[а-яёa-z-]{2,80}$/iu.test(item.original.trim())&&(item.category==='spelling'||item.category==='terminology');
      if(remember){const save=document.createElement('button');save.className='btn small';save.textContent='Запомнить термин';save.onclick=async()=>{if(card!==pop||tabId!==activeReportId||reviewedBlocks!==blocks)return;save.disabled=true;const term=item.original.trim().toLocaleLowerCase('ru');if(personalWords.some(x=>x.toLocaleLowerCase('ru')===term)){toast('Термин уже есть в личном словаре.');save.disabled=false;return;}try{removedDictionaryWords.delete(term);localStorage.setItem('xrs.dictionary.removed.v1',JSON.stringify([...removedDictionaryWords]));const next=[...personalWords,term];let merged=next;if(window.desktop){const saved=await window.desktop.dictionaryMergeSave(next);merged=filterPersonalWords(saved.words);sharedDictionaryAvailable=saved.shared;}localStorage.setItem(KEYS.dictionary,JSON.stringify(merged));personalWords=merged;document.dispatchEvent(new Event('xrs-dictionary-changed'));refreshProofreading(editor);toast('Термин добавлен в личный словарь. Удалить его можно в настройках словаря.');}catch(error){save.disabled=false;toast(dictionarySaveError(error),true);}};actions.append(save);}
      section.append(actions);pop.append(section);
    }
    const dismiss=document.createElement('button');dismiss.className='ai-review-card-close';dismiss.type='button';dismiss.textContent='Закрыть';dismiss.onclick=closeCard;pop.append(dismiss);
    pop.addEventListener('keydown',event=>{if((event as KeyboardEvent).key==='Escape'){closeCard();editor.view.focus();}});
    document.body.append(pop);
    const position=()=>{if(!target.isConnected){closeCard();return;}const r=target.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,pad=10;const left=Math.max(pad,Math.min(point?.x??r.left,window.innerWidth-w-pad));let top=point?.y??r.bottom+pad;if(top+h+pad>window.innerHeight)top=(point?.y??r.top)-h-pad;top=Math.max(pad,Math.min(top,window.innerHeight-h-pad));pop.style.left=`${left}px`;pop.style.top=`${top}px`;};
    cardPositionHandler=position;window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    if(typeof ResizeObserver!=='undefined'){cardResizeObserver=new ResizeObserver(position);cardResizeObserver.observe(target);cardResizeObserver.observe(pop);}
    position();
  };
  const editorRoot=editor.view.dom;
  editorRoot.addEventListener('contextmenu',event=>{const span=(event.target as HTMLElement).closest<HTMLElement>('[data-ai-review-ids]');if(!span)return;event.preventDefault();clearProofPopup();openCard(span,{x:event.clientX,y:event.clientY});});
  document.addEventListener('pointerdown',event=>{if(card&&!card.contains(event.target as Node))closeCard();},true);
  document.addEventListener('keydown',event=>{if(card&&(event.key.length===1||event.key==='Backspace'||event.key==='Delete')&&editorRoot.contains(event.target as Node)&&!event.altKey&&!event.ctrlKey&&!event.metaKey)closeCard();},true);
  document.addEventListener('keydown',event=>{const e=event as KeyboardEvent,target=e.target as HTMLElement;if(e.key==='Escape'&&card&&(editorRoot.contains(document.activeElement)||card.contains(target))){e.preventDefault();closeCard();}},true);
  const enabledCategories=new Set<import('./ai-review.ts').ReviewCategory>(read('xrs.ai-review.categories.v1',reviewCategories.map(([id])=>id)));
  let reviewTimer=0, reviewGeneration=0;
  let reviewAbort:AbortController|undefined;
  const runReview=async()=>{
    clearTimeout(reviewTimer);reviewAbort?.abort();const abort=new AbortController();reviewAbort=abort;
    const generation=++reviewGeneration,reportId=activeReportId,checkedDocument=editor.state.doc;
    status.textContent='Проверка…';status.setAttribute('aria-busy','true');
    try{
      const result=await new ReviewEngine(new LocalAIProvider(undefined,()=>personalWords)).review(checkedDocument.toJSON() as RichNode,enabledCategories,abort.signal);
      if(abort.signal.aborted||generation!==reviewGeneration||reportId!==activeReportId||checkedDocument!==editor.state.doc)return;
      tracks.set(reportId,result.suggestions);const rejected=rejectedReviewKeys.get(reportId)??new Set<string>();
      findings=result.suggestions.filter(item=>!rejected.has(reviewRejectionKey(item,result.blocks))&&!(['spelling','terminology'].includes(item.category)&&personalWords.includes(item.original.toLocaleLowerCase('ru-RU'))));reviewedBlocks=result.blocks;reviewedReport=reportId;reviewedDoc=checkedDocument;
      renderDecorations();status.textContent=result.boundaryWarning?'':findings.length?`Замечаний: ${findings.length}`:'Замечаний не найдено';
    }catch(error){if(!abort.signal.aborted){const boundaries=/границ|структур|формат документа|пустой разрешённый блок/i.test((error as Error)?.message??'');status.textContent=boundaries?'':'Проверка недоступна.';}}
    finally{if(generation===reviewGeneration)status.removeAttribute('aria-busy');}
  };
  const scheduleReview=()=>{
    reviewAbort?.abort();reviewGeneration++;clearTimeout(reviewTimer);findings=[];reviewedBlocks=undefined;reviewedDoc=undefined;closeCard();setAiReviewDecorations(editor,[]);
    status.textContent='';reviewTimer=window.setTimeout(()=>void runReview(),650);
  };
  editor.on('update',scheduleReview);
  // setContent on tab changes can suppress update events; docChanged also catches it.
  editor.on('transaction',({transaction})=>{if(transaction.docChanged)scheduleReview();});
  document.addEventListener('xrs-dictionary-changed',scheduleReview);document.addEventListener('xrs-settings-restored',()=>{enabledCategories.clear();for(const id of read<ReviewCategory[]>('xrs.ai-review.categories.v1',reviewCategories.map(([id])=>id)))enabledCategories.add(id);scheduleReview();});
  scheduleReview();

}
function calculatorDialog(){
 const keys=[
  ['C','clear',''],['⌫','backspace',''],['±','sign',''],['÷','operator','÷'],
  ['7','digit','7'],['8','digit','8'],['9','digit','9'],['×','operator','×'],
  ['4','digit','4'],['5','digit','5'],['6','digit','6'],['−','operator','−'],
  ['1','digit','1'],['2','digit','2'],['3','digit','3'],['+','operator','+'],
  ['0','digit','0'],[',','decimal',''],['=','equals',''],
 ];
 const markup=`<div class="calculator"><output id="calculator-expression" class="calculator-expression" aria-live="polite"></output><output id="calculator-display" class="calculator-display" aria-live="assertive">0</output><div class="calculator-keys">${keys.map(([label,action,value])=>`<button type="button" class="calculator-key ${action==='operator'||action==='equals'?'accent':''} ${action==='clear'?'utility':''}" data-calc="${action}" data-value="${value}" aria-label="${label==='⌫'?'Удалить последний знак':label==='±'?'Сменить знак':label}">${label}</button>`).join('')}</div><p class="calculator-help">Клавиатура: цифры, +, −, *, /, Enter, Backspace.</p></div>`;
 const overlay=dialog('Калькулятор',markup,'<button class="btn" data-close>Закрыть</button>');
 overlay.classList.add('calculator-overlay');
 const panel=overlay.querySelector<HTMLElement>('.dialog')!;panel.classList.add('movable-calculator');const header=panel.querySelector('header')!;header.style.cursor='move';header.style.touchAction='none';
 header.addEventListener('pointerdown',event=>{if((event.target as HTMLElement).closest('button'))return;event.preventDefault();const rect=panel.getBoundingClientRect();panel.style.position='fixed';panel.style.left=`${rect.left}px`;panel.style.top=`${rect.top}px`;panel.style.width=`${rect.width}px`;panel.style.margin='0';header.setPointerCapture(event.pointerId);const offsetX=event.clientX-rect.left,offsetY=event.clientY-rect.top;const move=(next:PointerEvent)=>{const bounds=panel.getBoundingClientRect();panel.style.left=`${Math.max(0,Math.min(window.innerWidth-bounds.width,next.clientX-offsetX))}px`;panel.style.top=`${Math.max(0,Math.min(window.innerHeight-bounds.height,next.clientY-offsetY))}px`;};const up=(next:PointerEvent)=>{header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',up);header.removeEventListener('pointercancel',up);if(header.hasPointerCapture(next.pointerId))header.releasePointerCapture(next.pointerId);};header.addEventListener('pointermove',move);header.addEventListener('pointerup',up);header.addEventListener('pointercancel',up);});
 let current='0',stored:number|null=null,operation:CalculatorOperation|null=null,waiting=false,failed=false;
 const display=overlay.querySelector<HTMLOutputElement>('#calculator-display')!,expression=overlay.querySelector<HTMLOutputElement>('#calculator-expression')!;
 const render=()=>{display.textContent=current;display.classList.toggle('error',failed);expression.textContent=stored!==null&&operation?`${formatCalculatorResult(stored)} ${operation}`:'';};
 const reset=()=>{current='0';stored=null;operation=null;waiting=false;failed=false;render();};
 const fail=()=>{current='Ошибка';stored=null;operation=null;waiting=true;failed=true;render();};
 const digit=(value:string)=>{if(failed||waiting){current=value;waiting=false;failed=false;}else if(current==='0')current=value;else if(current==='-0')current=`-${value}`;else if(current.replace(/[-,]/g,'').length<16)current+=value;render();};
 const decimal=()=>{if(failed||waiting){current='0,';waiting=false;failed=false;}else if(!current.includes(','))current+=',';render();};
 const sign=()=>{if(failed){reset();return;}if(current.startsWith('-'))current=current.slice(1);else current=`-${current}`;render();};
 const backspace=()=>{if(failed){reset();return;}if(waiting)return;current=current.slice(0,-1);if(current===''||current==='-')current='0';render();};
 const applyOperator=(next:CalculatorOperation)=>{try{const value=parseCalculatorDisplay(current);if(stored!==null&&operation&&!waiting){stored=calculate(stored,value,operation);current=formatCalculatorResult(stored);}else stored=value;operation=next;waiting=true;failed=false;render();}catch{fail();}};
 const equals=()=>{if(stored===null||!operation||failed)return;try{current=formatCalculatorResult(calculate(stored,parseCalculatorDisplay(current),operation));stored=null;operation=null;waiting=true;render();}catch{fail();}};
 const act=(action:string,value:string)=>{if(action==='digit')digit(value);else if(action==='decimal')decimal();else if(action==='clear')reset();else if(action==='backspace')backspace();else if(action==='sign')sign();else if(action==='operator')applyOperator(value as CalculatorOperation);else if(action==='equals')equals();};
 overlay.querySelectorAll<HTMLButtonElement>('[data-calc]').forEach(button=>button.addEventListener('click',()=>act(button.dataset.calc!,button.dataset.value??'')));
 panel.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.ctrlKey||e.metaKey||e.altKey)return;const key=e.key;if(/^\d$/.test(key)){e.preventDefault();digit(key);}else if(key===','||key==='.') {e.preventDefault();decimal();}else if(key==='+'||key==='-'||key==='−'||key==='*'||key==='x'||key==='X'||key==='/'||key==='÷'){e.preventDefault();const operator:CalculatorOperation=key==='*'||key==='x'||key==='X'?'×':key==='/'||key==='÷'?'÷':key==='-'?'−':key as CalculatorOperation;applyOperator(operator);}else if(key==='Enter'||key==='='){e.preventDefault();equals();}else if(key==='Backspace'){e.preventDefault();backspace();}else if(key==='Delete'){e.preventDefault();reset();}});
 setTimeout(()=>overlay.querySelector<HTMLButtonElement>('[data-calc="digit"][data-value="7"]')?.focus(),0);
}
function templateChrome(){ $('#template-banner').classList.toggle('hidden',!templateMode);for(const id of ['new-report','open-report','edit-template','area-select'])($(`#${id}`) as HTMLButtonElement).disabled=templateMode;$('.shell').classList.toggle('template-mode',templateMode); }
$('#create-editable-field').onmousedown=e=>e.preventDefault();
$('#create-editable-field').onclick=()=>{if(!templateMode)return;try{const kind=createEditableField(editor);toast(kind==='measurement'?'Создан независимый размер 0,0.':kind==='paragraph'?'Создан редактируемый абзац с независимыми размерами.':'Создано независимое редактируемое текстовое поле.');}catch(error){toast((error as Error).message,true);}};
$('#edit-template').onclick=()=>{if(templateMode)return;if(!overrides[activeTemplateId])rememberTemplateBase(localStorage,activeTemplateId,makeTemplateDocument(activeTemplateId));saveLocal();clearTimeout(timer);backup={doc:json(),changed:changedSinceOpen,history:getReportHistory(editor.state)};templateMode=true;const initialTemplate=resetInlineTemplate(highlightDeletionNotes(separateRecommendations(compactTemplateTables(overrides[activeTemplateId]??makeTemplateDocument(activeTemplateId)))));restore(initialTemplate,undefined);templateEditBaseline=validateTemplate(promoteInlineTemplate(json()));templateChrome();$('#canvas').scrollTop=0;};
function finishTemplate(save:boolean){if(!templateMode||!backup)return;if(save){const previousTemplates=localStorage.getItem(KEYS.templates),previousVersions=localStorage.getItem(KEYS.templateVersions),backupKey='mri-alliance.template-backups.v1',previousBackups=localStorage.getItem(backupKey);try{const next=validateTemplate(promoteInlineTemplate(json())),unchanged=Boolean(templateEditBaseline&&canonicalTemplateRevision(next)===canonicalTemplateRevision(templateEditBaseline));if(!unchanged){const old=overrides[activeTemplateId]??makeTemplateDocument(activeTemplateId),oldVersion=currentTemplateVersion(activeTemplateId),nextVersion=nextTemplateVersion(oldVersion);let backups=JSON.parse(previousBackups??'[]');if(!Array.isArray(backups))throw new Error('Повреждено хранилище резервных копий шаблонов.');const record={id:crypto.randomUUID(),templateId:activeTemplateId,templateTitle:reportTemplates.find(item=>item.id===activeTemplateId)?.title??activeTemplateId,templateVersion:oldVersion,createdAt:new Date().toISOString(),doc:old};backups=[...backups,record];localStorage.setItem(backupKey,JSON.stringify(backups));const checkedBackups=JSON.parse(localStorage.getItem(backupKey)??'null');if(!Array.isArray(checkedBackups)||JSON.stringify(checkedBackups.at(-1))!==JSON.stringify(record))throw new Error('Не удалось проверить резервную копию шаблона.');const all={...overrides,[activeTemplateId]:next};localStorage.setItem(KEYS.templates,JSON.stringify(all));if(JSON.stringify(JSON.parse(localStorage.getItem(KEYS.templates)??'null')?.[activeTemplateId])!==JSON.stringify(next))throw new Error('Не удалось проверить сохранённый шаблон.');localStorage.setItem(KEYS.templateVersions,JSON.stringify({...readTemplateVersions(localStorage),[activeTemplateId]:nextVersion}));if(readTemplateVersion(localStorage,activeTemplateId,INITIAL_TEMPLATE_VERSION)!==nextVersion)throw new Error('Не удалось проверить версию шаблона.');overrides=all;}}catch(e){if(previousTemplates===null)localStorage.removeItem(KEYS.templates);else try{localStorage.setItem(KEYS.templates,previousTemplates);}catch{}if(previousVersions===null)localStorage.removeItem(KEYS.templateVersions);else try{localStorage.setItem(KEYS.templateVersions,previousVersions);}catch{}if(previousBackups===null)localStorage.removeItem(backupKey);else try{localStorage.setItem(backupKey,previousBackups);}catch{}toast(`Не удалось сохранить шаблон: ${(e as Error).message}`,true);return;}}const previous=backup;backup=null;templateEditBaseline=null;templateMode=false;restore(previous.doc,previous.history);changedSinceOpen=previous.changed;templateChrome();renderTemplates();toast(save?'Шаблон сохранён для новых описаний.':'Изменения шаблона отменены.');}
$('#save-template').onclick=()=>finishTemplate(true);$('#cancel-template').onclick=()=>finishTemplate(false);
$('#reset-template').onclick=()=>{const d=dialog('Вернуть исходный шаблон?','<p>В режиме редактирования будут восстановлены исходные текст и форматирование. Для применения нажмите «Сохранить шаблон».</p>','<button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-reset">Восстановить</button>');d.querySelector('#confirm-reset')!.addEventListener('click',()=>{restore(makeTemplateDocument(activeTemplateId),undefined);closeDialog();});};

function nextField(){const fields=collectInlineFields(json()).filter(f=>!f.filled);if(!fields.length){toast('Все поля заполнены. Проверьте неизменённые фрагменты шаблона.');return;}let target:{from:number;to:number}|undefined;const current=editor.state.selection.to;const ranges:{from:number;to:number}[]=[];editor.state.doc.descendants((n,pos)=>{if(n.isText&&n.marks.some(m=>m.type.name==='templateField'&&!m.attrs.filled))ranges.push({from:pos,to:pos+n.nodeSize});});target=ranges.find(r=>r.from>=current)??ranges[0];if(target){editor.chain().focus().setTextSelection(target).run();editor.view.dispatch(editor.state.tr.scrollIntoView());}}

$('#calculator').onclick=calculatorDialog;
$('#sticky-note-open').onclick=openStickyNote;
$('#review-unchanged').onclick=()=>{review=!review;setReviewHighlights(editor,review);$('#review-unchanged').classList.toggle('active',review);$('#review-unchanged').setAttribute('aria-pressed',String(review));renderCounts();if(review)toast('Подсвечены незаполненные поля и фрагменты, совпадающие с исходным шаблоном. Подсветка не попадает в Word и PDF.');};
function applyZoom(save=true){const level=normalizeZoom(Number(($('#zoom') as HTMLInputElement).value));$('.paper').style.zoom=String(level/100);$('#zoom-value').textContent=`${level}%`;if(save){settings.zoom=level;persistSettings();}}
($('#zoom') as HTMLInputElement).value=String(settings.zoom);applyZoom(false);$('#zoom').oninput=()=>applyZoom();
$('#insert-size').onmousedown=e=>e.preventDefault();
$('#insert-size').onclick=()=>{const content=makeSizeBlock(modalityForTemplate()==='ct').content?.[0].content??[];editor.chain().focus().insertContent(content).run();toast('Вставлены фронтальный, сагиттальный и вертикальный размеры.');};
function rekeyBlock(doc:RichNode):RichNode {const next=prepareInlineDocument(resetInlineTemplate(doc));const ids=new Map<string,string>();const walk=(n:RichNode)=>{for(const m of n.marks??[])if(m.type==='templateField'){const old=m.attrs!.id;if(!ids.has(old))ids.set(old,`block_${crypto.randomUUID().replaceAll('-','')}`);m.attrs={...m.attrs,id:ids.get(old)};}if(n.attrs?.id)n.attrs.id=`block_${crypto.randomUUID().replaceAll('-','')}`;n.content?.forEach(walk);};walk(next);return initializeTemplateTracking(next);}
function insertBlock(id:string){const block=allBlocks().find(b=>b.id===id);if(!block)return;const selection=editor.state.selection;const content=compactTemplateTables(rekeyBlock(block.doc)).content??[];editor.chain().focus().insertContentAt({from:selection.from,to:selection.to},content).run();closeDialog();toast(`Добавлено описание «${block.title}».`);}
$('#block-list').onmousedown=e=>{if((e.target as HTMLElement).closest('button'))e.preventDefault();};
$('#block-list').onclick=e=>{const t=e.target as HTMLElement;const insert=t.closest<HTMLElement>('[data-insert-block]');if(insert){insertBlock(insert.dataset.insertBlock!);return;}const preview=t.closest<HTMLElement>('[data-preview-block]');if(preview)previewBlock(preview.dataset.previewBlock!);};
function previewBlock(id:string){const b=allBlocks().find(x=>x.id===id);if(!b)return;const pos=editor.state.selection;const content=prepareInlineDocument(b.doc);const previewEditor=makeEditor(document.createElement('div'),content,()=>{});const html=DOMPurify.sanitize(previewEditor.getHTML());previewEditor.destroy();const d=dialog(b.title,`<div class="block-preview report-content">${html}</div>`,`${b.custom?'<button class="btn danger" id="delete-block">Удалить</button><button class="btn" id="edit-block">Изменить</button>':''}<button class="btn" data-close>Закрыть</button><button class="btn primary" id="insert-preview-block">Вставить в описание</button>`);d.querySelector('#insert-preview-block')!.addEventListener('click',()=>{editor.commands.setTextSelection({from:pos.from,to:pos.to});insertBlock(id);});d.querySelector('#delete-block')?.addEventListener('click',()=>{const next=customBlocks.filter(x=>x.id!==id);try{localStorage.setItem(KEYS.blocks,JSON.stringify(next));customBlocks=next;renderBlocks();closeDialog();}catch{toast('Не удалось сохранить библиотеку.',true);}});d.querySelector('#edit-block')?.addEventListener('click',()=>blockDialog(b));}
$('#new-block').onclick=()=>{selectionForBlock=null;blockDialog();};
$('#save-selection').onmousedown=e=>e.preventDefault();
$('#save-selection').onclick=()=>{const s=editor.state.selection;if(s.empty){toast('Сначала выделите нужный фрагмент в описании.',true);return;}selectionForBlock={from:s.from,to:s.to};blockDialog();};
function blockDialog(existing?:Block){const selected=selectionForBlock?{type:'doc',content:editor.state.doc.cut(selectionForBlock.from,selectionForBlock.to).content!.toJSON()} as RichNode:undefined;const d=dialog(existing?'Изменить дополнительное описание':'Сохранить дополнительное описание',`<label>Название<input id="block-title" maxlength="150" value="${esc(existing?.title)}" placeholder="Например, киста эпифиза"></label><label>Ключевые слова<input id="block-tags" maxlength="500" value="${esc(existing?.tags)}" placeholder="эпифиз, киста, размеры"></label>${selected?'<div class="notice">Сохранится выделенный фрагмент вместе с форматированием.</div>':`<label>Текст описания<textarea id="block-text" rows="9" placeholder="Текст блока; поля обозначайте [[подсказкой]].">${esc(existing?plain(existing.doc):'')}</textarea></label><small>Для сохранения сложного форматирования выделите готовый фрагмент в основном документе и нажмите «Сохранить выделенное».</small>`}`,'<button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-block">Сохранить описание</button>');d.querySelector('#confirm-block')!.addEventListener('click',()=>{const title=($('#block-title') as HTMLInputElement).value.trim();if(!title){toast('Введите название.',true);return;}const compile=compiler(`block_${crypto.randomUUID().replaceAll('-','')}`);const body=selected??{type:'doc',content:(($('#block-text') as HTMLTextAreaElement).value).split('\n').map(t=>compile(t))};try{const block:Block={id:existing?.id??`custom_${crypto.randomUUID()}`,title,tags:($('#block-tags') as HTMLInputElement).value,areaId:selectedAreaId,doc:validateTemplate(promoteInlineTemplate(prepareInlineDocument(body))),custom:true};const next=[block,...customBlocks.filter(x=>x.id!==block.id)];localStorage.setItem(KEYS.blocks,JSON.stringify(next));customBlocks=next;selectionForBlock=null;renderBlocks();closeDialog();toast('Дополнительное описание сохранено.');}catch(e){toast(`Не удалось сохранить: ${(e as Error).message}`,true);}});}

function persistSettings(){try{localStorage.setItem(KEYS.settings,JSON.stringify(settings));return true;}catch{toast('Не удалось сохранить настройки. Изображение слишком велико для локального хранилища; используйте файл меньшего размера без уменьшения разрешения.',true);return false;}}
function settingsDialog(){const d=dialog('Врач и настройки',`<button type="button" class="btn" id="settings-expand-all" aria-expanded="false">Развернуть все</button><details class="settings-section" data-settings-section="appearance"><summary>Интерфейс</summary><div class="settings-section-body"><label>Тема<select id="interface-theme"><option value="light">Светлая</option><option value="dark">Тёмная</option><option value="amoled">AMOLED</option></select></label><p>Тема применяется сразу и сохраняется на этом компьютере. Оформление документа и экспорта сохраняется.</p></div></details><details class="settings-section" data-settings-section="doctor"><summary>Профиль врача</summary><div class="settings-section-body"><label>ФИО врача по умолчанию<input type="text" id="doctor-name" maxlength="200" value="${esc(settings.doctor)}" placeholder="Фамилия Имя Отчество" list="saved-doctors"><datalist id="saved-doctors">${settings.doctors.map(name=>`<option value="${esc(name)}">`).join('')}</datalist></label><label>Выбрать из сохранённых ФИО<div class="doctor-choice-row"><select id="saved-doctor-choice"><option value="">Выберите врача…</option>${settings.doctors.map(name=>`<option value="${esc(name)}" ${name===settings.doctor?'selected':''}>${esc(name)}</option>`).join('')}</select><button type="button" class="doctor-delete" id="delete-saved-doctor" title="Удалить врача и его печать" aria-label="Удалить врача и его печать" ${settings.doctors.length?'':'disabled'}>×</button></div></label><p>ФИО хранятся отдельно от личного словаря на этом компьютере. При сохранении новое имя добавляется в список; выберите нужное для текущей смены, и оно подставится в новые описания. В каждом документе поле врача можно изменить прямо в тексте.</p><label class="checkbox"><input type="checkbox" id="apply-doctor-now"> Вставить этого врача и в текущее описание</label><section class="doctor-profile-group"><h3>Подпись и печать врача</h3><div id="stamp-preview">${settings.doctorStamps[settings.doctor]?`<img src="${esc(settings.doctorStamps[settings.doctor])}" alt="Подпись и печать врача">`:'Для выбранного врача изображение ещё не добавлено.'}</div><button class="btn" id="upload-doctor-stamp">Загрузить PNG или JPG/JPEG без уменьшения (до 5 МБ)</button> <button class="btn" id="remove-doctor-stamp">Убрать подпись</button><label id="stamp-height-wrap">Высота печати при экспорте: <output id="stamp-height-value">140 px</output><input type="range" id="stamp-height" min="40" max="500" step="5" value="140"></label><label id="stamp-position-y-wrap">Положение сверху/снизу: <output id="stamp-position-y-value">0 px</output><input type="range" id="stamp-position-y" min="-200" max="200" step="5" value="0"></label><label id="stamp-position-x-wrap">Положение слева/справа: <output id="stamp-position-x-value">0 px</output><input type="range" id="stamp-position-x" min="-300" max="300" step="5" value="0"></label><p>Размер и положение печати сохраняются отдельно для каждого врача вместе с загруженным изображением и применяются при экспорте Word и PDF.</p></section><section class="doctor-profile-group"><h3>Оформление протоколов</h3><label>Размер шрифта всех шаблонов<select id="doctor-font-size">${TEMPLATE_FONT_SIZES.map(size=>`<option value="${size}">${size} pt</option>`).join('')}</select></label><p>Основной шрифт — Arial. Настройка применяется к новым встроенным протоколам МРТ и КТ. Открытые, сохранённые документы и пользовательские шаблоны сохраняют своё оформление.</p><button class="btn" type="button" id="reset-doctor-font">Восстановить Arial 11 pt</button><label class="checkbox"><input type="checkbox" id="optimize-print-pages"> Автоматически оптимизировать количество страниц при печати</label><p>Оптимизация изменяет только печатную копию. Размер отличается от базового не более чем на 1 pt; ручное форматирование сохраняется.</p><p id="doctor-format-error"></p></section></div></details><details class="settings-section" data-settings-section="history"><summary>История изменений</summary><div class="settings-section-body"><label>Глубина истории Undo/Redo<select id="history-depth">${REPORT_HISTORY_DEPTHS.map(depth=>`<option value="${depth}" ${settings.historyDepth===depth?'selected':''}>${depth} действий</option>`).join('')}</select></label><p>История хранится локально отдельно для каждого протокола. При повреждении истории текст документа сохраняется; доступными остаются Undo/Redo только для проверенных изменений.</p></div></details><details class="settings-section" data-settings-section="dictionary"><summary>Словари</summary><div class="settings-section-body"><button class="btn" id="dictionary-settings">Личный словарь</button><details><summary>Лицензии словаря</summary><pre class="licenses">${esc(russianProofreadingLicense+"\n\n"+fontLicense)}</pre></details></div></details>`,`<div class="settings-update-row"><span>Версия приложения: <b id="update-current-version">${esc(packageInfo.version)}</b></span><button class="btn" id="check-updates" ${window.desktop?'':'disabled'}>Обновить</button><small id="update-status" role="status" hidden></small></div><div class="settings-template-updates"><div class="settings-update-row"><span>Версия пакета шаблонов: <b id="template-catalog-version">Чтение…</b></span><button class="btn" id="template-catalog-check" disabled>Обновить</button></div><p id="template-catalog-status" role="status" hidden></p><div id="template-catalog-changes" aria-live="polite"></div></div><div class="settings-dialog-actions"><button class="btn" data-close>Отмена</button><button class="btn primary" id="save-settings">Сохранить</button></div>`);d.querySelector('.dialog')!.classList.add('doctor-settings-dialog');
const themeChoice=d.querySelector<HTMLSelectElement>('#interface-theme')!;themeChoice.value=settings.theme;themeChoice.onchange=()=>{settings.theme=normalizeTheme(themeChoice.value);persistSettings();applyTheme();};
const catalogSection=document.createElement('details');catalogSection.className='settings-section';catalogSection.dataset.settingsSection='medical-templates';
catalogSection.innerHTML='<summary>Медицинские шаблоны</summary><div class="settings-section-body"><p>Независимый каталог шаблонов, проверка обновлений и откат.</p><button class="btn" type="button" id="medical-template-settings">Управление шаблонами</button></div>';
templateUpdatesSettings(d,renderTemplates);
d.querySelector('.dialog-body')!.append(catalogSection);templatePublicationSettings(catalogSection.querySelector<HTMLElement>('.settings-section-body')!);catalogSection.querySelector('button')!.onclick=()=>templateUpdatesDialog(dialog,renderTemplates);
attachRecovery(d,()=>templateMode?'Открыт несохранённый шаблон. При сбросе его редакций текущая правка будет отменена; рабочий протокол сохранится.':changedSinceOpen,keys=>{if(templateMode&&keys.includes(KEYS.templates))finishTemplate(false);overrides=read(KEYS.templates,{});settings={...settings,...read<Partial<Settings>>(KEYS.settings,{})};doctorFormats=new DoctorFormats(localStorage,settings.doctors,settings.doctor);setDefaultReportHistoryDepth(settings.historyDepth);applyTheme();($('#zoom') as HTMLInputElement).value=String(settings.zoom);applyZoom(false);renderTemplates();document.dispatchEvent(new Event('xrs-settings-restored'));settingsDialog();const recovery=document.querySelector<HTMLDetailsElement>('[data-settings-section=recovery]');if(recovery)recovery.open=true;toast('Операция завершена. Доступно восстановление из резервной копии.');});
const sections=[...d.querySelectorAll<HTMLDetailsElement>('[data-settings-section]')];
const expandAll=d.querySelector<HTMLButtonElement>('#settings-expand-all')!;
const paintSections=()=>{
 const allOpen=sections.every(section=>section.open);
 expandAll.textContent=allOpen?'Свернуть все':'Развернуть все';
 expandAll.setAttribute('aria-expanded',String(allOpen));
};
expandAll.onclick=()=>{const open=sections.some(section=>!section.open);sections.forEach(section=>{section.open=open;});paintSections();};
sections.forEach(section=>section.addEventListener('toggle',paintSections));
const loadFormat=(name:string)=>{const f=doctorFormats?.get(name)??{fontSize:11,optimize:true};(d.querySelector('#doctor-font-size') as HTMLSelectElement).value=String(f.fontSize);(d.querySelector('#optimize-print-pages') as HTMLInputElement).checked=f.optimize;};loadFormat(settings.doctor);d.querySelector('#doctor-format-error')!.textContent=doctorFormatError;d.querySelector('#doctor-name')!.addEventListener('input',e=>loadFormat((e.target as HTMLInputElement).value));d.querySelector('#delete-saved-doctor')!.addEventListener('click',()=>queueMicrotask(()=>loadFormat((d.querySelector('#doctor-name') as HTMLInputElement).value)));d.querySelector('#reset-doctor-font')!.addEventListener('click',()=>{(d.querySelector('#doctor-font-size') as HTMLSelectElement).value='11';});void window.desktop?.getApplicationVersion().then(version=>{const label=d.querySelector<HTMLElement>('#update-current-version');if(label)label.textContent=version;}).catch(()=>{});d.querySelector('#saved-doctor-choice')!.addEventListener('change',e=>{
 const choice=e.currentTarget as HTMLSelectElement;
 if(!choice.value)return;
 const input=d.querySelector<HTMLInputElement>('#doctor-name')!;
 input.value=choice.value;input.dispatchEvent(new Event('input'));
});
d.querySelector('#delete-saved-doctor')!.addEventListener('click',()=>{const choice=d.querySelector('#saved-doctor-choice') as HTMLSelectElement;const name=choice.value;if(!name)return;if(!window.confirm(`Удалить врача «${name}» и его печать из сохранённых? Уже созданные описания не изменятся.`))return;const doctorId=doctorFormats?.get(name)?.id,deletedStampKey=doctorStampKey(name,doctorId);try{doctorFormats?.remove(name);}catch(error){toast((error as Error).message,true);return;}settings.doctors=settings.doctors.filter(saved=>saved.toLocaleLowerCase('ru')!==name.toLocaleLowerCase('ru'));delete settings.doctorStamps[deletedStampKey];delete settings.doctorStampSizes[deletedStampKey];delete settings.doctorStampHeights[deletedStampKey];delete settings.doctorStampPositions[deletedStampKey];if(doctorId&&settings.doctorStampOwners)delete settings.doctorStampOwners[doctorId];if(settings.doctor.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')){settings.doctor='';($('#doctor-name') as HTMLInputElement).value='';}choice.innerHTML='<option value="">Выберите врача…</option>'+settings.doctors.map(saved=>`<option value="${esc(saved)}">${esc(saved)}</option>`).join('');choice.value='';(d.querySelector('#delete-saved-doctor') as HTMLButtonElement).disabled=!settings.doctors.length;stampOwner='';(d.querySelector<HTMLInputElement>('#doctor-name')!).dispatchEvent(new Event('input'));if(!stampOwner){stampKey='';selectedStamp='';selectedStampSize={width:140,height:55};selectedStampHeight=140;selectedStampPosition={x:0,y:0};showStamp();}persistSettings();toast('Врач и связанная с ним печать удалены из сохранённых.');});let stampOwner=settings.doctor,stampKey=doctorStampKey(stampOwner);
let selectedStamp=settings.doctorStamps[stampKey]??'';
let selectedStampSize=settings.doctorStampSizes[stampKey]??{width:140,height:55};
let selectedStampHeight=settings.doctorStampHeights[stampKey]??140;
let selectedStampPosition={...settings.doctorStampPositions[stampKey]??{x:0,y:0}};
const showStamp=()=>{const preview=d.querySelector('#stamp-preview')!;preview.innerHTML=selectedStamp?`<img src="${esc(selectedStamp)}" alt="Подпись и печать врача" style="height:${selectedStampHeight}px;width:auto">`:'Для выбранного врача изображение ещё не добавлено.';const image=preview.querySelector('img') as HTMLImageElement|null;if(image)image.style.transform='none';const slider=d.querySelector<HTMLInputElement>('#stamp-height')!;slider.value=String(selectedStampHeight);d.querySelector('#stamp-height-value')!.textContent=`${selectedStampHeight} px`;d.querySelector<HTMLElement>('#stamp-height-wrap')!.hidden=!selectedStamp;const ySlider=d.querySelector<HTMLInputElement>('#stamp-position-y')!;ySlider.value=String(selectedStampPosition.y);d.querySelector('#stamp-position-y-value')!.textContent=`${selectedStampPosition.y} px`;d.querySelector<HTMLElement>('#stamp-position-y-wrap')!.hidden=!selectedStamp;const xSlider=d.querySelector<HTMLInputElement>('#stamp-position-x')!;xSlider.value=String(selectedStampPosition.x);d.querySelector('#stamp-position-x-value')!.textContent=`${selectedStampPosition.x} px`;d.querySelector<HTMLElement>('#stamp-position-x-wrap')!.hidden=!selectedStamp;};showStamp();d.querySelector('#doctor-name')!.addEventListener('input',e=>{
 const value=(e.currentTarget as HTMLInputElement).value.trim();
 if(value===stampOwner)return;
 stampOwner=value;stampKey=doctorStampKey(value);
 selectedStamp=settings.doctorStamps[stampKey]??'';selectedStampSize=settings.doctorStampSizes[stampKey]??{width:140,height:55};
 selectedStampHeight=settings.doctorStampHeights[stampKey]??140;
 selectedStampPosition={...settings.doctorStampPositions[stampKey]??{x:0,y:0}};showStamp();
});
($('#doctor-stamp-file') as HTMLInputElement).onchange=e=>{
 const input=e.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024){toast('Выберите файл PNG или JPG/JPEG размером до 5 МБ.',true);return;}
 const requestedOwner=stampOwner,reader=new FileReader();
 reader.onload=()=>{
  const value=String(reader.result),probe=new Image();
  probe.onload=()=>{
   if(!d.isConnected||requestedOwner!==stampOwner)return;
   if(probe.naturalWidth*probe.naturalHeight>40_000_000){toast('Изображение слишком большое по разрешению.',true);return;}
   selectedStamp=value;selectedStampSize={width:probe.naturalWidth,height:probe.naturalHeight};showStamp();
  };
  probe.onerror=()=>toast('Не удалось открыть файл изображения.',true);probe.src=value;
 };
 reader.readAsDataURL(file);
};
d.querySelector('#stamp-height')!.addEventListener('input',e=>{selectedStampHeight=Number((e.currentTarget as HTMLInputElement).value);showStamp();});d.querySelector('#stamp-position-y')!.addEventListener('input',e=>{selectedStampPosition.y=Number((e.currentTarget as HTMLInputElement).value);showStamp();});d.querySelector('#stamp-position-x')!.addEventListener('input',e=>{selectedStampPosition.x=Number((e.currentTarget as HTMLInputElement).value);showStamp();});d.querySelector('#upload-doctor-stamp')!.addEventListener('click',()=>($('#doctor-stamp-file') as HTMLInputElement).click());d.querySelector('#remove-doctor-stamp')!.addEventListener('click',()=>{selectedStamp='';showStamp();});d.querySelector('#dictionary-settings')!.addEventListener('click',dictionaryDialog);d.querySelector('#check-updates')!.addEventListener('click',()=>void checkForAppUpdates());d.querySelector('#save-settings')!.addEventListener('click',()=>{let savedDoctorId:string;try{if(!doctorFormats)doctorFormats=new DoctorFormats(localStorage,settings.doctors,settings.doctor);savedDoctorId=doctorFormats.save((d.querySelector('#doctor-name') as HTMLInputElement).value.trim(),Number((d.querySelector('#doctor-font-size') as HTMLSelectElement).value),(d.querySelector('#optimize-print-pages') as HTMLInputElement).checked).id;doctorFormatError='';}catch(error){d.querySelector('#doctor-format-error')!.textContent=(error as Error).message;return;}const previousSettings=structuredClone(settings),oldHistoryDepth=settings.historyDepth;const selectedDepth=Number(($('#history-depth') as HTMLSelectElement).value);settings.historyDepth=REPORT_HISTORY_DEPTHS.includes(selectedDepth as ReportHistoryDepth)?selectedDepth as ReportHistoryDepth:500;configureReportHistoryDepth(editor.view,settings.historyDepth);settings.doctor=($('#doctor-name') as HTMLInputElement).value.trim();if(settings.doctor){const stampKey=doctorStampKey(settings.doctor,savedDoctorId);const stampOwners=settings.doctorStampOwners??={};if(selectedStamp){stampOwners[savedDoctorId]=stampKey;settings.doctorStamps[stampKey]=selectedStamp;settings.doctorStampSizes[stampKey]=selectedStampSize;settings.doctorStampHeights[stampKey]=selectedStampHeight;settings.doctorStampPositions[stampKey]=selectedStampPosition;}else{delete stampOwners[savedDoctorId];delete settings.doctorStamps[stampKey];delete settings.doctorStampSizes[stampKey];delete settings.doctorStampHeights[stampKey];delete settings.doctorStampPositions[stampKey];}}if(settings.doctor&&!settings.doctors.some(name=>name.toLocaleLowerCase('ru')===settings.doctor.toLocaleLowerCase('ru')))settings.doctors.push(settings.doctor);const apply=($('#apply-doctor-now') as HTMLInputElement).checked;if(!persistSettings()){settings=previousSettings;configureReportHistoryDepth(editor.view,oldHistoryDepth);return;}saveLocal();if(apply){let range:{from:number;to:number;marks:any[]}|undefined;editor.state.doc.descendants((n,p)=>{const mark=n.marks.find(m=>m.type.name==='templateField'&&m.attrs.id===DOCTOR_FIELD_ID);if(mark&&n.isText){if(!range)range={from:p,to:p+n.nodeSize,marks:n.marks.map(m=>m.type.name==='templateField'?m.type.create({...m.attrs,filled:true}):m)};else range.to=p+n.nodeSize;}});if(range)editor.view.dispatch(editor.state.tr.replaceWith(range.from,range.to,editor.schema.text(settings.doctor||'Ф.И.О.',range.marks)));else toast('Поле врача не найдено в текущем документе. Имя сохранено для новых описаний.');}renderBrand();closeDialog();});}
async function checkForAppUpdates(){
 if(!window.desktop)return;
 try{
  const update=await window.desktop.checkForUpdates();
  const availableLabel=document.querySelector('#update-status');if(availableLabel){availableLabel.removeAttribute('hidden');availableLabel.textContent=`Последняя проверенная версия: ${update.version}${update.available?' — доступно обновление':''}.`;}
  if(!update.available){toast(`Обновлений нет. Установлена версия ${update.currentVersion}; последняя версия ${update.version}.`);return;}
  const d=dialog('Доступна новая версия X-ray Report Studio',`<div id="update-main"><p>Установлена версия <b>${esc(update.currentVersion)}</b>, доступна версия <b>${esc(update.version)}</b>.</p><p>Проверяются только сведения о версии; медицинские тексты и данные пациентов не отправляются.</p><p id="release-notes" hidden></p><div id="update-progress" class="update-progress hidden"><div class="update-progress-caption"><span id="update-progress-label">Подготовка загрузки…</span><b id="update-progress-percent">0%</b></div><div class="update-progress-track"><div id="update-progress-fill"></div></div><small id="update-progress-detail">Подключение к GitHub</small><details id="update-error-details" hidden><summary>Подробности ошибки</summary><pre id="update-error-text"></pre></details></div></div><section id="update-confirmation" class="update-confirmation" hidden aria-labelledby="update-confirmation-title"><p id="update-confirmation-title">Убедитесь, что все отчёты были сохранены локально.</p><p>Установить обновление сейчас?</p><div class="update-confirm-actions"><button class="btn" id="cancel-update-confirmation">Отмена</button><button class="btn primary" id="confirm-update-install">ОК</button></div></section>`,`<button class="btn" data-close>Позже</button><button class="btn" id="release-notes-button">Что нового</button><button class="btn primary" id="install-update">Установить обновление</button>`);
  d.querySelector('#release-notes-button')!.addEventListener('click',()=>{const notes=d.querySelector<HTMLElement>('#release-notes')!;notes.textContent=update.notes?.trim()||'Описание этой версии пока недоступно.';notes.hidden=false;});
  let installStarted=false;
  const footer=d.querySelector<HTMLElement>(':scope > .dialog > footer')!;
  d.querySelector('#install-update')!.addEventListener('click',()=>{
   d.querySelector<HTMLElement>('#update-main')!.hidden=true;
   footer.style.display='none';
   d.querySelector<HTMLElement>('#update-confirmation')!.hidden=false;
   d.querySelector<HTMLButtonElement>('#confirm-update-install')!.focus();
  });
  d.querySelector('#cancel-update-confirmation')!.addEventListener('click',()=>closeDialog());
  d.querySelector('#confirm-update-install')!.addEventListener('click',async()=>{
   if(installStarted)return;
   installStarted=true;
   const button=d.querySelector<HTMLButtonElement>('#confirm-update-install')!;
   if(!saveLocal()){installStarted=false;toast('Не удалось сохранить рабочее пространство. Обновление остановлено.',true);return;}
   button.disabled=true;
   editor.setEditable(false);button.disabled=true;button.textContent='Установка обновления…';
   d.querySelector<HTMLElement>('#update-confirmation')!.hidden=true;
   d.querySelector<HTMLElement>('#update-main')!.hidden=false;
   const progress=d.querySelector<HTMLElement>('#update-progress')!;progress.classList.remove('hidden');
   d.querySelector<HTMLElement>('#update-progress-percent')!.textContent='';
   d.querySelector<HTMLElement>('#update-progress-fill')!.classList.add('indeterminate');
   window.desktop!.onUpdateProgress(value=>{
    const label=d.querySelector<HTMLElement>('#update-progress-label')!,percent=d.querySelector<HTMLElement>('#update-progress-percent')!,detail=d.querySelector<HTMLElement>('#update-progress-detail')!,fill=d.querySelector<HTMLElement>('#update-progress-fill')!;
    const mb=(bytes:number)=>(bytes/1048576).toFixed(1)+' МБ';
    if(value.stage==='error'){label.textContent='Не удалось установить обновление';percent.textContent='';detail.textContent=value.phase?`Этап: ${value.phase}${value.code?` (${value.code})`:''}`:'Проверьте журнал обновлений';d.querySelector<HTMLElement>('#update-error-details')!.hidden=false;d.querySelector<HTMLElement>('#update-error-text')!.textContent=[value.message||'Причина не передана приложением.',value.logFile?`Журнал: ${value.logFile}`:''].filter(Boolean).join('\n');fill.classList.remove('indeterminate');fill.style.width='0';return;}
    if(value.stage==='downloading'){label.textContent='Загрузка пакета обновления';percent.textContent=value.percent===null?'':value.percent+'%';detail.textContent=value.total?`${mb(value.loaded)} из ${mb(value.total)}`:`Загружено ${mb(value.loaded)}`;fill.style.width=value.percent===null?'30%':value.percent+'%';fill.classList.toggle('indeterminate',value.percent===null);}
    else{const done=value.stage==='installed';fill.classList.toggle('indeterminate',!done);fill.style.width=done?'100%':'30%';percent.textContent=done?'100%':'';label.textContent=value.stage==='verifying'?'Подготовка':value.stage==='installing'?'Установка':value.stage==='restarting'?'Перезапуск':done?'Установка завершена':'Подготовка';detail.textContent=value.stage==='verifying'?'Проверяется контрольная сумма':value.stage==='installing'?'Подготавливаются файлы приложения':done?'Готово':'Дождитесь завершения этапа';}
   });
   try{await window.desktop!.installUpdate();const version=await window.desktop!.getApplicationVersion();const label=document.querySelector('#application-version');if(label)label.textContent=version;toast(`Приложение обновлено до версии ${version}.`);closeDialog();}
   catch(error){installStarted=false;editor.setEditable(true);button.disabled=false;button.textContent='ОК';d.querySelector<HTMLElement>('#update-confirmation')!.hidden=true;d.querySelector<HTMLElement>('#update-main')!.hidden=false;footer.style.display='';d.querySelector<HTMLElement>('#update-progress-label')!.textContent='Не удалось установить обновление';d.querySelector<HTMLElement>('#update-progress-detail')!.textContent='Текущая версия оставлена без изменений';d.querySelector<HTMLElement>('#update-error-details')!.hidden=false;d.querySelector<HTMLElement>('#update-error-text')!.textContent=(error as Error).message||'Установка остановлена по неизвестной причине.';toast('Не удалось установить обновление. Текущая версия оставлена без изменений.',true);}
   finally{window.desktop!.clearUpdateProgress();}
  });
 }catch(error){toast(`Не удалось проверить обновления: ${(error as Error).message}`,true);}
}
document.addEventListener('xrs-local-templates-reconciled',()=>{overrides=read(KEYS.templates,{});renderTemplates();});
$('#settings').onclick=settingsDialog;$('#brand-settings').onclick=settingsDialog;


function dictionaryDialog(){
 const storageInfo=window.desktop?(sharedDictionaryAvailable?'Словарь хранится отдельно от приложения в общей папке и доступен пользователям с правом записи. Он не удаляется при обновлении приложения.':'Общая папка недоступна: словарь сохранится в профиле Windows текущего пользователя.'):'Слова сохраняются в браузере на этом компьютере.';
 const d=dialog('Личный словарь',`<p>${esc(storageInfo)} Встроенные медицинские словари хранятся отдельно. Здесь можно добавить и удалить свои термины. Удаление применяется только к вашему личному словарю.</p><label>Русские и английские слова — по одному слову в строке<textarea id="personal-words" rows="10">${esc(personalWords.join('\n'))}</textarea></label><small>До 20 000 слов; кириллица, латиница и дефис.</small>`,'<button class="btn" data-close>Отмена</button><button class="btn primary" id="save-dictionary">Сохранить и объединить</button>');
 d.querySelector('#save-dictionary')!.addEventListener('click',async()=>{const words=[...new Set(($('#personal-words') as HTMLTextAreaElement).value.split(/\s+/).filter(Boolean).map(s=>s.toLocaleLowerCase('ru')))];if(words.length>20000||words.some(w=>!/^[а-яёa-z-]{2,80}$/i.test(w))){toast('Допустимо до 20 000 русских или английских слов из букв и дефисов.',true);return;}try{for(const old of personalWords)if(!words.includes(old))removedDictionaryWords.add(old);for(const word of words)removedDictionaryWords.delete(word);localStorage.setItem('xrs.dictionary.removed.v1',JSON.stringify([...removedDictionaryWords]));let merged=words;if(window.desktop){const result=await window.desktop.dictionaryMergeSave(words);merged=filterPersonalWords(result.words);sharedDictionaryAvailable=result.shared;}localStorage.setItem(KEYS.dictionary,JSON.stringify(merged));personalWords=merged;document.dispatchEvent(new Event('xrs-dictionary-changed'));closeDialog();refreshProofreading(editor);toast('Словарь сохранён и объединён с общими словами.');}catch(error){toast(dictionarySaveError(error),true);}});
}

document.querySelectorAll<HTMLElement>('[data-command]').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>{const c=editor.chain().focus(),name=b.dataset.command;if(name==='undo'){runHistoryCommand('undo');return;}if(name==='redo'){runHistoryCommand('redo');return;}if(name==='bold')c.toggleBold().run();else if(name==='italic')c.toggleItalic().run();else if(name==='underline')c.toggleUnderline().run();else if(name==='strike')c.toggleStrike().run();};});
bindFormatToolbar(editor, document.querySelector<HTMLElement>('.ribbon')!);
$('#font-family').onchange=()=>editor.chain().focus().setFontFamily(($('#font-family') as HTMLSelectElement).value).run();
$('#font-size').onchange=()=>{const value=Number(($('#font-size') as HTMLSelectElement).value);setReportFontSize(editor,value);};
$('#text-color').oninput=()=>editor.chain().focus().setColor(($('#text-color') as HTMLInputElement).value).run();
$('#line-height').onchange=()=>setParagraphLineHeight(editor,Number(($('#line-height') as HTMLSelectElement).value));
function updateRibbon(){document.querySelectorAll<HTMLElement>('[data-command]').forEach(b=>{b.classList.toggle('active',editor.isActive(b.dataset.command!));if(b.dataset.command==='undo') (b as HTMLButtonElement).disabled=!canUndoReport(editor.state);if(b.dataset.command==='redo') (b as HTMLButtonElement).disabled=!canRedoReport(editor.state);});const paragraphAttrs=editor.getAttributes('paragraph');if(paragraphAttrs.lineHeight){const select=$('#line-height') as HTMLSelectElement;const value=String(paragraphAttrs.lineHeight);if([...select.options].some(option=>option.value===value))select.value=value;}const attrs=editor.getAttributes('textStyle');if(attrs.fontFamily)($('#font-family') as HTMLSelectElement).value=attrs.fontFamily;const size=selectionFontSize(editor.state),select=$('#font-size') as HTMLSelectElement;select.querySelectorAll('[data-dynamic-font]').forEach(o=>o.remove());const value=size==='mixed'?'':String(size);if(![...select.options].some(o=>o.value===value)){const option=new Option(size==='mixed'?'Смешанный':String(size),value);option.dataset.dynamicFont='true';select.prepend(option);}select.value=value;}
$('#table-tools').onclick=()=>{const inTable=editor.isActive('table');const d=dialog('Таблица',inTable?'<div class="table-actions"><button class="btn" data-table="row">Добавить строку</button><button class="btn" data-table="col">Добавить столбец</button><button class="btn" data-table="remove-row">Удалить строку</button><button class="btn danger" data-table="remove">Удалить таблицу</button></div>':'<label>Строк<input type="number" id="table-rows" value="3" min="1" max="30"></label><label>Столбцов<input type="number" id="table-cols" value="2" min="1" max="8"></label>',inTable?'<button class="btn" data-close>Закрыть</button>':'<button class="btn" data-close>Отмена</button><button class="btn primary" id="insert-table">Вставить</button>');d.querySelector('#insert-table')?.addEventListener('click',()=>{const rows=Math.min(30,Math.max(1,Number(($('#table-rows') as HTMLInputElement).value)||3)),cols=Math.min(8,Math.max(1,Number(($('#table-cols') as HTMLInputElement).value)||2));closeDialog();editor.chain().focus().insertTable({rows,cols,withHeaderRow:true}).run();});d.querySelectorAll<HTMLElement>('[data-table]').forEach(b=>b.onclick=()=>{const c=editor.chain().focus(),a=b.dataset.table;if(a==='row')c.addRowAfter().run();if(a==='col')c.addColumnAfter().run();if(a==='remove-row')c.deleteRow().run();if(a==='remove')c.deleteTable().run();closeDialog();});};

let fontDataPromise:Promise<{name:string;data:Uint8Array;bold:Uint8Array;italic:Uint8Array;boldItalic:Uint8Array}[]>|undefined;
function embeddedFonts(){
  const load=async(url:string)=>url.startsWith('data:')?Uint8Array.from(atob(url.slice(url.indexOf(',')+1)),c=>c.charCodeAt(0)):new Uint8Array(await(await fetch(url)).arrayBuffer());
  return fontDataPromise??=Promise.all([regularFont,boldFont,italicFont,boldItalicFont].map(load)).then(([data,bold,italic,boldItalic])=>[{name:'DejaVu Sans',data,bold,italic,boldItalic}]);
}
function clearProofPopup(){$('.proof-popup')?.remove();}
function proofPopup(event:MouseEvent){if((event.target as HTMLElement).closest('[data-ai-review-ids]'))return;const target=(event.target as HTMLElement).closest<HTMLElement>('[data-proof-id]');if(!target)return;if(event.type==='contextmenu')event.preventDefault();const pos=editor.view.posAtCoords({left:event.clientX,top:event.clientY});if(!pos)return;const hit=getLiveProofIssueAtPosition(editor,pos.pos);if(!hit)return;clearProofPopup();const doc=editor.state.doc;const popup=document.createElement('div');popup.className='proof-popup';popup.setAttribute('role','dialog');popup.innerHTML=`<small>${hit.issue.kind==='spelling'?'Орфография':'Грамматика и пунктуация'}</small><p>${esc(hit.issue.message)}</p><div>${hit.issue.suggestions.map((s,i)=>`<button class="btn small" data-correction="${i}">${esc(s)}</button>`).join('')||'<span>Отредактируйте слово вручную.</span>'}</div>${hit.issue.kind==='spelling'?'<button class="btn small" id="allow-word">Добавить в словарь</button>':''}<button class="close-popup" aria-label="Закрыть">×</button>`;document.body.append(popup);popup.style.left=`${Math.min(event.clientX,window.innerWidth-340)}px`;popup.style.top=`${Math.min(event.clientY+14,window.innerHeight-popup.offsetHeight-12)}px`;popup.querySelector('.close-popup')!.addEventListener('click',clearProofPopup);popup.querySelectorAll<HTMLElement>('[data-correction]').forEach(b=>b.onclick=()=>{if(!doc.eq(editor.state.doc)){clearProofPopup();refreshProofreading(editor);return;}editor.view.dispatch(editor.state.tr.insertText(hit.issue.suggestions[Number(b.dataset.correction)],hit.from,hit.to));clearProofPopup();refreshProofreading(editor);});popup.querySelector('#allow-word')?.addEventListener('click',()=>{const words=[...new Set([...personalWords,hit.issue.text.toLocaleLowerCase('ru')])];try{localStorage.setItem(KEYS.dictionary,JSON.stringify(words));personalWords=words;clearProofPopup();refreshProofreading(editor);}catch{toast('Не удалось сохранить слово.',true);}});}
editor.view.dom.addEventListener('contextmenu',proofPopup);
document.addEventListener('mousedown',e=>{if(!(e.target as HTMLElement).closest('.proof-popup,[data-proof-id]'))clearProofPopup();});

function filename(suffix:string){
 const fields=collectInlineFields(json());
 const usable=(field:ReturnType<typeof collectInlineFields>[number]|undefined)=>field?.filled?field.value.trim():'';
 const parsed=extractFilenameFields(editor.getText({blockSeparator:'\n'}));
 const number=parsed.number||usable(fields.find(f=>f.id.endsWith('.number')));
 const doctor=parsed.doctor||usable(fields.find(f=>f.id===DOCTOR_FIELD_ID))||settings.doctor;
 const patient=parsed.patient||usable(fields.find(f=>f.id===PATIENT_FIELD_ID||f.id.endsWith('.patient')||f.id==='base.1'));
 const reportDate=parsed.date||usable(fields.find(f=>f.id.endsWith('.reportdate')))||new Date().toLocaleDateString('ru-RU');
 const title=reportTitle(activeTemplateId,json());
 return buildReportFilename({number,doctor,patient,template:title,date:reportDate},suffix as '.docx'|'.pdf',new Date().toLocaleDateString('ru-RU'));
}
const pendingWordSaves=new Map<string,{id:string;snapshot:string}>();
function markReportExported(id:string,snapshot:string){const report=openReports.find(r=>r.id===id);if(!report)return;const current=id===activeReportId?json():report.doc;if(JSON.stringify(current)!==snapshot)return;report.dirty=false;if(id===activeReportId)changedSinceOpen=false;saveLocal();renderReportTabs();}
window.desktop?.onWordSaved?.(url=>{const pending=pendingWordSaves.get(url);if(pending){pendingWordSaves.delete(url);markReportExported(pending.id,pending.snapshot);}});
function download(blob:Blob,name:string,savedReport?:{id:string;snapshot:string}){const url=URL.createObjectURL(blob),a=document.createElement('a');if(savedReport&&window.desktop)pendingWordSaves.set(url,savedReport);a.href=url;a.download=name;a.click();if(savedReport&&!window.desktop)markReportExported(savedReport.id,savedReport.snapshot);setTimeout(()=>{URL.revokeObjectURL(url);pendingWordSaves.delete(url);},300000);}
function confirmYellowExport(continueExport:()=>void){if(!hasYellowFields(json()))return true;const d=dialog('В описании осталась жёлтая заливка','<p class="yellow-export-warning-text">Остались незаполненные поля или фрагменты с жёлтой заливкой. Они попадут в сохранённый документ.</p><p>Проверьте описание или сохраните текущий вариант.</p>','<button class="btn" data-close>Вернуться к описанию</button><button class="btn primary" id="continue-yellow-export">Сохранить всё равно</button>');d.querySelector('.dialog')!.classList.add('yellow-export-warning');d.querySelector('#continue-yellow-export')!.addEventListener('click',()=>{closeDialog();continueExport();});return false;}
async function saveWord(confirmed=false,originalLayout=false){if(!confirmed&&!confirmYellowExport(()=>void saveWord(true)))return;const button=$('#save-docx') as HTMLButtonElement;if(button.disabled)return;button.disabled=true;try{if(!templateMode)saveLocal();const savedReport={id:activeReportId,snapshot:JSON.stringify(json())};const plan=templateMode||originalLayout?undefined:await getReportPrintPlan();if(savedReport.id!==activeReportId||savedReport.snapshot!==JSON.stringify(json()))throw new Error('Документ изменился во время подготовки сохранения. Повторите сохранение.');const doc=plan?attachDoctorStamp(plan.document,settings.doctorStamps,settings.doctorStampSizes,settings.doctorStampHeights,settings.doctorStampPositions):exportDocument(),name=filename('.docx');const fonts=await embeddedFonts();const blob=await exportDocx(doc,{profile:profileForTemplate(),templateId:activeTemplateId,fonts,printBox:plan?.box,releaseDescriptionKeep:plan?.releaseDescriptionKeep,kind:templateMode?'template':'report'});download(blob,name,savedReport);toast('Документ Word подготовлен для сохранения.');}catch(e){if(e instanceof PrintLayoutError&&!originalLayout)showPrintLimitation(e);else toast(`Не удалось сохранить Word: ${(e as Error).message}`,true);}finally{button.disabled=false;}}
const saveMenu=$('#save-menu-items');const saveMenuToggle=$('#save-menu-toggle');
function closeSaveMenu(){saveMenu.hidden=true;saveMenuToggle.setAttribute('aria-expanded','false');}
saveMenuToggle.onclick=()=>{saveMenu.hidden=!saveMenu.hidden;saveMenuToggle.setAttribute('aria-expanded',String(!saveMenu.hidden));};
document.addEventListener('click',event=>{if(!(event.target as HTMLElement).closest('.save-menu'))closeSaveMenu();});
saveMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){closeSaveMenu();saveMenuToggle.focus();event.stopPropagation();}});
$('#save-docx').onclick=()=>{closeSaveMenu();void saveWord();};$('#open-report').onclick=()=>($('#report-file') as HTMLInputElement).click();
$('#export-template-docx').onclick=async()=>{
 if(templateMode){toast('Сначала завершите редактирование текущего шаблона.',true);return;}
 try{
  const template=reportTemplates.find(item=>item.id===activeTemplateId);if(!template)throw new Error('Шаблон не найден.');
  const doc=overrides[activeTemplateId]??makeTemplateDocument(activeTemplateId),fonts=await embeddedFonts();
  const blob=await exportTemplateDocx({...template,templateVersion:currentTemplateVersion(template.id),doc},packageInfo.version,fonts);
  const safeName=template.title.replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim()||activeTemplateId;
  download(blob,`${safeName}.docx`);toast(`Шаблон «${template.title}» экспортирован в Word.`);
 }catch(error){toast(`Не удалось экспортировать шаблон: ${(error as Error).message}`,true);}
};
$('#import-template-docx').onclick=()=>{if(templateMode){toast('Сначала завершите редактирование шаблона.',true);return;}($('#template-file') as HTMLInputElement).click();};
$('#template-file').onchange=async event=>{
 const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;
 try{
  if(file.size>20_000_000)throw new Error('Максимальный размер файла 20 МБ.');
  const inspectedState=localStorage.getItem(KEYS.templates);
  const imported=await inspectTemplateDocx(file,packageLibrary());
  if(imported.status==='conflict')throw new Error('Конфликт исходной версии шаблона. Экспортируйте актуальный DOCX заново.');
  if(imported.status==='unchanged'){toast('DOCX не содержит изменений шаблона.');return;}
  const templateId=imported.id,template=reportTemplates.find(item=>item.id===templateId)!;
  const candidate=validateTemplate(promoteInlineTemplate(imported.after));
  const old=overrides[templateId]??makeTemplateDocument(templateId);
  editor.schema.nodeFromJSON(candidate).check();
  const oldText=plain(old),newText=plain(candidate);
  const count=(doc:RichNode,type:string)=>{let n=0;const visit=(node:RichNode)=>{if(node.type===type)n++;node.content?.forEach(visit);};visit(doc);return n;};
  const countYellow=(doc:RichNode)=>{let n=0;const visit=(node:RichNode)=>{n+=(node.marks??[]).filter(mark=>mark.type==='highlight'&&String(mark.attrs?.color??'').toLowerCase()==='#ffff00').length;node.content?.forEach(visit);};visit(doc);return n;};
  const previewHtml=(doc:RichNode)=>{const host=document.createElement('div'),previewEditor=makeEditor(host,prepareInlineDocument(doc),()=>{});const html=DOMPurify.sanitize(previewEditor.getHTML());previewEditor.destroy();return html;};
  const warnings=[...(imported.warnings??[])];
  const d=dialog(`Предпросмотр шаблона «${template.title}»`,
   `<p>Проверьте содержимое и форматирование до замены. Существующие протоколы пациентов не изменяются.</p><p>Абзацы: ${count(old,'paragraph')} → ${count(candidate,'paragraph')}; таблицы: ${count(old,'table')} → ${count(candidate,'table')}; жёлтые фрагменты: ${countYellow(old)} → ${countYellow(candidate)}.</p>${warnings.length?`<div class="notice">${warnings.map(esc).join('<br>')}</div>`:'<div class="notice">Неподдерживаемых элементов Word не обнаружено.</div>'}<div class="template-import-diff"><section><h3>Текущий шаблон</h3><div class="report-content">${previewHtml(old)}</div><pre>${esc(oldText)}</pre></section><section><h3>Версия из Word</h3><div class="report-content">${previewHtml(candidate)}</div><pre>${esc(newText)}</pre></section></div>`,
   '<button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-template-import">Создать резервную копию и заменить шаблон</button>');
  d.querySelector('.dialog')!.classList.add('wide-preview');
  d.querySelector('#confirm-template-import')!.addEventListener('click',()=>{
   const backupKey='mri-alliance.template-backups.v1',previousTemplates=localStorage.getItem(KEYS.templates),previousVersions=localStorage.getItem(KEYS.templateVersions),oldVersion=currentTemplateVersion(templateId),newVersion=nextTemplateVersion(oldVersion),backupRecord={id:crypto.randomUUID(),templateId,templateTitle:template.title,templateVersion:oldVersion,sourceSha256:imported.sourceSha256,baseSha256:imported.baseSha256,createdAt:new Date().toISOString(),doc:old};
   try{
    if(localStorage.getItem(KEYS.templates)!==inspectedState)throw new Error('Шаблон изменился после предпросмотра. Повторите импорт.');
    const oldBackups=localStorage.getItem(backupKey),backups=oldBackups?JSON.parse(oldBackups):[];
    if(!Array.isArray(backups))throw new Error('Повреждено хранилище резервных копий шаблонов.');
    const nextBackups=[...backups,backupRecord];localStorage.setItem(backupKey,JSON.stringify(nextBackups));
    const verified=JSON.parse(localStorage.getItem(backupKey)??'null');
    if(!Array.isArray(verified)||JSON.stringify(verified.at(-1))!==JSON.stringify(backupRecord))throw new Error('Не удалось проверить резервную копию исходного шаблона.');
    const nextOverrides={...overrides,[templateId]:candidate};localStorage.setItem(KEYS.templates,JSON.stringify(nextOverrides));
    const saved=JSON.parse(localStorage.getItem(KEYS.templates)??'null');
    if(!saved||JSON.stringify(saved[templateId])!==JSON.stringify(candidate))throw new Error('Не удалось проверить сохранённый шаблон.');
    localStorage.setItem(KEYS.templateVersions,JSON.stringify({...readTemplateVersions(localStorage),[templateId]:newVersion}));
    if(readTemplateVersion(localStorage,templateId,INITIAL_TEMPLATE_VERSION)!==newVersion)throw new Error('Не удалось проверить версию шаблона.');
    overrides=nextOverrides;renderTemplates();closeDialog();toast(`Шаблон «${template.title}» заменён. Резервная копия сохранена локально.`);
   }catch(error){
    if(previousTemplates===null)localStorage.removeItem(KEYS.templates);else try{localStorage.setItem(KEYS.templates,previousTemplates);}catch{}
    if(previousVersions===null)localStorage.removeItem(KEYS.templateVersions);else try{localStorage.setItem(KEYS.templateVersions,previousVersions);}catch{}
    toast(`Импорт отменён: ${(error as Error).message}. Исходный шаблон сохранён.`,true);
   }
  });
 }catch(error){toast(`Не удалось импортировать шаблон: ${(error as Error).message}`,true);}
};
$('#restore-template-backup').onclick=()=>{
 const backupKey='mri-alliance.template-backups.v1';let backups:unknown[];
 try{backups=JSON.parse(localStorage.getItem(backupKey)??'[]');if(!Array.isArray(backups))throw new Error();}catch{toast('Не удалось прочитать резервные копии шаблонов.',true);return;}
 const current=backups.map((entry,index)=>({entry,index})).filter(({entry})=>entry&&typeof entry==='object'&&typeof (entry as any).templateId==='string'&&reportTemplates.some(t=>t.id===(entry as any).templateId)&&Boolean((entry as any).doc?.type==='doc'));
 if(!current.length){dialog('Резервные копии шаблонов','<p>Пока нет сохранённых копий шаблонов.</p>','<button class="btn" data-close>Закрыть</button>');return;}
 const markup=current.slice().reverse().map(({entry,index})=>{const item=entry as any;return `<div class="template-backup-row"><div><strong>${esc(item.templateTitle??item.templateId)}</strong><small>${esc(item.createdAt??'Дата неизвестна')}</small></div><button class="btn" data-restore-template-backup="${index}">Восстановить</button></div>`;}).join('');
 const d=dialog('Резервные копии шаблонов',`<p>Перед восстановлением текущая версия также будет сохранена отдельной копией.</p>${markup}`,'<button class="btn" data-close>Закрыть</button>');
 d.querySelectorAll<HTMLElement>('[data-restore-template-backup]').forEach(button=>button.addEventListener('click',()=>{
  const item=backups[Number(button.dataset.restoreTemplateBackup)] as any,template=reportTemplates.find(t=>t.id===item?.templateId);if(!template)return;
  let restored:RichNode;try{restored=validateTemplate(item.doc);}catch(error){toast(`Резервная копия повреждена: ${(error as Error).message}`,true);return;}
  const confirmDialog=dialog(`Восстановить «${template.title}»?`,'<p>Текущий вариант будет сохранён как резервная копия. Протоколы пациентов не изменяются.</p>','<button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-template-backup-restore">Сохранить копию и восстановить</button>');
  confirmDialog.querySelector('#confirm-template-backup-restore')!.addEventListener('click',()=>{
   const previousTemplates=localStorage.getItem(KEYS.templates),previousVersions=localStorage.getItem(KEYS.templateVersions),oldVersion=currentTemplateVersion(item.templateId);
   try{const now=overrides[item.templateId]??makeTemplateDocument(item.templateId),record={id:crypto.randomUUID(),templateId:item.templateId,templateTitle:template.title,templateVersion:oldVersion,createdAt:new Date().toISOString(),doc:now};const next=[...backups,record];localStorage.setItem(backupKey,JSON.stringify(next));const checked=JSON.parse(localStorage.getItem(backupKey)??'null');if(!Array.isArray(checked)||JSON.stringify(checked.at(-1))!==JSON.stringify(record))throw new Error('Не удалось проверить резервную копию текущей версии.');const nextOverrides={...overrides,[item.templateId]:restored};localStorage.setItem(KEYS.templates,JSON.stringify(nextOverrides));const saved=JSON.parse(localStorage.getItem(KEYS.templates)??'null');if(JSON.stringify(saved?.[item.templateId])!==JSON.stringify(restored))throw new Error('Не удалось проверить восстановленный шаблон.');const newVersion=nextTemplateVersion(oldVersion);localStorage.setItem(KEYS.templateVersions,JSON.stringify({...readTemplateVersions(localStorage),[item.templateId]:newVersion}));if(readTemplateVersion(localStorage,item.templateId,INITIAL_TEMPLATE_VERSION)!==newVersion)throw new Error('Не удалось проверить версию восстановленного шаблона.');overrides=nextOverrides;renderTemplates();closeDialog();toast(`Шаблон «${template.title}» восстановлен как версия ${newVersion}.`);}catch(error){if(previousTemplates===null)localStorage.removeItem(KEYS.templates);else try{localStorage.setItem(KEYS.templates,previousTemplates);}catch{}if(previousVersions===null)localStorage.removeItem(KEYS.templateVersions);else try{localStorage.setItem(KEYS.templateVersions,previousVersions);}catch{}toast(`Восстановление отменено: ${(error as Error).message}`,true);}
  });
 }));
};
function showPrintLimitation(error:Error){const d=dialog('Ограничение печатной раскладки',`<p>${esc(error.message)}</p><p>Исходный документ сохранён без изменений. Можно сохранить полный DOCX с исходным оформлением; переносы этого файла необходимо проверить в Word.</p>`,'<button class="btn" data-close>Закрыть</button><button class="btn primary" id="save-original-layout">Сохранить исходный DOCX</button>');d.querySelector('#save-original-layout')!.addEventListener('click',()=>{closeDialog();void saveWord(true,true);});}
$('#report-file').onchange=async event=>{
 const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;
 try{
  if(file.size>20_000_000)throw new Error('Максимальный размер файла 20 МБ.');
  if(templateMode)throw new Error('Завершите редактирование шаблона.');
  let doc:RichNode,templateId=activeTemplateId,warnings:string[]=[];
  let requiresReview=false;
  if(file.name.toLowerCase().endsWith('.docx')){
   const bytes=await file.arrayBuffer();let imported:Awaited<ReturnType<typeof importOwnDocx>>=null;
   try{imported=await importOwnDocx(bytes);}catch{requiresReview=true;}
   if(imported?.kind==='template')throw new Error('Файл является шаблоном. Используйте «Импортировать шаблон из Word» для проверки и резервирования.');
   if(imported){doc=imported.doc;warnings=imported.importWarnings??[];if(imported.templateId&&reportTemplates.some(t=>t.id===imported.templateId))templateId=imported.templateId;requiresReview ||= warnings.length>0;}
   else {const recovered=await recoverDocx(bytes);doc=recovered.doc;warnings=recovered.warnings;requiresReview=true;}
  }else doc=validateDraft(JSON.parse(await file.text())).doc;
  const recoveredStructure=recoverParagraphBlocks(doc);
  if(recoveredStructure.changed){requiresReview=true;warnings.push('Восстановлена несовместимая вложенность блоков в абзацах. Проверьте расположение изображений и таблиц в отдельной копии.');}
  const prepared=prepareInlineDocument(recoveredStructure.doc);editor.schema.nodeFromJSON(prepared).check();
  const open=()=>{if(templateMode)return;activeTemplateId=templateId;selectedAreaId=reportTemplates.find(t=>t.id===templateId)!.areaId;renderTemplates();createReportTab(templateId,prepared);closeDialog();toast('Документ открыт в отдельной вкладке.');};
  if(!requiresReview){open();return;}
  const previewHost=document.createElement('div'),previewEditor=makeEditor(previewHost,prepared,()=>{});
  const previewHtml=DOMPurify.sanitize(previewEditor.getHTML());previewEditor.destroy();
  const body=`<p>Перед открытием проверьте восстановленный документ. Он будет открыт в новой вкладке; уже открытые протоколы сохранятся.</p>${warnings.map(message=>`<div class="notice">${esc(message)}</div>`).join('')}<div class="block-preview report-content">${previewHtml}</div>`;
  const preview=dialog('Проверка протокола Word',body,'<button class="btn" data-close>Отмена</button><button class="btn primary" id="confirm-recovered-report">Открыть в новой вкладке</button>');
  preview.querySelector('.dialog')!.classList.add('wide-preview');preview.querySelector('#confirm-recovered-report')!.addEventListener('click',open);
 }catch(error){toast(`Не удалось открыть документ: ${(error as Error).message}`,true);}
};
$('#copy-for-ai').onclick=()=>{
  let initial:string;try{initial=medicalTextForCopy(json());}catch(error){toast((error as Error).message,true);return;}
  const preview=dialog('Копировать медицинский текст для ИИ',`<textarea id="ai-copy-text" rows="16" spellcheck="false" style="width:100%;box-sizing:border-box">${esc(initial)}</textarea><p id="ai-copy-warning" role="status"></p><p id="ai-copy-privacy" style="font-size:15px;font-weight:600;color:var(--text);line-height:1.5">Внимание! Перед копированием убедитесь, что медицинский текст не содержит персональных данных пациента. Проверьте и при необходимости удалите такие сведения. Автоматическое обезличивание не гарантирует полного удаления персональных данных.</p>`,'<button class="btn" data-close>Отмена</button><button class="btn primary" id="ai-copy-commit" type="button">Копировать текст</button>');
  const field=preview.querySelector<HTMLTextAreaElement>('#ai-copy-text')!,warning=preview.querySelector<HTMLElement>('#ai-copy-warning')!;
  const check=()=>{const found=personalDataWarnings(field.value);warning.textContent=found.length?`Потенциальные персональные данные: ${found.join(', ')}. Удалите их перед копированием.`:'';return found.length===0;};
  field.addEventListener('input',check);check();
  preview.querySelector('#ai-copy-commit')!.addEventListener('click',async()=>{
    if(!check()){toast('Удалите найденные персональные данные перед копированием.',true);return;}
    if(window.desktop&&typeof window.desktop.copyPlainText!=='function'){
      warning.textContent='Системная часть XRS ещё работает от предыдущей версии. Сохраните отчёты и подготовленный текст, затем полностью закройте XRS и запустите её через обновлённый ярлык.';return;
    }
    try{if(window.desktop)await window.desktop.copyPlainText(field.value);else await navigator.clipboard.writeText(field.value);closeDialog();toast('Проверенный текст скопирован без форматирования.');}catch{toast('Буфер обмена недоступен. Текст не скопирован. Предпросмотр сохранён.',true);}
  });
};
$('#copy-report').onclick=async()=>{const box=document.createElement('div');box.innerHTML=DOMPurify.sanitize(editor.getHTML());box.querySelectorAll<HTMLElement>('[data-template-field]').forEach(el=>{el.style.backgroundColor=el.classList.contains('is-empty')?'#fff0a4':'transparent';});const html=`<html><body><style>body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.05}p{margin:0 0 5pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px}</style>${box.innerHTML}</body></html>`;try{if(window.desktop)await window.desktop.copyReport(html,editor.getText());else await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([editor.getText()],{type:'text/plain'})})]);toast('Описание скопировано с форматированием.');}catch{toast('Выделите текст и скопируйте его сочетанием Ctrl+C.',true);}};
let pdfExportInProgress=false;
async function printPDF(confirmed=false){
 if(pdfExportInProgress)return;
 if(!confirmed&&!confirmYellowExport(()=>void printPDF(true)))return;
 pdfExportInProgress=true;
 const savedReport={id:activeReportId,snapshot:JSON.stringify(json())};
 closeDialog();clearProofPopup();await new Promise<void>(r=>requestAnimationFrame(()=>r()));
 let cleanupExport:(()=>void)|undefined;
 try{const plan=await getReportPrintPlan();if(savedReport.id!==activeReportId||savedReport.snapshot!==JSON.stringify(json()))throw new Error('Документ изменился во время подготовки PDF. Повторите сохранение.');cleanupExport=mountExportEditor(plan.html);await document.fonts.ready;if(window.desktop){const r=await window.desktop.exportPDF(filename('.pdf'));if(!r.canceled){markReportExported(savedReport.id,savedReport.snapshot);toast('PDF сохранён.');}}else{const old=document.title;document.title=filename('');try{window.print();}finally{document.title=old;}}}catch(e){toast(`Не удалось сохранить PDF: ${(e as Error).message}`,true);}finally{cleanupExport?.();pdfExportInProgress=false;}}
$('#export-pdf').onclick=()=>{closeSaveMenu();void printPDF();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSaveMenu();closeDialog();clearProofPopup();$('.sidebar').classList.remove('open');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(templateMode)finishTemplate(true);else {closeSaveMenu();void saveWord();}}if(e.key==='F2'){e.preventDefault();nextField();}});
window.addEventListener('beforeunload',()=>{if(!templateMode)saveLocal();});
($('#modality-select') as HTMLSelectElement).value=modalityForTemplate();renderTemplates();renderBlocks();renderCounts();renderReportTabs();

if(recoveryError)toast('Предыдущий черновик не удалось восстановить. Можно открыть сохранённый Word.',true);
const readyShell=document.querySelector<HTMLElement>('#app .shell');const readyStyle=readyShell?getComputedStyle(readyShell):null;const readyBounds=readyShell?.getBoundingClientRect();const refreshApplicationVersion=()=>void window.desktop?.getApplicationVersion().then(version=>{const versionLabel=document.querySelector('#application-version');if(versionLabel)versionLabel.textContent=version;}).catch(()=>{});window.desktop?.reportReady({appRoot:Boolean(readyShell),templateCount:reportTemplates.length,viewport:{width:innerWidth,height:innerHeight},shell:{width:Math.round(readyBounds?.width??0),height:Math.round(readyBounds?.height??0),display:readyStyle?.display??'missing',visibility:readyStyle?.visibility??'missing',opacity:readyStyle?.opacity??'missing'},bodyColor:getComputedStyle(document.body).backgroundColor,textLength:document.body.innerText.length});refreshApplicationVersion();setTimeout(refreshApplicationVersion,1500);setTimeout(refreshApplicationVersion,3500);

function packageLibrary():TemplateDocxItem[]{return reportTemplates.map(t=>({id:t.id,title:t.title,areaId:t.areaId,group:t.id.startsWith('ct-')?'КТ':'МРТ',templateVersion:currentTemplateVersion(t.id),doc:overrides[t.id]??makeTemplateDocument(t.id)}));}
function packagePreview(doc:RichNode){const host=document.createElement('div'),view=makeEditor(host,doc,()=>{});try{return DOMPurify.sanitize(view.getHTML());}finally{view.destroy();}}
$('#template-packages').onclick=()=>{
 if(templateMode){toast('Завершите редактирование шаблона.',true);return;}
 const library=packageLibrary(),zones=[...new Set(library.map(t=>t.areaId))];
 const d=dialog('Шаблоны Word для медицинской проверки',`<p>Экспортируется библиотека шаблонов, без открытых протоколов, настроек врача и словаря. Перед передачей проверьте собственные правки шаблонов на персональные данные.</p><label>Зона <select id="package-zone">${zones.map(id=>`<option value="${esc(id)}">${esc(areas.find(a=>a.id===id)?.title??id)}</option>`).join('')}</select></label><label>Группа <select id="package-group"><option>МРТ</option><option>КТ</option></select></label><p id="package-count"></p><button class="btn" id="package-select-all">Выбрать все в группе</button><div id="package-list" class="package-selection"></div><hr><label>Проверить пакет без применения <input id="package-file" type="file" accept=".docx"><small>Для группового ZIP распакуйте архив и импортируйте утверждённые DOCX по одному.</small></label><p>Экспортируется DOCX на каждый шаблон; группа скачивается ZIP. В Word включено отслеживание исправлений. Каждый DOCX импортируется отдельно после разрешения всех исправлений.</p>`, '<button class="btn" data-close>Закрыть</button><button class="btn" id="package-rollback">Восстановить предыдущий импорт</button><button class="btn primary" id="package-export">Экспортировать выбранные</button>');
 const zone=d.querySelector<HTMLSelectElement>('#package-zone')!,group=d.querySelector<HTMLSelectElement>('#package-group')!;
 if(zones.includes('head'))zone.value='head';
 const list=()=>{const items=library.filter(t=>t.areaId===zone.value&&t.group===group.value);d.querySelector('#package-count')!.textContent=`Шаблонов в группе: ${items.length}`;d.querySelector('#package-list')!.innerHTML=items.map(t=>`<label><input type="checkbox" data-package-id="${esc(t.id)}"> ${esc(t.title)}</label>`).join('');};zone.onchange=group.onchange=list;list();
 d.querySelector('#package-select-all')!.addEventListener('click',()=>d.querySelectorAll<HTMLInputElement>('[data-package-id]').forEach(c=>c.checked=true));
 d.querySelector('#package-export')!.addEventListener('click',async()=>{try{const ids=[...d.querySelectorAll<HTMLInputElement>('[data-package-id]:checked')].map(c=>c.dataset.packageId);const selected=library.filter(t=>ids.includes(t.id));const blob=await exportTemplateDocxGroup(selected,packageInfo.version,await embeddedFonts());download(blob,selected.length===1?`${selected[0].title}-${selected[0].id}.docx`:`XRS-templates-${zone.value}-${packageInfo.version}.zip`);}catch(e){toast((e as Error).message,true);}});
 d.querySelector('#package-rollback')!.addEventListener('click',()=>{const preview=dialog('Восстановить шаблоны до импорта?','<p>Открытые документы не изменяются. Будет восстановлено состояние шаблонов, затронутых последним пакетным импортом.</p>','<button class="btn" data-close>Отмена</button><button class="btn" id="package-rollback-confirm">Восстановить</button>');preview.querySelector('#package-rollback-confirm')!.addEventListener('click',()=>{try{rollbackTemplateDocx(localStorage);overrides=read(KEYS.templates,{});renderTemplates();closeDialog();toast('Шаблоны восстановлены.');}catch(e){toast((e as Error).message,true);}});});
 d.querySelector('#package-file')!.addEventListener('change',async event=>{const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;try{
  if(file.size>30_000_000)throw Error('Максимальный размер ZIP — 30 МБ.');const inspectedState=localStorage.getItem(KEYS.templates);const row=await inspectTemplateDocx(new Uint8Array(await file.arrayBuffer()),packageLibrary());editor.schema.nodeFromJSON(row.after).check();
  const preview=dialog('Проверка DOCX — изменения не применены',`<p>Раскройте и проверьте каждое изменение. ID, исходная версия и хеш проверяются; конфликт исходной версии блокирует замену.</p><div class="package-diff"><details open><summary>${esc(row.title)} — ${row.status==='changed'?'изменён':row.status==='conflict'?'КОНФЛИКТ исходной версии':'без изменений'}</summary><p>ID: ${esc(row.id)} · экспортировано из XRS ${esc(row.appVersion)} · исходный SHA-256: ${row.baseSha256.slice(0,12)}. ${row.warnings.map(esc).join('<br>')}</p><div class="template-import-diff"><section><h3>БЫЛО</h3><div class="report-content">${packagePreview(row.before)}</div></section><section><h3>СТАЛО</h3><div class="report-content">${packagePreview(row.after)}</div></section></div><label>Решение <select id="package-decision"><option value="">Не подтверждено</option><option value="accept">Принять изменение</option><option value="reject">Отклонить изменение</option><option value="keep">Оставить исходный шаблон</option></select></label></details></div>`, '<button class="btn" data-close>Закрыть без применения</button><button class="btn primary" id="package-apply">Применить только подтверждённые</button>');preview.querySelector('.dialog')!.classList.add('wide-preview');

  preview.querySelector('#package-apply')!.addEventListener('click',async()=>{const apply=preview.querySelector<HTMLButtonElement>('#package-apply')!;if(apply.disabled)return;apply.disabled=true;try{const accepted=preview.querySelector<HTMLSelectElement>('#package-decision')!.value==='accept';if(localStorage.getItem(KEYS.templates)!==inspectedState)throw Error('Библиотека изменена после предпросмотра. Проверьте пакет снова.');await applyTemplateDocx(localStorage,row,accepted);overrides=read(KEYS.templates,{});renderTemplates();closeDialog();toast('Подтверждённые шаблоны сохранены. Резервная копия и отчёт созданы.');}catch(e){toast(`Импорт отменён: ${(e as Error).message}`,true);}finally{apply.disabled=false;}});
 }catch(e){toast(`DOCX отклонён: ${(e as Error).message}`,true);}});
};
