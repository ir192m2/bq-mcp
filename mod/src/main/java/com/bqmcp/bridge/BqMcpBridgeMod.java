package com.bqmcp.bridge;

import com.bqmcp.bridge.http.BqHttpBridgeServer;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import net.minecraftforge.fml.common.event.FMLServerStartedEvent;
import net.minecraftforge.fml.common.event.FMLServerStoppingEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@Mod(
    modid = BqMcpBridgeMod.MOD_ID,
    name = BqMcpBridgeMod.NAME,
    version = BqMcpBridgeMod.VERSION,
    dependencies = "required-after:betterquesting;"
)
public class BqMcpBridgeMod {
    public static final String MOD_ID = "bqmcp_bridge";
    public static final String NAME = "BQ MCP Bridge";
    public static final String VERSION = "1.2.0";

    private static final Logger LOG = LogManager.getLogger(MOD_ID);
    private final BridgeConfig config = new BridgeConfig();
    private BqHttpBridgeServer httpServer;

    @Mod.EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        config.resolve(event);
        BqWriteSafety.init(event);
        LOG.info("BQ MCP Bridge pre-init (port={}, version={})", config.getPort(), VERSION);
    }

    @Mod.EventHandler
    public void onServerStarted(FMLServerStartedEvent event) {
        try {
            httpServer = new BqHttpBridgeServer(config.getPort());
            httpServer.start();
            LOG.info("BQ MCP Bridge HTTP server started on port {}", config.getPort());
        } catch (Exception e) {
            LOG.error("Failed to start BQ MCP Bridge HTTP server", e);
        }
    }

    @Mod.EventHandler
    public void onServerStopping(FMLServerStoppingEvent event) {
        if (httpServer != null) {
            httpServer.stop();
            LOG.info("BQ MCP Bridge HTTP server stopped");
        }
    }
}
