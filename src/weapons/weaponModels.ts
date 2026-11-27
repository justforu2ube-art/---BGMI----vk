import * as THREE from 'three';
import { WeaponId, WEAPON_ORDER } from './weaponTypes';
import { WeaponMaterialLibrary } from './weaponMaterials';
import {
  BuiltWeapon,
  buildWindowedMagazineGroup,
  computeM870SaddleShellCount,
  createCartridgeGroup,
  createLatheAlongZ,
  createPicatinnyRailGeo,
  createShotgunShellGroup,
  createSideExtrudeGeo,
  LiveAmmoVisuals,
  makePart,
  safeMergeGeometries,
} from './weaponGeoHelpers';

function collectDispose(root: THREE.Object3D): () => void {
  return () => {
    root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
  };
}

function createSockets(root: THREE.Group) {
  const gripRight = new THREE.Object3D();
  gripRight.name = 'Grip_Right';
  root.add(gripRight);

  const gripLeft = new THREE.Object3D();
  gripLeft.name = 'Grip_Left';
  root.add(gripLeft);

  const muzzleTip = new THREE.Object3D();
  muzzleTip.name = 'Muzzle_Tip';
  root.add(muzzleTip);

  const ejectionPort = new THREE.Object3D();
  ejectionPort.name = 'Ejection_Port';
  root.add(ejectionPort);

  const magPivot = new THREE.Group();
  magPivot.name = 'Mag_Pivot';
  root.add(magPivot);

  const boltOrSlide = new THREE.Group();
  boltOrSlide.name = 'Bolt_Or_Slide';
  root.add(boltOrSlide);

  const triggerPivot = new THREE.Group();
  triggerPivot.name = 'Trigger_Pivot';
  root.add(triggerPivot);

  const laserOrigin = new THREE.Object3D();
  laserOrigin.name = 'Laser_Origin';
  root.add(laserOrigin);

  return {
    gripRight,
    gripLeft,
    muzzleTip,
    ejectionPort,
    magPivot,
    boltOrSlide,
    triggerPivot,
    laserOrigin,
  };
}

