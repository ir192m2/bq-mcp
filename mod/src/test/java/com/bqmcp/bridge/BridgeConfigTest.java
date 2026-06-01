package com.bqmcp.bridge;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Properties;

import static org.junit.Assert.*;

public class BridgeConfigTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private String savedSysProp;
    private String savedEnvVar;

    @Before
    public void clearConfigState() {
        savedSysProp = System.getProperty(BridgeConfig.SYS_PROP);
        System.clearProperty(BridgeConfig.SYS_PROP);
    }

    @After
    public void restoreConfigState() {
        if (savedSysProp != null) {
            System.setProperty(BridgeConfig.SYS_PROP, savedSysProp);
        } else {
            System.clearProperty(BridgeConfig.SYS_PROP);
        }
    }

    @Test
    public void validate_acceptsValidPort() {
        assertEquals(8080, BridgeConfig.validate(8080));
        assertEquals(1024, BridgeConfig.validate(1024));
        assertEquals(65535, BridgeConfig.validate(65535));
        assertEquals(18733, BridgeConfig.validate(18733));
    }

    @Test
    public void validate_rejectsBelowMin() {
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(1023));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(80));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(0));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(-1));
    }

    @Test
    public void validate_rejectsAboveMax() {
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(65536));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(70000));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneWhenMissing() {
        assertEquals(-1, BridgeConfig.readFromConfigFile(new File("/nonexistent/path")));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneForNullDir() {
        assertEquals(-1, BridgeConfig.readFromConfigFile(null));
    }

    @Test
    public void readFromConfigFile_parsesValidPort() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        File configFile = new File(configDir, "bridge.properties");
        try (FileWriter w = new FileWriter(configFile)) {
            w.write("port=28733\n");
        }
        assertEquals(28733, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromConfigFile_handlesWhitespace() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        File configFile = new File(configDir, "bridge.properties");
        try (FileWriter w = new FileWriter(configFile)) {
            w.write("  port = 28999  \n");
        }
        assertEquals(28999, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneOnInvalidNumber() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        File configFile = new File(configDir, "bridge.properties");
        try (FileWriter w = new FileWriter(configFile)) {
            w.write("port=not_a_number\n");
        }
        assertEquals(-1, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneOnEmptyFile() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        File configFile = new File(configDir, "bridge.properties");
        configFile.createNewFile();
        assertEquals(-1, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromSystemProperty_returnsMinusOneWhenUnset() {
        System.clearProperty(BridgeConfig.SYS_PROP);
        assertEquals(-1, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void readFromSystemProperty_parsesValidValue() {
        System.setProperty(BridgeConfig.SYS_PROP, "28888");
        assertEquals(28888, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void readFromSystemProperty_handlesWhitespace() {
        System.setProperty(BridgeConfig.SYS_PROP, "  29999  ");
        assertEquals(29999, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void readFromSystemProperty_returnsMinusOneOnInvalid() {
        System.setProperty(BridgeConfig.SYS_PROP, "garbage");
        assertEquals(-1, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void readFromSystemProperty_returnsMinusOneForNullName() {
        assertEquals(-1, BridgeConfig.readFromSystemProperty(null));
    }

    @Test
    public void resolvePort_defaultWhenNothingSet() {
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(
            new File("/nonexistent"), "nonexistent.sysprop", "NONEXISTENT_ENVVAR");
        assertEquals(BridgeConfig.DEFAULT_PORT, r.port);
        assertEquals("default", r.source);
    }

    @Test
    public void resolvePort_configFileWinsOverSysProp() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("port=20000\n");
        }
        System.setProperty("test.bqp", "20001");
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(configDir, "test.bqp", "TEST_BQP_ENVVAR");
        assertEquals(20000, r.port);
        assertEquals("config file", r.source);
    }

    @Test
    public void resolvePort_sysPropWinsOverEnvVar() {
        System.setProperty("test.bqp", "20002");
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(
            new File("/nonexistent"), "test.bqp", "TEST_BQP_ENVVAR_USED");
        assertEquals(20002, r.port);
        assertEquals("system property", r.source);
    }

    @Test
    public void resolvePort_fallsBackToDefaultWhenConfigInvalid() throws IOException {
        File configDir = tempFolder.newFolder("bqmcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("port=99\n");
        }
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(configDir, "test.unset.bqp", "TEST_UNSET_BQP");
        assertEquals(BridgeConfig.DEFAULT_PORT, r.port);
    }
}
