export type VoxelMat = 'concrete' | 'brick' | 'wood' | 'glass' | 'steel' | 'tnt' | 'gold';

export interface VoxelSeed {
  x: number;
  y: number;
  z: number;
  mat: VoxelMat;
  color: number;
}

export type MapId = 'twin_towers' | 'suspension_bridge' | 'powder_castle' | 'tower_crane' | 'domino_chain';

export interface MapSpec {
  id: MapId;
  name: string;
  subtitle: string;
  camPos: [number, number, number];
  lookAt: [number, number, number];
  build: () => VoxelSeed[];
}

const PALETTE: Record<VoxelMat, number[]> = {
  concrete: [0x94a3b8, 0xcbd5e1, 0x64748b],
  brick: [0xb45309, 0xc2410c, 0x9a3412],
  wood: [0xd97706, 0xb45309, 0x92400e],
  glass: [0x38bdf8, 0x7dd3fc, 0x0ea5e9],
  steel: [0x334155, 0x475569, 0x1e293b],
  tnt: [0xef4444, 0xdc2626],
  gold: [0xfacc15, 0xf59e0b],
};

function pickColor(mat: VoxelMat, hash: number): number {
  const arr = PALETTE[mat];
  return arr[Math.abs(hash) % arr.length];
}

function makeBuilder() {
  const map = new Map<string, VoxelSeed>();
  const set = (x: number, y: number, z: number, mat: VoxelMat, customColor?: number) => {
    if (y < 0) return;
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    map.set(`${rx},${ry},${rz}`, {
      x: rx,
      y: ry,
      z: rz,
      mat,
      color: customColor ?? pickColor(mat, rx * 7 + ry * 13 + rz * 19),
    });
  };
  const box = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    mat: VoxelMat,
    customColor?: number
  ) => {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          set(x, y, z, mat, customColor);
        }
      }
    }
  };
  return { set, box, list: () => [...map.values()] };
}