// ============================================================================
// [1] MK18 MOD 1 CQBR CARBINE (5.56x45mm NATO)
// ============================================================================
export function buildMK18(mats: WeaponMaterialLibrary): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_MK18_Mod1';
  const s = createSockets(root);

  // 1. Beveled AR-15 Lower Receiver + Flared Magwell + Buffer Boss
  const lowerProfile: [number, number][] = [
    [-0.036, 0.068],
    [0.015, 0.068],
    [0.045, 0.068],
    [0.168, 0.068],
    [0.168, 0.012],
    [0.102, 0.01],
    [0.09, 0.038],
    [0.014, 0.038],
    [-0.022, 0.042],
    [-0.036, 0.056],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(lowerProfile, 0.036, 0.0028, 0.0028, 2),
      mats.anodizedAluminum,
      'MK18_Lower_Receiver'
    )
  );

  // Flared beveled magwell lip
  const magwellFlange = createSideExtrudeGeo(
    [
      [0.098, 0.008],
      [0.172, 0.01],
      [0.172, 0.024],
      [0.098, 0.022],
    ],
    0.041,
    0.0022,
    0.0022
  );
  root.add(makePart(magwellFlange, mats.anodizedAluminum, 'MK18_Magwell_Flare'));

  // Trigger guard bow
  const trigGuard = createSideExtrudeGeo(
    [
      [0.022, 0.042],
      [0.026, 0.016],
      [0.088, 0.016],
      [0.096, 0.038],
      [0.088, 0.038],
      [0.082, 0.022],
      [0.033, 0.022],
      [0.029, 0.042],
    ],
    0.012,
    0.0012,
    0.0012
  );
  root.add(makePart(trigGuard, mats.anodizedAluminum, 'MK18_Trigger_Guard'));

  // 2. Beveled Upper Receiver + Brass Deflector + Forward Assist + Dust Cover
  const upperProfile: [number, number][] = [
    [-0.038, 0.068],
    [0.174, 0.068],
    [0.174, 0.114],
    [0.162, 0.118],
    [-0.026, 0.118],
    [-0.038, 0.106],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(upperProfile, 0.038, 0.003, 0.003, 2),
      mats.anodizedAluminum,
      'MK18_Upper_Receiver'
    )
  );

  // Brass deflector & forward assist housing on right side (-X)
  const deflectorGeo = new THREE.ConeGeometry(0.01, 0.016, 4);
  deflectorGeo.rotateZ(Math.PI / 2);
  deflectorGeo.rotateY(Math.PI / 4);
  root.add(makePart(deflectorGeo, mats.gunmetalSteel, 'MK18_Brass_Deflector', [-0.022, 0.095, 0.036]));

  const faHousing = createLatheAlongZ(
    [
      [0.007, 0],
      [0.0075, 0.034],
      [0.0055, 0.038],
      [0.0085, 0.044],
      [0.0085, 0.05],
    ],
    14
  );
  root.add(
    makePart(faHousing, mats.gunmetalSteel, 'MK18_Forward_Assist', [-0.022, 0.088, -0.018], [0, -0.22, 0])
  );

  // T-Handle Charging Handle Latch at rear of upper
  const chLatches = new THREE.BoxGeometry(0.044, 0.012, 0.016);
  root.add(makePart(chLatches, mats.gunmetalSteel, 'MK18_Charging_Handle', [0, 0.111, -0.044]));

  // Fire selector lever + takedown pins + bolt catch paddle (left side +X)
  const detailGeos: THREE.BufferGeometry[] = [];
  const pinRear = new THREE.CylinderGeometry(0.0042, 0.0042, 0.042, 12);
  pinRear.rotateZ(Math.PI / 2);
  pinRear.translate(0, 0.062, -0.012);
  detailGeos.push(pinRear);

  const pinFront = new THREE.CylinderGeometry(0.0042, 0.0042, 0.042, 12);
  pinFront.rotateZ(Math.PI / 2);
  pinFront.translate(0, 0.062, 0.155);
  detailGeos.push(pinFront);

  const selector = new THREE.BoxGeometry(0.006, 0.008, 0.022);
  selector.translate(0.021, 0.055, 0.015);
  detailGeos.push(selector);

  const boltCatch = new THREE.BoxGeometry(0.005, 0.024, 0.012);
  boltCatch.translate(0.021, 0.062, 0.112);
  detailGeos.push(boltCatch);

  root.add(makePart(safeMergeGeometries(detailGeos), mats.gunmetalSteel, 'MK18_Receiver_Controls'));

  // 3. Ergonomic Stippled A2/MOE Pistol Grip centered at Origin (0,0,0) = Grip_Right!
  const gripProfile: [number, number][] = [
    [-0.028, 0.044],
    [0.026, 0.044],
    [0.016, 0.006],
    [0.006, -0.058],
    [-0.036, -0.058],
    [-0.034, -0.01],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(gripProfile, 0.031, 0.0045, 0.0045, 3),
      mats.stippledGrip,
      'MK18_Pistol_Grip'
    )
  );

  // 4. Daniel Defense RIS II Quad-Rail Handguard (FDE Bronze-Tan Rail + Ventilated Slots + Picatinny Teeth!)
  const hgCore = createSideExtrudeGeo(
    [
      [0.176, 0.064],
      [0.418, 0.064],
      [0.418, 0.114],
      [0.176, 0.114],
    ],
    0.044,
    0.0042,
    0.0042,
    2
  );
  root.add(makePart(hgCore, mats.tanRailAccent, 'MK18_RIS2_Handguard'));

  // Dark ventilated cooling slots recessed along both handguard sides
  const ventGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const z = 0.205 + i * 0.035;
    for (const side of [-1, 1]) {
      const slotUpper = new THREE.BoxGeometry(0.003, 0.009, 0.022);
      slotUpper.translate(side * 0.0222, 0.102, z);
      ventGeos.push(slotUpper);
      const slotLower = new THREE.BoxGeometry(0.003, 0.009, 0.022);
      slotLower.translate(side * 0.0222, 0.076, z);
      ventGeos.push(slotLower);
    }
  }
  root.add(makePart(safeMergeGeometries(ventGeos), mats.tacticalPolymer, 'MK18_Handguard_Vents'));

  // Continuous Full-Length Top Picatinny 1913 Rail + Bottom & Side Rails!
  const topRail = createPicatinnyRailGeo(-0.024, 0.414, 0.117, 0.0212, 0.0085, 0.0105);
  root.add(makePart(topRail, mats.gunmetalSteel, 'MK18_Top_Picatinny_Rail'));

  const botRail = createPicatinnyRailGeo(0.184, 0.412, -0.066, 0.021, 0.0075, 0.011);
  botRail.rotateZ(Math.PI);
  root.add(makePart(botRail, mats.tanRailAccent, 'MK18_Bottom_Picatinny_Rail'));

  // Side rails (+X and -X)
  for (const side of [-1, 1]) {
    const sideRail = createPicatinnyRailGeo(0.19, 0.408, 0.021, 0.018, 0.0065, 0.012);
    sideRail.rotateZ(side * -Math.PI / 2);
    sideRail.translate(0, 0.089, 0);
    root.add(makePart(sideRail, mats.tanRailAccent, `MK18_Side_Rail_${side > 0 ? 'L' : 'R'}`));
  }

  // 5. Sleek Magpul AFG-2 Angled Tactical Foregrip mounted under RIS II -> Grip_Left target!
  const afgProfile: [number, number][] = [
    [0.248, 0.06],
    [0.358, 0.06],
    [0.358, 0.048],
    [0.335, 0.035],
    [0.278, 0.043],
    [0.248, 0.052],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(afgProfile, 0.026, 0.0028, 0.0028, 2),
      mats.stippledGrip,
      'MK18_Angled_Foregrip'
    )
  );
  s.gripLeft.position.set(0, 0.045, 0.305);

  // 6. Match-Grade 10.3" Free-Float Barrel + Gas Block + SOCOM 3-Prong Flash Hider
  const barrelGeo = createLatheAlongZ(
    [
      [0.011, 0.17],
      [0.011, 0.37],
      [0.0095, 0.38],
      [0.0095, 0.475],
      [0.0122, 0.482], // Collar
      [0.0115, 0.495],
      [0.0128, 0.502], // SOCOM suppressor mount flange
      [0.0108, 0.51],
      [0.0108, 0.548], // 3-prong flash hider
      [0.0068, 0.548], // Bore mouth
      [0.0068, 0.51],
    ],
    20
  );
  barrelGeo.translate(0, 0.089, 0);
  root.add(makePart(barrelGeo, mats.gunmetalSteel, 'MK18_Barrel_FlashHider'));
  s.muzzleTip.position.set(0, 0.089, 0.555);

  // 7. EOTech EXPS3 Holographic Optic (Protective Aluminum Hood + Glass Window + Red Holo Reticle)
  const eoBase = createSideExtrudeGeo(
    [
      [0.045, 0.125],
      [0.145, 0.125],
      [0.145, 0.144],
      [0.11, 0.144],
      [0.045, 0.138],
    ],
    0.036,
    0.0022,
    0.0022
  );
  root.add(makePart(eoBase, mats.anodizedAluminum, 'MK18_EOTech_Base'));

  // Protective C-hood arch around glass window (left/right walls + top bridge so you see THROUGH it!)
  const eoHoodGeos: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const wall = new THREE.BoxGeometry(0.0045, 0.038, 0.046);
    wall.translate(side * 0.019, 0.158, 0.072);
    eoHoodGeos.push(wall);
  }
  const eoTop = new THREE.BoxGeometry(0.0425, 0.0048, 0.048);
  eoTop.translate(0, 0.178, 0.072);
  eoHoodGeos.push(eoTop);
  // Front battery compartment cylinder
  const eoBatt = new THREE.CylinderGeometry(0.011, 0.011, 0.04, 14);
  eoBatt.rotateZ(Math.PI / 2);
  eoBatt.translate(0, 0.145, 0.124);
  eoHoodGeos.push(eoBatt);
  root.add(makePart(safeMergeGeometries(eoHoodGeos), mats.anodizedAluminum, 'MK18_EOTech_Hood'));

  // Translucent anti-reflective optic glass + glowing red holo ring-dot reticle
  const eoGlass = makePart(
    new THREE.PlaneGeometry(0.031, 0.028),
    mats.opticGlass,
    'MK18_EOTech_Glass',
    [0, 0.159, 0.074]
  );
  eoGlass.castShadow = false;
  root.add(eoGlass);

  const eoReticle = makePart(
    new THREE.PlaneGeometry(0.024, 0.024),
    mats.reticleEotech,
    'MK18_EOTech_Reticle',
    [0, 0.159, 0.072]
  );
  eoReticle.castShadow = false;
  root.add(eoReticle);

  // 8. Top-Rail PEQ-15 Tactical IR/Visible Laser Box
  const peqProfile: [number, number][] = [
    [0.322, 0.125],
    [0.412, 0.125],
    [0.412, 0.146],
    [0.34, 0.149],
    [0.322, 0.141],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(peqProfile, 0.042, 0.0025, 0.0025),
      mats.tanRailAccent,
      'MK18_PEQ15_Laser'
    )
  );
  const peqEmitter = createLatheAlongZ(
    [
      [0.006, 0.41],
      [0.006, 0.418],
      [0.003, 0.418],
    ],
    12
  );
  peqEmitter.translate(-0.01, 0.136, 0);
  root.add(makePart(peqEmitter, mats.gunmetalSteel, 'MK18_PEQ15_Emitter'));
  s.laserOrigin.position.set(-0.01, 0.136, 0.42);

  // 9. Collapsible SOPMOD Crane Stock + 6-Position Buffer Tube + Rubber Buttpad
  const bufTube = createLatheAlongZ(
    [
      [0.0155, -0.22],
      [0.0155, -0.034],
      [0.018, -0.034],
      [0.018, -0.024],
    ],
    16
  );
  bufTube.translate(0, 0.092, 0);
  root.add(makePart(bufTube, mats.anodizedAluminum, 'MK18_Buffer_Tube'));

  const stockProfile: [number, number][] = [
    [-0.242, 0.004],
    [-0.214, 0.004],
    [-0.148, 0.056],
    [-0.088, 0.068],
    [-0.088, 0.114],
    [-0.242, 0.116],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(stockProfile, 0.044, 0.004, 0.004, 2),
      mats.tacticalPolymer,
      'MK18_SOPMOD_Stock'
    )
  );

  // Cheek battery tubes on SOPMOD stock
  for (const side of [-1, 1]) {
    const cheekTube = createLatheAlongZ(
      [
        [0.013, -0.236],
        [0.013, -0.095],
        [0.009, -0.09],
      ],
      12
    );
    cheekTube.translate(side * 0.016, 0.088, 0);
    root.add(makePart(cheekTube, mats.tacticalPolymer, `MK18_CheekTube_${side > 0 ? 'L' : 'R'}`));
  }

  const buttPad = createSideExtrudeGeo(
    [
      [-0.254, 0.002],
      [-0.24, 0.002],
      [-0.24, 0.118],
      [-0.254, 0.118],
    ],
    0.04,
    0.003,
    0.003
  );
  root.add(makePart(buttPad, mats.rubberPad, 'MK18_Rubber_Buttpad'));

  // 10. Articulated 30-Round Translucent-Window PMAG / STANAG Magazine (Mag_Pivot)
  s.magPivot.position.set(0, 0.024, 0.135);
  const liveAmmo = buildWindowedMagazineGroup(s.magPivot, {
    spineZY: [
      [0, 0.02],
      [0.002, -0.04],
      [0.01, -0.095],
      [0.024, -0.148],
    ],
    widthX: 0.025,
    depthZ: 0.062,
    caliber: '556',
    stackSlots: 12,
    bodyMat: mats.tacticalPolymer,
    windowMat: mats.smokedMagWindow,
    mats,
    namePrefix: 'MK18_WindowMag',
    ribCount: 2,
  });

  // 11. Reciprocating Chrome-Steel Bolt Carrier inside Right Ejection Port (Bolt_Or_Slide)
  s.boltOrSlide.position.set(-0.0185, 0.091, 0.095);
  const boltGeo = new THREE.BoxGeometry(0.007, 0.016, 0.066);
  s.boltOrSlide.add(makePart(boltGeo, mats.chromeSteel, 'MK18_Bolt_Carrier'));
  s.ejectionPort.position.set(-0.024, 0.092, 0.095);

  // Live 5.56mm cartridge visible inside ejection port when bolt retracts
  const mk18Breech = createCartridgeGroup(mats, '556', 'MK18_Breech_Round');
  mk18Breech.position.set(-0.014, 0.09, 0.105);
  mk18Breech.visible = false;
  root.add(mk18Breech);
  liveAmmo.breechRound = mk18Breech;

  // 12. Articulated Curved Trigger (Trigger_Pivot)
  s.triggerPivot.position.set(0, 0.044, 0.056);
  const trigGeo = createSideExtrudeGeo(
    [
      [0.002, 0],
      [-0.004, -0.01],
      [-0.002, -0.022],
      [0.003, -0.022],
      [0.002, -0.01],
      [0.006, 0],
    ],
    0.006,
    0.0008,
    0.0008
  );
  s.triggerPivot.add(makePart(trigGeo, mats.gunmetalSteel, 'MK18_Trigger'));

  return {
    id: 'mk18',
    root,
    ...s,
    boltRestPos: s.boltOrSlide.position.clone(),
    boltRestRot: s.boltOrSlide.rotation.clone(),
    magRestPos: s.magPivot.position.clone(),
    magRestRot: s.magPivot.rotation.clone(),
    boltTravelMax: 0.052,
    boltLiftMax: 0,
    liveAmmo,
    dispose: collectDispose(root),
  };
}

