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

        console.info("[BlueMapPlayerModelsPaper] v0.4.3 renderer loaded");

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
                "[BlueMapPlayerModelsPaper] player update failed",
                error
            );
        }
    }

    function createActor(player) {
        const root = new Three.Group();
        root.name = `bmpm-player-${player.uuid}`;

        const bodyRoot = new Three.Group();
        root.add(bodyRoot);

        const placeholder = new Three.MeshBasicMaterial({
            color: 0x777777
        });

        const headPivot = new Three.Group();
        headPivot.position.set(0, 1.625, 0);
        bodyRoot.add(headPivot);

        const head = new Three.Mesh(
            new Three.BoxGeometry(0.5, 0.5, 0.5),
            placeholder
        );
        headPivot.add(head);

        const body = new Three.Mesh(
            new Three.BoxGeometry(0.5, 0.75, 0.25),
            placeholder
        );
        body.position.y = 1.0;
        bodyRoot.add(body);

        const rightArm = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        rightArm.position.set(-0.375, 1.0, 0);
        bodyRoot.add(rightArm);

        const leftArm = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        leftArm.position.set(0.375, 1.0, 0);
        bodyRoot.add(leftArm);

        const rightLeg = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        rightLeg.position.set(-0.125, 0.375, 0);
        bodyRoot.add(rightLeg);

        const leftLeg = new Three.Mesh(
            new Three.BoxGeometry(0.25, 0.75, 0.25),
            placeholder
        );
        leftLeg.position.set(0.125, 0.375, 0);
        bodyRoot.add(leftLeg);

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
            body,
            rightArm,
            leftArm,
            rightLeg,
            leftLeg,
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

    async function loadSkin(actor, uuid) {
        const url =
            new URL(`skins/${uuid}.png`, addonRoot).href +
            `?v=${Date.now()}`;

        new Three.TextureLoader().load(
            url,
            texture => {
                const image = texture.image;
                const isLegacy = image?.width === 64 && image?.height === 32;
                const isModern = image?.width === 64 && image?.height === 64;

                if (!isLegacy && !isModern) {
                    console.warn(
                        `[BlueMapPlayerModelsPaper] unsupported skin size for ${uuid}: ` +
                        `${image?.width}x${image?.height}`
                    );
                    texture.dispose();
                    return;
                }

                texture.magFilter = Three.NearestFilter;
                texture.minFilter = Three.NearestFilter;
                texture.generateMipmaps = false;

                if (Three.SRGBColorSpace) {
                    texture.colorSpace = Three.SRGBColorSpace;
                } else if (Three.sRGBEncoding) {
                    texture.encoding = Three.sRGBEncoding;
                }

                texture.needsUpdate = true;

                // Head/body/right limbs exist in both skin formats.
                setSkinUVs(actor.head.geometry, 0, 0, 8, 8, 8, false, image.height);
                setSkinUVs(actor.body.geometry, 16, 16, 8, 12, 4, false, image.height);
                setSkinUVs(actor.rightArm.geometry, 40, 16, 4, 12, 4, false, image.height);
                setSkinUVs(actor.rightLeg.geometry, 0, 16, 4, 12, 4, false, image.height);

                if (isLegacy) {
                    // 64x32 skins have no separate left-arm/left-leg pixels.
                    // Old Minecraft mirrored the right limbs onto the left side.
                    setSkinUVs(actor.leftArm.geometry, 40, 16, 4, 12, 4, true, image.height);
                    setSkinUVs(actor.leftLeg.geometry, 0, 16, 4, 12, 4, true, image.height);

                    console.info(
                        `[BlueMapPlayerModelsPaper] legacy 64x32 skin detected for ${uuid}`
                    );
                } else {
                    setSkinUVs(actor.leftArm.geometry, 32, 48, 4, 12, 4, false, image.height);
                    setSkinUVs(actor.leftLeg.geometry, 16, 48, 4, 12, 4, false, image.height);
                }

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
            },
            undefined,
            () => {
                console.debug(
                    `[BlueMapPlayerModelsPaper] skin not ready for ${uuid}: ${url}`
                );
            }
        );
    }

    /*
     * Minecraft cuboid UV mapping.
     *
     * textureHeight is 32 for legacy skins and 64 for modern skins.
     * mirror=true is used for the left arm/leg on 64x32 skins, because
     * classic skins reuse the right-limb artwork for the opposite limb.
     */
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
            [x + depth + width, y + depth, depth, height],    // right
            [x, y + depth, depth, height],                    // left
            [x + depth, y, width, depth],                     // top
            [x + depth + width, y, width, depth],             // bottom
            [x + depth, y + depth, width, height],            // front
            [x + depth * 2 + width, y + depth, width, height] // back
        ];

        // Mirrored legacy limb: swap the two side-face sources.
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

            uv.setXY(index,     left,  vTop);
            uv.setXY(index + 1, right, vTop);
            uv.setXY(index + 2, left,  vBottom);
            uv.setXY(index + 3, right, vBottom);
        });

        uv.needsUpdate = true;
    }

    function animate() {
        requestAnimationFrame(animate);

        if (!app || !sceneRoot) return;

        let changed = false;

        for (const actor of MODELS.values()) {
            actor.root.position.lerp(actor.target, 0.28);

            actor.bodyRoot.rotation.y =
                lerpAngle(
                    actor.bodyRoot.rotation.y,
                    actor.targetYaw,
                    0.32
                );

            actor.headPivot.rotation.x +=
                (
                    actor.targetPitch -
                    actor.headPivot.rotation.x
                ) * 0.32;

            updateNativeMarkerVisibility(actor);
            changed = true;
        }

        if (changed) {
            app.mapViewer.redraw();
        }
    }

    function updateNativeMarkerVisibility(actor) {
        const manager = app?.playerMarkerManager;
        const camera = app?.mapViewer?.camera;

        if (!manager || !camera?.position) {
            return;
        }

        const marker =
            manager.getPlayerMarker?.(actor.uuid);

        if (!marker) {
            return;
        }

        const distance =
            camera.position.distanceTo(
                actor.root.position
            );

        const shouldHide =
            distance < HIDE_NATIVE_MARKER_DISTANCE;

        if (actor.nativeMarkerHidden === shouldHide) {
            return;
        }

        actor.nativeMarkerHidden = shouldHide;

        // Hide only the native head icon; leave the player's name visible.
        if (marker.element) {
            const head =
                marker.element.querySelector("img");

            if (head) {
                head.style.display =
                    shouldHide ? "none" : "";
            }
        }
    }

    function restoreNativeMarker(actor) {
        if (!app?.playerMarkerManager) {
            return;
        }

        const marker =
            app.playerMarkerManager.getPlayerMarker?.(
                actor.uuid
            );

        if (!marker) {
            return;
        }

        if (marker.element) {
            const head =
                marker.element.querySelector("img");

            if (head) {
                head.style.display = "";
            }
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
        [
            actor.head,
            actor.body,
            actor.rightArm,
            actor.leftArm,
            actor.rightLeg,
            actor.leftLeg
        ].forEach(mesh => {
            mesh.geometry?.dispose?.();
        });

        actor.materials.forEach(material => {
            material.map?.dispose?.();
            material.dispose?.();
        });
    }

    function degreesToRadians(value) {
        return value * Math.PI / 180;
    }

    function lerpAngle(from, to, amount) {
        let delta =
            (to - from + Math.PI) %
            (Math.PI * 2) -
            Math.PI;

        return from + delta * amount;
    }

    waitForBlueMap();
})();
