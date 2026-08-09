package dev.kacboy.bluemap3dplayermodels;

import de.bluecolored.bluemap.api.BlueMapAPI;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

public final class BlueMap3DPlayerModelsPlugin extends JavaPlugin implements Listener {
    private static final String WEB_DIR = "bluemap-3d-player-models-paper";
    private static final String SCRIPT_NAME = "player-models-0.5.2.js";

    private final AtomicReference<BlueMapAPI> blueMap = new AtomicReference<>();
    private final Consumer<BlueMapAPI> enableListener = this::onBlueMapEnable;
    private final Consumer<BlueMapAPI> disableListener = api -> blueMap.compareAndSet(api, null);

    private volatile Path skinDirectory;
    private volatile Path capeDirectory;

    @Override
    public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
        BlueMapAPI.onEnable(enableListener);
        BlueMapAPI.onDisable(disableListener);

        // Refresh cached appearance files occasionally in case a player changes skin/cape.
        Bukkit.getScheduler().runTaskTimer(this, this::queueOnlineAppearanceRefresh,
                20L * 15L, 20L * 60L * 10L);

        getLogger().info("BlueMap3DPlayerModelsPaper enabled; waiting for BlueMap API.");
    }

    @Override
    public void onDisable() {
        BlueMapAPI.unregisterListener(enableListener);
        BlueMapAPI.unregisterListener(disableListener);
        blueMap.set(null);
    }

    private void onBlueMapEnable(BlueMapAPI api) {
        blueMap.set(api);

        try {
            Path addonRoot = Files.createDirectories(api.getWebApp().getWebRoot().resolve(WEB_DIR));
            skinDirectory = Files.createDirectories(addonRoot.resolve("skins"));
            capeDirectory = Files.createDirectories(addonRoot.resolve("capes"));

            copyResource("/web/" + SCRIPT_NAME, addonRoot.resolve(SCRIPT_NAME));
            api.getWebApp().registerScript(WEB_DIR + "/" + SCRIPT_NAME);

            getLogger().info("Installed BlueMap web extension for BlueMap " + api.getBlueMapVersion()
                    + " / API " + api.getAPIVersion());

            Bukkit.getScheduler().runTask(this, this::queueOnlineAppearanceRefresh);
        } catch (IOException exception) {
            getLogger().severe("Could not install BlueMap web files: " + exception.getMessage());
            exception.printStackTrace();
        }
    }

    private void copyResource(String resource, Path target) throws IOException {
        try (InputStream input = getClass().getResourceAsStream(resource)) {
            if (input == null) throw new IOException("Missing bundled resource " + resource);
            Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        Bukkit.getScheduler().runTaskLater(this, () -> queueAppearance(uuid), 40L);
    }

    private void queueOnlineAppearanceRefresh() {
        List<UUID> uuids = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            uuids.add(player.getUniqueId());
        }
        for (UUID uuid : uuids) {
            queueAppearance(uuid);
        }
    }

    private void queueAppearance(UUID uuid) {
        BlueMapAPI api = blueMap.get();
        Path skins = skinDirectory;
        Path capes = capeDirectory;

        if (api == null || skins == null || capes == null) return;

        // Bukkit profile access stays on the server thread. Network/file work happens async.
        URL capeUrl = null;
        Player player = Bukkit.getPlayer(uuid);
        if (player != null) {
            try {
                capeUrl = player.getPlayerProfile().getTextures().getCape();
            } catch (Exception exception) {
                getLogger().fine("Could not read cape profile for " + uuid + ": " + exception.getMessage());
            }
        }

        URL finalCapeUrl = capeUrl;

        Bukkit.getAsyncScheduler().runNow(this, scheduledTask -> {
            try {
                cacheSkin(api, uuid, skins);
            } catch (Exception exception) {
                getLogger().warning("Failed to cache skin for " + uuid + ": " + exception.getMessage());
            }

            try {
                cacheCape(uuid, finalCapeUrl, capes);
            } catch (Exception exception) {
                getLogger().warning("Failed to cache cape for " + uuid + ": " + exception.getMessage());
            }
        });
    }

    private void cacheSkin(BlueMapAPI api, UUID uuid, Path root) throws IOException {
        BufferedImage image = api.getPlugin().getSkinProvider().load(uuid).orElse(null);
        if (image == null) {
            getLogger().warning("No skin available yet for " + uuid);
            return;
        }

        if (image.getWidth() != 64 || (image.getHeight() != 64 && image.getHeight() != 32)) {
            getLogger().warning("Ignoring unexpected skin size " + image.getWidth() + "x" + image.getHeight()
                    + " for " + uuid);
            return;
        }

        Path target = root.resolve(uuid + ".png");
        Path temporary = root.resolve(uuid + ".png.tmp");

        if (!ImageIO.write(image, "png", temporary.toFile())) {
            throw new IOException("PNG writer unavailable");
        }

        replaceAtomically(temporary, target);
    }

    private void cacheCape(UUID uuid, URL capeUrl, Path root) throws IOException {
        Path target = root.resolve(uuid + ".png");

        if (capeUrl == null) {
            Files.deleteIfExists(target);
            return;
        }

        URLConnection connection = capeUrl.openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setUseCaches(false);

        BufferedImage cape;
        try (InputStream input = connection.getInputStream()) {
            cape = ImageIO.read(input);
        }

        if (cape == null) {
            throw new IOException("Cape URL did not return an image");
        }

        // Mojang cape textures are normally 64x32, but keep scaled variants too.
        if (cape.getWidth() < 22 || cape.getHeight() < 17) {
            throw new IOException("Unexpected cape size " + cape.getWidth() + "x" + cape.getHeight());
        }

        Path temporary = root.resolve(uuid + ".png.tmp");
        if (!ImageIO.write(cape, "png", temporary.toFile())) {
            throw new IOException("PNG writer unavailable");
        }

        replaceAtomically(temporary, target);
    }

    private void replaceAtomically(Path temporary, Path target) throws IOException {
        try {
            Files.move(temporary, target,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException atomicMoveFailed) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
