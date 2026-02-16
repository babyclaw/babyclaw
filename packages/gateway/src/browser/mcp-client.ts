import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type BrowserMcpClientConfig = {
  /** API key passed as OPENAI_API_KEY to browser-use */
  llmApiKey: string;
  /** Base URL for OpenAI-compatible endpoint (e.g. AI Gateway) */
  llmBaseUrl?: string;
  /** LLM model passed to browser-use */
  llmModel: string;
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
};

type CallToolInput = {
  name: string;
  arguments: Record<string, unknown>;
};

type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

const MCP_CLIENT_NAME = "simpleclaw";
const MCP_CLIENT_VERSION = "1.0.0";

export function buildBrowserMcpEnv({
  baseEnv,
  config,
}: {
  baseEnv: Record<string, string>;
  config: BrowserMcpClientConfig;
}): Record<string, string> {
  const env: Record<string, string> = {
    ...baseEnv,
    OPENAI_API_KEY: config.llmApiKey,
    OPENAI_MODEL: config.llmModel,
    BROWSER_USE_LLM_MODEL: config.llmModel,
  };

  if (config.llmBaseUrl) {
    env.OPENAI_API_BASE = config.llmBaseUrl;
    env.OPENAI_BASE_URL = config.llmBaseUrl;
  }

  if (config.headless !== false) {
    env.BROWSER_USE_HEADLESS = "true";
  }

  return env;
}

export class BrowserMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly config: BrowserMcpClientConfig;

  constructor(config: BrowserMcpClientConfig) {
    this.config = config;
  }

  async ensureConnected(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    // Avoid duplicate connections if called concurrently
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connect();

    try {
      const client = await this.connecting;
      return client;
    } finally {
      this.connecting = null;
    }
  }

  async callTool({ name, arguments: args }: CallToolInput): Promise<McpToolResult> {
    const client = await this.ensureConnected();

    const result = await client.callTool({
      name,
      arguments: args,
    });

    return result as McpToolResult;
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error("[browser-mcp] Error closing MCP client:", error);
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        console.error("[browser-mcp] Error closing MCP transport:", error);
      }
      this.transport = null;
    }
  }

  private async connect(): Promise<Client> {
    console.log("[browser-mcp] Spawning browser-use MCP server...");

    const env = buildBrowserMcpEnv({
      baseEnv: process.env as Record<string, string>,
      config: this.config,
    });

    this.transport = new StdioClientTransport({
      command: "uvx",
      args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
      env,
    });

    this.client = new Client({
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    });

    this.transport.onclose = () => {
      console.log("[browser-mcp] MCP transport closed, clearing client reference.");
      this.client = null;
      this.transport = null;
    };

    this.transport.onerror = (error) => {
      console.error("[browser-mcp] MCP transport error:", error);
    };

    await this.client.connect(this.transport);
    console.log("[browser-mcp] MCP client connected to browser-use server.");

    return this.client;
  }
}
