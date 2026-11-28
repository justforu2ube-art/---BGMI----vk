import * as THREE from 'three';
import { WEAPON_ORDER, WeaponId } from './weaponTypes';
import { WeaponMaterials } from './weaponMaterials';
import {
  BuiltWeapon,
  LiveAmmoVisuals,
  createBarrelGeo,
  createBeveledOpticHoodGeo,
  createBeveledProfileGeo,
  createCartridgeMesh,
  createChamferedBoxGeo,
  createPicatinnyStrip,
  createShotgunShellMesh,
} from './weaponGeoHelpers';

function countWeaponStats(root: THREE.Object3D): { triangleCount: number; materialSlots: number } {
  let tris = 0;
  const matSet = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      const geo = obj.geometry;
      tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) if (m) matSet.add(m);
    }
  });
  return { triangleCount: Math.round(tris), materialSlots: matSet.size };
}

function finalizeWeapon(
  id: WeaponId,
  root: THREE.Group,
  sockets: ReturnType<typeof createWeaponSockets>,
  boltTravelMax: number,
  boltLiftMax: number,
  ammoVisuals: LiveAmmoVisuals
): BuiltWeapon {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
    }
  });

  const { triangleCount, materialSlots } = countWeaponStats(root);

  return {
    id,
    root,
    gripRight: sockets.gripRight,
    gripLeft: sockets.gripLeft,
    muzzleTip: sockets.muzzleSocket,
    ejectionPort: sockets.ejectionPortSocket,
    magPivot: sockets.magPivot,
    boltOrSlide: sockets.boltOrSlide,
    triggerPivot: sockets.triggerPivot,
    laserOrigin: sockets.laserSocket,
    muzzleSocket: sockets.muzzleSocket,
    laserSocket: sockets.laserSocket,
    opticEyeSocket: sockets.opticEyeSocket,
    ejectionPortSocket: sockets.ejectionPortSocket,
    weaponLightSocket: sockets.weaponLightSocket,
    magRestPos: sockets.magPivot.position.clone(),
    magRestRot: sockets.magPivot.rotation.clone(),
    boltRestPos: sockets.boltOrSlide.position.clone(),
    boltRestRot: sockets.boltOrSlide.rotation.clone(),
    boltTravelMax,
    boltLiftMax,
    ammoVisuals,
    materialSlots,
    triangleCount,
    dispose: () => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          obj.geometry.dispose();
        }
      });
    },
  };
}

function createWeaponSockets(root: THREE.Group) {
  const mk = (name: string) => {
    const o = new THREE.Object3D();
    o.name = name;
    root.add(o);
    return o;
  };
  const gripRight = mk('Grip_Right');
  const gripLeft = mk('Grip_Left');
  const muzzleSocket = mk('muzzle_socket');
  const ejectionPortSocket = mk('ejection_port_socket');
  const laserSocket = mk('laser_socket');
  const opticEyeSocket = mk('optic_eye_socket');
  const weaponLightSocket = mk('weapon_light_socket');

  const magPivot = new THREE.Group();
  magPivot.name = 'Mag_Pivot';
  root.add(magPivot);

  const boltOrSlide = new THREE.Group();
  boltOrSlide.name = 'Bolt_Or_Slide';
  root.add(boltOrSlide);

  const triggerPivot = new THREE.Group();
  triggerPivot.name = 'Trigger_Pivot';
  root.add(triggerPivot);

  return {
    gripRight,
    gripLeft,
    muzzleSocket,
    ejectionPortSocket,
    laserSocket,
    opticEyeSocket,
    weaponLightSocket,
    magPivot,
    boltOrSlide,
    triggerPivot,
  };
}

/**
 * Helper to build a translucent windowed tactical magazine with visible stacked cartridges
 * and rising spring follower (depletes on fire, refills on reload!).
 */
