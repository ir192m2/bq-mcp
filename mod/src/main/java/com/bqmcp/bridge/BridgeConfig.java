package com.bqmcp.bridge;

import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

public final class BridgeConfig {
    private static final Logger LOG = LogManager.getLogger("bqmcp_bridge");
    public static final int DEFAULT_PORT = 18733;
    public static final int MIN_PORT = 1024;
    public static final int MAX_PORT = 65535;
    private static final String CONFIG_DIR_NAME = "bqmcp";
    private static final String CONFIG_FILE_NAME = "bridge.properties";
    public static final String SYS_PROP = "bqmcp.bridge.port";
    public static final String ENV_VAR = "BQ_BRIDGE_PORT";

    private int port = DEFAULT_PORT;
    private boolean resolved = false;

    public void resolve(FMLPreInitializationEvent event) {
        if (resolved) {
            return;
        }
        resolved = true;
        File configDir = new File(event.getModConfigurationDirectory(), CONFIG_DIR_NAME);
        Resolution r = resolvePort(configDir, SYS_PROP, ENV_VAR);
        this.port = r.port;
        LOG.info("Bridge port {} from {}", port, r.source);
    }

    public int getPort() {
        return port;
    }

    public static final class Resolution {
        public final int port;
        public final String source;
        public Resolution(int port, String source) {
            this.port = port;
            this.source = source;
        }
    }

    public static Resolution resolvePort(File configDir, String sysPropName, String envVarName) {
        int fromProps = readFromConfigFile(configDir);
        int fromSysProp = readFromSystemProperty(sysPropName);
        int fromEnv = readFromEnv(envVarName);

        if (fromProps > 0) {
            return new Resolution(validate(fromProps), "config file");
        } else if (fromSysProp > 0) {
            return new Resolution(validate(fromSysProp), "system property");
        } else if (fromEnv > 0) {
            return new Resolution(validate(fromEnv), "env var");
        } else {
            return new Resolution(DEFAULT_PORT, "default");
        }
    }

    public static int readFromConfigFile(File configDir) {
        if (configDir == null) return -1;
        try {
            File configFile = new File(configDir, CONFIG_FILE_NAME);
            if (!configFile.isFile()) {
                return -1;
            }
            Properties props = new Properties();
            try (FileInputStream fis = new FileInputStream(configFile)) {
                props.load(new java.io.InputStreamReader(fis, StandardCharsets.UTF_8));
            }
            String val = props.getProperty("port");
            if (val == null || val.isEmpty()) {
                return -1;
            }
            return Integer.parseInt(val.trim());
        } catch (IOException | NumberFormatException e) {
            return -1;
        }
    }

    public static int readFromSystemProperty(String sysPropName) {
        if (sysPropName == null) return -1;
        String val = System.getProperty(sysPropName);
        if (val == null || val.isEmpty()) {
            return -1;
        }
        try {
            return Integer.parseInt(val.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public static int readFromEnv(String envVarName) {
        if (envVarName == null) return -1;
        String val = System.getenv(envVarName);
        if (val == null || val.isEmpty()) {
            return -1;
        }
        try {
            return Integer.parseInt(val.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public static int validate(int candidate) {
        if (candidate < MIN_PORT || candidate > MAX_PORT) {
            return DEFAULT_PORT;
        }
        return candidate;
    }
}