export const MAPS: MapSpec[] = [
  {
    id: 'twin_towers',
    name: '🏙️ 双子摩天玻璃大厦',
    subtitle: '底层 4 根承重钢柱架空！贴满 C4 炸断立柱，看整栋摩天楼连带高空连廊轰然坍塌',
    camPos: [22, 18, 28],
    lookAt: [0, 9, 0],
    build() {
      const b = makeBuilder();
      for (const cx of [-7, 7]) {
        // 4 Ground-level load-bearing steel corner pillars (y = 0..3)
        for (const px of [-3, 3]) {
          for (const pz of [-3, 3]) {
            b.box(cx + px, 0, pz, cx + px, 3, pz, 'steel');
          }
        }
        // Upper 5 stories (y = 4..19)
        for (let floorY = 4; floorY <= 19; floorY++) {
          const isSlab = floorY % 4 === 0 || floorY === 19;
          for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) {
              const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
              const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
              if (isSlab) {
                b.set(cx + dx, floorY, dz, corner ? 'steel' : 'concrete');
              } else if (corner) {
                b.set(cx + dx, floorY, dz, 'steel');
              } else if (edge) {
                b.set(cx + dx, floorY, dz, 'glass');
              }
            }
          }
          // Explosive generator core on middle & roof floors!
          if (floorY === 9 || floorY === 17) {
            b.box(cx - 1, floorY, -1, cx + 1, floorY, 1, 'tnt');
          }
        }
        // Rooftop spire
        b.box(cx, 20, 0, cx, 23, 0, 'gold');
      }

      // Skybridge connecting the two skyscrapers at y = 12..14!
      b.box(-3, 12, -1, 3, 12, 1, 'steel');
      b.box(-3, 13, -1, 3, 13, -1, 'glass');
      b.box(-3, 13, 1, 3, 13, 1, 'glass');
      b.box(-3, 14, -1, 3, 14, 1, 'concrete');
      b.set(0, 13, 0, 'tnt');

      return b.list();
    },
  },
  {
    id: 'suspension_bridge',
    name: '🌉 金门悬索跨海大桥',
    subtitle: '双红塔悬索桥 + 运油罐车！激光切断吊索或炸毁桥墩，整段桥面连锁断裂坠毁',
    camPos: [0, 15, 29],
    lookAt: [0, 7, 0],
    build() {
      const b = makeBuilder();
      // Two tall crimson suspension towers at x = -9 and x = 9
      for (const tx of [-9, 9]) {
        b.box(tx - 1, 0, -2, tx, 17, -2, 'brick', 0xdc2626);
        b.box(tx - 1, 0, 2, tx, 17, 2, 'brick', 0xdc2626);
        // Cross braces
        for (const cy of [5, 10, 15]) {
          b.box(tx - 1, cy, -1, tx, cy, 1, 'steel');
        }
      }

      // Main highway deck at y = 6 spanning x = -17..17
      b.box(-17, 6, -2, 17, 6, 2, 'concrete', 0x475569);
      // End abutments anchored to y=0
      b.box(-17, 0, -2, -16, 5, 2, 'concrete');
      b.box(16, 0, -2, 17, 5, 2, 'concrete');

      // Parabolic main cables + vertical suspender cables
      for (let x = -16; x <= 16; x++) {
        const distFromTower = Math.min(Math.abs(x + 9), Math.abs(x - 9));
        const cableY = Math.min(17, Math.round(9 + (distFromTower * distFromTower) * 0.14));
        for (const z of [-2, 2]) {
          b.set(x, cableY, z, 'gold', 0xf97316);
          if (x % 3 === 0 && cableY > 7) {
            for (let y = 7; y < cableY; y++) b.set(x, y, z, 'steel', 0x94a3b8);
          }
        }
      }

      // Vehicles & Explosive TNT Fuel Tankers on deck!
      b.box(-4, 7, -1, -2, 8, 0, 'tnt');
      b.box(3, 7, 0, 5, 8, 1, 'tnt');
      b.box(-13, 7, 0, -12, 7, 1, 'gold');
      b.box(12, 7, -1, 13, 7, 0, 'glass');

      return b.list();
    },
  },
  {
    id: 'powder_castle',
    name: '🏰 中世纪火药库古堡',
    subtitle: '四座角楼 + 中央主堡地下塞满 TNT 火药桶！一发穿甲炮打进城门引发惊天连环殉爆',
    camPos: [22, 17, 24],
    lookAt: [0, 6, 0],
    build() {
      const b = makeBuilder();
      // 4 Corner Watchtowers
      for (const cx of [-8, 8]) {
        for (const cz of [-8, 8]) {
          for (let y = 0; y <= 11; y++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || y === 10) {
                  if (y === 11 && (dx + dz) % 2 !== 0) continue; // Battlements
                  b.set(cx + dx, y, cz + dz, 'concrete');
                }
              }
            }
          }
          b.box(cx - 1, 11, cz - 1, cx + 1, 13, cz + 1, 'brick');
        }
      }

      // Curtain walls
      for (let i = -5; i <= 5; i++) {
        for (let y = 0; y <= 6; y++) {
          if (!(Math.abs(i) <= 1 && y <= 3)) b.set(i, y, 8, 'concrete'); // Front gate arch!
          b.set(i, y, -8, 'concrete');
          b.set(-8, y, i, 'concrete');
          b.set(8, y, i, 'concrete');
        }
      }

      // Central Keep + Massive Underground TNT Powder Vault!
      for (let y = 0; y <= 15; y++) {
        for (let x = -3; x <= 3; x++) {
          for (let z = -3; z <= 3; z++) {
            const wall = Math.abs(x) === 3 || Math.abs(z) === 3;
            if (wall || y === 7 || y === 14) {
              b.set(x, y, z, y > 13 ? 'gold' : 'brick');
            } else if (y <= 3 && Math.abs(x) <= 2 && Math.abs(z) <= 2) {
              b.set(x, y, z, 'tnt');
            }
          }
        }
      }
      // Open front window into TNT vault for sniper trick-shots!
      b.box(-1, 1, 3, 1, 2, 3, 'wood');

      return b.list();
    },
  },
  {
    id: 'tower_crane',
    name: '🏗️ 高空塔吊与红砖居民楼',
    subtitle: '纤细黄色塔吊悬臂下挂满炸药箱！炸断塔身或吊索，让重物直接砸穿旁边 8 层红砖楼',
    camPos: [20, 16, 25],
    lookAt: [1, 8, 0],
    build() {
      const b = makeBuilder();
      // Tall yellow lattice Tower Crane at x = -8, z = 0
      b.box(-9, 0, -1, -7, 1, 1, 'steel');
      for (let y = 2; y <= 21; y++) {
        b.set(-9, y, -1, 'gold');
        b.set(-7, y, -1, 'gold');
        b.set(-9, y, 1, 'gold');
        b.set(-7, y, 1, 'gold');
        if (y % 3 === 0) b.box(-9, y, -1, -7, y, 1, 'gold');
      }
      // Horizontal jib boom extending over the brick apartment (x = -12 .. +10 at y = 20)
      b.box(-12, 20, 0, 10, 21, 0, 'gold');
      b.box(-12, 19, -1, -10, 20, 1, 'concrete'); // Counterweight

      // Hanging TNT cargo crate suspended over the apartment roof!
      for (let y = 15; y <= 19; y++) b.set(5, y, 0, 'steel');
      b.box(4, 13, -1, 6, 14, 1, 'tnt');

      // 8-Story Red Brick Apartment below (x = 1..9, z = -3..3)
      for (let y = 0; y <= 11; y++) {
        for (let x = 1; x <= 9; x++) {
          for (let z = -3; z <= 3; z++) {
            const wall = x === 1 || x === 9 || Math.abs(z) === 3;
            const slab = y % 3 === 0;
            if (slab) b.set(x, y, z, 'wood');
            else if (wall) {
              const isWin = y % 3 === 2 && (x + z) % 2 === 0;
              b.set(x, y, z, isWin ? 'glass' : 'brick');
            }
          }
        }
      }
      return b.list();
    },
  },
  {
    id: 'domino_chain',
    name: '🀄 巨石骨牌与黄金 TNT 金字塔',
    subtitle: '一列高耸巨石立柱直指终点的 TNT 黄金金字塔，用攻城铁球或黑洞开启连锁多米诺狂欢！',
    camPos: [4, 16, 28],
    lookAt: [0, 6, 0],
    build() {
      const b = makeBuilder();
      // 7 Tall Pillars with TNT fuses at their bases leading from left (-14) to right (+4)
      for (let i = 0; i < 7; i++) {
        const x = -14 + i * 3;
        b.box(x, 0, -2, x, 1, 2, 'tnt');
        b.box(x, 2, -2, x, 11 + (i % 2), 2, i % 2 === 0 ? 'glass' : 'concrete');
      }

      // Golden TNT Pyramid Finale on the right (x = 7..15, z = -4..4)
      for (let layer = 0; layer <= 5; layer++) {
        const half = 4 - Math.floor(layer * 0.75);
        for (let dx = -half; dx <= half; dx++) {
          for (let dz = -half; dz <= half; dz++) {
            const edge = Math.abs(dx) === half || Math.abs(dz) === half;
            b.set(11 + dx, layer, dz, edge ? 'gold' : 'tnt');
          }
        }
      }
      return b.list();
    },
  },
];