function buildWindowedMagazine(
  mats: WeaponMaterials,
  opts: {
    width: number;
    depth: number;
    height: number;
    curveAngle?: number;
    slots: number;
    bodyHex: number;
    cartLen: number;
    cartRad: number;
  }
): { group: THREE.Group; rounds: THREE.Object3D[]; follower: THREE.Mesh; botY: number; topY: number } {
  const g = new THREE.Group();
  const h = opts.height;
  const w = opts.width;
  const d = opts.depth;

  // Front & rear polymer spine walls framing clear side windows
  const frontWall = new THREE.Mesh(
    createChamferedBoxGeo(w, h, d * 0.24, 0.0014, false, opts.bodyHex),
    mats.polymer
  );
  frontWall.position.set(0, -h * 0.5, d * 0.38);
  g.add(frontWall);

  const rearWall = new THREE.Mesh(
    createChamferedBoxGeo(w, h, d * 0.24, 0.0014, false, opts.bodyHex),
    mats.polymer
  );
  rearWall.position.set(0, -h * 0.5, -d * 0.38);
  g.add(rearWall);

  // Top feed collar & flared floorplate
  const collar = new THREE.Mesh(
    createChamferedBoxGeo(w * 1.02, h * 0.16, d, 0.0014, false, opts.bodyHex),
    mats.polymer
  );
  collar.position.set(0, -h * 0.08, 0);
  g.add(collar);

  const floorplate = new THREE.Mesh(
    createChamferedBoxGeo(w * 1.12, 0.014, d * 1.10, 0.0018, false, opts.bodyHex),
    mats.polymer
  );
  floorplate.position.set(0, -h - 0.004, 0);
  g.add(floorplate);

  // Translucent smoked polymer ammo window panes (uses Slot 3 opticGlass -> <= 4 slots!)
  const winPane = new THREE.Mesh(
    createChamferedBoxGeo(w * 0.88, h * 0.72, d * 0.54, 0.0008, false, 0xd8e2ea),
    mats.opticGlass
  );
  winPane.position.set(0, -h * 0.52, 0);
  g.add(winPane);

  // Stacked live cartridges visible through window (bottom -> top)
  const rounds: THREE.Object3D[] = [];
  const botY = -h * 0.84;
  const topY = -h * 0.19;
  for (let i = 0; i < opts.slots; i++) {
    const t = opts.slots > 1 ? i / (opts.slots - 1) : 1;
    const cart = createCartridgeMesh(opts.cartLen, opts.cartRad, mats.ammoAccent);
    cart.position.set((i % 2 === 0 ? -1 : 1) * 0.0022, THREE.MathUtils.lerp(botY, topY, t), 0);
    g.add(cart);
    rounds.push(cart);
  }

  // High-visibility orange/tan spring follower rising as cartridges deplete
  const follower = new THREE.Mesh(
    createChamferedBoxGeo(w * 0.68, 0.007, d * 0.46, 0.001, false, 0xd96b2b),
    mats.ammoAccent
  );
  follower.position.set(0, botY, 0);
  g.add(follower);

  if (opts.curveAngle) {
    g.rotation.x = opts.curveAngle;
  }

  return { group: g, rounds, follower, botY, topY };
}