// ============================================================================
// [2] AK-74M / MODERNIZED AKM RIFLE (7.62x39mm)
// ============================================================================
export function buildAK74M(mats: WeaponMaterialLibrary): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_AK74M';
  const s = createSockets(root);

  // 1. Stamped Blued-Steel Receiver + Ribbed Top Dust Cover
  const receiverProfile: [number, number][] = [
    [-0.042, 0.04],
    [0.215, 0.04],
    [0.215, 0.088],
    [-0.042, 0.088],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(receiverProfile, 0.036, 0.0022, 0.0022, 2),
      mats.bluedSteel,
      'AK_Stamped_Receiver'
    )
  );

  // Iconic domed ribbed top dust cover
  const dustProfile: [number, number][] = [
    [-0.042, 0.086],
    [0.185, 0.086],
    [0.175, 0.11],
    [-0.032, 0.106],
    [-0.042, 0.095],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(dustProfile, 0.034, 0.004, 0.004, 3),
      mats.bluedSteel,
      'AK_Dust_Cover'
    )
  );

  // Visible raised stamped steel rivets + dimpled magwell recesses + sweeping right-side fire selector!
  const rivetGeos: THREE.BufferGeometry[] = [];
  const rivetCoords: [number, number][] = [
    [-0.025, 0.072],
    [-0.025, 0.052],
    [0.035, 0.058],
    [0.075, 0.058],
    [0.185, 0.076],
    [0.185, 0.052],
    [0.202, 0.068],
  ];
  for (const [z, y] of rivetCoords) {
    for (const side of [-1, 1]) {
      const rv = new THREE.SphereGeometry(0.0032, 8, 6);
      rv.scale(0.55, 1, 1);
      rv.translate(side * 0.0185, y, z);
      rivetGeos.push(rv);
    }
  }
  // Dust cover stiffening ribs
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.BoxGeometry(0.0355, 0.004, 0.006);
    rib.translate(0, 0.106, 0.01 + i * 0.036);
    rivetGeos.push(rib);
  }
  // Sweeping right-side steel AK fire selector lever (-X)
  const selBar = new THREE.BoxGeometry(0.004, 0.014, 0.115);
  selBar.rotateX(0.09);
  selBar.translate(-0.0205, 0.069, 0.068);
  rivetGeos.push(selBar);
  const selTab = new THREE.BoxGeometry(0.011, 0.01, 0.014);
  selTab.translate(-0.024, 0.064, 0.122);
  rivetGeos.push(selTab);
  // Trigger guard bow
  const akTrigGuard = createSideExtrudeGeo(
    [
      [0.018, 0.042],
      [0.022, 0.014],
      [0.088, 0.014],
      [0.095, 0.042],
      [0.088, 0.042],
      [0.082, 0.02],
      [0.028, 0.02],
      [0.024, 0.042],
    ],
    0.011,
    0.001,
    0.001
  );
  rivetGeos.push(akTrigGuard);
  root.add(makePart(safeMergeGeometries(rivetGeos), mats.gunmetalSteel, 'AK_Rivets_Selector'));

  // 2. Grooved Soviet Bakelite Pistol Grip centered at Origin (0,0,0) = Grip_Right
  const gripProfile: [number, number][] = [
    [-0.024, 0.042],
    [0.022, 0.042],
    [0.012, -0.004],
    [0.002, -0.056],
    [-0.034, -0.056],
    [-0.03, -0.006],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(gripProfile, 0.028, 0.004, 0.004, 3),
      mats.bakeliteOrange,
      'AK_Bakelite_Grip'
    )
  );

  // 3. Rich Oiled Laminated Wood Handguards (Upper + Swelled Lower) & Solid Buttstock + Steel Buttplate!
  const lowerWoodProfile: [number, number][] = [
    [0.215, 0.044],
    [0.376, 0.05],
    [0.376, 0.08],
    [0.215, 0.082],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(lowerWoodProfile, 0.038, 0.0055, 0.0055, 3),
      mats.laminatedWood,
      'AK_Lower_Wood_Handguard'
    )
  );
  s.gripLeft.position.set(0, 0.042, 0.295);

  const upperWoodProfile: [number, number][] = [
    [0.222, 0.086],
    [0.368, 0.088],
    [0.368, 0.114],
    [0.222, 0.115],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(upperWoodProfile, 0.032, 0.006, 0.006, 3),
      mats.laminatedWood,
      'AK_Upper_Wood_Handguard'
    )
  );

  // Classic sloped AK laminated wood buttstock
  const stockProfile: [number, number][] = [
    [-0.268, -0.022],
    [-0.256, -0.022],
    [-0.04, 0.046],
    [-0.04, 0.084],
    [-0.268, 0.088],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(stockProfile, 0.036, 0.0045, 0.0045, 3),
      mats.laminatedWood,
      'AK_Wood_Buttstock'
    )
  );

  // Steel buttplate + sling swivel
  const buttPlate = createSideExtrudeGeo(
    [
      [-0.278, -0.024],
      [-0.266, -0.024],
      [-0.266, 0.09],
      [-0.278, 0.09],
    ],
    0.034,
    0.0022,
    0.0022
  );
  root.add(makePart(buttPlate, mats.bluedSteel, 'AK_Steel_Buttplate'));

  // 4. Barrel, Under-Barrel Cleaning Rod, 45-Degree Gas Block, Gas Tube, Hooded Front Sight, Slant Brake!
  const barrelGeo = createLatheAlongZ(
    [
      [0.0105, 0.21],
      [0.0105, 0.45],
      [0.0092, 0.46],
      [0.0092, 0.578],
      [0.0115, 0.584], // Slant compensator collar
      [0.0112, 0.625], // Slant muzzle brake
      [0.007, 0.625],
      [0.007, 0.58],
    ],
    18
  );
  barrelGeo.translate(0, 0.075, 0);
  root.add(makePart(barrelGeo, mats.bluedSteel, 'AK_Barrel_Compensator'));
  s.muzzleTip.position.set(0, 0.075, 0.632);

  // Upper gas tube + 45° gas block + cleaning rod + rear sight block + front hooded sight post
  const gasParts: THREE.BufferGeometry[] = [];
  const gasTube = createLatheAlongZ(
    [
      [0.0085, 0.21],
      [0.0085, 0.445],
    ],
    12
  );
  gasTube.translate(0, 0.103, 0);
  gasParts.push(gasTube);

  const cleaningRod = createLatheAlongZ(
    [
      [0.0026, 0.365],
      [0.0026, 0.555],
    ],
    8
  );
  cleaningRod.translate(0, 0.058, 0);
  gasParts.push(cleaningRod);

  // 45-degree iconic AK gas block
  const gasBlock = createSideExtrudeGeo(
    [
      [0.422, 0.064],
      [0.466, 0.064],
      [0.448, 0.114],
      [0.422, 0.114],
    ],
    0.022,
    0.0018,
    0.0018
  );
  gasParts.push(gasBlock);

  // Rear tangent iron sight block
  const rearSight = createSideExtrudeGeo(
    [
      [0.175, 0.088],
      [0.228, 0.088],
      [0.228, 0.119],
      [0.185, 0.118],
    ],
    0.026,
    0.0018,
    0.0018
  );
  gasParts.push(rearSight);

  // Front hooded iron sight tower
  const frontTower = createSideExtrudeGeo(
    [
      [0.542, 0.062],
      [0.576, 0.062],
      [0.568, 0.132],
      [0.554, 0.132],
    ],
    0.018,
    0.0015,
    0.0015
  );
  gasParts.push(frontTower);

  // Protective front sight ring hood
  const sightHood = new THREE.TorusGeometry(0.011, 0.0024, 8, 16);
  sightHood.translate(0, 0.132, 0.561);
  gasParts.push(sightHood);

  root.add(makePart(safeMergeGeometries(gasParts), mats.bluedSteel, 'AK_GasBlock_Sights'));

  // 5. Side Dovetail Mount (+X) + Russian Kobra Low-Profile Reflex Optic
  const doveMount = createSideExtrudeGeo(
    [
      [0.015, 0.058],
      [0.115, 0.058],
      [0.105, 0.128],
      [0.032, 0.128],
    ],
    0.008,
    0.0012,
    0.0012
  );
  doveMount.translate(0.021, 0, 0);
  root.add(makePart(doveMount, mats.gunmetalSteel, 'AK_Dovetail_SideMount'));

  const kobraGeos: THREE.BufferGeometry[] = [];
  const kBase = new THREE.BoxGeometry(0.032, 0.016, 0.088);
  kBase.translate(0, 0.129, 0.072);
  kobraGeos.push(kBase);
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.004, 0.03, 0.034);
    wing.translate(side * 0.016, 0.15, 0.095);
    kobraGeos.push(wing);
  }
  const kTop = new THREE.BoxGeometry(0.036, 0.004, 0.034);
  kTop.translate(0, 0.165, 0.095);
  kobraGeos.push(kTop);
  root.add(makePart(safeMergeGeometries(kobraGeos), mats.anodizedAluminum, 'AK_Kobra_Optic'));

  const kGlass = makePart(
    new THREE.PlaneGeometry(0.026, 0.024),
    mats.opticGlass,
    'AK_Kobra_Glass',
    [0, 0.15, 0.096]
  );
  kGlass.castShadow = false;
  root.add(kGlass);

  const kReticle = makePart(
    new THREE.PlaneGeometry(0.022, 0.022),
    mats.reticleKobra,
    'AK_Kobra_Reticle',
    [0, 0.15, 0.094]
  );
  kReticle.castShadow = false;
  root.add(kReticle);

  // Compact under-gas-tube tactical laser emitter
  s.laserOrigin.position.set(0.018, 0.075, 0.44);

  // 6. Iconic Deeply Curved 30-Round Svetogor Windowed Bakelite Banana Magazine (Mag_Pivot)
  s.magPivot.position.set(0, 0.032, 0.152);
  const liveAmmo = buildWindowedMagazineGroup(s.magPivot, {
    spineZY: [
      [0, 0.015],
      [0.008, -0.038],
      [0.026, -0.092],
      [0.056, -0.145],
      [0.094, -0.192],
    ],
    widthX: 0.026,
    depthZ: 0.063,
    caliber: '762',
    stackSlots: 12,
    bodyMat: mats.bakeliteOrange,
    windowMat: mats.bakeliteWindow,
    mats,
    namePrefix: 'AK_WindowBananaMag',
    ribCount: 1,
  });

  // 7. Right-Side Reciprocating Steel Bolt Carrier & Hooked Charging Handle (Bolt_Or_Slide)
  s.boltOrSlide.position.set(-0.018, 0.084, 0.132);
  const akBoltGeos: THREE.BufferGeometry[] = [];
  const carrier = new THREE.BoxGeometry(0.008, 0.014, 0.074);
  akBoltGeos.push(carrier);
  const handleStem = new THREE.BoxGeometry(0.024, 0.007, 0.01);
  handleStem.translate(-0.012, 0.002, 0.022);
  akBoltGeos.push(handleStem);
  const handleHook = new THREE.CylinderGeometry(0.0045, 0.0045, 0.016, 10);
  handleHook.translate(-0.024, 0.008, 0.022);
  akBoltGeos.push(handleHook);
  s.boltOrSlide.add(makePart(safeMergeGeometries(akBoltGeos), mats.chromeSteel, 'AK_Bolt_Carrier'));
  s.ejectionPort.position.set(-0.026, 0.086, 0.12);

  // Live 7.62mm round visible in open right breech when bolt carrier travels back
  const akBreech = createCartridgeGroup(mats, '762', 'AK_Breech_Round');
  akBreech.position.set(-0.013, 0.082, 0.138);
  akBreech.visible = false;
  root.add(akBreech);
  liveAmmo.breechRound = akBreech;

  // 8. Articulated Trigger
  s.triggerPivot.position.set(0, 0.042, 0.05);
  const akTrig = createSideExtrudeGeo(
    [
      [0.002, 0],
      [-0.005, -0.011],
      [-0.002, -0.023],
      [0.003, -0.023],
      [0.001, -0.011],
      [0.006, 0],
    ],
    0.0055,
    0.0008,
    0.0008
  );
  s.triggerPivot.add(makePart(akTrig, mats.gunmetalSteel, 'AK_Trigger'));

  return {
    id: 'ak74m',
    root,
    ...s,
    boltRestPos: s.boltOrSlide.position.clone(),
    boltRestRot: s.boltOrSlide.rotation.clone(),
    magRestPos: s.magPivot.position.clone(),
    magRestRot: s.magPivot.rotation.clone(),
    boltTravelMax: 0.078,
    boltLiftMax: 0,
    liveAmmo,
    dispose: collectDispose(root),
  };
}

