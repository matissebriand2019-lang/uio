/**
 * cubiomes_worker.js
 * Web Worker — charge cubiomes.wasm et traite les requêtes de tuiles/structures.
 * Utilise les valeurs entières directes des StructureType (pas de noms symboliques).
 */
"use strict";

/* ─── COULEURS BIOMES ─── */
const BIOME_COLORS = [
/* 0  ocean              */ [0,0,112],
/* 1  plains             */ [141,179,96],
/* 2  desert             */ [250,148,24],
/* 3  mountains          */ [96,96,96],
/* 4  forest             */ [5,102,33],
/* 5  taiga              */ [11,102,89],
/* 6  swamp              */ [7,249,178],
/* 7  river              */ [0,0,255],
/* 8  nether_wastes      */ [191,59,59],
/* 9  the_end            */ [128,128,255],
/* 10 frozen_ocean       */ [144,144,160],
/* 11 frozen_river       */ [160,160,255],
/* 12 snowy_plains       */ [255,255,255],
/* 13 snowy_mountains    */ [160,160,160],
/* 14 mushroom_fields    */ [255,0,255],
/* 15 mushroom_shore     */ [160,0,255],
/* 16 beach              */ [250,222,85],
/* 17 desert_hills       */ [210,95,18],
/* 18 wooded_hills       */ [34,85,28],
/* 19 taiga_hills        */ [22,57,51],
/* 20 mountain_edge      */ [114,120,154],
/* 21 jungle             */ [83,123,9],
/* 22 jungle_hills       */ [44,66,5],
/* 23 sparse_jungle      */ [99,166,47],
/* 24 deep_ocean         */ [0,0,48],
/* 25 stone_shore        */ [162,162,132],
/* 26 snowy_beach        */ [250,240,192],
/* 27 birch_forest       */ [48,116,68],
/* 28 birch_forest_hills */ [31,95,50],
/* 29 dark_forest        */ [64,81,26],
/* 30 snowy_taiga        */ [49,85,74],
/* 31 snowy_taiga_hills  */ [36,63,54],
/* 32 old_growth_pine    */ [89,102,81],
/* 33 old_growth_spruce  */ [69,79,62],
/* 34 wooded_mountains   */ [80,112,80],
/* 35 savanna            */ [189,178,95],
/* 36 savanna_plateau    */ [167,157,100],
/* 37 badlands           */ [217,69,21],
/* 38 eroded_badlands    */ [255,109,61],
/* 39 wooded_badlands    */ [176,151,101],
];
while (BIOME_COLORS.length < 201) BIOME_COLORS.push([100,100,100]);

const BIOME_COLORS_EXT = {
  177: [83,179,96],    // meadow
  178: [200,220,255],  // grove
  179: [205,210,220],  // snowy_slopes
  180: [160,180,200],  // frozen_peaks
  181: [200,200,200],  // jagged_peaks
  182: [210,200,170],  // stony_peaks
  183: [255,183,197],  // cherry_grove
  184: [15,15,25],     // deep_dark
  185: [45,120,60],    // mangrove_swamp
  186: [220,230,215],  // pale_garden
  // nether
  85:  [93,68,32],     // soul_sand_valley
  86:  [221,8,8],      // crimson_forest
  87:  [73,144,123],   // warped_forest
  88:  [84,84,94],     // basalt_deltas
};

function biomeColor(id) {
  if (id in BIOME_COLORS_EXT) return BIOME_COLORS_EXT[id];
  if (id >= 0 && id < BIOME_COLORS.length) return BIOME_COLORS[id];
  return [100,100,100];
}

/* ─── STRUCTURES ───────────────────────────────────────────
 * Valeurs entières directes de l'enum StructureType dans cubiomes master.
 * Ces valeurs sont passées telles quelles au C — aucun nom symbolique.
 */
const STRUCT_TYPES = [
  { enumVal:  5, name:'Village',         icon:'🏘',  color:'#F5A623' },
  { enumVal: 17, name:'Forteresse',      icon:'🔥',  color:'#FF4444' },
  { enumVal: 18, name:'Bastion',         icon:'🏰',  color:'#CC3333' },
  { enumVal:  8, name:'Monument',        icon:'🔷',  color:'#4A90D9' },
  { enumVal:  9, name:'Manoir',          icon:'🏚',  color:'#7B4F3A' },
  { enumVal:  1, name:'Temple Désert',   icon:'🔺',  color:'#F5A623' },
  { enumVal:  2, name:'Temple Jungle',   icon:'🌿',  color:'#5E9B3B' },
  { enumVal:  3, name:'Cabane Marais',   icon:'🪄',  color:'#6B8E23' },
  { enumVal: 10, name:'Avant-Poste',     icon:'🗼',  color:'#999977' },
  { enumVal: 21, name:'Cité Antique',    icon:'💀',  color:'#4444AA' },
  { enumVal: 11, name:'Portail Ruiné',   icon:'🌀',  color:'#9944AA' },
  { enumVal: 23, name:'Trial Chambers',  icon:'⚗️',  color:'#44AAAA' },
];

