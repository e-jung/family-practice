const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256',enc.encode(value)));
export async function equalSecret(a,b) {
  const [x,y]=await Promise.all([a,b].map(sha256)); let difference=0;
  for(let i=0;i<x.length;i++) difference|=x.charCodeAt(i)^y.charCodeAt(i);
  return difference===0;
}
async function mac(payload,secret) {
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));
}
export async function signSession(secret,familyIdHash) {
  const payload=`${Date.now()+43200000}.${familyIdHash}`;
  return `${payload}.${await mac(payload,secret)}`;
}
export async function isParent(request,env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length<32 || !env.familyIdHash) return false;
  const token=(request.headers.get('cookie')||'').match(/(?:^|;\s*)parent=([^;]+)/)?.[1];
  if (!token || token.length>220) return false;
  const parts=token.split('.');
  if(parts.length!==3 || !/^\d{13}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expiry=Number(parts[0]);
  if(expiry<=Date.now() || expiry>Date.now()+43200000 || parts[1]!==env.familyIdHash) return false;
  return equalSecret(parts[2],await mac(`${parts[0]}.${parts[1]}`,env.SESSION_SECRET));
}
export const cookie=(token,maxAge)=>`parent=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export async function hashPin(pin,salt) {
  const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256));
}
export const validPin = pin => typeof pin==='string' && /^\d{4,8}$/.test(pin);
// 2,048 curated kid-safe compound words: 16 nature/color prefixes × 128 nouns.
// Three independent 11-bit choices plus 10,000 suffixes = 46.28 bits of entropy.
const prefixes='amber aqua autumn blue bright coral dawn fair gold green jade lilac mint silver sunny violet'.split(' ');
const nouns='acorn apple apron arch aster badger bag bamboo banana basket bay beach bean bear bee bell berry birch bird boat book breeze brook brush bubble bunny butterfly cabin cactus cake camel candle canoe carrot castle cedar cherry chick cloud clover coast cocoa comet coral cotton crane creek cricket crown daisy deer dolphin dove dragon dream duck eagle earth elm feather fern field finch firefly fish flower forest fox frog garden gem goose grape grass grove gull harbor hare hawk hazel hedgehog hill honey horse island ivy jasmine kite kitten kiwi koala lake lamb lantern lark leaf lemon lily lion lotus maple meadow melon moon moss mouse nest oak ocean olive otter owl panda peach pearl pebble pine plum pond poppy rabbit rainbow raven reed ridge river robin rose'.split(' ');
if(nouns.length!==128) throw Error('Code wordlist must contain 128 nouns');
export const CODE_WORDS=Object.freeze(prefixes.flatMap(p=>nouns.map(n=>p+n)));
export function generateFamilyCode() {
  const r=crypto.getRandomValues(new Uint32Array(4));
  // Reject suffix range remainder to avoid modulo bias.
  while(r[3]>=4294960000) r[3]=crypto.getRandomValues(new Uint32Array(1))[0];
  return `${CODE_WORDS[r[0]&2047]}-${CODE_WORDS[r[1]&2047]}-${CODE_WORDS[r[2]&2047]}-${String(r[3]%10000).padStart(4,'0')}`;
}
export const normalizeCode = value => typeof value==='string' ? value.trim().toLowerCase() : '';
export const validCode = code => /^[a-z]{5,24}-[a-z]{5,24}-[a-z]{5,24}-\d{4}$/.test(code);
