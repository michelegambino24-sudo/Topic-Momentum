// Admin-only: Wrangler uses the owner's existing Cloudflare authorization.
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {dailyKey,dailyReset} from "../worker/lib.js";

export async function inspectCounters(read,date=new Date()) {
  const day=dailyKey(date),values={};
  for(const prefix of ["ai:usage:","ai:count:","count:"]) values[prefix+day]=await read(prefix+day);
  return {day,timeZone:"UTC",nextReset:dailyReset(date),values,limits:{neurons:9000,aiAttempts:50,sourceAttempts:30},note:"Missing keys are treated as zero. KV reads are eventually consistent. This command never changes counters."};
}
function readCounter(key) {
  const args=["wrangler","kv","key","get",key,"--binding","TMM","--remote","--config","worker/wrangler.toml"];
  try {
    const output=process.platform==="win32"
      ? execFileSync("cmd.exe",["/d","/s","/c","npx "+args.join(" ")],{encoding:"utf8",stdio:["ignore","pipe","pipe"]})
      : execFileSync("npx",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    return JSON.parse(output);
  } catch(error) {
    if(String(error.stderr).includes("404: Not Found"))return null;
    throw new Error("Cannot read the daily counters. Check your existing Wrangler authorization and try again.");
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes("--help"))console.log("From the project root: node tools/daily-counters.mjs\nReads today's three remote KV counters with existing Wrangler admin authorization. No searches, inference, writes or paid API.");
  else try { console.log(JSON.stringify(await inspectCounters(readCounter),null,2)); }
  catch(error){console.error(error.message);process.exitCode=1;}
}