/* ─── ÉTAT ─── */
let Module   = null;
let cwGen    = 0;
let isReady  = false;
let biomeBuf    = null;
let biomeBufLen = 0;

/* ─── CHARGEMENT WASM ─── */
importScripts('cubiomes.js');

CubiomesModule().then(function(m) {
  Module  = m;
  isReady = true;
  postMessage({ type: 'ready' });
}).catch(function(e) {
  postMessage({ type: 'error', msg: 'Impossible de charger cubiomes.wasm : ' + e.message });
});

/* ─── UTILS ─── */
function versionToInt(v) {
  var parts = String(v).split('.').map(Number);
  var major = parts[1] || 16;
  var minor = parts[2] || 0;
  return 1000 + major * 10 + Math.min(minor, 9);
}

function seedParts(seed) {
  seed = Math.trunc(seed);
  var lo = seed | 0;
  var hi = Math.trunc(seed / 0x100000000);
  return [lo, hi];
}

/* ─── INIT ─── */
function initGen(seed, version, largeBiomes) {
  if (!Module) return false;
  if (cwGen !== 0) { Module._cw_free(cwGen); cwGen = 0; }
  var vint = versionToInt(version);
  cwGen = Module._cw_init(vint, largeBiomes ? 1 : 0);
  if (!cwGen) return false;
  var parts = seedParts(seed);
  Module._cw_set_seed(cwGen, parts[0], parts[1]);
  return true;
}

/* ─── TUILE ─── */
function generateTile(tileX, tileZ, tileSz, px) {
  if (!Module || !cwGen) return null;
  var scale   = Math.max(1, Math.round(tileSz / px));
  var needed  = px * px;
  if (!biomeBuf || biomeBufLen < needed) {
    if (biomeBuf) Module._free(biomeBuf);
    biomeBuf    = Module._malloc(needed * 4);
    biomeBufLen = needed;
  }
  Module._cw_get_biome_bulk(cwGen, biomeBuf, tileX, tileZ, px, px, scale);
  var heap32 = new Int32Array(Module.HEAP32.buffer, biomeBuf, needed);
  var rgba   = new Uint8ClampedArray(px * px * 4);
  for (var i = 0; i < needed; i++) {
    var c = biomeColor(heap32[i]);
    rgba[i*4]   = c[0];
    rgba[i*4+1] = c[1];
    rgba[i*4+2] = c[2];
    rgba[i*4+3] = 255;
  }
  return rgba;
}

/* ─── STRUCTURES ─── */
const MAX_STRUCT_PER_TYPE = 256;

function getStructures(seed, version, radiusChunks) {
  if (!Module || !cwGen) return {};
  var parts  = seedParts(seed);
  var bufX   = Module._malloc(MAX_STRUCT_PER_TYPE * 4);
  var bufZ   = Module._malloc(MAX_STRUCT_PER_TYPE * 4);
  var result = {};

  STRUCT_TYPES.forEach(function(st) {
    var count = Module._cw_get_structures(
      cwGen, bufX, bufZ,
      st.enumVal,
      0, 0,
      radiusChunks,
      MAX_STRUCT_PER_TYPE,
      parts[0], parts[1]
    );
    var positions = [];
    var hx = new Int32Array(Module.HEAP32.buffer, bufX, count);
    var hz = new Int32Array(Module.HEAP32.buffer, bufZ, count);
    for (var i = 0; i < count; i++) {
      positions.push({ x: hx[i], z: hz[i] });
    }
    result[st.enumVal] = { cfg: st, positions: positions };
  });

  Module._free(bufX);
  Module._free(bufZ);
  return result;
}

/* ─── MESSAGES ─── */
self.onmessage = function(e) {
  var msg = e.data;
  switch (msg.type) {

    case 'init': {
      if (!isReady) { postMessage({ type:'error', msg:'WASM pas encore chargé.' }); return; }
      var ok = initGen(msg.seed, msg.version, msg.largeBiomes || false);
      postMessage({ type:'init_ok', ok: ok });
      break;
    }

    case 'tile': {
      if (!cwGen) { postMessage({ type:'tile', id:msg.id, rgba:null }); return; }
      var rgba = generateTile(msg.tileX, msg.tileZ, msg.tileSz, msg.px);
      postMessage({ type:'tile', id:msg.id, rgba:rgba, px:msg.px }, rgba ? [rgba.buffer] : []);
      break;
    }

    case 'structures': {
      if (!cwGen) { postMessage({ type:'structures', data:{} }); return; }
      var data = getStructures(msg.seed, msg.version, msg.radiusChunks || 1600);
      postMessage({ type:'structures', data:data });
      break;
    }
  }
};