// ============================================================================
// [3] BENELLI M4 / M870 TACTICAL COMBAT SHOTGUN (12-Gauge Buckshot)
// ============================================================================
export function buildM870Shotgun(mats: WeaponMaterialLibrary): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_M870_Tactical';
  const s = createSockets(root);

  // 1. CNC Matte-Black Anodized Beveled Receiver + Bottom Stainless Loading Gate
  const recProfile: [number, number][] = [
    [-0.026, 0.042],
    [0.195, 0.042],
    [0.195, 0.106],
    [0.0, 0.106],
    [-0.026, 0.092],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(recProfile, 0.039, 0.004, 0.004, 3),
      mats.anodizedAluminum,
      'M870_Receiver'
    )
  );

  // Recessed chrome/stainless steel bolt visible inside right ejection port + bottom loading gate
  const ejBolt = new THREE.BoxGeometry(0.005, 0.018, 0.074);
  root.add(makePart(ejBolt, mats.chromeSteel, 'M870_Internal_Bolt', [-0.019, 0.083, 0.12]));
  s.ejectionPort.position.set(-0.025, 0.083, 0.125);

  const loadGate = new THREE.BoxGeometry(0.022, 0.005, 0.088);
  root.add(makePart(loadGate, mats.chromeSteel, 'M870_Loading_Gate', [0, 0.041, 0.125]));

  // Top tactical Picatinny rail + Ghost-Ring Rear & Front Iron Sights
  const topRail = createPicatinnyRailGeo(0.01, 0.185, 0.105, 0.021, 0.0075, 0.011);
  root.add(makePart(topRail, mats.gunmetalSteel, 'M870_Top_Rail'));

  const ghostGeos: THREE.BufferGeometry[] = [];
  const rearRing = new THREE.TorusGeometry(0.0072, 0.0022, 8, 16);
  rearRing.translate(0, 0.124, 0.022);
  ghostGeos.push(rearRing);
  for (const side of [-1, 1]) {
    const ear = new THREE.BoxGeometry(0.0032, 0.018, 0.014);
    ear.translate(side * 0.011, 0.121, 0.022);
    ghostGeos.push(ear);
    const fEar = new THREE.BoxGeometry(0.003, 0.02, 0.016);
    fEar.translate(side * 0.009, 0.112, 0.642);
    ghostGeos.push(fEar);
  }
  const frontPost = new THREE.BoxGeometry(0.003, 0.016, 0.005);
  frontPost.translate(0, 0.111, 0.642);
  ghostGeos.push(frontPost);
  root.add(makePart(safeMergeGeometries(ghostGeos), mats.gunmetalSteel, 'M870_GhostRing_Sights'));

  // Glowing tritium front blade dot
  root.add(
    makePart(new THREE.SphereGeometry(0.0022, 8, 8), mats.tritiumGreen, 'M870_Front_Tritium', [
      0, 0.118, 0.641,
    ])
  );

  // 2. Heavy Barrel + Ventilated Perforated Heat Shield + Extended Tubular Magazine + Clamp!
  const barrelGeo = createLatheAlongZ(
    [
      [0.0138, 0.19],
      [0.0138, 0.675],
      [0.0152, 0.678], // Breacher choke crown
      [0.0152, 0.69],
      [0.0095, 0.69],
      [0.0095, 0.64],
    ],
    20
  );
  barrelGeo.translate(0, 0.091, 0);
  root.add(makePart(barrelGeo, mats.gunmetalSteel, 'M870_Barrel'));
  s.muzzleTip.position.set(0, 0.091, 0.696);

  // Ventilated heat shield wrapping upper barrel with cooling holes!
  const heatShieldGeo = new THREE.CylinderGeometry(
    0.0164,
    0.0164,
    0.34,
    18,
    1,
    true,
    -Math.PI * 0.72,
    Math.PI * 1.44
  );
  heatShieldGeo.rotateX(Math.PI / 2);
  heatShieldGeo.translate(0, 0.092, 0.375);
  root.add(makePart(heatShieldGeo, mats.bluedSteel, 'M870_Heat_Shield'));

  // Visual cooling perforations along heat shield
  const perfGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const z = 0.228 + i * 0.032;
    for (const ang of [-0.7, 0, 0.7]) {
      const hole = new THREE.CylinderGeometry(0.0036, 0.0036, 0.004, 8);
      hole.rotateZ(-ang);
      hole.translate(Math.sin(ang) * 0.0162, 0.092 + Math.cos(ang) * 0.0162, z);
      perfGeos.push(hole);
    }
  }
  root.add(makePart(safeMergeGeometries(perfGeos), mats.rubberPad, 'M870_HeatShield_Vents'));

  // Extended 8-shell under-barrel tubular magazine + tactical barrel clamp
  const magTubeGeo = createLatheAlongZ(
    [
      [0.0128, 0.19],
      [0.0128, 0.648],
      [0.014, 0.652], // Knurled endcap
      [0.014, 0.668],
      [0.009, 0.672],
    ],
    18
  );
  magTubeGeo.translate(0, 0.06, 0);
  root.add(makePart(magTubeGeo, mats.gunmetalSteel, 'M870_Magazine_Tube'));

  const clampGeo = createSideExtrudeGeo(
    [
      [0.578, 0.044],
      [0.608, 0.044],
      [0.608, 0.107],
      [0.578, 0.107],
    ],
    0.032,
    0.0022,
    0.0022
  );
  root.add(makePart(clampGeo, mats.anodizedAluminum, 'M870_Barrel_Clamp'));
  s.laserOrigin.position.set(-0.018, 0.06, 0.615);

  // 3. Side-Mounted 6-Shell Tactical Carrier Saddle (Left side +X) with individual retention loops + 6 LIVE crimson brass-base shells!
  const saddlePlate = createSideExtrudeGeo(
    [
      [0.026, 0.056],
      [0.172, 0.056],
      [0.172, 0.092],
      [0.026, 0.092],
    ],
    0.008,
    0.0015,
    0.0015
  );
  saddlePlate.translate(0.023, 0, 0);
  root.add(makePart(saddlePlate, mats.tacticalPolymer, 'M870_Shell_Saddle_Plate'));

  // Sculpted C-clip shell retention loops (stay visibly empty when red shells deplete!)
  const clipGeos: THREE.BufferGeometry[] = [];
  const saddleShells: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const sz = 0.041 + i * 0.0232;
    const clip = new THREE.CylinderGeometry(
      0.0108,
      0.0108,
      0.022,
      12,
      1,
      true,
      -Math.PI * 0.2,
      Math.PI * 1.4
    );
    clip.translate(0.032, 0.076, sz);
    clipGeos.push(clip);

    const shell = createShotgunShellGroup(mats, `M870_SaddleShell_${i + 1}`);
    shell.position.set(0.032, 0.078, sz);
    root.add(shell);
    saddleShells.push(shell);
  }
  root.add(makePart(safeMergeGeometries(clipGeos), mats.tacticalPolymer, 'M870_Shell_Saddle_Clips'));

  // 4. Sliding Ribbed Tactical Polymer Pump Forend (Bolt_Or_Slide — carries Grip_Left inside it!)
  s.boltOrSlide.position.set(0, 0.059, 0.355);
  const pumpGeos: THREE.BufferGeometry[] = [];
  const pumpCore = createLatheAlongZ(
    [
      [0.017, -0.095],
      [0.0225, -0.088],
      [0.023, 0.088],
      [0.017, 0.095],
    ],
    16
  );
  pumpGeos.push(pumpCore);
  // Crisp tactical grip ribs along pump forend
  for (let i = 0; i < 11; i++) {
    const z = -0.075 + i * 0.015;
    const rib = new THREE.TorusGeometry(0.023, 0.0024, 6, 16);
    rib.translate(0, 0, z);
    pumpGeos.push(rib);
  }
  // Dual stainless steel action bars linking pump to receiver
  for (const side of [-1, 1]) {
    const bar = new THREE.BoxGeometry(0.0032, 0.007, 0.16);
    bar.translate(side * 0.016, 0.002, -0.14);
    pumpGeos.push(bar);
  }
  s.boltOrSlide.add(makePart(safeMergeGeometries(pumpGeos), mats.stippledGrip, 'M870_Sliding_Pump'));

  // IMPORTANT: Re-parent Grip_Left INSIDE Bolt_Or_Slide so when the shotgun pumps back & forth,
  // the real-time 2-bone analytical IK pulls Hand_L seamlessly with the sliding pump!
  root.remove(s.gripLeft);
  s.gripLeft.position.set(0, -0.022, 0.0);
  s.boltOrSlide.add(s.gripLeft);

  // 5. Ergonomic Pistol-Grip Tactical Buttstock + Thick Rubber Recoil Pad
  const gripProfile: [number, number][] = [
    [-0.024, 0.046],
    [0.022, 0.046],
    [0.014, 0.004],
    [0.005, -0.056],
    [-0.034, -0.056],
    [-0.032, -0.008],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(gripProfile, 0.032, 0.0045, 0.0045, 3),
      mats.stippledGrip,
      'M870_Pistol_Grip'
    )
  );

  const stockProfile: [number, number][] = [
    [-0.258, -0.016],
    [-0.236, -0.016],
    [-0.088, 0.048],
    [-0.024, 0.054],
    [-0.024, 0.088],
    [-0.258, 0.094],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(stockProfile, 0.038, 0.0045, 0.0045, 3),
      mats.tacticalPolymer,
      'M870_Tactical_Stock'
    )
  );

  const padGeo = createSideExtrudeGeo(
    [
      [-0.275, -0.018],
      [-0.256, -0.018],
      [-0.256, 0.096],
      [-0.275, 0.096],
    ],
    0.038,
    0.0038,
    0.0038
  );
  root.add(makePart(padGeo, mats.rubberPad, 'M870_Recoil_Pad'));

  // Trigger guard & articulated trigger
  const guardGeo = createSideExtrudeGeo(
    [
      [0.02, 0.044],
      [0.026, 0.014],
      [0.084, 0.014],
      [0.09, 0.044],
      [0.084, 0.044],
      [0.079, 0.021],
      [0.031, 0.021],
      [0.026, 0.044],
    ],
    0.012,
    0.0012,
    0.0012
  );
  root.add(makePart(guardGeo, mats.tacticalPolymer, 'M870_Trigger_Guard'));

  s.triggerPivot.position.set(0, 0.044, 0.052);
  const trigGeo = createSideExtrudeGeo(
    [
      [0.002, 0],
      [-0.004, -0.01],
      [-0.002, -0.022],
      [0.003, -0.022],
      [0.002, -0.01],
      [0.006, 0],
    ],
    0.006,
    0.0008,
    0.0008
  );
  s.triggerPivot.add(makePart(trigGeo, mats.gunmetalSteel, 'M870_Trigger'));

  // 6. Thumb-Fed Loose 12-Gauge Reload Shell in Mag_Pivot + Breech Live Shell!
  s.magPivot.position.set(0, 0.032, 0.125);
  const reloadShell = createShotgunShellGroup(mats, 'M870_Reload_Shell');
  reloadShell.rotation.x = Math.PI / 2;
  reloadShell.visible = false; // Shown visibly in Hand_L during thumb-fed shell reload!
  s.magPivot.add(reloadShell);

  const m870Breech = createShotgunShellGroup(mats, 'M870_Breech_Shell');
  m870Breech.rotation.x = Math.PI / 2;
  m870Breech.position.set(-0.015, 0.083, 0.128);
  m870Breech.visible = false;
  root.add(m870Breech);

  const liveAmmo: LiveAmmoVisuals = {
    saddleShells,
    windowCartridges: [],
    topFeedRound: reloadShell,
    followerMesh: null,
    breechRound: m870Breech,
    syncLiveAmmo: (
      magCount,
      magSize,
      isReloading,
      reloadProgress,
      preReloadMag,
      reserve,
      boltTravel = 0
    ) => {
      const visibleShells = computeM870SaddleShellCount(
        magCount,
        magSize,
        isReloading,
        reloadProgress,
        preReloadMag,
        reserve
      );
      // Deplete rear-to-front (index 5 down to 0) as you fire, refill front-to-rear during reload!
      for (let i = 0; i < saddleShells.length; i++) {
        saddleShells[i].visible = i < visibleShells;
      }
      m870Breech.visible = magCount > 0 && boltTravel > 0.18;
    },
  };

  return {
    id: 'm870',
    root,
    ...s,
    boltRestPos: s.boltOrSlide.position.clone(),
    boltRestRot: s.boltOrSlide.rotation.clone(),
    magRestPos: s.magPivot.position.clone(),
    magRestRot: s.magPivot.rotation.clone(),
    boltTravelMax: 0.088,
    boltLiftMax: 0,
    liveAmmo,
    dispose: collectDispose(root),
  };
}

