import type {RichNode} from './model.ts';
export type CatalogTemplate={id:string;title:string;areaId:string;areaTitle:string;modality:'MRI'|'CT';templateVersion:string;minimumXrsVersion:string;doc:RichNode;retired?:boolean};
export type TemplateCatalogState={configured:boolean;error?:string;version:string;count:number;lastSuccess?:string|null;publishedAt?:string|null;publication?:{id:string}|null;history:{at:string;operation:string;version:string;sha256?:string|null;channel?:string;changes?:number}[];canRollback:boolean;revisions?:TemplateRevision[];warnings?:{templateId:string;code:string}[];templates:CatalogTemplate[];activeTemplates?:CatalogTemplate[]};
export type TemplateUpdatePlan={upToDate:boolean;planId?:string;catalogVersion:string;changes:{id:string;version:string;action:string;summary:string}[];downloadBytes?:number};
export type TemplateDesktop={templateRevision:(id:string,version:string)=>Promise<RevisionResult>;templateCatalogState:()=>Promise<TemplateCatalogState>;checkTemplateUpdates:()=>Promise<TemplateUpdatePlan>;installTemplateUpdates:(planId:string,confirmed:boolean)=>Promise<TemplateCatalogState>;rollbackTemplateUpdates:(confirmed:boolean)=>Promise<TemplateCatalogState>};

export type TemplateRevision={templateId:string;templateVersion:string;status:'Active'|'Archived'|'Revoked';publishedAt:string|null;approvedBy:string;sha256:string;builtin:boolean;available:boolean;catalogVersion?:string};
export type RevisionResult={metadata:TemplateRevision;builtin:boolean;template?:CatalogTemplate};
