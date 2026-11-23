export const BULLET_STYLES = ['dash', 'asterisk', 'disc'] as const;
export const RULE_THICKNESSES = [0.5, 1, 1.5, 2, 3] as const;
export const DEFAULT_RULE_THICKNESS = 1.5;
export const LEGACY_RULE_THICKNESS = 0.5;
export const RULE_GAP_PT = 3;
export const MANUAL_FILL_COLORS = [
  ['#ffff00', 'Жёлтый'],
  ['#b7f7b7', 'Светло-зелёный'],
  ['#bcebff', 'Голубой'],
  ['#ffbdd7', 'Розовый'],
  ['#ffd69a', 'Оранжевый'],
  ['#e3c9ff', 'Фиолетовый'],
  ['#d9dfe5', 'Серый'],
] as const;

export function ruleThickness(value: unknown) {
  const thickness = Number(value);
  return RULE_THICKNESSES.find(option => option === thickness);
}

export function manualFillColor(value: unknown) {
  let normalized=String(value).toLowerCase().trim();
  if(normalized==='yellow')normalized='#ffff00';
  if(/^#[\da-f]{3}$/.test(normalized))normalized='#'+[...normalized.slice(1)].map(char=>char+char).join('');
  const rgb=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(normalized);
  if(rgb&&rgb.slice(1).every(n=>Number(n)<=255))normalized='#'+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('');
  return MANUAL_FILL_COLORS.find(([color]) => color === normalized)?.[0];
}