// ============================================================================
// [4] AWM / M200 PRECISION BOLT-ACTION SNIPER RIFLE (.338 Lapua Magnum)
// ============================================================================
export function buildAWMSniper(mats: WeaponMaterialLibrary): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_AWM_Sniper';
  const s = createSockets(root);

  // 1. Heavy OD-Olive Precision Tactical Chassis Stock (Thumbhole Frame + Raised Cheek Riser + Forend)
  const chassisMain: [number, number][] = [
    [-0.032, 0.048],
    [0.032, 0.048],
    [0.095, 0.044],
    [0.19, 0.044],
    [0.495, 0.055],
    [0.505, 0.088],
    [0.19, 0.088],
    [-0.032, 0.088],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(chassisMain, 0.044, 0.004, 0.004, 2),
      mats.sniperChassisOD,
      'AWM_Chassis_Forend'
    )
  );
  s.gripLeft.position.set(0, 0.044, 0.34);

  // Ergonomic thumbhole pistol grip centered at Origin (0,0,0) = Grip_Right
  const gripProfile: [number, number][] = [
    [-0.024, 0.05],
    [0.024, 0.05],
    [0.014, 0.002],
    [0.006, -0.058],
    [-0.036, -0.058],
    [-0.032, -0.006],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(gripProfile, 0.033, 0.0045, 0.0045, 3),
      mats.sniperChassisOD,
      'AWM_Pistol_Grip'
    )
  );

  // Rear buttstock upper bridge + lower thumbhole strut (genuine open thumbhole!)
  const stockTop: [number, number][] = [
    [-0.275, 0.056],
    [-0.025, 0.056],
    [-0.025, 0.088],
    [-0.275, 0.092],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(stockTop, 0.042, 0.0038, 0.0038, 2),
      mats.sniperChassisOD,
      'AWM_Stock_Upper'
    )
  );

  const stockBottomStrut: [number, number][] = [
    [-0.275, -0.044],
    [-0.235, -0.044],
    [-0.145, -0.056],
    [-0.018, -0.056],
    [-0.018, -0.032],
    [-0.14, -0.032],
    [-0.228, -0.014],
    [-0.228, 0.058],
    [-0.275, 0.058],
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(stockBottomStrut, 0.036, 0.0035, 0.0035, 2),
      mats.sniperChassisOD,
      'AWM_Stock_Thumbhole_Strut'
    )
  );

  // Adjustable raised cheek-weld pad + thick recoil buttpad
  const cheekPad = createSideExtrudeGeo(
    [
      [-0.23, 0.094],
      [-0.092, 0.094],
      [-0.1, 0.122],
      [-0.222, 0.122],
    ],
    0.044,
    0.0045,
    0.0045,
    3
  );
  root.add(makePart(cheekPad, mats.rubberPad, 'AWM_Cheek_Riser'));

  const recoilPad = createSideExtrudeGeo(
    [
      [-0.296, -0.046],
      [-0.274, -0.046],
      [-0.274, 0.096],
      [-0.296, 0.096],
    ],
    0.042,
    0.004,
    0.004
  );
  root.add(makePart(recoilPad, mats.rubberPad, 'AWM_Recoil_Buttpad'));

  // 2. Heavy Steel Action Receiver + Top 20-MOA Picatinny Rail
  const actionGeo = createLatheAlongZ(
    [
      [0.0195, -0.015],
      [0.0195, 0.225],
    ],
    18
  );
  actionGeo.translate(0, 0.098, 0);
  root.add(makePart(actionGeo, mats.gunmetalSteel, 'AWM_Steel_Action'));

  const scopeRail = createPicatinnyRailGeo(0.015, 0.23, 0.115, 0.0212, 0.008, 0.011);
  root.add(makePart(scopeRail, mats.anodizedAluminum, 'AWM_20MOA_Rail'));

  // 3. Long Fluted Match-Grade Free-Float Barrel + Aggressive Slotted Tank-Style Muzzle Brake!
  const barrelGeo = createLatheAlongZ(
    [
      [0.0165, 0.22],
      [0.0145, 0.36],
      [0.0128, 0.81],
      [0.015, 0.815], // Brake thread collar
    ],
    22
  );
  barrelGeo.translate(0, 0.098, 0);
  root.add(makePart(barrelGeo, mats.gunmetalSteel, 'AWM_Match_Barrel'));

  // Longitudinal barrel flutes (6 dark recessed machined flutes around barrel!)
  const fluteGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const flute = new THREE.CylinderGeometry(0.0022, 0.0022, 0.44, 6);
    flute.rotateX(Math.PI / 2);
    flute.translate(Math.cos(ang) * 0.0132, 0.098 + Math.sin(ang) * 0.0132, 0.56);
    fluteGeos.push(flute);
  }
  root.add(makePart(safeMergeGeometries(fluteGeos), mats.anodizedAluminum, 'AWM_Barrel_Flutes'));

  // Aggressive Multi-Chamber Slotted Tank-Style Muzzle Brake!
  const brakeGeos: THREE.BufferGeometry[] = [];
  const brakeTop = new THREE.BoxGeometry(0.036, 0.006, 0.088);
  brakeTop.translate(0, 0.111, 0.858);
  brakeGeos.push(brakeTop);
  const brakeBot = new THREE.BoxGeometry(0.036, 0.006, 0.088);
  brakeBot.translate(0, 0.085, 0.858);
  brakeGeos.push(brakeBot);
  // 4 vertical angled blast baffles separating 3 side-venting chambers!
  for (let i = 0; i < 4; i++) {
    const z = 0.818 + i * 0.0265;
    const baffle = new THREE.BoxGeometry(0.036, 0.026, 0.0075);
    baffle.translate(0, 0.098, z);
    brakeGeos.push(baffle);
  }
  root.add(makePart(safeMergeGeometries(brakeGeos), mats.bluedSteel, 'AWM_Tank_Muzzle_Brake'));
  s.muzzleTip.position.set(0, 0.098, 0.908);

  // 4. Oversized High-Magnification Telescopic Sniper Scope on Dual CNC Cantilever Rings!
  const scopeTube = createLatheAlongZ(
    [
      [0.021, -0.055], // Ocular eyepiece bell
      [0.0225, -0.045],
      [0.0225, 0.025],
      [0.0165, 0.042], // Zoom ring taper
      [0.0185, 0.052], // Magnification throw ring
      [0.016, 0.062],
      [0.016, 0.215], // Main 34mm tube
      [0.0285, 0.275], // Objective bell flare
      [0.0285, 0.375], // Long sunshade hood
      [0.0255, 0.375],
      [0.0255, 0.33],
    ],
    24
  );
  scopeTube.translate(0, 0.162, 0);
  root.add(makePart(scopeTube, mats.anodizedAluminum, 'AWM_Telescopic_Scope'));

  // Dual CNC cantilever scope rings + micrometer elevation/windage/parallax turrets
  const scopeHardware: THREE.BufferGeometry[] = [];
  for (const rz of [0.088, 0.182]) {
    const ring = new THREE.TorusGeometry(0.0185, 0.0042, 8, 20);
    ring.translate(0, 0.162, rz);
    scopeHardware.push(ring);
    const stem = new THREE.BoxGeometry(0.024, 0.038, 0.02);
    stem.translate(0, 0.135, rz);
    scopeHardware.push(stem);
  }
  // Elevation top micrometer turret
  const elevTurret = new THREE.CylinderGeometry(0.0115, 0.0115, 0.024, 16);
  elevTurret.translate(0, 0.186, 0.135);
  scopeHardware.push(elevTurret);
  // Windage right turret (-X)
  const windTurret = new THREE.CylinderGeometry(0.0105, 0.0105, 0.022, 16);
  windTurret.rotateZ(Math.PI / 2);
  windTurret.translate(-0.024, 0.162, 0.135);
  scopeHardware.push(windTurret);
  // Parallax side knob (+X)
  const paraTurret = new THREE.CylinderGeometry(0.0105, 0.0105, 0.02, 16);
  paraTurret.rotateZ(Math.PI / 2);
  paraTurret.translate(0.024, 0.162, 0.135);
  scopeHardware.push(paraTurret);

  root.add(makePart(safeMergeGeometries(scopeHardware), mats.gunmetalSteel, 'AWM_Scope_Rings_Turrets'));

  // Sapphire-emerald reflective objective lens + rear eyepiece lens + illuminated mildot reticle
  const objLens = makePart(
    new THREE.CircleGeometry(0.025, 22),
    mats.sniperLensEmerald,
    'AWM_Scope_Objective_Lens',
    [0, 0.162, 0.345]
  );
  objLens.castShadow = false;
  root.add(objLens);

  const eyeLens = makePart(
    new THREE.CircleGeometry(0.0185, 20),
    mats.opticGlass,
    'AWM_Scope_Eyepiece_Lens',
    [0, 0.162, -0.054],
    [0, Math.PI, 0]
  );
  eyeLens.castShadow = false;
  root.add(eyeLens);

  const mildotRet = makePart(
    new THREE.PlaneGeometry(0.03, 0.03),
    mats.reticleMildot,
    'AWM_Scope_Mildot_Reticle',
    [0, 0.162, -0.052]
  );
  mildotRet.castShadow = false;
  root.add(mildotRet);

  // 5. Folding Twin-Leg Tactical Front Bipod mounted solidly beneath forend!
  const bipodGeos: THREE.BufferGeometry[] = [];
  const bpMount = new THREE.BoxGeometry(0.036, 0.02, 0.044);
  bpMount.translate(0, 0.046, 0.472);
  bipodGeos.push(bpMount);

  for (const side of [-1, 1]) {
    // Build each leg + notched collar + rubber foot in hinge-local space (0 -> -0.155 along -Y)
    // then apply identical forward/splay rotations so feet stay 100% bolted to leg tips!
    const legUpper = new THREE.CylinderGeometry(0.0056, 0.005, 0.088, 10);
    legUpper.translate(0, -0.044, 0);
    const legLower = new THREE.CylinderGeometry(0.0042, 0.004, 0.068, 10);
    legLower.translate(0, -0.118, 0);
    const legCollar = new THREE.CylinderGeometry(0.0068, 0.0068, 0.012, 10);
    legCollar.translate(0, -0.086, 0);
    const legFoot = new THREE.CylinderGeometry(0.0072, 0.009, 0.016, 12);
    legFoot.translate(0, -0.155, 0);

    const legMerged = safeMergeGeometries([legUpper, legLower, legCollar, legFoot]);
    legMerged.rotateX(0.32); // Slight forward deployment stance
    legMerged.rotateZ(side * 0.24); // Twin-leg lateral splay
    legMerged.translate(side * 0.015, 0.042, 0.472);
    bipodGeos.push(legMerged);
  }
  root.add(makePart(safeMergeGeometries(bipodGeos), mats.anodizedAluminum, 'AWM_Tactical_Bipod'));
  s.laserOrigin.position.set(0.026, 0.075, 0.49);

  // 6. Detachable 5-Round Steel Witness-Window Box Magazine (Mag_Pivot — 1-to-1 live .338 brass stack!)
  s.magPivot.position.set(0, 0.036, 0.145);
  const liveAmmo = buildWindowedMagazineGroup(s.magPivot, {
    spineZY: [
      [0, 0.015],
      [0, -0.028],
      [0, -0.072],
    ],
    widthX: 0.027,
    depthZ: 0.084,
    caliber: '338',
    stackSlots: 5,
    bodyMat: mats.gunmetalSteel,
    windowMat: mats.smokedMagWindow,
    mats,
    namePrefix: 'AWM_5Rnd_WindowMag',
    ribCount: 0,
  });

  // 7. Articulated Lift-Pull-Push Precision Bolt Handle (Bolt_Or_Slide)
  // Pivots cleanly around barrel centerline (0, 0.098, 0.05) so rotating Z lifts handle 60°!
  s.boltOrSlide.position.set(0, 0.098, 0.05);
  const boltGeos: THREE.BufferGeometry[] = [];
  const boltBody = createLatheAlongZ(
    [
      [0.0115, -0.045],
      [0.0115, 0.088],
    ],
    14
  );
  boltGeos.push(boltBody);
  const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.048, 10);
  stem.rotateZ(Math.PI / 2 - 0.35);
  stem.translate(-0.025, -0.008, -0.024);
  boltGeos.push(stem);
  const knob = new THREE.SphereGeometry(0.0092, 12, 10);
  knob.translate(-0.047, -0.016, -0.028);
  boltGeos.push(knob);
  s.boltOrSlide.add(makePart(safeMergeGeometries(boltGeos), mats.chromeSteel, 'AWM_Bolt_Assembly'));
  s.ejectionPort.position.set(-0.026, 0.1, 0.125);

  // Gleaming .338 Lapua Magnum cartridge visible in open receiver breech during bolt pull!
  const awmBreech = createCartridgeGroup(mats, '338', 'AWM_Breech_Round');
  awmBreech.position.set(-0.012, 0.098, 0.14);
  awmBreech.visible = false;
  root.add(awmBreech);
  liveAmmo.breechRound = awmBreech;

  // Trigger guard & match trigger
  const guardGeo = createSideExtrudeGeo(
    [
      [0.018, 0.048],
      [0.024, 0.016],
      [0.082, 0.016],
      [0.088, 0.048],
      [0.082, 0.048],
      [0.076, 0.022],
      [0.03, 0.022],
      [0.024, 0.048],
    ],
    0.012,
    0.0012,
    0.0012
  );
  root.add(makePart(guardGeo, mats.gunmetalSteel, 'AWM_Trigger_Guard'));

  s.triggerPivot.position.set(0, 0.046, 0.05);
  const trigGeo = createSideExtrudeGeo(
    [
      [0.002, 0],
      [-0.003, -0.011],
      [-0.001, -0.022],
      [0.003, -0.022],
      [0.002, -0.011],
      [0.005, 0],
    ],
    0.005,
    0.0007,
    0.0007
  );
  s.triggerPivot.add(makePart(trigGeo, mats.chromeSteel, 'AWM_Match_Trigger'));

  return {
    id: 'awm',
    root,
    ...s,
    boltRestPos: s.boltOrSlide.position.clone(),
    boltRestRot: s.boltOrSlide.rotation.clone(),
    magRestPos: s.magPivot.position.clone(),
    magRestRot: s.magPivot.rotation.clone(),
    boltTravelMax: 0.095,
    boltLiftMax: (60 * Math.PI) / 180,
    liveAmmo,
    dispose: collectDispose(root),
  };
}