// ============================================================================
// [1] MK18 MOD 1 CQBR CARBINE (5.56x45mm NATO) — <= 4 Material Slots, Chamfered EOTech
// ============================================================================
export function buildMK18(mats: WeaponMaterials): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_MK18_Mod1';
  const s = createWeaponSockets(root);

  // 1. Chamfered AR-15 Lower + Upper Receiver (beveled ExtrudeGeometry + dihedral wear)
  const lower = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.036, 0.068],
        [0.168, 0.068],
        [0.168, 0.012],
        [0.100, 0.010],
        [0.088, 0.038],
        [0.014, 0.038],
        [-0.036, 0.052],
      ],
      0.036,
      0.0024,
      undefined,
      true,
      0xcfd5dc
    ),
    mats.metal
  );
  root.add(lower);

  const upper = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.044, 0.068],
        [0.172, 0.068],
        [0.172, 0.114],
        [-0.044, 0.114],
      ],
      0.036,
      0.0022,
      undefined,
      true,
      0xd8dee6
    ),
    mats.metal
  );
  root.add(upper);

  // Ergonomic angled pistol grip (FDE polymer via COLOR_0)
  const grip = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.036, 0.046],
        [0.008, 0.044],
        [-0.014, -0.058],
        [-0.052, -0.052],
      ],
      0.030,
      0.0032,
      undefined,
      false,
      0x9a8868
    ),
    mats.polymer
  );
  root.add(grip);

  // Trigger guard & curved trigger blade
  const trigGuard = new THREE.Mesh(
    createChamferedBoxGeo(0.014, 0.006, 0.072, 0.0012, true, 0xc2c8d0),
    mats.metal
  );
  trigGuard.position.set(0, 0.012, 0.056);
  root.add(trigGuard);

  const trigBlade = new THREE.Mesh(
    createChamferedBoxGeo(0.006, 0.024, 0.007, 0.001, true, 0xb8bec6),
    mats.metal
  );
  trigBlade.position.set(0, -0.010, 0.002);
  s.triggerPivot.position.set(0, 0.038, 0.048);
  s.triggerPivot.add(trigBlade);

  // Buffer tube + SOPMOD FDE collapsible stock
  const buffer = new THREE.Mesh(createBarrelGeo(0.016, 0.016, 0.18, 12, true, 0xc5cbd2), mats.metal);
  buffer.position.set(0, 0.090, -0.132);
  root.add(buffer);

  const stock = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.258, 0.112],
        [-0.088, 0.112],
        [-0.096, 0.058],
        [-0.258, -0.004],
      ],
      0.042,
      0.004,
      undefined,
      false,
      0x9d8a6a
    ),
    mats.polymer
  );
  root.add(stock);

  // Daniel Defense RIS II Quad Rail Handguard + Top Picatinny + Barrel + SOCOM Suppressor
  const handguard = new THREE.Mesh(
    createChamferedBoxGeo(0.048, 0.052, 0.245, 0.003, true, 0x8e7c64),
    mats.metal
  );
  handguard.position.set(0, 0.090, 0.296);
  root.add(handguard);
  root.add(createPicatinnyStrip(0.42, 0.022, 0.117, 0.20, mats.metal));

  // Angled Foregrip (AFG)
  const afg = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [0.240, 0.064],
        [0.365, 0.064],
        [0.352, 0.030],
        [0.268, 0.038],
      ],
      0.032,
      0.003,
      undefined,
      false,
      0x2f3338
    ),
    mats.polymer
  );
  root.add(afg);

  // 10.3" Heavy Barrel + Flash Hider / Suppressor
  const barrel = new THREE.Mesh(createBarrelGeo(0.0105, 0.0115, 0.28, 12, true, 0xbec5ce), mats.metal);
  barrel.position.set(0, 0.090, 0.36);
  root.add(barrel);

  const muzzleDev = new THREE.Mesh(createBarrelGeo(0.0145, 0.0135, 0.068, 12, true, 0xb0b8c2), mats.metal);
  muzzleDev.position.set(0, 0.090, 0.515);
  root.add(muzzleDev);

  // Chamfered Beveled EOTech EXPS3 Holographic Sight (ExtrudeGeometry hood + AR iridescent lens + red reticle!)
  const eoBase = new THREE.Mesh(createChamferedBoxGeo(0.044, 0.018, 0.088, 0.0022, true, 0x98886c), mats.metal);
  eoBase.position.set(0, 0.128, 0.088);
  root.add(eoBase);

  const eoHood = new THREE.Mesh(
    createBeveledOpticHoodGeo(0.046, 0.044, 0.034, 0.032, 0.056, 0.0022, 0x9c8c70),
    mats.metal
  );
  eoHood.position.set(0, 0.156, 0.082);
  root.add(eoHood);

  const eoLens = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.030), mats.opticGlass);
  eoLens.position.set(0, 0.156, 0.082);
  root.add(eoLens);

  const eoDot = new THREE.Mesh(
    createChamferedBoxGeo(0.0035, 0.0035, 0.002, 0.0005, false, 0xff2a2a),
    mats.ammoAccent
  );
  eoDot.position.set(0, 0.156, 0.080);
  root.add(eoDot);

  // PEQ-15 Tactical Laser Module on top rail
  const peq = new THREE.Mesh(createChamferedBoxGeo(0.042, 0.022, 0.084, 0.0022, false, 0x98876a), mats.polymer);
  peq.position.set(0.012, 0.129, 0.34);
  root.add(peq);

  // Reciprocating Bolt Carrier + Visible Chamber Brass
  const boltCarrier = new THREE.Mesh(createChamferedBoxGeo(0.016, 0.018, 0.078, 0.0014, true, 0xd8dee6), mats.metal);
  s.boltOrSlide.position.set(-0.011, 0.090, 0.088);
  s.boltOrSlide.add(boltCarrier);

  const chamberRound = createCartridgeMesh(0.048, 0.0046, mats.ammoAccent);
  chamberRound.position.set(-0.012, 0.086, 0.118);
  root.add(chamberRound);

  // Translucent Windowed PMAG with 12 visible live 5.56 brass/copper rounds + rising follower
  const mag = buildWindowedMagazine(mats, {
    width: 0.024,
    depth: 0.058,
    height: 0.158,
    curveAngle: 0.11,
    slots: 12,
    bodyHex: 0x9a8868,
    cartLen: 0.046,
    cartRad: 0.0044,
  });
  s.magPivot.position.set(0, 0.022, 0.132);
  s.magPivot.add(mag.group);

  // Sockets
  s.gripRight.position.set(0, -0.008, -0.018);
  s.gripLeft.position.set(0, 0.044, 0.305);
  s.muzzleSocket.position.set(0, 0.090, 0.555);
  s.ejectionPortSocket.position.set(-0.022, 0.092, 0.105);
  s.laserSocket.position.set(0.022, 0.130, 0.386);
  s.opticEyeSocket.position.set(0, 0.156, 0.048);
  s.weaponLightSocket.position.set(-0.024, 0.095, 0.395);

  return finalizeWeapon('mk18', root, s, 0.055, 0, {
    magRounds: mag.rounds,
    magFollower: mag.follower,
    followerBottomY: mag.botY,
    followerTopY: mag.topY,
    chamberRound,
  });
}

