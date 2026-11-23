/** Fixed-point base currency arithmetic, never IEEE-754 sums for ledger validation. */
export function units(value:string):bigint {
  if(!/^\d{1,14}(\.\d{1,4})?$/.test(value)) throw new Error('أدخل مبلغًا صالحًا حتى أربع منازل عشرية');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
}
export function decimal(value:bigint):string {const negative=value<0n;const n=negative?-value:value;return `${negative?'-':''}${n/10000n}.${String(n%10000n).padStart(4,'0')}`;}
