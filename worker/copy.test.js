import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {headline} from './lib.js';
const catalogue=JSON.parse(readFileSync(new URL('./fixtures/copy-catalogue.json',import.meta.url),'utf8'));
const copy=readFileSync(new URL('../COPY.md',import.meta.url),'utf8');
for(const row of catalogue.headlines)test('exact headline: '+row.label,()=>{
 assert.equal(headline(...row.args),row.expected);
 assert(copy.includes(row.expected));
});
for(const row of catalogue.messages)test('exact UI copy: '+row.text,()=>{
 const source=readFileSync(new URL('../'+row.file,import.meta.url),'utf8');
 assert(source.includes(row.text));assert(copy.includes(row.text));
});
test('every approved dynamic example is included verbatim for proofreading',()=>{
 for(const row of catalogue.dynamic){assert(copy.includes('Template: `'+row.template+'`'));assert(copy.includes(row.example));}
});
