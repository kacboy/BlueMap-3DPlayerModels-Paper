(() => {
  "use strict";
  if (window.__bmpmPaperLoaded) return;
  window.__bmpmPaperLoaded = true;

  const POLL_MS = 1000;
  const MODELS = new Map();
  let activeMapId = null;
  let sceneRoot = null;
  let app = null;
  let Three = null;
  let addonRoot = null;

  const waitForBlueMap = () => {
    if (!window.bluemap?.mapViewer || !window.BlueMap?.Three) {
      requestAnimationFrame(waitForBlueMap);
      return;
    }

    app = window.bluemap;
    Three = window.BlueMap.Three;
    addonRoot = new URL(".", document.currentScript?.src || document.baseURI);
    sceneRoot = new Three.Group();
    sceneRoot.name = "bluemap-paper-player-models";
    app.mapViewer.markers.add(sceneRoot);
    console.info("[BlueMapPlayerModelsPaper] 3D player renderer loaded");

    setInterval(syncPlayers, POLL_MS);
    animate();
    syncPlayers();
  };

  async function syncPlayers() {
    const map = app?.mapViewer?.map;
    if (!map?.data) return;

    const mapId = map.data.id;
    if (activeMapId !== mapId) {
      clearModels();
      activeMapId = mapId;
    }

    const liveRoot = map.data.liveDataRoot;
    if (!liveRoot) return;

    try {
      const response = await fetch(`${liveRoot}/live/players.json?bmpm=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const incoming = new Set();

      for (const player of payload.players || []) {
        if (!player?.uuid || !player?.position) continue;
        incoming.add(player.uuid);
        let actor = MODELS.get(player.uuid);
        if (!actor) {
          actor = createActor(player);
          MODELS.set(player.uuid, actor);
          sceneRoot.add(actor.root);
          loadSkin(actor, player.uuid);
        }

        actor.name = player.name || player.uuid;
        actor.target.set(player.position.x, player.position.y, player.position.z);
        actor.targetYaw = degreesToRadians(-(Number(player.rotation?.yaw) || 0));
        actor.targetPitch = degreesToRadians(Number(player.rotation?.pitch) || 0);
      }

      for (const [uuid, actor] of MODELS) {
        if (!incoming.has(uuid)) {
          sceneRoot.remove(actor.root);
          disposeActor(actor);
          MODELS.delete(uuid);
        }
      }
      app.mapViewer.redraw();
    } catch (error) {
      console.debug("[BlueMapPlayerModelsPaper] player update failed", error);
    }
  }

  function createActor(player) {
    const root = new Three.Group();
    root.name = `bmpm-player-${player.uuid}`;

    const bodyRoot = new Three.Group();
    root.add(bodyRoot);

    const placeholder = new Three.MeshBasicMaterial({ color: 0x777777 });
    const headPivot = new Three.Group();
    headPivot.position.set(0, 1.625, 0);
    bodyRoot.add(headPivot);

    const head = new Three.Mesh(new Three.BoxGeometry(0.5, 0.5, 0.5), placeholder);
    head.position.y = 0;
    headPivot.add(head);

    const body = new Three.Mesh(new Three.BoxGeometry(0.5, 0.75, 0.25), placeholder);
    body.position.y = 1.0;
    bodyRoot.add(body);

    const rightArm = new Three.Mesh(new Three.BoxGeometry(0.25, 0.75, 0.25), placeholder);
    rightArm.position.set(-0.375, 1.0, 0);
    bodyRoot.add(rightArm);

    const leftArm = new Three.Mesh(new Three.BoxGeometry(0.25, 0.75, 0.25), placeholder);
    leftArm.position.set(0.375, 1.0, 0);
    bodyRoot.add(leftArm);

    const rightLeg = new Three.Mesh(new Three.BoxGeometry(0.25, 0.75, 0.25), placeholder);
    rightLeg.position.set(-0.125, 0.375, 0);
    bodyRoot.add(rightLeg);

    const leftLeg = new Three.Mesh(new Three.BoxGeometry(0.25, 0.75, 0.25), placeholder);
    leftLeg.position.set(0.125, 0.375, 0);
    bodyRoot.add(leftLeg);

    // BlueMap player coordinates represent the player's feet.
    root.position.set(player.position.x, player.position.y, player.position.z);

    return {
      root, bodyRoot, headPivot, head, body, rightArm, leftArm, rightLeg, leftLeg,
      target: new Three.Vector3(player.position.x, player.position.y, player.position.z),
      targetYaw: degreesToRadians(-(Number(player.rotation?.yaw) || 0)),
      targetPitch: degreesToRadians(Number(player.rotation?.pitch) || 0),
      materials: []
    };
  }

  async function loadSkin(actor, uuid) {
    const url = new URL(`skins/${uuid}.png`, addonRoot).href + `?v=${Date.now()}`;
    new Three.TextureLoader().load(url, texture => {
      texture.magFilter = Three.NearestFilter;
      texture.minFilter = Three.NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      if (Three.SRGBColorSpace) texture.colorSpace = Three.SRGBColorSpace;
      else if (Three.sRGBEncoding) texture.encoding = Three.sRGBEncoding;
      texture.needsUpdate = true;

      setPartMaterials(actor, actor.head, texture, partFaces.head);
      setPartMaterials(actor, actor.body, texture, partFaces.body);
      setPartMaterials(actor, actor.rightArm, texture, partFaces.rightArm);
      setPartMaterials(actor, actor.leftArm, texture, partFaces.leftArm);
      setPartMaterials(actor, actor.rightLeg, texture, partFaces.rightLeg);
      setPartMaterials(actor, actor.leftLeg, texture, partFaces.leftLeg);
      app.mapViewer.redraw();
    }, undefined, () => {
      console.debug(`[BlueMapPlayerModelsPaper] skin not ready for ${uuid}: ${url}`);
    });
  }

  // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
  // Region format is [x, y, width, height] in the 64x64 Minecraft skin.
  const partFaces = {
    head: [ [0,8,8,8], [16,8,8,8], [8,0,8,8], [16,0,8,8], [8,8,8,8], [24,8,8,8] ],
    body: [ [16,20,4,12], [28,20,4,12], [20,16,8,4], [28,16,8,4], [20,20,8,12], [32,20,8,12] ],
    rightArm: [ [40,20,4,12], [48,20,4,12], [44,16,4,4], [48,16,4,4], [44,20,4,12], [52,20,4,12] ],
    leftArm: [ [32,52,4,12], [40,52,4,12], [36,48,4,4], [40,48,4,4], [36,52,4,12], [44,52,4,12] ],
    rightLeg: [ [0,20,4,12], [8,20,4,12], [4,16,4,4], [8,16,4,4], [4,20,4,12], [12,20,4,12] ],
    leftLeg: [ [16,52,4,12], [24,52,4,12], [20,48,4,4], [24,48,4,4], [20,52,4,12], [28,52,4,12] ]
  };

  function setPartMaterials(actor, mesh, sourceTexture, regions) {
    const materials = regions.map(region => materialForRegion(sourceTexture, region));
    actor.materials.push(...materials);
    mesh.material = materials;
  }

  function materialForRegion(source, [x, y, w, h]) {
    const texture = source.clone();
    texture.needsUpdate = true;
    texture.wrapS = Three.ClampToEdgeWrapping;
    texture.wrapT = Three.ClampToEdgeWrapping;
    texture.repeat.set(w / 64, h / 64);
    texture.offset.set(x / 64, 1 - ((y + h) / 64));
    return new Three.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1 });
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!app || !sceneRoot) return;
    let changed = false;

    for (const actor of MODELS.values()) {
      actor.root.position.lerp(actor.target, 0.28);
      actor.bodyRoot.rotation.y = lerpAngle(actor.bodyRoot.rotation.y, actor.targetYaw, 0.32);
      actor.headPivot.rotation.x += (actor.targetPitch - actor.headPivot.rotation.x) * 0.32;
      changed = true;
    }

    if (changed) app.mapViewer.redraw();
  }

  function clearModels() {
    if (!sceneRoot) return;
    for (const actor of MODELS.values()) {
      sceneRoot.remove(actor.root);
      disposeActor(actor);
    }
    MODELS.clear();
  }

  function disposeActor(actor) {
    [actor.head, actor.body, actor.rightArm, actor.leftArm, actor.rightLeg, actor.leftLeg].forEach(mesh => {
      mesh.geometry?.dispose?.();
    });
    actor.materials.forEach(material => {
      material.map?.dispose?.();
      material.dispose?.();
    });
  }

  function degreesToRadians(value) { return value * Math.PI / 180; }
  function lerpAngle(from, to, amount) {
    let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
    return from + delta * amount;
  }

  waitForBlueMap();
})();
