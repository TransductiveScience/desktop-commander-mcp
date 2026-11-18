/** FREEZELESS safe-subset recursive search routing.
 * Invariant: never reinterpret shell syntax, unknown flags, quoted arguments,
 * pipelines, or commands with side effects. Null means execute unchanged.
 * This module is inert until explicitly wired into the command handler.
 */
export interface FreezelessSearchPolicy { timeoutSeconds: number; maxMatches: number; argv: string[]; }
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,?^-]+$/;
const SAFE_ROOT = /^\/(?:home\/ned|mnt\/SERVE)(?:\/[A-Za-z0-9_./@%+=,-]+)*$/;
export function classifyFreezelessSearch(command: string): FreezelessSearchPolicy | null {
  const trimmed=command.trim();
  if (!trimmed || /[\n\r;&|`$()<>\\'"!{}\[\]~]/.test(trimmed)) return null;
  const words=trimmed.split(/\s+/);
  if (words.some(w=>!SAFE_TOKEN.test(w))) return null;
  if (words[0]!=='rg') return null;
  let i=1;let insensitive=false;let filesize='2M';let filesWithMatches=false;
  while(i<words.length && words[i].startsWith('-')) {
    const w=words[i++];
    if(w==='-i') insensitive=true;
    else if(w==='-l'||w==='--files-with-matches'){filesWithMatches=true;}
    else if(w==='--max-filesize'){
      if(i>=words.length || !/^\d+[KMG]?$/.test(words[i]))return null;
      filesize=words[i++];
    }else return null;
  }
  if(!filesWithMatches || i>=words.length)return null;
  const pattern=words[i++];
  if(pattern.startsWith('-'))return null;
  const roots=words.slice(i);
  if(!roots.length || roots.some(r=>!SAFE_ROOT.test(r)||r.includes('/../')||r.endsWith('/..')))return null;
  return {timeoutSeconds:30,maxMatches:100,argv:['/usr/bin/python3','/home/ned/freezeless-bounded-search.py','--timeout','30','--max-count','100','--quiet-summary','--max-filesize',filesize,...(insensitive?['--ignore-case']:[]),pattern,...roots]};
}
