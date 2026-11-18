import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import os from 'os';
import { VERSION } from './version.js';
import { CONFIG_FILE } from './config.js';

export interface ServerConfig {
  blockedCommands?: string[];
  defaultShell?: string;
  allowedDirectories?: string[];
  telemetryEnabled?: boolean; // New field for telemetry control
  fileWriteLineLimit?: number; // 0 or unset means unlimited
  fileReadLineLimit?: number; // 0 or unset means unlimited
  maxProcessWaitMs?: number; // Maximum time a process tool call waits before handing control back
  clientId?: string; // Unique client identifier for analytics
  currentClient?: ClientInfo; // Current connected client information
  [key: string]: any; // Allow for arbitrary configuration keys (including abTest_* keys)
}

/** Resolve an optional line limit; zero or unset means all available lines. */
export function resolveLineLimit(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : Number.MAX_SAFE_INTEGER;
}

export interface ClientInfo {
  name: string;
  version: string;
}

export function normalizeTelemetryEnabledValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return value;
}

export function isTelemetryDisabledValue(value: unknown): boolean {
  return normalizeTelemetryEnabledValue(value) === false;
}

/**
 * Singleton config manager for the server
 */
class ConfigManager {
  private configPath: string;
  private config: ServerConfig = {};
  private initialized = false;
  private _isFirstRun = false; // Track if this is the first run (config was just created)
  // Serializes all disk writes so concurrent saves can't corrupt config.json.
  private writeChain: Promise<void> = Promise.resolve();
  // True while a coalesced background write is already queued (see scheduleSave).
  private saveScheduled = false;

  constructor() {
    // Get user's home directory
    // Define config directory and file paths
    this.configPath = CONFIG_FILE;
  }

  /**
   * Initialize configuration - load from disk or create default
   */
  async init() {
    if (this.initialized) return;

    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }

