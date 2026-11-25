import type {RichNode} from './model.ts';
export type CatalogTemplate={id:string;title:string;areaId:string;areaTitle:string;modality:'MRI'|'CT';templateVersion:string;minimumXrsVersion:string;doc:RichNode;retired?:boolean};
export type TemplateCatalogState={configured:boolean;error?:string;version:string;count:number;lastSuccess?:string|null;history:{at:string;operation:string;version:string}[];canRollback:boolean;warnings?:{templateId:string;code:string}[];templates:CatalogTemplate[]};
export type TemplateUpdatePlan={upToDate:boolean;planId?:string;catalogVersion:string;changes:{id:string;version:string;action:string;summary:string}[];downloadBytes?:number};
export type TemplateDesktop={templateCatalogState:()=>Promise<TemplateCatalogState>;checkTemplateUpdates:()=>Promise<TemplateUpdatePlan>;installTemplateUpdates:(planId:string,confirmed:boolean)=>Promise<TemplateCatalogState>;rollbackTemplateUpdates:(confirmed:boolean)=>Promise<TemplateCatalogState>};