// ============================================================================
// [2] AK-74M / MODERNIZED AKM (7.62x39mm) — Beveled Kobra Optic + Windowed Mag
// ============================================================================
export function buildAK74M(mats: WeaponMaterials): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_AK74M';
  const s = createWeaponSockets(root);

  // Stamped beveled receiver + sloped top dust cover
  const receiver = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.045, 0.036],
        [0.195, 0.036],
        [0.195, 0.106],
        [-0.045, 0.106],
      ],
      0.036,
      0.0024,
      undefined,
      true,
      0xc2c8d0
    ),
    mats.metal
  );
  root.add(receiver);

  // Bakelite pistol grip
  const grip = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.032, 0.038],
        [0.008, 0.036],
        [-0.016, -0.062],
        [-0.050, -0.056],
      ],
      0.029,
      0.0032,
      undefined,
      false,
      0x7c3e26
    ),
    mats.polymer
  );
  root.add(grip);

  // Trigger guard & trigger
  const trigGuard = new THREE.Mesh(createChamferedBoxGeo(0.014, 0.005, 0.068, 0.001, true, 0xb8bec6), mats.metal);
  trigGuard.position.set(0, 0.008, 0.048);
  root.add(trigGuard);

  const trigBlade = new THREE.Mesh(createChamferedBoxGeo(0.006, 0.024, 0.007, 0.001, true, 0xc2c8d0), mats.metal);
  trigBlade.position.set(0, -0.010, 0.002);
  s.triggerPivot.position.set(0, 0.034, 0.044);
  s.triggerPivot.add(trigBlade);

  // Classic oiled laminated Russian wood buttstock
  const stock = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.275, 0.088],
        [-0.045, 0.096],
        [-0.045, 0.044],
        [-0.275, -0.022],
      ],
      0.036,
      0.004,
      undefined,
      false,
      0x8b4d2b
    ),
    mats.polymer
  );
  root.add(stock);

  // Wooden handguard + upper gas tube + iconic AK front sight post + muzzle brake
  const handguard = new THREE.Mesh(
    createChamferedBoxGeo(0.042, 0.054, 0.178, 0.004, false, 0x8d4e2c),
    mats.polymer
  );
  handguard.position.set(0, 0.072, 0.285);
  root.add(handguard);

  const gasTube = new THREE.Mesh(createBarrelGeo(0.011, 0.011, 0.22, 10, true, 0xbfc5cd), mats.metal);
  gasTube.position.set(0, 0.102, 0.30);
  root.add(gasTube);

  const barrel = new THREE.Mesh(createBarrelGeo(0.010, 0.011, 0.38, 12, true, 0xbec4cc), mats.metal);
  barrel.position.set(0, 0.074, 0.385);
  root.add(barrel);

  const frontSight = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [0.495, 0.072],
        [0.530, 0.072],
        [0.522, 0.132],
        [0.506, 0.132],
      ],
      0.018,
      0.0014,
      undefined,
      true,
      0xc2c8d0
    ),
    mats.metal
  );
  root.add(frontSight);

  const muzzleBrake = new THREE.Mesh(createBarrelGeo(0.014, 0.013, 0.064, 12, true, 0xb2b8c0), mats.metal);
  muzzleBrake.position.set(0, 0.074, 0.590);
  root.add(muzzleBrake);

  // Side-mount Dovetail + Chamfered Beveled Kobra Reflex Sight (ExtrudeGeometry hood + AR iridescent lens!)
  const sideMount = new THREE.Mesh(createChamferedBoxGeo(0.010, 0.048, 0.092, 0.0014, true, 0xb8bec6), mats.metal);
  sideMount.position.set(0.022, 0.105, 0.068);
  root.add(sideMount);

  const kobraBase = new THREE.Mesh(createChamferedBoxGeo(0.038, 0.018, 0.086, 0.002, true, 0xc0c6ce), mats.metal);
  kobraBase.position.set(0, 0.125, 0.078);
  root.add(kobraBase);

  const kobraHood = new THREE.Mesh(
    createBeveledOpticHoodGeo(0.044, 0.038, 0.032, 0.026, 0.052, 0.002, 0xc8ced6),
    mats.metal
  );
  kobraHood.position.set(0, 0.150, 0.082);
  root.add(kobraHood);

  const kobraLens = new THREE.Mesh(new THREE.PlaneGeometry(0.030, 0.024), mats.opticGlass);
  kobraLens.position.set(0, 0.150, 0.082);
  root.add(kobraLens);

  const kobraDot = new THREE.Mesh(
    createChamferedBoxGeo(0.0032, 0.0032, 0.002, 0.0005, false, 0xff2a2a),
    mats.ammoAccent
  );
  kobraDot.position.set(0, 0.150, 0.080);
  root.add(kobraDot);

  // Reciprocating Charging Handle Bolt Carrier + Chamber Round
  const boltBody = new THREE.Mesh(createChamferedBoxGeo(0.014, 0.016, 0.082, 0.0012, true, 0xe2e7ee), mats.metal);
  const boltHandle = new THREE.Mesh(createChamferedBoxGeo(0.024, 0.009, 0.012, 0.0014, true, 0xe2e7ee), mats.metal);
  boltHandle.position.set(-0.014, 0.002, 0.028);
  s.boltOrSlide.position.set(-0.014, 0.082, 0.118);
  s.boltOrSlide.add(boltBody, boltHandle);

  const chamberRound = createCartridgeMesh(0.050, 0.0049, mats.ammoAccent);
  chamberRound.position.set(-0.014, 0.078, 0.132);
  root.add(chamberRound);

  // Iconic Curved Bakelite Translucent-Window AK Magazine (12 visible 7.62 rounds + rising follower)
  const mag = buildWindowedMagazine(mats, {
    width: 0.025,
    depth: 0.062,
    height: 0.186,
    curveAngle: 0.24,
    slots: 12,
    bodyHex: 0x9b4b28,
    cartLen: 0.048,
    cartRad: 0.0048,
  });
  s.magPivot.position.set(0, 0.034, 0.146);
  s.magPivot.add(mag.group);

  s.gripRight.position.set(0, -0.012, -0.018);
  s.gripLeft.position.set(0, 0.044, 0.292);
  s.muzzleSocket.position.set(0, 0.074, 0.625);
  s.ejectionPortSocket.position.set(-0.022, 0.084, 0.128);
  s.laserSocket.position.set(0.022, 0.088, 0.375);
  s.opticEyeSocket.position.set(0, 0.150, 0.046);
  s.weaponLightSocket.position.set(-0.022, 0.078, 0.375);

  return finalizeWeapon('ak74m', root, s, 0.078, 0, {
    magRounds: mag.rounds,
    magFollower: mag.follower,
    followerBottomY: mag.botY,
    followerTopY: mag.topY,
    chamberRound,
  });
}

