export type Kind = 'MM' | 'HFT' | 'Retail' | 'Suspect' | 'Other';
export const kindOf = (a: number): Kind =>
  a >= 80000 ? 'Suspect' : a >= 3000 && a < 4000 ? 'Retail' : a >= 2000 && a < 2100 ? 'HFT' : a >= 1000 && a < 1100 ? 'MM' : 'Other';
export const KIND_COLOR: Record<Kind, string> = { MM: '#3b82f6', HFT: '#8f7bf0', Retail: '#8892a6', Suspect: '#e5484d', Other: '#8892a6' };
export const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
export const px = (cents: number) => (cents / 100).toFixed(2);
export const compact = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : n.toLocaleString());
export const ns = (x: number) => (x < 1000 ? `${Math.round(x)} ns` : `${(x / 1000).toFixed(1)} µs`);
