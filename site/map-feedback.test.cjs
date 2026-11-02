const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const source = readFileSync(__dirname + "/map-feedback.js", "utf8");
const hint = "Hover or focus a country for its exact count.";

function fixture() {
  function node() {
    const events = new Map();
    return { events, style:{}, hidden:false, textContent:"", offsetWidth:150, offsetHeight:28,
      setAttribute() {},
      addEventListener(type,handler) { if (!events.has(type)) events.set(type,new Set()); events.get(type).add(handler); },
      removeEventListener(type,handler) { events.get(type)?.delete(handler); },
      emit(type,event={}) { for (const handler of [...events.get(type)||[]]) handler(event); },
      remove() { const index=host.children.indexOf(this); if(index>=0)host.children.splice(index,1); }
    };
  }
  const readout = node();
  const host = {...node(),children:[],getBoundingClientRect:()=>({left:0,top:0,width:300,height:180}),append(child){this.children.push(child);}};
  const markers = [["Switzerland: 149 papers",{left:140,right:146,top:42}], ["Qatar: 1 paper",{left:286,right:292,top:64}]].map(([label,box])=>({...node(),getAttribute:()=>label,querySelector:()=>({getBoundingClientRect:()=>box})}));
  host.querySelector=()=>readout;
  host.querySelectorAll=()=>markers;
  const context = vm.createContext({document:{createElement:node}});
  vm.runInContext(source,context);
  const bind=()=>context.TMM_BIND_MAP_FEEDBACK(host);
  bind();
  return {host,markers,readout,bind,label:()=>host.children[0]};
}

test("map hover displays the exact count beside the dot and resets on pointerleave",()=>{
  const map=fixture();
  assert.equal(map.readout.textContent,hint);
  map.markers[0].emit("pointerenter");
  assert.equal(map.readout.textContent,"Switzerland: 149 papers");
  assert.equal(map.label().textContent,"Switzerland: 149 papers");
  assert.equal(map.label().hidden,false);
  map.markers[0].emit("pointerleave");
  assert.equal(map.readout.textContent,hint);
  assert.equal(map.label().hidden,true);
  map.markers[1].emit("pointerenter");
  const left=parseFloat(map.label().style.left);
  assert(left>=4&&left+map.label().offsetWidth<=296,"The label stays within the map at its right edge");
  map.host.emit("pointerleave");
  assert.equal(map.readout.textContent,hint);
});

test("map keyboard focus, blur, hover handoff and Escape never leave a stale country",()=>{
  const map=fixture();
  map.markers[0].emit("focus");
  assert.equal(map.label().hidden,false);
  map.markers[1].emit("pointerenter");
  assert.equal(map.readout.textContent,"Qatar: 1 paper");
  map.markers[1].emit("pointerleave");
  assert.equal(map.readout.textContent,"Switzerland: 149 papers");
  map.markers[0].emit("blur");
  assert.equal(map.readout.textContent,hint);
  map.markers[1].emit("focus");
  map.host.emit("keydown",{key:"Escape"});
  assert.equal(map.readout.textContent,hint);
  assert.equal(map.label().hidden,true);
  map.markers[1].emit("blur");
  assert.equal(map.label().hidden,true);
});

test("rebinding a refreshed map removes old feedback listeners and labels",()=>{
  const map=fixture();
  map.markers[0].emit("focus");
  map.bind();
  assert.equal(map.host.children.length,1);
  assert.equal(map.markers[0].events.get("focus").size,1);
  assert.equal(map.host.events.get("pointerleave").size,1);
  assert.equal(map.readout.textContent,hint);
  map.markers[1].emit("focus");
  assert.equal(map.readout.textContent,"Qatar: 1 paper");
});
