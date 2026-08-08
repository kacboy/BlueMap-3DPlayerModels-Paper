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
  let lastBlueMapMarkerRepair = 0;

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
      let missingBlueMapMarker = false;

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

        // Keep BlueMap's native player marker (head icon + name label) alive.
        // We never replace it; if BlueMap has not created it yet after a map
        // change/reload, ask its own PlayerMarkerManager to refresh.
        const nativeMarker = app.playerMarkerManager?.getPlayerMarker?.(player.uuid);
        if (!nativeMarker) missingBlueMapMarker = true;
      }

      for (const [uuid, actor] of MODELS) {
        if (!incoming.has(uuid)) {
          sceneRoot.remove(actor.root);
          disposeActor(actor);
          MODELS.delete(uuid);
        }
      }
      if (missingBlueMapMarker) repairBlueMapPlayerMarkers();
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

      // Use the exact Minecraft cuboid UV layout used by skinview3d instead of
      // cropping six separate textures. Three.js rotates BoxGeometry faces in
      // different directions, so texture offset/repeat alone misaligns skins.
      setSkinUVs(actor.head.geometry, 0, 0, 8, 8, 8);
      setSkinUVs(actor.body.geometry, 16, 16, 8, 12, 4);
      setSkinUVs(actor.rightArm.geometry, 40, 16, 4, 12, 4);
      setSkinUVs(actor.leftArm.geometry, 32, 48, 4, 12, 4);
      setSkinUVs(actor.rightLeg.geometry, 0, 16, 4, 12, 4);
      setSkinUVs(actor.leftLeg.geometry, 16, 48, 4, 12, 4);

      const skinMaterial = new Three.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1
      });
      actor.materials.push(skinMaterial);

      actor.head.material = skinMaterial;
      actor.body.material = skinMaterial;
      actor.rightArm.material = skinMaterial;
      actor.leftArm.material = skinMaterial;
      actor.rightLeg.material = skinMaterial;
      actor.leftLeg.material = skinMaterial;
      app.mapViewer.redraw();
    }, undefined, () => {
      console.debug(`[BlueMapPlayerModelsPaper] skin not ready for ${uuid}: ${url}`);
    });
  }

  // This is the same cuboid UV convention used by skinview3d for Minecraft
  // skins. BoxGeometry UV vertex order is +X, -X, +Y, -Y, +Z, -Z.
  function setSkinUVs(box, u, v, width, height, depth) {
    const toFaceVertices = (x1, y1, x2, y2) => [
      [x1 / 64, 1 - y2 / 64],
      [x2 / 64, 1 - y2 / 64],
      [x2 / 64, 1 - y1 / 64],
      [x1 / 64, 1 - y1 / 64]
    ];

    const top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
    const bottom = toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth);
    const left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
    const front = toFaceVertices(u + depth, v + depth, u + width + depth, v + depth + height);
    const right = toFaceVertices(u + width + depth, v + depth, u + width + depth * 2, v + height + depth);
    const back = toFaceVertices(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + height + depth);

    const ordered = [
      [right[3], right[2], right[0], right[1]],
      [left[3], left[2], left[0], left[1]],
      [top[3], top[2], top[0], top[1]],
      [bottom[0], bottom[1], bottom[3], bottom[2]],
      [front[3], front[2], front[0], front[1]],
      [back[3], back[2], back[0], back[1]]
    ];

    const uv = box.attributes.uv;
    let i = 0;
    for (const face of ordered) {
      for (const [x, y] of face) {
        uv.setXY(i++, x, y);
      }
    }
    uv.needsUpdate = true;
  }

  function repairBlueMapPlayerMarkers() {
    const now = Date.now();
    if (now - lastBlueMapMarkerRepair < 3000) return;
    const manager = app.playerMarkerManager;
    if (!manager?.update) return;
    lastBlueMapMarkerRepair = now;
    Promise.resolve(manager.update()).catch(error => {
      console.debug("[BlueMapPlayerModelsPaper] native BlueMap marker refresh failed", error);
    });
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