      // Check if config file exists
      try {
        await fs.access(this.configPath);
        // Load existing config
        const configData = await fs.readFile(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
        this._isFirstRun = false;

        // Configs created before this marker existed must not receive the
        // welcome page retroactively when client eligibility changes later.
        // New configs get this field from getDefaultConfig() and remain
        // eligible across restarts until their first initialization.
        if (this.config['welcomeOnboardingEligible'] === undefined) {
          this.config['welcomeOnboardingEligible'] = false;
          this.config['pendingWelcomeOnboarding'] = false;
          await this.saveConfig();
        }
        if (this.config.maxProcessWaitMs === undefined) {
          this.config.maxProcessWaitMs = 10000;
          await this.saveConfig();
        }
      } catch (error) {
        // Config file doesn't exist, create default
        this.config = this.getDefaultConfig();
        this._isFirstRun = true; // This is a first run!
        await this.saveConfig();
      }
      this.config['version'] = VERSION;

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize config:', error);
      // Fall back to default config in memory
      this.config = this.getDefaultConfig();
      this.initialized = true;
    }
  }

  /**
   * Alias for init() to maintain backward compatibility
   */
  async loadConfig() {
    return this.init();
  }

  /**
   * Create default configuration
   */
  private getDefaultConfig(): ServerConfig {
    return {
      blockedCommands: [],
      defaultShell: (() => {
        if (os.platform() === 'win32') {
          return 'powershell.exe';
        }
        // Use user's actual shell from environment
        // On macOS, default to zsh (default since Catalina) since process.env.SHELL
        // may not be set when running inside Claude Desktop
        const fallbackShell = os.platform() === 'darwin' ? '/bin/zsh' : '/bin/sh';
        const userShell = process.env.SHELL || fallbackShell;
        // Return just the shell path - we'll handle login shell flag elsewhere
        return userShell;
      })(),
      allowedDirectories: [],
      telemetryEnabled: true, // Default to opt-out approach (telemetry on by default)
      fileWriteLineLimit: 0,  // 0 disables the line limit
      fileReadLineLimit: 0,  // 0 returns all available lines by default
      maxProcessWaitMs: 10000, // Releasing a tool call never terminates its child process
      pendingWelcomeOnboarding: true, // New install flag - triggers A/B test for welcome page
      welcomeOnboardingEligible: true // Distinguishes new installs from migrated legacy configs
    };
  }

  /**
   * Write the current in-memory config to disk. All writes funnel through
   * writeChain (see saveConfig / scheduleSave) so overlapping saves can never
   * interleave and corrupt the file. Previously every tool call could fire its
   * own independent fs.writeFile of the same path.
   */
  private async writeConfigToDisk(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  /**
   * Awaitable save, serialized on writeChain. Use for explicit, user-driven
   * config changes where the caller wants on-disk confirmation.
   */
  private async saveConfig(): Promise<void> {
    const write = this.writeChain.then(() => this.writeConfigToDisk());
    // Keep the chain alive even if this write rejects, so later writes still run.
    this.writeChain = write.catch(() => {});
    return write;
  }

  /**
   * Non-blocking, coalesced save. Returns immediately; the write runs in the
   * background. A burst of calls collapses to at most one queued write behind
   * the in-flight one, so a storm of tool calls can't storm the disk — and,
   * critically, can't pile up behind a saturated libuv threadpool and gate the
   * tool-call response path. Used for high-frequency, non-critical persistence
   * such as usage stats.
   */
  scheduleSave(): void {
    if (this.saveScheduled) return; // a queued write will capture the latest config
    this.saveScheduled = true;
    this.writeChain = this.writeChain.then(async () => {
      this.saveScheduled = false; // let the next burst queue a fresh write
      try {
        await this.writeConfigToDisk();
      } catch (error) {
        console.error('Failed to save config (background):', error);
      }
    });
  }

  /**
   * Get the entire config
   */
  async getConfig(): Promise<ServerConfig> {
    await this.init();
    return { ...this.config };
  }

  /**
   * Get a specific configuration value
   */
  async getValue(key: string): Promise<any> {
    await this.init();
    return this.config[key];
  }

  /**
   * Set a specific configuration value
   */
  async setValue(key: string, value: any): Promise<void> {
    await this.init();

    if (key === 'telemetryEnabled') {
      value = normalizeTelemetryEnabledValue(value);
    }
    
    // Special handling for telemetry opt-out
    if (key === 'telemetryEnabled' && isTelemetryDisabledValue(value)) {
      // Get the current value before changing it
      const currentValue: unknown = this.config[key];
      const telemetryAlreadyDisabled = isTelemetryDisabledValue(currentValue);
      
      // Only capture the opt-out event if telemetry was previously enabled
      if (!telemetryAlreadyDisabled) {
        // Import the capture function dynamically to avoid circular dependencies
        const { capture } = await import('./utils/capture.js');
        
        // Send a final telemetry event noting that the user has opted out
        // This helps us track opt-out rates while respecting the user's choice
        await capture('server_telemetry_opt_out', {
          reason: 'user_disabled',
          prev_value: currentValue
        });
      }
    }
    
    // Update the value
    this.config[key] = value;
    await this.saveConfig();
  }

  /**
   * Update a value in memory and persist it WITHOUT blocking the caller.
   * The tool-call response path must never wait on a disk write: when the libuv
   * threadpool is saturated (e.g. many parallel reads stalled on a slow/cloud
   * filesystem) an awaited write can't get a thread and would hang the response
   * of even pure-memory tools. The in-memory value is updated synchronously so
   * subsequent reads see it immediately; the write is coalesced in the
   * background. Callers needing on-disk confirmation should use setValue.
   */
  async setValueNonBlocking(key: string, value: any): Promise<void> {
    await this.init();
    this.config[key] = value;
    this.scheduleSave();
  }

  /**
   * Update multiple configuration values at once
   */
  async updateConfig(updates: Partial<ServerConfig>): Promise<ServerConfig> {
    await this.init();
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig(): Promise<ServerConfig> {
    this.config = this.getDefaultConfig();
    await this.saveConfig();
    return { ...this.config };
  }

  /**
   * Check if this is the first run (config file was just created)
   */
  isFirstRun(): boolean {
    return this._isFirstRun;
  }

  /**
   * Get or create a persistent client ID for analytics and A/B tests
   */
  async getOrCreateClientId(): Promise<string> {
    let clientId = await this.getValue('clientId');
    if (!clientId) {
      const { randomUUID } = await import('crypto');
      clientId = randomUUID();
      await this.setValue('clientId', clientId);
    }
    return clientId;
  }
}

// Export singleton instance
export const configManager = new ConfigManager();
