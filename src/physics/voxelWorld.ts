import * as THREE from 'three';
import type { DemolitionAudio } from '../audio/demolitionAudio';
import type { VoxelMat, VoxelSeed } from '../world/structures';

interface StaticVoxel {
  x: number;
  y: number;
  z: number;
  mat: VoxelMat;
  color: number;
  hp: number;
}

interface DebrisVoxel {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  rvx: number;
  rvy: number;
  mat: VoxelMat;
  color: number;
  life: number;
  flashTimer: number;
}

interface C4Charge {
  pos: THREE.Vector3;
  mesh: THREE.Group;
  ledMat: THREE.MeshBasicMaterial;
}

interface Singularity {
  pos: THREE.Vector3;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  age: number;
  duration: number;
}

interface TornadoEntity {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  funnel: THREE.Group;
  age: number;
}

interface WreckingBall {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

interface BlastDome {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  progress: number;
  maxRadius: number;
}

const MAT_HP: Record<VoxelMat, number> = {
  glass: 0.4,
  wood: 1.1,
  tnt: 0.5,
  brick: 1.8,
  concrete: 2.4,
  gold: 2.2,
  steel: 4.2,
};

const MAX_INSTANCES = 5000;
const MAX_DEBRIS = 2100;

export class VoxelDemolitionWorld {
  private readonly scene: THREE.Scene;
  private readonly audio: DemolitionAudio;
  public readonly instanced: THREE.InstancedMesh;

  private staticMap = new Map<string, StaticVoxel>();
  private debris: DebrisVoxel[] = [];
  private c4List: C4Charge[] = [];
  private blackHoles: Singularity[] = [];
  private tornadoes: TornadoEntity[] = [];
  private balls: WreckingBall[] = [];
  private domes: BlastDome[] = [];

  private initialCount = 1;
  private destroyedCount = 0;
  private needsCollapseCheck = false;
  private collapseCooldown = 0;

  // Orbital Laser visual
  private laserBeam: THREE.Mesh;
  private laserRing: THREE.Mesh;
  private laserTick = 0;

  public onBlastFeedback: ((trauma: number, hitstopSec: number) => void) | null = null;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  private readonly domeGeo = new THREE.SphereGeometry(1, 22, 16);
  private readonly ringGeo = new THREE.RingGeometry(0.35, 0.58, 32);

