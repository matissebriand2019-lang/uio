/**
 * cubiomes_wrapper.c
 * Wrapper cubiomes → WASM. Compatible cubiomes master.
 *
 * Stratégie : on passe les valeurs entières des enums directement
 * depuis JS — zéro nom symbolique côté C = zéro risque de
 * "undeclared identifier" quelle que soit la version de cubiomes.
 *
 * Valeurs numériques StructureType dans cubiomes master :
 *   1  = Desert_Pyramid
 *   2  = Jungle_Pyramid
 *   3  = Swamp_Hut
 *   5  = Village
 *   8  = Monument
 *   9  = Mansion
 *  10  = Outpost
 *  11  = Ruined_Portal
 *  17  = Fortress
 *  18  = Bastion
 *  21  = Ancient_City
 *  22  = Trail_Ruins
 *  23  = Trial_Chambers
 */

#include <stdlib.h>
#include <string.h>
#include "cubiomes/generator.h"
#include "cubiomes/finders.h"
#include "cubiomes/util.h"

/* ─── Mapping version int → constante cubiomes ─── */
static int version_const(int v) {
    if (v >= 1214) return MC_1_21;
    if (v >= 1210) return MC_1_21;
    if (v >= 1200) return MC_1_20;
    if (v >= 1190) return MC_1_19;
    if (v >= 1180) return MC_1_18;
    if (v >= 1170) return MC_1_17;
    return MC_1_16;
}

/* ─── Opaque handle ─── */
typedef struct {
    Generator g;
    int       mc_version;
} CWGen;

CWGen* cw_init(int version_int, int large_biomes) {
    CWGen *cw = (CWGen*)malloc(sizeof(CWGen));
    if (!cw) return NULL;
    cw->mc_version = version_const(version_int);
    setupGenerator(&cw->g, cw->mc_version, large_biomes ? LARGE_BIOMES : 0);
    return cw;
}

void cw_free(CWGen *cw) {
    if (cw) free(cw);
}

void cw_set_seed(CWGen *cw, int seed_lo, int seed_hi) {
    if (!cw) return;
    uint64_t seed = ((uint64_t)(unsigned int)seed_hi << 32) | (unsigned int)seed_lo;
    applySeed(&cw->g, DIM_OVERWORLD, seed);
}

int cw_get_biome(CWGen *cw, int x, int z, int scale) {
    if (!cw) return 0;
    return getBiomeAt(&cw->g, scale, x, 0, z);
}

void cw_get_biome_bulk(CWGen *cw, int *out, int ox, int oz, int w, int h, int scale) {
    if (!cw || !out) return;
    Range r;
    r.scale = scale;
    r.x     = ox / scale;
    r.z     = oz / scale;
    r.sx    = w;
    r.sz    = h;
    r.y     = 0;
    r.sy    = 1;
    genBiomes(&cw->g, out, r);
}

/* ─── STRUCTURES ─── */
/* structure_enum_val : valeur entière directe de StructureType */
int cw_get_structures(CWGen *cw, int *out_x, int *out_z,
                      int structure_enum_val,
                      int cx, int cz,
                      int radius, int max,
                      int seed_lo, int seed_hi)
{
    if (!cw || !out_x || !out_z) return 0;

    uint64_t seed = ((uint64_t)(unsigned int)seed_hi << 32) | (unsigned int)seed_lo;

    StructureConfig sc;
    if (getStructureConfig(structure_enum_val, cw->mc_version, &sc) != 1) return 0;

    int count = 0;
    int step  = sc.regionSize;
    if (step < 1) step = 1;

    int rmin = cx / step - radius / step - 2;
    int rmax = cx / step + radius / step + 2;

    for (int rx = rmin; rx <= rmax && count < max; rx++) {
        for (int rz = rmin; rz <= rmax && count < max; rz++) {
            Pos p;
            if (!getStructurePos(structure_enum_val, cw->mc_version, seed, rx, rz, &p))
                continue;

            int dcx = p.x / 16 - cx;
            int dcz = p.z / 16 - cz;
            if ((long long)dcx*dcx + (long long)dcz*dcz > (long long)radius*radius)
                continue;

            out_x[count] = p.x;
            out_z[count] = p.z;
            count++;
        }
    }
    return count;
}