// ============================================================================
// [3] M870 TACTICAL SHOTGUN (12-Gauge Buckshot) — 6 Live Crimson Side-Saddle Shells
// ============================================================================
export function buildM870(mats: WeaponMaterials): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_M870_Tactical';
  const s = createWeaponSockets(root);

  // Heavy beveled steel shotgun receiver
  const receiver = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.038, 0.032],
        [0.195, 0.032],
        [0.195, 0.106],
        [-0.038, 0.106],
      ],
      0.040,
      0.003,
      undefined,
      true,
      0xc2c8d0
    ),
    mats.metal
  );
  root.add(receiver);
  root.add(createPicatinnyStrip(0.18, 0.022, 0.109, 0.085, mats.metal));

  // Tactical pistol grip + collapsible shotgun stock
  const grip = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.036, 0.042],
        [0.006, 0.040],
        [-0.020, -0.056],
        [-0.056, -0.048],
      ],
      0.032,
      0.0036,
      undefined,
      false,
      0x2f3338
    ),
    mats.polymer
  );
  root.add(grip);

  const stock = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.268, 0.082],
        [-0.038, 0.092],
        [-0.038, 0.040],
        [-0.268, -0.024],
      ],
      0.040,
      0.0042,
      undefined,
      false,
      0x2c3035
    ),
    mats.polymer
  );
  root.add(stock);

  const trigBlade = new THREE.Mesh(createChamferedBoxGeo(0.006, 0.024, 0.007, 0.001, true, 0xbec4cc), mats.metal);
  trigBlade.position.set(0, -0.010, 0.002);
  s.triggerPivot.position.set(0, 0.032, 0.032);
  s.triggerPivot.add(trigBlade);

  // Heavy 18.5" Barrel + Underbarrel Tubular Magazine + Barrel Clamp + Ghost Ring Sight
  const barrel = new THREE.Mesh(createBarrelGeo(0.0135, 0.0145, 0.48, 12, true, 0xc2c8d0), mats.metal);
  barrel.position.set(0, 0.090, 0.435);
  root.add(barrel);

  const magTube = new THREE.Mesh(createBarrelGeo(0.0125, 0.0125, 0.43, 12, true, 0xb2b8c0), mats.metal);
  magTube.position.set(0, 0.058, 0.410);
  root.add(magTube);

  const clamp = new THREE.Mesh(createChamferedBoxGeo(0.034, 0.062, 0.024, 0.002, true, 0xbec4cc), mats.metal);
  clamp.position.set(0, 0.074, 0.560);
  root.add(clamp);

  // Ghost ring rear sight + tritium green front bead
  const ghostRing = new THREE.Mesh(
    createBeveledOpticHoodGeo(0.026, 0.026, 0.016, 0.016, 0.014, 0.0012, 0xc8ced6),
    mats.metal
  );
  ghostRing.position.set(0, 0.124, 0.015);
  root.add(ghostRing);

  const frontBead = new THREE.Mesh(
    createChamferedBoxGeo(0.006, 0.010, 0.006, 0.001, false, 0x34e86a),
    mats.ammoAccent
  );
  frontBead.position.set(0, 0.112, 0.648);
  root.add(frontBead);

  // Sliding Ribbed Pump Forend (connected to boltOrSlide so pump animation slides smoothly!)
  const pumpBody = new THREE.Mesh(
    createChamferedBoxGeo(0.044, 0.048, 0.175, 0.0045, false, 0x2a2e33),
    mats.polymer
  );
  s.boltOrSlide.position.set(0, 0.056, 0.345);
  s.boltOrSlide.add(pumpBody);

  // Left-side Receiver Side-Saddle Carrier with 6 LIVE CRIMSON 12-GAUGE BUCKSHOT SHELLS!
  const saddlePlate = new THREE.Mesh(
    createChamferedBoxGeo(0.010, 0.048, 0.148, 0.0018, false, 0x24282d),
    mats.polymer
  );
  saddlePlate.position.set(0.024, 0.072, 0.086);
  root.add(saddlePlate);

  const saddleShells: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const sh = createShotgunShellMesh(mats.ammoAccent);
    // Stand vertically in left-side shell loops (brass base up!)
    sh.rotation.x = Math.PI * 0.5;
    sh.position.set(0.032, 0.072, 0.026 + i * 0.024);
    root.add(sh);
    saddleShells.push(sh);
  }

  // Reload hand-fed single crimson shell inside magPivot (shown during M870 thumb-feed reload!)
  const reloadShell = createShotgunShellMesh(mats.ammoAccent);
  reloadShell.visible = false;
  s.magPivot.position.set(0, 0.026, 0.125);
  s.magPivot.add(reloadShell);

  // Visible chamber brass shell peeking in right-side ejection port
  const chamberRound = createShotgunShellMesh(mats.ammoAccent);
  chamberRound.position.set(-0.018, 0.074, 0.122);
  root.add(chamberRound);

  // Grip_Left anchored directly inside boltOrSlide so left hand tracks the pump forend during cycling!
  s.gripLeft.parent?.remove(s.gripLeft);
  s.boltOrSlide.add(s.gripLeft);
  s.gripLeft.position.set(0, -0.012, 0.0);

  s.gripRight.position.set(0, -0.010, -0.022);
  s.muzzleSocket.position.set(0, 0.090, 0.680);
  s.ejectionPortSocket.position.set(-0.024, 0.078, 0.118);
  s.laserSocket.position.set(0.022, 0.074, 0.578);
  s.opticEyeSocket.position.set(0, 0.124, -0.020);
  s.weaponLightSocket.position.set(-0.022, 0.074, 0.578);

  return finalizeWeapon('m870', root, s, 0.092, 0, {
    magRounds: [],
    saddleShells,
    chamberRound,
  });
}