// ============================================================================
// [5] TACTICAL GLOCK 19 GEN5 SIDEARM (9x19mm)
// ============================================================================
export function buildGlock19(mats: WeaponMaterialLibrary): BuiltWeapon {
  const root = new THREE.Group();
  root.name = 'Weapon_Glock19_Tactical';
  const s = createSockets(root);

  // 1. Diamond-Stippled Ergonomic Polymer Frame (clean OPEN undercut trigger window!) + Flared Magwell
  const frameProfile: [number, number][] = [
    [-0.024, 0.044],
    [0.148, 0.044],
    [0.148, 0.031],
    [0.02, 0.031], // Undercut bridge stays above open trigger window!
    [0.016, 0.014],
    [0.006, -0.058],
    [-0.036, -0.056],
    [-0.026, 0.022],
    [-0.036, 0.038], // Beavertail tang
  ];
  root.add(
    makePart(
      createSideExtrudeGeo(frameProfile, 0.0285, 0.003, 0.003, 2),
      mats.stippledGrip,
      'G19_Polymer_Frame'
    )
  );

  // Sculpted squared Glock undercut trigger guard loop (clean open aperture showing curved trigger!)
  const guardBow = createSideExtrudeGeo(
    [
      [0.018, 0.033],
      [0.024, 0.008],
      [0.086, 0.008],
      [0.09, 0.033],
      [0.081, 0.033],
      [0.078, 0.014],
      [0.03, 0.014],
      [0.025, 0.033],
    ],
    0.0135,
    0.0014,
    0.0014
  );
  root.add(makePart(guardBow, mats.tacticalPolymer, 'G19_Trigger_Guard'));

  // Flared tactical aluminum magwell funnel
  const magwell = createSideExtrudeGeo(
    [
      [-0.041, -0.064],
      [0.011, -0.066],
      [0.009, -0.053],
      [-0.037, -0.051],
    ],
    0.034,
    0.0022,
    0.0022
  );
  root.add(makePart(magwell, mats.anodizedAluminum, 'G19_Flared_Magwell'));

  // Support hand Grip_Left target (modern thumbs-forward two-handed pistol grip!)
  s.gripLeft.position.set(0.016, -0.006, 0.012);

  // 2. Match Threaded Barrel + Exposed Silver Chrome Chamber Hood visible inside right ejection port!
  const barrelGeo = createLatheAlongZ(
    [
      [0.0068, 0.046],
      [0.0068, 0.168],
      [0.0076, 0.17], // Thread protector knurling
      [0.0076, 0.181],
      [0.0046, 0.181],
      [0.0046, 0.155],
    ],
    16
  );
  barrelGeo.translate(0, 0.06, 0);
  const chamberHood = new THREE.BoxGeometry(0.022, 0.014, 0.036);
  chamberHood.translate(-0.004, 0.066, 0.066);
  root.add(
    makePart(safeMergeGeometries([barrelGeo, chamberHood]), mats.chromeSteel, 'G19_Threaded_Barrel')
  );
  s.muzzleTip.position.set(0, 0.06, 0.185);
  s.ejectionPort.position.set(-0.018, 0.066, 0.068);

  // 3. Precision-Milled Matte-Steel Beveled Slide (Bolt_Or_Slide) + Front/Rear Serrations + Tritium + RMR!
  s.boltOrSlide.position.set(0, 0.059, 0.064);

  const slideBody = createSideExtrudeGeo(
    [
      [-0.095, -0.014],
      [0.093, -0.014],
      [0.093, 0.012],
      [0.087, 0.015],
      [-0.09, 0.015],
      [-0.095, 0.011],
    ],
    0.0268,
    0.0024,
    0.0024,
    2
  );
  s.boltOrSlide.add(makePart(slideBody, mats.bluedSteel, 'G19_Milled_Slide'));

  // Crisp angled front & rear cocking serrations on both sides of slide
  const serrationGeos: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // Rear serrations (7 grooves)
    for (let i = 0; i < 7; i++) {
      const groove = new THREE.BoxGeometry(0.0024, 0.021, 0.0028);
      groove.rotateX(0.16);
      groove.translate(side * 0.0136, 0.0, -0.076 + i * 0.0062);
      serrationGeos.push(groove);
    }
    // Front tactical press-check serrations (5 grooves)
    for (let i = 0; i < 5; i++) {
      const groove = new THREE.BoxGeometry(0.0024, 0.02, 0.0028);
      groove.rotateX(0.16);
      groove.translate(side * 0.0136, 0.0, 0.05 + i * 0.0062);
      serrationGeos.push(groove);
    }
  }
  s.boltOrSlide.add(
    makePart(safeMergeGeometries(serrationGeos), mats.gunmetalSteel, 'G19_Slide_Serrations')
  );

  // Glowing 3-Dot Tritium Suppressor-Height Iron Sights
  const ironGeos: THREE.BufferGeometry[] = [];
  const rearL = new THREE.BoxGeometry(0.0055, 0.0085, 0.007);
  rearL.translate(0.0065, 0.0185, -0.086);
  ironGeos.push(rearL);
  const rearR = new THREE.BoxGeometry(0.0055, 0.0085, 0.007);
  rearR.translate(-0.0065, 0.0185, -0.086);
  ironGeos.push(rearR);
  const frontBlade = new THREE.BoxGeometry(0.0038, 0.009, 0.009);
  frontBlade.translate(0, 0.0185, 0.084);
  ironGeos.push(frontBlade);
  s.boltOrSlide.add(makePart(safeMergeGeometries(ironGeos), mats.anodizedAluminum, 'G19_Iron_Sights'));

  // 3 glowing tritium dots
  for (const [tx, ty, tz] of [
    [0.0065, 0.0205, -0.09],
    [-0.0065, 0.0205, -0.09],
    [0, 0.0205, 0.079],
  ]) {
    s.boltOrSlide.add(
      makePart(new THREE.SphereGeometry(0.0014, 8, 8), mats.tritiumGreen, 'G19_Tritium_Dot', [
        tx,
        ty,
        tz,
      ])
    );
  }

  // Compact RMR Micro-Red-Dot Optic mounted on milled slide cut!
  const rmrGeos: THREE.BufferGeometry[] = [];
  const rmrBase = new THREE.BoxGeometry(0.026, 0.006, 0.042);
  rmrBase.translate(0, 0.0175, -0.052);
  rmrGeos.push(rmrBase);
  for (const side of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.0032, 0.018, 0.014);
    post.translate(side * 0.0115, 0.028, -0.044);
    rmrGeos.push(post);
  }
  const rmrArch = new THREE.BoxGeometry(0.026, 0.0032, 0.014);
  rmrArch.translate(0, 0.037, -0.044);
  rmrGeos.push(rmrArch);
  s.boltOrSlide.add(makePart(safeMergeGeometries(rmrGeos), mats.anodizedAluminum, 'G19_RMR_Optic'));

  const rmrGlass = makePart(
    new THREE.PlaneGeometry(0.019, 0.014),
    mats.opticGlass,
    'G19_RMR_Glass',
    [0, 0.0285, -0.044]
  );
  rmrGlass.castShadow = false;
  s.boltOrSlide.add(rmrGlass);

  const rmrDot = makePart(
    new THREE.PlaneGeometry(0.012, 0.012),
    mats.reticleRedDot,
    'G19_RMR_RedDot',
    [0, 0.0285, -0.045]
  );
  rmrDot.castShadow = false;
  s.boltOrSlide.add(rmrDot);

  // 4. Compact Under-Rail Tactical Weapon Flashlight (SureFire X300 / TLR-7 style)
  const lightBody = createLatheAlongZ(
    [
      [0.0105, 0.09],
      [0.011, 0.142],
      [0.0126, 0.146], // Bezel head
      [0.0126, 0.165],
      [0.01, 0.165],
    ],
    16
  );
  lightBody.translate(0, 0.022, 0);
  const lightClamp = new THREE.BoxGeometry(0.024, 0.012, 0.036);
  lightClamp.translate(0, 0.031, 0.116);
  root.add(
    makePart(safeMergeGeometries([lightBody, lightClamp]), mats.anodizedAluminum, 'G19_Weapon_Light')
  );
  root.add(
    makePart(new THREE.CircleGeometry(0.0098, 16), mats.flashlightLens, 'G19_Flashlight_Lens', [
      0, 0.022, 0.166,
    ])
  );
  s.laserOrigin.position.set(0, 0.022, 0.168);

  // 5. Flush 15-Round Witness-Window Steel Drop Magazine (Mag_Pivot — live 9mm brass stack + Gen5 orange follower!)
  s.magPivot.position.set(0, -0.004, -0.012);
  const liveAmmo = buildWindowedMagazineGroup(s.magPivot, {
    spineZY: [
      [0.008, 0.04],
      [0.002, -0.012],
      [-0.006, -0.062],
    ],
    widthX: 0.022,
    depthZ: 0.033,
    caliber: '9mm',
    stackSlots: 8,
    bodyMat: mats.gunmetalSteel,
    windowMat: mats.smokedMagWindow,
    mats,
    namePrefix: 'G19_15Rnd_WindowMag',
    ribCount: 0,
  });

  // Live 9mm breech cartridge visible inside open slide ejection port when cycling (absent on empty slide-lock!)
  const g19Breech = createCartridgeGroup(mats, '9mm', 'G19_Breech_Round');
  g19Breech.position.set(-0.004, 0.064, 0.056);
  g19Breech.visible = false;
  root.add(g19Breech);
  liveAmmo.breechRound = g19Breech;

  // 6. Articulated Glock Safe-Action Trigger
  s.triggerPivot.position.set(0, 0.034, 0.056);
  const trigGeo = createSideExtrudeGeo(
    [
      [0.002, 0],
      [-0.005, -0.01],
      [-0.002, -0.019],
      [0.003, -0.019],
      [0.001, -0.01],
      [0.006, 0],
    ],
    0.006,
    0.0007,
    0.0007
  );
  s.triggerPivot.add(makePart(trigGeo, mats.tacticalPolymer, 'G19_SafeAction_Trigger'));

  return {
    id: 'glock19',
    root,
    ...s,
    boltRestPos: s.boltOrSlide.position.clone(),
    boltRestRot: s.boltOrSlide.rotation.clone(),
    magRestPos: s.magPivot.position.clone(),
    magRestRot: s.magPivot.rotation.clone(),
    boltTravelMax: 0.044,
    boltLiftMax: 0,
    liveAmmo,
    dispose: collectDispose(root),
  };
}

export function buildWeaponById(id: WeaponId, mats: WeaponMaterialLibrary): BuiltWeapon {
  switch (id) {
    case 'mk18':
      return buildMK18(mats);
    case 'ak74m':
      return buildAK74M(mats);
    case 'm870':
      return buildM870Shotgun(mats);
    case 'awm':
      return buildAWMSniper(mats);
    case 'glock19':
      return buildGlock19(mats);
  }
}

export function buildWeaponArsenal(mats: WeaponMaterialLibrary): Record<WeaponId, BuiltWeapon> {
  const arsenal = {} as Record<WeaponId, BuiltWeapon>;
  for (const id of WEAPON_ORDER) {
    arsenal[id] = buildWeaponById(id, mats);
  }
  return arsenal;
}
