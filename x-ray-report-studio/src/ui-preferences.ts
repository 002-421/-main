export const THEMES=['light','dark','amoled'] as const;
export type Theme=typeof THEMES[number];
export const MIN_ZOOM=75,MAX_ZOOM=200;
export function normalizeTheme(value:unknown):Theme{return THEMES.includes(value as Theme)?value as Theme:'dark';}
export function normalizeZoom(value:unknown){return typeof value==='number'&&Number.isInteger(value)&&value>=MIN_ZOOM&&value<=MAX_ZOOM&&value%5===0?value:100;}