// ============================================================================
// [4] AWM .338 LAPUA PRECISION SNIPER — Beveled Thumbhole Chassis + AR Scope
// ============================================================================
export function buildAWM(mats: WeaponMaterials): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_AWM_338';
  const s = createWeaponSockets(root);

  // Iconic Olive-Drab Beveled Accuracy International Thumbhole Chassis (ExtrudeGeometry with real thumbhole cutout!)
  const chassis = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.315, 0.088],
        [0.440, 0.088],
        [0.455, 0.056],
        [0.180, 0.042],
        [0.095, 0.036],
        [0.012, 0.036],
        [-0.012, -0.054],
        [-0.055, -0.054],
        [-0.058, 0.014],
        [-0.255, -0.024],
        [-0.315, -0.024],
      ],
      0.040,
      0.0038,
      [
        // Real beveled thumbhole opening inside rear stock!
        [
          [-0.228, 0.058],
          [-0.072, 0.058],
          [-0.076, 0.006],
          [-0.222, -0.006],
        ],
      ],
      false,
      0x4e5c42
    ),
    mats.polymer
  );
  root.add(chassis);

  // Adjustable black polymer cheek riser + rubber recoil buttpad
  const cheekRiser = new THREE.Mesh(createChamferedBoxGeo(0.044, 0.026, 0.125, 0.004, false, 0x262a2e), mats.polymer);
  cheekRiser.position.set(0, 0.104, -0.195);
  root.add(cheekRiser);

  const buttPad = new THREE.Mesh(createChamferedBoxGeo(0.042, 0.114, 0.020, 0.003, false, 0x1e2024), mats.polymer);
  buttPad.position.set(0, 0.032, -0.324);
  root.add(buttPad);

  // Heavy Fluted Steel Action Receiver + 27" Free-Float Barrel + Dual-Chamber Tank Muzzle Brake
  const action = new THREE.Mesh(createChamferedBoxGeo(0.038, 0.036, 0.245, 0.0028, true, 0xc8ced6), mats.metal);
  action.position.set(0, 0.098, 0.115);
  root.add(action);

  const barrel = new THREE.Mesh(createBarrelGeo(0.0115, 0.0145, 0.62, 12, true, 0xc2c8d0), mats.metal);
  barrel.position.set(0, 0.098, 0.545);
  root.add(barrel);

  const muzzleBrake = new THREE.Mesh(createChamferedBoxGeo(0.038, 0.026, 0.078, 0.0024, true, 0xb8bec6), mats.metal);
  muzzleBrake.position.set(0, 0.098, 0.885);
  root.add(muzzleBrake);

  // Folded Front Bipod Legs under forend
  for (const side of [-1, 1] as const) {
    const leg = new THREE.Mesh(createBarrelGeo(0.0065, 0.0065, 0.20, 8, true, 0xb4bac2), mats.metal);
    leg.position.set(side * 0.024, 0.046, 0.36);
    root.add(leg);
  }

  // Precision 10x42 Tactical Scope + Twin Mount Rings + AR Iridescent Objective & Ocular Lenses
  for (const rz of [0.045, 0.165]) {
    const ring = new THREE.Mesh(createChamferedBoxGeo(0.038, 0.046, 0.022, 0.0022, true, 0xc0c6ce), mats.metal);
    ring.position.set(0, 0.136, rz);
    root.add(ring);
  }
  const scopeTube = new THREE.Mesh(createBarrelGeo(0.017, 0.017, 0.34, 14, true, 0xc8ced6), mats.metal);
  scopeTube.position.set(0, 0.156, 0.115);
  root.add(scopeTube);

  const scopeBell = new THREE.Mesh(createBarrelGeo(0.028, 0.018, 0.095, 14, true, 0xc8ced6), mats.metal);
  scopeBell.position.set(0, 0.156, 0.315);
  root.add(scopeBell);

  const objLens = new THREE.Mesh(new THREE.CircleGeometry(0.025, 14), mats.opticGlass);
  objLens.position.set(0, 0.156, 0.362);
  root.add(objLens);

  const ocularLens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 14), mats.opticGlass);
  ocularLens.rotation.y = Math.PI;
  ocularLens.position.set(0, 0.156, -0.055);
  root.add(ocularLens);

  // Turrets
  const elevTurret = new THREE.Mesh(createChamferedBoxGeo(0.020, 0.022, 0.020, 0.002, true, 0xc0c6ce), mats.metal);
  elevTurret.position.set(0, 0.180, 0.105);
  root.add(elevTurret);

  // Manual 60-degree Lifting Bolt Handle + Chrome Bolt Body
  const boltBody = new THREE.Mesh(createBarrelGeo(0.010, 0.010, 0.135, 10, true, 0xe8edf4), mats.metal);
  const boltStem = new THREE.Mesh(createChamferedBoxGeo(0.042, 0.008, 0.008, 0.001, true, 0xe2e8f0), mats.metal);
  boltStem.position.set(-0.024, -0.012, -0.036);
  boltStem.rotation.z = 0.45;
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), mats.metal);
  boltKnob.position.set(-0.044, -0.026, -0.036);
  s.boltOrSlide.position.set(0, 0.098, 0.075);
  s.boltOrSlide.add(boltBody, boltStem, boltKnob);

  // Trigger blade
  const trigBlade = new THREE.Mesh(createChamferedBoxGeo(0.005, 0.024, 0.007, 0.001, true, 0xd0d6de), mats.metal);
  trigBlade.position.set(0, -0.010, 0.002);
  s.triggerPivot.position.set(0, 0.036, 0.048);
  s.triggerPivot.add(trigBlade);

  // Visible .338 Chamber Round + Detachable 5-Round Windowed Steel Box Magazine
  const chamberRound = createCartridgeMesh(0.068, 0.0068, mats.ammoAccent);
  chamberRound.position.set(-0.012, 0.094, 0.132);
  root.add(chamberRound);

  const mag = buildWindowedMagazine(mats, {
    width: 0.026,
    depth: 0.088,
    height: 0.118,
    curveAngle: 0.0,
    slots: 5,
    bodyHex: 0x383e45,
    cartLen: 0.068,
    cartRad: 0.0064,
  });
  s.magPivot.position.set(0, 0.036, 0.145);
  s.magPivot.add(mag.group);

  s.gripRight.position.set(0, -0.010, -0.028);
  s.gripLeft.position.set(0, 0.046, 0.340);
  s.muzzleSocket.position.set(0, 0.098, 0.928);
  s.ejectionPortSocket.position.set(-0.024, 0.100, 0.125);
  s.laserSocket.position.set(0.024, 0.096, 0.435);
  s.opticEyeSocket.position.set(0, 0.156, -0.095);
  s.weaponLightSocket.position.set(-0.024, 0.096, 0.435);

  return finalizeWeapon('awm', root, s, 0.098, Math.PI / 3, {
    magRounds: mag.rounds,
    magFollower: mag.follower,
    followerBottomY: mag.botY,
    followerTopY: mag.topY,
    chamberRound,
  });
}

