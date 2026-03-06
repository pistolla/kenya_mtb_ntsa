    (function () {
      'use strict';
      // ===========================================================
      //  KENYA MTB SIMULATOR v3 -- Complete Rules & Audio Engine
      //  All NTSA MTB regulations encoded as hard logic constraints
      // ===========================================================

      // -- AUDIO SYSTEM (Web Audio API) ------------------------------
      class MTBAudioManager {
        constructor() {
          this.context = null;
          this.masterGain = null;
          this.nodes = new Map();
          this.isInitialized = false;
        }

        async initialize() {
          if (this.isInitialized) return;
          try {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.context.createGain();
            this.masterGain.gain.value = 0.4; // Default volume
            this.masterGain.connect(this.context.destination);

            this.createEngineSynth();
            this.createHornSynth();

            this.isInitialized = true;
            console.log("MTB Audio System initialized");
          } catch (e) {
            console.warn("Audio initialization failed:", e);
          }
        }

        createEngineSynth() {
          const osc = this.context.createOscillator();
          const filter = this.context.createBiquadFilter();
          const rpmGain = this.context.createGain();

          osc.type = 'sawtooth';
          osc.frequency.value = 60; // Base idle

          filter.type = 'lowpass';
          filter.Q.value = 1;
          filter.frequency.value = 400;

          osc.connect(filter);
          filter.connect(rpmGain);
          rpmGain.connect(this.masterGain);

          osc.start();
          this.nodes.set('engine', { osc, rpmGain, filter });
        }

        createHornSynth() {
          const fundamental = this.context.createOscillator();
          const gain = this.context.createGain();

          fundamental.type = 'square';
          fundamental.frequency.value = 400; // Horn fundamental

          gain.gain.value = 0; // Silent by default

          fundamental.connect(gain);
          gain.connect(this.masterGain);

          fundamental.start();
          this.nodes.set('horn', { gain });
        }

        updateEngine(speed, throttle, gear) {
          if (!this.isInitialized) return;
          const engine = this.nodes.get('engine');
          if (!engine) return;

          const baseFreq = gear === 'R' ? 60 : (70 + (Math.abs(speed) * 12));
          const rpmRatio = Math.min(Math.abs(speed) / 15, 1);

          engine.osc.frequency.setTargetAtTime(baseFreq, this.context.currentTime, 0.1);

          const targetGain = 0.05 + (throttle * 0.15) + (rpmRatio * 0.1);
          engine.rpmGain.gain.setTargetAtTime(targetGain, this.context.currentTime, 0.05);
          engine.filter.frequency.setTargetAtTime(400 + (rpmRatio * 1500), this.context.currentTime, 0.1);
        }

        triggerHorn(duration = 0.5) {
          if (!this.isInitialized) return;
          const horn = this.nodes.get('horn');
          if (!horn) return;

          const now = this.context.currentTime;
          horn.gain.gain.cancelScheduledValues(now);
          horn.gain.gain.setValueAtTime(0.3, now);
          horn.gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        }
      }

      const audioManager = new MTBAudioManager();

      // -- PERSISTENT STORAGE (IndexedDB) ----------------------------
      const DB_NAME = 'MTBSimulatorDB';
      const DB_VERSION = 1;
      const STORES = {
        SESSIONS: 'sessions',
        PROGRESS: 'progress',
        SETTINGS: 'settings',
        REPLAYS: 'replays'
      };

      class StorageManager {
        constructor() {
          this.db = null;
        }

        async init() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              this.db = request.result;
              resolve();
            };

            request.onupgradeneeded = (event) => {
              const db = event.target.result;

              if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                const sessionStore = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id', autoIncrement: true });
                sessionStore.createIndex('date', 'timestamp', { unique: false });
                sessionStore.createIndex('scenario', 'scenarioId', { unique: false });
                sessionStore.createIndex('grade', 'grade', { unique: false });
              }
              if (!db.objectStoreNames.contains(STORES.PROGRESS)) db.createObjectStore(STORES.PROGRESS, { keyPath: 'userId' });
              if (!db.objectStoreNames.contains(STORES.SETTINGS)) db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
              if (!db.objectStoreNames.contains(STORES.REPLAYS)) {
                const replayStore = db.createObjectStore(STORES.REPLAYS, { keyPath: 'sessionId' });
                replayStore.createIndex('date', 'timestamp', { unique: false });
              }
            };
          });
        }

        async saveSession(sessionData) {
          if (!this.db) return;
          const tx = this.db.transaction([STORES.SESSIONS], 'readwrite');
          const store = tx.objectStore(STORES.SESSIONS);

          const record = {
            timestamp: Date.now(),
            scenarioId: sessionData.scenarioId,
            score: sessionData.score,
            grade: sessionData.grade,
            violations: sessionData.violations,
            duration: sessionData.duration,
            route: sessionData.route || [],
            snapshot: sessionData.snapshot || null
          };

          return new Promise((resolve, reject) => {
            const req = store.add(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
        }

        async saveBalance(bal) {
          if (!this.db) return;
          const tx = this.db.transaction([STORES.SETTINGS], 'readwrite');
          const store = tx.objectStore(STORES.SETTINGS);
          return new Promise((res, rej) => {
            const req = store.put({ key: 'playerBalance', value: bal });
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          });
        }

        async loadBalance() {
          if (!this.db) return 500;
          const tx = this.db.transaction([STORES.SETTINGS], 'readonly');
          const store = tx.objectStore(STORES.SETTINGS);
          return new Promise((res) => {
            const req = store.get('playerBalance');
            req.onsuccess = () => res(req.result ? req.result.value : 500);
            req.onerror = () => res(500);
          });
        }
      }

      const storageManager = new StorageManager();

      // -- CONSTANTS -----------------------------------------------
      const C = {
        MAJ_LANES: 4, MIN_LANES: 3, MAJ_LW: 3.5, MIN_LW: 3.2,
        get MAJ_W() { return this.MAJ_LANES * this.MAJ_LW; },
        get MIN_W() { return this.MIN_LANES * this.MIN_LW; },
        SPD_MAJ: 50 / 3.6, SPD_MIN: 30 / 3.6, SPD_RDT: 20 / 3.6, SPD_PARK: 8 / 3.6, SPD_SCHOOL: 20 / 3.6,
        ACCEL: 5.8, BRAKE: 19, STEER: 1.85, MAX_STEER: 0.78,
        PED_3M: 3,   // 3-metre detection zone
        STOP_SEC: 3, // seconds for full stop compliance

        // Road Z positions
        // Major EW: dual carriageway -- upper (z=-50) ONE-WAY eastbound,
        //           lower (z=-36) ONE-WAY westbound, separated by yellow median z=-43
        MAJ_UPPER_Z: -50, MAJ_LOWER_Z: -36, MAJ_MID_Z: -43,
        // Minor roads: TWO-WAY (solid yellow centre line)
        MIN_H_Z: -105, MIN_H_BOT_Z: 40, MIN_V1_X: -30, PARK_Z: -80,
        // Roundabout (4 concentric lanes, clockwise, no lane changes)
        RDT_X: 130, RDT_Z: -43, RDT_OUTER: 24, RDT_INNER: 12, RDT_LANE_W: 3,
        // Roundabout arm length (approach road from ring edge outward)
        RDT_ARM: 18,

        PENALTIES: {
          SPEEDING: 8, RED_LIGHT: 20, WRONG_WAY: 25, WRONG_GEAR: 15,
          NO_SIGNAL: 6, YLW_KERB: 10, RDT_LANE_CHG: 15, NO_STOP: 18,
          COLLISION: 20, YLW_LINE: 25, NO_YIELD: 12, WRONG_LANE_EXIT: 12,
          PED_ENCROACH: 25, PED_OVERTAKE: 20, PED_HORN: 8,
          SOLID_LINE_CROSS: 20, NO_YIELD_PED: 15, CONT_WHITE_CROSS: 20,
        }
      };

      // Lane exit mapping -- NTSA MTB Official (spec v2)
      // Major formula 2-1-2-4:  L1=2opts, L2=1opt, L3=2opts, L4=4opts
      // Minor formula 2-1-5:    L1=2opts, L2=1opt, L3=5opts (Power Lane)
      const LANE_EXITS = {
        major: {
          1: ['left (90°)', 'straight (0°)'],
          2: ['straight (0°) ONLY'],
          3: ['straight (0°)', 'right (90°)'],
          4: ['right (90°)', '3rd exit (270° MAJ -> MIN)'] // NTSA rule: no U-turn from Lane 4 on major dual carriageways
        },
        minor: {
          1: ['left (90°)', 'straight (0°)'],
          2: ['straight (0°) ONLY'],
          3: ['straight (0°)', 'right (90°)', 'U-turn (180°)', 'P-turn (270°)', 'full circle (360°)']
        }
      };

      // Subtraction rule: major lane -> minor lane (major=4 lanes -> minor=3 lanes)
      // majorLane - 1 = minorLane.  Lane4->L3, Lane3->L2, Lane2->L1
      // Addition rule: minor lane -> major lane (minor=3 lanes -> major=4 lanes)
      // minorLane + 1 = majorLane.  Lane1->L2(or L1 for left), Lane2->L3, Lane3->L4
      const SUBTRACTION_RULE = { 4: 3, 3: 2, 2: 1 };
      const ADDITION_RULE = { 1: 2, 2: 3, 3: 4 };
      // Roundabout entry mapping:
      // Major L1/L2 -> outermost roundabout lanes (1/2)
      // Major L3/L4 -> innermost roundabout lanes (3/4)
      // Minor L1 -> outer roundabout lane (1), Minor L3 -> inner lane (3)
      const RDT_ENTRY_LANE_MAP = { major: { 1: 1, 2: 2, 3: 3, 4: 4 }, minor: { 1: 1, 2: 2, 3: 3 } };

      // -- THREE.JS -------------------------------------------------
      const mc = document.getElementById('mc');
      const oc = document.getElementById('oc');
      const cw = document.getElementById('cw');
      const renderer = new THREE.WebGLRenderer({ canvas: mc, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x8aabb8, 100, 320);
      const cam = new THREE.PerspectiveCamera(55, 1, .1, 500);

      function onResize() {
        const w = cw.clientWidth, h = cw.clientHeight;
        renderer.setSize(w, h); oc.width = w; oc.height = h;
        cam.aspect = w / h; cam.updateProjectionMatrix();
      }
      window.addEventListener('resize', onResize); onResize();

      // -- LIGHTS ---------------------------------------------------
      scene.add(new THREE.AmbientLight(0xbcccda, 0.65));
      const sun = new THREE.DirectionalLight(0xffe8c0, 1.3);
      sun.position.set(60, 90, 40); sun.castShadow = true;
      sun.shadow.mapSize.width = 2048; sun.shadow.mapSize.height = 2048;
      sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
      sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
      sun.shadow.camera.far = 500;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0x8899bb, .4);
      fill.position.set(-40, 20, -30);
      scene.add(fill);

      // -- GEOMETRY HELPERS -----------------------------------------
      function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }
      function box(w, h, d, color, opts = {}) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
        if (opts.cast !== false) m.castShadow = true; m.receiveShadow = true; return m;
      }
      function cyl(rt, rb, h, seg, color) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color)); }
      function dk(hex, f) { return ((((hex >> 16) & 0xff) * f | 0) << 16) | ((((hex >> 8) & 0xff) * f | 0) << 8) | (((hex & 0xff) * f | 0)); }

      // -- WORLD STATE ----------------------------------------------
      let world = null, trafficLights = [], stopSigns = [], yieldSigns = [], yellowKerbs = [],
        parkingZones = [], zebras = [], noEntryZones = [], noUTurnZones = [], solidLines = [],
        destMarker = null;

      // -- WORLD BUILD ----------------------------------------------
      function buildWorld(scenario) {
        if (world) scene.remove(world);
        world = new THREE.Group();
        trafficLights = []; stopSigns = []; yieldSigns = []; yellowKerbs = [];
        parkingZones = []; zebras = []; noEntryZones = []; noUTurnZones = []; solidLines = [];

        // Ground
        const g = box(400, .2, 400, 0x3a7a25); g.position.y = -.1; world.add(g);

        buildMajorRoads(); buildMinorRoads(); buildRoundabout();
        buildParkingLots(); buildEnvironment(); buildAllSigns();

        // Destination
        destMarker = buildDestGroup();
        world.add(destMarker);
        scene.add(world);
      }

      // -- MAJOR ROADS ----------------------------------------------
      // EW dual carriageway: upper (eastbound) z=-50, lower (westbound) z=-36
      //   Each road is 14u wide (4 lanes×3.5u). Outer edge at ±7u from centre.
      //   Upper: z=-57 to z=-43.  Lower: z=-43 to z=-29.
      //   Yellow median at z=-43 between the two.
      //   EW roads terminate at x=41 (rdtWest). W arm of roundabout takes over.
      //
      // NS dual carriageway: left (southbound) x=-70, right (northbound) x=-56
      //   Full length z=-130 to z=+130. Yellow median at x=-63.
      //   NS roads are INDEPENDENT of the roundabout (no direct connection).
      //
      // Minor H road: two-way, z=+30, x from -48 to +100. Yellow centre line.
      // Minor V road: two-way, x=+40, z from -28 to +80.  Yellow centre line.
      function buildMajorRoads() {
        const RC = 0x1e2228, hw = C.MAJ_W / 2, lw = C.MAJ_LW;
        const rdtWest = C.RDT_X - C.RDT_OUTER; // 41 — arm takes over east of here
        const ewLen = rdtWest + 130;            // 171
        const ewCx = (rdtWest - 130) / 2;         // -44.5

        // ── EW ONE-WAY DUAL CARRIAGEWAY ─────────────────────────────
        [{ z: C.MAJ_UPPER_Z, dir: 1 }, { z: C.MAJ_LOWER_Z, dir: -1 }].forEach(({ z, dir }) => {
          // Road slab
          const r = box(ewLen, .2, C.MAJ_W, RC); r.position.set(ewCx, .1, z); world.add(r);
          // Broken lane dividers (3 lines between 4 lanes)
          for (let l = 1; l < C.MAJ_LANES; l++) {
            const lz = z - hw + l * lw;
            for (let x = -128; x < rdtWest - 2; x += 8) {
              const d = box(4, .12, .18, 0xddddff); d.position.set(x, .22, lz); world.add(d);
            }
          }
          // Solid white outer edges only (no inner — median is yellow)
          const outerZ = z + (dir > 0 ? -hw : hw); // outermost edge away from median
          const outerLine = box(ewLen, .13, .22, 0xffffff); outerLine.position.set(ewCx, .23, outerZ); world.add(outerLine);
        });

        // Physical road divider island — simplified: only V1 crossing gap remains at -30 (v11)
        const DIV_W = 1.5, DIV_H = 0.15;
        const medianSegments = [
          { start: -130, end: -36 }, // Continuous until V1
          { start: -24, end: 41 }    // V1 Crossing gap: 12m
        ];

        medianSegments.forEach(seg => {
          const sLen = seg.end - seg.start;
          const sx = (seg.start + seg.end) / 2;
          const body = box(sLen, DIV_H, DIV_W, 0x888888); body.position.set(sx, DIV_H / 2, C.MAJ_MID_Z); world.add(body);
          const top = box(sLen, 0.04, DIV_W - 0.2, 0x3a7a28); top.position.set(sx, DIV_H + 0.02, C.MAJ_MID_Z); world.add(top);

          // Rounded ends (Cylinders) at junction mouths only
          [seg.start, seg.end].forEach(ex => {
            if (ex === -130 || ex === 41) return; // World bounds square
            const cap = cyl(DIV_W / 2, DIV_W / 2, DIV_H, 16, 0x888888);
            cap.position.set(ex, DIV_H / 2, C.MAJ_MID_Z); world.add(cap);
            const capTop = cyl(DIV_W / 2 - 0.1, DIV_W / 2 - 0.1, 0.04, 16, 0x3a7a28);
            capTop.position.set(ex, DIV_H + 0.02, C.MAJ_MID_Z); world.add(capTop);
          });

          // Yellow kerb lines
          const yt = box(sLen, 0.06, 0.08, 0xf5c400); yt.position.set(sx, DIV_H + 0.03, C.MAJ_MID_Z - DIV_W / 2); world.add(yt);
          const yb = box(sLen, 0.06, 0.08, 0xf5c400); yb.position.set(sx, DIV_H + 0.03, C.MAJ_MID_Z + DIV_W / 2); world.add(yb);
          yellowKerbs.push({ x: sx, z: C.MAJ_MID_Z, hw: sLen / 2 + (seg.start === -130 || seg.end === 41 ? 0 : 0.5), hd: DIV_W / 2 + 0.1, noStop: true, isMedian: true });
        });

        // Standalone zebra crossings on EW roads
        buildZebra(-48, C.MAJ_UPPER_Z, 'ew', C.MAJ_W);
        buildZebra(-48, C.MAJ_LOWER_Z, 'ew', C.MAJ_W);
      }

      function buildArrow(x, y, z, rot, s = 1) {
        // Arrows kept as no-ops to avoid breaking call sites; road surface stays clean
      }

      // -- MINOR ROADS ----------------------------------------------
      function buildMinorRoads() {
        const RC = 0x252a32, hw = C.MIN_W / 2, lw = C.MIN_LW;

        // TOP HORIZONTAL ROAD (MIN_H_Z)
        const hCz = C.MIN_H_Z, hLen = 340, hCx = 100; // spans across to roundabout
        const mh = box(hLen, .2, C.MIN_W, RC); mh.position.set(hCx, .1, hCz); world.add(mh);

        // Break yellow line strictly at V1 junction
        const tLen1 = (C.MIN_V1_X - hw) - (hCx - hLen / 2);
        if (tLen1 > 0) { const m1 = box(tLen1, .16, .3, 0xf5c400); m1.position.set((hCx - hLen / 2) + tLen1 / 2, .23, hCz); world.add(m1); }

        const z1x = -18, z2x = 118;
        buildZebra(z1x, hCz, 'ew', C.MIN_W);
        buildZebra(z2x, hCz, 'ew', C.MIN_W);

        // Solid yellow between zebras (no overtaking)
        const solidLen = z2x - z1x;
        const solidLine = box(solidLen, .16, .3, 0xf5c400);
        solidLine.position.set((z1x + z2x) / 2, .23, hCz); world.add(solidLine);

        // Broken line elsewhere
        const seg_v1_edge = C.MIN_V1_X + hw;
        const dash1Len = z1x - 2 - seg_v1_edge;
        if (dash1Len > 0) {
          for (let x = seg_v1_edge + 1; x < z1x - 2; x += 4) {
            const d = box(2, .15, .3, 0xf5c400); d.position.set(x + 1, .23, hCz); world.add(d);
          }
        }
        const rdt_edge = C.RDT_X - C.MAJ_W / 2;
        const dash2Len = rdt_edge - (z2x + 2);
        if (dash2Len > 0) {
          for (let x = z2x + 2; x < rdt_edge - 1; x += 4) {
            const d = box(2, .15, .3, 0xf5c400); d.position.set(x + 1, .23, hCz); world.add(d);
          }
        }

        // ── FLUSH PARKING (SOUTH SIDE) ──
        for (let x = z1x + 8; x < z2x - 8; x += 12) {
          const by = .23, bz = hCz + hw - 0.2;
          const bay = box(6, .14, .15, 0xffffff);
          bay.position.set(x, by, bz); world.add(bay);
          const bl1 = box(.15, .14, 2, 0xffffff); bl1.position.set(x - 3, by, hCz + hw + 1); world.add(bl1);
          const bl2 = box(.15, .14, 2, 0xffffff); bl2.position.set(x + 3, by, hCz + hw + 1); world.add(bl2);
          parkingBays.push({ x: x, z: hCz + hw + 0.5, ang: Math.PI / 2, side: 'south', type: 'parallel', occupied: null });
        }

        [-hw, hw].forEach(dz => {
          const e = box(hLen, .13, .22, 0xffffff); e.position.set(hCx, .23, hCz + dz); world.add(e);
        });
        for (let l = 1; l < C.MIN_LANES; l++) {
          const lz = hCz - hw + l * C.MIN_LW;
          for (let x = hCx - hLen / 2 + 4; x < hCx + hLen / 2 - 4; x += 8) {
            const d = box(4, .12, .18, 0xddddff); d.position.set(x, .22, lz); world.add(d);
          }
        }

        // V1 ROAD (Vertical Crossing)
        const vBot = 115, vTop = -115, vLen = vBot - vTop, vCz = (vTop + vBot) / 2;
        const vx = C.MIN_V1_X;
        const mv = box(C.MIN_W, .2, vLen, RC); mv.position.set(vx, .1, vCz); world.add(mv);

        // Yellow line segments for V1 (breaks at all junctions)
        const ySegments = [
          { s: -115, e: -109 }, // North of H_TOP
          { s: -101, e: -84 },  // North of Parking
          { s: -76, e: -57 },   // North of Highway
          { s: -29, e: 36 },    // South of Highway
          { s: 44, e: 115 }     // South of H_BOT
        ];
        ySegments.forEach(seg => {
          const sLen = seg.e - seg.s;
          const yc = box(.3, .16, sLen, 0xf5c400); yc.position.set(vx, .23, (seg.s + seg.e) / 2); world.add(yc);
        });

        [-hw, hw].forEach(dx => {
          const e = box(.22, .13, vLen, 0xffffff); e.position.set(vx + dx, .23, vCz); world.add(e);
        });
        for (let l = 1; l < C.MIN_LANES; l++) {
          const lx = vx - hw + l * C.MIN_LW;
          for (let z = vTop + 4; z < vBot - 4; z += 8) {
            if (Math.abs(z - C.MIN_H_Z) < 8 || Math.abs(z - C.PARK_Z) < 8 || Math.abs(z - C.MAJ_MID_Z) < 18 || Math.abs(z - C.MIN_H_BOT_Z) < 8) continue;
            const d = box(.18, .12, 4, 0xddddff); d.position.set(lx, .22, z); world.add(d);
          }
        }

        // T-Junctions overlapping Major Road
        const juncMAJ = box(C.MIN_W, .22, C.MAJ_W, 0x1e2228); juncMAJ.position.set(vx, .13, C.MAJ_UPPER_Z); world.add(juncMAJ);
        const juncMAJ2 = box(C.MIN_W, .22, C.MAJ_W, 0x1e2228); juncMAJ2.position.set(vx, .13, C.MAJ_LOWER_Z); world.add(juncMAJ2);

        // T-Junctions overlapping Minor Roads
        const juncTop = box(C.MIN_W, .22, C.MIN_W, 0x1e2228); juncTop.position.set(vx, .13, C.MIN_H_Z); world.add(juncTop);
        const juncBot = box(C.MIN_W, .22, C.MIN_W, 0x1e2228); juncBot.position.set(vx, .13, C.MIN_H_BOT_Z); world.add(juncBot);

        // SOUTH HORIZONTAL ROAD (MIN_H_BOT_Z)
        const shz = C.MIN_H_BOT_Z, shLen = 340, shCx = 100;
        const sh = box(shLen, .2, C.MIN_W, RC); sh.position.set(shCx, .1, shz); world.add(sh);
        for (let x = shCx - shLen / 2 + 1; x < shCx + shLen / 2 - 1; x += 4) {
          if (Math.abs(x - vx) < 4) continue;
          const d = box(2, .15, .3, 0xf5c400); d.position.set(x + 1, .23, shz); world.add(d);
        }
        [-hw, hw].forEach(dz => {
          const e = box(shLen, .13, .22, 0xffffff); e.position.set(shCx, .23, shz + dz); world.add(e);
        });
        for (let l = 1; l < C.MIN_LANES; l++) {
          const lz = shz - hw + l * C.MIN_LW;
          for (let x = shCx - shLen / 2 + 4; x < shCx + shLen / 2 - 4; x += 8) {
            if (Math.abs(x - vx) < 8) continue;
            const d = box(4, .12, .18, 0xddddff); d.position.set(x, .22, lz); world.add(d);
          }
        }

        // Zebras and Signs for V1 / Highway Junction
        buildZebra(vx, C.MAJ_UPPER_Z - C.MAJ_W / 2 - 4, 'ns', C.MIN_W);
        buildZebra(vx, C.MAJ_LOWER_Z + C.MAJ_W / 2 + 4, 'ns', C.MIN_W);
        stopSigns.push({ x: vx, z: C.MAJ_UPPER_Z - C.MAJ_W / 2 - 5, r: 8, stopHeld: 0, passed: false });
        stopSigns.push({ x: vx, z: C.MAJ_LOWER_Z + C.MAJ_W / 2 + 5, r: 8, stopHeld: 0, passed: false });

        // Roundabout North Arm T-Junction to Top Minor Road
        const juncN = box(C.MAJ_W, .22, C.MIN_W * 2, 0x1e2228);
        juncN.position.set(C.RDT_X, .14, C.MIN_H_Z); world.add(juncN);
      }

      function buildZigzag(x, z, axis) {
        for (let i = -4; i <= 4; i++) {
          const zz = box(axis === 'ew' ? .22 : .22, .13, axis === 'ew' ? 1.2 : 1.2, 0xf5c400);
          zz.position.set(axis === 'ew' ? x + i * 1.8 : x, z, .22 + i * .22);
          zz.rotation.y = .5;
          world.add(zz);
        }
      }

      // -- ZEBRA CROSSINGS ------------------------------------------
      // Spec (exact):
      //   Stripes: 0.5m wide × 4.0m long, PARALLEL to traffic (longitudinal).
      //   Gap:     0.5m between stripes (black asphalt shows through).
      //   Pitch:   1.0m (0.5 stripe + 0.5 gap).
      //   Span:    full carriageway width.
      //   Position: crossing centre is 1.0m before the stop line.
      // Axis convention:
      //   'ew' = road runs East-West → cars travel in X → stripes are 4m long in X,
      //           0.5m wide in Z, stacked laterally in Z across the road.
      //   'ns' = road runs North-South → cars travel in Z → stripes are 4m long in Z,
      //           0.5m wide in X, stacked laterally in X across the road.
      // polygonOffset eliminates z-fighting with road surface.
      function buildZebra(cx, cz, axis, roadW) {
        roadW = roadW || C.MAJ_W;
        const SW = 0.5, SL = 4.0, GAP = 0.5, PITCH = 1.0;
        const nStripes = Math.ceil(roadW / PITCH);
        const span = nStripes * PITCH;           // total lateral span
        const stripeMat = new THREE.MeshStandardMaterial({
          color: 0xeeeeee, roughness: 0.8, metalness: 0.0,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        const slMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: 0.7, metalness: 0.0,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        for (let i = 0; i < nStripes; i++) {
          const lat = -span / 2 + (i + 0.5) * PITCH;   // lateral position across road
          const mesh = axis === 'ew'
            ? new THREE.Mesh(new THREE.BoxGeometry(SL, 0.04, SW), stripeMat)  // long in X
            : new THREE.Mesh(new THREE.BoxGeometry(SW, 0.04, SL), stripeMat); // long in Z
          if (axis === 'ew') mesh.position.set(cx, 0.22, cz + lat);
          else mesh.position.set(cx + lat, 0.22, cz);
          world.add(mesh);
        }
        // Stop line: 1m past crossing centre (on departure side), perpendicular to road
        if (axis === 'ew') {
          // If axis is 'ew', road runs EW. Stop line crosses the road, so its length is in Z.
          const sl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, roadW), slMat);
          // Stop line is placed at X = cx +/- span/2. Let's just put it slightly offset.
          // The old code assumed traffic direction, we'll just center it properly or use cx.
          sl.position.set(cx + span / 2 + 1.0, 0.23, cz);
          world.add(sl);
        } else {
          // If axis is 'ns', road runs NS. Stop line length is in X.
          const sl = new THREE.Mesh(new THREE.BoxGeometry(roadW, 0.05, 0.4), slMat);
          // Stop line is placed at Z = cz
          sl.position.set(cx, 0.23, cz + span / 2 + 1.0);
          world.add(sl);
        }
        zebras.push({ cx, cz, axis, roadW, w: axis === 'ew' ? SL : span, d: axis === 'ew' ? span : SL, pedPhase: 'wait' });
      }

      // -- ROUNDABOUT -----------------------------------------------
      //
      // Centre: (65,-43). Inner radius=12, Outer radius=24. 4 lanes, 3u each.
      // Lane centres from ring centre: 13.5, 16.5, 19.5, 22.5
      //
      // ARMS — each arm is a road connector from ring edge outward:
      //
      //  W arm (a=π): spans the FULL dual carriageway width = 28u
      //    Centreline z=-43, half-width=14u -> covers z=-57 to z=-29
      //    Upper EW road (z=-57..-43) and lower EW road (z=-43..-29) both fit.
      //    Arm surface is 28u wide, extending outward from ring until EW roads pick up.
      //    Lane dividers on arm mirror the EW road lanes.
      //
      //  E arm (a=0):   14u wide, exits east
      //  N arm (a=-π/2): 14u wide, exits north  
      //  S arm (a=+π/2): 14u wide, extends south 50u to minor H road at z=+30
      //
      // ap(a,d,s): world coord on arm angle 'a', dist d from ring edge, lateral s.
      //   fwd = (cosA, sinA), left-perp = (-sinA, cosA)
      //   x = cx + cosA*(OR+d) + (-sinA)*s
      //   z = cz + sinA*(OR+d) + ( cosA)*s

      function buildRoundabout() {
        const { RDT_X: cx, RDT_Z: cz, RDT_OUTER: oR, RDT_INNER: iR } = C;
        const laneW = (oR - iR) / 4;  // 3u per lane
        const hw = C.MAJ_W / 2;     // 7u = half of one carriageway

        function ap(a, d, s) {
          const cosA = Math.cos(a), sinA = Math.sin(a);
          return { x: cx + cosA * (oR + d) + (-sinA) * s, z: cz + sinA * (oR + d) + (cosA) * s };
        }

        // ── RING SURFACE ─────────────────────────────────────────────
        {
          const geo = new THREE.RingGeometry(iR, oR, 72);
          const m = new THREE.Mesh(geo, mat(0x1e2228, { side: THREE.DoubleSide }));
          m.rotation.x = -Math.PI / 2; m.position.set(cx, .15, cz); world.add(m);
        }

        // ── INNER ISLAND ─────────────────────────────────────────────
        {
          const isl = cyl(iR - .06, iR - .06, .7, 64, 0x2a6818);
          isl.position.set(cx, .32, cz); world.add(isl);
          const kg = new THREE.RingGeometry(iR - .18, iR + .2, 72);
          const km = new THREE.Mesh(kg, mat(0xffffff, { side: THREE.DoubleSide }));
          km.rotation.x = -Math.PI / 2; km.position.set(cx, .34, cz); world.add(km);
          // Trees on island
          for (let a = 0; a < Math.PI * 2; a += Math.PI * .7) {
            const t = cyl(.26, .38, 2.4, 8, 0x5c3d1e); t.position.set(cx + Math.cos(a) * 5.8, 1.2, cz + Math.sin(a) * 5.8); world.add(t);
            const c = cyl(1.7, .26, 3.6, 8, 0x2d7a2d); c.position.set(cx + Math.cos(a) * 5.8, 3.9, cz + Math.sin(a) * 5.8); world.add(c);
          }
        }

        // ── SOLID LANE DIVIDERS (no lane changes inside ring) ────────
        [iR, iR + laneW, iR + 2 * laneW, iR + 3 * laneW, oR].forEach(r => {
          const g = new THREE.RingGeometry(r - .12, r + .12, 72);
          const m = new THREE.Mesh(g, mat(0xffffff, { side: THREE.DoubleSide }));
          m.rotation.x = -Math.PI / 2; m.position.set(cx, .33, cz); world.add(m);
        });

        // ── CLOCKWISE ARROWS ─────────────────────────────────────────
        [iR + laneW * .5, iR + laneW * 1.5, iR + laneW * 2.5, iR + laneW * 3.5].forEach(r => {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 2.2) {
            const ar = box(.13, .12, .85, 0x44446a);
            ar.position.set(cx + Math.cos(a) * r, .33, cz + Math.sin(a) * r);
            ar.rotation.y = a - Math.PI / 2; world.add(ar);
          }
        });

        // ── ISLAND DIRECTIONAL SIGNS (facing each approach) ──────────
        [Math.PI, -Math.PI / 2, Math.PI / 2, 0].forEach(a => {
          const cosA = Math.cos(a), sinA = Math.sin(a);
          const sx = cx + cosA * (iR - 2), sz = cz + sinA * (iR - 2);
          const pole = cyl(.07, .07, 3, 8, 0x777777); pole.position.set(sx, 1.5, sz); world.add(pole);
          const disc = cyl(.48, .48, .1, 20, 0x003399); disc.rotation.x = Math.PI / 2; disc.position.set(sx, 3.4, sz); world.add(disc);
          const rg = new THREE.RingGeometry(.18, .30, 12, 1, 0, Math.PI * 1.45);
          const rm = new THREE.Mesh(rg, mat(0xffffff, { side: THREE.DoubleSide }));
          rm.rotation.x = -Math.PI / 2; rm.position.set(sx, 3.5, sz); world.add(rm);
        });

        // ═══════════════════════════════════════════════════════════════
        // W ARM — 28u wide, bridges both EW dual carriageways
        // Centreline z=-43, spans z=-57 to z=-29
        // ═══════════════════════════════════════════════════════════════
        {
          const a = Math.PI;
          const cosA = Math.cos(a), sinA = Math.sin(a); // cosA=-1, sinA=0
          const W_HW = hw * 2;  // 14u half-width (28u total) covering both carriageways
          const ARM_LEN = 22; // outward from ring edge

          // Road slab: extends from ring centre outward (fills ring gap too)
          const extLen = ARM_LEN + oR;
          const armCx = cx + cosA * (oR + ARM_LEN / 2 - oR / 2);
          const armCz = cz; // centred on median z=-43
          const armSurf = box(extLen, .22, W_HW * 2, 0x1e2228);
          armSurf.rotation.y = a; armSurf.position.set(armCx, .11, armCz); world.add(armSurf);

          // Lane dividers on W arm — mirror EW upper (eastbound) lanes above median
          // and EW lower (westbound) lanes below median.
          // Upper EW (eastbound, z=-57 to -43): lane dividers between L1-L4
          //   L1-L2 boundary: z=-53.5 | L2-L3: z=-50 | L3-L4: z=-46.5
          // Lower EW (westbound, z=-43 to -29): mirror of upper
          //   L1-L2: z=-32.5 | L2-L3: z=-36 | L3-L4: z=-39.5
          // Yellow median stripe at z=-43 (already in W arm road centre)

          // Upper half broken lane dividers
          [{ lz: C.MAJ_UPPER_Z - C.MAJ_W / 2 + C.MAJ_LW },   // -53.5
          { lz: C.MAJ_UPPER_Z - C.MAJ_W / 2 + 2 * C.MAJ_LW }, // -50
          { lz: C.MAJ_UPPER_Z - C.MAJ_W / 2 + 3 * C.MAJ_LW }, // -46.5
          ].forEach(({ lz }) => {
            for (let d = 1; d < ARM_LEN - 1; d += 4) {
              const dm = box(.13, .14, 1.6, 0xddddff);
              dm.position.set(cx + cosA * (oR + d + 1.5), .27, lz); world.add(dm);
            }
          });
          // Lower half broken lane dividers (mirrored)
          [{ lz: C.MAJ_LOWER_Z + C.MAJ_W / 2 - C.MAJ_LW },   // -32.5
          { lz: C.MAJ_LOWER_Z + C.MAJ_W / 2 - 2 * C.MAJ_LW }, // -36
          { lz: C.MAJ_LOWER_Z + C.MAJ_W / 2 - 3 * C.MAJ_LW }, // -39.5
          ].forEach(({ lz }) => {
            for (let d = 1; d < ARM_LEN - 1; d += 4) {
              const dm = box(.13, .14, 1.6, 0xddddff);
              dm.position.set(cx + cosA * (oR + d + 1.5), .27, lz); world.add(dm);
            }
          });

          // Yellow median continues on W arm
          const med = box(ARM_LEN, .34, .65, 0xf5c400);
          med.position.set(cx + cosA * (oR + ARM_LEN / 2), .25, C.MAJ_MID_Z); world.add(med);

          // Solid outer edges (top z=-57, bottom z=-29)
          [-W_HW, W_HW].forEach(s => {
            const el = box(ARM_LEN, .13, .22, 0xffffff);
            el.position.set(cx + cosA * (oR + ARM_LEN / 2), .25, cz + s); world.add(el);
          });

          // Stop line at junction mouth: one across each carriageway
          const slX = cx + cosA * (oR + 0.8);
          const sl1 = box(.4, .16, C.MAJ_W, 0xffffff);
          sl1.position.set(slX, .27, C.MAJ_UPPER_Z); world.add(sl1);
          const sl2 = box(.4, .16, C.MAJ_W, 0xffffff);
          sl2.position.set(slX, .27, C.MAJ_LOWER_Z); world.add(sl2);

          // Traffic lights at junction corners (outside road, on verge)
          [C.MAJ_UPPER_Z - hw - 1, C.MAJ_UPPER_Z + hw + 1, C.MAJ_LOWER_Z - hw - 1, C.MAJ_LOWER_Z + hw + 1].forEach(tlZ => {
            buildTLSet(slX - 1.5, tlZ, 0); // face eastward
          });

          // Zebra on W arm: road runs EW → axis='ew' (stripes are EW slabs stacked in Z)
          // Placed 5u before junction mouth. Junction mouth at x=41=oR+cx from ring.
          // W arm cosA=-1 so d increases toward x=41→20→ arm end.
          // 5u before mouth = at d=oR+4 from ring (since zbX = cx+cosA*(oR+d))
          const zbX = cx + cosA * (oR + 5);
          buildZebra(zbX, C.MAJ_UPPER_Z, 'ew', C.MAJ_W);
          buildZebra(zbX, C.MAJ_LOWER_Z, 'ew', C.MAJ_W);

          // Yield sign on left verge at mouth
          world.add(buildYieldSign(slX - 1, C.MAJ_UPPER_Z - hw - 2.5, Math.PI));
          world.add(buildYieldSign(slX - 1, C.MAJ_LOWER_Z + hw + 2.5, Math.PI));
          yieldSigns.push({ x: slX, z: C.MAJ_UPPER_Z, r: hw * 1.1, isRoundabout: true });
          yieldSigns.push({ x: slX, z: C.MAJ_LOWER_Z, r: hw * 1.1, isRoundabout: true });

          // Warning sign on verge furthest back
          const warnX = cx + cosA * (oR + ARM_LEN - 2);
          buildWarnSign(warnX, C.MAJ_UPPER_Z - hw - 2.5);
          buildWarnSign(warnX, C.MAJ_LOWER_Z + hw + 2.5);
        }

        // ═══════════════════════════════════════════════════════════════
        // E / N / S ARMS — standard 14u wide
        // ═══════════════════════════════════════════════════════════════
        [
          { a: 0, ARM_LEN: 22, label: 'E', isMajor: true },
          { a: -Math.PI / 2, ARM_LEN: Math.abs(cz - C.MIN_H_Z) - oR, label: 'N', isMajor: false },
          { a: Math.PI / 2, ARM_LEN: 50, label: 'S', isMajor: false },
        ].forEach(({ a, ARM_LEN, label, isMajor }) => {
          const cosA = Math.cos(a), sinA = Math.sin(a);
          const roadW = isMajor ? C.MAJ_W : C.MIN_W;
          const roadHW = roadW / 2;

          // Road slab extends under ring to eliminate edge gaps
          const extLen = ARM_LEN + oR;
          const armCx = cx + cosA * (oR + ARM_LEN / 2 - oR / 2);
          const armCz = cz + sinA * (oR + ARM_LEN / 2 - oR / 2);
          const surf = box(extLen, .22, roadW, 0x1e2228);
          surf.rotation.y = a; surf.position.set(armCx, .11, armCz); world.add(surf);

          // Outer solid edges
          [-roadHW, roadHW].forEach(s => {
            const pt = ap(a, ARM_LEN / 2, s);
            const el = box(ARM_LEN, .13, .22, 0xffffff);
            el.rotation.y = a; el.position.set(pt.x, .25, pt.z); world.add(el);
          });

          // Broken lane dividers
          const divs = isMajor ? [-C.MAJ_LW, 0, C.MAJ_LW] : [-1.6, 1.6];
          divs.forEach(s => {
            for (let d = 4; d < ARM_LEN - 1; d += 4) {
              const pt = ap(a, d + 1.5, s);
              const dm = box(.13, .14, 1.8, 0xddddff);
              dm.rotation.y = a; dm.position.set(pt.x, .27, pt.z); world.add(dm);
            }
          });

          // Stop line at junction mouth (d=0.5)
          {
            const slPt = ap(a, 0.5, 0);
            const sl = box(roadW + .3, .16, .48, 0xffffff);
            sl.rotation.y = a; sl.position.set(slPt.x, .27, slPt.z); world.add(sl);
          }

          // Traffic lights at junction CORNERS — outside road (verge), not on road
          {
            const tlPt1 = ap(a, 0.5, -(roadHW + 1.5));
            const tlPt2 = ap(a, 0.5, (roadHW + 1.5));
            const tlRot = a + Math.PI / 2;
            buildTLSet(tlPt1.x, tlPt1.z, tlRot);
            buildTLSet(tlPt2.x, tlPt2.z, tlRot);
          }

          // Zebra crossing — 2u wide, perpendicular to arm, at d=5
          {
            const zpt = ap(a, 5, 0);
            const zbAxis = Math.abs(cosA) > .5 ? 'ew' : 'ns'; // road runs EW→axis='ew', NS→axis='ns'
            buildZebra(zpt.x, zpt.z, zbAxis, roadW);
          }

          // (Yield marks on road omitted — kept as logic-only via yieldSigns array)

          // Yield sign on left verge at d=0.5
          {
            const gyPt = ap(a, 0.5, -(roadHW + 2.2));
            world.add(buildYieldSign(gyPt.x, gyPt.z, a + Math.PI));
            yieldSigns.push({ x: ap(a, 1, 0).x, z: ap(a, 1, 0).z, r: roadHW * 1.1, isRoundabout: true });
          }

          // Warning sign on left verge furthest back
          {
            const wpt = ap(a, ARM_LEN - 1, -(roadHW + 2.5));
            buildWarnSign(wpt.x, wpt.z);
          }

          // S arm special: extend to minor H road and add junction box
          if (label === 'S') {
            // No South arm T-junction needed for this layout. Minor road forms T-junction at major road instead.
          }
        });
      }

      // Helper: warning diamond sign
      function buildWarnSign(x, z) {
        const pole = cyl(.07, .07, 2.9, 8, 0x888888); pole.position.set(x, 1.45, z); world.add(pole);
        const sgn = box(.94, .94, .1, 0xf5c400); sgn.position.set(x, 3.2, z); sgn.rotation.y = Math.PI / 4; world.add(sgn);
        const inn = box(.60, .60, .12, 0x1a1200); inn.position.set(x, 3.2, z); inn.rotation.y = Math.PI / 4; world.add(inn);
      }

      // -- PARKING LOTS ---------------------------------------------
      // Sedan parking: diagonal bays on LEFT and RIGHT sides of a central 2-way aisle.
      // The aisle (4u wide) runs N-S, connecting at both ends to the minor H road.
      // Layout (top view, z increases downward = south):
      //   x=47..87 total (40u wide), z=lotTop..lotTop+18
      //   Aisle: x=65..69 (4u), full lot length — 2-way N-S traffic
      //   Left bays:  x=47..65 (18u), diagonal at 60° (drive-in from right/aisle)
      //   Right bays: x=69..87 (18u), diagonal at 120° (mirror)
      //   North exit: aisle connects to minor H road directly (gap filled)
      //   South wall: bays end, aisle continues to z=lotTop+18 with exit road south
      // Parallel parking: west side, simple parallel bays along road
      const parkingBays = [];
      function buildParkingLots() {
        const roadSouth = C.MIN_H_Z + C.MIN_W / 2;  // -77.8
        const roadNorth = C.MAJ_UPPER_Z - C.MAJ_W / 2; // -57

        // Horizontal Aisle at C.PARK_Z (between V1 and V2)
        const AISLE_Z = C.PARK_Z;
        const AISLE_X1 = C.MIN_V1_X; // -30
        const AISLE_X2 = C.RDT_X; // 130
        const AISLE_H = 8;
        const AISLE_W = AISLE_X2 - AISLE_X1;

        // ── SEDAN DIAGONAL PARKING ────────────────────────────────────
        // Lot spans between V1 and V2, centered on AISLE_Z
        const LOT_X1 = AISLE_X1, LOT_X2 = AISLE_X2;
        const LOT_Z1 = AISLE_Z - 12, LOT_Z2 = AISLE_Z + 12;
        const LOT_CX = (LOT_X1 + LOT_X2) / 2;
        const LOT_W = LOT_X2 - LOT_X1;
        const LOT_D = LOT_Z2 - LOT_Z1;

        // Lot ground (dark asphalt)
        const gnd = box(LOT_W, .2, LOT_D, 0x252830);
        gnd.position.set(LOT_CX, .11, AISLE_Z); world.add(gnd);

        // Horizontal aisle (slightly lighter — active road)
        const aisle = box(LOT_W, .22, AISLE_H, 0x1e2228);
        aisle.position.set(LOT_CX, .12, AISLE_Z); world.add(aisle);

        // Aisle centre line (yellow dashed — 2-way)
        for (let x = LOT_X1 + 1; x < LOT_X2 - 1; x += 3) {
          const d = box(1.5, .14, .3, 0xf5c400); d.position.set(x + .75, .23, AISLE_Z); world.add(d);
        }

        // Aisle edge lines (white solid — lane boundaries)
        [AISLE_Z - AISLE_H / 2, AISLE_Z + AISLE_H / 2].forEach(az => {
          const el = box(LOT_W, .14, .2, 0xffffff); el.position.set(LOT_CX, .23, az); world.add(el);
        });

        // ── NORTH BAYS (Above aisle) ──
        const BAY_ANG = Math.PI / 3; // 60 deg
        const bays = 8; // Reduce count to clear roads
        const baySpacing = (LOT_W - 30) / bays; // Padding at ends
        for (let i = 0; i <= bays; i++) {
          const bx = LOT_X1 + 10 + i * baySpacing; // Start 10m after V1
          if (bx > C.RDT_X - 15) continue; // End 15m before Roundabout Arm
          const bl = box(.15, .14, 6, 0xffffff);
          bl.rotation.y = BAY_ANG;
          bl.position.set(bx, .23, AISLE_Z - 6); world.add(bl);
          parkingBays.push({ x: bx, z: AISLE_Z - 6, ang: BAY_ANG, side: 'north', occupied: null });
        }

        // ── SOUTH BAYS (Below aisle) ──
        for (let i = 0; i <= bays; i++) {
          const bx = LOT_X1 + 10 + i * baySpacing;
          if (bx > C.RDT_X - 15) continue;
          const bl = box(.15, .14, 6, 0xffffff);
          bl.rotation.y = -BAY_ANG;
          bl.position.set(bx, .23, AISLE_Z + 6); world.add(bl);
          parkingBays.push({ x: bx, z: AISLE_Z + 6, ang: -BAY_ANG, side: 'south', occupied: null });
        }

        parkingZones.push({ type: 'angle', x: LOT_CX, z: AISLE_Z, hw: LOT_W / 2, hd: LOT_D / 2, entryG: 'D', exitG: 'R' });
      }

      function buildParkSign(x, z, type, sub) {
        const p = cyl(.12, .12, 3, 8, 0x556677); p.position.set(x, 1.5, z); world.add(p);
        const b = box(7, 1.8, .15, 0x1a3a6a); b.position.set(x, 3.3, z); world.add(b);
        const t = box(6.5, .3, .16, 0x4477aa); t.position.set(x, 4.25, z); world.add(t);
      }

      // -- ENVIRONMENT ----------------------------------------------
      function buildEnvironment() {
        // Buildings moved to outer green area (>20m from roads)
        const buildings = [
          [100, 50, 20, 35, 15, 0x8a9eb8],
          [-100, 50, 22, 42, 16, 0x7a8e9a],
          [200, 50, 18, 28, 14, 0x9aab8a],
          [-200, 50, 25, 40, 20, 0xa09080],
          [100, -150, 15, 25, 12, 0x886ea0],
          [-100, -150, 20, 30, 16, 0x9a7060],
          [200, -150, 14, 19, 11, 0x708090],
          [-200, -150, 18, 29, 15, 0x607060],
          [0, -150, 12, 18, 10, 0x778899]
        ];
        buildings.forEach(([x, z, w, h, d, col]) => {
          const b2 = box(w, h, d, col); b2.position.set(x, h / 2, z); world.add(b2);
          const rf = box(w + .7, .9, d + .7, dk(col, .72)); rf.position.set(x, h + .45, z); world.add(rf);
        });

        // Trees spaced out
        [
          [150, 80], [150, -80], [-150, 80], [-150, -80],
          [50, 120], [-50, 120], [50, -160], [-50, -160],
          [220, 40], [-220, 40]
        ].forEach(([x, z]) => addTree(x, z));

        // Street lights
        const slu_z = C.MAJ_UPPER_Z - C.MAJ_W / 2 - 1.5;
        const sll_z = C.MAJ_LOWER_Z + C.MAJ_W / 2 + 1.5;
        for (let x = -150; x <= 250; x += 40) { addSL(x, slu_z); addSL(x, sll_z); }
      }
      function addTree(x, z) {
        const t = cyl(.35, .46, 3, 8, 0x5c3d1e); t.position.set(x, 1.5, z); world.add(t);
        const c = cyl(2.8, .4, 5, 8, 0x2d7a2d); c.position.set(x, 5.5, z); world.add(c);
      }
      function addSL(x, z) {
        const p = cyl(.1, .1, 7, 8, 0x556677); p.position.set(x, 3.5, z); world.add(p);
        const h = box(1, .4, .5, 0x334455); h.position.set(x, 7.1, z); world.add(h);
      }

      // -- SIGNS ----------------------------------------------------
      // Spec: signs planted on verges, pavements, or traffic island only.
      // Never inside the carriageway.
      function buildAllSigns() {
        const hw = C.MAJ_W / 2;

        // ── KEEP LEFT mandatory signs on verge beside major roads ──
        // Placed on the LEFT verge (south side of upper EW, north side of lower EW)
        [{ x: -50, z: C.MAJ_UPPER_Z - hw - 2 }, { x: 10, z: C.MAJ_UPPER_Z - hw - 2 },
        { x: -50, z: C.MAJ_LOWER_Z + hw + 2 }, { x: 10, z: C.MAJ_LOWER_Z + hw + 2 }]
          .forEach(p => world.add(buildMandatorySign(p.x, p.z, 'KL')));

        // ── NO U-TURN signs on verge ────────────────────────────────
        [{ x: -20, z: C.MAJ_UPPER_Z - hw - 2 }].forEach(p => {
          world.add(buildNoUTurnSign(p.x, p.z));
          noUTurnZones.push({ x: p.x, z: p.z, r: 10 });
        });

        // No-entry signs placed on left NS road verge (one-way)
        // world.add(buildNoEntrySign(...)); // omit to keep roads clean


      }

      function buildTLSet(x, z, rot) {
        const g = new THREE.Group();
        const p = cyl(.12, .12, 6.5, 8, 0x333333); p.position.y = 3.25; g.add(p);
        const hous = box(.72, 2.4, .55, 0x111111); hous.position.set(0, 7, 0); g.add(hous);
        const rL = cyl(.22, .22, .12, 12, 0xff2200); rL.rotation.x = Math.PI / 2; rL.position.set(0, 8.1, -.3); g.add(rL);
        const raL = cyl(.22, .22, .12, 12, 0x443300); raL.rotation.x = Math.PI / 2; raL.position.set(0, 7.4, -.3); g.add(raL);
        const gL = cyl(.22, .22, .12, 12, 0x004400); gL.rotation.x = Math.PI / 2; gL.position.set(0, 6.7, -.3); g.add(gL);
        const aL = cyl(.22, .22, .12, 12, 0x443300); aL.rotation.x = Math.PI / 2; aL.position.set(0, 6.0, -.3); g.add(aL);
        g.position.set(x, 0, z); g.rotation.y = rot;
        world.add(g);
        trafficLights.push({ r: rL, ra: raL, g: gL, a: aL, state: 'red', timer: 0, offset: trafficLights.length * 2.8, pos: new THREE.Vector3(x, 0, z) });
      }

      function buildStopSignPost(x, z, rot) {
        const g = new THREE.Group();
        const p = cyl(.09, .09, 3.6, 8, 0x888888); p.position.y = 1.8; g.add(p);
        const s = new THREE.Mesh(new THREE.CylinderGeometry(.46, .46, .09, 8), mat(0xcc0000));
        s.position.y = 3.9; s.rotation.y = Math.PI / 8; g.add(s);
        const sb = cyl(.49, .49, .07, 8, 0xffffff); sb.position.y = 3.87; sb.rotation.y = Math.PI / 8; g.add(sb);
        g.position.set(x, 0, z); g.rotation.y = rot; return g;
      }

      function buildYieldSign(x, z, rot) {
        const g = new THREE.Group();
        const p = cyl(.09, .09, 2.8, 8, 0x888888); p.position.y = 1.4; g.add(p);
        // Inverted triangle
        const shape = new THREE.Shape();
        shape.moveTo(0, .45); shape.lineTo(-.4, -.25); shape.lineTo(.4, -.25); shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        const sm = new THREE.Mesh(geo, mat(0xdd0000, { side: THREE.DoubleSide }));
        sm.rotation.x = -Math.PI / 2; sm.position.set(0, 3, .0); sm.scale.set(1.8, 1.8, 1.8); g.add(sm);
        const border = new THREE.Mesh(geo, mat(0xffffff, { side: THREE.DoubleSide }));
        border.rotation.x = -Math.PI / 2; border.position.set(0, 2.95, 0); border.scale.set(2, 2, 2); g.add(border);
        g.position.set(x, 0, z); g.rotation.y = rot; return g;
      }

      function buildMandatorySign(x, z, type) {
        const g = new THREE.Group();
        const p = cyl(.09, .09, 3, 8, 0x888888); p.position.y = 1.5; g.add(p);
        const disc = cyl(.4, .4, .08, 20, 0x0044cc); disc.rotation.x = Math.PI / 2; disc.position.set(0, 3.1, 0); g.add(disc);
        const arr = box(.06, .06, .5, 0xffffff); arr.position.set(0, 3.1, -.1); arr.rotation.z = Math.PI / 4; g.add(arr);
        g.position.set(x, 0, z); return g;
      }

      function buildNoEntrySign(x, z) {
        const g = new THREE.Group();
        const p = cyl(.09, .09, 3, 8, 0x888888); p.position.y = 1.5; g.add(p);
        const disc = cyl(.44, .44, .09, 20, 0xcc0000); disc.rotation.x = Math.PI / 2; disc.position.set(0, 3.2, 0); g.add(disc);
        const bar = box(.65, .08, .1, 0xffffff); bar.position.set(0, 3.2, -.06); g.add(bar);
        g.position.set(x, 0, z); return g;
      }

      function buildNoUTurnSign(x, z) {
        const g = new THREE.Group();
        const p = cyl(.09, .09, 3, 8, 0x888888); p.position.y = 1.5; g.add(p);
        const disc = cyl(.44, .44, .09, 20, 0xffffff); disc.rotation.x = Math.PI / 2; disc.position.set(0, 3.2, 0); g.add(disc);
        const ring = cyl(.44, .44, .1, 20, 0xcc0000); ring.rotation.x = Math.PI / 2; ring.position.set(0, 3.2, -.01);
        const inner = cyl(.3, .3, .12, 20, 0xffffff); inner.rotation.x = Math.PI / 2; inner.position.set(0, 3.2, -.02);
        g.add(ring, inner);
        const diag = box(.08, .08, .88, 0xcc0000); diag.position.set(0, 3.2, -.07); diag.rotation.z = Math.PI / 4; g.add(diag);
        g.position.set(x, 0, z); return g;
      }

      function buildDestGroup() {
        const g = new THREE.Group();
        const base = box(5, .18, 5, 0x00ff88); base.position.y = .22; g.add(base);
        const pole = cyl(.1, .1, 4.5, 8, 0x00ff88); pole.position.y = 2.25; g.add(pole);
        const flag = box(2.2, 1.2, .12, 0x00ff88); flag.position.set(1.1, 5, 0); g.add(flag);
        return g;
      }

      // -- PLAYER CAR -----------------------------------------------
      let playerCar = null;
      function buildPlayerCar(color = 0x1166ee) {
        if (playerCar) scene.remove(playerCar);
        // Outer group: position + heading controlled by physics
        const g = new THREE.Group();
        // Inner pivot rotated PI so headlights face +Z, matching sin/cos movement
        const p = new THREE.Group();
        p.rotation.y = Math.PI;
        g.add(p);
        const body = box(2.1, .75, 4.4, color); body.position.y = .55; p.add(body);
        const cab = box(1.8, .65, 2.3, color); cab.position.set(0, 1.2, .15); p.add(cab);
        const winM = mat(0x99ccff, { transparent: true, opacity: .45 });
        [[0, 1.22, -1.22, 1.55, .48, .06], [0, 1.22, 1.35, 1.55, .48, .06]].forEach(([x, y, z, w, h, d]) => {
          const win = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), winM);
          win.position.set(x, y, z); p.add(win);
        });
        [[1.0, 0, -1.5], [-1.0, 0, -1.5], [1.0, 0, 1.5], [-1.0, 0, 1.5]].forEach(([wx, wy, wz], i) => {
          const wh = cyl(.38, .38, .28, 16, 0x1a1a1a); wh.rotation.z = Math.PI / 2; wh.position.set(wx, wy, wz); wh.name = `w${i}`; p.add(wh);
          const hub = cyl(.2, .2, .3, 8, 0x666666); hub.rotation.z = Math.PI / 2; hub.position.set(wx, wy, wz); p.add(hub);
        });
        [[-0.65, .5, -2.25], [0.65, .5, -2.25]].forEach(([x, y, z]) => {
          const hl = new THREE.Mesh(new THREE.BoxGeometry(.35, .22, .1), mat(0xffffdd)); hl.position.set(x, y, z); p.add(hl);
        });
        [[-0.65, .5, 2.25], [0.65, .5, 2.25]].forEach(([x, y, z]) => {
          const tl = new THREE.Mesh(new THREE.BoxGeometry(.35, .22, .1), mat(0xff1100)); tl.position.set(x, y, z); p.add(tl);
        });
        [[-0.72, .5, -2.2], [-0.72, .5, 2.2], [0.72, .5, -2.2], [0.72, .5, 2.2]].forEach(([x, y, z]) => {
          const side = x > 0 ? 'R' : 'L';
          const sig = new THREE.Mesh(new THREE.BoxGeometry(.2, .15, .08), mat(0x222200).clone());
          sig.position.set(x, y, z); sig.name = `sig_${side}`; p.add(sig);
        });
        g.position.y = .38; scene.add(g); return g;
      }

      // -- AI TRAFFIC -----------------------------------------------
      // Waypoint-chain steering: cars follow pre-computed (x,z,spd,acc) chains.
      // Ring arc = 9 waypoints every 20° (tight, acc=2.5) → no corner-cutting.
      // Post-road Z uses actual ring exit coordinates, not lane-centre functions.
      // Loop index resets to wp 2 (middle of approach road) to avoid teleport.
      const majLW = C.MAJ_LW;
      function majLaneCentre(roadZ, lane) { return roadZ - C.MAJ_W / 2 + (lane - .5) * majLW; }
      function minLaneCentre(roadZ, lane) { return roadZ - C.MIN_W / 2 + (lane - .5) * C.MIN_LW; }
      // Correct lower-road lane centres (westbound, outermost = highest Z)
      function loLane(lane) { return C.MAJ_LOWER_Z + C.MAJ_W / 2 - (lane - .5) * C.MAJ_LW; }

      const RDT_W_MOUTH = C.RDT_X - C.RDT_OUTER;  // 41
      const RDT_E_MOUTH = C.RDT_X + C.RDT_OUTER;  // 89

      function wp(x, z, spd, acc) { return { x, z, spd, acc: acc || 3.5 }; }

      // Ring arc: 19 waypoints (1 ring-surface entry + 18 pts every 10° CW = 180°).
      // First wp lands exactly on the ring outer surface (not inside the arm gap),
      // so the car stays on its lane Z in a straight line until the ring curve begins.
      // acc=2 keeps cars tightly on the arc.
      const RING_ARC = {
        // Lane 1: r=22.5, ring-surface entry at x=44.4 (outer ring edge at z=-55.25)
        1: [wp(109.4, -55.25, 5.5, 2), wp(109.0, -51.0, 5.5, 2), wp(107.9, -47.2, 5.5, 2), wp(107.5, -43.3, 5.5, 2),
        wp(107.8, -39.4, 5.5, 2), wp(108.8, -35.6, 5.5, 2), wp(110.4, -32.0, 5.5, 2), wp(112.6, -28.7, 5.5, 2),
        wp(115.3, -25.9, 5.5, 2), wp(118.5, -23.7, 5.5, 2), wp(122.0, -22.0, 5.5, 2), wp(125.8, -20.9, 5.5, 2),
        wp(129.7, -20.5, 5.5, 2), wp(133.6, -20.8, 5.5, 2), wp(137.4, -21.8, 5.5, 2), wp(141.0, -23.4, 5.5, 2),
        wp(144.3, -25.6, 5.5, 2), wp(147.1, -28.3, 5.5, 2), wp(149.3, -31.5, 5.5, 2)],
        // Lane 2: r=19.5, ring-surface entry at x=42.7 (outer ring edge at z=-51.75)
        2: [wp(107.7, -51.75, 5.4, 2), wp(110.9, -46.8, 5.4, 2), wp(110.5, -43.5, 5.4, 2), wp(110.7, -40.1, 5.4, 2),
        wp(111.5, -36.8, 5.4, 2), wp(112.9, -33.7, 5.4, 2), wp(114.8, -30.8, 5.4, 2), wp(117.1, -28.4, 5.4, 2),
        wp(119.8, -26.4, 5.4, 2), wp(122.9, -24.8, 5.4, 2), wp(126.2, -23.9, 5.4, 2), wp(129.5, -23.5, 5.4, 2),
        wp(132.9, -23.7, 5.4, 2), wp(136.2, -24.5, 5.4, 2), wp(139.3, -25.9, 5.4, 2), wp(142.2, -27.8, 5.4, 2),
        wp(144.6, -30.1, 5.4, 2), wp(146.6, -32.8, 5.4, 2), wp(148.2, -35.9, 5.4, 2)],
        // Lane 3: r=16.5, ring-surface entry at x=41.6
        3: [wp(106.6, -48.25, 5.3, 2), wp(113.5, -43.8, 5.3, 2), wp(113.6, -40.9, 5.3, 2), wp(114.3, -38.1, 5.3, 2),
        wp(115.3, -35.4, 5.3, 2), wp(116.9, -33.0, 5.3, 2), wp(118.8, -30.9, 5.3, 2), wp(121.1, -29.1, 5.3, 2),
        wp(123.6, -27.8, 5.3, 2), wp(126.4, -26.9, 5.3, 2), wp(129.2, -26.5, 5.3, 2), wp(132.1, -26.6, 5.3, 2),
        wp(134.9, -27.3, 5.3, 2), wp(137.6, -28.3, 5.3, 2), wp(140.0, -29.9, 5.3, 2), wp(142.1, -31.8, 5.3, 2),
        wp(143.9, -34.1, 5.3, 2), wp(145.2, -36.6, 5.3, 2), wp(146.1, -39.4, 5.3, 2)],
        // Lane 4: r=13.5, ring-surface entry at x=41.1
        4: [wp(106.1, -44.75, 5.2, 2), wp(116.6, -41.6, 5.2, 2), wp(117.0, -39.3, 5.2, 2), wp(117.8, -37.1, 5.2, 2),
        wp(119.1, -35.1, 5.2, 2), wp(120.6, -33.3, 5.2, 2), wp(122.4, -31.8, 5.2, 2), wp(124.5, -30.7, 5.2, 2),
        wp(126.7, -29.9, 5.2, 2), wp(129.0, -29.5, 5.2, 2), wp(131.4, -29.6, 5.2, 2), wp(133.7, -30.0, 5.2, 2),
        wp(135.9, -30.8, 5.2, 2), wp(137.9, -32.1, 5.2, 2), wp(139.7, -33.6, 5.2, 2), wp(141.2, -35.4, 5.2, 2),
        wp(142.3, -37.5, 5.2, 2), wp(143.1, -39.7, 5.2, 2), wp(143.5, -42.0, 5.2, 2)],
      };

      // Exit Z (ring) → nearest lower-road lane Z
      const RDT_EXIT = {
        1: { ez: -31.5, pz: loLane(2) },   // L1 exit → lower L2 (-34.25)
        2: { ez: -35.9, pz: loLane(3) },   // L2 exit → lower L3 (-37.75)
        3: { ez: -39.4, pz: loLane(3) },   // L3 exit → lower L3 (-37.75)
        4: { ez: -42.0, pz: loLane(4) },   // L4 exit → lower L4 (-41.25)
      };

      // Chain structure (total 31 wpts):
      //  [0]      x=-130, pre_z  ← invisible off-screen loop reset point
      //  [1..4]   approach road on upper EW
      //  [5]      arm mouth (yield/entry)
      //  [6..24]  ring arc (19 wpts)
      //  [25..29] exit arm + lower EW road
      //  [30]     x=-130, pre_z  ← invisible; loopWpi=1 jumps back to [1]
      // The z-change from post_z to pre_z happens at x=-130 (off-screen → invisible).
      function buildRdtChain(ringLane) {
        const pre_z = majLaneCentre(C.MAJ_UPPER_Z, ringLane);
        const { ez, pz } = RDT_EXIT[ringLane];
        const arc = RING_ARC[ringLane];
        return [
          wp(-130, pre_z, 9.5),       // [0]  off-screen start (loop lands here→[1])
          wp(-60, pre_z, 9.5),       // [1]  ← loopWpi: loop restarts here
          wp(-10, pre_z, 9.0),       // [2]
          wp(20, pre_z, 8.0),       // [3]
          wp(RDT_W_MOUTH - 6, pre_z, 5.5, 3),   // [4]  slow on approach
          wp(RDT_W_MOUTH, pre_z, 4.0, 1.5), // [5]  arm mouth
          ...arc,                              // [6-24] ring arc
          wp(RDT_E_MOUTH + 2, ez, 6.0, 3),   // [25] east arm exit
          wp(RDT_E_MOUTH + 12, pz, 8.0, 4),   // [26] settled on lower road
          wp(20, pz, 9.0),       // [27]
          wp(-50, pz, 9.5),       // [28]
          wp(-130, pz, 9.5),       // [29] road end (off-screen)
          wp(-130, pre_z, 9.5),       // [30] invisible z-reset → loopWpi jumps to [1]
        ];
      }

      const AI_CHAINS = [
        buildRdtChain(1),
        buildRdtChain(2),
        buildRdtChain(3),
        buildRdtChain(4),
        [wp(-130, majLaneCentre(C.MAJ_UPPER_Z, 1), 9.5), wp(102, majLaneCentre(C.MAJ_UPPER_Z, 1), 7.0)], // EW Major Eastbound
        [wp(158, loLane(1), 9.5), wp(-130, loLane(1), 9.5)], // EW Major Westbound
        [wp(minLaneCentre(C.MIN_V1_X, 1), 115, 6.5), wp(minLaneCentre(C.MIN_V1_X, 1), -115, 6.5)], // V1 Northbound
        [wp(minLaneCentre(C.MIN_V1_X, 3), -115, 6.5), wp(minLaneCentre(C.MIN_V1_X, 3), 115, 6.5)], // V1 Southbound
        [wp(-110, minLaneCentre(C.MIN_H_Z, 1), 6.5), wp(110, minLaneCentre(C.MIN_H_Z, 1), 6.5)], // TOP Eastbound
        [wp(110, minLaneCentre(C.MIN_H_Z, 3), 6.5), wp(-110, minLaneCentre(C.MIN_H_Z, 3), 6.5)], // TOP Westbound
        [wp(-110, minLaneCentre(C.MIN_H_BOT_Z, 1), 6.5), wp(110, minLaneCentre(C.MIN_H_BOT_Z, 1), 6.5)], // BOT Eastbound
        [wp(110, minLaneCentre(C.MIN_H_BOT_Z, 3), 6.5), wp(-110, minLaneCentre(C.MIN_H_BOT_Z, 3), 6.5)], // BOT Westbound
      ];

      // Loop restart index per chain
      const CHAIN_LOOP_WPI = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];

      const AICOLORS = [0xff3311, 0x22aa44, 0xffaa00, 0x8844cc, 0x00aaff, 0xff6688, 0x44ffcc, 0xff8800, 0xeeeeee, 0x884422];
      const aiVehicles = [];


      function spawnAI(n) {
        aiVehicles.forEach(v => scene.remove(v.m)); aiVehicles.length = 0;
        parkingBays.forEach(b => b.occupied = null);
        spawnParkedCars(); const total = Math.min(n, AI_CHAINS.length);
        for (let i = 0; i < total; i++) {
          const chain = AI_CHAINS[i];
          const m = buildAiCar(AICOLORS[i % AICOLORS.length]);
          const startWpi = Math.min(i % 4, chain.length - 1);
          const w = chain[startWpi];
          m.position.set(w.x, .38, w.z);
          m.rotation.y = 0;
          aiVehicles.push({
            m, chain,
            wpi: startWpi,
            loopWpi: CHAIN_LOOP_WPI[i] || 0,
            spd: w.spd * (0.85 + Math.random() * 0.3),
            stalled: false, stallTimer: 0, stallFlash: 0,
            state: 'cruising', unparkTimer: 0,
            intent: 'straight', signalFlash: 0, hornTimer: 0, hasHorned: false,
            stopTimer: 0, yieldTimer: 0
          });
        }
      }

      function spawnParkedCars() {
        // NTSA: Rule 2 - Park from the farthest end first
        // Sort bays by X descending (farthest from V1 entry at X=-30)
        const sorted = parkingBays.slice().sort((a, b) => b.x - a.x);
        const slots = sorted.slice(0, 15);
        slots.forEach(bay => {
          const m = buildAiCar(AICOLORS[Math.floor(Math.random() * AICOLORS.length)]);
          m.position.set(bay.x, .38, bay.z);
          m.rotation.y = bay.ang;
          const v = {
            m, chain: AI_CHAINS[0], spd: 0, stalled: false,
            wpi: 1, loopWpi: 1,
            state: 'parked', bay: bay, unparkTimer: 10 + Math.random() * 60,
            intent: 'straight', signalFlash: 0, hornTimer: 0, hasHorned: false,
            stopTimer: 0, yieldTimer: 0
          };
          bay.occupied = v;
          aiVehicles.push(v);
        });
      }

      function buildAiCar(color) {
        const g = new THREE.Group();
        const b = box(1.9, .65, 4.0, color); b.position.y = .5; g.add(b);
        const c = box(1.6, .6, 2.0, color); c.position.set(0, 1.1, .1); g.add(c);

        // Headlights (White, Front is +2.05)
        [[-0.62, .5, 2.05], [0.62, .5, 2.05]].forEach(([x, y, z]) => {
          const hl = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .08), mat(0xffffcc));
          hl.position.set(x, y, z); g.add(hl);
        });
        // Taillights (Red, Back is -2.05)
        [[-0.62, .5, -2.05], [0.62, .5, -2.05]].forEach(([x, y, z]) => {
          const tl = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .08), mat(0xff0000));
          tl.position.set(x, y, z); g.add(tl);
        });

        // Indicators
        const sigL = [], sigR = [];
        const fl = new THREE.Mesh(new THREE.BoxGeometry(.2, .15, .1), mat(0x222200)); fl.position.set(-0.85, .5, 2.05); g.add(fl); sigL.push(fl);
        const fr = new THREE.Mesh(new THREE.BoxGeometry(.2, .15, .1), mat(0x222200)); fr.position.set(0.85, .5, 2.05); g.add(fr); sigR.push(fr);
        const bl = new THREE.Mesh(new THREE.BoxGeometry(.2, .15, .1), mat(0x222200)); bl.position.set(-0.85, .5, -2.05); g.add(bl); sigL.push(bl);
        const br = new THREE.Mesh(new THREE.BoxGeometry(.2, .15, .1), mat(0x222200)); br.position.set(0.85, .5, -2.05); g.add(br); sigR.push(br);
        g.sigL = sigL; g.sigR = sigR;

        [[1, 0, -1.4], [-1, 0, -1.4], [1, 0, 1.4], [-1, 0, 1.4]].forEach(([x, y, z]) => {
          const w = cyl(.35, .35, .26, 12, 0x1a1a1a); w.rotation.z = Math.PI / 2;
          w.position.set(x, y, z); g.add(w);
        });
        scene.add(g); return g;
      }

      // -- AI STALL SYSTEM ------------------------------------------
      function triggerRandomStall() {
        const candidates = aiVehicles.filter(v => !v.stalled);
        if (!candidates.length) return;
        const v = candidates[Math.floor(Math.random() * candidates.length)];
        v.stalled = true; v.stallTimer = 15 + Math.random() * 20; v.stallFlash = 0;
        logEvt('⚠️ Vehicle broken down ahead -- find alternate route!', false);
        setAI('A vehicle has stalled ahead. Demonstrate the three shortest correct routes to your destination.');
      }
      function updateStalls(dt) {
        aiVehicles.forEach(v => {
          if (!v.stalled) return;
          v.stallTimer -= dt; v.stallFlash = (v.stallFlash || 0) + dt;
          if (v.m.children[0] && v.m.children[0].material)
            v.m.children[0].material.color.setHex(Math.sin(v.stallFlash * 6) > 0 ? 0xffaa00 : 0xcc5500);
          if (v.stallTimer <= 0) { v.stalled = false; logEvt('✓ Stalled vehicle cleared', true); }
        });
      }

      function updateAI(dt) {
        aiVehicles.forEach((v, vi) => {
          if (v.stalled) return;

          if (v.state === 'parked') {
            v.unparkTimer -= dt;
            if (v.unparkTimer <= 0) {
              v.state = 'leaving';
              v.spd = 0;
              v.targetVx = Math.random() > 0.5 ? C.MIN_V1_X : C.RDT_X - 10;
              v.intent = v.bay && v.bay.type === 'parallel' ? 'straight' : 'right'; // Signal when leaving
            }
            return;
          }

          if (v.state === 'leaving') {
            const isParallel = v.bay && v.bay.type === 'parallel';
            v.spd = isParallel ? 2.5 : -2.5; // NTSA Rule: Reverse out for angle, forward for flush
            const myX = v.m.position.x, myZ = v.m.position.z;
            const targetZ = isParallel ? C.MIN_H_Z : C.PARK_Z;
            const distToAisle = Math.abs(myZ - targetZ);

            if (distToAisle < 0.2) {
              v.state = 'cruising';
              v.spd = 4;
              const destX = v.targetVx;
              v.chain = [wp(destX, targetZ, 6, 2), wp(destX, -100, 8)];
              v.wpi = 0; v.loopWpi = 1;
              v.m.rotation.y = destX > v.m.position.x ? Math.PI / 2 : -Math.PI / 2;
              v.intent = 'straight';
            } else {
              v.m.position.x += Math.sin(v.m.rotation.y) * v.spd * dt;
              v.m.position.z += Math.cos(v.m.rotation.y) * v.spd * dt;
              if (!isParallel) v.m.rotation.y += (v.bay.side === 'north' ? 0.3 : -0.3) * dt;
              else v.m.rotation.y += (v.targetVx > v.m.position.x ? 0.1 : -0.1) * dt;
            }
            return;
          }

          const chain = v.chain;
          const target = chain[v.wpi];
          const myX = v.m.position.x, myZ = v.m.position.z;
          const dx = target.x - myX, dz = target.z - myZ;
          const dist2 = dx * dx + dz * dz;
          const distToTarget = Math.sqrt(dist2);
          const headAng = Math.atan2(dx, dz);

          // ── Desired speed from target, reduced by vehicles ahead ──
          let desiredSpd = target.spd;

          // Following Distance
          for (let oi = 0; oi < aiVehicles.length; oi++) {
            if (oi === vi) continue;
            const o = aiVehicles[oi];
            const odx = o.m.position.x - myX, odz = o.m.position.z - myZ;
            const fwd = odx * Math.sin(headAng) + odz * Math.cos(headAng);
            const lat = Math.abs(odx * Math.cos(headAng) - odz * Math.sin(headAng));
            if (fwd > 0 && fwd < 7 && lat < 2.0) desiredSpd = Math.min(desiredSpd, Math.max(0, o.spd - 0.3));
          }
          if (playerCar) {
            const pdx = playerCar.position.x - myX, pdz = playerCar.position.z - myZ;
            const fwd = pdx * Math.sin(headAng) + pdz * Math.cos(headAng);
            const lat = Math.abs(pdx * Math.cos(headAng) - pdz * Math.sin(headAng));
            if (fwd > -2 && fwd < 15 && lat < 2.5) desiredSpd = 0; // Safe follow
            else if (fwd > 15 && fwd < 30 && lat < 2.5) desiredSpd = Math.min(desiredSpd, Math.max(0, ph.speed - 0.5));
          }

          // NTSA: Stop Sign 3-Second Compliance
          const ss = stopSigns.find(s => Math.hypot(s.x - myX, s.z - myZ) < s.r);
          if (ss) {
            if (v.spd < 0.2) {
              v.stopTimer += dt;
              if (v.stopTimer < 3.0) desiredSpd = 0;
            } else {
              v.stopTimer = 0;
              desiredSpd = Math.min(desiredSpd, 0.5);
            }
          } else {
            v.stopTimer = 0;
          }

          // NTSA: Yield to Right at Roundabout
          const ys = yieldSigns.find(y => Math.hypot(y.x - myX, y.z - myZ) < y.r);
          if (ys) {
            const rdtCenter = new THREE.Vector3(C.RDT_X, 0, C.MAJ_MID_Z);
            const inConflictingZone = aiVehicles.some(o => {
              if (o === v) return false;
              const distToCenter = Math.hypot(o.m.position.x - C.RDT_X, o.m.position.z - C.MAJ_MID_Z);
              if (distToCenter > C.RDT_OUTER + 2) return false; // not in ring
              const od = Math.hypot(o.m.position.x - myX, o.m.position.z - myZ);
              return od < 18; // conflict range
            });
            if (inConflictingZone) { desiredSpd = 0; v.yieldTimer = 1.0; }
            else { v.yieldTimer -= dt; if (v.yieldTimer > 0) desiredSpd = 0; }
          }

          // Evaluate intent & Roundabout Signaling
          const afterNext = chain[(v.wpi + 1) % chain.length];
          v.intent = 'straight';
          if (target && afterNext) {
            const dx1 = target.x - myX, dz1 = target.z - myZ;
            const dx2 = afterNext.x - target.x, dz2 = afterNext.z - target.z;
            const a1 = Math.atan2(dx1, dz1), a2 = Math.atan2(dx2, dz2);
            let diff = a2 - a1;
            while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
            if (diff > 0.3) v.intent = 'left'; else if (diff < -0.3) v.intent = 'right';

            // Roundabout Signaling Rules
            const distToRdt = Math.hypot(myX - C.RDT_X, myZ - C.MAJ_MID_Z);
            const isEntry = distToRdt > C.RDT_OUTER + 2 && Math.hypot(target.x - C.RDT_X, target.z - C.MAJ_MID_Z) < C.RDT_OUTER + 3;
            const isExit = distToRdt < C.RDT_OUTER + 3 && Math.hypot(afterNext.x - C.RDT_X, afterNext.z - C.MAJ_MID_Z) > C.RDT_OUTER + 4;

            if (isEntry) v.intent = 'right'; // NTSA: Signal right on entry
            else if (isExit) v.intent = 'left'; // NTSA: Signal left when exiting
          }

          // Apply indicators
          v.signalFlash = (v.signalFlash + dt) % 0.8;
          const isOn = v.signalFlash < 0.4;
          const lCol = (v.intent === 'left' && isOn) ? 0xff8800 : 0x222200;
          const rCol = ((v.intent === 'right' || v.intent === 'roundabout') && isOn) ? 0xff8800 : 0x222200;
          v.m.sigL.forEach(m => m.material.color.setHex(lCol));
          v.m.sigR.forEach(m => m.material.color.setHex(rCol));

          // Contextual Horn
          if (desiredSpd === 0 && v.spd < 0.1) {
            v.hornTimer += dt;
            if (v.hornTimer > 3 && !v.hasHorned) {
              v.hasHorned = true;
              if (audioManager.isInitialized) audioManager.triggerHorn(0.5);
            }
          } else { v.hornTimer = 0; v.hasHorned = false; }

          // ── Smooth physics ──
          const accel = v.spd < desiredSpd ? 3.5 : 7.0;
          v.spd += (desiredSpd - v.spd) * Math.min(1, accel * dt);
          v.spd = Math.max(0, v.spd);

          if (distToTarget > 0.05) {
            const moveD = Math.min(v.spd * dt, distToTarget);
            v.m.position.x = myX + dx / distToTarget * moveD;
            v.m.position.z = myZ + dz / distToTarget * moveD;
            v.m.position.y = .38;
            let dr = headAng - v.m.rotation.y;
            while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
            v.m.rotation.y += dr * Math.min(1, 5 * dt);
          }
          if (distToTarget < target.acc) {
            v.wpi++; if (v.wpi >= chain.length) v.wpi = v.loopWpi || 0;
          }
        });
      }
      // -- PEDESTRIANS ----------------------------------------------
      // Pedestrians wait on pavement, cross ONLY when nearest TL is green
      // Each ped is assigned to exactly one zebra crossing
      const peds = [];

      function spawnPeds(n) {
        peds.forEach(p => scene.remove(p.m)); peds.length = 0;
        if (zebras.length === 0) return;
        for (let i = 0; i < n; i++) {
          const g = new THREE.Group();
          const skinTones = [0xffccaa, 0xd4956a, 0x8b5e3c, 0xc68642, 0xf1c27d];
          const skin = skinTones[Math.floor(Math.random() * skinTones.length)];
          const body = cyl(.2, .2, 1., 8, 0x334455 + (i * 0x080808 & 0x181818)); body.position.y = .5; g.add(body);
          const head = cyl(.18, .18, .3, 8, skin); head.position.y = 1.22; g.add(head);
          const arm1 = box(.16, .16, .65, 0x334455); arm1.position.set(.3, .82, 0); arm1.rotation.z = .35; g.add(arm1);
          const arm2 = arm1.clone(); arm2.position.x = -.3; arm2.rotation.z = -.35; g.add(arm2);

          // Assign to a zebra crossing
          const zb = zebras[i % zebras.length];
          // Start on pavement: offset perpendicular to crossing direction
          const side = Math.random() > .5 ? 1 : -1;
          const paveDist = zb.roadW / 2 + 1.5; // stand just off road edge
          let sx, sz;
          if (zb.axis === 'ew') {
            // For EW road, zebras are across Z, so peds spawn at Z offset
            sx = zb.cx + (Math.random() - .5) * 1.5; sz = zb.cz + side * paveDist;
          } else {
            // For NS road, zebras are across X, so peds spawn at X offset
            sx = zb.cx + side * paveDist; sz = zb.cz + (Math.random() - .5) * 1.5;
          }
          g.position.set(sx, 0, sz);
          scene.add(g);
          peds.push({ m: g, zb, side, crossing: false, waitTimer: i * 3 + 2, onCrossing: false, crossed: false });
        }
      }

      function getNearestTLState(x, z) {
        let nearest = null, nd = Infinity;
        trafficLights.forEach(tl => {
          const d = Math.sqrt((tl.pos.x - x) ** 2 + (tl.pos.z - z) ** 2);
          if (d < nd) { nd = d; nearest = tl; }
        });
        return nearest ? nearest.state : 'red';
      }

      class PedestrianSignalController {
        constructor() {
          this.phaseDur = { RED_MAN: 5, GREEN_MAN: 6, FLASHING_GREEN: 3 };
        }
        update(dt) {
          zebras.forEach((zb) => {
            if (!zb.pedState) {
              zb.pedState = 'RED_MAN'; zb.pedTimer = 0;
              zb.waitingPeds = []; zb.activePeds = [];
              zb.signalMesh = new THREE.Mesh(new THREE.BoxGeometry(.3, .6, .3), mat(0xff0000));
              if (zb.axis === 'ew') zb.signalMesh.position.set(zb.cx - zb.roadW / 2 - 1, .4, zb.cz + 2);
              else zb.signalMesh.position.set(zb.cx + 2, .4, zb.cz - zb.roadW / 2 - 1);
              scene.add(zb.signalMesh);
            }
            zb.pedTimer += dt;
            const tlState = getNearestTLState(zb.cx, zb.cz);

            switch (zb.pedState) {
              case 'RED_MAN':
                if (tlState === 'red' && zb.pedTimer > this.phaseDur.RED_MAN) {
                  if (zb.waitingPeds.length > 0) {
                    zb.pedState = 'GREEN_MAN'; zb.pedTimer = 0;
                    this.releasePedestrians(zb);
                  }
                }
                break;
              case 'GREEN_MAN':
                if (zb.pedTimer > this.phaseDur.GREEN_MAN) {
                  zb.pedState = 'FLASHING_GREEN'; zb.pedTimer = 0;
                }
                break;
              case 'FLASHING_GREEN':
                if (zb.pedTimer > this.phaseDur.FLASHING_GREEN) {
                  zb.pedState = 'RED_MAN'; zb.pedTimer = 0;
                }
                break;
            }
            if (zb.signalMesh) {
              const c = zb.pedState === 'GREEN_MAN' ? 0x00ff00 : zb.pedState === 'FLASHING_GREEN' && zb.pedTimer % 0.5 < 0.25 ? 0x00ff00 : 0xff0000;
              zb.signalMesh.material.color.setHex(c);
            }
          });
        }
        releasePedestrians(zb) {
          zb.waitingPeds.forEach(p => {
            p.crossing = true;
            if (p.zb.axis === 'ew') {
              p.targetX = p.zb.cx;
              p.targetZ = p.zb.cz - p.side * (p.zb.roadW / 2 + 1.8);
            } else {
              p.targetX = p.zb.cx - p.side * (p.zb.roadW / 2 + 1.8);
              p.targetZ = p.zb.cz;
            }
            zb.activePeds.push(p);
          });
          zb.waitingPeds = [];
        }
      }

      const pedSignalController = new PedestrianSignalController();

      function updatePeds(dt) {
        pedSignalController.update(dt);
        peds.forEach(p => {
          p.waitTimer -= dt;

          if (!p.crossing) {
            // Standing on pavement
            if (p.waitTimer <= 0 && !p.zb.waitingPeds.includes(p)) {
              p.zb.waitingPeds.push(p);
            }
          } else {
            const dx = p.targetX - p.m.position.x;
            const dz = p.targetZ - p.m.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.25) {
              const spd = 1.6 * dt; // walk speed
              p.m.position.x += dx / dist * spd;
              p.m.position.z += dz / dist * spd;
              p.m.rotation.y = Math.atan2(dx, dz);

              const walkPhase = Math.sin(sessTime * 8);
              p.m.children[2].rotation.x = walkPhase * 0.4;
              p.m.children[3].rotation.x = -walkPhase * 0.4;
              p.m.position.y = Math.abs(walkPhase) * 0.05;
            } else {
              p.m.position.x = p.targetX;
              p.m.position.z = p.targetZ;
              p.m.position.y = 0;
              p.crossing = false;
              p.side = -p.side;
              p.waitTimer = 5 + Math.random() * 10;
              p.zb.activePeds = p.zb.activePeds.filter(x => x !== p);
            }
          }

          // Mark whether ped is on the crossing (for violation detection)
          const zb = p.zb;
          if (zb.axis === 'ew') {
            p.onCrossing = p.crossing && Math.abs(p.m.position.x - zb.cx) < zb.roadW / 2 + 1;
          } else {
            p.onCrossing = p.crossing && Math.abs(p.m.position.z - zb.cz) < zb.roadW / 2 + 1;
          }
        });
      }

      // -- PHYSICS --------------------------------------------------
      const keys = {};
      let sigL = false, sigR = false, sigTimer = 0, hornOn = false;
      const ph = { speed: 0, heading: 0, steer: 0, gear: 'N', braking: false, auto: false };

      window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyQ') { sigL = !sigL; sigR = false; updSigUI(); }
        if (e.code === 'KeyE') { sigR = !sigR; sigL = false; updSigUI(); }
        if (e.code === 'KeyH') { hornOn = true; hornTrigger(); }
        if (e.code === 'KeyC') cycleCam();
        if (e.code === 'Digit1') setGear('R');
        if (e.code === 'Digit2') setGear('N');
        if (e.code === 'Digit3') setGear('D');
        if (e.code === 'KeyZ') toggleAuto();
      });
      window.addEventListener('keyup', e => {
        keys[e.code] = false;
        if (e.code === 'KeyH') { hornOn = false; document.getElementById('ih').classList.remove('on'); }
      });

      function updSigUI() {
        document.getElementById('il').classList.toggle('lon', sigL);
        document.getElementById('ir').classList.toggle('ron', sigR);
      }
      function setGear(g) {
        ph.gear = g;
        document.querySelectorAll('.gi').forEach(el => el.classList.toggle('active', el.dataset.g === g));
      }
      function hornTrigger() {
        if (!audioManager.isInitialized) audioManager.initialize();
        document.getElementById('ih').classList.add('on');
        audioManager.triggerHorn();

        // Check if near pedestrian crossing -- penalty
        if (playerCar && gameRunning) {
          peds.forEach(p => {
            if (p.onCrossing && playerCar.position.distanceTo(p.m.position) < 12) {
              addViol('Horn used at pedestrian crossing -- intimidation!', C.PENALTIES.PED_HORN, '📢');
            }
          });
        }
      }

      function updateAutoDrive(dt, sc) {
        if (!ph.auto || !playerCar || !sc) return;
        const pos = playerCar.position, dest = sc.destPos;
        const dx = dest.x - pos.x, dz = dest.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 4) {
          ph.speed = Math.max(0, ph.speed - C.BRAKE * dt); ph.steer *= 0.8;
          if (ph.speed < 0.1) { ph.auto = false; document.getElementById('bau').classList.remove('active'); logEvt('📡 Destination Reached - Auto-Pilot Off', true); }
          return;
        }
        let targetH = Math.atan2(dx, dz), diff = targetH - ph.heading;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        ph.steer = Math.max(-C.MAX_STEER, Math.min(C.MAX_STEER, diff * 1.6));
        const cap = inParkingZone() ? C.SPD_PARK : C.SPD_MIN;
        let obstacle = false;
        aiVehicles.forEach(v => {
          if (pos.distanceTo(v.m.position) < 12) {
            let ad = Math.atan2(v.m.position.x - pos.x, v.m.position.z - pos.z) - ph.heading;
            while (ad > Math.PI) ad -= Math.PI * 2; while (ad < -Math.PI) ad += Math.PI * 2;
            if (Math.abs(ad) < Math.PI / 3) obstacle = true;
          }
        });
        if (obstacle) ph.speed = Math.max(0, ph.speed - C.BRAKE * dt);
        else ph.speed = Math.min(ph.speed + C.ACCEL * dt, cap);
      }

      let touchSteer = 0;
      let touchAccel = 0;
      let touchBrake = false;
      let usingTouch = false;

      // -- TOUCH INPUT MANAGER ---------------------------------------
      class TouchInputManager {
        constructor() {
          this.canvas = document.getElementById('cw'); // attach to canvas wrapper
          this.activePointers = new Map();
          this.gestureState = {
            type: null,
            startDistance: 0
          };
          this.setupEventListeners();
          this.createVirtualJoystick(document.getElementById('v-joystick-container'));
          this.setupButtons();
        }

        setupEventListeners() {
          this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
          this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
          this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
          this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
          this.canvas.style.touchAction = 'none';

          // Mobile menu toggles
          const lp = document.getElementById('lp');
          const rp = document.getElementById('rp');
          document.getElementById('btn-menu-left')?.addEventListener('click', () => { lp.classList.toggle('open'); rp.classList.remove('open'); });
          document.getElementById('btn-menu-right')?.addEventListener('click', () => { rp.classList.toggle('open'); lp.classList.remove('open'); });
        }

        setupButtons() {
          const bindBtn = (id, key, actL, actR) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); usingTouch = true; if (key) keys[key] = true; if (actL) { sigL = !sigL; sigR = false; updSigUI(); } if (actR) { sigR = !sigR; sigL = false; updSigUI(); } });
            btn.addEventListener('touchend', (e) => { e.preventDefault(); if (key) keys[key] = false; });
          };
          bindBtn('mb-brk', 'Space');
          document.getElementById('mb-sigl')?.addEventListener('touchstart', (e) => { e.preventDefault(); sigL = !sigL; sigR = false; updSigUI(); });
          document.getElementById('mb-sigr')?.addEventListener('touchstart', (e) => { e.preventDefault(); sigR = !sigR; sigL = false; updSigUI(); });
          document.getElementById('mb-horn')?.addEventListener('touchstart', (e) => { e.preventDefault(); hornTrigger(); });
          document.getElementById('mb-horn')?.addEventListener('touchend', (e) => { e.preventDefault(); document.getElementById('ih').classList.remove('on'); });
        }

        onPointerDown(e) {
          if (e.target.closest('.mobile-btn') || e.target.closest('.virtual-joystick')) return;
          this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (this.activePointers.size === 1) {
            this.gestureState.type = 'camera';
          }
        }

        onPointerMove(e) {
          if (!this.activePointers.has(e.pointerId) || this.gestureState.type !== 'camera') return;
          usingTouch = true;
          const pointer = this.activePointers.get(e.pointerId);
          const dx = e.clientX - pointer.x;
          // Simple orbit roughly matching desktop MouseDrag
          orbitCam(dx * -0.01);
          pointer.x = e.clientX;
          pointer.y = e.clientY;
        }

        onPointerUp(e) {
          this.activePointers.delete(e.pointerId);
          if (this.activePointers.size === 0) this.gestureState.type = null;
        }

        createVirtualJoystick(container) {
          if (!container) return;
          const joystick = document.createElement('div');
          joystick.className = 'virtual-joystick';
          const stick = document.createElement('div');
          stick.className = 'joystick-stick';
          joystick.appendChild(stick);

          let active = false;
          let rect, centerX, centerY, maxRadius;

          const updateJoystick = (e) => {
            let clientX = e.clientX, clientY = e.clientY;
            if (e.touches && e.touches.length > 0) {
              clientX = e.touches[0].clientX;
              clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
              clientX = e.changedTouches[0].clientX;
              clientY = e.changedTouches[0].clientY;
            }

            const dx = clientX - centerX;
            const dy = clientY - centerY;
            const dist = Math.min(maxRadius, Math.hypot(dx, dy));
            const angle = Math.atan2(dy, dx);

            const stickX = dist * Math.cos(angle);
            const stickY = dist * Math.sin(angle);
            stick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

            // Map to inputs: X = steering (-1 to 1), Y = accel/brake (-1 to 1)
            // Y inverted: up is negative in UI, positive accel
            touchSteer = stickX / maxRadius;
            touchAccel = -(stickY / maxRadius);

            // Auto trigger gear/brake depending on Y
            if (touchAccel > 0.2) {
              if (ph.gear !== 'D') setGear('D');
              touchBrake = false;
            } else if (touchAccel < -0.2) {
              // Only go into Reverse if basically stopped
              if (Math.abs(ph.speed) < 1 && ph.gear !== 'R') {
                setGear('R');
              } else if (ph.speed > 1) {
                // If moving forward, pulling back puts you in neutral and breaks
                touchBrake = true;
                touchAccel = 0;
              } else {
                touchAccel = Math.abs(touchAccel); // Drive backwards
              }
            } else {
              touchAccel = 0;
              touchBrake = false;
            }
          };

          const handleStart = (e) => {
            e.preventDefault();
            active = true;
            usingTouch = true;
            rect = joystick.getBoundingClientRect();
            centerX = rect.left + rect.width / 2;
            centerY = rect.top + rect.height / 2;
            maxRadius = rect.width / 2;
            updateJoystick(e);
          };

          const handleMove = (e) => {
            if (!active) return;
            e.preventDefault();
            updateJoystick(e);
          };

          const handleEnd = (e) => {
            e.preventDefault();
            active = false;
            touchSteer = 0;
            touchAccel = 0;
            touchBrake = false;
            stick.style.transform = `translate(-50%, -50%)`;
            // Auto neutral when let go
            if (ph.gear !== 'N' && Math.abs(ph.speed) < 1) setGear('N');
          };

          joystick.addEventListener('touchstart', handleStart, { passive: false });
          joystick.addEventListener('touchmove', handleMove, { passive: false });
          joystick.addEventListener('touchend', handleEnd, { passive: false });
          joystick.addEventListener('touchcancel', handleEnd, { passive: false });

          container.appendChild(joystick);
        }
      }

      function physicsStep(dt, sc) {
        if (!playerCar || !gameRunning) return;

        // -- BALANCE PRE-CHECK: block movement if no credit --
        if (playerBalance <= 0) {
          // Bring car to a stop
          ph.speed = ph.speed > 0
            ? Math.max(0, ph.speed - C.BRAKE * dt)
            : Math.min(0, ph.speed + C.BRAKE * dt);
          playerCar.position.x += Math.sin(ph.heading) * ph.speed * dt;
          playerCar.position.z += Math.cos(ph.heading) * ph.speed * dt;
          playerCar.rotation.y = ph.heading;
          const mod = document.getElementById('topup-mod');
          if (mod && mod.style.display !== 'flex') {
            document.getElementById('tu-bal').textContent = playerBalance.toFixed(2);
            document.getElementById('tu-dist').textContent = distTrav.toFixed(0);
            mod.style.display = 'flex';
          }
          return;
        }

        const fwd = keys['ArrowUp'] || keys['KeyW'];
        const bwd = keys['ArrowDown'] || keys['KeyS'];
        const lft = keys['ArrowLeft'] || keys['KeyA'];
        const rgt = keys['ArrowRight'] || keys['KeyD'];
        const brk = keys['Space'];

        const inPark = inParkingZone();
        const inRdt = inRoundabout();
        const inMin = onMinorRoad();
        const cap = inPark ? C.SPD_PARK : inRdt ? C.SPD_RDT : inMin ? C.SPD_MIN : C.SPD_MAJ;

        if (ph.auto) {
          updateAutoDrive(dt, sc);
        } else {
          // Merge Keyboard and Touch Inputs
          const fwdInput = fwd || (usingTouch && touchAccel > 0);
          const bwdInput = bwd || (usingTouch && touchAccel > 0 && ph.gear === 'R');
          const brkInput = brk || touchBrake;
          const accelVal = usingTouch ? Math.abs(touchAccel) : 1;

          if (ph.gear === 'D' && fwdInput) ph.speed = Math.min(ph.speed + C.ACCEL * accelVal * dt, cap);
          else if (ph.gear === 'R' && bwdInput) ph.speed = Math.max(ph.speed - C.ACCEL * .6 * accelVal * dt, -cap * .3);
          else if (brkInput) ph.speed = ph.speed > 0 ? Math.max(0, ph.speed - C.BRAKE * dt) : Math.min(0, ph.speed + C.BRAKE * dt);
          else ph.speed *= Math.pow(.88, dt * 30);

          const ss = 1 - Math.min(Math.abs(ph.speed) / cap, 1) * .45;
          if (usingTouch && Math.abs(touchSteer) > 0.05) {
            // Direct map joystick X to steer angle
            const targetSteer = touchSteer * C.MAX_STEER;
            ph.steer += (targetSteer - ph.steer) * dt * 10;
          } else {
            if (lft) ph.steer = Math.max(ph.steer - C.STEER * dt * ss, -C.MAX_STEER);
            else if (rgt) ph.steer = Math.min(ph.steer + C.STEER * dt * ss, C.MAX_STEER);
            else ph.steer *= Math.pow(.82, dt * 30);
          }
        }

        if (Math.abs(ph.speed) > .1) ph.heading -= ph.steer * (ph.speed / cap) * dt * 2.9;
        playerCar.position.x += Math.sin(ph.heading) * ph.speed * dt;
        playerCar.position.z += Math.cos(ph.heading) * ph.speed * dt;
        playerCar.position.y = .38;
        playerCar.rotation.y = ph.heading;
        // Wheels are inside the inner pivot group
        playerCar.children.forEach(pivot => {
          pivot.children && pivot.children.forEach(c => { if (c.name && c.name[0] === 'w') c.rotation.x += ph.speed * dt * 2.6; });
        });

        // Signal blink
        sigTimer += dt;
        if (sigTimer > .48) { sigTimer = 0; blinkSig(); }
        ph.braking = brk;
        document.getElementById('ib').classList.toggle('on', brk && Math.abs(ph.speed) > .4);

        // Clamp
        playerCar.position.x = Math.max(-300, Math.min(300, playerCar.position.x));
        playerCar.position.z = Math.max(-300, Math.min(300, playerCar.position.z));
        distTrav += Math.abs(ph.speed) * dt;

        // Update Audio
        if (audioManager.isInitialized) {
          audioManager.updateEngine(ph.speed, (fwd || bwd) ? 1 : 0, ph.gear);
        }

        // -- COST DEDUCTION per metre driven --
        const distThisFrame = Math.abs(ph.speed) * dt;
        playerBalance = Math.max(0, playerBalance - distThisFrame * COST_PER_METER);
        updBalanceHUD();
      }

      function blinkSig() {
        function forEachCarChild(cb) { playerCar && playerCar.children.forEach(pivot => { pivot.children && pivot.children.forEach(cb); }); }
        if (sigL) forEachCarChild(c => { if (c.name === 'sig_L') c.material.color.setHex(c.material.color.getHex() === 0xff8800 ? 0x222200 : 0xff8800); });
        if (sigR) forEachCarChild(c => { if (c.name === 'sig_R') c.material.color.setHex(c.material.color.getHex() === 0xff8800 ? 0x222200 : 0xff8800); });
      }

      function inRoundabout() {
        if (!playerCar) return false;
        const dx = playerCar.position.x - C.RDT_X, dz = playerCar.position.z - C.RDT_Z;
        return Math.sqrt(dx * dx + dz * dz) < C.RDT_OUTER + 3;
      }
      function inParkingZone() {
        if (!playerCar) return false;
        return parkingZones.some(pz => Math.abs(playerCar.position.x - pz.x) < pz.hw && Math.abs(playerCar.position.z - pz.z) < pz.hd);
      }
      function onMinorRoad() {
        if (!playerCar) return false;
        return Math.abs(playerCar.position.z - C.MIN_H_Z) < C.MIN_W || Math.abs(playerCar.position.x - C.MIN_V1_X) < C.MIN_W || Math.abs(playerCar.position.x - C.MIN_V2_X) < C.MIN_W;
      }

      // -- LANE DETECTION -------------------------------------------
      // Lane 1 = leftmost (keep-left = Lane 1), Lane 4 = rightmost (inner, roundabout access)
      function detectLane() {
        if (!playerCar) return { roadType: 'off', lane: 0 };
        const pos = playerCar.position;
        const hw = C.MAJ_W / 2, lw = C.MAJ_LW;

        // EW upper (eastbound) – Lane 1 at lowest z
        if (Math.abs(pos.z - C.MAJ_UPPER_Z) < hw) {
          const relZ = pos.z - (C.MAJ_UPPER_Z - hw);
          const lane = Math.min(C.MAJ_LANES, Math.max(1, Math.ceil(relZ / lw)));
          return { roadType: 'major', road: 'EW_upper', dir: 'east', lane };
        }
        // EW lower (westbound) – Lane 1 at highest z
        if (Math.abs(pos.z - C.MAJ_LOWER_Z) < hw) {
          const relZ = pos.z - (C.MAJ_LOWER_Z - hw);
          const lane = Math.min(C.MAJ_LANES, Math.max(1, Math.ceil(relZ / lw)));
          return { roadType: 'major', road: 'EW_lower', dir: 'west', lane };
        }

        // Top Horizontal Minor
        if (Math.abs(pos.z - C.MIN_H_Z) < C.MIN_W / 2) {
          const relZ = pos.z - (C.MIN_H_Z - C.MIN_W / 2);
          const lane = Math.min(C.MIN_LANES, Math.max(1, Math.ceil(relZ / C.MIN_LW)));
          return { roadType: 'minor', road: 'H_minor', dir: pos.x > 0 ? 'east' : 'west', lane };
        }
        // Vertical Minor (V1)
        if (Math.abs(pos.x - C.MIN_V1_X) < C.MIN_W / 2) {
          const relX = pos.x - (C.MIN_V1_X - C.MIN_W / 2);
          const lane = Math.min(C.MIN_LANES, Math.max(1, Math.ceil(relX / C.MIN_LW)));
          return { roadType: 'minor', road: 'V1_minor', dir: 'north', lane };
        }
        // South Horizontal Minor (New)
        if (Math.abs(pos.z - C.MIN_H_BOT_Z) < C.MIN_W / 2) {
          const relZ = pos.z - (C.MIN_H_BOT_Z - C.MIN_W / 2);
          const lane = Math.min(C.MIN_LANES, Math.max(1, Math.ceil(relZ / C.MIN_LW)));
          return { roadType: 'minor', road: 'H_BOT_minor', dir: 'west', lane };
        }
        // Parking Aisle
        if (Math.abs(pos.z - C.PARK_Z) < 3 && pos.x > C.MIN_V1_X && pos.x < C.MIN_V2_X) {
          return { roadType: 'parking', lane: 1 };
        }
        if (inRoundabout()) {
          const dx = pos.x - C.RDT_X, dz = pos.z - C.RDT_Z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const lane = dist < C.RDT_INNER + C.RDT_LANE_W ? 1
            : dist < C.RDT_INNER + C.RDT_LANE_W * 2 ? 2
              : dist < C.RDT_INNER + C.RDT_LANE_W * 3 ? 3 : 4;
          return { roadType: 'roundabout', road: 'RDT', lane };
        }
        return { roadType: 'other', lane: 0 };
      }

      // -- TRAFFIC LIGHT UPDATE (4-PHASE KENYAN SEQUENCE) -----------
      /*  Phase sequence: RED -> RED+AMBER -> GREEN -> AMBER
          Red:5s  Red+Amber:1.5s  Green:5s  Amber:2s  */
      const TL_PHASES = [
        { name: 'RED -- STOP', dur: 5, r: true, ra: false, g: false, a: false },
        { name: 'RED+AMBER -- PREPARE', dur: 1.5, r: true, ra: true, g: false, a: false },
        { name: 'GREEN -- PROCEED', dur: 5, r: false, ra: false, g: true, a: false },
        { name: 'AMBER -- STOP SAFELY', dur: 2, r: false, ra: false, g: false, a: true },
      ];
      const TL_CYCLE = TL_PHASES.reduce((s, p) => s + p.dur, 0);

      function updateTLights(dt) {
        trafficLights.forEach((tl, i) => {
          tl.timer += dt;
          const t = (tl.timer + tl.offset) % TL_CYCLE;
          let cum = 0, phase = TL_PHASES[0];
          for (const p of TL_PHASES) { cum += p.dur; if (t < cum) { phase = p; break; } }
          tl.state = phase.name.includes('GREEN') ? 'green' : phase.name.includes('AMBER') && !phase.name.includes('RED') ? 'amber' : phase.name.includes('RED+AMBER') ? 'ra' : 'red';
          tl.r.material.color.setHex(phase.r ? 0xff2200 : 0x220000);
          tl.ra.material.color.setHex(phase.ra ? 0xffaa00 : 0x332200);
          tl.g.material.color.setHex(phase.g ? 0x00ff44 : 0x003300);
          tl.a.material.color.setHex(phase.a ? 0xffaa00 : 0x332200);
          // Update phase display for nearest TL
          if (i === 0) updateTLPhaseHUD(tl.state, phase.name);
        });
      }

      function updateTLPhaseHUD(state, name) {
        document.getElementById('tlp-r').style.background = state === 'red' || state === 'ra' ? '#ff2200' : '#220000';
        document.getElementById('tlp-ra').style.background = state === 'ra' ? '#ffaa00' : '#332200';
        document.getElementById('tlp-g').style.background = state === 'green' ? '#00ff44' : '#003300';
        document.getElementById('tlp-a').style.background = state === 'amber' ? '#ffaa00' : '#332200';
        document.getElementById('tlp-txt').textContent = name.split('--')[0].trim();
      }

      // -- COST SYSTEM -----------------------------------------------
      const COST_PER_METER = 0.50; // KES per metre — adjust globally here
      let playerBalance = 500.00;  // starting credit in KES

      function updBalanceHUD() {
        const el = document.getElementById('ts-bal');
        if (!el) return;
        el.textContent = playerBalance.toFixed(0);
        el.style.color = playerBalance < 10 ? '#e8321a' : playerBalance < 50 ? '#f5c400' : '#1fc86b';
      }

      // -- VIOLATIONS ENGINE -----------------------------------------
      let score = 100, totalV = 0, sessionFb = [], distTrav = 0, sessTime = 0;
      const cds = {};
      let prevRdtLane = -1, stopHeldTime = 0, lastNearStop = -1;
      let pedZoneActive = false;

      // Lane transition tracking for subtraction/addition rules
      let lastMajorLane = 0, lastMinorLane = 0, transitionTracked = false;
      // Roundabout entry/exit lane tracking
      let rdtEntryMajLane = 0, rdtEntryAng = 0;
      // Parking: track farthest bay logic
      let parkEntryOrder = []; // which bays entered, in order
      // AI stall system
      let stalledAI = []; // indices of AI vehicles that are stalled

      function coolOf(k) { return (cds[k] || 0) > sessTime; }
      function setCool(k, d = 3) { cds[k] = sessTime + d; }

      function checkViolations(dt, sc) {
        if (!playerCar || !gameRunning) return;
        const pos = playerCar.position;
        const spd = Math.abs(ph.speed), skmh = spd * 3.6;

        // --- 1. SPEEDING ---
        if (!coolOf('spd')) {
          const lim = inRoundabout() ? 20 : onMinorRoad() ? 30 : sc.speedLimit;
          if (skmh > lim * 1.08) { addViol(`Speed ${skmh.toFixed(0)} km/h in ${lim} zone`, C.PENALTIES.SPEEDING, '⚡'); setCool('spd', 2.5); }
        }

        // --- 2. TRAFFIC LIGHT -- 4-PHASE ---
        trafficLights.forEach((tl, i) => {
          const d = pos.distanceTo(tl.pos);
          if (d < 10) {
            // Red: must stop
            if (tl.state === 'red' && spd > 1.2 && !coolOf(`rl_${i}`)) {
              addViol('Red light -- must stop completely!', C.PENALTIES.RED_LIGHT, '🔴'); setCool(`rl_${i}`, 4);
            }
            // Amber: must stop unless past line
            if (tl.state === 'amber' && spd > 1 && d > 5 && !coolOf(`al_${i}`)) {
              addViol('Amber light -- stop unless past stop line!', C.PENALTIES.RED_LIGHT / 2, '🟡'); setCool(`al_${i}`, 3);
            }
            // Red+Amber: stay stopped
            if (tl.state === 'ra' && spd > 1 && !coolOf(`ral_${i}`)) {
              addViol('Red+Amber -- stay stopped, prepare only!', C.PENALTIES.RED_LIGHT / 2, '🟠'); setCool(`ral_${i}`, 3);
            }
            // Green: if was red and now moving, positive
            if (tl.state === 'green' && spd > .5 && !coolOf(`go_${i}`)) {
              if (!coolOf(`tl_pass_${i}`)) { logEvt('✓ Correct green light proceed', true); setCool(`tl_pass_${i}`, 8); }
            }
          }
        });

        // --- 3. STOP SIGN -- full 3-second stop ---
        stopSigns.forEach((ss, i) => {
          const d = Math.sqrt((pos.x - ss.x) ** 2 + (pos.z - ss.z) ** 2);
          if (d < ss.r) {
            if (spd < .2) {
              ss.stopHeld = (ss.stopHeld || 0) + dt;
              if (ss.stopHeld >= C.STOP_SEC && !ss.passed) {
                ss.passed = true; logEvt('✓ Full 3-second stop at STOP sign', true);
              }
            } else {
              ss.stopHeld = 0;
              if (!ss.passed && !coolOf(`ss_${i}`) && d < ss.r * .7) {
                addViol('Failed full 3-second stop at STOP sign!', C.PENALTIES.NO_STOP, '🛑'); setCool(`ss_${i}`, 5);
              }
            }
          } else {
            ss.stopHeld = 0; ss.passed = false;
          }
        });

        // --- 4. GIVE WAY / YIELD -- check if forcing AI to brake ---
        yieldSigns.forEach((ys, i) => {
          const d = Math.sqrt((pos.x - ys.x) ** 2 + (pos.z - ys.z) ** 2);
          if (d < ys.r && spd > 1.5) {
            // [A] Roundabout Yield
            if (ys.isRoundabout) {
              aiVehicles.filter(v => {
                const dv = Math.sqrt((v.m.position.x - C.RDT_X) ** 2 + (v.m.position.z - C.RDT_Z) ** 2);
                return dv >= C.RDT_INNER && dv <= C.RDT_OUTER;
              }).forEach(v => {
                const ad = pos.distanceTo(v.m.position);
                if (ad < 8 && !coolOf(`yield_${i}`)) {
                  addViol('Failed to yield to roundabout traffic!', C.PENALTIES.NO_YIELD, '⚠️'); setCool(`yield_${i}`, 4);
                }
              });
            }
            // [B] U-Turn Gap Yield (Traffic from the Right)
            if (ys.isUTurnGap) {
              const comingFromUpper = pos.z < C.MAJ_MID_Z;
              aiVehicles.forEach(v => {
                const vp = v.m.position;
                const vOnRight = comingFromUpper ? (vp.z > C.MAJ_MID_Z && vp.x > pos.x) : (vp.z < C.MAJ_MID_Z && vp.x < pos.x);
                const distToV = pos.distanceTo(vp);
                if (vOnRight && distToV < 12 && !coolOf(`yield_ut_${i}`)) {
                  addViol('Failed to yield to traffic from the right! Stop and give way at U-turn gap.', C.PENALTIES.NO_YIELD, '⚠️');
                  setCool(`yield_ut_${i}`, 5);
                }
              });
            }
          }
        });

        // --- 5. WRONG WAY -- ONE-WAY ROADS ---
        if (!coolOf('ww')) {
          const onEW = Math.abs(pos.z - C.MAJ_MID_Z) < C.MAJ_W * .9;
          if (onEW) {
            const upper = pos.z < C.MAJ_MID_Z;
            // heading PI/2 = east (+X), -PI/2 = west (-X)
            const goE = Math.sin(ph.heading) > 0.3, goW = Math.sin(ph.heading) < -0.3;
            if (((upper && goW) || (!upper && goE)) && spd > 1) {
              addViol('Wrong way on one-way road!', C.PENALTIES.WRONG_WAY, '⛔'); setCool('ww', 4);
            }
          }
        }

        // --- 6. YELLOW CENTRE LINE CROSSING (wall) ---
        if (!coolOf('ylc')) {
          yellowKerbs.forEach(yk => {
            if (!yk.isCentreLine) return;
            const dx = Math.abs(pos.x - yk.x), dz = Math.abs(pos.z - yk.z);
            if (dx < yk.hw && dz < yk.hd) {
              addViol('Crossed yellow centre line -- critical error!', C.PENALTIES.YLW_LINE, '🟡'); setCool('ylc', 4);
            }
          });
        }

        // --- 7. YELLOW KERB -- NO STOPPING ---
        if (!coolOf('ykstop')) {
          yellowKerbs.forEach(yk => {
            if (!yk.noStop) return;
            const dx = Math.abs(pos.x - yk.x), dz = Math.abs(pos.z - yk.z);
            if (dx < yk.hw && dz < yk.hd && spd < .2 && sessTime > 3) {
              addViol('Stopped on yellow kerb -- no stopping zone!', C.PENALTIES.YLW_KERB, '🟡'); setCool('ykstop', 4);
            }
          });
        }

        // --- 8. SOLID WHITE LINE -- NO CROSSING ---
        if (!coolOf('swl')) {
          // Simplified: detect if car is on edge of road (white edge line)
          const onRoad = Math.abs(pos.z - C.MAJ_UPPER_Z) < C.MAJ_W / 2 || Math.abs(pos.z - C.MAJ_LOWER_Z) < C.MAJ_W / 2;
          if (onRoad) {
            const edgeLeft = C.MAJ_UPPER_Z - C.MAJ_W / 2, edgeRight = C.MAJ_UPPER_Z + C.MAJ_W / 2;
            if ((pos.z < edgeLeft + .3 || pos.z > edgeRight - .3) && spd > 1) {
              addViol('Crossed solid white edge line!', C.PENALTIES.CONT_WHITE_CROSS, '🚧'); setCool('swl', 4);
            }
          }
        }

        // --- 9. ROUNDABOUT RULES ---
        if (inRoundabout()) {
          const dx = pos.x - C.RDT_X, dz = pos.z - C.RDT_Z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const ang = Math.atan2(dz, dx);
          const lw = C.RDT_LANE_W || 3;
          const lane = dist < C.RDT_INNER + lw ? 1 : dist < C.RDT_INNER + lw * 2 ? 2 : dist < C.RDT_INNER + lw * 3 ? 3 : 4;

          // [A] Island touch – must never enter the island
          if (dist < C.RDT_INNER - .5 && !coolOf('island')) {
            addViol('Touched roundabout island! Island is untouchable -- critical fail.', C.PENALTIES.COLLISION, '⭕');
            setCool('island', 4);
          }

          // [B] Anti-clockwise travel
          if (!coolOf('rw') && spd > 1) {
            const tgAng = ang + Math.PI / 2;
            const dot = Math.sin(ph.heading) * Math.cos(tgAng) + Math.cos(ph.heading) * Math.sin(tgAng);
            if (dot < -.45) { addViol('Anti-clockwise in roundabout! Keep island to your RIGHT.', C.PENALTIES.WRONG_WAY, '🔄'); setCool('rw', 3); }
          }

          // [C] Lane change inside (solid lines = no crossing)
          if (prevRdtLane !== -1 && prevRdtLane !== lane && spd > 1 && !coolOf('rlc')) {
            addViol(`Lane change inside roundabout! Solid lines mean no lane changes.`, C.PENALTIES.RDT_LANE_CHG, '🚫'); setCool('rlc', 3);
          }
          prevRdtLane = lane;

          // [D] Stopping inside roundabout (only allowed if traffic blocked)
          if (spd < .15 && dist > C.RDT_INNER && dist < C.RDT_OUTER && !coolOf('rdtstop')) {
            const aiNearby = aiVehicles.filter(v => { const d = Math.sqrt((v.m.position.x - C.RDT_X) ** 2 + (v.m.position.z - C.RDT_Z) ** 2); return d >= C.RDT_INNER && d <= C.RDT_OUTER && v.m.position.distanceTo(pos) < 8; }).length > 0;
            if (!aiNearby) { addViol('Stopped inside roundabout! Only stop if traffic is blocked.', C.PENALTIES.NO_STOP, '⛔'); setCool('rdtstop', 4); }
          }

          // Record entry lane and angle for exit validation
          if (rdtEntryLane === -1) { rdtEntryLane = lane; rdtEntryAngle = ang; }
        } else {
          if (prevRdtLane !== -1) checkRoundaboutExit();
          prevRdtLane = -1;
        }

        // --- 10. LANE EXIT MAPPING ---
        checkLaneExitCompliance();

        // --- 11. PEDESTRIAN CROSSING RULES ---
        checkPedestrianZones(dt);

        // --- 12. PARKING GEAR & RULES ---
        parkingZones.forEach((pz, i) => {
          const inside = Math.abs(pos.x - pz.x) < pz.hw && Math.abs(pos.z - pz.z) < pz.hd;
          if (inside && !pz.wasIn) {
            // Gear check on entry
            if (spd > .3) {
              if (ph.gear !== pz.entryG && !coolOf(`pe_${i}`)) {
                addViol(`Wrong entry gear for ${pz.type} parking! Need ${pz.entryG} gear.`, C.PENALTIES.WRONG_GEAR, '🅿️');
                setCool(`pe_${i}`, 4);
              } else if (ph.gear === pz.entryG && !coolOf(`pok_${i}`)) {
                logEvt(`✓ Correct entry gear (${pz.entryG}) for ${pz.type} parking`, true);
                setCool(`pok_${i}`, 8);
              }
            }
            // Safe distance check: 1m from other AI vehicles
            aiVehicles.forEach((v, vi) => {
              const aiDist = pos.distanceTo(v.m.position);
              if (aiDist < 1.2 && !coolOf(`psafe_${i}_${vi}`)) {
                addViol('Parking: less than 1m from adjacent vehicle!', C.PENALTIES.COLLISION / 2, '🅿️');
                setCool(`psafe_${i}_${vi}`, 4);
              }
            });
          }
          if (!inside && pz.wasIn) {
            // Gear check on exit
            if (spd > .3) {
              if (ph.gear !== pz.exitG && !coolOf(`px_${i}`)) {
                addViol(`Wrong exit gear for ${pz.type} parking! Need ${pz.exitG} gear.`, C.PENALTIES.WRONG_GEAR, '🅿️');
                setCool(`px_${i}`, 4);
              } else if (ph.gear === pz.exitG && !coolOf(`pxok_${i}`)) {
                logEvt(`✓ Correct exit gear (${pz.exitG}) for ${pz.type} parking`, true);
                setCool(`pxok_${i}`, 8);
              }
            }
          }
          pz.wasIn = inside;
        });

        // --- 13. SIGNALS ---
        if (!coolOf('sig')) {
          const turning = Math.abs(ph.steer) > .42 && spd > 2;
          if (turning && ph.steer > .35 && !sigL) { addViol('No left indicator when turning!', C.PENALTIES.NO_SIGNAL, 'SIG-L'); setCool('sig', 4); }
          else if (turning && ph.steer < -.35 && !sigR) { addViol('No right indicator when turning!', C.PENALTIES.NO_SIGNAL, 'SIG-R'); setCool('sig', 4); }
        }

        // --- 14. NO U-TURN ZONES ---
        noUTurnZones.forEach((nz, i) => {
          const d = Math.sqrt((pos.x - nz.x) ** 2 + (pos.z - nz.z) ** 2);
          if (d < nz.r && !coolOf(`nut_${i}`)) {
            const uturning = Math.abs(ph.steer) > 0.6 && Math.abs(ph.speed) > 1;
            if (uturning) { addViol('U-turn in No U-Turn zone!', C.PENALTIES.WRONG_WAY, '🔃'); setCool(`nut_${i}`, 5); }
          }
        });

        // --- 15. NO ENTRY ---
        noEntryZones.forEach((nez, i) => {
          const d = Math.sqrt((pos.x - nez.x) ** 2 + (pos.z - nez.z) ** 2);
          if (d < nez.r && spd > 1 && !coolOf(`ne_${i}`)) {
            addViol('Entered No Entry zone!', C.PENALTIES.WRONG_WAY, '⛔'); setCool(`ne_${i}`, 5);
          }
        });

        // --- 16. AI COLLISION (Golden Rule: see rear tyres/number plate) ---
        aiVehicles.forEach((v, i) => {
          const d = pos.distanceTo(v.m.position);
          if (d < 3.5 && !coolOf(`col_${i}`)) {
            addViol('Collision! Maintain Golden Rule distance -- see rear tyres & number plate.', C.PENALTIES.COLLISION, '💥');
            setCool(`col_${i}`, 4); ph.speed *= -.3;
          } else if (d < 6 && d >= 3.5 && !coolOf(`gld_${i}`) && Math.abs(ph.speed) > 1) {
            // Too close (< Golden Rule safe gap ~6m)
            logEvt('⚠️ Too close -- you cannot see rear tyres of vehicle ahead.', false);
            setCool(`gld_${i}`, 5);
          }
        });

        // --- 17. PEDESTRIAN CROSSING CRITICAL FAIL ---
        // If light turns green mid-cross while ped is still on zebra, still a critical fail
        peds.forEach((p, pi) => {
          if (!p.onCrossing) return;
          const zb = p.zb;
          const onCrossingArea = zb.axis === 'ew'
            ? Math.abs(pos.z - zb.cz) < 3 && Math.abs(pos.x - zb.cx) < zb.roadW / 2
            : Math.abs(pos.x - zb.cx) < 3 && Math.abs(pos.z - zb.cz) < zb.roadW / 2;
          if (onCrossingArea && !coolOf(`ped_crit_${pi}`)) {
            addViol('CRITICAL: Vehicle on crossing while pedestrian present -- immediate fail!', C.PENALTIES.PED_ENCROACH + 10, '🚨');
            setCool(`ped_crit_${pi}`, 6);
          }
        });

        // --- 18. SUBTRACTION RULE (major->minor lane transition) ---
        if (!coolOf('sub_rule')) {
          const ld = detectLane();
          if (ld.roadType === 'major' && ld.lane > 0) lastMajorLane = ld.lane;
          if (ld.roadType === 'minor' && ld.lane > 0 && lastMajorLane > 0) {
            const expected = SUBTRACTION_RULE[lastMajorLane];
            if (expected && ld.lane !== expected && !coolOf('sub_viol')) {
              addViol(
                `Wrong lane after major road! From Maj L${lastMajorLane} should enter Min L${expected} (subtract 1).`,
                C.PENALTIES.WRONG_LANE_EXIT, '🔢');
              setCool('sub_viol', 6);
            }
            setCool('sub_rule', 4);
            lastMajorLane = 0;
          }
        }

        // --- 19. ADDITION RULE (minor->major lane transition) ---
        if (!coolOf('add_rule')) {
          const ld = detectLane();
          if (ld.roadType === 'minor' && ld.lane > 0) lastMinorLane = ld.lane;
          if (ld.roadType === 'major' && ld.lane > 0 && lastMinorLane > 0) {
            const expected = ADDITION_RULE[lastMinorLane];
            if (expected && ld.lane !== expected && ld.lane !== 1 && !coolOf('add_viol')) {
              addViol(
                `Wrong lane after minor road! From Min L${lastMinorLane} should enter Maj L${expected} (add 1).`,
                C.PENALTIES.WRONG_LANE_EXIT, '🔢');
              setCool('add_viol', 6);
            }
            setCool('add_rule', 4);
            lastMinorLane = 0;
          }
        }

        // --- 20. ROUNDABOUT ENTRY LANE vs OUTER/INNER RULE ---
        if (!coolOf('rdt_entry')) {
          const ld = detectLane();
          if (ld.roadType === 'major' && ld.lane > 0) rdtEntryMajLane = ld.lane;
          if (inRoundabout() && rdtEntryMajLane > 0) {
            const dx = pos.x - C.RDT_X, dz = pos.z - C.RDT_Z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const rdtLane = dist < C.RDT_INNER + C.RDT_LANE_W ? 1
              : dist < C.RDT_INNER + C.RDT_LANE_W * 2 ? 2
                : dist < C.RDT_INNER + C.RDT_LANE_W * 3 ? 3 : 4;
            const expectedRdtLane = RDT_ENTRY_LANE_MAP.major[rdtEntryMajLane];
            if (expectedRdtLane && Math.abs(rdtLane - expectedRdtLane) > 1 && !coolOf('rdt_ent_v')) {
              addViol(
                `Wrong roundabout lane! Maj L${rdtEntryMajLane} should enter RDT L${expectedRdtLane} not L${rdtLane}.`,
                C.PENALTIES.RDT_LANE_CHG, '🔄');
              setCool('rdt_ent_v', 6);
            }
            setCool('rdt_entry', 3);
            rdtEntryMajLane = 0;
          }
        }

        // --- 21. PARKING ZONE COLLISION WITH BAY LINES (zero tolerance) ---
        parkingZones.forEach((pz, i) => {
          const inside = Math.abs(pos.x - pz.x) < pz.hw && Math.abs(pos.z - pz.z) < pz.hd;
          if (inside) {
            // Check if too close to bay line edge (within 0.25u)
            const relX = Math.abs(pos.x - pz.x);
            const relZ = Math.abs(pos.z - pz.z);
            if ((relX > pz.hw - .35 || relZ > pz.hd - .35) && Math.abs(ph.speed) > .2 && !coolOf(`pbay_${i}`)) {
              addViol('Parking bay line contact -- zero tolerance collision!', C.PENALTIES.COLLISION, '🅿️');
              setCool(`pbay_${i}`, 3);
            }
          }
        });

        // --- 22. DESTINATION ---
        if (destMarker && pos.distanceTo(destMarker.position) < 6 && sessTime > 5) endSession(true);
      }

      // -- LANE EXIT COMPLIANCE -------------------------------------
      let lastKnownLane = 0, lastKnownRoadType = '', exitAngleRecorded = null;
      function checkLaneExitCompliance() {
        if (!playerCar) return;
        const ld = detectLane();
        const kmh = Math.abs(ph.speed) * 3.6;
        if (ld.roadType !== 'off' && ld.lane > 0) {
          // Update HUD
          document.getElementById('ts-lane').textContent = `L${ld.lane}`;
          // Update lane exit map
          updLaneMap(ld.roadType, ld.lane);
          // Detect wrong exit
          if (lastKnownLane > 0 && ld.lane !== lastKnownLane && kmh > 5 && !coolOf('lnchg')) {
            // Lane shift at roundabout entry: validate
            // For now allow graceful lane changes outside roundabout
          }
          lastKnownLane = ld.lane; lastKnownRoadType = ld.roadType;
        } else {
          document.getElementById('ts-lane').textContent = '--';
        }
      }

      let laneMapShown = '', laneMapActiveLane = 0;
      function updLaneMap(roadType, activeLane) {
        if (roadType === laneMapShown && activeLane === laneMapActiveLane) return;
        laneMapShown = roadType; laneMapActiveLane = activeLane;
        const container = document.getElementById('lane-map-rows');
        const lanes = LANE_EXITS[roadType];
        if (!lanes) {
          if (roadType === 'roundabout') {
            container.innerHTML = `<div class="lane-row lane-active">
        <span class="lane-badge">RDT L${activeLane}</span>
        <span class="lane-opts">Clockwise only -- no lane changes</span></div>`;
          } else { container.innerHTML = ''; }
          return;
        }
        container.innerHTML = Object.entries(lanes).map(([ln, opts]) => `
    <div class="lane-row${parseInt(ln) === activeLane ? ' lane-active' : ''}">
      <span class="lane-badge">LANE ${ln}</span>
      <span class="lane-opts">${opts.join(' / ')}</span>
    </div>`).join('');
      }

      // -- ROUNDABOUT EXIT TRACKING ---------------------------------
      let rdtEntryLane = -1, rdtEntryAngle = 0;
      function checkRoundaboutExit() {
        if (!playerCar || rdtEntryLane < 0) return;
        const pos = playerCar.position;
        const dx = pos.x - C.RDT_X, dz = pos.z - C.RDT_Z;
        const exitAngle = Math.atan2(dz, dx);
        // Clockwise: angle decreases, so sweep measured as: entryAngle - exitAngle (mod 2PI)
        const sweep = ((rdtEntryAngle - exitAngle + Math.PI * 4) % (Math.PI * 2));
        const deg = sweep * 180 / Math.PI;

        // Valid exit ranges (approximate, in degrees of clockwise arc traversed):
        // Lane 1: 0° (straight/left ~0-90°) or 90° (left turn ~90°)
        // Lane 2: 0° only (straight ~0-90°, reject >100°)
        // Lane 3: 90°-180° (right turn / opposite side)
        // Lane 4: 90°-135° (right turn / slight roundabout arc, explicitly block U-turn/360°)
        const lane = Math.min(4, Math.max(1, rdtEntryLane));
        if (lane === 2 && deg > 110 && !coolOf('rdtex')) {
          addViol(`Lane 2 exit: straight only! You turned ${deg.toFixed(0)}°. Lane 2 is STRAIGHT ONLY.`, C.PENALTIES.WRONG_LANE_EXIT, '🔄');
          setCool('rdtex', 5);
        }
        if (lane === 1 && deg > 110 && !coolOf('rdtex1')) {
          addViol(`Lane 1: left or straight only! (2 options). You turned ${deg.toFixed(0)}°.`, C.PENALTIES.WRONG_LANE_EXIT, '🔄');
          setCool('rdtex1', 5);
        }
        // Lane 3: straight or right only (major road). deg>200 = went too far
        if (lane === 3 && deg > 220 && !coolOf('rdtex3')) {
          addViol(`Lane 3: straight or right only. Turned ${deg.toFixed(0)}°. Use Lane 4 for U-turn.`, C.PENALTIES.WRONG_LANE_EXIT, '🔄');
          setCool('rdtex3', 5);
        }
        // Lane 4 strict enforcement: block U-turn (180) and full circle (360). Max ~135 (with some leeway)
        if (lane === 4) {
          if (deg > 165 && deg < 225 && !coolOf('rdtex4_u')) {
            addViol(`Lane 4 (Power Lane) cannot execute U-turn (${deg.toFixed(0)}°)! Use Lane 1 or 2.`, C.PENALTIES.WRONG_LANE_EXIT, '🔄');
            setCool('rdtex4_u', 5);
          } else if (deg > 270 && !coolOf('rdtex4_c')) {
            addViol(`Lane 4 cannot complete full circuit (${deg.toFixed(0)}°)! Exit earlier or use inner lane.`, C.PENALTIES.WRONG_LANE_EXIT, '🔄');
            setCool('rdtex4_c', 5);
          } else if (deg < 60 && deg > 20 && !coolOf('rdtex4')) {
            addViol(`Lane 4: minimum exit is right (90°). You exited too early at ${deg.toFixed(0)}°.`, C.PENALTIES.WRONG_LANE_EXIT / 2, '🔄');
            setCool('rdtex4', 5);
          }
        }
        logEvt(`Roundabout exit: Lane ${lane}, arc ${deg.toFixed(0)}°`, deg < 110);
        rdtEntryLane = -1;
      }

      // -- PEDESTRIAN CROSSING LOGIC ---------------------------------
      let pedWarnActive = false;
      function checkPedestrianZones(dt) {
        if (!playerCar) return;
        const pos = playerCar.position;
        const spd = Math.abs(ph.speed);
        let anyPedOnZebra = false;

        zebras.forEach((z, zi) => {
          const inDetect = z.axis === 'ew'
            ? Math.abs(pos.z - z.cz) < 8 && Math.abs(pos.x - z.cx) < z.w / 2 + 3
            : Math.abs(pos.x - z.cx) < 8 && Math.abs(pos.z - z.cz) < z.d / 2 + 3;
          if (!inDetect) return;

          // Find peds on/near this zebra
          const pedsOnZebra = peds.filter(p => {
            const px = p.m.position.x, pz = p.m.position.z;
            return z.axis === 'ew'
              ? Math.abs(pz - z.cz) < 4 && Math.abs(px - z.cx) < z.w / 2 + 2
              : Math.abs(px - z.cx) < 4 && Math.abs(pz - z.cz) < z.d / 2 + 2;
          });

          if (pedsOnZebra.length > 0) {
            anyPedOnZebra = true;
            // Car must slow down within 3m
            const carDist = z.axis === 'ew' ? Math.abs(pos.z - z.cz) : Math.abs(pos.x - z.cx);

            if (carDist < C.PED_3M * 3) {
              // Must decelerate approaching
              if (spd > C.SPD_MIN * 1.2 && !coolOf(`ped_slow_${zi}`)) {
                logEvt('+ Approaching zebra -- reduce speed', false); setCool(`ped_slow_${zi}`, 4);
              }
            }
            // Encroachment -- car on crossing while ped is on it
            const onZebra = z.axis === 'ew'
              ? Math.abs(pos.z - z.cz) < 3 && Math.abs(pos.x - z.cx) < z.w / 2
              : Math.abs(pos.x - z.cx) < 3 && Math.abs(pos.z - z.cz) < z.d / 2;
            if (onZebra && !coolOf(`ped_encr_${zi}`)) {
              addViol('Encroached on crossing while pedestrian present!', C.PENALTIES.PED_ENCROACH, '🚶');
              setCool(`ped_encr_${zi}`, 5);
            }
            // Positive: stopped for ped
            if (spd < .2 && carDist < 8 && !coolOf(`ped_ok_${zi}`)) {
              logEvt('✓ Stopped for pedestrian at zebra crossing', true); setCool(`ped_ok_${zi}`, 8);
              score = Math.min(100, score + 1); updTopBar();
            }
          } else {
            // No ped -- but check overtaking at zebra
            // If another AI car is stopped near this zebra, don't overtake
            const nearStoppedAI = aiVehicles.some(v => {
              const ad = v.m.position.distanceTo(new THREE.Vector3(z.cx, 0, z.cz));
              return ad < 12 && v.spd < 0.5; // stopped AI
            });
            if (nearStoppedAI && spd > 2 && !coolOf(`ped_ov_${zi}`)) {
              addViol('Overtaking at pedestrian crossing!', C.PENALTIES.PED_OVERTAKE, '⛔'); setCool(`ped_ov_${zi}`, 5);
            }
          }
        });

        // Ped warning display
        if (anyPedOnZebra !== pedWarnActive) {
          pedWarnActive = anyPedOnZebra;
          document.getElementById('ped-warn').style.display = anyPedOnZebra ? 'block' : 'none';
        }
      }

      // -- SIGN HUD PILLS --------------------------------------------
      const pills = {
        'sp-tl': document.getElementById('sp-tl'),
        'sp-ped': document.getElementById('sp-ped'),
        'sp-zone': document.getElementById('sp-zone'),
        'sp-lane': document.getElementById('sp-lane'),
      };
      function updSignHUD() {
        if (!playerCar) return;
        const pos = playerCar.position;
        // Traffic light
        let nearest = null, nd = Infinity;
        trafficLights.forEach(tl => { const d = pos.distanceTo(tl.pos); if (d < 15 && d < nd) { nd = d; nearest = tl; } });
        if (nearest) {
          const pill = pills['sp-tl'];
          pill.classList.add('show');
          const col = nearest.state === 'green' ? 'ok-pill' : nearest.state === 'red' ? 'danger-pill' : 'warn-pill';
          pill.className = `sign-pill show ${col}`;
          document.getElementById('sp-tl-t').textContent = nearest.state.toUpperCase() + ' -- ' +
            (nearest.state === 'red' ? 'STOP' : nearest.state === 'green' ? 'PROCEED' : nearest.state === 'ra' ? 'PREPARE' : 'STOP SAFELY');
        } else pills['sp-tl'].classList.remove('show');
        // Zone + approach sequence indicator
        const zPill = pills['sp-zone'];
        let zt = 'MAJOR 50 km/h';
        if (inRoundabout()) { zt = 'ROUNDABOUT 20 km/h'; }
        else if (onMinorRoad()) { zt = 'MINOR 30 km/h'; }
        else {
          // Check proximity to roundabout arm (show approach sequence step)
          if (playerCar) {
            const dx = playerCar.position.x - C.RDT_X, dz = playerCar.position.z - C.RDT_Z;
            const distRdt = Math.sqrt(dx * dx + dz * dz);
            if (distRdt < C.RDT_OUTER + 22 && distRdt > C.RDT_OUTER) {
              const step = distRdt > C.RDT_OUTER + 16 ? '1: Select lane'
                : distRdt > C.RDT_OUTER + 8 ? '2: Zebra crossing'
                  : distRdt > C.RDT_OUTER + 2 ? '3: STOP LINE – yield'
                    : '4: Enter roundabout';
              zt = 'APPROACH STEP ' + step;
            }
          }
        }
        document.getElementById('sp-zone-t').textContent = zt;
        zPill.className = 'sign-pill show' + (inRoundabout() ? '' : onMinorRoad() ? ' warn-pill' : ' ok-pill');
        // Ped
        if (pedWarnActive) pills['sp-ped'].className = 'sign-pill show danger-pill';
        else pills['sp-ped'].classList.remove('show');
        // Lane
        const ld = detectLane();
        if (ld.lane > 0) {
          const lPill = pills['sp-lane'];
          const opts = LANE_EXITS[ld.roadType]?.[ld.lane];
          let laneText = `L${ld.lane}`;
          if (opts) laneText += ': ' + opts[0].split(' ')[0];
          // Show transition rule hint
          if (ld.roadType === 'major' && lastMinorLane > 0) {
            const exp = ADDITION_RULE[lastMinorLane];
            laneText += ` (+1 from Min L${lastMinorLane}->${exp})`;
          }
          if (ld.roadType === 'minor' && lastMajorLane > 0) {
            const exp = SUBTRACTION_RULE[lastMajorLane];
            laneText += ` (-1 from Maj L${lastMajorLane}->${exp})`;
          }
          document.getElementById('sp-lane-t').textContent = laneText;
          lPill.className = 'sign-pill show ok-pill';
        } else pills['sp-lane'].classList.remove('show');
      }

      // -- VIOLATION / LOG HELPERS -----------------------------------
      function addViol(msg, pen, icon = '⚠️') {
        totalV++; score = Math.max(0, score - pen);
        sessionFb.push({ msg, pass: false });
        updTopBar(); logEvt(`${icon} ${msg}`, false);
        flashViol(); setAI(getAIResponse(msg));
      }
      function logEvt(msg, pass) {
        const lst = document.getElementById('log-list');
        const t = `${Math.floor(sessTime / 60)}:${String(Math.floor(sessTime % 60)).padStart(2, '0')}`;
        const d = document.createElement('div');
        d.className = `le${pass ? ' lok' : ''}`;
        d.innerHTML = `<span class="lt2">${t}</span><span class="lm">${msg}</span>`;
        lst.insertBefore(d, lst.firstChild);
        if (lst.children.length > 14) lst.lastChild.remove();
      }
      function flashViol() {
        const el = document.getElementById('vf');
        el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 480);
      }
      function updTopBar() {
        document.getElementById('ts-score').textContent = score;
        document.getElementById('ts-v').textContent = totalV;
        document.getElementById('ts-t').textContent = `${Math.floor(sessTime / 60)}:${String(Math.floor(sessTime % 60)).padStart(2, '0')}`;
        document.getElementById('ts-spd').textContent = (Math.abs(ph.speed) * 3.6).toFixed(0);
        updBalanceHUD();
      }

      // -- AI INSTRUCTOR (NTSA MTB certified responses) --------------------
      const AI_DB = {
        'Red light': 'Traffic light is RED -- come to a full stop behind the stop line. Do not move until Green.',
        'Amber light': 'Amber means stop safely unless you have already crossed the stop line.',
        'Red+Amber': 'Red and Amber together -- remain stopped. Prepare gear and mirrors. Wait for Green only.',
        'Speed': 'You exceeded the speed limit. Major=50, Minor=30, Roundabout=20 km/h. Ease off immediately.',
        'Wrong way': 'One-way road -- all vehicles travel in one direction only. Do not drive against traffic flow.',
        'yellow centre': 'Yellow centre line is a SOLID BARRIER on two-way roads. Crossing it is a critical fail.',
        'roundabout': 'Select correct lane BEFORE the roundabout. Major: L1=left/straight, L2=straight, L3=straight/right, L4=right/U-turn/270°/360°. Keep island to your RIGHT.',
        'STOP sign': 'STOP sign: vehicle must reach complete 0 km/h and remain stopped for 3 full seconds.',
        'yield': 'Yield/Give Way: reduce speed, be ready to stop. Traffic on major road has absolute priority.',
        'parking': 'Angle: FORWARD in (D), REVERSE out (R). Parallel: REVERSE in (R), FORWARD out (D).',
        'indicator': 'Signal RIGHT entering roundabout. Signal LEFT before your exit. Cancel after maneuver.',
        'Collision': 'GOLDEN RULE: maintain distance where you can see rear tyres AND number plate ahead.',
        'Too close': 'Increase your following distance. You must be able to see the rear tyres of the car ahead.',
        'Lane change': 'Signal, mirrors, blind spot, then move ONE lane at a time. Never skip lanes.',
        'crossing': 'Pedestrians on zebra crossing have absolute right of way. Stop and WAIT until fully clear.',
        'Encroach': 'Never drive onto the crossing while any pedestrian is on it -- even if light turns Green.',
        'CRITICAL': 'CRITICAL SAFETY FAILURE: Pedestrian on crossing. Stop immediately and wait.',
        'Horn': 'Never hoot at pedestrians. This counts as intimidation and is a violation.',
        'No U-Turn': 'U-turn prohibited here. Only permitted at central reserve gaps or Lane 4/Lane 3 exits.',
        'No Entry': 'No Entry zone. Reverse safely and use the correct authorised route.',
        'U-turn': 'U-turns only permitted: Major Lane 4 (central reserve gaps), or Minor Lane 3 exits.',
        'Wrong exit': 'Lane exit violation. Check entry lane before roundabout. Each lane has specific exits.',
        'subtract': 'Subtraction rule: moving from Major (4 lanes) to Minor (3 lanes) -- subtract 1 from lane.',
        'Wrong lane after major': 'From Maj L4->Min L3, Maj L3->Min L2, Maj L2->Min L1. This is mandatory.',
        'Wrong lane after minor': 'Addition rule: Min L1->Maj L2, Min L2->Maj L3, Min L3->Maj L4. Add 1.',
        'roundabout lane': 'Maj L1/L2 enter outer RDT lanes (1/2). Maj L3/L4 enter inner RDT lanes (3/4).',
        'stall': 'A vehicle has stalled. Find the next shortest correct route. 3 routes: short, long, parking.',
        'bay line': 'Zero tolerance: any contact with bay lines or parked vehicles is an immediate fail.',
      };
      const HINTS = [
        'KEEP LEFT always -- Lane 1 is the primary keep-left lane on all roads.',
        'Major road: 4 lanes. L1=straight/left. L2=straight only. L3=straight/right. L4=right/180°/270°/360°.',
        'Minor road: 3 lanes. L1=straight/left. L2=straight. L3=straight/right/U-turn.',
        'Subtraction rule: Major->Minor = subtract 1 (L4->L3, L3->L2, L2->L1).',
        'Addition rule: Minor->Major = add 1 (L1->L2, L2->L3, L3->L4).',
        'Roundabout: clockwise, island to your RIGHT. Yield before entry. No stops inside. No lane changes (solid lines).',
        'Pedestrians cross on RED light only. Even if Green shows mid-cross -- wait for them.',
        'STOP sign: complete stop (0 km/h) for 3 full seconds. Counted from zero speed.',
        'Yellow centre line = solid wall on two-way minor roads. Never cross it.',
        'Angle parking: FORWARD in, REVERSE out. Parallel: REVERSE in, FORWARD out.',
        'Signal 30 metres before turning, lane changing, or entering/exiting parking.',
        'Golden Rule: see rear tyres AND number plate of vehicle ahead at all times.',
        'Shortest route first. Longest route second. Parking ONLY as absolute last resort.',
        'Traffic light: Red->Red+Amber->Green->Amber. Red+Amber = PREPARE only, do not move.',
        'Central reserve gaps are U-turn zones. Yield to oncoming traffic before using them.',
        'Approach sequence: (1) Select lane early. (2) Slow at zebra. (3) Stop at red light/stop line. (4) Yield, then enter.',
      ];
      function getAIResponse(msg) {
        for (const [k, v] of Object.entries(AI_DB)) if (msg.includes(k)) return v;
        return HINTS[Math.floor(Math.random() * HINTS.length)];
      }
      function setAI(msg) { document.getElementById('ai-msg').textContent = msg; }
      let hintTimer = 0;
      function tickHints(dt) {
        hintTimer += dt;
        if (hintTimer > 10) { hintTimer = 0; if (gameRunning) setAI(HINTS[Math.floor(Math.random() * HINTS.length)]); }
      }

      // -- CAMERA ---------------------------------------------------
      let camMode = 0;
      [['c-fol', 0], ['c-top', 1], ['c-hd', 2]].forEach(([id, m]) => {
        document.getElementById(id).addEventListener('click', () => {
          camMode = m;
          ['c-fol', 'c-top', 'c-hd'].forEach((i, j) => document.getElementById(i).classList.toggle('active', j === m));
        });
      });
      function cycleCam() { camMode = (camMode + 1) % 3;['c-fol', 'c-top', 'c-hd'].forEach((i, j) => document.getElementById(i).classList.toggle('active', j === camMode)); }
      function updateCam(dt) {
        if (!playerCar) return;
        const pos = playerCar.position, h = ph.heading;
        if (camMode === 0) {
          // Behind car: opposite of forward direction
          const bx = -Math.sin(h) * 12, bz = -Math.cos(h) * 12;
          cam.position.lerp(new THREE.Vector3(pos.x + bx, pos.y + 6, pos.z + bz), .07);
          cam.lookAt(pos.x + Math.sin(h) * 5, pos.y + 1, pos.z + Math.cos(h) * 5);
        } else if (camMode === 1) {
          cam.position.lerp(new THREE.Vector3(pos.x, 48, pos.z), .05);
          cam.lookAt(pos.x, 0, pos.z);
        } else {
          // Hood cam: just in front of car
          const fx = Math.sin(h) * 2.5, fz = Math.cos(h) * 2.5;
          cam.position.copy(new THREE.Vector3(pos.x + fx, pos.y + 1.6, pos.z + fz));
          cam.lookAt(pos.x + Math.sin(h) * 25, pos.y + 1.5, pos.z + Math.cos(h) * 25);
        }
      }

      // -- SPEEDOMETER ----------------------------------------------
      function drawSpd(spd, lim) {
        const c = document.getElementById('sc'), ctx = c.getContext('2d');
        const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = 56;
        ctx.clearRect(0, 0, W, H);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#050c18'; ctx.fill();
        ctx.strokeStyle = 'rgba(245,196,0,.28)'; ctx.lineWidth = 1.5; ctx.stroke();
        const sa = Math.PI * .75, ea = Math.PI * 2.25, maxS = lim * 1.6;
        const na = sa + Math.min(spd / maxS, 1) * (ea - sa);
        ctx.beginPath(); ctx.arc(cx, cy, R - 7, sa, na);
        ctx.strokeStyle = spd > lim ? '#e8321a' : spd > lim * .85 ? '#f5c400' : '#1fc86b';
        ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke();
        for (let i = 0; i <= 10; i++) {
          const a = sa + (i / 10) * (ea - sa), inn = i % 5 === 0 ? R - 18 : R - 12;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inn, cy + Math.sin(a) * inn);
          ctx.lineTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7));
          ctx.strokeStyle = i % 5 === 0 ? 'rgba(245,196,0,.8)' : 'rgba(200,200,200,.3)'; ctx.lineWidth = i % 5 === 0 ? 2 : 1; ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(na) * (R - 14), cy + Math.sin(na) * (R - 14));
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#f5c400'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 19px Oswald,monospace'; ctx.fillText(Math.round(spd), cx, cy + 7);
        ctx.font = '8px Source Code Pro,monospace'; ctx.fillStyle = '#5a7080'; ctx.fillText('KM/H', cx, cy + 18);
        ctx.fillStyle = spd > lim ? '#e8321a' : '#4a7090'; ctx.fillText('LIM ' + lim, cx, cy + 28);
      }

      // -- MINIMAP ---------------------------------------------------
      function drawOverlay() {
        const ctx = oc.getContext('2d'), W = oc.width, H = oc.height;
        ctx.clearRect(0, 0, W, H);
        const MS = 132, mx = W - MS - 10, my = 10, sc = MS / 320;
        const ox = mx + MS / 2, oy = my + MS / 2;
        function wp(wx, wz) { return [ox + wx * sc, oy + wz * sc]; }
        ctx.fillStyle = 'rgba(5,10,20,.88)'; ctx.fillRect(mx, my, MS, MS);
        ctx.strokeStyle = 'rgba(245,196,0,.45)'; ctx.lineWidth = 1; ctx.strokeRect(mx, my, MS, MS);

        ctx.fillStyle = '#1e2228';
        const mhw = C.MAJ_W / 2;
        // EW major roads
        ctx.fillRect(mx, oy + (C.MAJ_UPPER_Z - mhw) * sc, MS, C.MAJ_W * sc);
        ctx.fillRect(mx, oy + (C.MAJ_LOWER_Z - mhw) * sc, MS, C.MAJ_W * sc);

        ctx.fillStyle = '#f5c400';
        ctx.fillRect(mx, oy + C.MAJ_MID_Z * sc - 1, MS, 2);

        // Minor roads
        ctx.fillStyle = '#252a32';
        // Top horizontal minor
        ctx.fillRect(mx, oy + (C.MIN_H_Z - C.MIN_W / 2) * sc, MS, C.MIN_W * sc);
        // Vertical minors
        ctx.fillRect(ox + (C.MIN_V1_X - C.MIN_W / 2) * sc, my, C.MIN_W * sc, MS);
        ctx.fillRect(ox + (C.MIN_V2_X - C.MIN_W / 2) * sc, my, C.MIN_W * sc, MS);
        // Parking
        ctx.fillRect(ox + C.MIN_V1_X * sc, oy + (C.PARK_Z - 4) * sc, (C.MIN_V2_X - C.MIN_V1_X) * sc, 8 * sc);

        // Roundabout
        ctx.beginPath(); ctx.arc(...wp(C.RDT_X, C.RDT_Z), C.RDT_OUTER * sc, 0, Math.PI * 2); ctx.fillStyle = '#1e2228'; ctx.fill();
        ctx.beginPath(); ctx.arc(...wp(C.RDT_X, C.RDT_Z), C.RDT_INNER * sc, 0, Math.PI * 2); ctx.fillStyle = '#1a4010'; ctx.fill();

        ctx.fillStyle = 'rgba(80,140,255,.35)';
        parkingZones.forEach(pz => {
          const [px2, py2] = wp(pz.x, pz.z);
          ctx.fillRect(px2 - pz.hw * sc, py2 - pz.hd * sc, pz.hw * 2 * sc, pz.hd * 2 * sc);
        });

        ctx.fillStyle = 'rgba(255,255,200,.6)';
        zebras.forEach(z => {
          const [zx, zy] = wp(z.cx, z.cz);
          if (z.axis === 'ew') ctx.fillRect(zx - z.roadW / 2 * sc, zy - 2, z.roadW * sc, 4);
          else ctx.fillRect(zx - 2, zy - z.roadW / 2 * sc, 4, z.roadW * sc);
        });

        if (destMarker) { const [dx, dy] = wp(destMarker.position.x, destMarker.position.z); ctx.beginPath(); ctx.arc(dx, dy, 4, 0, Math.PI * 2); ctx.fillStyle = '#00ff88'; ctx.fill(); }
        aiVehicles.forEach(v => { const [ax, ay] = wp(v.m.position.x, v.m.position.z); ctx.beginPath(); ctx.arc(ax, ay, 2, 0, Math.PI * 2); ctx.fillStyle = '#ff6644'; ctx.fill(); });
        peds.forEach(p => { const [px2, py2] = wp(p.m.position.x, p.m.position.z); ctx.beginPath(); ctx.arc(px2, py2, 2, 0, Math.PI * 2); ctx.fillStyle = p.onCrossing ? '#ff4444' : '#ffaaaa'; ctx.fill(); });
        if (playerCar) {
          const [px2, py2] = wp(playerCar.position.x, playerCar.position.z);
          ctx.beginPath(); ctx.arc(px2, py2, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#f5c400'; ctx.fill();
          const ha = ph.heading + Math.PI;
          ctx.beginPath(); ctx.moveTo(px2 + Math.sin(ha) * 10, py2 + Math.cos(ha) * 10);
          ctx.lineTo(px2 + Math.sin(ha + 2.5) * 5, py2 + Math.cos(ha + 2.5) * 5);
          ctx.lineTo(px2 + Math.sin(ha - 2.5) * 5, py2 + Math.cos(ha - 2.5) * 5);
          ctx.closePath(); ctx.fillStyle = '#f5c400'; ctx.fill();
        }
        ctx.fillStyle = 'rgba(245,196,0,.5)'; ctx.font = '7px monospace'; ctx.fillText('MINIMAP', mx + 4, my + 9);
      }

      // -- SCENARIOS -------------------------------------------------
      const SCENARIOS = [
        {
          name: 'Basic City Driving', rule: 'Rule 1: Shortest Route', diff: 'e', label: 'BASIC',
          speedLimit: 50, ai: 4, peds: 3, stallAfter: 0,
          destPos: new THREE.Vector3(C.MIN_V1_X, 0, C.PARK_Z), startPos: new THREE.Vector3(-80, .38, majLaneCentre(C.MAJ_UPPER_Z, 1)), startH: Math.PI / 2,
          desc: 'Follow major road east using correct lane discipline. Obey all traffic signals. Keep left always.',
          hints: ['Keep left at all times -- Lane 1 is the primary lane.',
            'Stop fully at red lights behind the stop line.',
            'Signal 30m before turning or changing lane.',
            'Use the shortest correct route to your destination.']
        },
        {
          name: 'Roundabout Navigation', rule: 'Lane Entry/Exit + Yield', diff: 'm', label: 'INTERMEDIATE',
          speedLimit: 50, ai: 8, peds: 2, stallAfter: 0,
          destPos: new THREE.Vector3(-75, .0, C.MAJ_UPPER_Z), startPos: new THREE.Vector3(-100, .38, majLaneCentre(C.MAJ_UPPER_Z, 1)), startH: Math.PI / 2,
          desc: 'Enter roundabout from correct lane. Lanes 1 & 2 use outer ring; Lanes 3 & 4 use inner ring. Yield on entry.',
          hints: ['Major L1/L2 -> outer roundabout lanes. L3/L4 -> inner lanes.',
            'Yield to all vehicles ALREADY in the roundabout.',
            'No lane changes inside the roundabout -- solid lines.',
            'Signal LEFT before your exit. Signal RIGHT on entry.']
        },
        {
          name: 'Lane Exit Mapping', rule: 'Subtraction & Addition Rules', diff: 'm', label: 'INTERMEDIATE',
          speedLimit: 50, ai: 5, peds: 2, stallAfter: 0,
          destPos: new THREE.Vector3(C.MIN_V1_X, .0, C.MIN_H_Z), startPos: new THREE.Vector3(-100, .38, majLaneCentre(C.MAJ_UPPER_Z, 2)), startH: Math.PI / 2,
          desc: 'Demonstrate subtraction rule (Major->Minor: lane-1) and addition rule (Minor->Major: lane+1).',
          hints: ['Subtraction: Maj L4->Min L3, Maj L3->Min L2, Maj L2->Min L1.',
            'Addition: Min L3->Maj L4, Min L2->Maj L3, Min L1->Maj L2.',
            'Lane 2 on major road: STRAIGHT ONLY -- never turn from it.',
            'Lane 4 major: right (90°), U-turn (180°), 270°, full circle.']
        },
        {
          name: 'Stop & Yield Signs', rule: 'Priority Sign Compliance', diff: 'm', label: 'INTERMEDIATE',
          speedLimit: 30, ai: 4, peds: 4, stallAfter: 0,
          destPos: new THREE.Vector3(C.MIN_V1_X, .0, C.MIN_H_Z), startPos: new THREE.Vector3(-50, .38, minLaneCentre(C.MIN_V1_X, 1)), startH: Math.PI / 2,
          desc: 'Navigate minor roads. Full 3-second stop at STOP signs. Yield correctly at GIVE WAY signs.',
          hints: ['STOP sign: reach 0 km/h and hold for 3 full seconds.',
            'YIELD: slow to near-stop, give way to major road traffic.',
            'Stop LINE is broad white transverse -- stop BEHIND it.',
            'Minor roads are TWO-WAY -- yellow centre line = wall.']
        },
        {
          name: 'Pedestrian Crossings', rule: 'Zebra Crossing Rules', diff: 'm', label: 'INTERMEDIATE',
          speedLimit: 30, ai: 4, peds: 6, stallAfter: 0,
          destPos: new THREE.Vector3(-60, .0, C.MAJ_UPPER_Z), startPos: new THREE.Vector3(C.MIN_V1_X + C.MIN_LW / 2, .38, C.PARK_Z + 10), startH: Math.PI,
          desc: 'Pedestrians cross ONLY on Red light. Even if light turns Green mid-cross -- wait until fully clear.',
          hints: ['3-metre rule: decelerate when ped enters your zone.',
            'Stop BEHIND stop line -- never on the stripes.',
            'Wait until pedestrian has FULLY crossed -- not just past your car.',
            'CRITICAL FAIL: vehicle on crossing while ped is present.',
            'No horn near any pedestrian crossing.']
        },
        {
          name: 'Parking Maneuvers', rule: 'Rule 3: Parking Last Resort', diff: 'm', label: 'INTERMEDIATE',
          speedLimit: 30, ai: 3, peds: 2, stallAfter: 0,
          destPos: new THREE.Vector3(10, .0, C.PARK_Z), startPos: new THREE.Vector3(0, .38, minLaneCentre(C.MIN_V1_X, 1)), startH: Math.PI / 2,
          desc: 'Angle: enter D (forward), exit R (reverse). Parallel: enter R (reverse), exit D (forward). Farthest bay first.',
          hints: ['Angle parking: FORWARD in (D gear), REVERSE out (R gear).',
            'Parallel: REVERSE in (R gear), FORWARD out (D gear).',
            'Park from FARTHEST bay first (farthest from exit).',
            'Maintain 1m from bay lines and other vehicles.',
            'Parking is LAST RESORT -- use direct route first.']
        },
        {
          name: 'Obstacle Route-Finding', rule: '3-Route Rule + Stall Avoidance', diff: 'h', label: 'HARD',
          speedLimit: 50, ai: 8, peds: 4, stallAfter: 12,
          destPos: new THREE.Vector3(-100, .0, majLaneCentre(C.MAJ_LOWER_Z, 2)), startPos: new THREE.Vector3(-80, .38, majLaneCentre(C.MAJ_UPPER_Z, 1)), startH: Math.PI / 2,
          desc: 'A vehicle will stall ahead. Find the next shortest correct route. Demonstrate all 3 route options.',
          hints: ['Route 1: Shortest. Route 2: Next shortest. Route 3: Longest (with parking).',
            'A stalled vehicle is NOT a reason to stop in the road.',
            'Signal correctly before changing route.',
            'Maintain Golden Rule distance from all vehicles at all times.']
        },
        {
          name: 'Full MTB Assessment', rule: 'All 3 Rules -- Complete Test', diff: 'h', label: 'EXPERT',
          speedLimit: 50, ai: 10, peds: 8, stallAfter: 30,
          destPos: new THREE.Vector3(C.MIN_V2_X, .0, C.PARK_Z), startPos: new THREE.Vector3(-80, .38, majLaneCentre(C.MAJ_UPPER_Z, 1)), startH: Math.PI / 2,
          desc: 'Complete NTSA Model Town Board assessment. All rules apply simultaneously. No reminders.',
          hints: ['All MTB rules apply. Subtraction/Addition rules enforced.',
            'Shortest route first, longest second, parking only as last resort.',
            'Every sign, signal, lane transition, and maneuver is scored.',
            'Good luck -- this is the full NTSA assessment.']
        },
      ];

      // -- SCENARIO UI -----------------------------------------------
      const scList = document.getElementById('sc-list');
      let selSc = 0;
      SCENARIOS.forEach((sc, i) => {
        const el = document.createElement('div');
        el.className = `sc-item${i === 0 ? ' active' : ''}`;
        el.innerHTML = `<div class="scn">${sc.name}</div><div class="scr">${sc.rule}</div><span class="scd d${sc.diff}">${sc.label}</span>`;
        el.addEventListener('click', () => {
          document.querySelectorAll('.sc-item').forEach(e => e.classList.remove('active'));
          el.classList.add('active'); selSc = i; updRoutePanel(sc);
        });
        scList.appendChild(el);
      });
      function updRoutePanel(sc) {
        document.getElementById('ri-s').textContent = `Start: ${sc.startPos.x.toFixed(0)}, ${sc.startPos.z.toFixed(0)}`;
        document.getElementById('ri-d').textContent = `Dest: ${sc.destPos.x.toFixed(0)}, ${sc.destPos.z.toFixed(0)}`;
        document.getElementById('ri-r').textContent = `Rule: ${sc.rule}`;
        document.getElementById('sc-badge').textContent = sc.name.toUpperCase();
      }
      updRoutePanel(SCENARIOS[0]);

      // Gear UI
      document.querySelectorAll('.gi').forEach(el => el.addEventListener('click', () => setGear(el.dataset.g)));
      // Control buttons
      function hookBtn(id, code) {
        const el = document.getElementById(id); if (!el) return;
        el.addEventListener('pointerdown', () => { keys[code] = true; el.classList.add('pressed'); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { keys[code] = false; el.classList.remove('pressed'); }));
      }
      hookBtn('ba', 'ArrowUp'); hookBtn('bd', 'ArrowDown'); hookBtn('bl', 'ArrowLeft'); hookBtn('br', 'ArrowRight'); hookBtn('bb', 'Space');
      document.getElementById('bsl').addEventListener('click', () => { sigL = !sigL; sigR = false; updSigUI(); });
      document.getElementById('bsr').addEventListener('click', () => { sigR = !sigR; sigL = false; updSigUI(); });
      document.getElementById('bhn').addEventListener('click', () => hornTrigger());
      document.getElementById('bc2').addEventListener('click', () => cycleCam());
      document.getElementById('bau').addEventListener('click', () => toggleAuto());

      function toggleAuto() {
        ph.auto = !ph.auto;
        document.getElementById('bau').classList.toggle('active', ph.auto);
        if (ph.auto) {
          logEvt('📡 Auto-Pilot Activated', true);
          if (ph.gear !== 'D') setGear('D');
        } else {
          logEvt('📡 Auto-Pilot Deactivated');
        }
      }

      // -- GAME STATE -------------------------------------------------
      let gameRunning = false, activeSc = null;
      document.getElementById('btn-start').addEventListener('click', startSc);
      document.getElementById('btn-reset').addEventListener('click', () => { if (activeSc) startSc(); });
      document.getElementById('btn-end').addEventListener('click', () => endSession(false));
      document.getElementById('res-retry').addEventListener('click', () => { document.getElementById('res-mod').style.display = 'none'; startSc(); });
      document.getElementById('res-menu').addEventListener('click', () => document.getElementById('res-mod').style.display = 'none');
      document.getElementById('topup-btn').addEventListener('click', () => {
        playerBalance += 500;
        updBalanceHUD();
        storageManager.saveBalance(playerBalance);
        document.getElementById('topup-mod').style.display = 'none';
      });

      let stallScheduled = 0; // game time to trigger next stall
      function startSc() {
        const sc = SCENARIOS[selSc]; activeSc = sc;
        score = 100; totalV = 0; sessTime = 0; distTrav = 0; sessionFb = [];
        Object.keys(cds).forEach(k => delete cds[k]);
        stopSigns.forEach(s => { s.stopHeld = 0; s.passed = false; });
        sigL = false; sigR = false; updSigUI();
        ph.speed = 0; ph.heading = sc.startH; ph.steer = 0; ph.gear = 'N'; setGear('N');
        prevRdtLane = -1; rdtEntryLane = -1; pedWarnActive = false; laneMapShown = '';
        lastMajorLane = 0; lastMinorLane = 0; rdtEntryMajLane = 0;

        buildWorld(sc);
        playerCar = buildPlayerCar();
        playerCar.position.copy(sc.startPos);
        playerCar.rotation.y = sc.startH;
        destMarker.position.copy(sc.destPos); destMarker.position.y = 0;

        spawnAI(sc.ai); spawnPeds(sc.peds);
        stallScheduled = sc.stallAfter > 0 ? sc.stallAfter : Infinity;

        document.getElementById('log-list').innerHTML = '';
        updTopBar(); updRoutePanel(sc);
        setAI(sc.hints[0]);
        gameRunning = true;
        logEvt('✓ Session started -- ' + sc.name, true);
      }

      function endSession(reached) {
        if (!gameRunning) return;
        gameRunning = false;
        if (reached) { logEvt('✓ Destination reached!', true); sessionFb.push({ msg: 'Destination reached', pass: true }); }
        if (totalV === 0) sessionFb.push({ msg: 'Zero violations -- perfect drive!', pass: true });
        const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';
        document.getElementById('res-t').textContent = reached && score >= 60 ? '✓ PASSED' : 'SESSION ENDED';
        document.getElementById('res-t').style.color = reached && score >= 60 ? '#1fc86b' : '#e8321a';
        document.getElementById('res-sub').textContent = (activeSc?.name || '') + '--Kenya MTB Assessment';
        document.getElementById('res-s').textContent = score;
        document.getElementById('res-v').textContent = totalV;
        document.getElementById('res-g').textContent = grade;
        document.getElementById('res-g').style.color = score >= 75 ? '#1fc86b' : score >= 60 ? '#f5c400' : '#e8321a';
        document.getElementById('res-fb').innerHTML = sessionFb.slice(-8).map(f => `<div class="mo-fi ${f.pass ? 'p' : 'f'}">${f.pass ? '✓' : '✗'} ${f.msg}</div>`).join('');
        document.getElementById('res-mod').style.display = 'flex';

        // Save Session to IndexedDB
        storageManager.saveSession({
          scenarioId: activeSc.name,
          score: score,
          grade: grade,
          violations: totalV,
          duration: sessTime
        });
        storageManager.saveBalance(playerBalance);
      }

      // -- DESTINATION PULSE -----------------------------------------
      let destT = 0;
      function tickDest(dt) {
        if (!destMarker) return;
        destT += dt;
        destMarker.children.forEach(c => { if (c.material) c.material.color.setHSL(.38, 1, .3 + .22 * Math.sin(destT * 3)); });
        destMarker.position.y = .1 * Math.sin(destT * 2);
      }

      // -- MAIN LOOP -------------------------------------------------
      let lastT = 0;
      function animate(now) {
        requestAnimationFrame(animate);
        const dt = Math.min((now - lastT) / 1000, .05); lastT = now;
        if (gameRunning && activeSc) {
          sessTime += dt;
          if (sessTime >= stallScheduled && stallScheduled < Infinity) {
            triggerRandomStall(); stallScheduled = Infinity;
          }
          physicsStep(dt, activeSc);
          updateAI(dt);
          updateStalls(dt);
          updatePeds(dt);
          updateTLights(dt);
          checkViolations(dt, activeSc);
          tickDest(dt);
          tickHints(dt);
          updSignHUD();
          const spd = Math.abs(ph.speed) * 3.6;
          drawSpd(spd, activeSc.speedLimit);
          updTopBar();
          updLaneMap(detectLane().roadType, detectLane().lane);
        }
        updateCam(dt);
        drawOverlay();
        renderer.render(scene, cam);
      }
      // Static preview
      buildWorld(SCENARIOS[0]);
      cam.position.set(-20, 60, 20); cam.lookAt(0, 0, 0);

      let lastSaveBal = 0;

      // Initialize Managers
      let touchManager = null;
      document.addEventListener('DOMContentLoaded', () => {
        touchManager = new TouchInputManager();
        storageManager.init().then(async () => {
          playerBalance = await storageManager.loadBalance();
          updBalanceHUD();
          console.log("Storage System initialized. Initial balance:", playerBalance);
        }).catch(e => console.error("Storage init failed", e));
      });

      requestAnimationFrame(ts => { lastT = ts; animate(ts); });
    })();