  constructor(scene: THREE.Scene, audio: DemolitionAudio) {
    this.scene = scene;
    this.audio = audio;

    const boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    const boxMat = new THREE.MeshStandardMaterial({
      roughness: 0.48,
      metalness: 0.18,
    });
    this.instanced = new THREE.InstancedMesh(boxGeo, boxMat, MAX_INSTANCES);
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.frustumCulled = false;
    // Initialize instanceColor buffer
    for (let i = 0; i < MAX_INSTANCES; i++) {
      this.instanced.setColorAt(i, this.tmpColor.setHex(0xffffff));
    }
    scene.add(this.instanced);

    // Orbital Laser Sky Column
    const lGeo = new THREE.CylinderGeometry(0.42, 0.72, 46, 16, 1, true);
    lGeo.translate(0, 23, 0);
    this.laserBeam = new THREE.Mesh(
      lGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff9424,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.laserBeam.visible = false;
    scene.add(this.laserBeam);

    this.laserRing = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.laserRing.rotation.x = -Math.PI / 2;
    this.laserRing.scale.setScalar(3.5);
    this.laserRing.visible = false;
    scene.add(this.laserRing);
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  public loadStructure(seeds: VoxelSeed[]): void {
    this.clearEntities();
    this.staticMap.clear();
    this.debris.length = 0;

    for (const s of seeds) {
      this.staticMap.set(this.key(s.x, s.y, s.z), {
        ...s,
        hp: MAT_HP[s.mat],
      });
    }
    this.initialCount = Math.max(1, this.staticMap.size);
    this.destroyedCount = 0;
    this.syncInstancedMesh();
  }

  private clearEntities(): void {
    for (const c of this.c4List) this.scene.remove(c.mesh);
    for (const b of this.blackHoles) {
      this.scene.remove(b.core);
      this.scene.remove(b.ring);
    }
    for (const t of this.tornadoes) this.scene.remove(t.funnel);
    for (const w of this.balls) this.scene.remove(w.mesh);
    for (const d of this.domes) {
      this.scene.remove(d.mesh);
      this.scene.remove(d.ring);
      d.mat.dispose();
      d.ringMat.dispose();
    }
    this.c4List.length = 0;
    this.blackHoles.length = 0;
    this.tornadoes.length = 0;
    this.balls.length = 0;
    this.domes.length = 0;
    this.laserBeam.visible = false;
    this.laserRing.visible = false;
    this.audio.setLaserActive(false);
  }

  public getStats(): { destructionPct: number; activeDebris: number; c4Count: number } {
    const remaining = this.staticMap.size;
    const pct = Math.min(100, Math.max(0, Math.round(((this.initialCount - remaining) / this.initialCount) * 100)));
    return {
      destructionPct: pct,
      activeDebris: this.debris.length,
      c4Count: this.c4List.length,
    };
  }

  /** Raycast against all static voxels + ground plane to find exact aim target */
  public raycastTarget(raycaster: THREE.Raycaster): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const hits = raycaster.intersectObject(this.instanced, false);
    if (hits.length > 0 && hits[0].instanceId !== undefined && hits[0].instanceId < this.staticMap.size) {
      return {
        point: hits[0].point.clone(),
        normal: hits[0].face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0),
      };
    }
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, pt)) {
      return { point: pt, normal: new THREE.Vector3(0, 1, 0) };
    }
    return null;
  }

  // ==========================================================================
  // WEAPON 1: C4 Remote Satchel Charges
  // ==========================================================================
  public plantC4(point: THREE.Vector3, normal: THREE.Vector3): void {
    const g = new THREE.Group();
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.24, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x3f4a3c, roughness: 0.6 })
    );
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), ledMat);
    led.position.y = 0.14;
    g.add(pack, led);

    const attachPos = point.clone().addScaledVector(normal, 0.16);
    g.position.copy(attachPos);
    g.lookAt(attachPos.clone().add(normal));
    g.rotateX(Math.PI / 2);
    this.scene.add(g);

    this.c4List.push({ pos: attachPos, mesh: g, ledMat });
    this.audio.playC4Plant(this.c4List.length);
  }

  public detonateAllC4(): number {
    if (this.c4List.length === 0) return 0;
    const charges = [...this.c4List];
    this.c4List.length = 0;
    this.audio.playDetonateBeep();

    charges.forEach((c, idx) => {
      setTimeout(() => {
        this.scene.remove(c.mesh);
        this.explodeSphere(c.pos, 4.4, 5.5, true);
      }, 95 + idx * 85);
    });
    return charges.length;
  }

  // ==========================================================================
  // WEAPON 2: Singularity Black Hole
  // ==========================================================================
  public spawnBlackHole(point: THREE.Vector3): void {
    const pos = point.clone().add(new THREE.Vector3(0, 3.2, 0));
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 24, 20),
      new THREE.MeshBasicMaterial({ color: 0x05020a })
    );
    core.position.copy(pos);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.16, 12, 36),
      new THREE.MeshBasicMaterial({
        color: 0xc084fc,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
      })
    );
    ring.position.copy(pos);
    ring.rotation.x = Math.PI * 0.38;

    this.scene.add(core, ring);
    this.blackHoles.push({ pos, core, ring, age: 0, duration: 2.35 });
    this.audio.playBlackHoleSpawn();
    this.onBlastFeedback?.(0.32, 0);
  }

  // ==========================================================================
  // WEAPON 3: .50 Rail-Cannon Penetrator
  // ==========================================================================
  public fireRailCannon(origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.audio.playRailCannon();
    this.onBlastFeedback?.(0.38, 0.035);

    const endPt = origin.clone().addScaledVector(dir, 58);
    // Additive rail beam flash
    const beamGeo = new THREE.BufferGeometry().setFromPoints([origin.clone(), endPt]);
    const beamMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 1 });
    const line = new THREE.Line(beamGeo, beamMat);
    this.scene.add(line);
    setTimeout(() => {
      this.scene.remove(line);
      beamGeo.dispose();
      beamMat.dispose();
    }, 110);

    // Punch cylindrical tunnel along ray!
    for (let d = 2; d < 55; d += 0.75) {
      const sample = origin.clone().addScaledVector(dir, d);
      this.carveRadius(sample, 1.55, 6.0, dir.clone().multiplyScalar(14));
    }
    this.needsCollapseCheck = true;
  }

  // ==========================================================================
  // WEAPON 4: EF5 Roaming Tornado
  // ==========================================================================
  public spawnTornado(point: THREE.Vector3): void {
    const funnel = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const r = 0.7 + i * 0.42;
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.14, 8, 24),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0x94a3b8 : 0x38bdf8,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
        })
      );
      torus.rotation.x = Math.PI / 2;
      torus.position.y = i * 1.9 + 0.6;
      funnel.add(torus);
    }
    const pos = point.clone().setY(0);
    funnel.position.copy(pos);
    this.scene.add(funnel);

    const angle = Math.random() * Math.PI * 2;
    this.tornadoes.push({
      pos,
      vel: new THREE.Vector3(Math.cos(angle) * 2.8, 0, Math.sin(angle) * 2.8),
      funnel,
      age: 0,
    });
    this.audio.playWreckingThrow();
  }

  // ==========================================================================
  // WEAPON 5: Orbital Plasma Laser
  // ==========================================================================
  public setOrbitalLaser(active: boolean, targetPoint?: THREE.Vector3, dt = 0.016): void {
    this.laserBeam.visible = active && Boolean(targetPoint);
    this.laserRing.visible = this.laserBeam.visible;
    this.audio.setLaserActive(this.laserBeam.visible);

    if (!active || !targetPoint) return;
    this.laserBeam.position.set(targetPoint.x, 0, targetPoint.z);
    this.laserRing.position.set(targetPoint.x, 0.08, targetPoint.z);
    const pulse = 0.85 + Math.sin(performance.now() * 0.04) * 0.25;
    this.laserBeam.scale.set(pulse, 1, pulse);

    this.laserTick -= dt;
    if (this.laserTick <= 0) {
      this.laserTick = 0.055;
      // Slice vertically from sky to ground at target XZ!
      for (let y = 0; y <= 24; y += 1.5) {
        this.carveRadius(new THREE.Vector3(targetPoint.x, y, targetPoint.z), 1.85, 5.0);
      }
      this.needsCollapseCheck = true;
      this.onBlastFeedback?.(0.12, 0);
    }
  }

  // ==========================================================================
  // WEAPON 6: Giant Wrecking Meteor Ball
  // ==========================================================================
  public throwWreckingBall(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.35, 1),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.88, roughness: 0.22 })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    this.balls.push({
      mesh,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(32),
      life: 3.5,
    });
    this.audio.playWreckingThrow();
  }

  // ==========================================================================
  // Core Spherical Blast + GLSL Fresnel Shock Dome + Secondary TNT Chain!
  // ==========================================================================
  public explodeSphere(center: THREE.Vector3, radius: number, power: number, spawnVisual = true): void {
    if (spawnVisual) {
      this.spawnFresnelBlastDome(center, radius * 1.15);
      this.audio.playExplosion(radius / 4.2);
      this.onBlastFeedback?.(Math.min(0.75, radius * 0.12), radius >= 4.2 ? 0.055 : 0.025);
    }

    const secondaryTnts: THREE.Vector3[] = [];
    const rCeil = Math.ceil(radius);
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    const cz = Math.round(center.z);

    for (let x = cx - rCeil; x <= cx + rCeil; x++) {
      for (let y = Math.max(0, cy - rCeil); y <= cy + rCeil; y++) {
        for (let z = cz - rCeil; z <= cz + rCeil; z++) {
          const k = this.key(x, y, z);
          const v = this.staticMap.get(k);
          if (!v) continue;

          const dx = x - center.x;
          const dy = y - center.y;
          const dz = z - center.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > radius) continue;

          const dmg = power * (1 - dist / (radius + 0.5));
          v.hp -= dmg;
          if (v.hp <= 0) {
            this.staticMap.delete(k);
            this.destroyedCount++;
            if (v.mat === 'glass') this.audio.playGlassShatter();
            if (v.mat === 'tnt') {
              secondaryTnts.push(new THREE.Vector3(v.x, v.y + 0.5, v.z));
            } else if (this.debris.length < MAX_DEBRIS && Math.random() < 0.72) {
              const outLen = Math.max(0.2, dist);
              const spd = (5 + Math.random() * 11) * (1 - dist / (radius + 1));
              this.spawnDebris(
                v,
                (dx / outLen) * spd,
                Math.abs(dy / outLen) * spd + 4.5 + Math.random() * 5,
                (dz / outLen) * spd,
                0.08
              );
            }
          }
        }
      }
    }

    // Push nearby loose debris outward too!
    for (const d of this.debris) {
      const dx = d.x - center.x;
      const dy = d.y - center.y;
      const dz = d.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < radius * radius * 2.2 && distSq > 0.01) {
        const dist = Math.sqrt(distSq);
        const kick = (14 * (1 - dist / (radius * 1.5))) / Math.max(0.6, dist);
        d.vx += dx * kick;
        d.vy += Math.abs(dy) * kick + 4;
        d.vz += dz * kick;
      }
    }

    this.needsCollapseCheck = true;

    // Staggered chain-reaction TNT explosions!
    secondaryTnts.slice(0, 6).forEach((tPos, idx) => {
      setTimeout(() => {
        this.explodeSphere(tPos, 4.6, 6.2, idx < 3);
      }, 65 + idx * 55);
    });
  }

  private carveRadius(center: THREE.Vector3, radius: number, power: number, impulse?: THREE.Vector3): void {
    const rCeil = Math.ceil(radius);
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    const cz = Math.round(center.z);
    for (let x = cx - rCeil; x <= cx + rCeil; x++) {
      for (let y = Math.max(0, cy - rCeil); y <= cy + rCeil; y++) {
        for (let z = cz - rCeil; z <= cz + rCeil; z++) {
          const k = this.key(x, y, z);
          const v = this.staticMap.get(k);
          if (!v) continue;
          const dist = Math.hypot(x - center.x, y - center.y, z - center.z);
          if (dist > radius) continue;
          v.hp -= power;
          if (v.hp <= 0) {
            this.staticMap.delete(k);
            this.destroyedCount++;
            if (v.mat === 'tnt') {
              setTimeout(() => this.explodeSphere(new THREE.Vector3(v.x, v.y, v.z), 4.5, 6.0, true), 40);
            } else if (this.debris.length < MAX_DEBRIS && Math.random() < 0.55) {
              this.spawnDebris(
                v,
                (impulse?.x ?? 0) * 0.4 + (Math.random() - 0.5) * 6,
                2.5 + Math.random() * 4,
                (impulse?.z ?? 0) * 0.4 + (Math.random() - 0.5) * 6,
                0.07
              );
            }
          }
        }
      }
    }
  }

  private spawnDebris(v: StaticVoxel, vx: number, vy: number, vz: number, flashTimer = 0): void {
    if (this.debris.length >= MAX_DEBRIS) {
      this.debris.shift();
    }
    this.debris.push({
      x: v.x,
      y: v.y + 0.5,
      z: v.z,
      vx,
      vy,
      vz,
      rx: 0,
      ry: 0,
      rz: 0,
      rvx: (Math.random() - 0.5) * 9,
      rvy: (Math.random() - 0.5) * 9,
      mat: v.mat,
      color: v.color,
      life: 5.5 + Math.random() * 3.0,
      flashTimer,
    });
  }

  /**
   * 6-Neighbor BFS Structural Integrity Solver:
   * Any static block no longer connected to the ground (`y === 0`) detaches and collapses!
   */
  private runStructuralCollapseBfs(): void {
    const grounded = new Set<string>();
    const queue: StaticVoxel[] = [];

    for (const [k, v] of this.staticMap) {
      if (v.y === 0) {
        grounded.add(k);
        queue.push(v);
      }
    }

    let head = 0;
    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    while (head < queue.length) {
      const cur = queue[head++];
      for (let i = 0; i < 6; i++) {
        const nk = this.key(cur.x + dirs[i][0], cur.y + dirs[i][1], cur.z + dirs[i][2]);
        if (!grounded.has(nk)) {
          const nb = this.staticMap.get(nk);
          if (nb) {
            grounded.add(nk);
            queue.push(nb);
          }
        }
      }
    }

    // Detach all unsupported floating blocks with realistic toppling drift!
    let collapsed = 0;
    const tiltDirX = (Math.random() - 0.5) * 2.4;
    const tiltDirZ = (Math.random() - 0.5) * 2.4;

    for (const [k, v] of [...this.staticMap]) {
      if (!grounded.has(k)) {
        this.staticMap.delete(k);
        collapsed++;
        const heightFactor = Math.min(2.5, v.y * 0.12);
        this.spawnDebris(
          v,
          tiltDirX * heightFactor + (Math.random() - 0.5) * 1.4,
          -0.5,
          tiltDirZ * heightFactor + (Math.random() - 0.5) * 1.4,
          0
        );
      }
    }

    if (collapsed > 8) {
      this.audio.playRubbleCrunch(Math.min(3, collapsed / 25));
      this.onBlastFeedback?.(Math.min(0.45, collapsed * 0.004), 0);
    }
  }

  private spawnFresnelBlastDome(pos: THREE.Vector3, maxRadius: number): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uCore: { value: new THREE.Color(0xfff4b8) },
        uRim: { value: new THREE.Color(0xff521b) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress; uniform vec3 uCore; uniform vec3 uRim;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          float a = (0.24 + f * 0.95) * pow(max(0.0, 1.0 - uProgress), 1.5);
          gl_FragColor = vec4(mix(uCore, uRim, f) * 1.45, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(this.domeGeo, mat);
    mesh.position.copy(pos);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff9f2e,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.set(pos.x, 0.08, pos.z);
    ring.rotation.x = -Math.PI / 2;

    this.scene.add(mesh, ring);
    this.domes.push({ mesh, mat, ring, ringMat, progress: 0, maxRadius });
  }

  public update(rawDt: number, scaledDt: number, elapsed: number): void {
    // 1. C4 LED blink
    const blinkOn = Math.sin(elapsed * 14) > 0;
    for (const c of this.c4List) {
      c.ledMat.color.setHex(blinkOn ? 0xff2a2a : 0x3b0707);
    }

    // 2. Structural BFS Collapse Check (throttled every 90ms for butter-smooth perf)
    if (this.needsCollapseCheck) {
      this.collapseCooldown -= rawDt;
      if (this.collapseCooldown <= 0) {
        this.needsCollapseCheck = false;
        this.collapseCooldown = 0.09;
        this.runStructuralCollapseBfs();
      }
    }

    // 3. Singularity Black Holes
    for (let i = this.blackHoles.length - 1; i >= 0; i--) {
      const bh = this.blackHoles[i];
      bh.age += scaledDt;
      bh.ring.rotation.z += scaledDt * 9;
      bh.core.scale.setScalar(0.85 + Math.sin(elapsed * 22) * 0.12 + bh.age * 0.25);

      // Rip nearby static voxels out into orbit!
      if (Math.random() < 0.65) {
        this.carveRadius(bh.pos, 3.2 + bh.age * 1.5, 2.5);
        this.needsCollapseCheck = true;
      }

      // Swirl debris into orbital accretion disk!
      for (const d of this.debris) {
        const dx = bh.pos.x - d.x;
        const dy = bh.pos.y - d.y;
        const dz = bh.pos.z - d.z;
        const dist = Math.hypot(dx, dy, dz) + 0.1;
        if (dist < 16) {
          const pull = 36 / Math.max(1.2, dist * 0.55);
          d.vx += (dx / dist - dz / dist * 0.65) * pull * scaledDt;
          d.vy += (dy / dist) * pull * scaledDt;
          d.vz += (dz / dist + dx / dist * 0.65) * pull * scaledDt;
        }
      }

      if (bh.age >= bh.duration) {
        this.scene.remove(bh.core);
        this.scene.remove(bh.ring);
        this.blackHoles.splice(i, 1);
        this.audio.playBlackHoleSupernova();
        this.explodeSphere(bh.pos, 7.2, 9.0, true);
      }
    }

    // 4. EF5 Tornadoes
    for (let i = this.tornadoes.length - 1; i >= 0; i--) {
      const tn = this.tornadoes[i];
      tn.age += scaledDt;
      tn.pos.addScaledVector(tn.vel, scaledDt);
      tn.funnel.position.copy(tn.pos);
      tn.funnel.rotation.y += scaledDt * 11;

      for (let y = 0; y <= 16; y += 2) {
        this.carveRadius(new THREE.Vector3(tn.pos.x, y, tn.pos.z), 2.4 + y * 0.12, 1.8);
      }
      this.needsCollapseCheck = true;

      for (const d of this.debris) {
        const dx = tn.pos.x - d.x;
        const dz = tn.pos.z - d.z;
        const distXZ = Math.hypot(dx, dz) + 0.1;
        if (distXZ < 11) {
          d.vx += (-dz / distXZ * 22 + dx / distXZ * 8) * scaledDt;
          d.vz += (dx / distXZ * 22 + dz / distXZ * 8) * scaledDt;
          d.vy += 26 * scaledDt;
        }
      }

      if (tn.age >= 5.5) {
        this.scene.remove(tn.funnel);
        this.tornadoes.splice(i, 1);
      }
    }

    // 5. Wrecking Meteor Balls
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.life -= scaledDt;
      b.vel.y -= 16 * scaledDt;
      b.pos.addScaledVector(b.vel, scaledDt);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += scaledDt * 8;

      if (b.pos.y < 1.35) {
        b.pos.y = 1.35;
        b.vel.y = Math.abs(b.vel.y) * 0.55;
        b.vel.x *= 0.82;
        b.vel.z *= 0.82;
      }

      const beforeSize = this.staticMap.size;
      this.carveRadius(b.pos, 2.35, 8.0, b.vel);
      if (this.staticMap.size < beforeSize) {
        this.audio.playRubbleCrunch(2.2);
        this.onBlastFeedback?.(0.28, 0.02);
        b.vel.multiplyScalar(0.86);
        this.needsCollapseCheck = true;
      }

      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.balls.splice(i, 1);
      }
    }

    // 6. Dynamic Falling & Bouncing Voxel Debris (+ Falling TNT Impact Detonation!)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= scaledDt;
      if (d.flashTimer > 0) d.flashTimer -= rawDt;

      d.vy -= 22 * scaledDt;
      d.x += d.vx * scaledDt;
      d.y += d.vy * scaledDt;
      d.z += d.vz * scaledDt;
      d.rx += d.rvx * scaledDt;
      d.ry += d.rvy * scaledDt;

      if (d.y <= 0.48) {
        const impactSpd = Math.abs(d.vy);
        d.y = 0.48;
        if (d.mat === 'tnt' && impactSpd > 6.5) {
          // Falling TNT block slams ground & DETONATES!
          const bPos = new THREE.Vector3(d.x, 0.8, d.z);
          this.debris.splice(i, 1);
          this.explodeSphere(bPos, 4.8, 6.5, true);
          continue;
        }
        if (impactSpd > 4.5) {
          this.audio.playRubbleCrunch(impactSpd * 0.08);
        }
        d.vy = impactSpd * 0.36;
        d.vx *= 0.72;
        d.vz *= 0.72;
        d.rvx *= 0.65;
        d.rvy *= 0.65;
      }

      if (d.life <= 0) {
        this.debris.splice(i, 1);
      }
    }

    // 7. Fresnel Blast Domes (tick on rawDt so they shimmer during hitstop!)
    for (let i = this.domes.length - 1; i >= 0; i--) {
      const dm = this.domes[i];
      dm.progress += rawDt * 2.5;
      dm.mat.uniforms.uProgress.value = dm.progress;
      const s = 0.35 + Math.pow(Math.min(1, dm.progress), 0.55) * dm.maxRadius;
      dm.mesh.scale.setScalar(s);
      dm.ring.scale.setScalar(s * 1.45);
      dm.ringMat.opacity = Math.max(0, 1 - dm.progress) * 0.85;
      if (dm.progress >= 1) {
        this.scene.remove(dm.mesh);
        this.scene.remove(dm.ring);
        dm.mat.dispose();
        dm.ringMat.dispose();
        this.domes.splice(i, 1);
      }
    }

    this.syncInstancedMesh();
  }

  private syncInstancedMesh(): void {
    let idx = 0;

    for (const v of this.staticMap.values()) {
      if (idx >= MAX_INSTANCES) break;
      this.dummy.position.set(v.x, v.y + 0.5, v.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(idx, this.dummy.matrix);
      this.instanced.setColorAt(idx, this.tmpColor.setHex(v.color));
      idx++;
    }

    for (const d of this.debris) {
      if (idx >= MAX_INSTANCES) break;
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.rotation.set(d.rx, d.ry, d.rz);
      const shrink = d.life < 0.8 ? Math.max(0.05, d.life / 0.8) : 1;
      this.dummy.scale.setScalar(shrink);
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(idx, this.dummy.matrix);
      // 2-Frame white hit-flash on newly blasted debris ($gamefeel-3d Rule #5)
      this.instanced.setColorAt(idx, this.tmpColor.setHex(d.flashTimer > 0 ? 0xffffff : d.color));
      idx++;
    }

    this.instanced.count = idx;
    this.instanced.instanceMatrix.needsUpdate = true;
    if (this.instanced.instanceColor) this.instanced.instanceColor.needsUpdate = true;
  }
}