// ============================================================================
// [5] GLOCK 19 GEN5 TACTICAL (9x19mm) — Beveled RMR Optic + Weaponlight Socket
// ============================================================================
export function buildGlock19(mats: WeaponMaterials): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_Glock19_Tac';
  const s = createWeaponSockets(root);

  // Beveled Polymer Frame & Ergonomic 22-Degree Grip
  const frame = new THREE.Mesh(
    createBeveledProfileGeo(
      [
        [-0.034, 0.048],
        [0.142, 0.048],
        [0.142, 0.024],
        [0.088, 0.024],
        [0.080, -0.002],
        [0.028, -0.002],
        [0.018, 0.020],
        [-0.012, -0.072],
        [-0.056, -0.064],
        [-0.028, 0.032],
      ],
      0.029,
      0.0028,
      [
        [
          [0.034, 0.024],
          [0.076, 0.024],
          [0.072, 0.005],
          [0.034, 0.005],
        ],
      ],
      false,
      0x2c3036
    ),
    mats.polymer
  );
  root.add(frame);

  // Trigger blade
  const trigBlade = new THREE.Mesh(createChamferedBoxGeo(0.006, 0.020, 0.006, 0.001, false, 0x22262b), mats.polymer);
  trigBlade.position.set(0, -0.008, 0.002);
  s.triggerPivot.position.set(0, 0.024, 0.052);
  s.triggerPivot.add(trigBlade);

  // Fixed Threaded Steel Barrel
  const barrel = new THREE.Mesh(createBarrelGeo(0.0072, 0.0076, 0.132, 10, true, 0xd4dae2), mats.metal);
  barrel.position.set(0, 0.060, 0.092);
  root.add(barrel);

  // Reciprocating Chamfered Steel Slide + Beveled Trijicon RMR Micro Red-Dot + AR Iridescent Lens!
  const slide = new THREE.Mesh(
    createChamferedBoxGeo(0.027, 0.028, 0.172, 0.0024, true, 0xc8ced6),
    mats.metal
  );
  slide.position.set(0, 0.062, 0.054);
  s.boltOrSlide.add(slide);

  const rmrHood = new THREE.Mesh(
    createBeveledOpticHoodGeo(0.027, 0.022, 0.019, 0.015, 0.038, 0.0016, 0xc2c8d0),
    mats.metal
  );
  rmrHood.position.set(0, 0.086, 0.012);
  s.boltOrSlide.add(rmrHood);

  const rmrLens = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.014), mats.opticGlass);
  rmrLens.position.set(0, 0.086, 0.012);
  s.boltOrSlide.add(rmrLens);

  const rmrDot = new THREE.Mesh(
    createChamferedBoxGeo(0.0026, 0.0026, 0.0015, 0.0004, false, 0xff2e2e),
    mats.ammoAccent
  );
  rmrDot.position.set(0, 0.086, 0.010);
  s.boltOrSlide.add(rmrDot);

  // Underbarrel SureFire X300 Tactical Weaponlight Housing + AR Bezel Lens
  const lightBody = new THREE.Mesh(
    createChamferedBoxGeo(0.028, 0.024, 0.072, 0.0024, true, 0xbec4cc),
    mats.metal
  );
  lightBody.position.set(0, 0.012, 0.122);
  root.add(lightBody);

  const lightBezel = new THREE.Mesh(createBarrelGeo(0.011, 0.011, 0.012, 10, true, 0xd8dee6), mats.metal);
  lightBezel.position.set(0, 0.012, 0.160);
  root.add(lightBezel);

  const lightGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 10), mats.opticGlass);
  lightGlass.position.set(0, 0.012, 0.167);
  root.add(lightGlass);

  // Visible 9mm Chamber Round + Detachable 15-Round Witness-Window Magazine
  const chamberRound = createCartridgeMesh(0.026, 0.0046, mats.ammoAccent);
  chamberRound.position.set(-0.008, 0.062, 0.065);
  root.add(chamberRound);

  const mag = buildWindowedMagazine(mats, {
    width: 0.021,
    depth: 0.032,
    height: 0.106,
    curveAngle: -0.26,
    slots: 6,
    bodyHex: 0x262a2f,
    cartLen: 0.026,
    cartRad: 0.0044,
  });
  s.magPivot.position.set(0, 0.022, -0.012);
  s.magPivot.add(mag.group);

  s.gripRight.position.set(0, -0.012, -0.018);
  s.gripLeft.position.set(0.008, -0.010, -0.004);
  s.muzzleSocket.position.set(0, 0.060, 0.162);
  s.ejectionPortSocket.position.set(-0.018, 0.064, 0.064);
  s.laserSocket.position.set(0, 0.012, 0.172);
  s.opticEyeSocket.position.set(0, 0.086, -0.028);
  s.weaponLightSocket.position.set(0, 0.012, 0.172);

  return finalizeWeapon('glock19', root, s, 0.044, 0, {
    magRounds: mag.rounds,
    magFollower: mag.follower,
    followerBottomY: mag.botY,
    followerTopY: mag.topY,
    chamberRound,
  });
}

export function buildAllWeapons(mats: WeaponMaterials): Record<WeaponId, BuiltWeapon> {
  return {
    mk18: buildMK18(mats),
    ak74m: buildAK74M(mats),
    m870: buildM870(mats),
    awm: buildAWM(mats),
    glock19: buildGlock19(mats),
  };
}

export const buildWeaponArsenal = buildAllWeapons;

export { WEAPON_ORDER };
