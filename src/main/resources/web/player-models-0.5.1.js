(() => {
    "use strict";

    if (window.__bmpmPaperLoaded) return;
    window.__bmpmPaperLoaded = true;

    const POLL_MS = 1000;
    const HIDE_NATIVE_MARKER_DISTANCE = 35;
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

        console.info("[BlueMap3DPlayerModelsPaper] v0.5.1 renderer loaded");

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
            const response = await fetch(
                `${liveRoot}/live/players.json?bmpm=${Date.now()}`,
                { cache: "no-store" }
            );

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
                    loadCape(actor, player.uuid);
                }

                actor.name = player.name || player.uuid;
                actor.target.set(
                    player.position.x,
                    player.position.y,
                    player.position.z
                );

                actor.targetYaw = degreesToRadians(
                    -(Number(player.rotation?.yaw) || 0)
                );

                actor.targetPitch = degreesToRadians(
                    Number(player.rotation?.pitch) || 0
                );
            }

            for (const [uuid, actor] of MODELS) {
                if (!incoming.has(uuid)) {
                    restoreNativeMarker(actor);
                    sceneRoot.remove(actor.root);
                    disposeActor(actor);
                    MODELS.delete(uuid);
                }
            }

            app.mapViewer.redraw();
        } catch (error) {
            console.debug(
                "[BlueMap3DPlayerModelsPaper] player update failed",
                error
            );
        }
    }

    function createActor(player) {
        const root = new Three.Group();
        root.name = `bmpm-player-${player.uuid}`;

        const bodyRoot = new Three.Group();
        root.add(bodyRoot);

        const placeholder = new Three.MeshBasicMaterial({ color: 0x777777 });
        const transparentPlaceholder = new Three.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0
        });

        const headPivot = new Three.Group();
        headPivot.position.set(0, 1.625, 0);
        bodyRoot.add(headPivot);

        const head = new Three.Mesh(
            new Three.BoxGeometry(0.5, 0.5, 0.5),
            placeholder
        );
        headPivot.add(head);

        // Hat layer is 9x9x9 pixels around the normal 8x8x8 head.
        const headOuter = new Three.Mesh(
            new Three.BoxGeometry(0.5625, 0.5625, 0.5625),
            transparentPlaceholder
        );
        headPivot.add(headOuter);

        const body = new Three.Mesh(
            new Three.BoxGeometry(0.5, 0.75, 0.25),
            placeholder
        );
        body.position.y = 1.0;
        bodyRoot.add(body);

        const bodyOuter = new Three.Mesh(
            new Three.BoxGeometry(0.53125, 0.78125, 0.28125),
            transparentPlaceholder
        );
        bodyOuter.position.copy(body.position);
        bodyRoot.add(bodyOuter);

        const rightArm = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        rightArm.position.set(-0.375, 1.0, 0);
        bodyRoot.add(rightArm);

        const rightArmOuter = new Three.Mesh(
            new Three.BoxGeometry(0.28125, 0.78125, 0.28125),
            transparentPlaceholder
        );
        rightArmOuter.position.copy(rightArm.position);
        bodyRoot.add(rightArmOuter);

        const leftArm = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        leftArm.position.set(0.375, 1.0, 0);
        bodyRoot.add(leftArm);

        const leftArmOuter = new Three.Mesh(
            new Three.BoxGeometry(0.28125, 0.78125, 0.28125),
            transparentPlaceholder
        );
        leftArmOuter.position.copy(leftArm.position);
        bodyRoot.add(leftArmOuter);

        const rightLeg = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        rightLeg.position.set(-0.125, 0.375, 0);
        bodyRoot.add(rightLeg);

        const rightLegOuter = new Three.Mesh(
            new Three.BoxGeometry(0.28125, 0.78125, 0.28125),
            transparentPlaceholder
        );
        rightLegOuter.position.copy(rightLeg.position);
        bodyRoot.add(rightLegOuter);

        const leftLeg = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        leftLeg.position.set(0.125, 0.375, 0);
        bodyRoot.add(leftLeg);

        const leftLegOuter = new Three.Mesh(
            new Three.BoxGeometry(0.28125, 0.78125, 0.28125),
            transparentPlaceholder
        );
        leftLegOuter.position.copy(leftLeg.position);
        bodyRoot.add(leftLegOuter);

        // Pivot the cape at the shoulders so its slight backward tilt looks natural.
        const capePivot = new Three.Group();
        capePivot.position.set(0, 1.375, -0.145);
        capePivot.rotation.x = 0.10;
        bodyRoot.add(capePivot);

        const cape = new Three.Mesh(
            new Three.BoxGeometry(0.625, 1.0, 0.0625),
            transparentPlaceholder
        );
        cape.position.set(0, -0.5, -0.035);
        cape.visible = false;
        capePivot.add(cape);

        root.position.set(
            player.position.x,
            player.position.y,
            player.position.z
        );

        return {
            uuid: player.uuid,
            root,
            bodyRoot,
            headPivot,
            head,
            headOuter,
            body,
            bodyOuter,
            rightArm,
            rightArmOuter,
            leftArm,
            leftArmOuter,
            rightLeg,
            rightLegOuter,
            leftLeg,
            leftLegOuter,
            capePivot,
            cape,
            target: new Three.Vector3(
                player.position.x,
                player.position.y,
                player.position.z
            ),
            targetYaw: degreesToRadians(
                -(Number(player.rotation?.yaw) || 0)
            ),
            targetPitch: degreesToRadians(
                Number(player.rotation?.pitch) || 0
            ),
            materials: [],
            nativeMarkerHidden: false
        };
    }

    function loadSkin(actor, uuid) {
        const url = new URL(`skins/${uuid}.png`, addonRoot).href + `?v=${Date.now()}`;

        new Three.TextureLoader().load(
            url,
            texture => {
                const image = texture.image;
                const isLegacy = image?.width === 64 && image?.height === 32;
                const isModern = image?.width === 64 && image?.height === 64;

                if (!isLegacy && !isModern) {
                    console.warn(
                        `[BlueMap3DPlayerModelsPaper] unsupported skin size for ${uuid}: ` +
                        `${image?.width}x${image?.height}`
                    );
                    texture.dispose();
                    return;
                }

                prepareTexture(texture);

                // Base skin layer.
                setSkinUVs(actor.head.geometry, 0, 0, 8, 8, 8, false, image.height);
                setSkinUVs(actor.body.geometry, 16, 16, 8, 12, 4, false, image.height);
                setSkinUVs(actor.rightArm.geometry, 40, 16, 4, 12, 4, false, image.height);
                setSkinUVs(actor.rightLeg.geometry, 0, 16, 4, 12, 4, false, image.height);

                if (isLegacy) {
                    setSkinUVs(actor.leftArm.geometry, 40, 16, 4, 12, 4, true, image.height);
                    setSkinUVs(actor.leftLeg.geometry, 0, 16, 4, 12, 4, true, image.height);
                } else {
                    setSkinUVs(actor.leftArm.geometry, 32, 48, 4, 12, 4, false, image.height);
                    setSkinUVs(actor.leftLeg.geometry, 16, 48, 4, 12, 4, false, image.height);
                }

                const baseMaterial = new Three.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    alphaTest: 0.1
                });

                actor.materials.push(baseMaterial);
                for (const mesh of [
                    actor.head,
                    actor.body,
                    actor.rightArm,
                    actor.leftArm,
                    actor.rightLeg,
                    actor.leftLeg
                ]) {
                    mesh.material = baseMaterial;
                }

                // Hat layer exists on both classic 64x32 and modern 64x64 skins.
                setSkinUVs(actor.headOuter.geometry, 32, 0, 8, 8, 8, false, image.height);

                const outerMaterial = new Three.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    alphaTest: 0.01,
                    depthWrite: true
                });

                actor.materials.push(outerMaterial);
                actor.headOuter.material = outerMaterial;
                actor.headOuter.visible = true;

                if (isModern) {
                    // Modern second layer: jacket, sleeves and trouser overlays.
                    setSkinUVs(actor.bodyOuter.geometry, 16, 32, 8, 12, 4, false, 64);
                    setSkinUVs(actor.rightArmOuter.geometry, 40, 32, 4, 12, 4, false, 64);
                    setSkinUVs(actor.leftArmOuter.geometry, 48, 48, 4, 12, 4, false, 64);
                    setSkinUVs(actor.rightLegOuter.geometry, 0, 32, 4, 12, 4, false, 64);
                    setSkinUVs(actor.leftLegOuter.geometry, 0, 48, 4, 12, 4, false, 64);

                    for (const mesh of [
                        actor.bodyOuter,
                        actor.rightArmOuter,
                        actor.leftArmOuter,
                        actor.rightLegOuter,
                        actor.leftLegOuter
                    ]) {
                        mesh.material = outerMaterial;
                        mesh.visible = true;
                    }
                } else {
                    // Legacy skins only have the classic hat overlay.
                    for (const mesh of [
                        actor.bodyOuter,
                        actor.rightArmOuter,
                        actor.leftArmOuter,
                        actor.rightLegOuter,
                        actor.leftLegOuter
                    ]) {
                        mesh.visible = false;
                    }

                    console.info(
                        `[BlueMap3DPlayerModelsPaper] legacy 64x32 skin detected for ${uuid}`
                    );
                }

                app.mapViewer.redraw();
            },
            undefined,
            () => {
                console.debug(`[BlueMap3DPlayerModelsPaper] skin not ready for ${uuid}: ${url}`);
            }
        );
    }

    function loadCape(actor, uuid) {
        const url = new URL(`capes/${uuid}.png`, addonRoot).href + `?v=${Date.now()}`;

        new Three.TextureLoader().load(
            url,
            texture => {
                const image = texture.image;
                if (!image?.width || !image?.height) {
                    texture.dispose();
                    return;
                }

                prepareTexture(texture);

                // Mojang's canonical cape UV layout is 10x16x1 in a 64x32 canvas.
                // Scaled official cape images preserve those normalized coordinates.
                setCuboidUVs(actor.cape.geometry, 0, 0, 10, 16, 1, 64, 32);

                const capeMaterial = new Three.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    alphaTest: 0.01,
                    side: Three.DoubleSide
                });

                actor.materials.push(capeMaterial);
                actor.cape.material = capeMaterial;
                actor.cape.visible = true;

                console.info(`[BlueMap3DPlayerModelsPaper] cape loaded for ${uuid}`);
                app.mapViewer.redraw();
            },
            undefined,
            () => {
                // Most players simply do not have a cape, so 404 is normal and silent.
                actor.cape.visible = false;
            }
        );
    }

    function prepareTexture(texture) {
        texture.magFilter = Three.NearestFilter;
        texture.minFilter = Three.NearestFilter;
        texture.generateMipmaps = false;

        if (Three.SRGBColorSpace) {
            texture.colorSpace = Three.SRGBColorSpace;
        } else if (Three.sRGBEncoding) {
            texture.encoding = Three.sRGBEncoding;
        }

        texture.needsUpdate = true;
    }

    function setSkinUVs(
        geometry,
        x,
        y,
        width,
        height,
        depth,
        mirror = false,
        textureHeight = 64
    ) {
        let regions = [
            [x + depth + width, y + depth, depth, height],
            [x, y + depth, depth, height],
            [x + depth, y, width, depth],
            [x + depth + width, y, width, depth],
            [x + depth, y + depth, width, height],
            [x + depth * 2 + width, y + depth, width, height]
        ];

        if (mirror) {
            [regions[0], regions[1]] = [regions[1], regions[0]];
        }

        const uv = geometry.attributes.uv;

        regions.forEach(([rx, ry, rw, rh], face) => {
            const uLeft = rx / 64;
            const uRight = (rx + rw) / 64;
            const vTop = 1 - ry / textureHeight;
            const vBottom = 1 - (ry + rh) / textureHeight;
            const index = face * 4;

            const left = mirror ? uRight : uLeft;
            const right = mirror ? uLeft : uRight;

            uv.setXY(index, left, vTop);
            uv.setXY(index + 1, right, vTop);
            uv.setXY(index + 2, left, vBottom);
            uv.setXY(index + 3, right, vBottom);
        });

        uv.needsUpdate = true;
    }

    function setCuboidUVs(
        geometry,
        x,
        y,
        width,
        height,
        depth,
        textureWidth,
        textureHeight
    ) {
        const regions = [
            [x + depth + width, y + depth, depth, height],
            [x, y + depth, depth, height],
            [x + depth, y, width, depth],
            [x + depth + width, y, width, depth],
            [x + depth, y + depth, width, height],
            [x + depth * 2 + width, y + depth, width, height]
        ];

        const uv = geometry.attributes.uv;

        regions.forEach(([rx, ry, rw, rh], face) => {
            const left = rx / textureWidth;
            const right = (rx + rw) / textureWidth;
            const top = 1 - ry / textureHeight;
            const bottom = 1 - (ry + rh) / textureHeight;
            const index = face * 4;

            uv.setXY(index, left, top);
            uv.setXY(index + 1, right, top);
            uv.setXY(index + 2, left, bottom);
            uv.setXY(index + 3, right, bottom);
        });

        uv.needsUpdate = true;
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!app || !sceneRoot) return;

        let changed = false;

        for (const actor of MODELS.values()) {
            actor.root.position.lerp(actor.target, 0.28);

            actor.bodyRoot.rotation.y = lerpAngle(
                actor.bodyRoot.rotation.y,
                actor.targetYaw,
                0.32
            );

            actor.headPivot.rotation.x += (
                actor.targetPitch - actor.headPivot.rotation.x
            ) * 0.32;

            updateNativeMarkerVisibility(actor);
            changed = true;
        }

        if (changed) app.mapViewer.redraw();
    }

    function updateNativeMarkerVisibility(actor) {
        const manager = app?.playerMarkerManager;
        const camera = app?.mapViewer?.camera;
        if (!manager || !camera?.position) return;

        const marker = manager.getPlayerMarker?.(actor.uuid);
        if (!marker) return;

        const distance = camera.position.distanceTo(actor.root.position);
        const shouldHide = distance < HIDE_NATIVE_MARKER_DISTANCE;

        if (actor.nativeMarkerHidden === shouldHide) return;
        actor.nativeMarkerHidden = shouldHide;

        // Keep the icon in layout so the native name keeps its normal spacing.
        if (marker.element) {
            const head = marker.element.querySelector("img");
            if (head) head.style.opacity = shouldHide ? "0" : "1";
        }
    }

    function restoreNativeMarker(actor) {
        if (!app?.playerMarkerManager) return;

        const marker = app.playerMarkerManager.getPlayerMarker?.(actor.uuid);
        if (!marker) return;

        if (marker.element) {
            const head = marker.element.querySelector("img");
            if (head) head.style.opacity = "1";
        }

        actor.nativeMarkerHidden = false;
    }

    function clearModels() {
        if (!sceneRoot) return;

        for (const actor of MODELS.values()) {
            restoreNativeMarker(actor);
            sceneRoot.remove(actor.root);
            disposeActor(actor);
        }

        MODELS.clear();
    }

    function disposeActor(actor) {
        const meshes = [
            actor.head,
            actor.headOuter,
            actor.body,
            actor.bodyOuter,
            actor.rightArm,
            actor.rightArmOuter,
            actor.leftArm,
            actor.leftArmOuter,
            actor.rightLeg,
            actor.rightLegOuter,
            actor.leftLeg,
            actor.leftLegOuter,
            actor.cape
        ];

        for (const mesh of meshes) {
            mesh?.geometry?.dispose?.();
        }

        const textures = new Set();
        for (const material of actor.materials) {
            if (material.map) textures.add(material.map);
            material.dispose?.();
        }
        for (const texture of textures) texture.dispose?.();
    }

    function degreesToRadians(value) {
        return value * Math.PI / 180;
    }

    function lerpAngle(from, to, amount) {
        let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
        return from + delta * amount;
    }

    waitForBlueMap();
})();
